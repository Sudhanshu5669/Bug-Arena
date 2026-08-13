// Dev-only smoke test: walk the whole game in a real browser and fail on any
// console error, page exception, failed request or dead-end screen.
//
//   node tools/smoke.js                      # against the dev server
//   SMOKE_BASE=http://localhost:5000 node tools/smoke.js   # against a built dist/
//
// This is the gate before packaging for a portal. A reviewer plays for about two
// minutes and closes the tab on the first thing that looks broken, so the bar is
// "nothing in the console, every screen reachable, every primary button works" —
// not "the simulation is correct", which tools/campaignProbe.js already covers.

import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

/** The portal SDK is not served locally; its 404 is expected and not a failure. */
const IGNORE_REQUEST = /sdk\.crazygames\.com/;

const DEVICES = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

const SEED = {
  version: 1,
  run: null,
  campaign: {
    coins: 900,
    cleared: {
      1: { stars: 3, plays: 1 },
      2: { stars: 2, plays: 1 },
      3: { stars: 3, plays: 1 },
      4: { stars: 1, plays: 1 },
      5: { stars: 2, plays: 1 },
    },
    bought: [],
    granted: ['armyAnt', 'bulletAnt', 'leafcutterAnt', 'scorpion', 'carpenterAnt'],
    totalKills: 90,
    battlesWon: 5,
  },
  meta: { unlocked: [], bestDepth: 0, runsWon: 0, runsPlayed: 0, ascension: 0, totalKills: 90, seenHowto: true },
};

