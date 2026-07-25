# 🐛 Bug Arena — v1

A sandbox simulator where two teams of insects fight in a physics-driven arena.
Pick your colony from a roster of **44 species**, choose how many of each, and
watch them fight it out.

The simulation runs **in the browser**, so the whole thing deploys as a static
site with no backend. The exact same engine also runs headless in Node, which is
what the video pipeline uses.

```
┌─────────────┐  snapshots (plain data)   ┌──────────────────┐
│   engine/   │ ─────────────────────────▶│  any renderer     │
│ (headless)  │   'start' 'snapshot' 'end'│  browser canvas,  │
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

# Play it: http://localhost:3000
npm start

# Headless — runs a full battle in Node with NO browser/canvas/DOM.
# This is the shape the video renderer uses.
npm run headless                           # random battle
node examples/headless.js 12345            # fixed seed → fully reproducible
node examples/headless.js 12345 passive    # passive mode
```

## Deploying

The engine is loaded by the browser as plain ES modules — there is no bundler and
no transpile step. A "build" is a file copy into the layout the page's absolute
imports expect:

```bash
npm run build     # -> dist/
```

Deploy `dist/` to any static host (Vercel, Netlify, Cloudflare Pages, GitHub
Pages). `vercel.json` is already set up: build command `node tools/buildStatic.js`,
output directory `dist`. The whole thing is well under a megabyte and costs
nothing to serve, because every visitor simulates their own battle locally.

