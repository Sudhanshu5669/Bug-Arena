// Record the two preview videos the CrazyGames portal requires, from the game.
//
//   npm run trailer
//
// The portal's spec (docs.crazygames.com/requirements/game-covers):
//
//   Landscape  1080p, 16:9
//   Portrait   1080p, 2:3
//   15-20 seconds (anything longer is cut at 20)
//   50 MB maximum
//   NO audio, NO black frames or logos, NO letterboxing, NO visible cursor,
//   NO promotional text overlay, NO fast-forwarding.
//   The opening frame should match the static cover.
//
// Every one of those constraints is satisfied by construction below rather than
// by trimming afterwards: the recording starts on the title screen (so frame one
// is the cover), runs at real speed, the cursor is parked off-screen, and the
// clip is cut at 18s.
//
// Frames come from Chrome's DevTools screencast rather than repeated
// `page.screenshot()` calls. A screenshot takes ~80ms, so capturing 30fps that
// way records a game that is running four times faster than the video plays it
// back — the result looks sped up, which the portal explicitly rejects.
// Screencast pushes frames as the compositor produces them, with timestamps.

import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';
import ffmpeg from 'ffmpeg-static';
import { SEED, findChrome, sleep, seedPage } from './lib/harness.js';

const run = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'release', 'art');
const TMP = path.resolve(__dirname, '..', 'release', '.frames');
const BASE = process.env.COVER_BASE || 'http://localhost:3000';

const FPS = 30;
const SECONDS = 18; // inside the portal's 20s ceiling with room to spare

const CUTS = [
  // 1080p landscape and 1080p portrait at 2:3, as the portal asks.
  { name: 'preview-landscape', w: 1920, h: 1080 },
  { name: 'preview-portrait', w: 1080, h: 1620, mobile: true },
];

/**
 * The 18 seconds, as a script.
 *
 * Front-loaded on purpose: a portal preview is judged in about three seconds, so
 * the arranging — the thing that makes this game different from every other auto
 * battler — has to be on screen almost immediately, and the fight has to be
 * running by halfway.
 */
async function perform(page, mobile) {
  const tap = async (id, wait) => {
    await page.evaluate((i) => document.getElementById(i)?.click(), id);
    await sleep(wait);
  };

  await sleep(1600); // hold the title: this is the opening frame
  await tap('btn-campaign', 1500); // the thirty-chamber map
  await tap('btn-camp-continue', 1600); // into the deploy screen

  // Place a colony one specimen at a time, at a pace a viewer can follow.
  for (let i = 0; i < (mobile ? 11 : 16); i++) {
    await page.evaluate(() => {
      document.querySelector('#deploy-tray .tcard button[data-act="add"]:not([disabled])')?.click();
    });
    await sleep(230);
  }

  await sleep(900);
  await tap('btn-deploy-fight', 0); // ...and the rest of the clip is the fight
}

/**
 * Capture `SECONDS` of the page as PNG frames.
 *
 * Screencast frames arrive irregularly (the compositor only emits on change), so
 * each one is held until the next arrives — that is what keeps playback at real
 * speed instead of skipping through the idle moments.
 */
async function record(page, dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });

  const client = await page.createCDPSession();
  const frames = [];
  const t0 = Date.now();

  client.on('Page.screencastFrame', async ({ data, sessionId }) => {
    frames.push({ at: Date.now() - t0, data });
    try {
      await client.send('Page.screencastFrameAck', { sessionId });
    } catch {
      /* the cast was stopped between the frame arriving and this ack */
    }
  });

  await client.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  return {
    async stop() {
      await client.send('Page.stopScreencast').catch(() => {});
      // Resample the irregular stream onto a fixed grid, holding the last frame
      // over any gap. Without this, ffmpeg treats every captured frame as one
      // 1/30s tick and the video plays back faster than the game ran.
      const total = SECONDS * FPS;
      let cursor = 0;
      for (let i = 0; i < total; i++) {
        const want = (i / FPS) * 1000;
        while (cursor + 1 < frames.length && frames[cursor + 1].at <= want) cursor++;
        const f = frames[cursor];
        if (!f) break;
        await fs.writeFile(path.join(dir, `f${String(i).padStart(5, '0')}.png`), Buffer.from(f.data, 'base64'));
      }
      return frames.length;
    },
  };
}

async function encode(dir, out, w, h) {
  await fs.rm(out, { force: true });
  await run(ffmpeg, [
    '-y',
    '-framerate', String(FPS),
    '-i', path.join(dir, 'f%05d.png'),
    // Scale to the exact target and pad only if the aspect somehow disagrees —
    // padding would be letterboxing, which the portal rejects, so the viewport
    // is set to the final size and this is a no-op safety net.
    '-vf', `scale=${w}:${h}:flags=lanczos,format=yuv420p`,
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '21',
    '-movflags', '+faststart',
    '-an', // the portal does not allow audio
    out,
  ]);
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: await findChrome(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb', '--hide-scrollbars'],
  });

  for (const cut of CUTS) {
    console.log(`\n  recording ${cut.name} (${cut.w}x${cut.h})...`);
    const page = await browser.newPage();
    await page.setViewport({
      width: cut.w,
      height: cut.h,
      deviceScaleFactor: 1,
      isMobile: !!cut.mobile,
      hasTouch: !!cut.mobile,
    });
    await seedPage(page, SEED);
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('#boot.gone', { timeout: 15000 }).catch(() => {});
    // Park the pointer outside the viewport: a visible cursor is on the reject list.
    await page.mouse.move(-10, -10);

    const dir = path.join(TMP, cut.name);
    const rec = await record(page, dir);
    const script = perform(page, cut.mobile);
    await sleep(SECONDS * 1000 + 400);
    const captured = await rec.stop();
    await script.catch(() => {});
    await page.close();

    const out = path.join(OUT, `${cut.name}.mp4`);
    await encode(dir, out, cut.w, cut.h);
    const { size } = await fs.stat(out);
    console.log(`  ${path.relative(process.cwd(), out)} — ${(size / 1e6).toFixed(1)} MB, ${SECONDS}s, ${captured} raw frames`);
    if (size > 50e6) console.warn('  ! over the portal\'s 50MB limit — raise -crf');
  }

  await browser.close();
  await fs.rm(TMP, { recursive: true, force: true });
  console.log('\n  Preview videos in release/art/. No audio, no letterboxing, 18s.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