async function run(device) {
  const failures = [];
  const note = (msg) => failures.push(`[${device}] ${msg}`);

  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || (await findChrome()),
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport(DEVICES[device]);

  page.on('pageerror', (e) => note(`uncaught: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORE_REQUEST.test(m.text())) note(`console.error: ${m.text()}`);
  });
  page.on('requestfailed', (r) => {
    if (!IGNORE_REQUEST.test(r.url())) note(`request failed: ${r.url()}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !IGNORE_REQUEST.test(r.url())) note(`HTTP ${r.status()}: ${r.url()}`);
  });

  // Seed ONCE. This runs on every document, including the one created by the
  // reload at the end — and re-applying it there would overwrite the progress
  // the walk just made and then blame the game for losing it.
  await page.evaluateOnNewDocument((seed) => {
    try {
      if (localStorage.getItem('__smoke_seeded__')) return;
      localStorage.setItem('__smoke_seeded__', '1');
      localStorage.setItem('colony-gladiator/v1', JSON.stringify(seed));
    } catch {
      /* storage blocked — the walk still works, it just starts empty */
    }
  }, SEED);

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });

  const active = () => page.evaluate(() => document.querySelector('.screen.active')?.id ?? 'none');
  const click = async (id, wait = 260) => {
    const ok = await page.evaluate((i) => {
      const el = document.getElementById(i);
      if (!el || el.hidden || el.disabled) return false;
      el.click();
      return true;
    }, id);
    if (!ok) note(`could not click #${id}`);
    await sleep(wait);
    return ok;
  };
  const expect = async (id, where) => {
    const got = await active();
    if (got !== id) note(`${where}: expected ${id}, got ${got}`);
  };

  // --- boot ------------------------------------------------------------------
  await page.waitForSelector('#boot.gone', { timeout: 15000 }).catch(() => note('boot gate never lifted'));
  await expect('screen-title', 'after boot');

  // --- how to play -----------------------------------------------------------
  await click('btn-howto');
  if (await page.evaluate(() => document.getElementById('howto').hidden)) note('how-to sheet did not open');
  await click('btn-howto-close');

  // --- hatchery --------------------------------------------------------------
  await click('btn-hatchery');
  await expect('screen-hatchery', 'hatchery');
  const stock = await page.evaluate(() => document.querySelectorAll('#hatch-list .hatch-row').length);
  if (stock !== 12) note(`hatchery stocks ${stock} specimens, expected 12`);
  // Buy the cheapest thing on the shelf and check the purse actually moves.
  const before = await page.evaluate(() => Number(document.getElementById('hatch-coins').textContent));
  await page.evaluate(() => document.querySelector('#hatch-list button[data-act="buy"]:not([disabled])')?.click());
  await sleep(200);
  const after = await page.evaluate(() => Number(document.getElementById('hatch-coins').textContent));
  if (!(after < before)) note(`buying did not spend jelly (${before} -> ${after})`);
  await click('btn-hatch-back');

  // --- battle maker ----------------------------------------------------------
  await click('btn-maker');
  await expect('screen-deploy', 'battle maker');
  if (await page.evaluate(() => document.getElementById('deploy-teams').hidden)) {
    note('battle maker did not offer the team toggle');
  }
  await click('btn-deploy-back');

  // --- endless descent -------------------------------------------------------
  await click('btn-descent');
  await expect('screen-draft', 'descent draft');
  const cards = await page.evaluate(() => document.querySelectorAll('#specimens .specimen').length);
  if (cards < 2) note(`descent drawer showed ${cards} specimens`);
  await page.evaluate(() => document.querySelector('#specimens button[data-act="buy"]:not([disabled])')?.click());
  await sleep(160);
  if (await page.evaluate(() => document.getElementById('btn-fight').disabled)) note('descent fight button stayed disabled');
  await click('btn-abandon');

  // --- campaign: select -> deploy -> fight -> result -------------------------
  await click('btn-campaign');
  await expect('screen-campaign', 'campaign select');
  const levels = await page.evaluate(() => document.querySelectorAll('#camp-grid .lv').length);
  if (levels !== 30) note(`campaign grid rendered ${levels} levels, expected 30`);
  const chapters = await page.evaluate(() => document.querySelectorAll('#camp-grid .chapter').length);
  if (chapters !== 6) note(`campaign grid rendered ${chapters} chapters, expected 6`);

  await click('btn-camp-continue', 500);
  await expect('screen-deploy', 'campaign deploy');

  if (!(await page.evaluate(() => document.getElementById('btn-deploy-fight').disabled))) {
    note('fight button was enabled with an empty field');
  }

  // --- drag a specimen from the tray onto the sand ---------------------------
  // The primary interaction, and the one the +/- buttons hide when they are the
  // only thing a test presses. Driven through real pointer events so it exercises
  // the same path a thumb does.
  {
    const boxes = await page.evaluate(() => {
      const card = document.querySelector('#deploy-tray .tcard');
      const canvas = document.getElementById('deploy-canvas');
      if (!card || !canvas) return null;
      const c = card.getBoundingClientRect();
      const v = canvas.getBoundingClientRect();
      return {
        from: { x: c.left + c.width / 2, y: c.top + c.height / 2 },
        // Well inside the left-hand deploy zone (the player's own half).
        to: { x: v.left + v.width * 0.2, y: v.top + v.height * 0.5 },
      };
    });
    if (!boxes) note('could not locate the tray card or the sand');
    else {
      await page.mouse.move(boxes.from.x, boxes.from.y);
      await page.mouse.down();
      // Several steps: a press that never moves is a TAP, which arms the card
      // instead of placing a unit.
      for (let i = 1; i <= 6; i++) {
        await page.mouse.move(
          boxes.from.x + ((boxes.to.x - boxes.from.x) * i) / 6,
          boxes.from.y + ((boxes.to.y - boxes.from.y) * i) / 6
        );
        await sleep(20);
      }
      await page.mouse.up();
      await sleep(200);
      const afterDrag = await page.evaluate(() => document.getElementById('deploy-cap').textContent);
      if (afterDrag.startsWith('0')) note('dragging a specimen onto the sand placed nothing');
    }
  }

  // Fill the field through the tray's + buttons, exactly as a player would.
  for (let i = 0; i < 14; i++) {
    const added = await page.evaluate(() => {
      const b = document.querySelector('#deploy-tray .tcard button[data-act="add"]:not([disabled])');
      if (!b) return false;
      b.click();
      return true;
    });
    if (!added) break;
    await sleep(30);
  }
  const placed = await page.evaluate(() => document.getElementById('deploy-cap').textContent);
  if (placed.startsWith('0')) note('no units could be placed from the tray');
  if (await page.evaluate(() => document.getElementById('btn-deploy-fight').disabled)) {
    note('fight button stayed disabled with units on the sand');
  }

  await click('btn-deploy-fight', 700);
  await expect('screen-battle', 'battle');
  await click('btn-skip', 2600);
  await expect('screen-levelresult', 'level result');

  const tally = await page.evaluate(() => document.querySelectorAll('#lr-tally div').length);
  if (tally < 3) note(`result tally rendered ${tally} stats`);
  const stars = await page.evaluate(() => document.querySelectorAll('#lr-stars i.on').length);
  const won = await page.evaluate(() => document.getElementById('lr-title').className === 'win');
  if (won && stars < 1) note('a win awarded zero stars');

  await click('btn-lr-select', 400);
  await expect('screen-campaign', 'back to level select');
  await click('btn-camp-back', 300);
  await expect('screen-title', 'back to title');

  // --- persistence -----------------------------------------------------------
  const coinsBefore = await page.evaluate(() => document.getElementById('title-coins').textContent);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('#boot.gone', { timeout: 15000 }).catch(() => {});
  const coinsAfter = await page.evaluate(() => document.getElementById('title-coins').textContent);
  if (coinsBefore !== coinsAfter) note(`progress did not survive a reload (${coinsBefore} -> ${coinsAfter})`);

  await browser.close();
  return failures;
}

const all = [];
for (const device of ['desktop', 'phone']) {
  const f = await run(device);
  console.log(`  ${f.length ? '✗' : '✓'} ${device}${f.length ? ` — ${f.length} problem(s)` : ''}`);
  all.push(...f);
}

if (all.length) {
  console.error('\n  SMOKE TEST FAILED\n');
  for (const f of [...new Set(all)]) console.error(`    ✗ ${f}`);
  console.error('');
  process.exit(1);
}
console.log('\n  ✓ smoke test passed — every screen reachable, console clean.\n');
