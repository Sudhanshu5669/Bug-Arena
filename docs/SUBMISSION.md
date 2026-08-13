# Submitting Colony Gladiator to CrazyGames

Everything the developer portal asks for, ready to paste. Regenerate the build
and the art with `npm run package && npm run cover`.

---

## 1. Before you upload

```bash
npm run check      # campaign is beatable + build passes portal checks + smoke test
npm run package    # -> release/colony-gladiator.zip
npm run cover      # -> release/art/*.png
```

`npm run check` is the gate. It runs four things and any of them failing means
do not submit yet:

| Step | What it proves |
|---|---|
| `tools/fxCheck.js` | Every ability effect the 44 species emit carries geometry the renderer can actually draw. A malformed payload throws mid-frame and leaves the canvas in additive blend, whiting out the rest of the battle — this shipped once, in five species at the same time. |
| `tools/campaignProbe.js` | All 30 levels are clearable by an unoptimised player, and no level is a free win. A wall here is the single most likely reason a reviewer stops playing. |
| `tools/buildStatic.js` | No root-absolute URLs, no external requests except the CrazyGames SDK, under the 50 MB / 1500 file limits, and nothing references a dev-only file the build strips. |
| `tools/smoke.js` | Every screen is reachable on desktop AND on a 390×844 phone, progress survives a reload, and the console is clean. |

Then verify the **built** bundle the way a portal actually hosts it — from a
subpath, which is where absolute-path bugs surface and a plain dev server never
will:

```bash
npm run serve:portal
# then, in another shell:
SMOKE_BASE=http://localhost:4000/games/colony-gladiator/ node tools/smoke.js
```

---

## 2. The upload

**File:** `release/colony-gladiator.zip` (~340 KB, 128 files)

`index.html` is at the **root of the archive**, not inside a folder. `npm run
package` guarantees this; if you ever zip by hand, zip the *contents* of `dist/`.

---

## 3. Store listing

**Title**

```
Colony Gladiator
```

**Short description** (one line)

```
Draft an ant colony, arrange it on the sand, and fight thirty chambers deep. Every specimen you beat is a specimen you keep.
```

**Full description**

```
Two colonies of insects meet on a patch of sand. You never control a single
unit in the fight — the whole game is the decision you make before it starts.

See exactly what the opposition is fielding, spend your larvae on the specimens
you have earned, and arrange them where you want them to stand. Then send them
in and watch it play out.

Win, and you permanently keep one of the species that was just fighting you.
That is the only way to get them: forty-four specimens, you start with two, and
every other one is taken off something that beat you first.

· 30 hand-built chambers, six of them ruled by a warlord colony
· 44 species — fire ants, bullet ants, hornets, mantises, scorpions, trapdoor
  spiders — each with its own signature ability
· Star ratings based on how many of your colony walk out alive, not how fast
  you win
· A free-build Battle Maker once you have a roster worth playing with
· Endless Descent: a roguelite run of fifteen chambers, one life, and a
  mutation after every fight
· The Hatchery, where royal jelly buys the twelve species the campaign never
  hands out

Deterministic: the fight you lose is the exact fight you retry, so a chamber
you cannot beat is a puzzle, not a dice roll.
```

**Controls / instructions**

```
Mouse: drag a specimen from the tray onto your half of the sand. Drag a placed
unit off your half to take it back. Or tap a card, then tap the sand.

Touch: the same. Everything works one-handed in portrait.

There are no controls during the fight — it resolves on its own. You can change
the speed (×1 / ×2 / ×4), mute it, or skip straight to the result.
```

**Genre / tags**

```
Primary: Strategy
Also:    Auto Battler, Simulation, Idle, Animal, Casual, Singleplayer, 2D,
         Tactics, Collecting
```

**Age rating:** Everyone. No blood, no gore, no text chat, no user-generated
content, no third-party data collection. Insects fight and disappear.

**Orientation:** Both. Portrait and landscape are laid out separately and both
are first-class; the arena re-cuts its render target to whichever it is in.

**Languages:** English.

---

## 4. Store art

Generated from the running game by `npm run cover`, so it can never show
something the game does not.

