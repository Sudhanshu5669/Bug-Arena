// Colony Gladiator — the app shell.
//
// Boot, the title screen, and routing between the four things you can do:
//
//   Campaign      30 hand-designed levels. The ONLY place species are acquired.
//   Battle Maker  arrange both armies yourself and watch them go.
//   Descent       the endless roguelite run.
//   Hatchery      spend royal jelly on what the campaign never grants.
//
// It holds no rules. What a unit costs, what a level fields, what a win pays and
// what you own all live in game/*.js; the simulation lives in engine/*.js. This
// file shows that state and turns taps into calls on it.

import './species/index.js'; // side-effect: every species self-registers
import { getCatalog, getSpecies, hasSpecies } from './species/registry.js';
import { buildLevels, LEVEL_COUNT } from './game/levels.js';
import { Progress } from './game/progress.js';
import * as store from './game/save.js';

import { $, show, setNum, thumbUrl, toast } from './ui.js';
import { portal } from './portal.js';
import { audio, initBattle, abortBattle, syncSoundButton } from './battle.js';
import { DeployScreen } from './deployScreen.js';
import { CampaignScreen } from './campaignScreen.js';
import { MakerScreen } from './makerScreen.js';
import { HatcheryScreen } from './hatcheryScreen.js';
import { DescentScreen } from './descentScreen.js';

const catalog = getCatalog();
const levels = buildLevels((id) => (hasSpecies(id) ? getSpecies(id) : null));

// Everything below is built by boot(), NOT at module load.
//
// The reason is storage: the portal's save store only exists once its SDK
// handshake has resolved, and progress has to be read from the right backend the
// first time or a returning player is shown an empty campaign and then has it
// silently overwritten. So the save is loaded after portal.init(), and the
// screens — every one of which closes over `progress` — are constructed after
// that.
let saved = null;
let progress = null;
let deploy = null;
let campaign = null;
let maker = null;
let hatchery = null;
let descent = null;

function persist() {
  saved.campaign = progress.toJSON();
  store.save(saved);
}

function buildScreens() {
  deploy = new DeployScreen({ catalog });
  campaign = new CampaignScreen({ catalog, progress, deploy, persist, onHome: () => goHome() });
  maker = new MakerScreen({ catalog, progress, deploy, onHome: () => goHome() });
  hatchery = new HatcheryScreen({ catalog, progress, persist, onHome: () => goHome() });
  descent = new DescentScreen({ catalog, progress, saved, persist, onHome: () => goHome() });
}

// --- title -------------------------------------------------------------------

/**
 * Scatter a few specimens behind the wordmark.
 *
 * The 44 sprites are the most valuable thing in this build and the title screen
 * was the one place showing none of them — a portal visitor decided what this
 * game was from a page of text. Purely decorative: no pointer events, and it is
 * skipped entirely under reduced-motion.
 */
function paintSwarm() {
  const host = $('title-swarm');
  if (!host || host.childElementCount) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  // Bugs, not ants — the big silhouettes read at 14% opacity where an ant does not.
  const pool = catalog.filter((s) => s.tier === 'champion' && thumbUrl(s));
  const picks = pool.sort(() => Math.random() - 0.5).slice(0, 7);

  host.innerHTML = picks
    .map((sp, i) => {
      const size = 86 + Math.round(Math.random() * 92);
      const top = 4 + Math.round(Math.random() * 82);
      const left = i % 2 === 0 ? Math.round(Math.random() * 22) : 74 + Math.round(Math.random() * 22);
      const spin = Math.round(Math.random() * 360);
      return `<img src="${thumbUrl(sp)}" alt="" width="${size}" height="${size}"
        style="top:${top}%;left:${left}%;width:${size}px;height:${size}px;
               animation-delay:-${i * 3.4}s;transform:rotate(${spin}deg)" />`;
    })
    .join('');
}

