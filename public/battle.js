// The battle screen, as a service.
//
// Every mode — campaign level, battle maker, endless descent — hands this the
// same thing (an engine config) and gets back the same thing (a summary). It
// owns the engine instance, the renderer, the audio routing, the HUD and the
// speed/skip/sound controls, so no mode has to know that any of those exist.
//
// It deliberately owns the render loop too. The loop is started ONCE and never
// torn down: a `requestAnimationFrame` chain that gets rebuilt per battle is one
// stray exception away from stopping forever, and a dead render loop looks
// exactly like a hung game while the simulation carries on invisibly underneath.

import { CanvasRenderer } from './render/canvasRenderer.js';
import { ArenaAudio, ARENA_SFX } from './render/audio.js';
import { BugArenaEngine } from './engine/index.js';
import { $, show } from './ui.js';
import { portal } from './portal.js';

export const audio = new ArenaAudio({ volume: 0.55 });

let catalogById = new Map();
let renderer = null;
let engine = null;
let loopStarted = false;
let resolved = false;
let speed = 1;
let onFinish = null;

/** Called once at boot with the species catalog (for sfx lookup). */
export function initBattle(catalog) {
  catalogById = new Map(catalog.map((s) => [s.id, s]));
  wireControls();
}

/**
 * Run one battle on the battle screen.
 *
 * @param {object} config              - engine config
 * @param {object} opts
 * @param {string} opts.title          - shown in the HUD (level name / "Sandbox")
 * @param {(summary:object) => void} opts.onEnd
 */
export function startBattle(config, { title = '', onEnd = null } = {}) {
  resolved = false;
  onFinish = onEnd;

  show('battle');
  $('battle-veil').classList.remove('show');
  $('btn-skip').disabled = false;
  $('battle-title').textContent = title;
  $('battle-clock').textContent = '0.0s';

  engine = new BugArenaEngine(config);
  engine.setTimeScale(speed);

  const init = engine.getInitPayload();
  if (!renderer) renderer = new CanvasRenderer($('arena'), init, { format: 'wide', showreel: true });
  else renderer.setInit(init);

  engine.on('snapshot', onSnapshot);
  engine.on('end', onEnd_);

  if (!loopStarted) {
    loopStarted = true;
    let errors = 0;
    const loop = (t) => {
      // Unconditional reschedule: one bad frame must not end the render loop for
      // the rest of the session.
      requestAnimationFrame(loop);
      try {
        renderer?.render(t);
      } catch (err) {
        if (errors++ < 5) console.error('[render] frame failed:', err);
      }
    };
    requestAnimationFrame(loop);
  }

  // Bracket the ACTUAL fight, never the menus — this is what the portal reads to
  // decide when an ad would not be interrupting anything.
  portal.gameplayStart();
  engine.start();
}

function onSnapshot(snap) {
  renderer?.ingest(snap);
  const a = snap.score.A;
  const b = snap.score.B;
  $('score-a').textContent = a;
  $('score-b').textContent = b;
  $('score-track').style.width = `${(a / (a + b || 1)) * 100}%`;
  $('battle-clock').textContent = `${snap.time.toFixed(1)}s`;
  playSounds(snap.events);
}

function playSounds(events) {
  for (const ev of events) {
    switch (ev.type) {
      case 'attack': {
        const sfx = catalogById.get(ev.speciesId)?.sfx?.attack;
        if (sfx) audio.play(sfx, { gain: 0.5, key: `atk:${ev.speciesId}`, throttleMs: 90 });
        break;
      }
      case 'ability': {
        const sfx = catalogById.get(ev.casterSpecies)?.sfx?.ability;
        if (sfx) audio.play(sfx, { gain: 1, key: `ab:${ev.casterSpecies}`, throttleMs: 140 });
        break;
      }
      case 'death': {
        const sfx = catalogById.get(ev.victimSpecies)?.sfx?.death;
        if (sfx) audio.play(sfx, { gain: 0.85, key: `die:${ev.victimSpecies}`, throttleMs: 70 });
        break;
      }
      case 'battle_start':
        audio.play(ARENA_SFX.battleStart, { gain: 1, key: 'start', throttleMs: 1500 });
        break;
      case 'battle_over':
        audio.play(ev.winner === 'draw' ? ARENA_SFX.draw : ARENA_SFX.victory, { gain: 1, key: 'over', throttleMs: 1500 });
        break;
      default:
        break;
    }
  }
}

function onEnd_(summary) {
  if (resolved) return;
  resolved = true;
  portal.gameplayStop();

  const won = summary.winner === 'A';
  $('veil-title').textContent = won ? 'The colony holds' : 'The colony breaks';
  $('veil-title').style.color = won ? 'var(--good)' : 'var(--danger)';
  $('veil-sub').textContent = `${summary.totalKills} dead in ${summary.durationSeconds}s`;
  $('battle-veil').classList.add('show');
  $('btn-skip').disabled = true;

  // Let the renderer's replay + winner card play out before cutting away.
  setTimeout(() => onFinish?.(summary), 1900);
}

/** Jump to the outcome. The fight is deterministic, so nothing is lost by it. */
function skip() {
  if (!engine || resolved) return;
  $('btn-skip').disabled = true;
  engine.stop();
  onEnd_(engine.runToCompletion());
}

/** Abandon a battle in progress (used when a mode navigates away). */
export function abortBattle() {
  if (!engine) return;
  resolved = true;
  engine.stop();
  portal.gameplayStop();
}

function wireControls() {
  $('btn-speed').addEventListener('click', () => {
    speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
    engine?.setTimeScale(speed);
    $('btn-speed').textContent = `Speed ×${speed}`;
  });

  $('btn-sound').addEventListener('click', () => {
    audio.setMuted(!audio.muted);
    $('btn-sound').textContent = audio.muted ? 'Sound off' : 'Sound on';
  });

  $('btn-skip').addEventListener('click', skip);

  // A tab switch or an incoming call should pause the fight, not run it to
  // completion off-screen where the player never sees it happen.
  document.addEventListener('visibilitychange', () => {
    if (!engine || resolved) return;
    if (document.hidden) engine.stop();
    else engine.start();
  });
}
