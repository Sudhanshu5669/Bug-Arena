// Default battle configuration + a deep-merge helper.
//
// Everything that shapes a battle lives here as plain data. `runBattle(config)`
// (and, later, `POST /api/simulate`) will accept a partial override object that
// is deep-merged onto these defaults — nothing about a battle is hardcoded in
// the engine itself.

export const DEFAULT_CONFIG = Object.freeze({
  // null => a fresh random seed is chosen and recorded in the summary, so any
  // battle can be replayed deterministically by passing its seed back in.
  seed: null,

  arena: {
    width: 960,
    height: 600,
    wallThickness: 24,
  },

  teams: {
    // Each team = a randomized SQUAD of soldier-tier bugs + a fixed number of
    // champion-tier bugs leading them. Everything is tier-driven; no species
    // names are hardcoded here or in the engine.
    soldiers: { min: 7, max: 12 }, // random squad size per team (inclusive range)
    champions: 1, // champion-tier units per team (each an independent random pick)
    // Eligible species per tier. null => all registered species of that tier.
    soldierPool: null,
    championPool: null,
  },

  mode: 'aggressive', // 'aggressive' | 'passive'

  food: {
    initial: 16, // food pellets present at battle start
    spawnEveryTicks: 60, // spawn one pellet this often (0 disables mid-battle spawns)
    maxOnField: 40,
    healAmount: 12, // HP restored when an agent eats
    size: 5, // pellet radius
  },

  combat: {
    friendlyFire: false, // reserved: species AoE hooks respect team by default
  },

  tickRate: 60, // simulation ticks per second (also drives the physics substep)
  maxTicks: 60 * 100, // hard cap (~100s) → timeout win condition if nobody wins first
});

/** True for plain objects we should recurse into during merge (not arrays). */
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Recursively merge `override` onto a deep clone of `base`. Arrays are replaced wholesale. */
export function mergeConfig(base, override = {}) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const key of Object.keys(override)) {
    const o = override[key];
    if (isPlainObject(o) && isPlainObject(out[key])) {
      out[key] = mergeConfig(out[key], o);
    } else {
      out[key] = o;
    }
  }
  return out;
}

/** Resolve a full config from a partial override object. */
export function resolveConfig(override = {}) {
  return mergeConfig(DEFAULT_CONFIG, override);
}
