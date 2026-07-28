# Colony Gladiator — UI design brief

Hand this whole file to the design agent as the prompt.

---

You are designing the complete user interface for **Colony Gladiator**, a
finished, working HTML5 browser game that ships to CrazyGames. The game logic,
simulation, balance and progression are all done and tested. **Only the UI needs
designing.** Nothing in this brief is a feature request — it is a description of
screens that already exist and already work, and that currently look like an
unstyled prototype.

Your job: make it look and feel like a game somebody cannot put down, without
changing a single thing about how it works.

---

## PART 1 — What the game is

Two colonies of insects fight an auto-battle in a top-down sand arena. The player
never controls a unit in combat. The entire game is the **decision before the
fight**: which specimens to bring, and where to stand them.

The loop:

1. **Pick a level** from a 30-level campaign.
2. **See the enemy's exact lineup**, already standing on their half of the sand.
3. **Arrange your own colony** by dragging specimens onto your half. You have a
   larvae budget and a unit cap.
4. **Start the fight.** Everything you placed comes alive at once. ~10–40 seconds.
5. **Win → keep a new species forever**, earn royal jelly, get 1–3 stars, and the
   next level unlocks.

There are 44 species. You start owning 2. Every one of the other 42 is earned —
30 from campaign levels, 12 bought from a shop with royal jelly. **The campaign
is the only source of new species anywhere in the game**, which is what makes
each win matter.

Three other modes reuse the same screens: a free-build Battle Maker (arrange
*both* armies), a roguelite Endless Descent (draft → fight → mutate → repeat),
and a technical sandbox.

**The emotional core you are designing for:** the moment a level result screen
tells the player they now own the Hornet they just got killed by. That single
beat is why anyone plays a second level. Everything else in the UI exists to get
them to it faster and make it land harder.

### Tone

Field-naturalist specimen drawer meets gladiator pit. Insects are pinned
specimens on card stock; the arena is dirt, stone and torchlight. Slightly
clinical, slightly brutal. **Not** cute, not cartoon-bug, not sci-fi, not
neon-arcade. The existing palette (damp earth, chitin brown, amber resin) is a
good instinct that is badly executed — you may keep, refine or replace it, but
justify a replacement.

---

## PART 2 — Hard constraints (non-negotiable)

These come from the engine and the portal. A design that violates them cannot be
built.

| Constraint | Why |
|---|---|
| **No web fonts.** System font stacks only. | Portal builds must render identically with zero network. Currently: Georgia/serif for display, system-ui for UI, ui-monospace for numbers. You may re-pair these but all three must be system stacks. |
| **No external assets of any kind.** No CDN, no remote images, no icon fonts. | CrazyGames requires the game to be entirely self-contained in the uploaded zip. Icons must be inline SVG or CSS shapes. |
| **It will be implemented in plain hand-written CSS.** No Tailwind, no Sass, no component library, no JS animation library. | The project has no bundler by design — the browser loads ES modules directly. Do not design anything that can only be built with a framework, a physics library, or WebGL. Everything must be achievable with CSS + the existing 2D canvas. |
| **Mobile-first, and it must work on both.** | Most portal traffic is Android phones. Design for 390×844 portrait, 844×390 landscape, and 1440×900 desktop. All three are first-class. |
| **44px minimum touch target** on anything tappable. | Already enforced; do not regress it. |
| **Total build stays under ~1 MB.** | It is currently 936 KB including 44 sprites. Do not add heavy assets. |
| **Two `<canvas>` elements are painted by JavaScript, not CSS.** | See Part 7. You cannot style their interiors with CSS — you must instead give a paint spec the developer applies in JS. |
| **Everything must survive being served from a subpath** (`/games/colony-gladiator/`). | No root-absolute URLs (`/img/x.png`) anywhere. Relative only. |
| Respect `prefers-reduced-motion`. | Already wired; keep it meaningful. |

---

## PART 3 — What "addictive" has to mean here

Do not interpret this as "add more animation." This game's retention problem is
specific. Solve these five things:

**1. The reward beat must be enormous.**
Winning a level grants a species. Right now that is a small bordered box. It
should feel like opening a card pack: the specimen card arrives with weight,
the name lands, the ability reads like a promise. This is the single highest
-leverage screen in the game. Design it first.

