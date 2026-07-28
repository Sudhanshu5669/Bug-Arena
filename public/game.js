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

import { $, show, toast } from './ui.js';
import { portal } from './portal.js';
import { initBattle, abortBattle } from './battle.js';
import { DeployScreen } from './deployScreen.js';
import { CampaignScreen } from './campaignScreen.js';
import { MakerScreen } from './makerScreen.js';
import { HatcheryScreen } from './hatcheryScreen.js';
import { DescentScreen } from './descentScreen.js';

const catalog = getCatalog();
const levels = buildLevels((id) => (hasSpecies(id) ? getSpecies(id) : null));

let saved = store.load();
const progress = new Progress(saved.campaign, levels, catalog);

function persist() {
  saved.campaign = progress.toJSON();
  store.save(saved);
}

// --- screens -----------------------------------------------------------------

const deploy = new DeployScreen({ catalog });

const campaign = new CampaignScreen({
  catalog,
  progress,
  deploy,
  persist,
  onHome: () => goHome(),
});

const maker = new MakerScreen({ catalog, progress, deploy, onHome: () => goHome() });
const hatchery = new HatcheryScreen({ catalog, progress, persist, onHome: () => goHome() });
const descent = new DescentScreen({ catalog, progress, saved, persist, onHome: () => goHome() });

// --- title -------------------------------------------------------------------

function renderTitle() {
  const owned = progress.owned.size;
  const next = progress.nextLevel;

  $('title-rank').textContent = progress.rank;
  $('title-progress').textContent = `${progress.clearedCount}/${LEVEL_COUNT}`;
  $('title-species').textContent = `${owned}/${catalog.length}`;
  $('title-coins').textContent = progress.coins;

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

  $('title-warn').hidden = store.isPersistent;
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

  $('btn-sandbox').addEventListener('click', () => {
    // The sandbox is a separate page. Resolved against this module so it follows
    // the build onto a portal subpath instead of 404ing at the portal's root.
    window.location.href = new URL('./sandbox.html', import.meta.url).href;
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
  bar.style.width = '55%';

  initBattle(catalog);
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

  if (!store.isPersistent) {
    toast('Storage is blocked here — progress will not survive a reload.', 4200);
  }
}

boot();
