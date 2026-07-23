// Browser client. Connects to the dev server over WebSocket, feeds snapshots to
// the CanvasRenderer, and updates the HUD (score, rosters, kill feed). It has no
// simulation logic — it only renders state the engine produces.

import { CanvasRenderer } from '/render/canvasRenderer.js';

const canvas = document.getElementById('arena');
const $ = (id) => document.getElementById(id);

let renderer = null;
let catalog = {};
let currentMode = 'aggressive';
let rafStarted = false;

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
  syncModeButtons();

  if (!renderer) renderer = new CanvasRenderer(canvas, init);
  else renderer.setInit(init);

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
  }
}

function onEnd(summary) {
  showOverlay(summary);
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

$('btn-new').addEventListener('click', () => send({ cmd: 'restart', config: { mode: currentMode } }));
$('mode-agg').addEventListener('click', () => setMode('aggressive'));
$('mode-pass').addEventListener('click', () => setMode('passive'));

function setMode(mode) {
  currentMode = mode;
  syncModeButtons();
  send({ cmd: 'setMode', mode });
}

function syncModeButtons() {
  $('mode-agg').classList.toggle('active', currentMode === 'aggressive');
  $('mode-pass').classList.toggle('active', currentMode === 'passive');
}