**How the engine runs unmodified in both places:** `engine/engine.js` imports the
bare specifiers `matter-js` and `events`, which Node resolves natively. The
browser can't, so `public/index.html` declares an **import map** pointing those
two names at small shims in `public/vendor/` (`matter-shim.js` re-exports the UMD
build's global; `events-shim.js` is a minimal `EventEmitter`). Nothing in
`engine/` is browser-specific, and nothing in it is Node-specific.

## Project layout

| Path | Responsibility |
|------|----------------|
| `engine/engine.js` | The whole simulation: loop, physics (matter.js), AI, combat, food, win conditions. Emits plain-data snapshots. **Renderer-agnostic, zero species branching.** |
| `engine/index.js` | Public API: `BugArenaEngine`, `runBattle(config, opts)`. |
| `engine/config.js` | Default config + deep-merge. Every battle parameter is config-driven. |
| `engine/{agent,rng,constants}.js` | Agent state, seeded PRNG, shared enums. |
| `species/registry.js` | The factory the engine spawns from. `registerSpecies`, `getSpecies`, `getCatalog`. |
| `species/*.js` | One file per species (44 of them): stats + data-only `visual` and `sfx` descriptors + behaviour hooks. Self-registers on import. |
| `render/rendererAbstraction.js` | `drawAgent(ctx, agent, visual)` switches on `visual.type` (shape today, sprite-ready). Pure canvas calls → works in browser **and** node-canvas. |
| `render/canvasRenderer.js` | Browser scene composition (walls, food, health bars, status halos, FX). A pure snapshot subscriber. |
| `render/audio.js` | The sound layer: synthesizes each species' `sfx` recipes with Web Audio. Zero audio files. Also a pure snapshot subscriber. |
| `server/server.js` | **Dev tool only.** A static file server matching the `dist/` URL layout. It no longer runs the simulation — the browser does. |
| `tools/buildStatic.js` | Copies `public/ engine/ species/ render/` into `dist/` for deployment. No bundler. |
| `public/localArena.js` | Owns a `BugArenaEngine` in the page and relays its snapshot stream. This is what replaced the WebSocket server. |
| `public/client.js` | Roster picker + HUD + kill feed. Renders state; contains no simulation logic. |
| `examples/headless.js` | Proof the engine runs with no browser. |

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
- **Readable actions:** squash-and-stretch bounce while moving, a bright **attack
  flash** + lunge pop, floating damage numbers, ability tags, wind-up telegraphs,
  web/dash strands, and a dust **poof** on death.

## Shooting it for short-form video

The engine being watchable is a separate problem from the engine being correct, so
it gets measured separately. Battles were instrumented as *video* — hook time,
dead air, event density, how close the finish was — and the numbers drove these
changes. Before → after, 120 battles per mode, aggressive:

| Metric | Before | After | Why it matters |
|---|---|---|---|
| Time to first kill | 4.8s | **2.9s** | a Shorts viewer decides in the first seconds |
| First kill later than 4s | 98% | **4%** | the opening was pure walking |
| Longest dead air | 3.6s | **2.5s** | stretches where nothing happens lose the viewer |
| Notable events / sec | 1.94 | **2.19** | density of things worth watching |
| Winner kept … of its team | — | **45%** | lower = the fight was actually close |
| Nail-biters (winner kept <30%) | — | **27%** | fights that come down to the wire |

**Framing.** There are two render targets — `wide` (1280×720) and `short`
(720×1280) — switchable live. Aspect isn't just a crop: a landscape arena
letterboxed into 9:16 wastes most of the screen, so Shorts mode also asks the
engine for a **portrait arena**, and `_spawnPosition` lines the armies up along
whichever axis is longer. A tall arena therefore fights top-vs-bottom
automatically, with no species or renderer changes.

**Action camera** (`_updateCamera`). A static camera framed the whole arena, so
the fight collapsed into a knot in the middle of a lot of empty sand and the bugs
read as specks. The camera now tracks combat and zooms in on it:

- recent attacks/deaths/abilities are recorded as a decaying **heat** field;
- it locks onto the **densest cluster** of heat, not the average — when a battle
  splits in two, the mean lands in the empty gap and frames neither;
- only bugs near that cluster affect the framing, so one forager wandering off
  can't drag the shot wide;
- pan and zoom are exponentially smoothed (zoom slower than pan, so rapid kills
  don't pump the frame), and clamped to the arena edges.

Because the camera zooms, the background is baked in **two** pieces: the arena
floor at scene resolution (drawn through the camera transform, so it pans and
zooms with the bugs standing on it) and the stadium surround in canvas space.

**Legibility.** At the climax of a fight a dozen ability tags, damage numbers and
K.O.s used to land on the same spot and smear into unreadable mush. Now:

- combat text is drawn in **canvas space** at a constant size, so zoom never
  inflates it;
- repeats of the same ability nearby fold into one tag as `×N`, and concurrent
  tags are capped;
- overlapping labels are nudged apart vertically before drawing;
- per-unit status chips are **suppressed during a big melee** (a team-wide buff
  paints the same chip over every unit) and reappear once the field thins to a
  readable duel; health bars and chips are scaled by `1/cameraScale` to hold a
  constant on-screen size.

**Showreel** (toggle: `🎬 Showreel`). A battle is packaged as a piece of
short-form video without the simulation knowing anything about it — it's a
renderer-only state machine (`intro → live → replay → outro`):

- an **intro "VS" card** over the opening — each team's roster with species
  swatches, holding then fading off just as the armies make contact. It only
  plays at a genuine battle *start*: the live-preview socket reconnects and
  replays the current snapshot, so if the first frame after an init is already
  underway (`snapshot.time > 1.2`) the card is skipped and it drops into live;
- a **slow-motion instant replay** of the killing blow — the last ~1.2s is kept
  in a ring buffer and scrubbed back at 0.3×, with the camera punched in on where
  the final kill landed and a `◉ REPLAY` badge in the corner;
- an **outro winner card** — `VICTORY / TEAM A / WINS` in the team colour over a
  stat strip (duration · kills · survivors), read straight from the summary the
  engine attaches to the final snapshot.

It's toggleable and off-safe: with the showreel off, the renderer plays the raw
snapshot stream and the plain DOM result overlay announces the winner instead (so
the two never double up). The dev server's auto-restart waits long enough (9s) for
the replay and winner card to finish before the next battle begins.

**Pacing knobs** live in config, so none of this is baked into the simulation:

```js
teams: { startGap: 300 },   // px between the front lines at the opening whistle
drama: {
  comeback: true,           // rubber-band an outnumbered team (see below)
  minDeficit: 1.25, fullDeficit: 3,
  maxDamageBonus: 1.0, maxResist: 0.4,
}
```

`drama.comeback` is the honest one to flag: a straight fight snowballs, because
the side with more units concentrates more damage and widens the gap, so ~72% of
battles were decided at first contact. Scaling an outnumbered team's power by its
deficit turns those into real last stands. It is **deliberately artificial** —
turn it off for clean balance measurements, leave it on for anything anyone
watches. Passive mode still runs long (avg 33s, 18% over 45s); **aggressive is
the Shorts-friendly mode** at ~21s.

## Sound layer (`render/audio.js`)

Sound is treated **exactly like art**: a species declares a data-only descriptor
and a presentation module realizes it. The engine never knows sound exists — it
rides the same catalog the visuals do, and `client.js` routes snapshot events to
it. Mute/volume live in the Controls card.

**There are no audio files.** Every sound is *synthesized* at play time from a
small recipe, so the repo stays asset-free and a species' voice is a few lines in
its own file. A recipe is a list of layers — an oscillator (`src:'tone'`, with an
optional `vibrato` wobble) or filtered white noise (`src:'noise'`, where `f0→f1`
glides the **filter cutoff**, which is what turns flat noise into a bite, a hiss,
or a steam blast):

```js
sfx: {
  attack:  [{ src:'noise', filter:'bandpass', f0:2800, f1:1400, q:6, dur:0.055, gain:0.3 }],
  ability: [
    { src:'noise', filter:'bandpass', f0:900, f1:3400, q:1.5, dur:0.3,  gain:0.3 },  // flare catching
    { src:'tone',  wave:'sawtooth',   f0:180, f1:68,          dur:0.3,  gain:0.12, cutoff:800 },
  ],
  death:   [{ src:'noise', filter:'lowpass', f0:1800, f1:300, dur:0.24, gain:0.34 }],
}
```

Events map to voices as `attack → sfx.attack`, `ability → sfx.ability`,
`death → sfx.death`; spawns and the battle horn/fanfare are arena-level sounds in
`ARENA_SFX`. Three things keep a 20-ant melee from becoming noise:

- **Throttling** per species *and* event kind — a dozen ants biting on one tick is
  one bite sound, not twelve.
- **A voice budget** capping simultaneous layers, with a timer backstop so a
  dropped `onended` can never leak slots and permanently silence the arena.
- **Stereo panning** from each event's arena x-coordinate.

Audio can't legally start before a user gesture, so the context is created lazily
and resumed on the first click/keypress; a hint in the UI clears itself once it's
actually running.

### Sprite asset format (what to generate/source)

Author art at `public/assets/sprites/src/<speciesId>.svg` (or drop a raster at
`public/assets/sprites/<speciesId>.png`). Assumed format:

| Property | Value |
|----------|-------|
| Dimensions | **128 × 128 px** (any square works; drawn scaled to the `size` stat) |
| Format | **PNG, RGBA, transparent background** |
| View | **top-down**, insect **facing up** (head toward the top edge) |
| Framing | bug centered, filling ~70% of the canvas |

All sprites are authored as **SVG** (vector, editable) in
`public/assets/sprites/src/`. A species picks how it's loaded:

- `spriteExt: 'svg'` — the browser renders the vector source **directly** (crisp
  at any zoom, no build step). This is what every species added after the original
  three uses, and it's the recommended default.
- *(omitted)* — the rasterized `<id>.png` is loaded instead. Kept for the original
  Fire Ant / Spider / Mantis, and the path a future headless node-canvas video
  renderer would use.

```bash
# Edit the vector sources:            public/assets/sprites/src/<id>.svg
npm run sprites:svg     # serves a rasterizer page; open the printed URL to (re)write the PNGs
npm run sprites:pixel   # alternative: pure-Node procedural PNGs, no browser needed
```

Facing is configurable per species via `spriteFacing: 'up' | 'right'` if your art
faces east instead. Single static image per species today; the `sprite` path
already accepts `frameWidth`/`animations` for frame-based spritesheets later with
no engine change.

## The roster — 44 species, each with a power *and* a price

Species are split into two tiers: **soldier** ants make up the squad, **champion**
bugs lead it. Every one is built around a real trade-off — nothing is strictly
better than anything else, and the units with the biggest powers pay the steepest
prices for them.

### Soldier tier (22)

| Species | Power | Price |
|---------|-------|-------|
| **Fire Ant** | **Ignite** — burns the target over time; bursts into an **ember AoE** on death | baseline stats across the board |
| **Bullet Ant** | **Neurotoxic Sting** — sharply slows the victim; hits hard and takes a beating | slow, deliberate swings |
| **Suicide Ant** | **Poison rupture on death** — a big lingering AoE cloud | frail, negligible bite, and it has to *die* to do anything |
| **Leafcutter Ant** | **Leaf Bulwark** — nearby allies take **half damage** | 3 damage — near-useless offensively; the canopy also **slows everyone it shelters** |
| **Army Ant** | **Swarm Bond** — damage scales with allies packed around it; **Raid Call** rallies the column | **feeble when alone** (~58% damage), and the buff collapses as the colony dies |
| **Trap-Jaw Ant** | **Mandible Snap** — a 27-damage burst that knocks the victim flat | rooted through a 0.5s wind-up, then **catapulted backward out of the fight**, landing stunned |
| **Honeypot Ant** | **Nectar Seep** heals the colony continuously; **Sweet Rupture** floods it on death | slowest unit in the game, biggest ant hitbox, 3 damage, cannot forage |
| **Worker Ant** | **Share the Haul** — every morsel it finds heals *everyone* around it. Also what a Queen's brood is made of | the weakest unit in the game, deliberately — see the balance note |
| **Carpenter Ant** | **Splintered Shell** — reflects a share of every blow back at its attacker; **Harden** halves incoming damage | almost no offence of its own (4 damage), and Harden drops it to 40% speed |
| **Crazy Ant** | **Formic Spray** — corrodes a whole cluster so they hit **42% weaker** | frail, and 5 damage: it can ruin a fight it can never win |
| **Harvester Ant** | **Gorge** — every seed eaten *permanently* grows it (+30% damage, +16 HP a stack) | starts as one of the weakest ants; in a fast brawl it never gets going |
| **Bulldog Ant** | **Killer Leap** — springs the gap onto isolated prey; best eyesight in the tier | hunts ahead of the colony and habitually arrives **alone** |
| **Weaver Ant** | **Silk Anchor** — hauls up to 4 enemies into a pile beside it and roots them | 5 damage; it sets up a kill it cannot land itself |
| **Amazon Ant** | **Pillage** — *permanently* moves damage and max HP from its victim to itself | starts ordinary and is capped at 6 stacks; needs a long fight to matter |
| **Acrobat Ant** | **Gaster Flick** — 360° knockback that leaves attackers unable to swing | short range, 5 damage — it scatters a pile without thinning it |
| **Turtle Ant** | **Door Head** — takes 24% damage and shelters every ally behind it | **cannot move at all** while braced; 4 damage, slowest ant in the game |
| **Dracula Ant** | **Blood Feed** — true lifesteal: every bite heals it for 85% of the damage | 68 HP; the window is 4.5s on a 9s cooldown |
| **Jack Jumper Ant** | **Erratic Bound** — takes 35% damage and moves 60% faster | evasion, not armour — focus fire still deletes it, and the window is short |
| **Pharaoh Ant** | **Budding** — splits off a copy of itself, and every copy can bud again | 54 HP, 4 damage; each bud **costs it 22% of its current health** |
| **Thief Ant** | **Larceny** — tears HP out of an enemy and gives it to the worst-hurt ally | 52 HP, the frailest ant here; it heals everyone except reliably itself |
| **Argentine Ant** | **Trail Pheromone** — marks one enemy to take **50% more** from every source | does almost nothing alone; it is pure force multiplier |
| **Zombie Ant** | **Cordyceps Bloom** — contagious rot that blocks healing and jumps one hop; blooms **again** on death | slow, 4 damage, long attack cooldown — the fungus is the whole unit |

### Champion tier (22)

| Species | Power | Price |
|---------|-------|-------|
| **Web Spider** | **Web Trap** — immobilizes the target *and everyone bunched around it* | only 4 damage: it can lock a fight down but barely win one |
| **Blade Mantis** | **Dash Strike** — charges a whole lane, damaging and scattering everything | glass cannon; the charge commits it to a direction |
| **Scorpion** | **Venom Sting** — heavy chip damage over time | must **charge** the sting, and is open to a counter mid-strike |
| **Hercules Beetle** | **Iron Carapace** (permanent −30% damage taken) + **Horn Toss** | slowest champion by far, biggest target, poor eyesight |
| **Bombardier Beetle** | **Chemical Blast** — a scalding **cone** that shreds packed formations | **scalds itself every shot**, leaving it *Overheated* (+35% damage taken) |
| **Hornet** | **Venom Barrage** — 3 rapid stings + venom; fastest unit in the game | frailest champion, and the barrage leaves it **Spent**: half speed, +50% damage taken |
| **Centipede** | **Coil Crush** — pins a victim helpless; every bite also rakes a **second** enemy | the coil **roots the centipede too** and leaves it 40% more fragile |
| **Queen Ant** | **Brood** — the only unit that makes more units; lays Worker Ants on a timer, no attack needed | slowest thing in the arena, largest target, 4 damage; she cannot flee anything |
| **Assassin Bug** | **Lethal Injection** — damage scales with the target's **missing** health, and it drinks back what it deals | frailest champion; against anything at full health it's just a mediocre bug |
| **Spitting Spider** | The only true **ranged** unit — 155 reach, and **Glue Shot** all but roots what it hits | no melee game whatsoever; anything that closes the gap kills it |
| **Black Widow** | **Necrotic Bite** — a wound that **blocks all healing**: the hard counter to sustain comps | worst body in the tier; and against a comp with no healing, the trait does nothing |
| **Antlion** | **Sand Pit** — drags *every* nearby enemy in and roots them; the best setup tool in the game | slowest champion, worst eyesight, and it can barely capitalise on its own opening |
| **Tarantula Hawk** | **Paralytic Sting** — the only *total* lockdown: no moving, no attacking, +45% damage taken | 132 HP, single target only, and the longest cooldown in the game (12s) |
| **Giant Water Bug** | **Liquefy** — pins one target under heavy DoT and drinks the damage back as healing | ponderous on land; a squad simply walks around it |
| **Vinegaroon** | **Acetic Mist** — 360° field leaving everything caught **45% weaker** | 6 damage — it blunts a squad it has no way to finish |
| **Goliath Beetle** | **Ground Slam** — the heaviest AoE here: knockback **and** stun, with falloff | slowest unit in the game and nearly blind; it must be escorted into range |
| **Dragonfly** | **Aerial Strafe** — three separate charges through three separate targets | the most fragile champion (116 HP); every pass leaves it deeper in the enemy line |
| **Jumping Spider** | **Stalk & Pounce** — the single biggest hit in the game, worse against wounded prey | the pounce is **delayed**: it spends >1s unable to attack, and kill it first and you get nothing |
| **Velvet Worm** | **Slime Net** — roots an entire cone at once, then leaves them slowed | 7 damage; it is a setup tool with no follow-through of its own |
| **Jewel Wasp** | **Zombify** — 6 seconds of *no attacking*, the longest disable in the game | it takes nothing else away — the victim keeps full HP and speed; 126 HP on a 13s cooldown |
| **Devil's Coach Horse** | **Rear & Reek** — the only ability that makes enemies **leave**: repel, slow, and weaken | it wins space, not fights; nothing it does actually kills anything |
| **Camel Spider** | **Shearing Frenzy** — attacks ~3× as fast for 4 seconds | each bite is 22% weaker, and the window is wasted the moment it loses contact |

> **Balance note.** Tuned with a full round-robin per tier (12×12 each, ~2k
> battles), plus mixed-squad tests and a 300-battle soak. Where things landed:
>
> - Two **pre-existing** outliers were left alone deliberately, since rebalancing
>   the original roster wasn't in scope: **Bullet Ant** (~90% of soldier mirrors)
>   and **Blade Mantis** (~98% of champion matchups).
> - **Support and specialist units score low in same-species mirrors by design** —
>   a squad of eight Leafcutters deals 3 damage each and literally cannot kill
>   anything. They're judged on whether they improve a *mixed* squad, and they do.
> - **Worker Ant is the deliberate floor** (0% in mirrors). Its weakness is
>   load-bearing: the Queen summons them free and unlimited, so a draftable-good
>   worker would make her unbeatable. It is meant to be hatched, not drafted.
> - Some species only work in the right *battle mode*. **Harvester Ant** needs a
>   forage-paced fight to grow — 20-27 in passive mode versus 7-41 in aggressive.
>   **Black Widow** is a counter-pick: 38-2 against a healer comp, where other
>   champions manage 30-8.

> **Balance note — the 20 species added in the roster expansion.** Measured
> against a 6-species panel drawn from the original (already-tuned) roster, both
> sides played, 5 seeds, mirrored counts: 1,200 battles per pass. Every one of the
> 20 now lands between **27% and 75%**, with no species above 80% or below 20%.
>
> The first pass was not close, and the failures were informative:
>
> - **Amazon Ant and Dracula Ant both hit 83%.** Two-way effects (steal, lifesteal)
>   compound much faster than one-way buffs of the same nominal size, because they
>   move the gap twice per proc. Both were cut roughly 40%.
> - **Weaver Ant won 0%, Thief Ant 2%, Argentine Ant 3%, Velvet Worm 7%.** All four
>   are force-multipliers, and a same-species duel gives them nothing to multiply.
>   That's expected for support (see the Leafcutter note above) — but 0% means the
>   unit is doing *nothing*, not that it's specialised. Each got enough of its own
>   damage back to matter, without touching what makes it a support unit.
> - **Pharaoh Ant won 5%** because budding was a net loss of colony health: it paid
>   22% of current HP for a 60%-health copy. The self-replicator has to come out
>   ahead on the trade or the whole species is a downgrade button.
>
> Caveat worth stating: this panel measures *isolated* single-species matchups. It
> catches units that are broken or inert, but it cannot score how well a support
> unit lifts a mixed squad — that still needs the kind of mixed-comp testing the
> original roster got.

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

### 1. Add a 25th species (e.g. Tiger Beetle) — one file + one line

Create `species/tigerBeetle.js`. Note that **stats, art and sound are all just
data** on the same object — a species is one self-contained file:

```js
import { registerSpecies } from './registry.js';

const POUNCE = { TRIGGER_CHANCE: 0.35, COOLDOWN_SECONDS: 5, DAMAGE: 18, RADIUS: 55 };

const tigerBeetle = {
  id: 'tigerBeetle',
  name: 'Tiger Beetle',
  tier: 'champion', // 'soldier' (squad) or 'champion' (leader) — battle setup uses this
  flavor: 'Runs its prey down so fast it outruns its own eyesight.',
  stats: { maxHealth: 130, speed: 3.0, size: 12, damage: 10,
           attackRange: 22, attackCooldown: 30, visionRange: 230 },
  visual: { type: 'sprite', sprite: 'tigerBeetle', spriteExt: 'svg', spriteScale: 2.7,
            spriteFacing: 'up', shape: 'polygon', color: '#3fa34d', stroke: '#123', size: 12 },
  // Sound is data too — synthesized, no files. See "Sound layer" above.
  sfx: {
    attack:  [{ src: 'noise', filter: 'bandpass', f0: 3000, f1: 1600, q: 8, dur: 0.04, gain: 0.24 }],
    ability: [{ src: 'tone', wave: 'sawtooth', f0: 240, f1: 700, dur: 0.2, gain: 0.18, cutoff: 2200 }],
    death:   [{ src: 'noise', filter: 'lowpass', f0: 1300, f1: 220, dur: 0.26, gain: 0.3 }],
  },
  ability: {
    name: 'Pounce',
    triggerChance: POUNCE.TRIGGER_CHANCE,
    cooldownSeconds: POUNCE.COOLDOWN_SECONDS,
    log: (self) => `${self.species.name} ran its prey down!`,
    onTrigger(self, target, ctx) {
      for (const e of ctx.enemiesInRadius(self, POUNCE.RADIUS)) {
        ctx.dealDamage(e, POUNCE.DAMAGE, { sourceAgent: self, cause: 'pounce' });
      }
      ctx.spawnEffect({ kind: 'explosion', x: self.x, y: self.y, radius: POUNCE.RADIUS, color: '#ffd27a' });
    },
  },
  hooks: {},
};
export default tigerBeetle;
registerSpecies(tigerBeetle);
```

Then add **one import line** to `species/index.js`:

```js
import './tigerBeetle.js';
```

That's it. No engine change. The beetle spawns, fights, draws, **sounds like
itself**, appears in the roster/catalog/kill-feed/fight-builder, and is
reproducible — automatically. (Confirmed by the 24 shipped species: the engine
spawns from `registry.listSpecies()` and calls hooks generically.)

#### The shared vocabulary a new species can draw on

The `ctx` handed to every hook is the only surface species code touches, which is
what keeps species decoupled from the engine. Beyond queries (`enemiesInRadius`,
`alliesInRadius`, `nearestEnemy`, `enemiesInCone`, `distance`) and actions
(`dealDamage`, `heal`, `applyStatus`, `lunge`, `push`, `dashThrough`,
`spawnEffect`), statuses themselves are generic and compose by multiplication:

| Status field | Meaning |
|--------------|---------|
| `speedMultiplier` | movement scaling (`0` = rooted) |
| `damageTakenMultiplier` | `<1` armour, `>1` vulnerability — applied to **every** damage source |
| `damageDealtMultiplier` | `<1` weakened, `>1` empowered |
| `damagePerSecond` | damage-over-time (authored per second, ticked per frame) |
| `preventMove` / `preventAttack` | hard root / silence (both = full immobilize) |
| `permanent` | an innate trait: shown without a ticking countdown |

That's how a Leaf Bulwark (armour + slow), a Swarm Bond (damage scaling), and an
Overheat (self-inflicted vulnerability) are all the same mechanism.

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