function renderTitle() {
  const owned = progress.owned.size;
  const next = progress.nextLevel;

  paintSwarm();

  $('title-rank').textContent = progress.rank;
  setNum($('title-progress'), `${progress.clearedCount}/${LEVEL_COUNT}`);
  setNum($('title-species'), `${owned}/${catalog.length}`);
  setNum($('title-coins'), progress.coins);

  // The campaign button always says what it will actually do, so the primary
  // action on the title screen is never a guess.
  const campBtn = $('btn-campaign');
  campBtn.innerHTML = next
    ? `<b>Campaign</b><small>Level ${next.index} · ${next.name}</small>`
    : '<b>Campaign</b><small>All 30 chambers cleared</small>';

  // The maker is the campaign's payoff. Saying so — with the count — is what
  // makes an early unlock feel like it was for something.
  $('btn-maker').innerHTML = `<b>Battle Maker</b><small>${owned} specimen${owned === 1 ? '' : 's'} acquired</small>`;
  $('btn-hatchery').innerHTML = `<b>Hatchery</b><small>${progress.coins} royal jelly</small>`;
  $('btn-descent').innerHTML = descent.canResume
    ? '<b>Endless Descent</b><small>Run in progress — resume</small>'
    : '<b>Endless Descent</b><small>Fifteen chambers, one life</small>';

  $('title-warn').hidden = store.isPersistent();
  show('title');
}

function goHome() {
  abortBattle();
  deploy.destroy();
  renderTitle();
}

// --- wiring ------------------------------------------------------------------

function wire() {
  $('btn-campaign').addEventListener('click', () => campaign.openSelect());
  $('btn-maker').addEventListener('click', () => maker.open());
  $('btn-hatchery').addEventListener('click', () => hatchery.open());
  $('btn-descent').addEventListener('click', () => {
    if (descent.canResume) descent.resume();
    else descent.newRun(0);
  });

  // How to play. A portal player has about ten seconds of patience, so this is a
  // sheet with four lines on it, shown on request — never a gate in front of the
  // game. First-timers get it opened for them once (see boot()).
  const howto = $('howto');
  $('btn-howto').addEventListener('click', () => {
    howto.hidden = false;
  });
  $('btn-howto-close').addEventListener('click', () => {
    howto.hidden = true;
  });
  howto.addEventListener('click', (ev) => {
    if (ev.target === howto) howto.hidden = true;
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !howto.hidden) howto.hidden = true;
  });

  for (const el of document.querySelectorAll('[data-home]')) {
    el.addEventListener('click', () => goHome());
  }
}

// --- boot --------------------------------------------------------------------

/**
 * Wrap a promise in a deadline.
 *
 * Used for the portal SDK handshake, which sits on the critical path in front of
 * the title screen. `portal.init()` catches anything the SDK THROWS, but a
 * promise that simply never settles — a blocked request, an ad blocker eating
 * the script, a slow portal — would leave the player staring at the loading bar
 * with a fully working game behind it. Better to give up on the SDK than on the
 * game.
 */
function withDeadline(promise, ms, label) {
  return Promise.race([
    Promise.resolve(promise).catch(() => false),
    new Promise((resolve) =>
      setTimeout(() => {
        console.warn(`[boot] ${label} did not settle in ${ms}ms — continuing without it.`);
        resolve(false);
      }, ms)
    ),
  ]);
}

async function boot() {
  const bar = $('boot-bar');
  bar.style.width = '20%';

  await withDeadline(portal.init(), 3000, 'portal.init');
  // Prefer the portal's own save store: it syncs a signed-in player's progress
  // across their devices, and it is the only storage that works inside the
  // cross-origin iframe a portal serves the game from.
  store.useBackend(portal.storage());
  bar.style.width = '45%';

  saved = store.load();
  progress = new Progress(saved.campaign, levels, catalog);
  buildScreens();

  initBattle(catalog);
  // Silence the arena for the duration of any ad, as the portal requires.
  portal.setAudioGate({
    mute: () => audio.setAdMuted(true),
    unmute: () => audio.setAdMuted(false),
  });
  // ...and honour the portal's own mute switch, which outranks the sound button.
  portal.setMuteSetting((muted) => {
    audio.setPortalMuted(muted);
    syncSoundButton();
  });
  wire();
  renderTitle();
  bar.style.width = '100%';

  // Lift the gate on a timer, not on requestAnimationFrame: rAF is throttled to
  // a standstill in a background tab, which left the loading screen up until the
  // player switched back to it — exactly the wrong first impression.
  setTimeout(() => {
    $('boot').classList.add('gone');
    portal.loadingDone();
  }, 200);

  if (!store.isPersistent()) {
    toast('Storage is blocked here — progress will not survive a reload.', 4200);
  }

  // Brand-new player: open the how-to once, unprompted. Someone who has cleared
  // anything already knows the loop and does not need it in the way.
  if (progress.clearedCount === 0 && !saved.meta?.seenHowto) {
    saved.meta = { ...saved.meta, seenHowto: true };
    persist();
    setTimeout(() => {
      $('howto').hidden = false;
    }, 700);
  }
}

boot();
