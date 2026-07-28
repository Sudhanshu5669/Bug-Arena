// The run — the state machine the whole game is.
//
//   draft  -> spend larvae on units
//   battle -> the simulation runs the colony you built
//   reward -> survivors return, larvae are paid, one mutation is chosen
//   ...and back to draft one depth deeper, until depth 15 or a defeat.
//
// The colony PERSISTS across battles: what survives a fight is what starts the
// next one. That single rule is what turns a fight generator into a game — a
// victory that costs eleven ants is a real setback, so "how cheaply did I win"
// matters as much as "did I win", and every draft is a decision about attrition
// rather than a fresh optimisation puzzle.
//
// Everything random derives from `seed` + `depth`, never from Math.random. A run
// is therefore fully reconstructible from its saved scalar state, which is what
// makes reload-safety and shareable seeds fall out for free.

import { makeRng } from '../engine/rng.js';
import { costOf, rosterCost, rosterSize, toEngineRoster } from './economy.js';
import { RUN_DEPTH, colonyCap, generateEnemy, isBossDepth, victoryReward } from './campaign.js';
import { foldMutations, mutationById, offerMutations } from './mutations.js';

export { RUN_DEPTH };

/** Larvae the colony is founded with. Tuned to afford ~one champion + a squad. */
const STARTING_LARVAE = 60;

/**
 * The colony you can draft from before anything is unlocked. Deliberately small
 * and deliberately varied — a first-time player should meet a manageable set of
 * clearly different options, not 44 cards.
 */
export const STARTER_POOL = Object.freeze([
  'fireAnt', 'bulletAnt', 'workerAnt', 'armyAnt', 'carpenterAnt', 'leafcutterAnt',
  'spider', 'mantis', 'scorpion', 'beetle',
]);

/**
 * What clearing each depth unlocks, permanently, across all future runs. This is
 * the reason to start run #2: the roster visibly grows even after a loss.
 */
export const UNLOCK_BY_DEPTH = Object.freeze({
  1: 'trapjawAnt', 2: 'honeypotAnt', 3: 'weaverAnt', 4: 'widow',
  5: 'harvesterAnt', 6: 'draculaAnt', 7: 'hornet', 8: 'turtleAnt',
  9: 'centipede', 10: 'pharaohAnt', 11: 'jumpingSpider', 12: 'amazonAnt',
  13: 'antlion', 14: 'argentineAnt', 15: 'jewelWasp',
});

export class Run {
  constructor(state, catalog) {
    this.catalog = catalog;
    this.byId = new Map(catalog.map((s) => [s.id, s]));
    Object.assign(this, state);
  }

  // --- lifecycle -------------------------------------------------------------

  /** Begin a fresh run. `unlocked` comes from meta-progression. */
  static create({ seed, catalog, unlocked = [], ascension = 0 }) {
    return new Run(
      {
        seed: seed >>> 0,
        depth: 1,
        phase: 'draft',
        larvae: STARTING_LARVAE,
        roster: {},
        mutationIds: [],
        unlocked: [...new Set([...STARTER_POOL, ...unlocked])],
        ascension,
        revivedThisRun: false,
        stats: { kills: 0, battlesWon: 0, larvaeEarned: STARTING_LARVAE },
        lastResult: null,
      },
      catalog
    );
  }

  /** Rehydrate a saved run. Everything derived is recomputed, never stored. */
  static restore(saved, catalog) {
    return new Run({ ...saved }, catalog);
  }

  /** The scalar state worth persisting (no catalog, no derived values). */
  toJSON() {
    return {
      seed: this.seed,
      depth: this.depth,
      phase: this.phase,
      larvae: this.larvae,
      roster: { ...this.roster },
      mutationIds: [...this.mutationIds],
      unlocked: [...this.unlocked],
      ascension: this.ascension,
      revivedThisRun: this.revivedThisRun,
      stats: { ...this.stats },
      lastResult: this.lastResult,
    };
  }

  // --- derived state ---------------------------------------------------------

  get mutations() {
    return this.mutationIds.map(mutationById).filter(Boolean);
  }

  get folded() {
    return foldMutations(this.mutations);
  }

  get isBoss() {
    return isBossDepth(this.depth);
  }

  /** Species the player may draft, in a stable display order. */
  get available() {
    const set = new Set(this.unlocked);
    return this.catalog
      .filter((s) => set.has(s.id))
      .sort((a, b) => (a.tier !== b.tier ? (a.tier === 'soldier' ? -1 : 1) : a.name.localeCompare(b.name)));
  }

  /** Current prices, with mutation discounts applied. Never below 1. */
  get prices() {
    const { economy } = this.folded;
    const out = {};
    for (const s of this.catalog) {
      const discount = s.tier === 'champion' ? economy.championDiscount : economy.soldierDiscount;
      out[s.id] = Math.max(1, costOf(s) - discount);
    }
    return out;
  }

  get armyValue() {
    return rosterCost(this.roster, this.prices);
  }

  get armySize() {
    return rosterSize(this.roster);
  }

  // --- draft -----------------------------------------------------------------

  /** How many units the nest can support at this depth. */
  get cap() {
    return colonyCap(this.depth);
  }

  get atCap() {
    return this.armySize >= this.cap;
  }

  canAfford(speciesId) {
    return this.larvae >= (this.prices[speciesId] ?? Infinity);
  }

  buy(speciesId) {
    if (this.phase !== 'draft') return false;
    if (this.atCap) return false;
    const price = this.prices[speciesId];
    if (price == null || this.larvae < price) return false;
    this.larvae -= price;
    this.roster[speciesId] = (this.roster[speciesId] ?? 0) + 1;
    return true;
  }

