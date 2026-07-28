// Where units stand before a fight starts.
//
// Shared by the browser deploy editor and the headless campaign probe, which is
// the entire reason it lives here rather than in public/. A balance tool that
// arranged armies differently from the way the game arranges them would be
// measuring a fight nobody ever plays.
//
// Pure maths: no canvas, no DOM, no engine. It takes an arena and a list of
// radii and gives back coordinates.

/**
 * Fraction of the arena width each side may deploy into.
 *
 * The band between the two zones is no-man's-land. Without it a player could
 * open the fight already standing inside the enemy formation, which turns
 * placement from a decision into an exploit.
 */
export const ZONE_FRACTION = 0.4;

/** Minimum centre-to-centre spacing, as a multiple of the two bodies' radii. */
export const SPACING = 1.15;

/** The rectangle a team may deploy into, in arena coordinates. */
export function zoneOf(team, arena) {
  const { width, height, wallThickness: t } = arena;
  const pad = t + 18;
  const span = width * ZONE_FRACTION;
  return team === 'A'
    ? { x0: pad, y0: pad, x1: Math.max(pad + 40, span), y1: height - pad }
    : { x0: Math.min(width - pad - 40, width - span), y0: pad, x1: width - pad, y1: height - pad };
}

export function inZone(team, arena, x, y) {
  const z = zoneOf(team, arena);
  return x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1;
}

/**
 * Push a point out of everything it overlaps, then back inside its zone.
 *
 * Units that start a battle interpenetrating get flung apart by the physics
 * solver on tick one — it looks like a bug and it scrambles a careful formation.
 * A few relaxation passes separate a dense drop without the arrangement visibly
 * jumping away from where it was put.
 *
 * @param {{x,y,r}[]} others  - occupied points with radii
 */
export function settle(team, arena, r, x, y, others) {
  const z = zoneOf(team, arena);
  let px = Math.max(z.x0 + r, Math.min(z.x1 - r, x));
  let py = Math.max(z.y0 + r, Math.min(z.y1 - r, y));

  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (const o of others) {
      const min = (r + o.r) * SPACING;
      const dx = px - o.x;
      const dy = py - o.y;
      const d = Math.hypot(dx, dy);
      if (d >= min) continue;
      // Exact overlap has no direction to push along; pick one rather than
      // dividing by zero and producing NaN coordinates.
      const [nx, ny] = d < 0.001 ? [1, 0] : [dx / d, dy / d];
      px += nx * (min - d);
      py += ny * (min - d);
      moved = true;
    }
    px = Math.max(z.x0 + r, Math.min(z.x1 - r, px));
    py = Math.max(z.y0 + r, Math.min(z.y1 - r, py));
    if (!moved) break;
  }
  return { x: px, y: py };
}

/**
 * The next free formation slot for a unit of radius `r`.
 *
 * Fills from the FRONT of each zone backwards — A's rightmost column, B's
 * leftmost — so both armies form up on the line facing each other rather than
 * against their own back walls. Two squads that start a zone-width apart spend
 * the opening seconds walking, which is exactly the dead air the engine's
 * `startGap` control exists to remove; a default arrangement must not put it back.
 */
export function nextSlot(team, arena, r, others) {
  const z = zoneOf(team, arena);
  const step = Math.max(26, r * 2.4);
  const cols = Math.max(1, Math.floor((z.x1 - z.x0) / step));
  const rows = Math.max(1, Math.floor((z.y1 - z.y0) / step));

  for (let c = 0; c < cols; c++) {
    const col = team === 'A' ? cols - 1 - c : c;
    for (let ri = 0; ri < rows; ri++) {
      // Fill outward from the middle row, so a small squad forms a centred block
      // instead of hugging the top wall.
      const half = Math.floor(rows / 2);
      const row = half + (ri % 2 === 0 ? ri / 2 : -Math.ceil(ri / 2));
      if (row < 0 || row >= rows) continue;
      const x = z.x0 + step * (col + 0.5);
      const y = z.y0 + step * (row + 0.5);
      if (x < z.x0 + r || x > z.x1 - r || y < z.y0 + r || y > z.y1 - r) continue;
      if (others.some((o) => Math.hypot(o.x - x, o.y - y) < (r + o.r) * SPACING)) continue;
      return { x, y };
    }
  }
  // Every tidy slot is taken — drop it in the middle and let settle() find room.
  return settle(team, arena, r, (z.x0 + z.x1) / 2, (z.y0 + z.y1) / 2, others);
}

/**
 * Lay a whole list out in formation.
 *
 * Champions take the front rank and the squad ranks up behind them, because
 * screening the big slow expensive thing behind a wall of ants is a real tactic
 * — so the DEFAULT arrangement should be the readable one, not the optimal one.
 *
 * @param {string} team
 * @param {object} arena
 * @param {{id:string, tier:string, r:number}[]} units
 * @returns {{species:string, x:number, y:number}[]}
 */
export function layout(team, arena, units) {
  const ordered = [...units].sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'champion' ? -1 : 1));
  const placed = [];
  const out = [];
  for (const u of ordered) {
    const at = nextSlot(team, arena, u.r, placed);
    placed.push({ x: at.x, y: at.y, r: u.r });
    out.push({ species: u.id, x: at.x, y: at.y });
  }
  return out;
}
