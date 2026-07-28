// The campaign — 30 levels, as data.
//
// A level is ONE LINE. Everything a level needs that can be computed is computed:
// the player's larvae budget is derived from what the opposition actually costs,
// the unit cap, the coin payout, the seed and the boss flag all come off the
// level's index. So the table below carries only what a human has to decide —
// what the fight is called, what walks in, and what beating it hands you.
//
// That is the whole scalability story. Appending level 31 is:
//
//   L('The Drowned Gallery', 'waterBug:2, turtleAnt:12', 'velvetWorm'),
//
// ...and nothing else changes. No budget to hand-tune, no id to keep in sync, no
// unlock table to edit, no screen to touch. Thirty levels cost about thirty lines
// because the only thing stored per level is the part that is genuinely unique.
//
// Difficulty comes from ONE dial: `slack`, the ratio of the player's budget to
// the enemy's cost. It opens at 1.45 (you may outspend them by half again while
// you are learning) and closes to 0.95 by level 30 (you must out-BUILD them,
// because you can no longer out-buy them). Every level sits on that curve unless
// it explicitly says otherwise, so the ramp is legible in one number instead of
// smeared across thirty hand-written budgets.

import { costOf } from './economy.js';

/** Levels between bosses. Every Nth level is a boss; nothing else marks them. */
const BOSS_EVERY = 5;

/**
 * Parse the roster mini-notation: `'fireAnt:4, spider:1'` -> `{fireAnt:4, spider:1}`.
 * Terse on purpose — the table is meant to be read as a list of fights, and
 * thirty nested object literals is not that.
 */
function parseRoster(spec) {
  const out = {};
  for (const part of String(spec).split(',')) {
    const [id, n] = part.trim().split(':');
    if (!id) continue;
    out[id] = (out[id] ?? 0) + (Number.parseInt(n, 10) || 1);
  }
  return out;
}

/**
 * One row of the table. Index, and everything derived from it, is filled in later.
 *
 * `extra` is the escape hatch for the handful of levels the curve gets wrong.
 * The one worth knowing is `slack`, which overrides the budget ratio for this
 * level alone:
 *
 *   L('Ambush Canopy', 'jumpingSpider:3, bulldogAnt:10', 'jumpingSpider', { slack: 1.3 })
 *
 * Use it when tools/campaignProbe.js reports a WALL. Some compositions simply
 * fight above their price tag — three Jumping Spiders land the biggest hit in
 * the game, and eighteen Jack Jumpers are 35%-damage-taken evasion at ant prices
 * — and the honest fix is to say so on that one line rather than to reprice the
 * species everywhere or to leave a level nobody can pass.
 */
function L(name, foe, grant, extra = null) {
  return { name, foe, grant, extra };
}

// ---------------------------------------------------------------------------
// The table. Column 3 is what clearing the level permanently hands the player —
// that species becomes draftable here, in the battle maker, and in the sandbox.
//
// Note the rhythm: most levels field a species the player does NOT own yet and
// wins them exactly that species. You fight a thing, you learn what it does to
// you, and then it is yours. Bosses (every 5th) are the payoff picks.
// ---------------------------------------------------------------------------
const TABLE = [
  L('The Feeding Line',        'fireAnt:4',                            'armyAnt'),
  L('Border Patrol',           'fireAnt:5, workerAnt:2',               'bulletAnt'),
  L('The Red Column',          'armyAnt:8',                            'leafcutterAnt'),
  L('Sap Thieves',             'fireAnt:6, armyAnt:4',                 'scorpion'),
  L('Warden of the Shallows',  'bulletAnt:6, scorpion:1',              'carpenterAnt'),

  L('Rot Gatherers',           'leafcutterAnt:6, armyAnt:6',           'trapjawAnt'),
  L('The Snapping Ranks',      'trapjawAnt:8, fireAnt:4',              'jewelWasp'),
  // Worker Ants are the roster's deliberate floor, so pricing a colony of them
  // inflates its "value" with units that cannot fight — the player got a budget
  // calibrated against 10 bodies and met almost no resistance. Composition was
  // the bug, not the budget.
  L('Husk Cult',               'zombieAnt:8, scorpion:2',              'harvesterAnt'),
  L('The Gilded Larder',       'honeypotAnt:5, bulletAnt:6',           'honeypotAnt'),
  L('The Silk Vault',          'spider:2, leafcutterAnt:8',            'spider'),

  L('Formic Haze',             'crazyAnt:10, armyAnt:6',               'crazyAnt'),
  L('Hive Sortie',             'hornet:2, fireAnt:8',                  'hornet'),
  L('The Lone Hunters',        'bulldogAnt:10, jewelWasp:1',           'bulldogAnt'),
  L('The Gatehouse',           'turtleAnt:8, carpenterAnt:6',          'turtleAnt'),
  L('Blades of the Deep Nest', 'mantis:2, bulletAnt:8',                'mantis'),

  L('Silk Anchorage',          'weaverAnt:10, spider:1',               'weaverAnt'),
  L('The Slow Death',          'assassinBug:2, zombieAnt:8',           'assassinBug'),
  L('Blood Tithe',             'draculaAnt:12, hornet:1',              'draculaAnt'),
  L('The Tumbling Ranks',      'acrobatAnt:12, mantis:1',              'acrobatAnt'),
  L('The Coil',                'centipede:2, bulletAnt:10, spider:1',  'centipede'),

  L('Spore Cult',              'zombieAnt:14, assassinBug:1',          'zombieAnt'),
  L('The Widow’s Court',       'widow:2, weaverAnt:10',                'widow'),
  L('Pillagers',               'amazonAnt:14, centipede:1',            'amazonAnt'),
  L('Ambush Canopy',           'jumpingSpider:3, bulldogAnt:10',       'jumpingSpider', { slack: 1.35 }),
  L('The Iron Carapace',       'beetle:2, turtleAnt:10, carpenterAnt:6', 'beetle'),

  L('Trail of Marks',          'argentineAnt:16, widow:1',             'argentineAnt'),
  L('The Paralytic Choir',     'tarantulaHawk:3, harvesterAnt:12',     'tarantulaHawk'),
  L('Erratic Legion',          'jackJumperAnt:18, hornet:2',           'jackJumperAnt', { slack: 1.3 }),
  L('The Sand Pit',            'antlion:2, trapjawAnt:14, spider:1',   'antlion'),
  L('The Old Queen',           'queenAnt:2, bulletAnt:12, mantis:2, spider:2', 'queenAnt'),
];

