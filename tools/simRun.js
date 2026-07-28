// Headless run simulator — plays complete runs with a simple drafting AI.
//
//   npm run sim            # 200 runs, win-rate + where runs die
//   npm run sim -- 50 2    # 50 runs at ascension 2
//
// This exists because balancing a 15-battle roguelite by hand-playing it is not
// viable: one run is ~20 minutes and the numbers that matter (win rate, the depth
// runs actually die at, whether attrition outpaces income) only show up across
// hundreds. The engine already runs headless and every random draw is seeded, so
// a full run costs milliseconds here.
//
// The AI is deliberately mediocre — it drafts greedily without reading the enemy.
// A curve that a naive drafter clears ~35-50% of the time is roughly right: good
// players should do markedly better, and it should not be a coin flip.

import '../species/index.js';
import { getCatalog } from '../species/registry.js';
import { runBattle } from '../engine/index.js';
import { Run, RUN_DEPTH } from '../game/run.js';
import { randomSeed } from '../engine/rng.js';

const RUNS = Number(process.argv[2] ?? 200);
const ASCENSION = Number(process.argv[3] ?? 0);
// `--trace` follows a single run depth by depth. The aggregate tells you the
// curve is wrong; the trace tells you WHY — almost always the relationship
// between what a victory pays and what attrition costs.
const TRACE = process.argv.includes('--trace');

const catalog = getCatalog();

/**
 * Baseline drafter: fill every free slot, spending the purse evenly across them.
 *
 * With the headcount capped, "buy the cheapest thing" is no longer sensible — an
 * empty slot is wasted whatever it costs, so the naive-but-correct policy is to
 * work out what one slot can afford and buy the best unit at that price. It does
 * no enemy scouting and knows nothing about synergy, which is the point: it sets
 * the floor a real player should comfortably beat.
 */
function draft(run) {
  const prices = run.prices;
  let guard = 200; // the buy() contract can refuse; never spin on it
  while (!run.atCap && guard-- > 0) {
    const slots = run.cap - run.armySize;
    const perSlot = run.larvae / slots;
    const affordable = run.available.filter((s) => prices[s.id] <= run.larvae);
    if (!affordable.length) break;

    // Prefer the best unit one slot's share covers; if nothing fits that share,
    // fall back to the cheapest so slots still get filled.
    const withinShare = affordable.filter((s) => prices[s.id] <= perSlot);
    const pool = withinShare.length ? withinShare : affordable;
    const best = pool.sort((a, b) => prices[b.id] - prices[a.id])[withinShare.length ? 0 : pool.length - 1];
    if (!run.buy(best.id)) break;
  }
}

const deaths = new Array(RUN_DEPTH + 2).fill(0);
let wins = 0;
let totalBattles = 0;
const armySizes = [];

for (let i = 0; i < RUNS; i++) {
  const run = Run.create({ seed: randomSeed(), catalog, ascension: ASCENSION });

  while (run.phase !== 'won' && run.phase !== 'lost') {
    if (run.phase === 'draft') {
      draft(run);
      if (run.armySize === 0) {
        // Bankrupt with an empty colony: nothing to field, count as a loss here.
        run.phase = 'lost';
        break;
      }
      if (run.depth === 1) armySizes.push(run.armySize);
      const before = { depth: run.depth, value: run.armyValue, size: run.armySize, enemy: run.enemy.budget };
      const config = run.beginBattle();
      const { summary } = runBattle(config);
      totalBattles++;
      const result = run.resolveBattle(summary);
      if (TRACE && i === 0) {
        const kept = run.armyValue;
        console.log(
          `  d${String(before.depth).padStart(2)} ` +
            `army=${String(before.value).padStart(4)}(${String(before.size).padStart(2)}u) ` +
            `enemy=${String(before.enemy).padStart(4)} ` +
            `-> ${result.won ? 'WIN ' : 'LOSS'} ` +
            `kept=${String(kept).padStart(4)} (${Math.round((kept / (before.value || 1)) * 100)}%) ` +
            `+${String(result.larvae).padStart(3)} larvae, purse=${run.larvae}`
        );
      }
    } else if (run.phase === 'reward') {
      // Take the first offered mutation — a naive but consistent policy.
      const offer = run.mutationOffer;
      if (offer.length) run.chooseMutation(offer[0].id);
      else run.skipMutation();
    }
  }

  if (run.phase === 'won') wins++;
  else deaths[run.depth] += 1;
}

const pct = (n) => `${((n / RUNS) * 100).toFixed(1)}%`;
console.log(`\n=== ${RUNS} runs @ ascension ${ASCENSION} ===`);
console.log(`Runs won:      ${wins}/${RUNS}  (${pct(wins)})`);
console.log(`Battles run:   ${totalBattles}`);
console.log(`Avg depth-1 army size: ${(armySizes.reduce((a, b) => a + b, 0) / (armySizes.length || 1)).toFixed(1)}`);
console.log(`\nWhere runs ended:`);
for (let d = 1; d <= RUN_DEPTH; d++) {
  if (!deaths[d]) continue;
  const bar = '#'.repeat(Math.round((deaths[d] / RUNS) * 60));
  console.log(`  depth ${String(d).padStart(2)}  ${String(deaths[d]).padStart(4)}  ${pct(deaths[d]).padStart(6)}  ${bar}`);
}
console.log('');