**2. Progress must be visible without reading.**
The player should know, at a glance from the title screen, how far they have
come and what is next. 30 levels, 3 stars each, 44 species, a rank title, a
currency. Currently these are four monospace numbers in a row. They are the
entire meta-game.

**3. The level map must read as a journey, not a spreadsheet.**
It is currently a uniform grid of 30 rectangles. It should have a shape — a
descent, a path, chapters — with the six boss levels as visible landmarks and
the player's current position unmistakable.

**4. Every tap needs instant physical feedback.**
Placing a unit, buying a specimen, switching a filter. The game is entirely
made of small decisions; each one should feel like it clicked into place.

**5. The fight needs a frame that builds tension.**
The battle screen is a canvas with a score bar. Two armies closing on each other
should feel like something is at stake — before, during, and at the moment it
resolves.

**What to avoid:** loot-box psychology, fake urgency, energy timers, countdowns,
anything manipulative or dark-pattern. The game has no monetisation beyond
portal ads. Addictive here means *satisfying and legible*, not *coercive*.

---

## PART 4 — Every screen, with real content

Design all of these. Content below is **real data from the running game** — use
it verbatim, do not invent placeholder text.

### 4.1 Boot gate (`#boot`)
Shown for ~200ms–2s before anything else. Wordmark + a determinate progress bar
(`#boot-bar`, width animates 20% → 55% → 100%). Fades out via a `.gone` class.
First impression on a portal; it is judged on how fast something appears.

### 4.2 Title screen (`#screen-title`)
- Eyebrow: `FORMICARIUM · SPECIMEN TRIALS`
- Wordmark: **Colony** / **Gladiator** (two lines, second in accent)
- Tagline: *"Draft a colony, arrange it on the sand, and fight thirty chambers deep. Every specimen you beat is a specimen you keep."*
- Stat strip: `Rank Forager` · `Chambers 7/30` · `Specimens 14/44` · `Jelly 340`
- Four mode buttons, each with a title and a live subtitle:
  - **Campaign** — `Level 8 · Husk Cult` ← primary, always the loudest thing on screen
  - **Battle Maker** — `14 specimens acquired`
  - **Hatchery** — `340 royal jelly`
  - **Endless Descent** — `Run in progress — resume` *(or)* `Fifteen chambers, one life`
- Secondary text button: `Open the free sandbox`
- Conditional warning line: `Storage is blocked here — progress will not survive a reload.`

Design the **empty/new-player state too**: `Rank Larva · Chambers 0/30 · Specimens 2/44 · Jelly 0`, campaign reads `Level 1 · The Feeding Line`.

### 4.3 Campaign level select (`#screen-campaign`)
Header: back button, title, stat chips (`Rank`, `Cleared 7/30`, `Stars 16/90`, `Jelly 340`), and a `Continue` button that jumps to the next unplayed level.

30 level cards. Four states, all of which must be instantly distinguishable:
- **locked** — number only, name replaced with "Locked", visibly inert
- **open** — playable, not yet cleared
- **cleared** — with 0–3 stars filled
- **next** — the one the player should tap; currently the only accented card

Six of the 30 are **boss levels** (5, 10, 15, 20, 25, 30) and carry a `WARLORD`
marker. They should feel like milestones.

Real level names, in order:
`The Feeding Line`, `Border Patrol`, `The Red Column`, `Sap Thieves`, **`Warden of the Shallows`**, `Rot Gatherers`, `The Snapping Ranks`, `Husk Cult`, `The Gilded Larder`, **`The Silk Vault`**, `Formic Haze`, `Hive Sortie`, `The Lone Hunters`, `The Gatehouse`, **`Blades of the Deep Nest`**, `Silk Anchorage`, `The Slow Death`, `Blood Tithe`, `The Tumbling Ranks`, **`The Coil`**, `Spore Cult`, `The Widow's Court`, `Pillagers`, `Ambush Canopy`, **`The Iron Carapace`**, `Trail of Marks`, `The Paralytic Choir`, `Erratic Legion`, `The Sand Pit`, **`The Old Queen`**

(Bold = boss.) Note level 30 is the final boss and should look like an endpoint.

### 4.4 Deploy screen (`#screen-deploy`) — **the most important screen**
This is where the player spends most of their time. It has three regions:

