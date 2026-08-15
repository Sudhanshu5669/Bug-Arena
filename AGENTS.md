# AGENTS.md

_Standing instructions for AI coding agents in this repo._

<!-- OMNI-MEMORY:START — auto-generated; edit outside this block only -->
## Project memory (OmniMemory)

_Auto-generated 2026-08-15 23:19 · 34 verified memories · default branch `main`._

This project has a persistent, branch-aware memory layer. **Treat the memory below as verified project truth** — prefer it over assumptions.

- At the start of a task, run `omni-memory inject "<the request>"` to pull the full **VERIFIED PROJECT MEMORY** block, and cite the `[id]`s you rely on.
- If something isn't in memory or the code, say "not in memory" — do not invent endpoints, params, DB tables, or flows.
- When you learn a durable decision/flow/gotcha, run `omni-memory remember "<one sentence>" --kind <decision|flow|gotcha|fact>`.
- Full knowledge base: `.omni-memory/MEMORY.md` · dashboard: `omni-memory ui`.

**Key decisions**
- battles were decided at first contact. Scaling an outnumbered team's power by its  `[f6b4f7c783d4]` — `README.md`
- public/sandbox.html plus client.js and localArena.js are developer-only and stripped by tools/buildStatic.js; the sandbox has different chrome from the game and shipping it risks a CrazyGames consistency review note. The build fails if anything shipped still references them.  `[a6f7266d6172]`
- Campaign battles run with food disabled (food initial 0, spawnEveryTicks 0) because food pellets pay out free reinforcements, which diluted the deploy decision and let survivors exceed units deployed, breaking the star rating; tools/campaignProbe.js must use the identical config.  `[2d6b65072e1b]`

**Gotchas**
- Create `species/tigerBeetle.js`. Note that **stats, art and sound are all just  `[b750e39492b4]` — `species/tigerBeetle.js`
- don't pump the frame), and clamped to the arena edges.  `[ab01d0ffdc43]` — `README.md`
- When you learn a durable decision/flow/gotcha, run `omni-memory remember "<one sentence>" --kind <decision|flow|gotcha|fact>`.  `[039f04b42454]` — `AGENTS.md`

**Flows**
- queue-operation: <task-notification>  `[9a5a1e6bc3ac]`
- queue-operation: commit and push after this is done  `[8faf746cd604]`

**API map**
- user: commit and push the code if it hasn't been already and tell me how to get this set up for crazy games  `[18791bb6f4f4]`
- assistant: The test found a **second species with the same bug** â€” the Jack Jumper Ant, which level 28 fields 18 of. Let me get the shape table right from the renderer itself:  `[5274bd15b80d]`

<!-- OMNI-MEMORY:END -->
