// Empirical price calibration — measures what each unit is actually worth, in
// ants, and writes the result to game/calibrated.js.
//
//   npm run calibrate              # both tiers, writes game/calibrated.js
//   SIMS=48 npm run calibrate      # slower, tighter numbers
//
// WHY measured rather than derived:
//
// A battle between N units is governed by Lanchester's square law — a side's
// strength goes as N^2 x (per-unit power), because more units both deal more
// damage at once and spread incoming damage thinner. Army strength is therefore
// quadratic in headcount but only linear in unit quality, so a price that scales
// linearly with power makes every expensive unit a trap.
//
// Worse, the engine has a threshold effect no smooth formula captures: a unit
// with ~120 health dies in a mass brawl before it lands its damage, so raw DPS
// is close to worthless below a durability floor. Measured worth across the
// champion tier spans 1x to 8x while the stat-derived estimate spans only ~1.3x.
// That gap is the whole reason this file exists.
//
// The measurement: find the exchange rate X where "1 of this unit + (BASE - X)
// ants" fights "BASE ants" to a coin flip. X is what the unit is worth in ants
// at equal budget, so `cost = X * antCost` is the price at which drafting it is
// an open decision rather than a trap or a no-brainer.

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import '../species/index.js';
import { getCatalog } from '../species/registry.js';
import { runBattle } from '../engine/index.js';
import { costOf } from '../game/economy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'game', 'calibrated.js');

const SIMS = Number(process.env.SIMS ?? 32);
const REF = 'fireAnt'; // the yardstick unit

// Both tiers are measured as "a squad of N of this unit is worth M reference
// ants", and the price is refCost * M / N. Reading the answer as a RATIO rather
// than as whole ants is what gives sub-ant resolution: measuring in whole ants
// priced all 22 soldiers identically at 1 ant, which is true to the nearest ant
// and useless as an economy.
//
// Champions carry a fixed ant escort on their side of the test. Without it a
// 2-unit army fights a 30-unit one, the comeback rubber band engages hard, and
// what gets measured is the rubber band rather than the champion.
const PROBE = {
  soldier: { n: 8, escort: 0, lo: 2, hi: 30 },
  champion: { n: 2, escort: 8, lo: 9, hi: 48 },
};

const catalog = getCatalog();
const refSpecies = catalog.find((s) => s.id === REF);
const refCost = costOf(refSpecies);

/** Win rate for A over SIMS seeded battles. Seeds are fixed so reruns are stable. */
function rate(A, B) {
  let wins = 0;
  for (let i = 0; i < SIMS; i++) {
    const { summary } = runBattle({ seed: (i * 2654435761 + 12345) >>> 0, teams: { custom: { A, B } } });
    if (summary.winner === 'A') wins++;
  }
  return wins / SIMS;
}

/** Win rate for "n of this unit (+ escort) vs m reference ants". */
function rateAtM(speciesId, p, m) {
  const A = [{ species: speciesId, count: p.n }];
  if (p.escort > 0) A.push({ species: REF, count: p.escort });
  return rate(A, [{ species: REF, count: m }]);
}

/**
 * The largest reference-ant army this unit's squad still beats half the time.
 *
 * Win rate falls monotonically as the opposing army grows, so binary search finds
 * the crossing in ~5 probes instead of scanning every size.
 */
function antEquivalence(speciesId, tier) {
  const p = PROBE[tier];
  let lo = p.lo;
  let hi = p.hi;
  if (rateAtM(speciesId, p, lo) < 0.5) return { m: lo, worth: worthOf(lo, p) };
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (rateAtM(speciesId, p, mid) >= 0.5) lo = mid;
    else hi = mid - 1;
  }
  return { m: lo, worth: worthOf(lo, p) };
}

/** Convert a measured crossing into "ants per unit", discounting the escort. */
function worthOf(m, p) {
  return Math.max(0.2, (m - p.escort) / p.n);
}

const results = {};
for (const tier of ['soldier', 'champion']) {
  const group = catalog.filter((s) => s.tier === tier);
  console.log(`\n=== ${tier} (${group.length} units, ${SIMS} battles per probe) ===`);
  console.log('  unit                     worth       price');
  console.log('  ' + '-'.repeat(48));
  const measured = [];
  for (const s of group) {
    // The reference unit is 1 ant by definition — measuring it against itself
    // would only report noise around the coin flip.
    const worth = s.id === REF ? 1 : antEquivalence(s.id, tier).worth;
    const price = Math.max(1, Math.round(worth * refCost));
    results[s.id] = price;
    measured.push({ name: s.name, worth, price });
    console.log(`  ${s.name.padEnd(22)} ${worth.toFixed(2).padStart(6)} ants ${String(price).padStart(8)}`);
  }
  const ps = measured.map((r) => r.price).sort((a, b) => a - b);
  console.log(`  min=${ps[0]}  median=${ps[Math.floor(ps.length / 2)]}  max=${ps[ps.length - 1]}`);
}

const body = `// GENERATED by tools/calibrate.js — do not edit by hand.
//
// Measured draft price for every shipped species, in larvae. Each number is the
// point where fielding this unit instead of the ants it costs is a coin flip
// (see the tool for why measurement beats a formula here).
//
// Regenerate after changing unit stats, abilities, or the engine's combat maths:
//
//   npm run calibrate
//
// Species NOT listed here fall back to the stat-derived estimate in economy.js,
// so a newly added unit is playable immediately and can be calibrated later.
//
// Reference unit: ${refSpecies.name} = ${refCost} larvae. Probes: ${SIMS} battles each.

export const CALIBRATED_COSTS = Object.freeze(${JSON.stringify(results, null, 2)});
`;

await fs.writeFile(OUT, body, 'utf8');
console.log(`\nWrote ${path.relative(process.cwd(), OUT)} (${Object.keys(results).length} species)\n`);