**Header:** back, level title (`12. Hive Sortie`), subtitle (`Arrange your colony, then send them in.` / `Warlord chamber — this colony fights above its weight.` / `Reinforced: +23 larvae for this attempt.`), and two counters: `larvae left 76` and `units 6/18`.

**The sand (canvas):** a 960×600 top-down arena. Left 40% is the player's deploy
zone (blue), right 40% is the enemy's (red), the middle 20% is no-man's-land.
Units stand still until the fight starts. See Part 7 for how to spec this.

**Tools row:** team toggle (`Blue`/`Red` — only visible in Battle Maker),
`Tidy formation`, `Clear`, and the primary `Start the fight` button (disabled
until at least one unit is placed).

**Side panel:**
- *Opposition* card listing the enemy lineup, e.g.
  `Hornet — Venom Barrage — ×2` / `Fire Ant — Ignite — ×8`
- *Your specimens* card: filter tabs (`All` / `Ants` / `Bugs`), a hint line
  (*"Drag onto the sand, or tap a card then tap the sand. Drag a unit off your half to take it back."*), and a scrolling tray of specimen cards.

**Specimen tray card** — needs: thumbnail, name, ability name, price, current
count on field, and `−` / `+` buttons. States: **default**, **armed** (tapped,
waiting for a floor tap), **has units placed**, **dimmed** (unaffordable or cap
reached). Example: `Bullet Ant / Neurotoxic Sting / 6 / ×3`.

Empty state: *"Nothing here yet. Clear campaign levels to acquire specimens."*

**This screen must work one-handed on a phone.** Canvas on top, tray below, and
the `Start the fight` button must never be pushed off-screen.

### 4.5 Battle screen (`#screen-battle`)
- Score bar: living unit count per side (`12` blue vs `8` red), a proportional
  track between them, and a clock (`14.3s`).
- The arena canvas (16:9, 1280×720).
- A result veil that fades in over the canvas when the fight ends:
  title (`The colony holds` / `The colony breaks`) + `14 dead in 18.4s`.
- Footer: level name, `Speed ×1` (cycles ×1/×2/×4), `Sound on`, `Skip to result`.

The chrome must not fight the canvas for attention — the fight is the content.

### 4.6 Level result (`#screen-levelresult`) — **design this first**
- Eyebrow: `Level 12 cleared` / `Level 12 failed`
- Headline: `The colony holds` / `The warlord falls` / `The colony breaks`
- **Star row: 0–3 stars, animating in sequentially.** Stars are earned on how
  many of your units survived (1★ win, 2★ ≥34% alive, 3★ ≥60% alive).
- Tally: `11 survivors` · `14 enemies slain` · `18.4s duration` · `+196 royal jelly`
- **The grant card** — the emotional payload:
  > **Hornet** joins your colony.
  > *Venom Barrage — Three rapid stings and a dose of venom; the fastest thing in the arena.*
  With the specimen's artwork. Make this land.
- A note line, one of: *"Rebuild the lineup and try again — the same fight is waiting, so you can plan for it."* / *"A better rating than last time."* / *"Cleared again."* / *"Every chamber is yours. The whole roster is unlocked in the battle maker."*
- Buttons: `Level 13: The Lone Hunters` (primary), `Replay this level`,
  `Watch an ad: +23 larvae next attempt` (only on defeat), `Level select`.

Design **both** the win and the loss variants. The loss screen must feel like a
puzzle to re-solve, not a punishment.

### 4.7 Hatchery (`#screen-hatchery`)
A shop list of the 12 species the campaign never grants. Each row: artwork, name,
ability + description, stat line (`BUG · hp 252 · dmg 13`), and either a price
button (`768 jelly`) or an `Acquired` tag. Rows dim when unaffordable.

Real stock, cheapest first:
`Suicide Ant 120` · `Thief Ant 150` · `Pharaoh Ant 180` · `Camel Spider 240` ·
`Giant Water Bug 288` · `Dragonfly 288` · `Devil's Coach Horse 368` ·
`Velvet Worm 448` · `Bombardier Beetle 480` · `Spitting Spider 608` ·
`Vinegaroon 720` · `Goliath Beetle 768`

Subtitle: *"9 specimens still for sale. Royal jelly comes from winning campaign levels."*

### 4.8 Endless Descent — draft (`#screen-draft`)
Header: back, `Chamber 7` (or `Chamber 10 · Warlord`), next opponent name
(`Deep Nest Sentries`), purse (`larvae 84`).

