// Dev-only: prove the CrazyGames SDK integration against a STUB SDK.
//
//   node tools/sdkCheck.js
//   SMOKE_BASE=http://localhost:4000/games/colony-gladiator/ node tools/sdkCheck.js
//
// tools/smoke.js deliberately blocks the real SDK so it can test the plain
// localStorage path deterministically. That leaves the portal path — the half
// that only ever runs on someone else's site, where a mistake is expensive and
// invisible from here — untested. This fills that gap: it installs a fake
// `window.CrazyGames.SDK` before the page boots, walks the game, and checks that
// the game actually did what the portal requires of it.
//
// Every claim in docs/SUBMISSION.md §5 that can be checked without a real portal
// is checked here, and every box ticked on the submission form is backed by one
// of these assertions.

import puppeteer from 'puppeteer-core';

const BASE = process.env.SMOKE_BASE || 'http://localhost:3000';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

async function findChrome() {
  const fs = await import('fs/promises');
  for (const p of CHROME) {
    try {
      await fs.access(p);
      return p;
    } catch {
      /* next */
    }
  }
  throw new Error('no Chrome found — set CHROME_PATH');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The stub, installed before any of the game's own script runs.
 *
 * It records every call so the test can assert on the ORDER and the presence of
 * the lifecycle events, and it keeps its data module in a plain object — which
 * is what proves the save went to the portal rather than to localStorage.
 */
function installStub() {
  const calls = [];
  const store = Object.create(null);
  const listeners = [];

  // Data-module traffic is recorded separately from the game/lifecycle calls:
  // the portal panel counts Set/Get/Remove Item as three of its nine checks.
  const dataOps = [];

  window.__sdk = {
    calls,
    store,
    listeners,
    dataOps,
    settings: { muteAudio: false, disableChat: false },
    /** Push a settings change the way the portal does. */
    change(patch) {
      Object.assign(window.__sdk.settings, patch);
      listeners.forEach((fn) => fn(window.__sdk.settings));
    },
  };

  const log = (name) => calls.push(name);

  window.CrazyGames = {
    SDK: {
      environment: 'crazygames',
      init: async () => log('init'),
      game: {
        get settings() {
          return window.__sdk.settings;
        },
        addSettingsChangeListener: (fn) => {
          log('addSettingsChangeListener');
          listeners.push(fn);
        },
        removeSettingsChangeListener: (fn) => {
          const i = listeners.indexOf(fn);
          if (i >= 0) listeners.splice(i, 1);
        },
        loadingStart: () => log('loadingStart'),
        loadingStop: () => log('loadingStop'),
        gameplayStart: () => log('gameplayStart'),
        gameplayStop: () => log('gameplayStop'),
        happytime: () => log('happytime'),
      },
      data: {
        getItem: (k) => {
          dataOps.push(`get:${k}`);
          return k in store ? store[k] : null;
        },
        setItem: (k, v) => {
          dataOps.push(`set:${k}`);
          store[k] = String(v);
        },
        removeItem: (k) => {
          dataOps.push(`remove:${k}`);
          delete store[k];
        },
      },
      ad: {
        // Ads are driven by the test itself, not by the game booting.
        requestAd: (type, cb) => {
          log(`requestAd:${type}`);
          window.__sdk.adCallbacks = cb;
        },
      },
    },
  };
}

async function run() {
  const problems = [];
  const note = (m) => problems.push(m);

  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || (await findChrome()),
    headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    page.on('pageerror', (e) => note(`uncaught: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') note(`console.error: ${m.text()}`);
    });

    await page.evaluateOnNewDocument(installStub);

    // The real SDK would land on top of the stub. Answered with an empty script
    // rather than aborted, which would log a console error of its own.
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (/sdk\.crazygames\.com/.test(req.url())) {
        req.respond({ status: 200, contentType: 'application/javascript', body: '' }).catch(() => {});
      } else {
        req.continue().catch(() => {});
      }
    });

    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('#boot.gone', { timeout: 15000 }).catch(() => note('boot gate never lifted'));

    // --- lifecycle -----------------------------------------------------------
    const calls = await page.evaluate(() => window.__sdk.calls.slice());
    for (const required of ['init', 'loadingStart', 'loadingStop', 'addSettingsChangeListener']) {
      if (!calls.includes(required)) note(`SDK.${required} was never called`);
    }
    if (calls.indexOf('init') !== 0) note(`init was not the first SDK call (got ${calls[0]})`);
    if (calls.indexOf('loadingStop') < calls.indexOf('loadingStart')) {
      note('loadingStop fired before loadingStart');
    }

    // --- the portal's data module is the save backend ------------------------
    const backend = await page.evaluate(async () => {
      const save = await import('./game/save.js');
      return { kind: save.backendKind(), persistent: save.isPersistent() };
    });
    if (backend.kind !== 'portal') {
      note(`save backend is "${backend.kind}", expected "portal" — progress would not sync across devices`);
    }
    if (!backend.persistent) note('save reported itself non-persistent with a working portal store');

    // A write must land in the PORTAL's store, not in localStorage.
    await page.evaluate(async () => {
      const save = await import('./game/save.js');
      const state = save.load();
      state.campaign.coins = 12345;
      save.save(state);
    });
    const written = await page.evaluate(() => {
      const raw = window.__sdk.store['colony-gladiator/v1'];
      let coins = null;
      try {
        coins = JSON.parse(raw)?.campaign?.coins;
      } catch {
        /* reported below */
      }
      return { coins, inLocalStorage: window.localStorage.getItem('colony-gladiator/v1') };
    });
    if (written.coins !== 12345) note(`save did not reach the portal store (read back ${written.coins})`);
    if (written.inLocalStorage !== null) note('save was also written to localStorage while the portal store was live');

    // --- muteAudio -----------------------------------------------------------
    // The portal's own mute. It must silence the game, must outrank the player's
    // sound button, and must survive the audio context being created later.
    const mute = await page.evaluate(async () => {
      const { audio } = await import('./battle.js');
      const read = () => ({ portalMuted: audio.portalMuted, gain: audio.master ? audio.master.gain.value : null });

      window.__sdk.change({ muteAudio: true });
      audio.resume(); // the first "user gesture", i.e. the context is built HERE
      const muted = read();

      audio.setMuted(false); // the player tries to turn the sound back on
      const overridden = read();

      window.__sdk.change({ muteAudio: false });
      const released = read();

      return { muted, overridden, released, label: document.getElementById('btn-sound')?.textContent };
    });
    if (mute.muted.portalMuted !== true) note('muteAudio=true did not reach the game');
    if (mute.muted.gain !== 0) note(`muteAudio=true left the master gain at ${mute.muted.gain}`);
    if (mute.overridden.gain !== 0) note('the in-game sound button overrode the portal mute');
    if (!(mute.released.gain > 0)) note(`muteAudio=false did not restore sound (gain ${mute.released.gain})`);

    // --- gameplayStart / gameplayStop bracket the FIGHT ----------------------
    const before = await page.evaluate(() => window.__sdk.calls.filter((c) => c.startsWith('gameplay')).length);
    if (before !== 0) note('gameplay events fired before any battle started');

    const click = async (id, wait = 300) => {
      await page.evaluate((i) => document.getElementById(i)?.click(), id);
      await sleep(wait);
    };
    await click('btn-campaign', 500);
    await click('btn-camp-continue', 600);
    for (let i = 0; i < 6; i++) {
      const added = await page.evaluate(() => {
        const b = document.querySelector('#deploy-tray .tcard button[data-act="add"]:not([disabled])');
        if (!b) return false;
        b.click();
        return true;
      });
      if (!added) break;
      await sleep(30);
    }
    await click('btn-deploy-fight', 700);
    const during = await page.evaluate(() => window.__sdk.calls.filter((c) => c.startsWith('gameplay')));
    if (during[0] !== 'gameplayStart') note(`starting a battle logged ${JSON.stringify(during)}, expected gameplayStart`);
    if (during.includes('gameplayStop')) note('gameplayStop fired while the battle was still running');

    await click('btn-skip', 2800);
    const after = await page.evaluate(() => window.__sdk.calls.filter((c) => c.startsWith('gameplay')));
    if (!after.includes('gameplayStop')) note('the battle ended without gameplayStop');

    // --- the portal's own QA panel -------------------------------------------
    // The developer portal lists nine events and ticks only the ones it OBSERVES
    // while someone plays. Anything a reviewer cannot reach in their first few
    // minutes reads as "not implemented" no matter how correct the code is —
    // which is what happytime did when it was reserved for a warlord chamber
    // five levels in. Everything here must be reachable from boot + one level.
    const panel = await page.evaluate(() => ({
      calls: window.__sdk.calls.slice(),
      data: window.__sdk.dataOps ?? [],
    }));
    const REQUIRED = {
      'Loading Start': (c) => c.includes('loadingStart'),
      'Loading Stop': (c) => c.includes('loadingStop'),
      'Mute audio support': (c) => c.includes('addSettingsChangeListener'),
      'Gameplay Start': (c) => c.includes('gameplayStart'),
      'Gameplay Stop': (c) => c.includes('gameplayStop'),
      Happytime: (c) => c.includes('happytime'),
      'Set Item': (_c, d) => d.some((o) => o.startsWith('set')),
      'Get Item': (_c, d) => d.some((o) => o.startsWith('get')),
      'Remove Item': (_c, d) => d.some((o) => o.startsWith('remove')),
    };
    for (const [label, test] of Object.entries(REQUIRED)) {
      if (!test(panel.calls, panel.data)) {
        note(`"${label}" never fired in a first session — the portal's QA panel will show it as missing`);
      }
    }
  } finally {
    await browser.close();
  }

  if (problems.length) {
    console.log(`  ✗ SDK check — ${problems.length} problem(s)`);
    for (const p of problems) console.log(`    ✗ ${p}`);
    console.log('  SDK CHECK FAILED');
    process.exit(1);
  }
  console.log(
    '  ✓ SDK check — lifecycle, portal save store, muteAudio and gameplay brackets all correct,\n' +
      '    and all nine events on the portal QA panel fire within boot + one level.'
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
