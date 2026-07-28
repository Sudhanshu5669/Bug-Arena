// Sanity probes for the run layer's assumptions.
//
//   npm run probe
//
// Each probe answers one question the balance depends on. If a probe is wrong,
// tuning numbers is pointless — something underneath is broken.

import '../species/index.js';
import { getCatalog } from '../species/registry.js';
import { runBattle } from '../engine/index.js';
import { costOf } from '../game/economy.js';

const catalog = getCatalog();
const byId = new Map(catalog.map((s) => [s.id, s]));
const N = 60;

function winRate(A, B, opts = {}) {
  let a = 0;
  let draws = 0;
  for (let i = 0; i < N; i++) {
    const { summary } = runBattle({
      seed: (i * 2654435761) >>> 0,
      teams: { custom: { A, B } },
      teamBuffs: opts.teamBuffs ?? { A: null, B: null },
    });
    if (summary.winner === 'A') a++;
    else if (summary.winner === 'draw') draws++;
  }
  return { aWins: a, rate: ((a / N) * 100).toFixed(0), draws };
}

const line = (label, r) => console.log(`  ${label.padEnd(46)} A wins ${String(r.aWins).padStart(3)}/${N} (${r.rate}%)  draws=${r.draws}`);

console.log('\n1. Mirror match should be a coin flip (validates no side bias)');
line('8 fireAnt  vs  8 fireAnt', winRate([{ species: 'fireAnt', count: 8 }], [{ species: 'fireAnt', count: 8 }]));

console.log('\n2. teamBuffs must actually do something');
line('8 fireAnt (+60% dmg) vs 8 fireAnt', winRate(
  [{ species: 'fireAnt', count: 8 }], [{ species: 'fireAnt', count: 8 }],
  { teamBuffs: { A: { damageDealt: 1.6, label: 'test' }, B: null } }
));
line('8 fireAnt (2x health)  vs 8 fireAnt', winRate(
  [{ species: 'fireAnt', count: 8 }], [{ species: 'fireAnt', count: 8 }],
  { teamBuffs: { A: { maxHealth: 2.0, label: 'test' }, B: null } }
));

console.log('\n3. More of the same unit should win (validates numbers matter)');
line('12 fireAnt vs 8 fireAnt', winRate([{ species: 'fireAnt', count: 12 }], [{ species: 'fireAnt', count: 8 }]));
line('16 fireAnt vs 8 fireAnt', winRate([{ species: 'fireAnt', count: 16 }], [{ species: 'fireAnt', count: 8 }]));

console.log('\n4. Equal-cost armies should be near-even (validates the PRICE model)');
for (const champId of ['scorpion', 'mantis', 'spider', 'widow']) {
  const champ = byId.get(champId);
  const ant = byId.get('fireAnt');
  if (!champ || !ant) continue;
  const budget = 60;
  const antsForChamp = Math.floor((budget - costOf(champ)) / costOf(ant));
  const pureAnts = Math.floor(budget / costOf(ant));
  const r = winRate(
    [{ species: champId, count: 1 }, { species: 'fireAnt', count: antsForChamp }],
    [{ species: 'fireAnt', count: pureAnts }]
  );
  line(`${champ.name}(${costOf(champ)}) + ${antsForChamp} ants  vs  ${pureAnts} ants`, r);
}
console.log('');
