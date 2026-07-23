// Central species registry (the factory the engine spawns from).
//
// Species modules call `registerSpecies(config)` on load. The engine asks the
// registry for configs by id and never imports species files directly — so
// adding a species is: create one file + register it. Nothing else changes.

const _species = new Map();

/** Known species tiers. Battle setup pulls per-tier counts from these. */
export const TIERS = Object.freeze({ SOLDIER: 'soldier', CHAMPION: 'champion' });

/** Minimal required stat fields; missing ones throw early with a clear message. */
const REQUIRED_STATS = [
  'maxHealth',
  'speed',
  'size',
  'damage',
  'attackRange',
  'attackCooldown',
  'visionRange',
];

function validate(config) {
  if (!config || typeof config !== 'object') throw new Error('Species config must be an object.');
  if (!config.id) throw new Error('Species config requires an `id`.');
  if (!config.name) throw new Error(`Species "${config.id}" requires a \`name\`.`);
  if (!config.stats) throw new Error(`Species "${config.id}" requires a \`stats\` object.`);
  for (const key of REQUIRED_STATS) {
    if (typeof config.stats[key] !== 'number') {
      throw new Error(`Species "${config.id}" is missing numeric stat \`${key}\`.`);
    }
  }
  if (!config.visual || !config.visual.type) {
    throw new Error(`Species "${config.id}" requires a \`visual\` descriptor with a \`type\`.`);
  }
  if (config.tier && !Object.values(TIERS).includes(config.tier)) {
    throw new Error(
      `Species "${config.id}" has unknown tier "${config.tier}" (expected one of: ${Object.values(TIERS).join(', ')}).`
    );
  }
  // Signature ability is optional, but if present it must follow the standard shape
  // so the engine's hybrid trigger gate can drive it uniformly for every species.
  if (config.ability) {
    const ab = config.ability;
    if (!ab.name) throw new Error(`Species "${config.id}" ability requires a \`name\`.`);
    if (typeof ab.onTrigger !== 'function') {
      throw new Error(`Species "${config.id}" ability requires an \`onTrigger(self, target, ctx)\` function.`);
    }
    if (typeof ab.triggerChance !== 'number' || ab.triggerChance < 0 || ab.triggerChance > 1) {
      throw new Error(`Species "${config.id}" ability \`triggerChance\` must be a number in [0, 1].`);
    }
    if (typeof ab.cooldownSeconds !== 'number' || ab.cooldownSeconds < 0) {
      throw new Error(`Species "${config.id}" ability \`cooldownSeconds\` must be a number >= 0.`);
    }
  }
}

/**
 * Sensible AI defaults by tier, so most species need no `ai` block at all:
 *  - soldiers (ants) forage, herd up when idle, and (in passive mode) only fight
 *    threats that stray into range.
 *  - champions (bugs) don't forage; they hunt on sight, herd toward the biggest
 *    allied cluster between fights, and go berserk as the last one standing.
 * Any field can be overridden per species via its `ai: {...}` block.
 */
function defaultAi(tier) {
  return tier === TIERS.CHAMPION
    ? {
        forages: false,
        herds: true,
        herdWhenExposed: false,
        hunts: true, // seek enemies across full vision, regardless of battle mode
        targetPreference: 'nearest', // 'nearest' | 'isolated'
        loneSurvivorRage: true, // +20% all stats when it's the last of its team
      }
    : {
        forages: true,
        herds: true,
        herdWhenExposed: false,
        hunts: false, // ants use the battle mode (passive = threats only)
        targetPreference: 'nearest',
        loneSurvivorRage: false,
      };
}

/** Fill in optional fields so the engine can call any hook without guarding. */
function normalize(config) {
  const tier = config.tier ?? TIERS.SOLDIER; // default tier: soldier
  return {
    id: config.id,
    name: config.name,
    flavor: config.flavor ?? '',
    tier,
    stats: { ...config.stats },
    visual: { ...config.visual },
    ai: { ...defaultAi(tier), ...(config.ai ?? {}) },
    hooks: { ...(config.hooks ?? {}) },
    ability: config.ability ? { ...config.ability } : null,
  };
}

/**
 * Register (or overwrite) a species. Returns the id for convenience.
 * @param {object} config
 */
export function registerSpecies(config) {
  validate(config);
  if (_species.has(config.id)) {
    // Overwriting is allowed (handy for hot-reload/tests) but worth surfacing.
    console.warn(`[registry] species "${config.id}" re-registered; overwriting previous config.`);
  }
  _species.set(config.id, normalize(config));
  return config.id;
}

export function getSpecies(id) {
  const s = _species.get(id);
  if (!s) throw new Error(`Unknown species "${id}". Registered: [${listSpecies().join(', ')}]`);
  return s;
}

export function hasSpecies(id) {
  return _species.has(id);
}

export function listSpecies() {
  return [..._species.keys()];
}

/** Ids of every registered species of a given tier (e.g. 'soldier' | 'champion'). */
export function listByTier(tier) {
  return allSpecies()
    .filter((s) => s.tier === tier)
    .map((s) => s.id);
}

export function allSpecies() {
  return [..._species.values()];
}

/**
 * The renderer-facing catalog: id -> visual + display meta + stats. A renderer
 * uses this (from the engine's init payload) to resolve how each species looks.
 */
export function getCatalog() {
  return allSpecies().map((s) => ({
    id: s.id,
    name: s.name,
    flavor: s.flavor,
    tier: s.tier,
    visual: s.visual,
    stats: s.stats,
    ability: s.ability
      ? {
          name: s.ability.name,
          triggerChance: s.ability.triggerChance,
          cooldownSeconds: s.ability.cooldownSeconds,
          description: s.ability.description ?? '',
        }
      : null,
  }));
}

/** Clear the registry (test helper). */
export function clearRegistry() {
  _species.clear();
}
