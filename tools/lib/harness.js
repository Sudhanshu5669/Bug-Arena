// Shared plumbing for the dev-only browser tools (shots, smoke, cover, trailer).
//
// None of this ships. It exists so that the four tools which drive a real Chrome
// through the real game agree on how they find Chrome and what save state they
// start from — three copies of a seed blob drift apart, and then two tools that
// disagree about the game's state produce screenshots and test failures that
// cannot be compared to each other.

import fs from 'fs/promises';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

export async function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
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

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A mid-campaign save: fourteen chambers cleared, a real roster, jelly banked.
 *
 * Store art and trailers made from a new-player save show two species and an
 * empty specimen drawer, which is the least interesting the game ever looks and
 * is not what the page is selling.
 */
export const SEED = Object.freeze({
  version: 1,
  run: null,
  campaign: {
    coins: 640,
    cleared: Object.fromEntries(
      Array.from({ length: 14 }, (_, i) => [
        i + 1,
        { stars: [3, 2, 3, 3, 2, 3, 1, 3, 2, 3, 3, 2, 3, 2][i], plays: 1 },
      ])
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
  meta: {
    unlocked: [],
    bestDepth: 7,
    runsWon: 1,
    runsPlayed: 3,
    ascension: 0,
    totalKills: 612,
    seenHowto: true,
  },
});

/**
 * Install the save before the app's first script runs.
 *
 * Seeded ONCE per browser context: this runs on every document, including one
 * created by a reload, and re-applying it there would silently overwrite
 * whatever the tool just did and then blame the game for losing it.
 */
export async function seedPage(page, seed = SEED) {
  await page.evaluateOnNewDocument((s) => {
    try {
      if (localStorage.getItem('__harness_seeded__')) return;
      localStorage.setItem('__harness_seeded__', '1');
      localStorage.setItem('colony-gladiator/v1', JSON.stringify(s));
    } catch {
      /* storage blocked — the tool still works, it just starts from an empty save */
    }
  }, seed);
}
