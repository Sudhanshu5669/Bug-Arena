// Play the whole campaign headlessly and report whether it is actually beatable.
//
//   npm run campaign
//   npm run campaign -- --verbose      # per-strategy detail for every level
//
// The question a 30-level campaign has to answer is not "is level 17 hard" but
// "can a player who is not optimising their way through it still get to level
// 30, while never coasting". You cannot answer that by playing it — one pass is
// half an hour and the numbers that matter only show up across many. So: four
// different drafters, each a plausible way a real person plays, are run against
// every level using the SAME formation code and the SAME engine config the game
// uses, and the spread of results is the difficulty read.
//
//   0 of 4 win  -> a wall. Nobody sensible gets past it.
//   4 of 4 win  -> free. Any pile of units clears it.
//   1-3 of 4    -> the target: a build decision that can be got wrong.
//
// The ownership walk matters as much as the fight: each level is played with
// exactly the species the campaign has granted by that point, so a level cannot
// be accidentally tuned around a unit the player does not have yet.

import '../species/index.js';
import { getCatalog, getSpecies, hasSpecies } from '../species/registry.js';
import { runBattle } from '../engine/index.js';
import { buildLevels, STARTER_SPECIES } from '../game/levels.js';
import { costOf, powerScore } from '../game/economy.js';
import { layout } from '../game/formation.js';

const ARENA = { width: 960, height: 600, wallThickness: 24 };
const VERBOSE = process.argv.includes('--verbose');

const catalog = getCatalog();
const byId = new Map(catalog.map((s) => [s.id, s]));
const levels = buildLevels((id) => (hasSpecies(id) ? getSpecies(id) : null));

// --- drafters ----------------------------------------------------------------
//
// Each takes (owned, budget, cap) and returns a roster map. None of them is
// clever: the point is to bracket what an unoptimised player does, not to find
// the best build. If the BEST of these four cannot clear a level, no reasonable
// player will either.

/** Buy as many bodies as possible, cheapest first. The instinctive first play. */
function swarm(owned, budget, cap) {
  const ants = owned.filter((s) => s.tier === 'soldier').sort((a, b) => costOf(a) - costOf(b));
  if (!ants.length) return {};
  return fill({}, ants[0], budget, cap);
}

/** Spend on whatever scores best per larva. The spreadsheet player. */
function value(owned, budget, cap) {
  const ranked = [...owned].sort((a, b) => powerScore(b.stats) / costOf(b) - powerScore(a.stats) / costOf(a));
  return greedy(ranked, budget, cap);
}

/** One good bug, the rest ants. What the game's own scout report nudges you toward. */
function balanced(owned, budget, cap) {
  const bugs = owned.filter((s) => s.tier === 'champion').sort((a, b) => costOf(b) - costOf(a));
  const ants = owned.filter((s) => s.tier === 'soldier').sort((a, b) => powerScore(b.stats) - powerScore(a.stats));
  let roster = {};
  let spent = 0;
  const bug = bugs.find((b) => costOf(b) <= budget * 0.45);
  if (bug) {
    roster[bug.id] = 1;
    spent = costOf(bug);
  }
  if (!ants.length) return roster;
  return fill(roster, ants[0], budget - spent, cap);
}

/** Buy the biggest bugs you can afford, fill the rest. The "champions win" player. */
function elite(owned, budget, cap) {
  const bugs = owned.filter((s) => s.tier === 'champion').sort((a, b) => costOf(b) - costOf(a));
  const ants = owned.filter((s) => s.tier === 'soldier').sort((a, b) => costOf(a) - costOf(b));
  const roster = {};
  let spent = 0;
  let n = 0;
  for (const b of bugs) {
    while (spent + costOf(b) <= budget * 0.8 && n < cap) {
      roster[b.id] = (roster[b.id] ?? 0) + 1;
      spent += costOf(b);
      n += 1;
    }
  }
  if (!ants.length) return roster;
  return fill(roster, ants[0], budget - spent, cap - n);
}

/** Add as many of one species as budget and cap allow. */
function fill(roster, sp, budget, cap) {
  const price = Math.max(1, costOf(sp));
  const have = Object.values(roster).reduce((a, b) => a + b, 0);
  const n = Math.max(0, Math.min(cap - have, Math.floor(budget / price)));
  if (n > 0) roster[sp.id] = (roster[sp.id] ?? 0) + n;
  return roster;
}

/** Walk a ranked list buying whatever still fits. */
function greedy(ranked, budget, cap) {
  const roster = {};
  let spent = 0;
  let n = 0;
  // Two passes: the first spreads across the list, the second spends the change
  // on more of whatever is cheapest, so leftover larvae are never just wasted.
  for (const pass of [0, 1]) {
    for (const sp of ranked) {
      const price = Math.max(1, costOf(sp));
      const limit = pass === 0 ? Math.ceil(cap / 3) : cap;
      let took = 0;
      while (spent + price <= budget && n < cap && took < limit) {
        roster[sp.id] = (roster[sp.id] ?? 0) + 1;
        spent += price;
        n += 1;
        took += 1;
      }
    }
  }
  return roster;
}

