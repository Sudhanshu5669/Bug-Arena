// Print the resolved campaign table and check it for the mistakes a data table
// invites: a typo'd species id, a species granted twice, a species that is both
// earnable and purchasable, one that is unreachable by any route.
//
//   npm run levels
//
// Everything here is derived from game/levels.js, so this is also the fastest way
// to see what adding or retuning a level actually did to the curve.

import '../species/index.js';
import { getCatalog, getSpecies, hasSpecies } from '../species/registry.js';
import { buildLevels, campaignGrants, STARTER_SPECIES } from '../game/levels.js';
import { Progress, emptyCampaign } from '../game/progress.js';

const catalog = getCatalog();
const lookup = (id) => (hasSpecies(id) ? getSpecies(id) : null);
const levels = buildLevels(lookup);
const progress = new Progress(emptyCampaign(), levels, catalog);

const pad = (v, n) => String(v).padStart(n);

console.log(`\n=== CAMPAIGN · ${levels.length} levels ===\n`);
console.log('  #     name                        foe  budget  slack  cap  coins  grants');
for (const lv of levels) {
  const slack = (lv.budget / Math.max(1, lv.enemyValue)).toFixed(2);
  console.log(
    `${pad(lv.index, 3)}${lv.isBoss ? ' ★' : '  '} ${lv.name.padEnd(24)} ${pad(lv.enemyValue, 5)} ${pad(lv.budget, 6)}  ${slack}  ${pad(lv.cap, 3)}  ${pad(lv.coins, 5)}  ${lv.grant ?? '—'}`
  );
}

// --- integrity ---------------------------------------------------------------

const problems = [];
const grants = campaignGrants();

for (const [i, g] of grants.entries()) {
  if (!hasSpecies(g)) problems.push(`level ${i + 1} grants unknown species "${g}"`);
}
const seen = new Set();
for (const [i, g] of grants.entries()) {
  if (seen.has(g)) problems.push(`species "${g}" is granted twice (again at level ${i + 1})`);
  seen.add(g);
}
for (const s of STARTER_SPECIES) {
  if (seen.has(s)) problems.push(`starter species "${s}" is also a level grant`);
}
for (const lv of levels) {
  if (!Object.keys(lv.enemy).length) problems.push(`level ${lv.index} ("${lv.name}") fields nobody`);
}

const shop = progress.shopStock();
const reachable = new Set([...STARTER_SPECIES, ...grants, ...shop.map((s) => s.id)]);
for (const s of catalog) {
  if (!reachable.has(s.id)) problems.push(`species "${s.id}" can never be obtained (not starter, granted or sold)`);
}

// --- economy -----------------------------------------------------------------

const earnable = levels.reduce((n, l) => n + l.coins, 0);
const shopTotal = shop.reduce((n, s) => n + s.price, 0);

console.log(`\n=== HATCHERY · ${shop.length} species for sale ===\n`);
for (const s of shop) console.log(`  ${pad(s.price, 5)} jelly   ${s.tier === 'champion' ? 'BUG ' : 'ANT '} ${s.name}`);

console.log(`\n  royal jelly earnable across the campaign : ${earnable}`);
console.log(`  cost to buy out the Hatchery             : ${shopTotal}`);
console.log(`  surplus                                  : ${earnable - shopTotal}`);
console.log(`  species: ${STARTER_SPECIES.length} starter + ${grants.length} granted + ${shop.length} sold = ${reachable.size} of ${catalog.length}`);

if (problems.length) {
  console.log(`\n  ${problems.length} PROBLEM(S):`);
  for (const p of problems) console.log(`   ✗ ${p}`);
  process.exitCode = 1;
} else {
  console.log('\n  No problems found.\n');
}