| File | Size | Use |
|---|---|---|
| `release/art/cover.png` | 1920×1080 | Main thumbnail / cover |
| `release/art/icon.png` | 1024×1024 | Square icon |
| `release/art/screenshot-1-deploy.png` | 1920×1080 | The deploy screen — the actual game |
| `release/art/screenshot-2-battle.png` | 1920×1080 | A fight mid-resolution |
| `release/art/screenshot-3-campaign.png` | 1920×1080 | The 30-chamber map |
| `release/art/screenshot-4-drawer.png` | 1920×1080 | The specimen drawer |
| `release/art/screenshot-5-phone.png` | 1170×2532 | Mobile portrait |

Lead with `screenshot-1-deploy.png`. It is the only image that shows what the
player actually does.

---

## 5. SDK integration — what is wired, and where

All of it lives in `public/portal.js`, which no-ops completely when the SDK is
absent. Nothing in the game branches on "are we on a portal".

| SDK call | Where | Notes |
|---|---|---|
| `SDK.init()` | `public/game.js` `boot()` | Raced against a 3s deadline. A blocked or slow SDK never delays first paint. |
| `game.loadingStart()` / `loadingStop()` | `boot()` | Bracket the sprite preload and engine warm-up. |
| `game.gameplayStart()` / `gameplayStop()` | `public/battle.js` | Bracket the **battle only**, never the menus — this is what the portal reads to decide an ad is not interrupting anything. |
| `game.happytime()` | `campaignScreen.js`, `descentScreen.js` | Warlord chambers and campaign completion only. Deliberately rare. |
| `ad.requestAd('midgame')` | `campaignScreen.js` `interstitial()` | Fired on the transition OUT of the result screen, at most once every 3 fights, in a gap the player was already waiting through. Never mid-fight, never on a navigation button. |
| `ad.requestAd('rewarded')` | `campaignScreen.js` `btn-lr-boost` | Strictly player-initiated, offered **only after a defeat**, once per chamber. Carries a video icon, states its reward, and sits below two free alternatives. Rewards on `adFinished` only. |
| `SDK.data` | `game/save.js` via `store.useBackend()` | Adopted once the handshake resolves, before the first read, so a signed-in player's progress syncs across devices. Falls back to `localStorage`, then to memory — a browser blocking third-party storage cannot take the game down. |

**Audio is muted for the length of every ad** (`portal.setAudioGate` →
`ArenaAudio.setAdMuted`) on a channel separate from the player's own sound
toggle, so an ad never silently turns their sound back on.

**No adblock nag, no forced ads, no ad on death, no chained ads.**

---

## 6. Technical requirements checklist

- [x] **Zip layout** — `index.html` at the archive root
- [x] **Size** — 340 KB total; the whole game is the initial download
- [x] **File count** — 128, against a limit of 1500
- [x] **Relative paths only** — enforced by the build; verified by serving from `/games/colony-gladiator/`
- [x] **Self-contained** — no CDN, no web fonts, no remote images. The only external request in the build is the CrazyGames SDK itself; the build fails on any other host
- [x] **Chrome / Edge / Safari** — plain ES modules, 2D canvas, Web Audio. No WebGL, no WASM, no bundler
- [x] **Mouse, keyboard and touch** — Pointer Events throughout; focus-visible outlines on every control
- [x] **44 px minimum touch targets**
- [x] **Both orientations**, with separate layouts
- [x] **`user-select: none`** on the body, as the portal requires
- [x] **AudioContext resumed on `pointerdown` / `touchend` / `keydown`**, and again on `visibilitychange` — the iOS case the portal calls out
- [x] **Safe-area insets** honoured for the portal's mobile app
- [x] **`prefers-reduced-motion`** respected
- [x] **Clean console** — no errors, no failed requests, no favicon 404
- [x] **Storage failure survivable** — falls back to memory and tells the player
- [x] **No external analytics, no personal data collected**, so no privacy policy is required beyond the portal's own

---

## 7. Things a reviewer will try, and what happens

| They do this | They get |
|---|---|
| Press play and do nothing | Title screen in under a second, with a primary button that names the exact level it will start |
| Press Campaign immediately | Level 1, four fire ants, a budget of 29 larvae, and an empty half of sand with "Put your colony here" on it |
| Tap Start with nothing placed | Nothing — the button is disabled until a unit is on the sand, and it visibly wakes up when one lands |
| Rotate the phone mid-fight | The arena re-cuts its render target and keeps playing |
| Lose a level | A tally, how many of the enemy were left standing, and two free ways to retry before the optional rewarded ad |
| Reload the page | Everything exactly where they left it |
| Open devtools | An empty console |
| Look for the exit | There is none. No external links anywhere in the build |
