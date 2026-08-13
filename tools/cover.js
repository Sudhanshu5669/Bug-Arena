// Render the store artwork the CrazyGames portal asks for, from the real game.
//
//   npm run cover        # writes release/art/*.png
//
// Portals want a 16:9 cover, a square icon and a handful of gameplay
// screenshots. Generating them from the running build rather than mocking them
// up means the store page can never promise something the game does not show —
// and it costs nothing to regenerate after a visual change.
//
// Sizes follow the portal's published guidance:
//   cover        1920x1080  (16:9 landscape, used as the main thumbnail)
//   icon          512x512   (square)
//   screenshot-N 1920x1080  (gameplay)

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'release', 'art');
const BASE = process.env.COVER_BASE || 'http://localhost:3000';

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
      /* next */
    }
  }
  throw new Error('no Chrome found — set CHROME_PATH');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A mid-campaign save, so the art shows a game with something going on in it. */
const SEED = {
  version: 1,
  run: null,
  campaign: {
    coins: 640,
    cleared: Object.fromEntries(
      Array.from({ length: 14 }, (_, i) => [i + 1, { stars: [3, 2, 3, 3, 2, 3, 1, 3, 2, 3, 3, 2, 3, 2][i], plays: 1 }])
    ),
    bought: ['bombardier', 'dragonfly'],
    granted: [
      'armyAnt', 'bulletAnt', 'leafcutterAnt', 'scorpion', 'carpenterAnt', 'trapjawAnt',
      'jewelWasp', 'harvesterAnt', 'honeypotAnt', 'spider', 'crazyAnt', 'hornet',
      'bulldogAnt', 'turtleAnt',
    ],
    totalKills: 612,
    battlesWon: 14,
  },
  meta: { unlocked: [], bestDepth: 7, runsWon: 1, runsPlayed: 3, ascension: 0, totalKills: 612, seenHowto: true },
};

const SHOTS = [
  {
    name: 'cover',
    w: 1920,
    h: 1080,
    go: () => {},
    settle: 1400, // let the title swarm drift into a pleasant arrangement
  },
  {
    name: 'screenshot-1-deploy',
    w: 1920,
    h: 1080,
    go: async () => {
      document.getElementById('btn-campaign').click();
      await new Promise((r) => setTimeout(r, 200));
      document.getElementById('btn-camp-continue').click();
      await new Promise((r) => setTimeout(r, 400));
      for (let i = 0; i < 16; i++) {
        document.querySelector('#deploy-tray .tcard button[data-act="add"]:not([disabled])')?.click();
        await new Promise((r) => setTimeout(r, 30));
      }
    },
    settle: 700,
  },
  {
    name: 'screenshot-2-battle',
    w: 1920,
    h: 1080,
    go: async () => {
      document.getElementById('btn-campaign').click();
      await new Promise((r) => setTimeout(r, 200));
      document.getElementById('btn-camp-continue').click();
      await new Promise((r) => setTimeout(r, 400));
      for (let i = 0; i < 16; i++) {
        document.querySelector('#deploy-tray .tcard button[data-act="add"]:not([disabled])')?.click();
        await new Promise((r) => setTimeout(r, 30));
      }
      document.getElementById('btn-deploy-fight').click();
    },
    settle: 3200,
  },
  {
    name: 'screenshot-3-campaign',
    w: 1920,
    h: 1080,
    go: () => document.getElementById('btn-campaign').click(),
    settle: 700,
  },
  {
    name: 'screenshot-4-drawer',
    w: 1920,
    h: 1080,
    go: () => document.getElementById('btn-descent').click(),
    settle: 800,
  },
  {
    name: 'screenshot-5-phone',
    w: 390,
    h: 844,
    scale: 3,
    go: async () => {
      document.getElementById('btn-campaign').click();
      await new Promise((r) => setTimeout(r, 200));
      document.getElementById('btn-camp-continue').click();
      await new Promise((r) => setTimeout(r, 400));
      for (let i = 0; i < 10; i++) {
        document.querySelector('#deploy-tray .tcard button[data-act="add"]:not([disabled])')?.click();
        await new Promise((r) => setTimeout(r, 30));
      }
    },
    settle: 700,
  },
];

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || (await findChrome()),
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb', '--hide-scrollbars'],
  });

  for (const shot of SHOTS) {
    const page = await browser.newPage();
    await page.setViewport({
      width: shot.w,
      height: shot.h,
      deviceScaleFactor: shot.scale ?? 1,
      isMobile: shot.w < 500,
      hasTouch: shot.w < 500,
    });
    await page.evaluateOnNewDocument((seed) => {
      try {
        localStorage.setItem('colony-gladiator/v1', JSON.stringify(seed));
      } catch {
        /* the art just shows a new-player state */
      }
    }, SEED);
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('#boot.gone', { timeout: 15000 }).catch(() => {});
    await page.evaluate(shot.go);
    await sleep(shot.settle ?? 700);
    const file = path.join(OUT, `${shot.name}.png`);
    await page.screenshot({ path: file });
    console.log(`  ${path.relative(process.cwd(), file)}`);
    await page.close();
  }

  // The square icon is the title screen's wordmark on the pit, cropped square.
  const page = await browser.newPage();
  await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((seed) => {
    try {
      localStorage.setItem('colony-gladiator/v1', JSON.stringify(seed));
    } catch {
      /* as above */
    }
  }, SEED);
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('#boot.gone', { timeout: 15000 }).catch(() => {});
  // Strip the menu so the icon is pure wordmark — this is the one piece of art
  // that has to work at 64px in a grid of a thousand other games.
  await page.evaluate(() => {
    for (const sel of ['.mode-grid', '.title-foot', '.meta-strip', '.title-sub']) {
      const el = document.querySelector(sel);
      if (el) el.style.display = 'none';
    }
    document.querySelector('.wordmark').style.fontSize = '74px';
  });
  await sleep(900);
  const icon = path.join(OUT, 'icon.png');
  await page.screenshot({ path: icon });
  console.log(`  ${path.relative(process.cwd(), icon)}`);
  await page.close();

  await browser.close();
  console.log('\n  Store art in release/art/. Cover is 1920x1080; icon is 1024x1024 (512 @2x).\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
