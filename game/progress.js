// Campaign progression: what you have cleared, what you own, what you can spend.
//
// This is the single ledger of ownership for the whole game. The campaign is the
// only place species are EARNED, and the battle maker, the sandbox and the
// endless descent all read their draftable pool from here — so "you can only use
// an ant once you have acquired it" is one function (`owns`) rather than a rule
// each screen has to remember to enforce.
//
// Two currencies, doing two different jobs:
//
//   larvae      per-level, granted by the level, spent in the deploy editor and
//               gone when the fight starts. Never banked. This is what keeps a
//               level a designed puzzle instead of a wallet check — a player who
//               grinds cannot buy their way past level 27.
//   royal jelly persistent, earned by winning, spent in the Hatchery on the
//               species the campaign never hands out. This is the thing that
//               grows across the whole game.
//
// Separating them is the reason the difficulty curve in levels.js can be trusted:
// the only variable it does not control is which species the player brings, and
// that is bounded by what the campaign has granted at that point.

import { costOf } from './economy.js';
import { STARTER_SPECIES, campaignGrants } from './levels.js';

/** Star thresholds: fraction of your deployed units still standing at the end. */
const STAR_SURVIVAL = Object.freeze([0, 0.34, 0.6]); // 1★ win, 2★ 34%, 3★ 60%

/** A replay pays a fraction of first-clear coins — enough to farm, not enough to trivialise. */
const REPLAY_RATE = 0.25;

/** Hatchery markup over a species' battle cost, per tier. */
const SHOP_MARKUP = Object.freeze({ soldier: 30, champion: 16 });

/** Rank titles, by levels cleared. Purely for the sense of getting somewhere. */
const RANKS = Object.freeze([
  [0, 'Larva'], [1, 'Forager'], [4, 'Scout'], [7, 'Skirmisher'], [10, 'Raider'],
  [13, 'Warden'], [16, 'Marshal'], [20, 'Broodlord'], [24, 'Nest Sovereign'], [30, 'The Old Queen'],
]);

/** The persisted shape. Anything derived is recomputed, never stored. */
export function emptyCampaign() {
  return {
    coins: 0,
    cleared: {}, // levelIndex -> { stars, plays }
    bought: [], // species ids purchased from the Hatchery
    granted: [], // species ids handed over by cleared levels
    totalKills: 0,
    battlesWon: 0,
  };
}

export class Progress {
  /**
   * @param {object} state   - the persisted campaign blob
   * @param {Array}  levels  - resolved levels from buildLevels()
   * @param {Array}  catalog - the species catalog
   */
  constructor(state, levels, catalog) {
    this.state = { ...emptyCampaign(), ...(state ?? {}) };
    this.levels = levels;
    this.catalog = catalog;
    this.byId = new Map(catalog.map((s) => [s.id, s]));
    // Everything the campaign will EVER hand out, so the Hatchery knows what is
    // not its business to sell. Derived from the level table, so retargeting a
    // grant never leaves a species purchasable and earnable at the same time.
    this.grantable = new Set(campaignGrants());
  }

  toJSON() {
    return { ...this.state };
  }

  // --- ownership -------------------------------------------------------------

  /** Every species the player may field, anywhere in the game. */
  get owned() {
    return new Set([...STARTER_SPECIES, ...this.state.granted, ...this.state.bought]);
  }

  owns(id) {
    return this.owned.has(id);
  }

  /** Owned species as catalog entries, ants first then bugs, alphabetical within. */
  ownedSpecies() {
    const set = this.owned;
    return this.catalog
      .filter((s) => set.has(s.id))
      .sort((a, b) => (a.tier !== b.tier ? (a.tier === 'soldier' ? -1 : 1) : a.name.localeCompare(b.name)));
  }

  // --- levels ----------------------------------------------------------------

  /**
   * Levels are strictly sequential: level N opens when N-1 is cleared, and level
   * 1 is always open. Nothing else gates them — no coin gate, no star gate. A
   * player who is stuck should be stuck on a fight, which they can retry and
   * rebuild for, not on a total they have to go farm somewhere else.
   */
  isUnlocked(index) {
    return index === 1 || this.isCleared(index - 1);
  }

  isCleared(index) {
    return !!this.state.cleared[index];
  }

  starsFor(index) {
    return this.state.cleared[index]?.stars ?? 0;
  }

  get clearedCount() {
    return Object.keys(this.state.cleared).length;
  }

  get totalStars() {
    return Object.values(this.state.cleared).reduce((n, c) => n + (c.stars ?? 0), 0);
  }

  /** The level the player should be pointed at: the first one not yet cleared. */
  get nextLevel() {
    return this.levels.find((lv) => !this.isCleared(lv.index)) ?? null;
  }

