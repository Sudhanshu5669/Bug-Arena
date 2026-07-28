// Browser client. Drives an in-page LocalArena, feeds its snapshots to the
// CanvasRenderer, and updates the HUD (score, rosters, kill feed). It contains no
// simulation logic itself — it only renders state the engine produces.

import { CanvasRenderer, FORMATS } from './render/canvasRenderer.js';
import { ArenaAudio, ARENA_SFX } from './render/audio.js';
import { LocalArena } from './localArena.js';

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

// --- Simulation driver -------------------------------------------------------

// The battle runs in this tab. `send()` keeps the old socket-style command shape
// so every call site below is unchanged from the networked version.
const arena = new LocalArena(handleMessage, { mode: currentMode });

function send(obj) {
  arena.send(obj);
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
    // The reschedule MUST be unconditional. Previously `render()` was called bare
    // and `requestAnimationFrame(loop)` followed it, so a single throw inside a
    // frame ended the loop forever: the canvas froze while the engine, the HUD and
    // the kill feed carried on off the snapshot stream — a confusing failure that
    // looked like the simulation had hung when it hadn't.
    let renderErrors = 0;
    const loop = (t) => {
      requestAnimationFrame(loop);
      try {
        if (renderer) renderer.render(t);
      } catch (err) {
        // Log the first few and then stay quiet — a per-frame throw would other-
        // wise flood the console and become its own performance problem.
        if (renderErrors++ < 5) console.error('[render] frame failed:', err);
      }
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

  // Only species actually on the field. Listing the whole catalogue greyed-out
  // was readable at 24 species and is not at 44 — and a fight only ever fields a
  // handful of them anyway.
  const rows = Object.keys(counts)
    .sort((x, y) => counts[y] - counts[x])
    .map((id) => {
      const color = catalog[id]?.visual?.color || '#888';
      const name = catalog[id]?.name || id;
      return `<div class="sp-row">
        <span class="dot" style="background:${color}"></span>
        <span>${name}</span><span class="cnt">${counts[id]}</span>
      </div>`;
    })
    .join('');

  el.innerHTML = rows || '<div class="sp-row" style="opacity:0.45"><span>wiped out</span></div>';
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
    // --- causes introduced by the expanded roster ---------------------------
    // NOTE: damage-over-time is credited with the STATUS TYPE as its cause (see
    // engine `_updateStatuses`), so 'cordyceps' / 'digested' / 'blinded' are the
    // status names, not ability names.
    case 'silk':
      return 'snared';
    case 'pillage':
      return 'plundered';
    case 'flick':
      return 'flung off';
    case 'feed':
      return 'bled';
    case 'larceny':
      return 'robbed';
    case 'cordyceps':
      return 'infested';
    case 'liquefy':
      return 'liquefied';
    case 'digested':
      return 'digested';
    case 'blinded':
      return 'seared';
    case 'slime':
      return 'gummed up';
    case 'reek':
      return 'sickened';
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

// NOTE: "New random battle" lives in the roster panel now and is wired up in
// setupBuilderControls() — registering it here too would fire two restarts.
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

// --- Roster picker ----------------------------------------------------------

const MAX_PER_SPECIES = 50; // matches the engine's own per-entry clamp
let rosterFilter = 'all'; // 'all' | 'soldier' | 'champion'
let rosterQuery = '';

// A sample matchup so the roster is a playable fight the moment it loads.
function seedDefaultRoster() {
  const set = (team, id, n) => {
    if (catalog[id]) customRoster[team][id] = n;
  };
  set('A', 'fireAnt', 8);
  set('A', 'mantis', 1);
  set('B', 'bulletAnt', 8);
  set('B', 'scorpion', 1);
}

/** Sprite URL for a species, or null when it only has a shape descriptor. */
function thumbUrl(sp) {
  const v = sp?.visual;
  if (!v || v.type !== 'sprite') return null;
  const key = v.sprite || v.spriteSheet;
  if (!key) return null;
  const rel = v.spriteExt === 'svg' ? `src/${key}.svg` : `${key}.png`;
  return new URL(`./assets/sprites/${rel}`, import.meta.url).href;
}

// Ants first, then bugs, alphabetically within each tier — so the grid reads as
// two clear blocks rather than registration order.
function sortedSpeciesIds() {
  return Object.keys(catalog).sort((x, y) => {
    const a = catalog[x];
    const b = catalog[y];
    if (a.tier !== b.tier) return a.tier === 'soldier' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

let builderRendered = false;

// Build the 44 cards ONCE. `onInit` fires on every restart (a battle auto-starts
// every few seconds), and re-rendering there would re-request every sprite and
// visibly flash the grid — so subsequent calls only re-sync the counts.
function renderBuilder() {
  const grid = $('roster-grid');
  if (!grid) return;
  if (builderRendered) {
    syncAllCards();
    return;
  }
  builderRendered = true;

  grid.innerHTML = sortedSpeciesIds()
    .map((id) => {
      const sp = catalog[id];
      const url = thumbUrl(sp);
      const s = sp.stats || {};
      const tierLabel = sp.tier === 'champion' ? 'Bug' : 'Ant';
      const ability = sp.ability
        ? `<b>${escapeHtml(sp.ability.name)}</b>`
        : '<i>no signature ability</i>';

      // The thumbnail is an <img>, not inline SVG, on purpose: each file keeps its
      // own gradient ids that way, so 44 sprites can't collide over shared ids.
      const art = url
        ? `<img class="thumb" src="${url}" alt="" loading="lazy" />`
        : `<div class="thumb" style="display:grid;place-items:center">
             <span style="width:26px;height:26px;border-radius:50%;background:${sp.visual?.color || '#888'}"></span>
           </div>`;

      return `<div class="sp-card" data-sp="${id}" data-tier="${sp.tier}" data-name="${escapeHtml(
        sp.name.toLowerCase()
      )}">
        ${art}
        <span class="tier ${sp.tier}">${tierLabel}</span>
        <div class="nm">${escapeHtml(sp.name)}</div>
        <div class="ab">${ability}</div>
        <div class="stats">
          <span title="health">♥<b>${Math.round(s.maxHealth)}</b></span>
          <span title="damage">⚔<b>${s.damage}</b></span>
          <span title="speed">»<b>${s.speed}</b></span>
        </div>
        <div class="picker">
          <span class="pick a"><span class="lbl">A</span>
            <button class="dec" type="button" data-team="A" aria-label="fewer on A">−</button>
            <span class="n" data-team="A">0</span>
            <button class="inc" type="button" data-team="A" aria-label="more on A">+</button>
          </span>
          <span class="pick b"><span class="lbl">B</span>
            <button class="dec" type="button" data-team="B" aria-label="fewer on B">−</button>
            <span class="n" data-team="B">0</span>
            <button class="inc" type="button" data-team="B" aria-label="more on B">+</button>
          </span>
        </div>
      </div>`;
    })
    .join('');

  syncAllCards();
  applyFilter();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Push the stored counts for one species onto its card. */
function syncCard(card) {
  const id = card.dataset.sp;
  let any = false;
  for (const team of ['A', 'B']) {
    const n = customRoster[team][id] || 0;
    card.querySelector(`.n[data-team="${team}"]`).textContent = n;
    card.querySelector(`.pick.${team.toLowerCase()}`).classList.toggle('on', n > 0);
    card.classList.toggle(`in-${team.toLowerCase()}`, n > 0);
    any = any || n > 0;
  }
  return any;
}

function syncAllCards() {
  for (const card of document.querySelectorAll('.sp-card')) syncCard(card);
  renderArmies();
}

function setCount(team, id, n) {
  const next = Math.max(0, Math.min(MAX_PER_SPECIES, n));
  if (next === 0) delete customRoster[team][id];
  else customRoster[team][id] = next;
  const card = document.querySelector(`.sp-card[data-sp="${id}"]`);
  if (card) syncCard(card);
  renderArmies();
}

/** The two army summaries above the grid. */
function renderArmies() {
  for (const team of ['A', 'B']) {
    const entries = rosterList(team);
    const units = entries.reduce((n, e) => n + e.count, 0);
    const bugs = entries
      .filter((e) => catalog[e.species]?.tier === 'champion')
      .reduce((n, e) => n + e.count, 0);

    $(`tally-${team.toLowerCase()}`).innerHTML =
      `<b>${units}</b> unit${units === 1 ? '' : 's'}` +
      (bugs ? ` · <b>${bugs}</b> bug${bugs === 1 ? '' : 's'}` : '');

    const picks = $(`picks-${team.toLowerCase()}`);
    if (!entries.length) {
      picks.className = 'picks empty';
      picks.textContent = 'nothing picked';
    } else {
      picks.className = 'picks';
      picks.textContent = entries
        .map((e) => `${catalog[e.species]?.name || e.species} ×${e.count}`)
        .join(', ');
    }
  }
}

/** Hide cards that fail the current tier filter or search text. */
function applyFilter() {
  const q = rosterQuery.trim().toLowerCase();
  for (const card of document.querySelectorAll('.sp-card')) {
    const tierOk = rosterFilter === 'all' || card.dataset.tier === rosterFilter;
    const textOk = !q || card.dataset.name.includes(q);
    card.classList.toggle('hidden', !(tierOk && textOk));
  }
}

function setupBuilderControls() {
  // One delegated handler for all 44 cards — the grid is rebuilt on init, so
  // per-button listeners would leak on every restart.
  $('roster-grid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    const card = e.target.closest('.sp-card');
    if (!btn || !card) return;
    const team = btn.dataset.team;
    const id = card.dataset.sp;
    const cur = customRoster[team][id] || 0;
    setCount(team, id, btn.classList.contains('inc') ? cur + 1 : cur - 1);
  });

  const filters = { 'filt-all': 'all', 'filt-soldier': 'soldier', 'filt-champion': 'champion' };
  for (const [btnId, value] of Object.entries(filters)) {
    $(btnId)?.addEventListener('click', () => {
      rosterFilter = value;
      for (const other of Object.keys(filters)) $(other)?.classList.toggle('active', other === btnId);
      applyFilter();
    });
  }

  $('roster-search')?.addEventListener('input', (e) => {
    rosterQuery = e.target.value;
    applyFilter();
  });

  $('btn-simulate')?.addEventListener('click', simulateCustomFight);

  $('btn-clear-build')?.addEventListener('click', () => {
    customRoster = { A: {}, B: {} };
    syncAllCards();
    $('build-hint').textContent = '';
  });

  // Copy A's colony onto B — the fastest way to set up a controlled mirror match
  // where the only variable is the seed.
  $('btn-mirror')?.addEventListener('click', () => {
    customRoster.B = { ...customRoster.A };
    syncAllCards();
  });

  $('btn-random-army')?.addEventListener('click', rollRandomArmies);

  // "New random battle" hands the fight back to the engine's own tier-driven
  // matchmaking: `custom: null` is what tells it to stop replaying your roster.
  $('btn-new')?.addEventListener('click', () =>
    send({ cmd: 'restart', config: { mode: currentMode, seed: null, teams: { custom: null } } })
  );
}

/** Give each side one random ant species in numbers plus one random bug. */
function rollRandomArmies() {
  const ids = sortedSpeciesIds();
  const ants = ids.filter((id) => catalog[id].tier === 'soldier');
  const bugs = ids.filter((id) => catalog[id].tier === 'champion');
  if (!ants.length || !bugs.length) return;

  const pick = (arr, exclude) => {
    const pool = arr.filter((x) => x !== exclude);
    return pool[Math.floor(Math.random() * pool.length)] ?? arr[0];
  };

  customRoster = { A: {}, B: {} };
  const antA = pick(ants);
  const antB = pick(ants, antA);
  const bugA = pick(bugs);
  const bugB = pick(bugs, bugA);
  customRoster.A[antA] = 6 + Math.floor(Math.random() * 7);
  customRoster.B[antB] = 6 + Math.floor(Math.random() * 7);
  customRoster.A[bugA] = 1;
  customRoster.B[bugB] = 1;

  syncAllCards();
  $('build-hint').textContent = '';
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

// Kick off the first battle. (The dev server used to do this on `listen`; with the
// simulation in-page, the client owns it.)
setStatus('running');
arena.start();