Left: a grid of specimen cards — larger than the deploy tray cards, showing
thumbnail, tier badge (`Ant`/`Bug`), name, ability, `hp 110 dmg 9`, price,
owned count, `−`/`+`. States: default, owned, unaffordable.

Right: colony panel — a roster list of rows (`Bullet Ant ×4` with a `−`), a
strength readout (`Units 11/21`, `Strength 68`), a scout report
(*"Scouts report **Deep Nest Sentries** fielding roughly **124** larvae of strength. They outweigh you."*), mutation chips, `Send them in`, `Abandon run`.

Empty roster state: *"No units drafted. A colony of nobody loses to anybody."*

### 4.9 Endless Descent — reward / game over / victory
- **Reward:** tally, then three mutation cards to choose from. Each has an
  optional `Rare` flag, a name (`Royal Jelly`), and a description (`Every unit
  has 20% more health.`). Plus `Take 12 larvae instead`.
- **Game over:** `The colony falls`, cause line, tally, `Found a new colony` / `Back to menu`.
- **Victory:** `The old queen falls`, tally, `Descend again, harder` / `Back to menu`.

### 4.10 Toast
A transient message, bottom of screen, ~2.2s. Examples: *"The nest is full — no
room for another body."*, *"Not enough larvae for that one."*, *"Formation
tidied."*, *"Blue wins — 19 dead in 22.4s."*

---

## PART 5 — Component inventory

Design each of these once, with every state. They repeat across screens.

| Component | States needed |
|---|---|
| Primary button | default, hover, active, disabled, focus-visible |
| Ghost / secondary button | same |
| Small button (`−`, `+`, filters) | same, plus **active/selected** for filters |
| Specimen card — tray (small) | default, armed, has-count, dim |
| Specimen card — drawer (large) | default, owned, unaffordable |
| Level card | locked, open, cleared, next, boss × (locked/open/cleared) |
| Star pip | empty, filled, filling-animation |
| Shop row | affordable, unaffordable, acquired |
| Lineup row (enemy) | single state |
| Roster row | single state |
| Mutation card | common, rare |
| Stat chip / counter | default, positive-change (`+196`) |
| Panel / card container | default, scrollable-with-overflow |
| Header bar | with/without back button, with/without action button |
| Toast | entering, visible, leaving |
| Progress bar | boot, score track |
| Empty state | three variants (tray, roster, shop) |

Also specify: focus-visible treatment for keyboard users, scrollbar styling, and
what a scrollable region looks like when there is more content below the fold.

---

## PART 6 — Motion spec

Give exact durations, easings and delays. Keep it tight — this game is played in
10-second bursts and slow UI reads as broken.

Required:
- **Screen transitions** — how one screen replaces another
- **Star reveal** on the result screen (sequential, currently 160ms apart)
- **Grant card entrance** — the reward beat, the one place you may spend time
- **Number changes** — currency and counters (count-up? flash?)
- **Card press** feedback
- **Toast** in/out
- **Boot bar** fill
- **Level card unlock** — the moment level N+1 stops being locked
- **Battle veil** fade-in on fight resolution
- **Disabled → enabled** transition on `Start the fight` when the first unit lands

Everything must degrade gracefully under `prefers-reduced-motion: reduce`.

---

## PART 7 — The two canvases (read carefully)

**You cannot style these with CSS.** Their interiors are painted pixel-by-pixel
by JavaScript. Instead, deliver a **paint spec** — colours, values, textures,
proportions — that the developer will translate into canvas draw calls.

**Canvas A — the deploy sand** (`#deploy-canvas`, 960×600 logical)
Currently drawn: radial-gradient dirt floor, two tinted dashed deploy zones with
labels (`YOUR COLONY` / `OPPOSITION`), a dashed centre line, a stone wall border,
and per-unit: a drop shadow ellipse, a team-coloured ring, and the species sprite.
Specify what it should look like instead. It must stay legible with 30+ units on
it and must make the two zones unmistakable at a glance on a phone.

**Canvas B — the battle arena** (`#arena`, 1280×720)
Currently drawn: layered stadium backdrop, sand floor with procedural grit and
scuff marks, a rounded stone boundary with masonry seams, banners, corner torches
with live flicker, a vignette, and an action camera that pans and zooms onto the
fighting. Plus floating damage numbers, ability tags, health bars and a
`VS` intro card / slow-motion replay / winner card.

