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
    // Px between the two front lines at the opening whistle. This is a PACING
    // control: teams used to spawn against opposite walls and spend the first
    // ~5 seconds walking, which is dead air a short-form viewer won't sit through.
    startGap: 300,
  },

  // Presentation-driven pacing. None of this changes what a species IS — it
  // shapes how a battle READS as a spectacle. Turn `comeback` off for clean
  // balance measurements; leave it on for anything anyone actually watches.
  drama: {
    // Rubber-banding. Without it ~72% of battles were decided the moment one side
    // got ahead: more units means more focus fire, which snowballs. Scaling an
    // outnumbered team's power by its deficit turns those into real fights.
    comeback: true,
    comebackEveryTicks: 20, // how often the deficit is recomputed
    minDeficit: 1.25, // outnumbered by less than this and nothing happens
    fullDeficit: 3, // deficit at which the buff is maxed out
    maxDamageBonus: 1.0, // at an overwhelming deficit: up to +100% damage dealt
    maxResist: 0.4, // ...and up to 40% less damage taken
  },

  // Default behaviour: colonies FORAGE first and only fight enemies that stray
  // into range (see MODES.PASSIVE). This reads as two colonies gathering food and
  // skirmishing when they meet, rather than a straight-line brawl. 'aggressive'
  // (hunt-on-sight) is still selectable from the UI.
  mode: 'passive', // 'aggressive' | 'passive'

  food: {
    initial: 8, // food pellets present at battle start (kept sparse on purpose)
    spawnEveryTicks: 75, // spawn one pellet this often (0 disables mid-battle spawns)
    maxOnField: 18,
    healAmount: 12, // HP restored when an agent eats
    size: 7, // pellet radius
    // Colony growth: every `reinforceEvery` food a colony consumes (cumulative),
    // a fresh unit marches in from its home wall. Usually a soldier ant, but with
    // `bugChance` probability a champion-tier BUG is born to fight for them instead.
    reinforceEvery: 4,
    bugChance: 0.05, // 5% chance a reinforcement is a bug rather than an ant
  },

  combat: {
    friendlyFire: false, // reserved: species AoE hooks respect team by default
  },

  // Colony-wide modifiers applied to EVERY unit a team fields — the hook the
  // campaign layer hangs mutations and enemy difficulty on. Null means "no buff",
  // which is what a plain sandbox battle always uses.
  //
  //   teamBuffs: { A: { damageDealt: 1.2, damageTaken: 0.9, speed: 1.1,
  //                     maxHealth: 1.15, label: 'Chitin Plating' }, B: null }
  //
  // Applied in `_spawnAgent`, so reinforcements and summoned brood inherit it too
  // — a buff that only covered the opening lineup would quietly decay as a colony
  // replaced its losses.
  teamBuffs: { A: null, B: null },

  // Hard ceiling on living agents. Reinforcements and species SUMMON abilities
  // (e.g. a queen's brood) both respect it, so no combination of growth can grind
  // the simulation to a halt.
  maxAgents: 220,

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
