// Browser client. Connects to the dev server over WebSocket, feeds snapshots to
// the CanvasRenderer, and updates the HUD (score, rosters, kill feed). It has no
// simulation logic — it only renders state the engine produces.

import { CanvasRenderer, FORMATS } from '/render/canvasRenderer.js';
import { ArenaAudio, ARENA_SFX } from '/render/audio.js';

const canvas = document.getElementById('arena');
const $ = (id) => document.getElementById(id);

let renderer = null;
let catalog = {};
let currentMode = 'passive'; // forage-first is the default feel (overwritten by init.mode)
let rafStarted = false;
let arenaWidth = 960; // updated from init; used to pan sounds across the stereo field
let currentFormat = 'wide'; // 'wide' (16:9 preview) | 'short' (9:16 for Shorts)
let cameraFollow = true; // action camera: chase and zoom on the fighting
let showreel = true; // intro "VS" card + slow-mo replay + winner card

// The sound layer. Each species carries its own `sfx` recipes in the catalog, so
// routing an event to a sound is a catalog lookup — no species names appear here.
const audio = new ArenaAudio({ volume: 0.6 });

// --- Fight builder state (survives auto-restarts; seeded once from the catalog) ---
let customRoster = { A: {}, B: {} }; // { A: { speciesId: count }, B: {...} }
let builderSeeded = false;

// --- WebSocket ---------------------------------------------------------------

let ws;
function connect() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onmessage = (e) => handleMessage(JSON.parse(e.data));
  ws.onclose = () => {
    setStatus('disconnected — retrying…');
    setTimeout(connect, 1000);
  };
  ws.onopen = () => setStatus('running');
}
connect();

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function handleMessage(msg) {
  if (msg.type === 'init') onInit(msg.data);
  else if (msg.type === 'snapshot') onSnapshot(msg.data);
  else if (msg.type === 'end') onEnd(msg.data);
}

// --- Handlers ----------------------------------------------------------------