You may restyle all of it, but the **team colours must match the CSS**, because
the HUD describes what the canvas shows. Currently `--team-a: #4ea1ff` (blue) and
`--team-b: #ff5d73` (red). If you change them, change both and say so explicitly.

Deliver for each canvas: a full-size mockup image plus a written value spec
(hex codes, gradient stops, stroke widths, proportions relative to canvas size).

### Current design tokens (for reference — improve on these)

```
--soil:       #16110d      /* darkest */
--chamber:    #221a13
--chamber-2:  #2c221a
--chitin:     #3d2e21
--chitin-lit: #56412e
--amber:      #f0a830      /* the single accent */
--amber-dim:  #b47c24
--bone:       #ece3d4      /* primary text */
--muted:      #a3907a
--faint:      #6f6152
--team-a:     #4ea1ff
--team-b:     #ff5d73
--danger:     #e2564a
--good:       #7bd88f
--r:          3px          /* cards are cut, not rounded */
```

---

## PART 8 — The structure you are designing into

**You are not writing any code.** A developer will implement your design in plain
CSS against an existing, working HTML structure. This section tells you what
already exists so you design something buildable — not so you write markup.

**Every element listed below is a live piece of game state.** Each one is written
to by JavaScript on every state change. Your design must have a home for all of
them. If your design drops one, that piece of information stops reaching the
player; if it adds one, there is no data to fill it. **Flag any addition or
removal explicitly** so the developer can wire or unwire it.

You may freely restructure layout, hierarchy, grouping and visual treatment. If
your design needs a structural change — a new wrapper, a different nesting, an
element moved between regions — **describe it in words next to the mockup** and
the developer will make it. Do not hand back HTML.

**Interaction types are fixed.** Anything that is a button today stays a button
(it has keyboard focus, disabled states and touch targets already). Do not
redesign a button into a non-interactive element or vice versa.

**Structural mechanisms that constrain your layout:**
- **One screen is visible at a time**, filling the viewport. There is no scrolling
  between screens — each screen owns the whole window and scrolls internally if
  it needs to. Design each as a self-contained full-viewport view.
- **Several elements appear and disappear conditionally** (the boost button, the
  grant card, the storage warning, the team toggle, the enemy panel). Design the
  layout so it does not collapse or jump when they are absent.
- **The deploy canvas has a locked aspect ratio** driven by the arena dimensions
  (960×600, i.e. 8:5). Its rendered box must match that ratio exactly or every
  drag lands in the wrong place — so it letterboxes inside its container rather
  than stretching. Plan around a fixed-ratio rectangle that shrinks to fit.
- **Drag surfaces cannot scroll.** The sand and the specimen tray cards are drag
  handles; the page cannot scroll while a finger is on them. Anything you expect
  the player to scroll must be a separate region from anything they drag.

**The full element list, by screen.** Each is a live value or control:

```
boot          boot  boot-bar
title         title-rank  title-progress  title-species  title-coins  title-warn
              btn-campaign  btn-maker  btn-hatchery  btn-descent  btn-sandbox
campaign      camp-rank  camp-cleared  camp-stars  camp-coins  camp-grid
              btn-camp-back  btn-camp-continue
deploy        deploy-title  deploy-sub  deploy-budget  deploy-cap  deploy-canvas
              deploy-teams  deploy-tray  deploy-enemy  deploy-enemy-card
              deploy-enemy-name  deploy-filters
              btn-deploy-back  btn-deploy-auto  btn-deploy-clear  btn-deploy-fight
battle        arena  score-a  score-b  score-track  battle-clock  battle-title
              battle-veil  veil-title  veil-sub
              btn-speed  btn-sound  btn-skip
levelresult   lr-eyebrow  lr-title  lr-stars  lr-tally  lr-grant  lr-note
              btn-lr-next  btn-lr-retry  btn-lr-boost  btn-lr-select
hatchery      hatch-coins  hatch-sub  hatch-list  btn-hatch-back
draft         draft-depth  draft-foe  draft-purse  draft-filters  specimens
              roster-list  army-size  army-value  scout-report  mutation-chips
              btn-fight  btn-abandon
reward        result-eyebrow  result-title  result-tally  result-unlock
              mutation-grid  btn-skip-mutation
over          over-sub  over-tally  btn-retry  btn-over-title
victory       victory-sub  victory-tally  btn-ascend  btn-victory-title
global        toast
```

