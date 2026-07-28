// What a unit COSTS.
//
// The roster is priced by formula rather than by a hand-written table of 44
// numbers, for one reason: the whole point of the species layer is that adding a
// file adds a unit. If prices lived in a lookup table, every new species would
// silently cost nothing until someone remembered to update it. Here an unknown
// species gets a sane price the moment it registers.
//
// The formula values a unit the way a battle does — as the product of how much
// damage it deals and how long it survives to keep dealing it — then applies
// hand-tuned multipliers for the handful of units whose worth is utility the
// stat block cannot see (a Leafcutter's 3 damage says "worthless"; halving the
// damage your whole colony takes is not worthless).

import { CALIBRATED_COSTS } from './calibrated.js';

/** Engine ticks per second; attackCooldown is expressed in ticks. */
const TICK_RATE = 60;

/**
 * Utility multipliers. ONLY for units the stat formula misreads — a unit whose
 * value is in what it does to OTHER units. Anything absent scores 1.0, which is
 * why a brand-new species still gets priced correctly-ish without an entry here.
 *
 * >1 = the stat block undersells it. <1 = the stat block oversells it.
 */
const UTILITY = Object.freeze({
  // --- Support ants: near-zero offence, colony-wide effect -------------------
  leafcutterAnt: 2.6, // halves damage for everyone nearby
  honeypotAnt: 2.4, // continuous colony-wide healing
  turtleAnt: 2.2, // 24% damage taken, shelters everyone behind it
  workerAnt: 1.9, // heals the whole colony off food it finds
  argentineAnt: 2.5, // +50% damage taken on a marked target — pure force multiplier
  carpenterAnt: 1.7, // reflect + damage halving
  weaverAnt: 2.0, // mass pull + root sets up every other unit's kill
  crazyAnt: 1.8, // -42% enemy damage across a cluster

  // --- Scaling units: weak on arrival, terrifying if the fight runs long ----
  harvesterAnt: 1.7, // permanent growth per seed
  amazonAnt: 1.6, // permanently steals damage and HP
  pharaohAnt: 2.1, // self-replicating; the only unit that can outnumber its own cost
  draculaAnt: 1.5, // true lifesteal

  // --- Death-triggered: the stat block reads a corpse, not the payload ------
  suicideAnt: 1.6, // has to die to do anything, and the AoE is large
  zombieAnt: 1.9, // contagious, blocks healing, blooms twice
  fireAnt: 1.3, // burn + ember burst on death

  // --- Lockdown champions: low damage, decide fights anyway -----------------
  spider: 1.9, // mass immobilize
  antlion: 1.6, // pit control
  jewelWasp: 1.8, // removes a champion from the fight outright
  queenAnt: 2.2, // 4 damage and no ability — every bit of her worth is the brood

  // --- Overvalued by raw stats: fragile, committal, or self-limiting --------
  mantis: 0.85, // glass cannon; the charge commits it
  trapjawAnt: 0.9, // catapults ITSELF out of the fight after the burst
  jackJumperAnt: 0.9, // evasion is not armour under focus fire
  bulldogAnt: 0.85, // habitually arrives alone and dies alone
  bombardier: 0.9, // big numbers, self-damaging
});

/**
 * Raw combat worth of a stat block.
 *
 * Damage-per-second times effective health is the standard way to compare units
 * that trade offence for durability; the square root keeps the result on a human
 * scale (a unit twice as good costs ~2x, not ~4x) so budgets stay readable.
 */
export function powerScore(stats) {
  const dps = stats.damage / Math.max(0.05, stats.attackCooldown / TICK_RATE);
  const ehp = Math.max(1, stats.maxHealth);

  // Mobility and reach are real but secondary — they decide how OFTEN a unit gets
  // to use its damage, not how much it has. Kept as gentle modifiers so a fast
  // unit is worth more than an identical slow one without dominating the price.
  const mobility = 0.75 + stats.speed / 8; // speed 1.5 -> 0.94, speed 3 -> 1.13
  const reach = 0.9 + Math.min(stats.attackRange, 90) / 300; // capped: snipers aren't infinitely valuable

  return Math.sqrt(dps * ehp) * mobility * reach;
}

/**
 * Price one species. Soldiers land roughly in 2..9, champions roughly in 12..34,
 * which is the spread the draft budget is tuned against.
 *
 * @param {{id:string, tier:string, stats:object, ability:object|null, cost?:number}} species
 * @returns {number} whole-number larvae cost, minimum 1
 */
export function costOf(species) {
  // An explicit `cost` on the species config always wins — the escape hatch for a
  // unit that needs a specific number for a specific reason.
  if (typeof species.cost === 'number' && species.cost > 0) return Math.round(species.cost);

  // A measured price beats a derived one. `npm run calibrate` fights each unit
  // against the ants it would cost and records the break-even; see calibrated.js.
  // Species added since the last calibration simply fall through to the formula.
  const measured = CALIBRATED_COSTS[species.id];
  if (measured) return measured;

  const raw = powerScore(species.stats);
  const utility = UTILITY[species.id] ?? 1.0;

  // A signature ability is worth a flat premium on top of the utility multiplier:
  // even a mediocre one is a second win condition the stat block cannot express.
  const abilityPremium = species.ability ? 1.15 : 1.0;

  // Compression. Raw power spans ~6x across the roster, and prices that span 6x
  // make the draft trivial: the best unit per larva wins and everything else is
  // filler. Pulling the extremes in means a cheap unit is genuinely competitive
  // per point, so a wide squad and a small elite one are both real answers.
  const compressed = Math.pow(raw * utility * abilityPremium, 0.85);

  // Champions are single-purchase leaders, not squad filler. The steeper scale is
  // what stops "one more champion" from being the answer to every draft.
  const tierScale = species.tier === 'champion' ? 0.94 : 0.29;

  return Math.max(1, Math.round(compressed * tierScale));
}

/** Price the whole catalog once: `{ [speciesId]: cost }`. */
export function priceCatalog(catalog) {
  const out = {};
  for (const s of catalog) out[s.id] = costOf(s);
  return out;
}

/** Total cost of a roster map `{ speciesId: count }`. */
export function rosterCost(roster, prices) {
  let total = 0;
  for (const [id, n] of Object.entries(roster)) total += (prices[id] ?? 0) * n;
  return total;
}

/** Total unit count in a roster map. */
export function rosterSize(roster) {
  let n = 0;
  for (const count of Object.values(roster)) n += count;
  return n;
}

/** Roster map -> the `[{species, count}]` shape `teams.custom` expects. */
export function toEngineRoster(roster) {
  return Object.entries(roster)
    .filter(([, n]) => n > 0)
    .map(([species, count]) => ({ species, count }));
}