  /** Refund at full price — the draft is a planning step, not a commitment. */
  sell(speciesId) {
    if (this.phase !== 'draft') return false;
    if (!this.roster[speciesId]) return false;
    this.roster[speciesId] -= 1;
    if (this.roster[speciesId] <= 0) delete this.roster[speciesId];
    this.larvae += this.prices[speciesId] ?? 0;
    return true;
  }

  // --- battle ----------------------------------------------------------------

  /** Per-depth RNG. Stable across saves: same run + same depth = same fight. */
  _rngFor(depth, salt = 0) {
    return makeRng((this.seed + depth * 7919 + salt * 104729) >>> 0);
  }

  /** The enemy for the current depth (regenerated, never stored). */
  get enemy() {
    return generateEnemy(this._rngFor(this.depth), this.catalog, this.depth, this.ascension);
  }

  /**
   * Build the full engine config for this depth's battle.
   * Mutation config patches are applied in the order they were taken, then the
   * rosters and team buffs are layered on top.
   */
  battleConfig() {
    const { buff, configPatches } = this.folded;
    const enemy = this.enemy;

    let config = {
      // A fixed seed per depth means the fight you retry is the fight you lost,
      // not a fresh roll of the dice.
      seed: (this.seed + this.depth * 31337) >>> 0,
      mode: 'passive',
      teams: {
        custom: {
          A: toEngineRoster(this.roster),
          B: toEngineRoster(enemy.roster),
        },
      },
      teamBuffs: {
        A: {
          damageDealt: buff.damageDealt,
          damageTaken: buff.damageTaken,
          speed: buff.speed,
          maxHealth: buff.maxHealth,
          label: 'Mutations',
        },
        B: enemy.buff,
      },
    };

    // Mutation config patches are merged shallowly-per-key here; the engine's own
    // `mergeConfig` handles the deep merge onto defaults when it resolves this.
    for (const patch of configPatches) {
      config = mergeShallowDeep(config, patch);
    }
    return config;
  }

  /** Move into the battle phase. Returns the config to hand the engine. */
  beginBattle() {
    if (this.phase !== 'draft') return null;
    if (this.armySize === 0) return null;
    this.phase = 'battle';
    return this.battleConfig();
  }

  /**
   * Fold a finished battle back into the run.
   *
   * The surviving roster is read from the engine summary's per-species `alive`
   * counts, which is the whole reason attrition works without the run layer
   * tracking individual units.
   */
  resolveBattle(summary) {
    if (this.phase !== 'battle') return null;

    const mine = summary.teams?.A ?? { species: {}, kills: 0 };
    const survivors = {};
    for (const [id, rec] of Object.entries(mine.species ?? {})) {
      if (rec.alive > 0) survivors[id] = rec.alive;
    }

    const won = summary.winner === 'A';
    const kills = mine.kills ?? 0;
    this.stats.kills += kills;

    if (!won) {
      // Deathless Queen: one defeat per run is survivable, and it costs the
      // colony its dead all the same — a reprieve, not an undo.
      const canRevive = this.folded.flags.has('extraLife') && !this.revivedThisRun;
      if (canRevive) {
        this.revivedThisRun = true;
        this.roster = survivors;
        this.phase = 'draft';
        this.lastResult = { won: false, revived: true, survivors, kills, larvae: 0, summary: slim(summary) };
        // A revived colony that lost everything still needs something to field.
        if (rosterSize(this.roster) === 0) this.larvae += 30;
        return this.lastResult;
      }
      this.phase = 'lost';
      this.lastResult = { won: false, revived: false, survivors, kills, larvae: 0, summary: slim(summary) };
      return this.lastResult;
    }

    const { economy } = this.folded;
    const larvae = victoryReward(this.depth, this.ascension) + economy.winBonus + economy.perKill * kills;

    this.roster = survivors;
    this.larvae += larvae;
    this.stats.battlesWon += 1;
    this.stats.larvaeEarned += larvae;

    const unlockedNow = UNLOCK_BY_DEPTH[this.depth];
    if (unlockedNow && !this.unlocked.includes(unlockedNow)) this.unlocked.push(unlockedNow);

    this.phase = this.depth >= RUN_DEPTH ? 'won' : 'reward';
    this.lastResult = {
      won: true,
      revived: false,
      survivors,
      kills,
      larvae,
      unlocked: unlockedNow ?? null,
      summary: slim(summary),
    };
    return this.lastResult;
  }

  // --- reward ----------------------------------------------------------------

  /** The three mutations on offer after this depth. Stable per run+depth. */
  get mutationOffer() {
    return offerMutations(this._rngFor(this.depth, 1), this.mutationIds, this.depth, 3);
  }

  /** Take a mutation and advance to the next depth's draft. */
  chooseMutation(id) {
    if (this.phase !== 'reward') return false;
    const offered = this.mutationOffer.some((m) => m.id === id);
    if (!offered) return false;
    this.mutationIds.push(id);
    this.depth += 1;
    this.phase = 'draft';
    return true;
  }

  /** Decline the mutation choice — some players would rather bank the larvae. */
  skipMutation() {
    if (this.phase !== 'reward') return false;
    this.larvae += 12;
    this.depth += 1;
    this.phase = 'draft';
    return true;
  }
}

/** Trim an engine summary down to what a save or a results screen actually needs. */
function slim(summary) {
  return {
    winner: summary.winner,
    reason: summary.reason,
    durationSeconds: summary.durationSeconds,
    totalKills: summary.totalKills,
  };
}

/** Deep-merge plain objects; arrays and scalars replace wholesale. */
function mergeShallowDeep(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') {
      out[k] = mergeShallowDeep(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
