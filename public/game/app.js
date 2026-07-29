// Colony Gladiator — bootstrap.
//
// Boot order: paint the gate, fetch the species catalog, derive the roster and
// economy from it, restore the save, wire every screen, then fade the gate out.
// Nothing in the game invents a specimen — the catalog is the source of truth.

import { $, $$, go, registerScreen, toast } from './ui.js';
import { buildRoster, startingSpecimens, glyph } from './data.js';
import { fetchCatalog, connect, on } from './net.js';
import { setRoster, session } from './session.js';
import * as state from './state.js';

import * as title from './screens/title.js';
import * as campaign from './screens/campaign.js';
import * as deploy from './screens/deploy.js';
import * as battle from './screens/battle.js';
import * as result from './screens/result.js';
import * as hatchery from './screens/hatchery.js';
import * as draft from './screens/draft.js';
import * as beat from './screens/beat.js';

const bootBar = $('#boot-bar > i');
const setBoot = (pct) => {
  if (bootBar) bootBar.style.width = `${pct}%`;
};

async function main() {
  setBoot(20);

  let catalog;
  try {
    catalog = await fetchCatalog();
  } catch (err) {
    // The game is unplayable without the registry — say so plainly rather than
    // booting into an empty drawer.
    $('#boot').innerHTML =
      '<div class="mark">Colony<br><span class="lit">Gladiator</span></div>' +
      '<div style="color:var(--danger);font-size:13px;max-width:34ch;text-align:center">' +
      'The formicarium is unreachable. Start the server with <code>npm start</code> and reload.</div>';
    console.error('[boot] catalog fetch failed', err);
    return;
  }
  setBoot(55);

  const roster = buildRoster(catalog);
  setRoster(roster);
  state.load(startingSpecimens(roster));

  registerScreen('title', title);
  registerScreen('campaign', campaign);
  registerScreen('deploy', deploy);
  registerScreen('battle', battle);
  registerScreen('result', result);
  registerScreen('hatchery', hatchery);
  registerScreen('draft', draft);
  registerScreen('beat', beat);

  title.init();
  campaign.init();
  deploy.init();
  battle.init();
  hatchery.init();
  draft.init();

  // Every screen's back button walks one step out; there is no deep stack to
  // manage because every route has exactly one sensible parent.
  const PARENT = {
    campaign: 'title',
    deploy: () => (session.mode === 'descent' ? 'draft' : session.mode === 'maker' ? 'title' : 'campaign'),
    hatchery: 'title',
    draft: 'title',
  };
  $$('[data-back]').forEach((btn) => {
    btn.innerHTML = glyph('back', 16);
    const screen = btn.closest('.screen').id.replace('screen-', '');
    btn.addEventListener('click', () => {
      const parent = PARENT[screen];
      go(typeof parent === 'function' ? parent() : parent);
    });
  });

  connect();
  on('status', (s) => {
    if (s === 'disconnected') toast('Lost the formicarium — reconnecting…');
  });

  setBoot(100);
  go('title');

  if (new URLSearchParams(location.search).has('debug')) showLayoutReadout();

  // Fade the gate out over 220ms, then take it out of the tree entirely.
  const gate = $('#boot');
  setTimeout(() => {
    gate.classList.add('gone');
    setTimeout(() => gate.remove(), 260);
  }, 220);
}

/**
 * `?debug` — a live readout of how the app shell is measuring against the
 * viewport. Answers the one question a screenshot cannot: whether dark space
 * below the game is the page failing to cover the viewport, or simply the
 * browser window not filling the screen.
 */
function showLayoutReadout() {
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;left:8px;bottom:8px;z-index:200;padding:8px 10px;border-radius:6px;' +
    'background:rgba(0,0,0,.82);border:1px solid #584330;color:#efe6d6;' +
    'font:600 11px/1.6 ui-monospace,Menlo,monospace;white-space:pre;pointer-events:none';
  document.body.appendChild(box);

  const update = () => {
    const app = document.getElementById('app');
    const r = app.getBoundingClientRect();
    // If appBottom === innerHeight the shell covers the viewport and any dark
    // space below is outside the browser window, not the page's doing.
    const covers = Math.abs(r.bottom - window.innerHeight) < 1 && r.top < 1;
    box.textContent = [
      `viewport   ${window.innerWidth} x ${window.innerHeight}`,
      `#app       ${Math.round(r.width)} x ${Math.round(r.height)}  top ${Math.round(r.top)} bottom ${Math.round(r.bottom)}`,
      `covers     ${covers ? 'YES — shell fills the viewport' : 'NO — shell is short'}`,
      `docScroll  ${document.documentElement.scrollHeight} (body ${document.body.scrollHeight})`,
      `dpr ${window.devicePixelRatio}   dvh ${CSS.supports('height', '100dvh')}   zoom ~${Math.round((window.outerWidth / window.innerWidth) * 100) / 100}`,
      `layout     ${document.documentElement.className || '(portrait)'}`,
    ].join('\n');
  };
  update();
  window.addEventListener('resize', update);
  window.addEventListener('cg:layout', update);
}

main();
