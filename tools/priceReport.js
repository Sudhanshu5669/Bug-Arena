// Balance audit: print every species with its computed draft cost.
//
//   npm run prices
//
// Run this after adding a species or touching game/economy.js. The formula prices
// unseen species automatically, which is the point — but "automatic" is only
// useful if someone occasionally checks that the numbers it produced are sane.

import '../species/index.js';
import { getCatalog } from '../species/registry.js';
import { costOf, powerScore } from '../game/economy.js';

const catalog = getCatalog();
const rows = catalog.map((s) => ({
  name: s.name,
  tier: s.tier,
  cost: costOf(s),
  power: powerScore(s.stats),
  hp: s.stats.maxHealth,
  dmg: s.stats.damage,
  cd: s.stats.attackCooldown,
  ability: s.ability ? s.ability.name : '—',
}));

for (const tier of ['soldier', 'champion']) {
  const group = rows.filter((r) => r.tier === tier).sort((a, b) => a.cost - b.cost);
  console.log(`\n=== ${tier.toUpperCase()} · ${group.length} units ===`);
  for (const r of group) {
    console.log(
      `${String(r.cost).padStart(4)}  ${r.name.padEnd(20)} ` +
        `hp=${String(r.hp).padStart(4)} dmg=${String(r.dmg).padStart(3)} cd=${String(r.cd).padStart(3)}  ${r.ability}`
    );
  }
  const costs = group.map((r) => r.cost).sort((a, b) => a - b);
  const median = costs[Math.floor(costs.length / 2)];
  console.log(`      min=${costs[0]}  median=${median}  max=${costs[costs.length - 1]}`);
}

console.log(`\nTotal species priced: ${rows.length}\n`);