/**
 * Species the player owns before the campaign starts.
 *
 * Two, and only two. A first-time player should meet the drag-and-drop editor
 * with a decision small enough to not be a decision — the whole first level is
 * "put some ants down and press fight". Everything else is earned.
 */
export const STARTER_SPECIES = Object.freeze(['fireAnt', 'workerAnt']);

/** How generous the player's budget is relative to the enemy's, by level. */
function slackFor(index, isBoss) {
  const t = (index - 1) / Math.max(1, TABLE.length - 1); // 0 at L1 -> 1 at L30
  const base = 1.45 - 0.5 * t;
  // A boss is a boss because you get less rope, not because it cheats harder.
  return isBoss ? base * 0.97 : base;
}

/**
 * Boss colonies fight a little above their price tag.
 *
 * Deliberately small. The budget ratio is meant to be the difficulty dial — this
 * exists so a boss FEELS like one, not so it becomes a different kind of fight.
 */
const BOSS_BUFF = Object.freeze({ damageDealt: 1.1, damageTaken: 0.92, maxHealth: 1.12, label: 'Warlord' });

/** Cost of a roster map, in larvae. */
function rosterValue(roster, priceOf) {
  let total = 0;
  for (const [id, n] of Object.entries(roster)) total += priceOf(id) * n;
  return total;
}

/**
 * Resolve the full level list.
 *
 * @param {(id:string) => object|null} lookup - species config by id (registry-backed)
 * @returns {Array} levels with everything derived filled in
 */
export function buildLevels(lookup) {
  const priceOf = (id) => {
    const sp = lookup(id);
    return sp ? costOf(sp) : 0;
  };

  return TABLE.map((row, i) => {
    const index = i + 1;
    const isBoss = index % BOSS_EVERY === 0;
    const roster = parseRoster(row.foe);

    // Drop anything that does not resolve rather than shipping a level that
    // cannot start. A typo in the table costs one enemy unit and a console
    // warning, not a black screen on level 17 for somebody else.
    for (const id of Object.keys(roster)) {
      if (!lookup(id)) {
        console.warn(`[levels] level ${index} ("${row.name}") names unknown species "${id}" — skipping it.`);
        delete roster[id];
      }
    }

    const enemyValue = rosterValue(roster, priceOf);
    const enemySize = Object.values(roster).reduce((n, c) => n + c, 0);
    const slack = row.extra?.slack ?? slackFor(index, isBoss);

    const derived = {
      id: `lv${index}`,
      index,
      name: row.name,
      isBoss,
      enemy: roster,
      enemyValue,
      // Budget follows what the enemy actually costs, so retuning a species'
      // price retunes every level that fields it — automatically, and in the
      // right direction.
      budget: Math.max(12, Math.round(enemyValue * slack)),
      slack,
      // Headroom over the enemy's headcount: you may always field a few more
      // bodies than they do, which keeps a cheap-and-wide build legal at every
      // level instead of only the ones whose budget happens to allow it.
      cap: Math.max(6, enemySize + 4 + Math.floor(index / 3)),
      grant: row.grant ?? null,
      // First clear pays properly; see progress.js for the replay rate.
      coins: 40 + index * 12,
      // Fixed per level: the fight you retry is the fight you lost. A campaign
      // level that rerolled itself on defeat would make learning it impossible.
      seed: (1000 + index * 7919) >>> 0,
      buff: isBoss ? BOSS_BUFF : null,
    };

    return row.extra ? { ...derived, ...row.extra } : derived;
  });
}

/** How many levels the campaign has. */
export const LEVEL_COUNT = TABLE.length;

/** Every species the campaign hands out, in the order it hands them out. */
export function campaignGrants() {
  return TABLE.map((r) => r.grant).filter(Boolean);
}
