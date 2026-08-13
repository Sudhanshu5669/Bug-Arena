// Dev-only screenshot harness. Drives a local Chrome through the real game so a
// change to the visuals can be looked at instead of guessed at.
//
//   node tools/shots.js                 # every shot, desktop + phone
//   node tools/shots.js title deploy    # only the named shots
//
// Not part of the build and not shipped. puppeteer-core is a devDependency and
// uses the Chrome already installed on the machine.

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', '.shots');
const BASE = process.env.SHOT_BASE || 'http://localhost:3000';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

async function findChrome() {
  for (const p of CHROME) {
    try {
      await fs.access(p);
      return p;
    } catch {
      /* try the next one */
    }
  }
  throw new Error('no Chrome found — set CHROME_PATH');
}

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  land: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

/** Seed a save so screens that need progress have something to show. */
const SEED_PROGRESS = {
  version: 1,
  run: null,
  campaign: {
    coins: 340,
    cleared: { 1: { stars: 3, plays: 1 }, 2: { stars: 2, plays: 1 }, 3: { stars: 3, plays: 2 }, 4: { stars: 1, plays: 3 }, 5: { stars: 2, plays: 1 }, 6: { stars: 3, plays: 1 }, 7: { stars: 1, plays: 1 } },
    bought: ['thiefAnt', 'suicideAnt'],
    granted: ['armyAnt', 'bulletAnt', 'leafcutterAnt', 'scorpion', 'carpenterAnt', 'trapjawAnt', 'jewelWasp'],
    totalKills: 214,
    battlesWon: 7,
  },
  meta: { unlocked: [], bestDepth: 4, runsWon: 0, runsPlayed: 2, ascension: 0, totalKills: 214, seenHowto: true },
};

// Each shot: navigate fresh, then run `go` in the page to reach the screen.
const SHOTS = {
  title: { go: () => {} },
  campaign: { go: () => document.getElementById('btn-campaign').click() },
  deploy: {
    go: async () => {
      document.getElementById('btn-campaign').click();
      await new Promise((r) => setTimeout(r, 120));
      document.getElementById('btn-camp-continue').click();
    },
  },
  hatchery: { go: () => document.getElementById('btn-hatchery').click() },
  maker: {
    go: async () => {
      document.getElementById('btn-maker').click();
      await new Promise((r) => setTimeout(r, 300));
      for (let i = 0; i < 8; i++) {
        document.querySelector('#deploy-tray .tcard button[data-act="add"]:not([disabled])')?.click();
        await new Promise((r) => setTimeout(r, 30));
      }
      document.querySelector('#deploy-teams button[data-team="B"]').click();
      await new Promise((r) => setTimeout(r, 120));
      for (let i = 0; i < 6; i++) {
        document.querySelector('#deploy-tray .tcard button[data-act="add"]:not([disabled])')?.click();
        await new Promise((r) => setTimeout(r, 30));
      }
    },
    settle: 600,
  },
  descentreward: {
    go: async () => {
      document.getElementById('btn-descent').click();
      await new Promise((r) => setTimeout(r, 300));
      for (let i = 0; i < 10; i++) {
        document.querySelector('#specimens button[data-act="buy"]:not([disabled])')?.click();
        await new Promise((r) => setTimeout(r, 30));
      }
      document.getElementById('btn-fight').click();
      await new Promise((r) => setTimeout(r, 500));
      document.getElementById('btn-skip').click();
    },
    settle: 3200,
  },
  loss: {
    go: async () => {
      document.getElementById('btn-campaign').click();
      await new Promise((r) => setTimeout(r, 200));
      document.getElementById('btn-camp-continue').click();
      await new Promise((r) => setTimeout(r, 300));
      // One lone worker against a whole chamber: a guaranteed defeat screen.
      document.querySelector('#deploy-tray .tcard button[data-act="add"]:not([disabled])')?.click();
      await new Promise((r) => setTimeout(r, 120));
      document.getElementById('btn-deploy-fight').click();
      await new Promise((r) => setTimeout(r, 400));
      document.getElementById('btn-skip').click();
    },
    settle: 3200,
  },
  draft: { go: () => document.getElementById('btn-descent').click() },
  battle: {
    go: async () => {
      document.getElementById('btn-campaign').click();
      await new Promise((r) => setTimeout(r, 120));
      document.getElementById('btn-camp-continue').click();
      await new Promise((r) => setTimeout(r, 200));
      for (let i = 0; i < 9; i++) {
        document.querySelector('.tcard [data-act="add"]:not([disabled])')?.click();
        await new Promise((r) => setTimeout(r, 30));
      }
      document.getElementById('btn-deploy-fight').click();
    },
    settle: 2600,
  },
  levelresult: {
    go: async () => {
      document.getElementById('btn-campaign').click();
      await new Promise((r) => setTimeout(r, 120));
      document.getElementById('btn-camp-continue').click();
      await new Promise((r) => setTimeout(r, 200));
      for (let i = 0; i < 12; i++) {
        document.querySelector('.tcard [data-act="add"]:not([disabled])')?.click();
        await new Promise((r) => setTimeout(r, 30));
      }
      document.getElementById('btn-deploy-fight').click();
      await new Promise((r) => setTimeout(r, 400));
      document.getElementById('btn-skip').click();
    },
    settle: 3000,
  },
};

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const names = only.length ? only : Object.keys(SHOTS);
  const sizes = process.env.SHOT_SIZE ? [process.env.SHOT_SIZE] : ['desktop', 'phone'];

  await fs.mkdir(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || (await findChrome()),
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb', '--hide-scrollbars'],
  });

  const errors = [];
  for (const size of sizes) {
    for (const name of names) {
      const shot = SHOTS[name];
      if (!shot) {
        console.warn(`  ? unknown shot "${name}"`);
        continue;
      }
      const page = await browser.newPage();
      page.on('pageerror', (e) => errors.push(`${name}/${size}: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`${name}/${size}: console ${m.text()}`);
      });
      await page.setViewport(VIEWPORTS[size]);

      // Seed storage before the app's first script runs.
      await page.evaluateOnNewDocument((seed) => {
        try {
          localStorage.setItem('colony-gladiator/v1', JSON.stringify(seed));
        } catch {
          /* storage blocked — the shot just shows the empty state */
        }
      }, SEED_PROGRESS);

      await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForSelector('#boot.gone', { timeout: 15000 }).catch(() => {});
      await page.evaluate(shot.go);
      await new Promise((r) => setTimeout(r, shot.settle ?? 700));

      const file = path.join(OUT, `${name}-${size}.png`);
      await page.screenshot({ path: file });
      console.log(`  ${path.relative(process.cwd(), file)}`);
      await page.close();
    }
  }

  await browser.close();
  if (errors.length) {
    console.log('\n  page errors:');
    for (const e of [...new Set(errors)]) console.log(`   ! ${e}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
