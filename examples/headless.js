// Headless example — proves the engine runs the FULL battle with no browser,
// no DOM, and no canvas. This is exactly the shape the future `POST /api/simulate`
// endpoint and the headless video renderer will use.
//
//   node examples/headless.js            # random seed
//   node examples/headless.js 12345      # fixed seed (fully reproducible)
//   node examples/headless.js 12345 passive

import '../species/index.js'; // register species (engine never imports them itself)
import { runBattle } from '../engine/index.js';

const seedArg = process.argv[2];
const modeArg = process.argv[3] || 'aggressive';

const config = {
  seed: seedArg != null ? Number(seedArg) : null,
  mode: modeArg,
  teams: { soldiers: { min: 7, max: 12 }, champions: 1 }, // squad + 1 champion per team
};

console.log(`\nRunning headless battle (mode=${config.mode})…\n`);

const { summary, snapshots, init } = runBattle(config, { collectSnapshots: true });

console.log(`Species in registry : ${init.catalog.map((s) => s.id).join(', ')}`);
console.log(`Seed                : ${summary.seed}   (re-run with this seed to replay exactly)`);
console.log(`Duration            : ${summary.durationSeconds}s (${summary.durationTicks} ticks)`);
console.log(`Snapshots produced  : ${snapshots.length}  <- a videoRenderer would consume these`);
console.log(`Winner              : ${summary.winner}  (by ${summary.reason})`);
console.log(`Total kills         : ${summary.totalKills}\n`);

for (const team of ['A', 'B']) {
  const t = summary.teams[team];
  const roster = Object.entries(t.species)
    .map(([id, s]) => `${id} ${s.alive}/${s.spawned}`)
    .join(', ');
  console.log(
    `Team ${team}: ${t.survivors}/${t.spawned} survived · ${t.kills} kills · ` +
      `${t.foodCollected} food · [${roster}]`
  );
}

console.log('\nLast 5 kills:');
for (const k of summary.killLog.slice(-5)) {
  const who = k.killerSpecies ? `${k.killerSpecies} (${k.killerTeam})` : 'the arena';
  console.log(`  ${k.time}s  ${who} -> ${k.victimSpecies} (${k.victimTeam}) via ${k.cause}`);
}
console.log('');
