// Render the store assets the CrazyGames portal requires, from the real game.
//
//   npm run cover        # writes release/art/*.png  (covers + screenshots)
//   npm run trailer      # writes release/art/*.mp4  (the two preview videos)
//
// Generating these from the running build rather than mocking them up means the
// store page can never promise something the game does not show — and it costs
// nothing to regenerate after a visual change.
//
// The portal's spec (docs.crazygames.com/requirements/game-covers):
//
//   THREE cover images, all mandatory:
//     landscape  1920x1080  (16:9)
//     portrait    800x1200  (2:3)
//     square      800x800   (1:1)
//
//   TWO preview videos, also mandatory — see tools/trailer.js.
//
// A cover is not a screenshot: it is judged at thumbnail size in a grid of a
// thousand other games. So the covers below are composed — the wordmark over the
// pit, menu chrome hidden, specimen art pushed up — rather than being whatever
// the title screen happens to look like at that aspect ratio. The gameplay
// screenshots are the honest ones.

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';
import { SEED, findChrome, sleep, seedPage } from './lib/harness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'release', 'art');
const BASE = process.env.COVER_BASE || 'http://localhost:3000';

/**
 * Strip the title screen down to artwork + wordmark.
 *
 * Run inside the page. The mode buttons and stat block are the most legible
 * things on the title screen at full size and complete mush at 200px wide, which
 * is the size that actually decides whether anyone clicks.
 */
function composeCover({ scale, cast, tagline, ringA, ringB }) {
  for (const sel of ['.mode-grid', '.title-foot', '.meta-strip', '.warn']) {
    const el = document.querySelector(sel);
    if (el) el.style.display = 'none';
  }
  const plate = document.querySelector('.title-plate');
  plate.style.maxWidth = 'none';
  document.querySelector('.wordmark').style.fontSize = `${scale}px`;

  const sub = document.querySelector('.title-sub');
  if (tagline) {
    sub.textContent = tagline;
    sub.style.fontSize = `${Math.round(scale * 0.19)}px`;
    sub.style.maxWidth = `${Math.round(scale * 7.2)}px`;
    sub.style.color = '#c9b699';
  } else {
    sub.style.display = 'none';
  }

  // Replace the ambient drift with a deliberate CAST, ringed around the
  // wordmark. The title screen's version is background texture at 14% opacity;
  // a store cover is judged at ~200px wide in a grid of a thousand other games,
  // and at that size a dark rectangle with small type on it is invisible. The
  // specimens are the only thing here that reads at thumbnail size, so they get
  // to be the subject.
  const host = document.getElementById('title-swarm');
  host.innerHTML = '';
  const cx = 50;
  const cy = 50;
  cast.forEach((sp, i) => {
    const t = (i / cast.length) * Math.PI * 2 + 0.4;
    const rx = i % 2 === 0 ? ringA : ringB;
    const ry = rx * 0.92;
    const img = document.createElement('img');
    img.src = `./assets/sprites/src/${sp.id}.svg`;
    img.alt = '';
    img.style.cssText = [
      'position:absolute',
      `left:${cx + Math.cos(t) * rx}%`,
      `top:${cy + Math.sin(t) * ry}%`,
      `width:${sp.size}px`,
      `height:${sp.size}px`,
      'margin-left:-' + sp.size / 2 + 'px',
      'margin-top:-' + sp.size / 2 + 'px',
      `transform:rotate(${Math.round(Math.cos(t * 3) * 26)}deg)`,
      'opacity:0.95',
      'filter:drop-shadow(0 6px 18px rgba(0,0,0,0.75))',
      'animation:none',
    ].join(';');
    host.appendChild(img);
  });

  // A warm pool behind the wordmark so the type separates from the cast.
  const glow = document.createElement('div');
  glow.style.cssText =
    'position:absolute;inset:0;pointer-events:none;background:' +
    'radial-gradient(42% 34% at 50% 47%, rgba(255,176,46,0.20), transparent 70%),' +
    'radial-gradient(70% 60% at 50% 50%, rgba(0,0,0,0.55), transparent 75%)';
  host.appendChild(glow);
}

/** The cast, chosen for silhouette variety and colour rather than at random. */
const CAST = [
  { id: 'hornet', size: 150 },
  { id: 'mantis', size: 170 },
  { id: 'widow', size: 150 },
  { id: 'goliathBeetle', size: 160 },
  { id: 'centipede', size: 165 },
  { id: 'dragonfly', size: 175 },
  { id: 'scorpion', size: 160 },
  { id: 'queenAnt', size: 150 },
  { id: 'tarantulaHawk', size: 150 },
  { id: 'jumpingSpider', size: 140 },
  { id: 'trapjawAnt', size: 140 },
  { id: 'fireAnt', size: 130 },
];

const TAGLINE = 'Every specimen you beat is a specimen you keep.';

const COVERS = [
  {
    name: 'cover-landscape-1920x1080',
    w: 1920,
    h: 1080,
    opts: { scale: 132, cast: CAST, tagline: TAGLINE, ringA: 40, ringB: 30 },
  },
  {
    name: 'cover-portrait-800x1200',
    w: 800,
    h: 1200,
    // Fewer, larger, tighter: a 2:3 card is mostly seen at phone-menu size.
    opts: { scale: 88, cast: CAST.slice(0, 8), tagline: null, ringA: 38, ringB: 27 },
  },
  {
    name: 'cover-square-800x800',
    w: 800,
    h: 800,
    opts: { scale: 84, cast: CAST.slice(0, 8), tagline: null, ringA: 40, ringB: 29 },
  },
];

const SHOTS = [
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
    settle: 4200,
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

  for (const c of COVERS) {
    const page = await browser.newPage();
    await page.setViewport({ width: c.w, height: c.h, deviceScaleFactor: 1 });
    await seedPage(page, SEED);
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('#boot.gone', { timeout: 15000 }).catch(() => {});
    await sleep(1200); // let the swarm drift into a pleasant arrangement
    await page.evaluate(composeCover, c.opts);
    await sleep(400);
    const file = path.join(OUT, `${c.name}.png`);
    await page.screenshot({ path: file });
    console.log(`  ${path.relative(process.cwd(), file)}  (${c.w}x${c.h})`);
    await page.close();
  }

  for (const shot of SHOTS) {
    const page = await browser.newPage();
    await page.setViewport({
      width: shot.w,
      height: shot.h,
      deviceScaleFactor: shot.scale ?? 1,
      isMobile: shot.w < 500,
      hasTouch: shot.w < 500,
    });
    await seedPage(page, SEED);
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('#boot.gone', { timeout: 15000 }).catch(() => {});
    await page.evaluate(shot.go);
    await sleep(shot.settle ?? 700);
    const file = path.join(OUT, `${shot.name}.png`);
    await page.screenshot({ path: file });
    console.log(`  ${path.relative(process.cwd(), file)}`);
    await page.close();
  }

  await browser.close();
  console.log('\n  Covers and screenshots in release/art/.');
  console.log('  Run `npm run trailer` for the two preview videos the portal also requires.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