const STRATEGIES = [
  ['swarm', swarm],
  ['value', value],
  ['balanced', balanced],
  ['elite', elite],
];

// --- one fight ---------------------------------------------------------------

/** Roster map -> the placed-unit list the deploy editor would have produced. */
function place(team, roster) {
  const units = [];
  for (const [id, n] of Object.entries(roster)) {
    const sp = byId.get(id);
    if (!sp) continue;
    for (let i = 0; i < n; i++) units.push({ id, tier: sp.tier, r: sp.stats.size });
  }
  return layout(team, ARENA, units);
}

function play(level, roster) {
  // Identical to public/campaignScreen.js — same seed, same mode, same buffs,
  // rubber-banding off. If these drift apart the probe stops measuring the game.
  const { summary } = runBattle({
    seed: level.seed,
    arena: ARENA,
    mode: 'aggressive',
    teams: { custom: { A: place('A', roster), B: place('B', level.enemy) } },
    teamBuffs: { A: null, B: level.buff },
    drama: { comeback: false },
    maxTicks: 60 * 80,
  });

  const mine = summary.teams?.A ?? { species: {}, kills: 0 };
  const deployed = Object.values(roster).reduce((a, b) => a + b, 0);
  const survivors = Object.values(mine.species ?? {}).reduce((n, r) => n + (r.alive ?? 0), 0);
  return {
    won: summary.winner === 'A',
    survivors,
    deployed,
    ratio: deployed ? survivors / deployed : 0,
    seconds: Number(summary.durationSeconds),
  };
}

// --- the walk ----------------------------------------------------------------

const owned = new Set(STARTER_SPECIES);
const rows = [];
let walls = 0;
let frees = 0;

for (const lv of levels) {
  const pool = catalog.filter((s) => owned.has(s.id));
  const results = [];

  for (const [name, strategy] of STRATEGIES) {
    const roster = strategy(pool, lv.budget, lv.cap);
    const size = Object.values(roster).reduce((a, b) => a + b, 0);
    if (!size) {
      results.push({ name, won: false, empty: true, ratio: 0, seconds: 0 });
      continue;
    }
    results.push({ name, ...play(lv, roster) });
  }

  const wins = results.filter((r) => r.won);
  // Stars are earned on survival, so the best line's survival ratio is the honest
  // read of how comfortable a clear is — not just whether one happened.
  const bestRatio = wins.length ? Math.max(...wins.map((r) => r.ratio)) : 0;
  rows.push({ lv, results, wins: wins.length, bestRatio });

  if (wins.length === 0) walls += 1;
  if (wins.length === STRATEGIES.length && bestRatio > 0.75) frees += 1;

  // The player only reaches level N+1 by clearing N, so the ownership walk
  // advances regardless of which strategy did it.
  if (lv.grant) owned.add(lv.grant);
}

// --- report ------------------------------------------------------------------

const bar = (n) => '■'.repeat(n) + '·'.repeat(STRATEGIES.length - n);

console.log('\n=== CAMPAIGN PROBE ===\n');
console.log('  #     level                     budget  cap   wins  survival  best line        verdict');
for (const { lv, results, wins, bestRatio } of rows) {
  const best = results.filter((r) => r.won).sort((a, b) => b.ratio - a.ratio)[0];
  const verdict = wins === 0 ? 'WALL' : wins === STRATEGIES.length && bestRatio > 0.75 ? 'free' : 'ok';
  console.log(
    `${String(lv.index).padStart(3)}${lv.isBoss ? ' ★' : '  '} ${lv.name.padEnd(24)} ` +
      `${String(lv.budget).padStart(6)} ${String(lv.cap).padStart(4)}   ${bar(wins)}  ` +
      `${String(Math.round(bestRatio * 100) + '%').padStart(7)}  ${(best?.name ?? '—').padEnd(15)}  ${verdict}`
  );
  if (VERBOSE) {
    for (const r of results) {
      console.log(
        `        ${r.name.padEnd(9)} ${r.empty ? 'no legal roster' : `${r.won ? 'WIN ' : 'loss'}  ${r.survivors}/${r.deployed} alive  ${r.seconds}s`}`
      );
    }
  }
}

const clearable = rows.filter((r) => r.wins > 0).length;
const contested = rows.filter((r) => r.wins > 0 && r.wins < STRATEGIES.length).length;

console.log(`\n  levels clearable by at least one naive drafter : ${clearable}/${rows.length}`);
console.log(`  levels where the build actually mattered      : ${contested}/${rows.length}`);
console.log(`  walls (no strategy cleared it)                : ${walls}`);
console.log(`  free wins (all four cleared it comfortably)   : ${frees}`);

if (walls > 0) {
  console.log('\n  ✗ At least one level is unbeatable by any of the four baseline drafters.');
  console.log('    A real player drafts better than these, but a wall here usually means');
  console.log("    the level's budget slack is genuinely too tight — check tools/levelReport.js.\n");
  process.exitCode = 1;
} else {
  console.log('\n  ✓ Every level is clearable, and the campaign can be walked end to end.\n');
}
