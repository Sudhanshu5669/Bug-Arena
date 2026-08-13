// Validate the effect payloads every species emits, headlessly.
//
//   npm run fx
//
// Why this exists: `ctx.spawnEffect({...})` is an untyped hole between a species
// and the renderer, and the renderer reads specific field names per `kind`. A
// species that names one wrong hands the renderer `undefined` — and the canvas
// API is split-brained about that. `arc()` quietly skips the segment, but
// `createRadialGradient()` THROWS, mid-draw, after the effect has already set
// `globalCompositeOperation = 'lighter'`. The composite mode survives the
// exception, so every later draw call sums, and the arena goes white and stays
// white for the rest of the session.
//
// That shipped: the Dragonfly emitted a `dash` as {x, y, toX, toY} instead of
// {x1, y1, x2, y2}, and three of them whited out a battle permanently. The
// renderer now defends itself, but a silently missing effect is still a bug —
// so this runs every species' ability enough times to see what it emits, and
// fails on any payload the renderer cannot draw.

import '../species/index.js';
import { getCatalog, getSpecies, hasSpecies } from '../species/registry.js';
import { runBattle } from '../engine/index.js';
import { buildLevels } from '../game/levels.js';
import { layout } from '../game/formation.js';

const ARENA = { width: 820, height: 520, wallThickness: 22 };
const catalog = getCatalog();
const byId = new Map(catalog.map((s) => [s.id, s]));

/**
 * What each effect kind needs, READ OUT OF THE RENDERER.
 *
 * A hand-maintained copy of this table would be wrong within a month, and a
 * check that disagrees with the code it is checking is worse than no check. So
 * the source of truth stays `drawEffect`: parse its `case` blocks and classify
 * each kind by whether it reads `fx.x1/fx.x2` (a line between two points) or
 * `fx.x` (a point). Anything the renderer does not handle is unconstrained.
 */
async function shapeTable() {
  const fs = await import('fs/promises');
  const url = new URL('../render/canvasRenderer.js', import.meta.url);
  const src = await fs.readFile(url, 'utf8');
  const body = src.slice(src.indexOf('function drawEffect'));

  const marks = [];
  const re = /case '([a-z_]+)':/g;
  let m;
  while ((m = re.exec(body))) marks.push({ kind: m[1], at: m.index });

  const table = {};
  for (let i = 0; i < marks.length; i++) {
    const seg = body.slice(marks[i].at, i + 1 < marks.length ? marks[i + 1].at : body.length);
    if (/fx\.x1|fx\.x2/.test(seg)) table[marks[i].kind] = ['x1', 'y1', 'x2', 'y2'];
    else if (/fx\.x\b/.test(seg)) table[marks[i].kind] = ['x', 'y'];
  }
  // Handled before the switch, in _applyEvents / the renderer's own draws.
  table.dash = ['x1', 'y1', 'x2', 'y2'];
  table.windup = ['x', 'y'];
  return table;
}

const SHAPE = await shapeTable();
/** A kind the renderer does not draw is not this tool's business. */
const DEFAULT_SHAPE = null;

const problems = [];
const seen = new Map(); // kind -> count
const unknown = new Set(); // kinds the renderer has no case for

function check(ev, source) {
  seen.set(ev.kind, (seen.get(ev.kind) ?? 0) + 1);
  const want = SHAPE[ev.kind] ?? DEFAULT_SHAPE;
  if (!want) {
    unknown.add(`${source}: "${ev.kind}"`);
    return;
  }
  for (const key of want) {
    if (!Number.isFinite(ev[key])) {
      problems.push(
        `${source}: "${ev.kind}" effect is missing a finite \`${key}\` ` +
          `(got ${JSON.stringify(ev[key])}) — fields present: ${Object.keys(ev).join(', ')}`
      );
      return;
    }
  }
  // A radius that is present must be usable; createRadialGradient rejects NaN.
  for (const key of ['radius', 'r']) {
    if (ev[key] !== undefined && !Number.isFinite(ev[key])) {
      problems.push(`${source}: "${ev.kind}" effect has a non-finite \`${key}\``);
    }
  }
}

/**
 * Fight a species against a mixed enemy line, repeatedly, so its ability fires.
 * Abilities are chance-gated, so this leans on volume rather than on poking the
 * trigger directly — which also exercises the real code path.
 */
function exercise(sp) {
  const foes = ['fireAnt', 'workerAnt', 'armyAnt', 'carpenterAnt'].filter((id) => hasSpecies(id));
  for (let seed = 1; seed <= 6; seed++) {
    const mine = {};
    mine[sp.id] = sp.tier === 'champion' ? 4 : 10;
    const theirs = {};
    for (const f of foes) theirs[f] = 4;

    const place = (team, roster) => {
      const flat = [];
      for (const [id, n] of Object.entries(roster)) {
        const s = byId.get(id);
        for (let i = 0; i < n; i++) flat.push({ id, tier: s.tier, r: s.stats.size });
      }
      return layout(team, ARENA, flat).map((u) => ({ species: u.species, x: u.x, y: u.y }));
    };

    const { snapshots } = runBattle(
      {
        seed: seed * 7919,
        arena: ARENA,
        mode: 'aggressive',
        teams: { custom: { A: place('A', mine), B: place('B', theirs) } },
        drama: { comeback: false },
        food: { initial: 0, spawnEveryTicks: 0 },
        maxTicks: 60 * 40,
      },
      { collectSnapshots: true }
    );

    for (const snap of snapshots ?? []) {
      for (const ev of snap.events ?? []) {
        if (ev.type === 'effect') check(ev, sp.id);
      }
    }
  }
}

console.log('\n  Checking every species\' effect payloads...\n');
for (const sp of catalog) {
  if (!sp.ability && !Object.keys(getSpecies(sp.id).hooks ?? {}).length) continue;
  exercise(sp);
}

const kinds = [...seen.entries()].sort((a, b) => b[1] - a[1]);
console.log(`  ${kinds.length} effect kinds observed, ${Object.keys(SHAPE).length} drawn by the renderer.`);

if (unknown.size) {
  // Not a failure: a species may emit something purely for a future renderer.
  // Worth saying out loud, because it also catches a typo'd `kind`.
  console.log('\n  emitted but not drawn by drawEffect (silently invisible):');
  for (const u of [...unknown].sort()) console.log(`    ${u}`);
}

if (problems.length) {
  console.error(`\n  ✗ ${problems.length} malformed effect payload(s):\n`);
  for (const p of [...new Set(problems)]) console.error(`    ${p}`);
  console.error('');
  process.exit(1);
}
console.log('\n  ✓ every effect the roster emits carries drawable geometry.\n');