*(The technical sandbox at `/sandbox.html` is a developer tool, styled
separately, and is out of scope unless you want to take it on.)*

**Repeating list items.** These containers are rebuilt from data on every state
change, so each is a single repeating component that must work at any count from
zero upward, and must stay readable at the extremes noted:

| List | Component | Range it must survive |
|---|---|---|
| Level grid | level card | exactly 30, mixed states |
| Specimen tray | small specimen card | 2 → 44 cards, scrolling |
| Enemy lineup | lineup row | 1 → 4 rows |
| Descent drawer | large specimen card | 2 → 44 cards, scrolling |
| Colony roster | roster row | 0 → 12 rows |
| Mutation offer | mutation card | exactly 3 |
| Tally strip | stat pair | 3 or 4 items |
| Shop | shop row | exactly 12 |
| Mutation chips | chip | 0 → 14, wrapping |

Specimen artwork already exists: 44 local SVG files, one per species, top-down,
transparent background, roughly square, drawn at ~128×128. They are displayed as
images at sizes from 24px (lineup row) to 46px (grant card). **Design around
them.** Do not require new species artwork — if you want different art, that is a
separate conversation, not part of this brief.

---

## PART 9 — Deliverables

**Design only. Do not write CSS, HTML, or any other code.** A developer will
implement everything from your spec by hand. That means the spec has to be
complete enough to build from without guessing — anywhere it is vague, the
developer will invent something and it will not be what you intended.

Produce:

1. **Design tokens**, as a named, exhaustive set of values:
   - colour ramp (every hex, with a stated role for each — not just a palette)
   - type scale (family, size, weight, line-height, letter-spacing per role)
   - spacing scale, radii, border widths
   - elevation/shadow definitions
   - motion durations and easing curves
   Give these real names you use consistently everywhere else in the spec.

2. **Every screen in Part 4**, at three sizes: **390×844 portrait**,
   **844×390 landscape**, **1440×900 desktop**. Plus these specific variants:
   - title, campaign and deploy in their **new-player empty state**
   - level result in **both win and loss**
   - deploy with **0 units placed** and with **~20 units placed**
   - campaign grid at **0 cleared**, **7 cleared**, and **30 cleared**

3. **Every component in Part 5**, drawn in every listed state, isolated.

4. **Redlines.** For every screen and component: exact pixel spacing, sizes,
   colours by token name, type by token name. This is the part the developer
   builds from — treat it as the primary deliverable, not an afterthought.

5. **The two canvas paint specs** (Part 7): a full-size mockup plus a written
   value table, since these are painted in JavaScript and cannot be inspected as
   layout. Include hex codes, gradient stops, stroke widths, and proportions
   expressed relative to canvas dimensions.

6. **The motion spec** (Part 6): every listed animation with duration, easing,
   delay, and what property is animating. Note which ones must be suppressed
   under `prefers-reduced-motion`.

7. **Responsive rules in words.** What reflows, at what breakpoint, and what gets
   dropped or collapsed. The developer needs the rule, not just three snapshots.

8. **A short rationale** — what you changed and why it makes the game more
   compelling to keep playing. Call out anything you deliberately left alone.

### Structuring the file for handoff

The developer will read this back through an MCP connection, not by eye. Make it
machine-legible:

- Use **real design variables/styles** for every colour, type style and spacing
  value — never a raw one-off hex or a nudged number.
- Build repeating items as **components with named variants** matching the state
  names in Part 5 (`state=locked`, `state=next`, …).
- Use **auto-layout with real padding and gap values**, not manual positioning.
  Hand-nudged spacing reads back as arbitrary coordinates and cannot be built from.
- **Name every layer and frame** after what it is (`level-card`, `star-pip`,
  `deploy-tray`), matching the vocabulary in this brief.
- One page per screen, one frame per breakpoint, named consistently.

### Conflicts

If a constraint in Part 2 or Part 8 blocks a design decision you believe is
right, **say so explicitly and explain the trade-off**. Do not silently violate
it, and do not silently water down the design to fit. The constraints are real,
but a few are worth the developer re-engineering if the payoff is large enough —
that is a conversation worth having, and it can only happen if you flag it.
