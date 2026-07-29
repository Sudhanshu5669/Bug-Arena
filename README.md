# 🐛 Bug Arena — v1

A sandbox simulator where two teams of insects fight in a physics-driven arena.
This is **v1**: a clean, correct, renderer-agnostic simulation engine plus a live
browser preview. The server/API and headless video export are **not** built yet —
but the code is deliberately structured so they bolt on without touching the engine.

```
┌─────────────┐  snapshots (plain data)   ┌──────────────────┐
│   engine/   │ ─────────────────────────▶│  any renderer     │
│  (headless) │   'start' 'snapshot' 'end'│  browser today,   │
│  matter.js  │                            │  video later      │
└─────────────┘                            └──────────────────┘
       ▲
       │ asks by id
┌─────────────┐
│  species/   │  self-register into a registry on import
│  registry   │  (engine never imports a species file)
└─────────────┘
```

## Quick start

```bash
npm install

# Colony Gladiator (the game): open http://localhost:3000
# The engine dev preview now lives at   http://localhost:3000/sandbox.html
npm start

# Headless — runs a full battle in Node with NO browser/canvas/DOM.
# This is the shape the future API + video renderer use.
npm run headless            # random battle
node examples/headless.js 12345            # fixed seed → fully reproducible
node examples/headless.js 12345 passive    # passive mode
```

## Project layout

| Path | Responsibility |
|------|----------------|
| `engine/engine.js` | The whole simulation: loop, physics (matter.js), AI, combat, food, win conditions. Emits plain-data snapshots. **Renderer-agnostic, zero species branching.** |
| `engine/index.js` | Public API: `BugArenaEngine`, `runBattle(config, opts)`. |
| `engine/config.js` | Default config + deep-merge. Every battle parameter is config-driven. |
| `engine/{agent,rng,constants}.js` | Agent state, seeded PRNG, shared enums. |
| `species/registry.js` | The factory the engine spawns from. `registerSpecies`, `getSpecies`, `getCatalog`. |
| `species/{fireAnt,spider,mantis}.js` | One file per species: stats + data-only visual descriptor + behaviour hooks. Self-registers on import. |
| `render/rendererAbstraction.js` | `drawAgent(ctx, agent, visual)` switches on `visual.type` (shape today, sprite-ready). Pure canvas calls → works in browser **and** node-canvas. |
| `render/canvasRenderer.js` | Browser scene composition (walls, food, health bars, status halos, FX). A pure snapshot subscriber. |
| `server/server.js` | **Dev tool only.** Runs the engine and streams snapshots to the browser over WebSocket, plus `GET /api/catalog` for the game front-end. Not the future public API. |
| `public/index.html` + `public/game/` | **Colony Gladiator** — the game front-end (see below). Contains no simulation logic. |
| `public/styles/` | Design tokens, components and screen layouts. |
| `public/sandbox.html` + `public/client.js` | The engine dev preview, unchanged in behaviour. |
| `examples/headless.js` | Proof the engine runs with no browser. |

## Colony Gladiator (the game front-end)

Built to the `Colony Gladiator UI Design` spec. Draft a colony, arrange it on the
sand, and fight thirty chambers deep. It is a **pure client of this engine**:
every fight is a real `BugArenaEngine` run on the server, driven by the lineup
the player built and streamed back as snapshots.

| Path | Responsibility |
|------|----------------|
| `public/styles/tokens.css` | The canonical value set: colour ramp, type scale, spacing, elevation, motion. Nothing else defines a raw value. |
| `public/styles/components.css` | Slab buttons, pills, chips, stars, roundels, stamps, scroll/focus/empty treatments. |
| `public/styles/screens.css` | Per-screen layout + the responsive rules. |
| `public/game/data.js` | Campaign content, inline SVG glyphs, and the economy **derived from the species registry** — a new species file prices itself the moment it registers. |
| `public/game/state.js` | Save/progress (localStorage, degrades gracefully when blocked). |
| `public/game/session.js` | The live match — scratch state between "Continue" and a result. |
| `public/game/paint.js` | The deploy-sand canvas (static layer cached offscreen). |
| `public/game/net.js` | Catalog fetch + one-shot fights over the existing WebSocket. |
| `public/game/ui.js` | Screen router, toast, animated counters, scroll fades. |
| `public/game/screens/*.js` | Title, campaign, deploy, battle, result, hatchery, draft, descent beats. |

**Two responsive rules, no more:** `min-aspect-ratio: 1/1` ("wide" — orientation,
not device, drives layout) and `min-width: 1000px` ("desktop" — density only).
844×390 and 1440×900 share the wide layout.

