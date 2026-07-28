// Enemy colony generation.
//
// The opposition drafts from the SAME price list the player does, against a
// budget that grows with depth. That is deliberate: it means difficulty is one
// legible number (how many larvae the enemy got to spend) rather than a pile of
// hidden stat multipliers, and it means every enemy colony is a legal army the
// player could also have built. When a fight feels unfair, the budget curve is
// the single place to look.

import { costOf } from './economy.js';

/** Encounters in a full run. Bosses sit on every DEPTHS/3 step. */
export const RUN_DEPTH = 15;
const BOSS_DEPTHS = new Set([5, 10, 15]);

/** Flavour names, indexed by depth, so encounters read as a journey. */
const COLONY_NAMES = [
  'Scout Party', 'Border Skirmishers', 'Tunnel Raiders', 'Fungus Wardens',
  'The Red Column', 'Carrion Gatherers', 'Deep Nest Sentries', 'Spore Cult',
  'Rival Queen’s Vanguard', 'The Bone Mound', 'Sap Drinkers', 'Glass Tunnel Host',
  'The Drowned Nest', 'Chitin Legion', 'The Old Queen',
];

const BOSS_TITLES = {
  5: 'Warlord of the Red Column',
  10: 'The Bone Mound Sovereign',
  15: 'The Old Queen',
};

export function isBossDepth(depth) {
  return BOSS_DEPTHS.has(depth);
}

/**
 * Larvae the enemy gets to spend at a given depth.
 *
 * Linear, not exponential. An exponential curve makes the last third of a run
 * unwinnable no matter how well the first two thirds went, which reads to a
 * player as the game cheating rather than as a difficulty ramp.
 */
export function enemyBudget(depth, ascension = 0) {
  // Opens well below the player's 60 starting larvae: the first fight should be
  // a win that teaches the loop, not a coin flip that ends the run at depth 1.
  const base = 26 + depth * 14;
  const boss = isBossDepth(depth) ? 1.3 : 1;
  const asc = 1 + ascension * 0.15; // each ascension tier is a flat +15% opposition
  return Math.round(base * boss * asc);
}

/**
 * How many units a colony may field at a given depth.
 *
 * This is the most important number in the game. Without it a winning player
 * accumulates units faster than they lose them, army value runs away from the
 * difficulty curve, and by depth 10 the run is decided — measured at 132 units
 * versus an opposition worth half that. Worse, "buy more ants" stays the correct
 * answer forever, so the roster's 44 species never come into it.
 *
 * With a cap, larvae stop buying MORE and start buying BETTER. Replacing six
 * ants with a champion becomes the natural late-run move, which is exactly the
 * decision the price calibration exists to make interesting.
 */
export function colonyCap(depth) {
  return 14 + depth;
}

/**
 * Larvae awarded for clearing a depth (before mutation bonuses).
 *
 * Priced against the NEXT fight, not the one just won. Paying for the fight
 * already survived looks fairer and plays much worse: a boss chamber is a ~40%
 * jump in opposition, so a colony paid for the ordinary fight behind it arrives
 * at the boss with no way to have prepared, and the run ends to something the
 * player could not see coming. Paying forward means the purse always reflects
 * what is actually about to walk in.
 *
 * The multiplier is set by simulation, not intuition — see tools/simRun.js.
 */
// Set by sweeping tools/tuneIncome.js: 0.50 puts a naive drafter at ~38% runs
// won and 0.58 at ~63%, so the band is narrow and this sits just inside it with
// a little room for a player who drafts better than the baseline.
let rewardMultiplier = 0.52;

/**
 * Tuning hook for tools/tuneIncome.js, which sweeps this value to find the one
 * that lands a naive drafter in the intended 35-50% win band. Not called by the
 * game itself — the shipped value is the default above.
 */
export function setRewardMultiplier(m) {
  rewardMultiplier = m;
}

export function victoryReward(depth, ascension = 0) {
  return Math.max(12, Math.round(rewardMultiplier * enemyBudget(depth + 1, ascension)));
}

/**
 * Draft an enemy colony for `depth`.
 *
 * Composition rule: one ant species as the bulk of the squad, plus champions
 * bought with a slice of the budget that widens as the run goes on. Early fights
 * are therefore readable ant-vs-ant brawls and late ones are champion-led armies,
 * without any of that being special-cased per depth.
 *
 * @param {() => number} rng          - seeded RNG (stable per run+depth)
 * @param {Array} catalog             - registry catalog
 * @param {number} depth
 * @param {number} [ascension]
 * @returns {{ name:string, roster:object, budget:number, buff:object|null, isBoss:boolean, size:number }}
 */
export function generateEnemy(rng, catalog, depth, ascension = 0) {
  const budget = enemyBudget(depth, ascension);
  const isBoss = isBossDepth(depth);

  const soldiers = catalog.filter((s) => s.tier === 'soldier');
  const champions = catalog.filter((s) => s.tier === 'champion');
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  const roster = {};
  const cap = colonyCap(depth);
  let spent = 0;
  let slots = cap;

  // Champions first — they are indivisible, so buying them last would strand
  // larvae on nothing worth having.
  const championShare = Math.min(0.55, 0.15 + depth * 0.03);
  let championPurse = budget * championShare;
  const wantChampions = isBoss ? 2 : depth < 3 ? 0 : 1;

  for (let i = 0; i < wantChampions && slots > 0; i++) {
    const affordable = champions.filter((c) => costOf(c) <= championPurse);
    if (!affordable.length) break;
    const champ = pick(affordable);
    const cost = costOf(champ);
    roster[champ.id] = (roster[champ.id] ?? 0) + 1;
    championPurse -= cost;
    spent += cost;
    slots -= 1;
  }

  // The rest goes into ONE ant species, so the army reads as a recognisable
  // colony rather than a jumble nobody can parse mid-fight.
  //
  // Which ant depends on how much the enemy can afford PER SLOT: with the head-
  // count capped, a deep-run colony with a large budget has to spend it on better
  // ants rather than more of them. That is the same squeeze the player is under,
  // and it is what makes the opposition's composition evolve over a run without
  // any of it being scripted per depth.
  const antBudget = budget - spent;
  const perSlot = antBudget / Math.max(1, slots);
  const affordableAnts = soldiers.filter((s) => costOf(s) <= Math.max(perSlot, 5));
  const pool = affordableAnts.length ? affordableAnts : soldiers;
  // Prefer the priciest ant the per-slot allowance covers, with a random tie-break
  // among the top few so two runs at the same depth are not identical.
  const ranked = [...pool].sort((a, b) => costOf(b) - costOf(a)).slice(0, 4);
  const ant = pick(ranked);
  const antCost = Math.max(1, costOf(ant));
  const antCount = Math.max(3, Math.min(slots, Math.floor(antBudget / antCost)));
  roster[ant.id] = (roster[ant.id] ?? 0) + antCount;
  spent += antCount * antCost;

  // Bosses get a modest colony-wide buff ON TOP of the budget bump. Kept small:
  // the budget is meant to be the difficulty dial, this is just a boss feeling
  // like a boss.
  const buff = isBoss
    ? { damageDealt: 1.12, damageTaken: 0.9, maxHealth: 1.15, label: 'Warlord' }
    : ascension > 0
      ? { damageDealt: 1 + ascension * 0.04, label: 'Hardened' }
      : null;

  const name = isBoss
    ? BOSS_TITLES[depth] ?? 'Warlord'
    : COLONY_NAMES[(depth - 1) % COLONY_NAMES.length];

  return { name, roster, budget, buff, isBoss };
}
