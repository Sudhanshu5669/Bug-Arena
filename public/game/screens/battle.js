// Battle (UI spec 05).
//
// Chrome is deliberately the quietest surface in the game — near-black surround,
// a sunken score track that moves on every death, a slab footer — so the
// torchlit arena is the only bright thing on screen. The fight itself is a real
// engine run: this screen only renders what the server sends back.

import { $, go, fmtTime, reduced } from '../ui.js';
import { glyph, LEVELS } from '../data.js';
import { runFight, setSpeed } from '../net.js';
import { session, placedTeam, enemyTeam } from '../session.js';
import * as state from '../state.js';
import { CanvasRenderer } from '/render/canvasRenderer.js';

let renderer = null;
let raf = 0;
let speed = 1;
let finished = false;
let skipRequested = false;
let latest = null;

const SPEEDS = [1, 2, 4];

function setScore(a, b, t) {
  $('#score-a').textContent = a;
  $('#score-b').textContent = b;
  $('#score-fill').style.width = `${(a / (a + b || 1)) * 100}%`;
  $('#battle-clock').textContent = fmtTime(t);
}

function startLoop() {
  if (raf) return;
  const loop = (ts) => {
    if (renderer) renderer.render(ts);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}

function stopLoop() {
  cancelAnimationFrame(raf);
  raf = 0;
}

export function init() {
  $('#speed-glyph').innerHTML = glyph('speed', 16);
  $('#sound-glyph').innerHTML = glyph('sound', 16);

  $('#battle-speed').addEventListener('click', () => {
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    $('#battle-speed').querySelector('.label-full').textContent = `Speed ×${speed}`;
    setSpeed(speed);
  });

  $('#battle-sound').addEventListener('click', () => {
    const on = !state.get().sound;
    state.setSound(on);
    $('#battle-sound').querySelector('.label-full').textContent = on ? 'Sound on' : 'Sound off';
    $('#sound-glyph').innerHTML = glyph(on ? 'sound' : 'mute', 16);
  });

  // Skip jumps straight to the verdict; the fight is already decided on the
  // server, so this only stops us watching it play out.
  $('#battle-skip').addEventListener('click', () => {
    skipRequested = true;
    if (finished) toResult();
  });
}

function veil(summary) {
  const won = summary.winner === 'A';
  const el = $('#battle-veil');
  $('#veil-title').className = `veil-title ${won ? 'is-win' : 'is-loss'}`;
  $('#veil-title').textContent = won ? 'The colony holds' : 'The colony breaks';
  $('#veil-sub').textContent = `${summary.totalKills} dead in ${fmtTime(summary.durationSeconds)}`;
  el.classList.add('is-up');
}

function toResult() {
  stopLoop();
  $('#battle-veil').classList.remove('is-up');
  go(session.mode === 'descent' ? 'beat' : 'result');
}

export function enter() {
  finished = false;
  skipRequested = false;
  latest = null;
  session.summary = null;
  $('#battle-veil').classList.remove('is-up');
  setScore(0, 0, 0);

  const lvName =
    session.mode === 'descent'
      ? `Chamber ${session.chamber}`
      : session.mode === 'maker'
        ? 'Battle Maker'
        : LEVELS[session.levelIndex].name;
  $('#battle-level').textContent = lvName;

  const sound = state.get().sound;
  $('#battle-sound').querySelector('.label-full').textContent = sound ? 'Sound on' : 'Sound off';
  $('#sound-glyph').innerHTML = glyph(sound ? 'sound' : 'mute', 16);

  runFight(
    { A: placedTeam(), B: enemyTeam() },
    {
      seed: session.seed,
      onInit: (init) => {
        session.seed = init.seed;
        if (!renderer) renderer = new CanvasRenderer($('#arena'), init);
        else renderer.setInit(init);
        setSpeed(speed); // carry the player's choice into the new fight
        startLoop();
      },
      onSnapshot: (snap) => {
        latest = snap;
        if (renderer) renderer.ingest(snap);
        // The track moves on every death, not on a timer.
        setScore(snap.score.A, snap.score.B, snap.time);
      },
    }
  ).then((summary) => {
    finished = true;
    // score.A / score.B are live survivor counts, so the enemies you killed is
    // simply what you started against minus what is still standing.
    const enemySurvivors = latest?.score?.B ?? 0;
    // Who actually walked out. The Endless Descent carries this roster into the
    // next chamber — "one life" means the bodies you lost stay lost.
    const survivingRoster = {};
    for (const a of latest?.agents ?? []) {
      if (a.team === 'A') survivingRoster[a.speciesId] = (survivingRoster[a.speciesId] || 0) + 1;
    }
    session.summary = {
      ...summary,
      survivors: latest?.score?.A ?? 0,
      enemiesSlain: Math.max(0, enemyCount() - enemySurvivors),
      survivingRoster,
    };

    if (skipRequested) {
      toResult();
      return;
    }
    // Hold the frozen final frame for 600ms, then fade the veil in over 450ms,
    // then let it sit before the verdict screen takes over.
    const hold = reduced() ? 0 : 600;
    setTimeout(() => {
      veil(summary);
      setTimeout(toResult, reduced() ? 400 : 1400);
    }, hold);
  });
}

function enemyCount() {
  return enemyTeam().reduce((n, e) => n + e.count, 0);
}

export function leave() {
  stopLoop();
}