**Balance is verified against the real engine, not eyeballed.** The larvae purse
(1.5× the opposition's strength) and both difficulty curves were tuned by
replaying whole campaigns and descent runs headless through `runBattle`. A
sensible campaign lineup clears the first ten chambers almost every time and
still loses roughly one deep chamber in four on a first attempt; Endless Descent
runs — where losses are permanent — reach a median chamber 13 of 15. Retune by
adjusting `levelPlan` / `descentPlan` in `public/game/data.js` and re-running a
headless playthrough.

**Team colours are one token in three places** — `--team-a` / `--team-b` in
`tokens.css`, `TEAM` in `render/canvasRenderer.js`, and `T` in
`public/game/paint.js`. Change them together.

## Core design guarantees

- **The engine never contains species-specific logic.** It calls hooks
  (`on_attack`, `on_death`, `on_tick`, `aura_effect`, …) generically on whatever
  species object an agent carries, passing a small **context API** (`ctx.dealDamage`,
  `ctx.applyStatus`, `ctx.enemiesInRadius`, `ctx.spawnEffect`, `ctx.rng`, …) as the
  only surface species code uses to affect the world. Verified: no species name
  appears anywhere under `engine/`.
- **The engine imports only the registry**, never a species file. Species
  self-register when their module is imported (`import "../species/index.js"`).
- **Snapshots are plain data.** Every tick the engine emits
  `{ tick, time, status, arena, score, agents[], food[], events[] }`. The
  `events[]` array (attacks, deaths, effects, status applied, food, battle
  start/over) is part of the stream, so a renderer or a future video-captioning
  layer can drive on-screen text from it — no `console.log`.
- **Fully deterministic** from `config.seed`. Same seed → identical snapshot
  stream and summary. Essential for reproducible video rendering later.

## Battle config (all optional; deep-merged onto defaults)

```js
runBattle({
  seed: 12345,                 // omit → random seed, recorded in the summary
  arena: { width: 960, height: 600 },
  teams: {
    soldiers: { min: 7, max: 12 }, // random squad size per team
    champions: 1,                   // champion-tier units per team
    soldierPool: null,              // null = all tier:'soldier' species
    championPool: null,             // null = all tier:'champion' species
  },
  mode: 'aggressive',          // 'aggressive' (hunt on sight) | 'passive' (fight only when threatened)
  food: { initial: 16, spawnEveryTicks: 60, healAmount: 12 },
  maxTicks: 6000,              // timeout → most survivors wins
});
```

**Squad + champion format (tiered):** each team = a randomized squad of
**soldier**-tier bugs (7–12, each an independent random pick) **plus** one
**champion**-tier bug leading them (also random). Species declare their tier
(`tier: 'soldier' | 'champion'`); battle setup pulls counts per tier from the
registry (`listByTier`) — **no species names are hardcoded** anywhere in the
engine, so new soldiers/champions slot in automatically. Food still spawns and
bugs may forage mid-fight.

> **Combat note:** attack range is measured **surface-to-surface** (edge gap), not
> center-to-center — physics collision keeps two bodies ≥ (r₁+r₂) apart, so a
> center-distance check let a small-reach attacker (Fire Ant, range 16) never
> reach a larger body (Spider, radii sum 19). See `_inAttackRange`.

## Art / rendering layer (gladiator arena)

The renderer is styled as a gladiator ring and is **entirely separate from the
engine** — it only subscribes to snapshots. Key pieces:

- **Two coordinate spaces.** Agents live in **scene space** (the engine's arena
  coords, e.g. 960×600). The canvas is a **16:9 render target** (1280×720). A
  `camera` transform maps scene→canvas and centers the arena with room for
  stadium dressing. To re-letterbox for 9:16 shorts later, only `RENDER_W/H` +
  the camera fit change — the engine and every scene-space draw call are untouched.
- **Layered background** (built once into an offscreen canvas): stadium backdrop,
  sand/dirt floor (radial light pooling + procedural grit + scuff marks), rounded
  **stone boundary ring** with masonry seams, top **banners**, corner **torches**
  (glow baked in; flame flickers live), and a **vignette**.
- **Sprites.** Species declare `visual: { type:'sprite', sprite, spriteScale,
  spriteFacing }`. `render/spriteLoader.js` preloads one PNG per species **once**
  at startup into a `SpriteCache`; `render/rendererAbstraction.js` draws each bug
  scaled to its `size` stat and rotated to face movement. **Missing/among-loading
  images fall back to the shape renderer**, so the sim never blanks or crashes.
- **Grounding & identity.** Every agent gets a soft **drop-shadow ellipse** and a
  **team-colored footprint ring/glow** (blue = A, red = B) drawn *under* the
  sprite — team is readable even when both sides use the same species art.
- **Readable actions (no sound):** squash-and-stretch bounce while moving, a
  bright **attack flash** + lunge pop, `CRIT` popups, web/dash strands, and a dust
  **poof** on death.

### Sprite asset format (what to generate/source)

Drop real art at `public/assets/sprites/<speciesId>.png` (e.g. `fireAnt.png`,
`spider.png`, `mantis.png`). Assumed format:

| Property | Value |
|----------|-------|
| Dimensions | **128 × 128 px** (any square works; drawn scaled to the `size` stat) |
| Format | **PNG, RGBA, transparent background** |
| View | **top-down**, insect **facing up** (head toward the top edge) |
| Framing | bug centered, filling ~70% of the canvas |

The bundled placeholder sprites are authored as **SVG** (vector, editable) and
rasterized to those PNGs — the runtime always consumes PNG, so the browser
preview and the future headless node-canvas video path stay identical.

```bash
# Edit the vector sources:            public/assets/sprites/src/<id>.svg
npm run sprites:svg     # serves a rasterizer page; open the printed URL to (re)write the PNGs
npm run sprites:pixel   # alternative: pure-Node procedural PNGs, no browser needed
```

Facing is configurable per species via `spriteFacing: 'up' | 'right'` if your art
faces east instead. Single static image per species today; the `sprite` path
already accepts `frameWidth`/`animations` for frame-based spritesheets later with
no engine change.

## The 3 species + their signature abilities

Each species defines ONE signature `ability`, driven by the engine's **hybrid
trigger gate** (see below). The abilities are mechanically distinct — status
control vs. burst-mobility vs. damage-over-time — not reskins of "deal damage".

| Species | Tier | Signature ability | Effect |
|---------|------|-------------------|--------|
| **Fire Ant** | `soldier` | **Ignite** (DoT) | sets the target on fire (burn damage over time); still bursts into an **ember AoE** on death |
| **Web Spider** | `champion` | **Web Trap** (status) | **immobilizes** the target ~3.5s — it cannot move *or* attack, but takes damage normally |
| **Blade Mantis** | `champion` | **Dash Strike** (mobility) | lunges at the target and lands a single high-damage blow |

## The ability system (the part built to scale)

### Hybrid trigger gate

Every attack runs the same generic gate in the engine (`_tryAbility`) — **no
species branching**:

```
attack → normal damage ALWAYS applies
       → if ability is OFF cooldown:
             roll triggerChance
             ├─ hit  → run ability.onTrigger(), start cooldown, log the event
             └─ miss → nothing; cooldown NOT consumed (can try again next hit)
```

So abilities feel random (you never know which hit procs) yet controlled (a
cooldown, set *longer* than any effect it applies, prevents chain-locking).

### What a species ability looks like

This is the exact structure to copy for new species — put the tunables in a
`const` block at the top of the file so they're easy to find:

```js
const WEB = { TRIGGER_CHANCE: 0.35, COOLDOWN_SECONDS: 6, IMMOBILIZE_SECONDS: 3.5 };

ability: {
  name: 'Web Trap',                          // shown in the debug panel + event
  description: 'Immobilizes the target...',  // optional; surfaced in the catalog
  triggerChance: WEB.TRIGGER_CHANCE,         // 0..1 — REQUIRED, standard field
  cooldownSeconds: WEB.COOLDOWN_SECONDS,      // seconds — REQUIRED, standard field
  // Short, punchy, specific — this string is what the kill feed shows and what a
  // future narration/caption layer reads. "X webbed Y!", not "X used ability".
  log: (self, target) => `${self.species.name} webbed ${target.species.name}!`,
  // The actual effect. Touch the world ONLY through `ctx` (no engine internals).
  onTrigger(self, target, ctx) {
    ctx.applyStatus(target, {
      type: 'web', label: 'Webbed',
      duration: ctx.seconds(WEB.IMMOBILIZE_SECONDS),
      speedMultiplier: 0, preventMove: true, preventAttack: true, // immobilize = both
    }, self);
    ctx.spawnEffect({ kind: 'web_cast', x1: self.x, y1: self.y, x2: target.x, y2: target.y });
  },
}
```

**`ctx` ability toolkit:** `dealDamage`, `applyStatus`, `heal`, `enemiesInRadius`,
`alliesInRadius`, `nearestEnemy`, `lunge(self, target, dist)` (mobility),
`seconds(s)` (→ ticks), `spawnEffect`, `rng`, `distance`. The engine handles the
gate, cooldown timer, and the event log for you — `onTrigger` only does the effect.

**Status descriptor fields** (all optional): `type`, `label` (shown above the
agent), `duration` (ticks — use `ctx.seconds()`), `speedMultiplier`,
`damagePerTick` (DoT), `preventMove`, `preventAttack`. Immobilize = the last two
true + `speedMultiplier: 0`. Statuses render as a labelled pill + colored halo;
immobilizing ones add a web overlay + struggle shake.

**Verifying cooldowns:** the sidebar **Abilities (debug)** panel shows each
champion's ability and live cooldown ("Web Spider · Web Trap — 4.1s" / "ready"),
and each proc console-logs `[ability] <text>`.

---

## Extending it (the three things v1 was designed for)

### 1. Add a 4th species (e.g. Bombardier Beetle) — one file + one line

Create `species/bombardierBeetle.js`:

```js
import { registerSpecies } from './registry.js';

const BLAST = { TRIGGER_CHANCE: 0.3, COOLDOWN_SECONDS: 5, DAMAGE: 12, RADIUS: 55 };

const bombardierBeetle = {
  id: 'bombardierBeetle',
  name: 'Bombardier Beetle',
  tier: 'champion', // 'soldier' (squad) or 'champion' (leader) — battle setup uses this
  flavor: 'Sprays a boiling chemical blast that scalds everything in an arc.',
  stats: { maxHealth: 80, speed: 1.1, size: 13, damage: 3,
           attackRange: 40, attackCooldown: 70, visionRange: 220 },
  visual: { type: 'sprite', sprite: 'bombardierBeetle', spriteScale: 2.7, spriteFacing: 'up',
            shape: 'polygon', color: '#c98a2b', stroke: '#5a3a10', size: 13 }, // shape = fallback
  // Signature ability: an AoE burst — mechanically distinct from web/dash/ignite.
  ability: {
    name: 'Chemical Blast',
    triggerChance: BLAST.TRIGGER_CHANCE,
    cooldownSeconds: BLAST.COOLDOWN_SECONDS,
    log: (self) => `${self.species.name} sprayed a chemical blast!`,
    onTrigger(self, target, ctx) {
      for (const e of ctx.enemiesInRadius(self, BLAST.RADIUS)) {
        ctx.dealDamage(e, BLAST.DAMAGE, { sourceAgent: self, cause: 'chemical_blast' });
      }
      ctx.spawnEffect({ kind: 'explosion', x: self.x, y: self.y, radius: BLAST.RADIUS, color: '#ffd27a' });
    },
  },
  hooks: {},
};
export default bombardierBeetle;
registerSpecies(bombardierBeetle);
```

Then add **one import line** to `species/index.js`:

```js
import './bombardierBeetle.js';
```

That's it. No engine change. The beetle spawns, fights, draws, appears in the
roster/catalog/kill-feed, and is reproducible — automatically. (Confirmed by the
existing three species: the engine spawns from `registry.listSpecies()` and calls
hooks generically.)

### 2. Add a real sprite-based species — no engine change

Visuals are **data**, and the renderer already switches on `visual.type`:

```js
visual: {
  type: 'sprite',
  spriteSheet: 'hornet.png',
  frameWidth: 32, frameHeight: 32,
  animations: { idle: {row:0, frames:4, fps:6}, attack:{row:1, frames:6, fps:12} },
}
```

`render/rendererAbstraction.js` already has the `case 'sprite'` branch and a
`SpriteCache` interface. Two small, isolated jobs remain when you want real art:
load the image into the `SpriteCache`, and (for headless video) swap the browser
`Image` for node-canvas `loadImage`. The engine, other species, and the snapshot
format are untouched — a sprite species even renders as a colored placeholder
until its art is wired in, so nothing breaks in the interim.

### 3. Where the API and headless video plug in

Both consume the **exact same** engine already used headlessly by
`examples/headless.js`. Nothing new is needed in the engine.

**`POST /api/simulate`** — call `runBattle(config)` and return the summary
(marked with a comment in `server/server.js`):

```js
import { runBattle } from '../engine/index.js';
app.post('/api/simulate', express.json(), (req, res) => {
  const { summary } = runBattle(req.body?.config ?? {});
  res.json(summary);            // deterministic; re-run summary.seed to replay
});
```

**Headless video** — a `videoRenderer.js` subscribes to the same snapshot stream
the browser uses, drawing each snapshot to a node-canvas surface (via the *same*
`render/rendererAbstraction.js`) and piping frames to ffmpeg:

```js
const { snapshots, init } = runBattle(config, { collectSnapshots: true });
// for each snapshot: drawAgent(nodeCanvasCtx, agent, init.catalog[...].visual) → encode frame
```

Because the run is seeded and deterministic, the video always matches the sim.
