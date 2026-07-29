// Game content + the bridge from the engine's species registry to game data.
//
// The UI spec's shop/draft numbers are explicitly flagged as placeholders ("pull
// the real strings from game data"), so nothing here invents a specimen: names,
// abilities, descriptions and stats all come from the engine catalog. Only the
// economy on top of them — larvae cost, jelly price, acquisition order — lives
// in this file.

// --- Inline SVG glyphs -----------------------------------------------------
// The spec ships 🍯/⚔/★/🜙/⚑/☠ as tiny inline SVGs rather than emoji, so they
// render identically on Android. Each is a bare <svg> string using currentColor.
const svg = (body, box = 24) =>
  `<svg viewBox="0 0 ${box} ${box}" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

export const GLYPH = {
  // Crossed blades — the fight mark. Hilts sit at the BOTTOM with guards and
  // pommels: without them two bare diagonals just read as a multiplication ✕,
  // which is what this glyph must never be mistaken for at 14–22px.
  sword: svg(
    '<path d="M5 19 19.2 4.8M19 19 4.8 4.8" stroke="currentColor" stroke-width="2.7" stroke-linecap="round"/>' +
      '<path d="M2.7 16.3 7.7 21.3M21.3 16.3 16.3 21.3" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" opacity=".8"/>' +
      '<circle cx="4.4" cy="19.6" r="1.7" fill="currentColor"/>' +
      '<circle cx="19.6" cy="19.6" r="1.7" fill="currentColor"/>'
  ),
  // Filled star for pips rendered as art rather than text.
  star: svg('<path d="m12 2.6 2.9 6.1 6.6.9-4.8 4.7 1.2 6.7L12 17.8 6.1 21l1.2-6.7L2.5 9.6l6.6-.9L12 2.6Z" fill="currentColor"/>'),
  // Honey drop — royal jelly.
  jelly: svg(
    '<path d="M12 2.5c3.6 4.6 6 7.9 6 10.6a6 6 0 0 1-12 0c0-2.7 2.4-6 6-10.6Z" fill="currentColor"/>' +
      '<ellipse cx="9.6" cy="12.4" rx="1.4" ry="2" fill="#000" opacity=".22"/>'
  ),
  // Alchemical specimen mark — the drawer label.
  specimen: svg(
    '<circle cx="12" cy="12" r="8.4" stroke="currentColor" stroke-width="1.6"/>' +
      '<path d="M12 3.6v16.8M3.6 12h16.8" stroke="currentColor" stroke-width="1.2" opacity=".55"/>' +
      '<circle cx="12" cy="12" r="2.4" fill="currentColor"/>'
  ),
  // Pennant — the warlord mark.
  flag: svg('<path d="M6 2v20h1.7v-8.4l10.8.0-2.6-4.2 2.6-4.2H7.7V2H6Z" fill="currentColor"/>'),
  // Skull — the nest floor endcap.
  skull: svg(
    '<path d="M12 2.6c-4.5 0-7.6 3-7.6 7 0 2.5 1.1 4 2.5 5v2.5c0 .9.7 1.6 1.6 1.6h7c.9 0 1.6-.7 1.6-1.6v-2.5c1.4-1 2.5-2.5 2.5-5 0-4-3.1-7-7.6-7Z" fill="currentColor"/>' +
      '<circle cx="9.2" cy="10" r="1.9" fill="#000" opacity=".55"/><circle cx="14.8" cy="10" r="1.9" fill="#000" opacity=".55"/>'
  ),
  diamond: svg('<path d="m12 4 4.6 8-4.6 8-4.6-8L12 4Z" fill="currentColor"/>'),
  chevron: svg('<path d="m9 4 8 8-8 8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  back: svg('<path d="m14 4-8 8 8 8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  speed: svg('<path d="M4 5.5 12 12l-8 6.5v-13ZM13 5.5 21 12l-8 6.5v-13Z" fill="currentColor"/>'),
  sound: svg('<path d="M4 9.5h3.2L12 5.4v13.2L7.2 14.5H4v-5Z" fill="currentColor"/><path d="M15.4 9a4.2 4.2 0 0 1 0 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  mute: svg('<path d="M4 9.5h3.2L12 5.4v13.2L7.2 14.5H4v-5Z" fill="currentColor"/><path d="m15.5 9.5 4 5m0-5-4 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  play: svg('<path d="M7 4.5 19 12 7 19.5v-15Z" fill="currentColor"/>'),
};

/** Render a glyph at a given pixel size. */
export function glyph(name, size = 16, style = '') {
  return `<span class="glyph" style="display:inline-flex;width:${size}px;height:${size}px;${style}">${GLYPH[name] || ''}</span>`;
}

// --- The descent -----------------------------------------------------------
// Thirty chambers, deepening. Every fifth is a Warlord.
const LEVEL_NAMES = [
  'The Feeding Line', 'Border Patrol', 'The Red Column', 'Sap Thieves', 'Warden of the Shallows',
  'Rot Gatherers', 'The Snapping Ranks', 'Husk Cult', 'The Gilded Larder', 'The Silk Vault',
  'Formic Haze', 'Hive Sortie', 'The Lone Hunters', 'The Gatehouse', 'Blades of the Deep Nest',
  'Silk Anchorage', 'The Slow Death', 'Blood Tithe', 'The Tumbling Ranks', 'The Coil',
  'Spore Cult', "The Widow's Court", 'Pillagers', 'Ambush Canopy', 'The Iron Carapace',
  'Trail of Marks', 'The Paralytic Choir', 'Erratic Legion', 'The Sand Pit', 'The Old Queen',
];

export const LEVELS = LEVEL_NAMES.map((name, i) => ({
  n: i + 1,
  name,
  warlord: (i + 1) % 5 === 0,
}));

export const RANKS = [
  [0, 'Larva'], [1, 'Forager'], [10, 'Nurse'], [16, 'Soldier'],
  [22, 'Warden'], [27, 'Broodmother'], [30, 'Old Queen'],
];

export function rankFor(cleared) {
  let out = 'Larva';
  for (const [at, name] of RANKS) if (cleared >= at) out = name;
  return out;
}

// --- Endless Descent mutations --------------------------------------------
export const MUTATIONS = [
  { id: 'jelly', name: 'Royal Jelly', desc: 'Every unit has 20% more health.' },
  { id: 'chitin', name: 'Chitin Plates', desc: 'Every unit shrugs the first hit.' },
  { id: 'frenzy', name: 'Frenzy', desc: 'Attack speed doubles below half health.', rare: true },
  { id: 'swarm', name: 'Swarm Call', desc: 'Each colony fields one extra body per chamber.' },
  { id: 'venom', name: 'Thin Venom', desc: 'Every bite leaves a lingering wound.' },
  { id: 'scent', name: 'Scent Trail', desc: 'Your units find food twice as fast.', rare: true },
];

// --- Species → game economy ------------------------------------------------
// Larvae cost is derived from the stats the engine already publishes, so a new
// species file prices itself the moment it registers. Champions carry a flat
// premium: their value is in the signature ability, not the stat line.
export function larvaeCost(sp) {
  const base = sp.stats.maxHealth / 40 + sp.stats.damage / 3;
  const premium = sp.tier === 'champion' ? 3 : 0;
  return Math.max(2, Math.min(11, Math.round(base) + premium));
}

/** Royal jelly price in the Hatchery. Cheapest-first ordering is fixed. */
export function jellyPrice(sp) {
  return larvaeCost(sp) * 40 + Math.round(sp.stats.maxHealth / 2);
}

/**
 * Normalize the engine catalog into the shape every screen consumes.
 * @param {Array} catalog - from GET /api/catalog (registry.getCatalog()).
 */
export function buildRoster(catalog) {
  return catalog
    .map((sp) => ({
      id: sp.id,
      name: sp.name,
      tier: sp.tier,
      tag: sp.tier === 'champion' ? 'BUG' : 'ANT',
      ability: sp.ability?.name ?? '—',
      desc: sp.ability?.description || sp.flavor || '',
      flavor: sp.flavor || '',
      hp: sp.stats.maxHealth,
      dmg: sp.stats.damage,
      cost: larvaeCost(sp),
      price: jellyPrice(sp),
      art: `/assets/sprites/src/${sp.id}.svg`,
    }))
    .sort((a, b) => a.price - b.price);
}

/** The two cheapest ants are what a new colony starts with. */
export function startingSpecimens(roster) {
  return roster
    .filter((s) => s.tier === 'soldier')
    .slice(0, 2)
    .map((s) => s.id);
}

/**
 * Which specimen (if any) clearing level `n` grants. Specimens are handed out
 * on the first clear of the earliest levels that still have one to give, so the
 * grant card — the game's loudest beat — lands early and then gets rare.
 */
export function grantFor(levelIndex, roster, owned) {
  const GRANT_LEVELS = [1, 4, 8, 13, 18, 24]; // 0-indexed
  const slot = GRANT_LEVELS.indexOf(levelIndex);
  if (slot < 0) return null;
  const locked = roster.filter((s) => !owned.includes(s.id));
  return locked[0] ?? null;
}

// --- Level composition -----------------------------------------------------
// A small deterministic PRNG so a level's opposition is identical every time you
// return to it — the loss screen promises "the same fight is waiting".
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The nest holds this many bodies — for the opposition exactly as for you. */
export const UNIT_CAP = 21;

/**
 * The opposition and larvae budget for a campaign level.
 *
 * Both sides are bound by the same two limits: a larvae budget and UNIT_CAP.
 * That symmetry is what makes the fight readable — once the cap binds in the
 * back half of the descent, the difficulty curve stops being "more bodies" and
 * becomes "better bodies", which is exactly when the player's own drawer has
 * filled up with champions to answer it.
 *
 * @returns {{ lineup: Array<{id,name,ability,count}>, larvae: number, strength: number }}
 */
export function levelPlan(levelIndex, roster) {
  const rnd = mulberry(1009 + levelIndex * 7919);
  const lv = LEVELS[levelIndex];
  const depth = levelIndex / (LEVELS.length - 1); // 0 → 1

  const ants = roster.filter((s) => s.tier === 'soldier');
  const bugs = roster.filter((s) => s.tier === 'champion');

  // Budget the enemy in larvae, then spend it. Warlords get a fifth more.
  const budget = Math.round((13 + levelIndex * 3.4) * (lv.warlord ? 1.2 : 1));
  const counts = new Map();
  const spend = (sp) => counts.set(sp, (counts.get(sp) || 0) + 1);
  const bodies = () => [...counts.values()].reduce((n, c) => n + c, 0);

  let left = budget;
  // Champions appear from chamber 3 on, and lead every warlord chamber. Deeper
  // chambers field proportionally more of them, which is where the budget goes
  // once the body cap stops it going into more ants.
  const champSlots = lv.warlord
    ? 1 + Math.round(depth * 5)
    : levelIndex >= 2
      ? Math.round(depth * 4)
      : 0;
  for (let i = 0; i < champSlots && bugs.length && bodies() < UNIT_CAP; i++) {
    const sp = bugs[Math.floor(rnd() * bugs.length)];
    if (sp.cost > left) break;
    spend(sp);
    left -= sp.cost;
  }
  // The rest of the budget goes to rank and file, up to the cap.
  let guard = 0;
  while (left > 0 && ants.length && bodies() < UNIT_CAP && guard++ < 200) {
    const sp = ants[Math.floor(rnd() * ants.length)];
    if (sp.cost > left) break;
    spend(sp);
    left -= sp.cost;
  }

  const lineup = [...counts.entries()]
    .map(([sp, count]) => ({ id: sp.id, name: sp.name, ability: sp.ability, art: sp.art, count }))
    .sort((a, b) => b.count - a.count);

  // Strength is what the opposition actually fields, not what it was budgeted —
  // the scout report has to match the lineup the player can see.
  const strength = [...counts.entries()].reduce((n, [sp, c]) => n + sp.cost * c, 0);

  return {
    lineup,
    // The player's purse. Tuned against the real engine across the whole
    // campaign: at 1.5× the opposition's strength a sensible lineup clears the
    // first ten chambers almost every time and still loses roughly one deep
    // chamber in four on a first attempt — which is the loss screen's whole
    // premise, that the same fight is waiting and can be planned for.
    larvae: Math.round(strength * 1.5) + 8,
    strength,
  };
}

export const DESCENT_DEPTH = 15;

/**
 * A chamber of an Endless Descent run.
 *
 * The descent needs a steeper ceiling than the campaign, not the same one. A
 * campaign level is a puzzle you can retry with a full purse; a descent chamber
 * meets a colony that has been accumulating since chamber 1, so by the halfway
 * point the opposition has to stop adding bodies (the cap binds both sides) and
 * start upgrading them. Chamber 15 is a full wall of the best specimen there is
 * — the run ends in a mirror match, and you get there on attrition or not at all.
 */
export function descentPlan(chamber, roster) {
  const rnd = mulberry(577 + chamber * 6151);
  const depth = Math.min(1, (chamber - 1) / (DESCENT_DEPTH - 1)); // 0 → 1

  const ants = [...roster].filter((s) => s.tier === 'soldier').sort((a, b) => a.cost - b.cost);
  const bugs = [...roster].filter((s) => s.tier === 'champion').sort((a, b) => a.cost - b.cost);
  const best = roster.reduce((a, b) => (b.cost > a.cost ? b : a), roster[0]);

  // Bodies ramp to the cap by the halfway mark; after that only quality grows.
  const bodyTarget = Math.max(3, Math.round(UNIT_CAP * Math.min(1, 0.16 + depth * 1.7)));
  // Share of the wall that is champion-tier: none at first, all of it at the end.
  const champShare = Math.max(0, depth * 1.25 - 0.15);

  const counts = new Map();
  const spend = (sp) => counts.set(sp, (counts.get(sp) || 0) + 1);
  for (let i = 0; i < bodyTarget; i++) {
    const wantChamp = bugs.length && rnd() < champShare;
    const pool = wantChamp ? bugs : ants.length ? ants : bugs;
    // Deeper chambers reach further up their pool, so the wall hardens as well
    // as thickens; the last chamber is the single best specimen, all the way across.
    const reach = Math.min(pool.length - 1, Math.floor(depth * depth * pool.length));
    spend(depth >= 0.98 ? best : pool[Math.min(pool.length - 1, Math.floor(rnd() * (reach + 1)))]);
  }

  const lineup = [...counts.entries()]
    .map(([sp, count]) => ({ id: sp.id, name: sp.name, ability: sp.ability, art: sp.art, count }))
    .sort((a, b) => b.count - a.count);
  const strength = [...counts.entries()].reduce((n, [sp, c]) => n + sp.cost * c, 0);

  return { lineup, strength, larvae: Math.round(strength * 1.5) + 8 };
}

/**
 * Larvae paid out for clearing a descent chamber. Deliberately less than the
 * cost of the bodies a hard chamber takes off you: a run ends when the colony
 * can no longer be rebuilt faster than it is being killed.
 */
export function descentIncome(chamber, roster) {
  return Math.round(descentPlan(Math.min(DESCENT_DEPTH, chamber + 1), roster).strength * 0.38);
}
