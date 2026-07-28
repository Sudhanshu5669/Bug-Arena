// Colony mutations — the between-battle choice that makes two runs differ.
//
// Every mutation is DATA, not code: each declares what it changes and the run
// layer folds them together into a battle config. That keeps them composable
// (twelve stacked mutations are just twelve multiplications) and means a new one
// is an entry in this array, never a change to the engine.
//
// Four channels, matching the four things a colony can actually improve:
//   buff    -> per-unit combat multipliers (rides engine `teamBuffs`)
//   config  -> battle rules: food, reinforcement rate, unit ceiling
//   economy -> larvae income and draft discounts
//   flag    -> one-off behaviours the run layer special-cases
//
// Balance note: multipliers stay small (8-20%). They stack multiplicatively over
// a ~15-battle run, so a "+35% damage" mutation that looks exciting in isolation
// compounds into an unloseable run by depth 10.

/**
 * @typedef {object} Mutation
 * @property {string} id
 * @property {string} name
 * @property {string} text        - player-facing description
 * @property {string} [rarity]    - 'common' | 'rare' (rare ones are gated by depth)
 * @property {object} [buff]      - { damageDealt, damageTaken, speed, maxHealth }
 * @property {object} [config]    - deep-merged onto the battle config
 * @property {object} [economy]   - { winBonus, perKill, soldierDiscount, championDiscount }
 * @property {string} [flag]      - named one-off handled by the run layer
 */

/** @type {Mutation[]} */
export const MUTATIONS = [
  // --- Combat: straightforward stat lines ------------------------------------
  {
    id: 'chitin',
    name: 'Chitin Plating',
    text: 'Every unit takes 12% less damage.',
    buff: { damageTaken: 0.88 },
  },
  {
    id: 'venom',
    name: 'Venom Glands',
    text: 'Every unit deals 18% more damage.',
    buff: { damageDealt: 1.18 },
  },
  {
    id: 'jelly',
    name: 'Royal Jelly',
    text: 'Every unit has 20% more health.',
    buff: { maxHealth: 1.2 },
  },
  {
    id: 'frenzy',
    name: 'Frenzied Metabolism',
    text: 'Units move 22% faster, but take 6% more damage.',
    buff: { speed: 1.22, damageTaken: 1.06 },
  },
  {
    id: 'carapace',
    name: 'Heavy Carapace',
    text: '16% more health, 6% slower.',
    buff: { maxHealth: 1.16, speed: 0.94 },
  },
  {
    id: 'bloodrage',
    name: 'Blood Rage',
    text: '32% more damage dealt — and 14% more taken.',
    rarity: 'rare',
    buff: { damageDealt: 1.32, damageTaken: 1.14 },
  },

  // --- Growth: the colony out-produces its losses ----------------------------
  {
    id: 'brood',
    name: 'Rapid Brood',
    text: 'Reinforcements arrive for every 3 food eaten instead of 4.',
    config: { food: { reinforceEvery: 3 } },
  },
  {
    id: 'hivemind',
    name: 'Hive Mind',
    text: 'Reinforcements are a champion bug 25% of the time (up from 5%).',
    rarity: 'rare',
    config: { food: { bugChance: 0.25 } },
  },
  {
    id: 'larder',
    name: 'Deep Larder',
    text: 'The arena starts with 16 food instead of 8.',
    config: { food: { initial: 16 } },
  },
  {
    id: 'tunnels',
    name: 'Bountiful Tunnels',
    text: 'Food appears twice as often.',
    config: { food: { spawnEveryTicks: 38, maxOnField: 26 } },
  },
  {
    id: 'symbiosis',
    name: 'Fungal Symbiosis',
    text: 'Eating heals 22 instead of 12.',
    config: { food: { healAmount: 22 } },
  },
  {
    id: 'column',
    name: 'Endless Column',
    text: 'Your colony can field 80 more units before hitting the ceiling.',
    config: { maxAgents: 300 },
  },

  // --- Economy: fewer larvae spent is more units fielded ----------------------
  {
    id: 'foragers',
    name: 'Efficient Foragers',
    text: '+8 larvae after every victory.',
    economy: { winBonus: 8 },
  },
  {
    id: 'scavengers',
    name: 'Scavengers',
    text: '+1 larva for every enemy your colony kills.',
    economy: { perKill: 1 },
  },
  {
    id: 'swarmdoc',
    name: 'Swarm Doctrine',
    text: 'Ants cost 2 less larvae (minimum 1).',
    economy: { soldierDiscount: 2 },
  },
  {
    id: 'championbond',
    name: "Champion's Bond",
    text: 'Bugs cost 7 less larvae.',
    economy: { championDiscount: 7 },
  },

  // --- Doctrine: change how the fight is fought ------------------------------
  {
    id: 'ambush',
    name: 'Ambush Instinct',
    text: 'Your colony hunts on sight and deals 10% more damage.',
    buff: { damageDealt: 1.1 },
    config: { mode: 'aggressive' },
  },
  {
    id: 'lastditch',
    name: 'Last Ditch',
    text: 'Being outnumbered empowers your colony far more than usual.',
    config: { drama: { maxDamageBonus: 1.6, maxResist: 0.55, minDeficit: 1.1 } },
  },

  // --- Special --------------------------------------------------------------
  {
    id: 'deathless',
    name: 'Deathless Queen',
    text: 'Survive one defeat. The colony regroups instead of dying.',
    rarity: 'rare',
    flag: 'extraLife',
  },
];

/** Mutations that only appear from this depth onward (they are run-defining). */
const RARE_MIN_DEPTH = 4;

/**
 * Fold a list of taken mutations into the numbers the run layer needs.
 * Multipliers COMPOUND (0.88 twice = 0.774), which is what makes stacking a real
 * strategy rather than a list of unrelated bonuses.
 */
export function foldMutations(taken) {
  const buff = { damageDealt: 1, damageTaken: 1, speed: 1, maxHealth: 1 };
  const economy = { winBonus: 0, perKill: 0, soldierDiscount: 0, championDiscount: 0 };
  const flags = new Set();
  const configPatches = [];

  for (const m of taken) {
    if (m.buff) {
      for (const key of Object.keys(buff)) {
        if (m.buff[key] != null) buff[key] *= m.buff[key];
      }
    }
    if (m.economy) {
      for (const key of Object.keys(economy)) {
        if (m.economy[key] != null) economy[key] += m.economy[key];
      }
    }
    if (m.config) configPatches.push(m.config);
    if (m.flag) flags.add(m.flag);
  }

  return { buff, economy, flags, configPatches };
}

/**
 * Offer `count` distinct mutations the player does not already own.
 *
 * Draws from the run's seeded RNG so a given run seed always offers the same
 * choices in the same order — the property that makes a run shareable and a
 * daily challenge possible.
 *
 * @param {() => number} rng     - seeded RNG in [0,1)
 * @param {string[]} ownedIds
 * @param {number} depth
 * @param {number} [count]
 */
export function offerMutations(rng, ownedIds, depth, count = 3) {
  const owned = new Set(ownedIds);
  const pool = MUTATIONS.filter((m) => {
    if (owned.has(m.id)) return false;
    if (m.rarity === 'rare' && depth < RARE_MIN_DEPTH) return false;
    return true;
  });

  // Fisher-Yates over a copy, then take the first `count`. Shuffling rather than
  // sampling-with-rejection keeps the RNG draw count fixed per call, so the
  // sequence stays stable regardless of how many mutations the player owns.
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/** Look one up by id (used when restoring a saved run). */
export function mutationById(id) {
  return MUTATIONS.find((m) => m.id === id) ?? null;
}