function onInit(init) {
  catalog = {};
  for (const s of init.catalog) catalog[s.id] = s;
  currentMode = init.mode;
  arenaWidth = init.arena?.width || arenaWidth;
  syncModeButtons();

  // Seed the builder with a sample matchup the first time we know the roster,
  // then (re)draw it. Never reseed — the user's picks persist across restarts.
  if (!builderSeeded) {
    seedDefaultRoster();
    builderSeeded = true;
  }
  renderBuilder();

  if (!renderer) renderer = new CanvasRenderer(canvas, init, { format: currentFormat, showreel });
  else renderer.setInit(init);
  syncFormatUi();

  hideOverlay();
  clearFeed();
  $('meta-mode').textContent = init.mode;
  $('meta-seed').textContent = `seed ${init.seed}`;
  setStatus('running');

  if (!rafStarted) {
    rafStarted = true;
    const loop = (t) => {
      if (renderer) renderer.render(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

function onSnapshot(snap) {
  if (renderer) renderer.ingest(snap);
  updateHud(snap);
  updateAbilityDebug(snap); // per-champion cooldown readout
  for (const ev of snap.events) {
    if (ev.type === 'death') pushFeed(ev);
    else if (ev.type === 'ability') pushAbilityFeed(ev);
    else if (ev.type === 'reinforcement') pushReinforcementFeed(ev);
  }
  playEventSounds(snap.events);
}

// --- Sound routing -----------------------------------------------------------

/** Map an arena x-coordinate onto the stereo field (kept short of hard L/R). */
function panFor(x) {
  if (x == null) return 0;
  return Math.max(-0.8, Math.min(0.8, (x / arenaWidth) * 2 - 1));
}

/**
 * Turn this tick's events into sound. Every species voice is looked up from the
 * catalog's `sfx` block, so a new species is audible the moment it declares one.
 *
 * Throttle windows matter here: a dozen ants biting on the same tick is one bite
 * sound, not twelve. The window is per species AND per event kind, so distinct
 * species still layer against each other.
 */
function playEventSounds(events) {
  for (const ev of events) {
    switch (ev.type) {
      case 'attack': {
        const sfx = catalog[ev.speciesId]?.sfx?.attack;
        // Attacks are by far the most frequent event — throttled hardest, and
        // played quietly so ability and death sounds stay on top of the mix.
        if (sfx) audio.play(sfx, { pan: panFor(ev.x), gain: 0.55, key: `atk:${ev.speciesId}`, throttleMs: 90 });
        break;
      }
      case 'ability': {
        const sfx = catalog[ev.casterSpecies]?.sfx?.ability;
        if (sfx) audio.play(sfx, { pan: panFor(ev.x), gain: 1, key: `ab:${ev.casterSpecies}`, throttleMs: 140 });
        break;
      }
      case 'death': {
        const sfx = catalog[ev.victimSpecies]?.sfx?.death;
        if (sfx) audio.play(sfx, { pan: panFor(ev.x), gain: 0.9, key: `die:${ev.victimSpecies}`, throttleMs: 70 });
        break;
      }
      case 'reinforcement':
        audio.play(ev.isBug ? ARENA_SFX.musterBug : ARENA_SFX.muster, {
          pan: panFor(ev.x),
          gain: 0.9,
          key: 'muster',
          throttleMs: 200,
        });
        break;
      case 'food_eaten':
        audio.play(ARENA_SFX.eat, { gain: 0.6, key: 'eat', throttleMs: 220 });
        break;
      case 'battle_start':
        audio.play(ARENA_SFX.battleStart, { gain: 1, key: 'start', throttleMs: 1500 });
        break;
      case 'battle_over':
        audio.play(ev.winner === 'draw' ? ARENA_SFX.draw : ARENA_SFX.victory, {
          gain: 1,
          key: 'over',
          throttleMs: 1500,
        });
        break;
      default:
        break;
    }
  }
}

function onEnd(summary) {
  // With the showreel on, the winner is announced by the renderer's own outro
  // card AFTER the slow-mo replay plays out — popping this DOM overlay now would
  // cover the replay and double up the result. The plain DOM overlay is only for
  // the no-showreel view.
  if (!showreel) showOverlay(summary);
}

// --- HUD ---------------------------------------------------------------------

function updateHud(snap) {
  const a = snap.score.A;
  const b = snap.score.B;
  $('score-a').textContent = a;
  $('score-b').textContent = b;
  const total = a + b || 1;
  $('bar-a').style.width = `${(a / total) * 100}%`;
  $('meta-time').textContent = `${snap.time.toFixed(1)}s`;

  renderRoster('a', snap.agents.filter((x) => x.team === 'A'));
  renderRoster('b', snap.agents.filter((x) => x.team === 'B'));
}

function renderRoster(team, agents) {
  const counts = {};
  for (const a of agents) counts[a.speciesId] = (counts[a.speciesId] || 0) + 1;
  const el = $(`roster-${team}`);
  const ids = Object.keys(catalog);
  el.innerHTML = ids
    .map((id) => {
      const n = counts[id] || 0;
      const color = catalog[id]?.visual?.color || '#888';
      const name = catalog[id]?.name || id;
      const dim = n === 0 ? 'opacity:0.35;' : '';
      return `<div class="sp-row" style="${dim}">
        <span class="dot" style="background:${color}"></span>
        <span>${name}</span><span class="cnt">${n}</span>
      </div>`;
    })
    .join('');
}

// Ability procs: the engine ships a ready-made, readable `text` — show it as-is
// (this is the same string a future narration/captioning layer will read).
function pushAbilityFeed(ev) {
  console.log(`[ability] ${ev.text}`);
  const feed = $('feed');
  const line = document.createElement('div');
  line.className = 'line';
  line.innerHTML = `⚡ <b style="color:${teamColor(ev.casterTeam)}">${ev.text}</b>`;
  feed.prepend(line);
  while (feed.childElementCount > 40) feed.removeChild(feed.lastChild);
}

// Debug overlay: "Web Spider — ready" / "Blade Mantis — 2.3s" so cooldowns are
// verifiable at a glance during testing.
function updateAbilityDebug(snap) {
  const el = $('abilities');
  if (!el) return;
  // Champions only — soldier squads share one ability (Ignite) and would flood
  // this list. Their procs still show in the feed; this panel tracks the leaders.
  const champs = snap.agents.filter((a) => a.ability && catalog[a.speciesId]?.tier === 'champion');
  const rows = champs
    .map((a) => {
      const name = catalog[a.speciesId]?.name || a.speciesId;
      const state = a.ability.ready
        ? '<span style="color:#5ad86a">ready</span>'
        : `<span style="color:#e6c34a">${a.ability.cooldown.toFixed(1)}s</span>`;
      return `<div class="sp-row">
        <span class="dot" style="background:${teamColor(a.team)}"></span>
        <span>${name} · <i style="color:#9aa3b7">${a.ability.name}</i></span>
        <span class="cnt">${state}</span>
      </div>`;
    })
    .join('');
  // Soldier headcount per team, so the squad size is still verifiable at a glance.
  const soldiers = snap.agents.filter((a) => catalog[a.speciesId]?.tier === 'soldier');
  const sa = soldiers.filter((a) => a.team === 'A').length;
  const sb = soldiers.filter((a) => a.team === 'B').length;
  const squadLine = `<div class="sp-row" style="opacity:0.7">
    <span>Soldiers</span>
    <span class="cnt"><b style="color:#4ea1ff">${sa}</b> vs <b style="color:#ff5d73">${sb}</b></span>
  </div>`;
  el.innerHTML = (rows || '') + squadLine;
}

// A colony grew: foraging paid off with a fresh unit (an ant, or rarely a bug).
function pushReinforcementFeed(ev) {
  const feed = $('feed');
  const line = document.createElement('div');
  line.className = 'line';
  const name = catalog[ev.speciesId]?.name || ev.speciesName || ev.speciesId;
  const col = teamColor(ev.team);
  if (ev.isBug) {
    line.innerHTML = `★ <b style="color:${col}">Team ${ev.team}</b> hatched a bug — <b style="color:#ffd24a">${name}</b>!`;
  } else {
    line.innerHTML = `➕ <b style="color:${col}">Team ${ev.team}</b> reinforced — <b style="color:${col}">${name}</b>`;
  }
  feed.prepend(line);
  while (feed.childElementCount > 40) feed.removeChild(feed.lastChild);
}

function pushFeed(ev) {
  const feed = $('feed');
  const victim = catalog[ev.victimSpecies]?.name || ev.victimSpecies;
  const killer = ev.killerSpecies ? catalog[ev.killerSpecies]?.name || ev.killerSpecies : null;
  const line = document.createElement('div');
  line.className = 'line';
  if (killer) {
    line.innerHTML = `<b style="color:${teamColor(ev.killerTeam)}">${killer}</b> ${verbFor(
      ev.cause
    )} <b style="color:${teamColor(ev.victimTeam)}">${victim}</b>`;
  } else {
    line.innerHTML = `<b style="color:${teamColor(ev.victimTeam)}">${victim}</b> died (${ev.cause})`;
  }
  feed.prepend(line);
  while (feed.childElementCount > 40) feed.removeChild(feed.lastChild);
}

function verbFor(cause) {
  switch (cause) {
    case 'burn':
      return 'burned';
    case 'ember_burst':
      return 'incinerated';
    case 'crit':
      return 'critically struck';
    case 'ranged':
      return 'sniped';
    case 'poison':
      return 'poisoned';
    case 'sting':
      return 'stung';
    case 'dash_strike':
      return 'ran down';
    case 'snap':
      return 'snapped shut on';
    case 'toss':
      return 'hurled';
    case 'barrage':
      return 'riddled';
    case 'crushed':
      return 'crushed';
    case 'sweep':
      return 'raked';
    case 'chemical_blast':
      return 'boiled';
    case 'thorns':
      return 'splintered'; // the reflect kills the ATTACKER, so the shell is the killer
    case 'acid':
      return 'dissolved';
    case 'leap':
      return 'pounced on';
    case 'execute':
      return 'drained';
    case 'spit':
      return 'gunned down';
    case 'necrosis':
      return 'rotted';
    case 'pit':
      return 'buried';
    // NOTE: no 'backblast' case — that death is credited to no killer on purpose,
    // so it takes the killer-less branch above ("… died (backblast)").
    default:
      return 'killed';
  }
}

function teamColor(team) {
  return team === 'A' ? '#4ea1ff' : '#ff5d73';
}

function clearFeed() {
  $('feed').innerHTML = '';
}

function setStatus(text) {
  $('meta-status').textContent = text;
}

// --- Overlay -----------------------------------------------------------------

function showOverlay(summary) {
  const ov = $('overlay');
  const title =
    summary.winner === 'draw' ? 'Draw' : `Team ${summary.winner} wins`;
  $('overlay-title').textContent = title;
  $('overlay-title').style.color =
    summary.winner === 'A' ? '#4ea1ff' : summary.winner === 'B' ? '#ff5d73' : '#e6e9ef';
  $('overlay-sub').textContent =
    `by ${summary.reason} · ${summary.durationSeconds}s · ${summary.totalKills} kills · new battle soon…`;
  ov.classList.add('show');
}

function hideOverlay() {
  $('overlay').classList.remove('show');
}

// --- Controls ----------------------------------------------------------------

// "New Battle" goes back to a RANDOM tier-generated fight — explicitly clear any
// custom roster so the server stops replaying the built matchup.
$('btn-new').addEventListener('click', () =>
  send({ cmd: 'restart', config: { mode: currentMode, seed: null, teams: { custom: null } } })
);
$('mode-agg').addEventListener('click', () => setMode('aggressive'));
$('mode-pass').addEventListener('click', () => setMode('passive'));

function setMode(mode) {
  currentMode = mode;
  syncModeButtons();
  // setMode keeps whatever roster is active (random or custom) and just swaps mode.
  send({ cmd: 'setMode', mode });
}

function syncModeButtons() {
  $('mode-agg').classList.toggle('active', currentMode === 'aggressive');
  $('mode-pass').classList.toggle('active', currentMode === 'passive');
}

// --- Framing controls (aspect + action camera) -------------------------------

// A 16:9 desktop preview and a 9:16 Shorts frame are genuinely different shots:
// the vertical one crops hard, so the action camera matters far more there.
function syncFormatUi() {
  const wide = $('fmt-wide');
  const short = $('fmt-short');
  if (wide) wide.classList.toggle('active', currentFormat === 'wide');
  if (short) short.classList.toggle('active', currentFormat === 'short');
  const stage = document.querySelector('.stage');
  if (stage) stage.classList.toggle('portrait', currentFormat === 'short');
  const cam = $('btn-camera');
  if (cam) {
    cam.textContent = cameraFollow ? '🎥 Action cam' : '🖼 Full arena';
    cam.classList.toggle('muted', !cameraFollow);
  }
  const reel = $('btn-showreel');
  if (reel) {
    reel.textContent = showreel ? '🎬 Showreel: on' : '🎬 Showreel: off';
    reel.classList.toggle('muted', !showreel);
  }
}

// Aspect is not just a crop. A landscape arena letterboxed into a 9:16 frame
// wastes most of the screen, so switching to Shorts also asks the engine for a
// PORTRAIT arena — and the engine then lines the armies up top-vs-bottom.
const ARENA_FOR = {
  wide: { width: 960, height: 600 },
  short: { width: 620, height: 1000 },
};

function setFormat(format) {
  if (!FORMATS[format] || format === currentFormat) return;
  currentFormat = format;
  renderer?.setFormat(format);
  syncFormatUi();
  send({ cmd: 'restart', config: { mode: currentMode, arena: ARENA_FOR[format] } });
}

function setupFramingControls() {
  $('fmt-wide')?.addEventListener('click', () => setFormat('wide'));
  $('fmt-short')?.addEventListener('click', () => setFormat('short'));
  $('btn-camera')?.addEventListener('click', () => {
    cameraFollow = !cameraFollow;
    renderer?.setCameraFollow(cameraFollow);
    syncFormatUi();
  });
  $('btn-showreel')?.addEventListener('click', () => {
    showreel = !showreel;
    renderer?.setShowreel(showreel);
    syncFormatUi();
  });
  syncFormatUi();
}

// --- Sound controls ----------------------------------------------------------

// Browsers won't let audio start until the user interacts with the page, so the
// hint stays up until the context is actually running, then removes itself.
function setupSoundControls() {
  const btn = $('btn-sound');
  const vol = $('vol');
  const hint = $('sound-hint');
  if (!btn || !vol) return;

  const syncHint = () => {
    if (audio.ready || audio.muted) hint?.classList.add('hidden');
    else hint?.classList.remove('hidden');
  };

  btn.addEventListener('click', () => {
    audio.setMuted(!audio.muted);
    btn.textContent = audio.muted ? '🔇 Muted' : '🔊 Sound';
    btn.classList.toggle('muted', audio.muted);
    syncHint();
  });

  vol.addEventListener('input', () => audio.setVolume(Number(vol.value) / 100));

  // The first click/keypress anywhere unlocks the context (ArenaAudio listens for
  // it too); re-check shortly after so the hint clears once it's really running.
  window.addEventListener('pointerdown', () => setTimeout(syncHint, 60), { once: false });
  window.addEventListener('keydown', () => setTimeout(syncHint, 60), { once: false });
  syncHint();
}

// --- Fight builder ----------------------------------------------------------

// A sample matchup so the builder is usable the moment it loads.
function seedDefaultRoster() {
  const set = (team, id, n) => {
    if (catalog[id]) customRoster[team][id] = n;
  };
  set('A', 'fireAnt', 6);
  set('A', 'mantis', 1);
  set('B', 'bulletAnt', 6);
  set('B', 'scorpion', 1);
}

// Draw a stepper row per species for each team, reflecting current counts.
function renderBuilder() {
  const ids = Object.keys(catalog);
  for (const team of ['A', 'B']) {
    const el = $(`build-${team.toLowerCase()}`);
    if (!el) continue;
    el.innerHTML = ids
      .map((id) => {
        const n = customRoster[team][id] || 0;
        const color = catalog[id]?.visual?.color || '#888';
        const name = catalog[id]?.name || id;
        return `<div class="build-row ${n > 0 ? 'has' : ''}" data-sp="${id}">
          <span class="dot" style="background:${color}"></span>
          <span class="bname">${name}</span>
          <span class="stepper">
            <button class="dec" type="button" aria-label="fewer">−</button>
            <span class="bcount">${n}</span>
            <button class="inc" type="button" aria-label="more">+</button>
          </span>
        </div>`;
      })
      .join('');
  }
}

// One delegated handler per team list (the containers are static, so this is
// attached once and survives every renderBuilder re-draw).
function setupBuilderControls() {
  for (const team of ['A', 'B']) {
    const list = $(`build-${team.toLowerCase()}`);
    if (!list) continue;
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      const row = e.target.closest('.build-row');
      if (!btn || !row) return;
      const sp = row.dataset.sp;
      const cur = customRoster[team][sp] || 0;
      const next = btn.classList.contains('inc') ? Math.min(50, cur + 1) : Math.max(0, cur - 1);
      customRoster[team][sp] = next;
      row.querySelector('.bcount').textContent = next;
      row.classList.toggle('has', next > 0);
    });
  }

  $('btn-simulate').addEventListener('click', simulateCustomFight);
  $('btn-clear-build').addEventListener('click', () => {
    customRoster = { A: {}, B: {} };
    renderBuilder();
    $('build-hint').textContent = '';
  });
}

function rosterList(team) {
  return Object.entries(customRoster[team])
    .filter(([, n]) => n > 0)
    .map(([species, count]) => ({ species, count }));
}

function simulateCustomFight() {
  const hint = $('build-hint');
  const A = rosterList('A');
  const B = rosterList('B');
  if (!A.length || !B.length) {
    hint.textContent = 'Add at least one unit to each team.';
    return;
  }
  const raw = $('build-seed').value.trim();
  let seed = null;
  if (raw !== '') {
    seed = Number(raw);
    if (!Number.isFinite(seed)) {
      hint.textContent = 'Seed must be a number (or blank for random).';
      return;
    }
  }
  hint.textContent = '';
  send({ cmd: 'restart', config: { mode: currentMode, seed, teams: { custom: { A, B } } } });
}

setupBuilderControls();
setupSoundControls();
setupFramingControls();