  levelAt(index) {
    return this.levels.find((lv) => lv.index === index) ?? null;
  }

  get rank() {
    const n = this.clearedCount;
    let title = RANKS[0][1];
    for (const [need, name] of RANKS) if (n >= need) title = name;
    return title;
  }

  // --- scoring ---------------------------------------------------------------

  /**
   * Stars for a win, from how much of your colony walked out.
   *
   * Survival, not speed or damage: it is the only measure that rewards the thing
   * the deploy editor exists for. Winning with everyone alive means the lineup
   * and the positions were right, and a player who wants 3★ has to actually
   * engage with placement rather than throwing bodies at it.
   */
  static starsFrom(deployed, survivors) {
    if (deployed <= 0) return 1;
    const ratio = survivors / deployed;
    let stars = 1;
    for (let i = 1; i < STAR_SURVIVAL.length; i++) if (ratio >= STAR_SURVIVAL[i]) stars = i + 1;
    return stars;
  }

  /**
   * Record a finished level. Returns a plain report the results screen renders.
   *
   * Idempotent in the way that matters: replaying a cleared level can raise its
   * star count and always pays the replay rate, but it can never re-grant a
   * species or re-pay a first clear.
   */
  completeLevel(index, { won, deployed, survivors, kills }) {
    const level = this.levelAt(index);
    if (!level) return null;

    this.state.totalKills += kills ?? 0;

    if (!won) {
      return { won: false, index, stars: 0, coins: 0, granted: null, firstClear: false, unlockedNext: null };
    }

    const firstClear = !this.isCleared(index);
    // The first chamber this colony has EVER taken — read before the clear is
    // recorded, or it is always false.
    const firstEverClear = firstClear && Object.keys(this.state.cleared).length === 0;
    const stars = Progress.starsFrom(deployed, survivors);
    const prev = this.state.cleared[index] ?? { stars: 0, plays: 0 };

    this.state.cleared[index] = {
      // Never take a star away for a scrappier replay — progress in this game
      // only ever goes forwards.
      stars: Math.max(prev.stars, stars),
      plays: prev.plays + 1,
    };
    this.state.battlesWon += 1;

    const coins = firstClear ? level.coins : Math.max(4, Math.round(level.coins * REPLAY_RATE));
    this.state.coins += coins;

    let granted = null;
    if (firstClear && level.grant && !this.owns(level.grant)) {
      this.state.granted.push(level.grant);
      granted = level.grant;
    }

    const next = this.levelAt(index + 1);
    return {
      won: true,
      index,
      stars,
      improvedStars: stars > prev.stars,
      coins,
      granted,
      firstClear,
      firstEverClear,
      unlockedNext: firstClear && next ? next : null,
      campaignComplete: firstClear && !next,
    };
  }

  // --- the Hatchery ----------------------------------------------------------

  /**
   * What a species costs in royal jelly.
   *
   * Anchored to its battle cost so the shop reprices itself along with balance,
   * and split by tier because a bug that costs 6x an ant in a draft should not
   * cost 6x an ant to OWN — you buy a bug once and field it forever.
   */
  shopPrice(id) {
    const sp = this.byId.get(id);
    if (!sp) return Infinity;
    return costOf(sp) * (SHOP_MARKUP[sp.tier] ?? SHOP_MARKUP.soldier);
  }

  /**
   * The Hatchery stock: every species the campaign will never grant.
   *
   * Deriving it this way means the shop and the campaign can never disagree.
   * Move a species into the level table and it leaves the shop on its own; add a
   * brand-new species to the game and it appears for sale without anyone
   * remembering to list it.
   */
  shopStock() {
    return this.catalog
      .filter((s) => !this.grantable.has(s.id) && !STARTER_SPECIES.includes(s.id))
      .map((s) => ({
        id: s.id,
        name: s.name,
        tier: s.tier,
        price: this.shopPrice(s.id),
        owned: this.owns(s.id),
      }))
      .sort((a, b) => (a.tier !== b.tier ? (a.tier === 'soldier' ? -1 : 1) : a.price - b.price));
  }

  canAfford(id) {
    return this.state.coins >= this.shopPrice(id);
  }

  buy(id) {
    if (this.owns(id)) return { ok: false, reason: 'owned' };
    if (!this.byId.has(id)) return { ok: false, reason: 'unknown' };
    // The shop only sells what the campaign will not give you. Without this a
    // player could buy a level reward early and walk into the level that was
    // meant to teach it holding the answer already.
    if (this.grantable.has(id)) return { ok: false, reason: 'earnable' };
    const price = this.shopPrice(id);
    if (this.state.coins < price) return { ok: false, reason: 'poor' };
    this.state.coins -= price;
    this.state.bought.push(id);
    return { ok: true, price };
  }

  get coins() {
    return this.state.coins;
  }
}
