// Sweep the victory-reward multiplier and report the win rate it produces.
//
//   npm run tune            # sweeps a sensible range
//   RUNS=40 npm run tune
//
// The multiplier in campaign.js is the single dial that decides whether a run is
// winnable, and it interacts with the price table, the colony cap and the
// difficulty curve in ways that are not worth reasoning about analytically —
// change any one of them and the right value moves. This sweeps it directly.
//
// Target: a naive drafter (see tools/simRun.js) should clear roughly 35-50% of
// runs. Much higher and the game plays itself; much lower and a competent player
// has no room to be rewarded for being competent.

import '../species/index.js';
import { getCatalog } from '../species/registry.js';
import { runBattle } from '../engine/index.js';
import { Run } from '../game/run.js';
import * as campaign from '../game/campaign.js';
import { randomSeed } from '../engine/rng.js';

const RUNS = Number(process.env.RUNS ?? 25);
const catalog = getCatalog();

// campaign.js exposes setRewardMultiplier purely for this sweep — ES module
// exports are read-only bindings, so the tool cannot simply monkey-patch them.

function draft(run) {
  const prices = run.prices;
  let guard = 200;
  while (!run.atCap && guard-- > 0) {
    const slots = run.cap - run.armySize;
    const perSlot = run.larvae / slots;
    const affordable = run.available.filter((s) => prices[s.id] <= run.larvae);
    if (!affordable.length) break;
    const withinShare = affordable.filter((s) => prices[s.id] <= perSlot);
    const pool = withinShare.length ? withinShare : affordable;
    const best = pool.sort((a, b) => prices[b.id] - prices[a.id])[withinShare.length ? 0 : pool.length - 1];
    if (!run.buy(best.id)) break;
  }
}

function trial(multiplier) {
  let wins = 0;
  const deaths = [];
  for (let i = 0; i < RUNS; i++) {
    const run = Run.create({ seed: randomSeed(), catalog });
    while (run.phase !== 'won' && run.phase !== 'lost') {
      if (run.phase === 'draft') {
        draft(run);
        if (run.armySize === 0) {
          run.phase = 'lost';
          break;
        }
        const { summary } = runBattle(run.beginBattle());
        run.resolveBattle(summary);
      } else if (run.phase === 'reward') {
        const offer = run.mutationOffer;
        if (offer.length) run.chooseMutation(offer[0].id);
        else run.skipMutation();
      }
    }
    if (run.phase === 'won') wins++;
    else deaths.push(run.depth);
  }
  const median = deaths.sort((a, b) => a - b)[Math.floor(deaths.length / 2)] ?? '-';
  return { wins, rate: (wins / RUNS) * 100, medianDeath: median };
}

console.log(`\nSweeping victory-reward multiplier over ${RUNS} runs each.`);
console.log('Target band for a naive drafter: 35-50% runs won.\n');
console.log('  mult    won      rate    median death depth');
console.log('  ' + '-'.repeat(46));

for (const mult of [0.34, 0.42, 0.5, 0.58, 0.66, 0.74]) {
  campaign.setRewardMultiplier(mult);
  const r = trial(mult);
  const flag = r.rate >= 35 && r.rate <= 50 ? '  <-- in band' : '';
  console.log(
    `  ${mult.toFixed(2)}  ${String(r.wins).padStart(3)}/${RUNS}  ${r.rate.toFixed(1).padStart(6)}%  ${String(r.medianDeath).padStart(12)}${flag}`
  );
}

console.log('');
