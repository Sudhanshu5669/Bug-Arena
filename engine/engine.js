// BugArenaEngine — the renderer-agnostic simulation core.
//
// Responsibilities: the game loop, physics (via matter.js), agent AI, combat
// resolution, food, status effects, and win conditions. It emits a plain-data
// snapshot every tick and knows NOTHING about how that state is drawn.
//
// Renderers (the browser canvas today; a headless video renderer later)
// subscribe to the `snapshot` / `start` / `end` events and never touch engine
// internals. Species behaviour is injected via hooks called through a small
// context API (`this.api`) — the engine contains no species-specific branching.

import { EventEmitter } from 'events';
import Matter from 'matter-js';

import { ACTIONS, EVENTS, TEAMS, MODES } from './constants.js';
import { resolveConfig } from './config.js';
import { makeRng, randomSeed } from './rng.js';
import { Agent } from './agent.js';
import * as registry from '../species/registry.js';

const { Engine, Composite, Bodies, Body } = Matter;

const round = (n, dp = 1) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

export class BugArenaEngine extends EventEmitter {
  /**
   * @param {object} configOverride - partial config, deep-merged onto DEFAULT_CONFIG.
   */
  constructor(configOverride = {}) {
    super();
    this.config = resolveConfig(configOverride);

    this.status = 'idle'; // 'idle' | 'running' | 'finished'
    this.tick = 0;
    this.summary = null;
    this.killLog = [];
    this.lastSnapshot = null;

    this.agents = [];
    this.agentsById = new Map();
    this.food = [];

    // Colony growth bookkeeping: cumulative food eaten per team, plus a running
    // "credit" that spends down in `reinforceEvery`-sized chunks into new units.
    this._teamFoodTotal = { [TEAMS.A]: 0, [TEAMS.B]: 0 };
    this._reinforceCredit = { [TEAMS.A]: 0, [TEAMS.B]: 0 };

    // Per-engine id sequences → ids are reproducible for a given seed and never
    // collide between concurrently running engines.
    this._agentSeq = 0;
    this._foodSeq = 0;
    this._statusSeq = 0;

    // NOTE: named `_tickEvents`, NOT `_events` — the latter is an internal
    // EventEmitter field and reusing it wipes our own snapshot listeners.
    this._tickEvents = []; // events accumulated during the current tick
    this._toRemove = []; // agents whose bodies should leave the world after this tick
    this._loopHandle = null;

    this._setup();
  }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  _setup() {
    const { arena } = this.config;

    // Deterministic RNG. Record the resolved seed so the battle is replayable.
    this.seed = this.config.seed == null ? randomSeed() : this.config.seed >>> 0;
    this.rng = makeRng(this.seed);

    // Physics world: top-down, so no gravity.
    this.matter = Engine.create();
    this.matter.gravity.x = 0;
    this.matter.gravity.y = 0;
    this.dtMs = 1000 / this.config.tickRate;

    this._buildWalls();
    this._buildHookApi();
    this._spawnTeams();
    this._spawnInitialFood();

    // Emit a battle_start event into the very first snapshot.
    this.pushEvent(EVENTS.BATTLE_START, { seed: this.seed, mode: this.config.mode });
  }

  _buildWalls() {
    const { width, height, wallThickness: t } = this.config.arena;
    const opts = { isStatic: true, restitution: 0, label: 'wall' };
    // A closed box whose walls sit just inside the canvas edges. The playable
    // inset is [t, width - t] x [t, height - t].
    this.walls = [
      Bodies.rectangle(width / 2, t / 2, width, t, opts), // top
      Bodies.rectangle(width / 2, height - t / 2, width, t, opts), // bottom
      Bodies.rectangle(t / 2, height / 2, t, height, opts), // left
      Bodies.rectangle(width - t / 2, height / 2, t, height, opts), // right
    ];
    Composite.add(this.matter.world, this.walls);
  }

  /**
   * The context object passed to every species hook. This is the ONLY surface
   * species code uses to affect the world, which is what keeps species modules
   * decoupled from engine internals.
   */
  _buildHookApi() {
    const engine = this;
    this.api = {
      get tick() {
        return engine.tick;
      },
      config: this.config,
      rng: () => engine.rng(),
      randRange: (min, max) => min + engine.rng() * (max - min),
      distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),

      enemiesOf: (agent) => engine.agents.filter((o) => o.alive && o.team !== agent.team),
      alliesOf: (agent) =>
        engine.agents.filter((o) => o.alive && o.team === agent.team && o !== agent),
      enemiesInRadius: (agent, r) =>
        engine.agents.filter(
          (o) => o.alive && o.team !== agent.team && engine._dist(agent, o) <= r
        ),
      alliesInRadius: (agent, r) =>
        engine.agents.filter(
          (o) => o.alive && o.team === agent.team && o !== agent && engine._dist(agent, o) <= r
        ),
      nearestEnemy: (agent, maxR = Infinity) => engine._nearestEnemy(agent, maxR),

      dealDamage: (target, amount, meta = {}) => engine._applyDamage(target, amount, meta),
      heal: (agent, amount) => engine._heal(agent, amount),
      applyStatus: (target, descriptor, source = null) =>
        engine._applyStatus(target, descriptor, source),

      // Convert seconds -> ticks (for status durations authored in seconds).
      seconds: (s) => Math.max(1, Math.round(s * engine.config.tickRate)),
      // Mobility helper: snap `agent` toward `target` by up to `dist` px without
      // overlapping into it. Used by dash-type abilities.
      lunge: (agent, target, dist) => engine._lunge(agent, target, dist),
      // Charge helper: drive `agent` a long way in `target`'s direction, plowing
      // through every enemy along the swept line — each takes damage + knockback.
      // Returns { startX, startY, endX, endY, hit } for the caller's dash VFX.
      dashThrough: (agent, target, opts = {}) => engine._dashThrough(agent, target, opts),

      emitEvent: (type, data = {}) => engine.pushEvent(type, data),
      spawnEffect: (data = {}) => engine.pushEvent(EVENTS.EFFECT, data),
    };
  }

  _spawnTeams() {
    this.spawnPlan = {};

    // Custom roster (from the fight builder): spawn EXACTLY what was requested,
    // bypassing the random tier squads. Shape:
    //   teams.custom = { A: [{ species, count }, ...], B: [...] }
    const custom = this.config.teams.custom;
    if (custom && (custom.A || custom.B)) {
      for (const team of [TEAMS.A, TEAMS.B]) {
        const units = this._expandCustomRoster(custom[team]);
        const total = units.length;
        let idx = 0;
        let soldiers = 0;
        let champions = 0;
        for (const species of units) {
          const isChampion = species.tier === 'champion';
          const { x, y } = this._spawnPosition(team, idx++, total, isChampion);
          this._spawnAgent(team, species, x, y);
          if (isChampion) champions++;
          else soldiers++;
        }
        this.spawnPlan[team] = { soldiers, champions };
      }
      return;
    }

    // Tier-driven: a randomized squad of soldiers + a fixed count of champions,
    // each pick independent per team. No species names appear here — pools come
    // from the registry by tier, so new soldiers/champions slot in automatically.
    const soldierPool = this._resolveTierPool('soldier', this.config.teams.soldierPool);
    const championPool = this._resolveTierPool('champion', this.config.teams.championPool);
    const { min, max } = this.config.teams.soldiers;
    const championsPer = Math.max(0, this.config.teams.champions ?? 1);

    this.spawnPlan = {};
    for (const team of [TEAMS.A, TEAMS.B]) {
      const squadSize = this._randInt(min, max);
      const total = squadSize + championsPer;
      let idx = 0;
      for (let i = 0; i < squadSize; i++) {
        const species = soldierPool[Math.floor(this.rng() * soldierPool.length)];
        const { x, y } = this._spawnPosition(team, idx++, total, false);
        this._spawnAgent(team, species, x, y);
      }
      for (let i = 0; i < championsPer; i++) {
        const species = championPool[Math.floor(this.rng() * championPool.length)];
        const { x, y } = this._spawnPosition(team, idx++, total, true);
        this._spawnAgent(team, species, x, y);
      }
      this.spawnPlan[team] = { soldiers: squadSize, champions: championsPer };
    }
  }

  /**
   * Turn a builder roster (`[{ species, count }]`) into a flat array of species
   * configs. Unknown ids are skipped (never crash a battle), and counts are clamped
   * to a sane range so a stray huge number can't hang the sim.
   */
  _expandCustomRoster(list) {
    const units = [];
    if (!Array.isArray(list)) return units;
    for (const entry of list) {
      if (!entry || !entry.species || !registry.hasSpecies(entry.species)) continue;
      const count = Math.max(0, Math.min(100, Math.floor(entry.count ?? 0)));
      const species = registry.getSpecies(entry.species);
      for (let i = 0; i < count; i++) units.push(species);
    }
    return units;
  }

  /** Resolve a tier's species configs; `override` (ids) wins over the registry. */
  _resolveTierPool(tier, override) {
    const ids = override ?? registry.listByTier(tier);
    if (!ids.length) {
      throw new Error(
        `No "${tier}"-tier species available. Register at least one (or pass a pool), ` +
          'and make sure species modules are imported (e.g. `import "../species/index.js"`).'
      );
    }
    return ids.map((id) => registry.getSpecies(id));
  }

  _spawnPosition(team, i, count, isChampion) {
    const { width, height, wallThickness: t } = this.config.arena;
    const top = t + 30;
    const bottom = height - t - 30;
    const laneY = count > 1 ? top + ((bottom - top) * i) / (count - 1) : (top + bottom) / 2;
    const jitterY = (this.rng() - 0.5) * 40;
    const y = Math.max(top, Math.min(bottom, laneY + jitterY));

    // Soldiers form up near their wall; the champion leads from further forward.
    const depth = isChampion ? 120 + this.rng() * 40 : 20 + this.rng() * 70;
    const x = team === TEAMS.A ? t + depth : width - t - depth;
    return { x, y };
  }

  _spawnAgent(team, species, x, y) {
    const body = Bodies.circle(x, y, species.stats.size, {
      restitution: 0,
      friction: 0,
      frictionAir: 0.08,
      label: `agent:${species.id}`,
    });
    Composite.add(this.matter.world, body);

    const agent = new Agent({ id: `a${this._agentSeq++}`, team, species, body });
    body.plugin = { agentId: agent.id }; // back-reference for future collision work
    this.agents.push(agent);
    this.agentsById.set(agent.id, agent);

    species.hooks.on_spawn?.(agent, this.api);
    return agent;
  }

  _spawnInitialFood() {
    for (let i = 0; i < this.config.food.initial; i++) this._spawnFood();
  }

  _spawnFood() {
    if (this.food.length >= this.config.food.maxOnField) return null;
    const { width, height, wallThickness: t } = this.config.arena;
    const x = width * 0.28 + this.rng() * width * 0.44;
    const y = t + 30 + this.rng() * (height - 2 * t - 60);
    const pellet = { id: `f${this._foodSeq++}`, x, y, size: this.config.food.size };
    this.food.push(pellet);
    this.pushEvent(EVENTS.FOOD_SPAWN, { id: pellet.id, x: round(x), y: round(y) });
    return pellet;
  }

  // ---------------------------------------------------------------------------
  // Loop control
  // ---------------------------------------------------------------------------

  /** Start a real-time loop (used by the dev server). */
  start() {
    if (this._loopHandle || this.status === 'finished') return;
    this.status = 'running';
    this.emit('start', this.getInitPayload());
    this._loopHandle = setInterval(() => {
      this.step();
      if (this.status === 'finished') {
        this.stop();
        this.emit('end', this.summary);
      }
    }, this.dtMs);
  }

  stop() {
    if (this._loopHandle) {
      clearInterval(this._loopHandle);
      this._loopHandle = null;
    }
  }

  /**
   * Run the whole battle synchronously with no timers. This is the entry point
   * a headless renderer or `POST /api/simulate` uses — it produces the same
   * `snapshot`/`end` event stream as the live loop, just as fast as the CPU allows.
   */
  runToCompletion() {
    if (this.status === 'idle') {
      this.status = 'running';
      this.emit('start', this.getInitPayload());
    }
    // Hard safety cap so a pathological config can never loop forever.
    const hardCap = this.config.maxTicks + 10;
    while (this.status === 'running' && this.tick < hardCap) {
      this.step();
    }
    if (this.status === 'running') this._endBattle('draw', 'timeout');
    this.emit('end', this.summary);
    return this.summary;
  }

  // ---------------------------------------------------------------------------
  // The tick
  // ---------------------------------------------------------------------------

  /** Advance the simulation by exactly one tick and emit a snapshot. */
  step() {
    if (this.status !== 'running') return this.lastSnapshot;
    this.tick++;

    this._updateStatuses(); // burn/web etc. (may cause deaths)
    this._resolveCasts(); // release any ability whose wind-up has elapsed (the "launch")
    this._runAgentAI(); // decide + move + attack (may cause deaths)
    this._runPassiveHooks(); // on_tick + aura_effect for every living agent
    this._flushRemovals(); // pull dead bodies out of the world
    Engine.update(this.matter, this.dtMs); // resolve physics/collisions
    this._maybeSpawnFood();
    this._checkWinCondition(); // may flip status -> 'finished'

    const snap = this._buildSnapshot();
    this.lastSnapshot = snap;
    this.emit('snapshot', snap);
    this._tickEvents = [];
    return snap;
  }

  _updateStatuses() {
    for (const agent of this.agents) {
      if (!agent.alive) continue;
      let mult = 1;
      for (const s of agent.statuses) {
        s.remaining -= 1;
        if (s.damagePerTick > 0 && agent.alive) {
          this._applyDamage(agent, s.damagePerTick, {
            sourceAgent: this.agentsById.get(s.sourceId) ?? null,
            cause: s.type,
          });
        }
      }
      agent.statuses = agent.statuses.filter((s) => s.remaining > 0);
      for (const s of agent.statuses) mult *= s.speedMultiplier;
      agent.speedMultiplier = mult;
    }
  }

  _runAgentAI() {
    // Snapshot the living list so mid-tick deaths don't disturb iteration.
    const living = this.agents.filter((a) => a.alive);
    for (const agent of living) {
      if (!agent.alive) continue;
      if (agent.attackCooldown > 0) agent.attackCooldown -= 1;
      if (agent.abilityCooldown > 0) agent.abilityCooldown -= 1;
      this._think(agent);
    }
  }

  _runPassiveHooks() {
    for (const agent of this.agents) {
      if (!agent.alive) continue;
      agent.species.hooks.on_tick?.(agent, this.api);
      agent.species.hooks.aura_effect?.(agent, this.api);
    }
  }

  /**
   * Generic per-agent decision logic. Still no species NAMES branch here: behaviour
   * is driven entirely by the species' `ai` descriptor (forage/herd/hunt/target
   * preference/last-stand) plus `agent.stats` and the battle mode, so a new species
   * changes how it acts purely through data.
   */
  _think(agent) {
    // Winding up an ability: fully committed. Hold the aim, drift into the recoil
    // (the "pull back" before a leap), and don't run normal AI until it releases.
    if (agent.castState) {
      this._tickCast(agent);
      return;
    }

    // Immobilized (e.g. webbed / staggered): cannot move OR attack — just struggle
    // in place. It can still be freely attacked and take damage; that's the point.
    if (agent.statuses.some((s) => s.preventAttack)) {
      agent.action = ACTIONS.TRAPPED;
      this._setVelocity(agent, 0, 0);
      return;
    }

    const ai = agent.species.ai;
    const allies = this._alliesAlive(agent);

    // Last of the colony (no allies left): a champion goes berserk — a one-time
    // +20% to all stats — and actively hunts the enemy team across the whole arena.
    if (ai.loneSurvivorRage && allies.length === 0) {
      this._enrageIfNeeded(agent);
      const prey = this._selectEnemyTarget(agent, Infinity, ai.targetPreference);
      if (prey) return this._engageEnemy(agent, prey);
      agent.action = ACTIONS.IDLE;
      return this._wander(agent);
    }

    // Already in a fight? Find an enemy to engage. Bugs (and aggressive ants) hunt
    // across full vision; passive ants only react to threats that get close.
    const engageRange = ai.hunts
      ? agent.stats.visionRange
      : this.config.mode === MODES.PASSIVE
        ? agent.stats.size * 3 + 30
        : agent.stats.visionRange;
    const enemy = this._selectEnemyTarget(agent, engageRange, ai.targetPreference);
    if (enemy) return this._engageEnemy(agent, enemy);

    // No fight: ants forage.
    if (ai.forages) {
      const food = this._nearestFood(agent);
      if (food) return this._seekFood(agent, food);
    }

    // Still nothing to do: regroup toward the biggest allied herd and stay close.
    // Loners (e.g. the suicide ant) only do this when exposed to a looming threat.
    const shouldHerd = ai.herds || (ai.herdWhenExposed && this._isExposed(agent, allies));
    if (shouldHerd) {
      const core = this._herdCore(agent, allies);
      if (core) return this._regroup(agent, core);
    }

    agent.action = ACTIONS.IDLE;
    this._wander(agent);
  }

  /** Living teammates other than `agent`. */
  _alliesAlive(agent) {
    const out = [];
    for (const o of this.agents) {
      if (o.alive && o.team === agent.team && o !== agent) out.push(o);
    }
    return out;
  }

  /** Pursue/attack an enemy agent. */
  _engageEnemy(agent, enemy) {
    agent.targetId = enemy.id;
    if (this._inAttackRange(agent, enemy)) {
      agent.action = ACTIONS.ATTACK;
      this._faceToward(agent, enemy);
      this._setVelocity(agent, 0, 0);
      if (agent.attackCooldown <= 0) {
        this._performAttack(agent, enemy);
        agent.attackCooldown = agent.stats.attackCooldown;
      }
    } else {
      agent.action = ACTIONS.PURSUE;
      this._moveToward(agent, enemy);
    }
  }

  /** Move to a food pellet and eat it once in reach. */
  _seekFood(agent, food) {
    agent.targetId = null;
    const reach = agent.stats.size + food.size + 2;
    if (this._dist(agent, food) <= reach) {
      this._eatFood(agent, food);
      agent.action = ACTIONS.EAT;
      this._setVelocity(agent, 0, 0);
    } else {
      agent.action = ACTIONS.SEEK_FOOD;
      this._moveToward(agent, food);
    }
  }

  /** March toward the herd core; once close, mill about within it. */
  _regroup(agent, core) {
    agent.targetId = null;
    const closeR = agent.stats.size + core.stats.size + 40; // "closely"
    if (this._dist(agent, core) > closeR) {
      agent.action = ACTIONS.REGROUP;
      this._moveToward(agent, core);
    } else {
      agent.action = ACTIONS.IDLE;
      this._wander(agent);
    }
  }

  /**
   * The anchor of the biggest allied herd: the ally with the most teammates packed
   * around it. Ties break toward the cluster nearest `agent` so it joins the group
   * it's closest to. With one ally, that ally is the (trivial) herd.
   */
  _herdCore(agent, allies) {
    if (!allies.length) return null;
    const R = 120;
    let best = null;
    let bestCount = -1;
    for (const a of allies) {
      let count = 0;
      for (const b of allies) if (b !== a && this._dist(a, b) <= R) count++;
      if (
        count > bestCount ||
        (count === bestCount && best && this._dist(agent, a) < this._dist(agent, best))
      ) {
        bestCount = count;
        best = a;
      }
    }
    return best;
  }

  /** True if an enemy is in sight but no ally is nearby — i.e. dangerously alone. */
  _isExposed(agent, allies) {
    const enemy = this._nearestEnemy(agent, agent.stats.visionRange);
    if (!enemy || this._inAttackRange(agent, enemy)) return false;
    return !allies.some((a) => this._dist(agent, a) <= 90);
  }

  /**
   * Pick an enemy within `range`.
   *  - 'nearest'  : the closest one (the default).
   *  - 'isolated' : the most alone one — fewest of ITS OWN teammates clustered
   *                 around it (ties → closest). This is how the scorpion picks off
   *                 lone ants/bugs and only wades into a horde when nothing's alone.
   */
  _selectEnemyTarget(agent, range, preference) {
    if (preference !== 'isolated') return this._nearestEnemy(agent, range);
    let best = null;
    let bestScore = Infinity;
    const R = 90;
    for (const o of this.agents) {
      if (!o.alive || o.team === agent.team) continue;
      const d = this._dist(agent, o);
      if (d > range) continue;
      let density = 0;
      for (const m of this.agents) {
        if (m.alive && m.team === o.team && m !== o && this._dist(o, m) <= R) density++;
      }
      const score = density * 1000 + d; // isolation dominates; distance breaks ties
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    return best;
  }

  /**
   * The last-stand buff: a one-time +20% to every combat stat (attack cooldown
   * drops so it swings faster), current HP scaled up to match, and a lasting
   * "Enraged" marker + burst so it's unmistakable on screen.
   */
  _enrageIfNeeded(agent) {
    if (agent.memory.enraged) return;
    agent.memory.enraged = true;
    const M = 1.2;
    agent.stats.speed *= M;
    agent.stats.damage *= M;
    agent.stats.attackRange *= M;
    agent.stats.visionRange *= M;
    agent.stats.attackCooldown = Math.max(1, Math.round(agent.stats.attackCooldown / M));
    agent.stats.maxHealth = Math.round(agent.stats.maxHealth * M);
    agent.maxHealth = agent.stats.maxHealth;
    agent.health = Math.min(agent.maxHealth, Math.round(agent.health * M));

    this._applyStatus(
      agent,
      { type: 'enraged', label: 'Enraged', duration: this.config.maxTicks + 100 },
      agent
    );
    this.pushEvent(EVENTS.EFFECT, { kind: 'enrage', x: round(agent.x), y: round(agent.y), team: agent.team });
    this.pushEvent(EVENTS.ABILITY, {
      casterId: agent.id,
      casterTeam: agent.team,
      casterSpecies: agent.speciesId,
      ability: 'Last Stand',
      text: `${agent.species.name} is the last of its colony — enraged!`,
      x: round(agent.x),
      y: round(agent.y),
    });
  }

  // ---------------------------------------------------------------------------
  // Combat & effects
  // ---------------------------------------------------------------------------

  _performAttack(agent, target) {
    const dmg = agent.stats.damage;
    const kind = agent.stats.attackRange > 60 ? 'ranged' : 'melee';
    this.pushEvent(EVENTS.ATTACK, {
      attackerId: agent.id,
      targetId: target.id,
      speciesId: agent.speciesId,
      x: round(target.x),
      y: round(target.y),
      damage: dmg,
      kind,
    });
    // Base weapon damage always applies. `on_attack` is for any per-hit passive;
    // the signature ABILITY is gated separately below (hybrid chance + cooldown).
    this._applyDamage(target, dmg, { sourceAgent: agent, kind });
    agent.species.hooks.on_attack?.(agent, target, this.api);
    this._tryAbility(agent, target);
  }

  /**
   * Hybrid ability gate, evaluated on every attack. This is generic — no species
   * branching. Flow: the attack already dealt normal damage above; if the ability
   * is off cooldown and not mid-cast, roll its chance. On a hit, commit the cooldown
   * and either fire immediately or (if the ability has a `windupSeconds`) enter a
   * telegraphed wind-up that releases later in `_resolveCasts`. On a chance-miss,
   * nothing happens and no cooldown is consumed (it can try again next hit).
   */
  _tryAbility(agent, target) {
    const ability = agent.species.ability;
    if (!ability || !target || !target.alive) return;
    if (agent.abilityCooldown > 0) return; // cooldown gate
    if (agent.castState) return; // already committed to a wind-up
    if (this.rng() >= ability.triggerChance) return; // random-chance gate

    // Cooldown is committed the instant the ability is triggered — the wind-up is
    // part of the cast, not free time to re-roll.
    agent.abilityCooldown = Math.max(1, Math.round(ability.cooldownSeconds * this.config.tickRate));

    const windupTicks = ability.windupSeconds
      ? Math.max(1, Math.round(ability.windupSeconds * this.config.tickRate))
      : 0;
    if (windupTicks > 0) {
      this._beginCast(agent, ability, target, windupTicks);
    } else {
      this._fireAbility(agent, ability, target);
    }
  }

  /**
   * Enter the anticipation phase: face the target, remember the aim, and telegraph
   * it so the renderer can play the wind-up (a mantis crouch/recoil, a spider's web
   * gathering). The actual effect fires later, in `_resolveCasts`.
   */
  _beginCast(agent, ability, target, windupTicks) {
    this._faceToward(agent, target);
    const dx = target.x - agent.x;
    const dy = target.y - agent.y;
    const d = Math.hypot(dx, dy) || 1;
    agent.castState = {
      abilityName: ability.name,
      releaseTick: this.tick + windupTicks,
      windupTicks,
      targetId: target.id,
      dirX: dx / d,
      dirY: dy / d,
      recoil: ability.windupRecoil ?? 0, // px to slide backward across the wind-up
    };
    agent.action = ACTIONS.WINDUP;

    this.pushEvent(EVENTS.EFFECT, {
      kind: 'windup',
      casterId: agent.id,
      ability: ability.name,
      color: ability.telegraphColor ?? '#ffe08a',
      x: round(agent.x),
      y: round(agent.y),
      dirX: round(dx / d, 3),
      dirY: round(dy / d, 3),
      team: agent.team,
      duration: round(windupTicks / this.config.tickRate, 2),
    });
  }

  /** Per-tick behaviour while an agent is winding up: hold aim + recoil back. */
  _tickCast(agent) {
    const cs = agent.castState;
    agent.action = ACTIONS.WINDUP;
    this._setVelocity(agent, 0, 0);
    Body.setAngle(agent.body, Math.atan2(cs.dirY, cs.dirX));
    if (cs.recoil > 0) {
      const { width, height, wallThickness: t } = this.config.arena;
      const pad = agent.stats.size + 2;
      const step = cs.recoil / cs.windupTicks; // spread the pull-back over the wind-up
      const nx = Math.max(t + pad, Math.min(width - t - pad, agent.x - cs.dirX * step));
      const ny = Math.max(t + pad, Math.min(height - t - pad, agent.y - cs.dirY * step));
      Body.setPosition(agent.body, { x: nx, y: ny });
    }
  }

  /** Release every cast whose wind-up has elapsed (runs before the AI each tick). */
  _resolveCasts() {
    for (const agent of this.agents) {
      if (!agent.alive || !agent.castState) continue;
      const cs = agent.castState;
      if (this.tick < cs.releaseTick) continue;
      agent.castState = null;

      const ability = agent.species.ability;
      if (!ability) continue;
      // Re-acquire the target: the original may have died or fled during the wind-up.
      let target = this.agentsById.get(cs.targetId);
      if (!target || !target.alive) target = this._nearestEnemy(agent, agent.stats.visionRange);
      // Direction-based abilities (e.g. a dash) still launch even with no target —
      // aim the body at the remembered heading so they fly true.
      Body.setAngle(agent.body, Math.atan2(cs.dirY, cs.dirX));
      this._fireAbility(agent, ability, target);
    }
  }

  /**
   * Actually apply an ability: run its `onTrigger`, then emit the readable ABILITY
   * event. Shared by the instant path and the deferred (post-wind-up) path.
   */
  _fireAbility(agent, ability, target) {
    // Target-required abilities (e.g. the web's epicentre) fizzle if nothing's left
    // to hit; direction-based ones opt out via `requiresTarget: false`.
    if (!target && ability.requiresTarget !== false) return;

    const result = ability.onTrigger(agent, target, this.api);

    const text =
      typeof ability.log === 'function'
        ? ability.log(agent, target, result)
        : `${agent.species.name} used ${ability.name}`;
    this.pushEvent(EVENTS.ABILITY, {
      casterId: agent.id,
      casterTeam: agent.team,
      casterSpecies: agent.speciesId,
      targetId: target?.id ?? null,
      targetTeam: target?.team ?? null,
      targetSpecies: target?.speciesId ?? null,
      ability: ability.name,
      text, // short, readable — consumed by the kill feed and future narration layer
      x: round(agent.x), // caster position, for the floating ability tag
      y: round(agent.y),
    });
    return result;
  }

  /** Snap `agent` toward `target` by up to `dist` px without overlapping into it. */
  _lunge(agent, target, dist) {
    const dx = target.x - agent.x;
    const dy = target.y - agent.y;
    const d = Math.hypot(dx, dy) || 1;
    const gap = d - (agent.stats.size + (target.stats?.size ?? 0));
    const step = Math.max(0, Math.min(dist, gap));
    Body.setPosition(agent.body, { x: agent.x + (dx / d) * step, y: agent.y + (dy / d) * step });
  }

  /**
   * Charge: drive `agent` a long distance in `target`'s direction and plow through
   * every enemy whose body the swept line touches — each takes `damage` and is
   * knocked clear of the lane. The dasher ends past its foes, not stuck on the
   * first one, which is what makes it read as a "dash", not a nudge.
   *
   * @param {object} opts  { distance, radius, damage, knockback }
   * @returns {{ startX:number, startY:number, endX:number, endY:number, hit:Agent[] }}
   */
  _dashThrough(agent, target, opts = {}) {
    const distance = opts.distance ?? 130;
    const radius = opts.radius ?? agent.stats.size + 16;
    const damage = opts.damage ?? agent.stats.damage;
    const knockback = opts.knockback ?? 30;

    const startX = agent.x;
    const startY = agent.y;
    // Aim at the target; fall back to current heading if none.
    let dx = target ? target.x - startX : Math.cos(agent.angle);
    let dy = target ? target.y - startY : Math.sin(agent.angle);
    const dlen = Math.hypot(dx, dy) || 1;
    dx /= dlen;
    dy /= dlen;

    // End point, clamped inside the playable inset so we never dash into a wall.
    const { width, height, wallThickness: t } = this.config.arena;
    const pad = agent.stats.size + 2;
    const endX = Math.max(t + pad, Math.min(width - t - pad, startX + dx * distance));
    const endY = Math.max(t + pad, Math.min(height - t - pad, startY + dy * distance));

    // Everyone the sweep touches (collect BEFORE moving anyone).
    const hit = [];
    for (const o of this.agents) {
      if (!o.alive || o.team === agent.team) continue;
      const gap = this._distPointSegment(o.x, o.y, startX, startY, endX, endY) - o.stats.size;
      if (gap <= radius) hit.push(o);
    }

    // Move the dasher to the end of the charge.
    Body.setPosition(agent.body, { x: endX, y: endY });
    Body.setAngle(agent.body, Math.atan2(dy, dx));

    // Perpendicular to travel — used to shove each victim off the lane.
    const px = -dy;
    const py = dx;
    const staggerTicks = Math.max(1, Math.round((opts.staggerSeconds ?? 0.55) * this.config.tickRate));
    for (const o of hit) {
      let side = (o.x - startX) * px + (o.y - startY) * py; // which side of the line
      if (Math.abs(side) < 1e-3) side = 1; // dead-on hit → pick a side deterministically
      const sign = side >= 0 ? 1 : -1;
      // Mostly sideways (bowled aside) with a little forward carry.
      const kx = px * sign * knockback + dx * knockback * 0.4;
      const ky = py * sign * knockback + dy * knockback * 0.4;
      const fromX = o.x;
      const fromY = o.y;
      const nx = Math.max(t + pad, Math.min(width - t - pad, o.x + kx));
      const ny = Math.max(t + pad, Math.min(height - t - pad, o.y + ky));
      Body.setPosition(o.body, { x: nx, y: ny });
      Body.setVelocity(o.body, { x: 0, y: 0 });
      // An impact spark that flies from where they were struck to where they land,
      // so the knockback actually reads on screen.
      this.pushEvent(EVENTS.EFFECT, { kind: 'impact', x: round(nx), y: round(ny), x0: round(fromX), y0: round(fromY) });
      this._applyDamage(o, damage, { sourceAgent: agent, cause: 'dash_strike' });
      // Stunned on landing — they don't just spring back up swinging.
      if (o.alive) {
        this._applyStatus(
          o,
          {
            type: 'stagger',
            label: 'Dazed',
            duration: staggerTicks,
            speedMultiplier: 0,
            preventMove: true,
            preventAttack: true,
          },
          agent
        );
      }
    }

    return { startX, startY, endX, endY, hit };
  }

  /** Shortest distance from point (px,py) to the segment (ax,ay)-(bx,by). */
  _distPointSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  _applyDamage(target, amount, meta = {}) {
    if (!target.alive || amount <= 0) return;
    target.health -= amount;
    // Emit a damage signal so the renderer can float a number. Fires for every
    // damage source (weapon hit, ability bonus, DoT tick, AoE) — the renderer
    // merges rapid numbers per target so DoT ticks don't spam.
    this.pushEvent(EVENTS.DAMAGE, {
      targetId: target.id,
      amount: round(amount, 1),
      x: round(target.x),
      y: round(target.y),
      cause: meta.cause ?? meta.kind ?? 'hit',
    });
    target.species.hooks.on_damaged?.(target, amount, meta.sourceAgent ?? null, this.api);
    if (target.health <= 0) {
      this._killAgent(target, meta.sourceAgent ?? null, meta.cause ?? meta.kind ?? 'attack');
    }
  }

  _heal(agent, amount) {
    if (!agent.alive) return;
    agent.health = Math.min(agent.maxHealth, agent.health + amount);
  }

  _applyStatus(target, descriptor, source = null) {
    if (!target.alive) return;
    // Damage-over-time is AUTHORED per second (intuitive), but the engine ticks it
    // every frame — so convert here. `damagePerTick` stays supported for any caller
    // that really wants raw per-tick values.
    const damagePerTick =
      descriptor.damagePerSecond != null
        ? descriptor.damagePerSecond / this.config.tickRate
        : descriptor.damagePerTick ?? 0;
    const status = {
      id: `s${this._statusSeq++}`,
      type: descriptor.type,
      label: descriptor.label ?? descriptor.type, // shown above the agent by the renderer
      duration: descriptor.duration,
      remaining: descriptor.duration,
      speedMultiplier: descriptor.speedMultiplier ?? 1,
      damagePerTick,
      preventMove: !!descriptor.preventMove, // generic flags the engine reads
      preventAttack: !!descriptor.preventAttack, // (immobilize = both true)
      sourceId: source ? source.id : null,
      sourceTeam: source ? source.team : null,
    };
    const existing = target.statuses.find((s) => s.type === status.type);
    if (existing && !descriptor.stackable) {
      // Refresh duration rather than stacking (keeps things bounded).
      existing.remaining = Math.max(existing.remaining, status.remaining);
      existing.speedMultiplier = status.speedMultiplier;
      existing.damagePerTick = status.damagePerTick;
      existing.preventMove = status.preventMove;
      existing.preventAttack = status.preventAttack;
      existing.sourceId = status.sourceId;
    } else {
      target.statuses.push(status);
    }
    this.pushEvent(EVENTS.STATUS_APPLIED, {
      agentId: target.id,
      statusType: status.type, // NOT `type` — that key is the event discriminator
      duration: status.duration,
    });
  }

  _killAgent(agent, killer, cause) {
    if (!agent.alive) return;
    agent.alive = false;
    agent.health = 0;
    agent.action = ACTIONS.DEAD;
    agent.killerId = killer ? killer.id : null;

    const record = {
      tick: this.tick,
      time: round(this.tick / this.config.tickRate, 2),
      victimId: agent.id,
      victimSpecies: agent.speciesId,
      victimTeam: agent.team,
      x: round(agent.x), // needed by the renderer's death poof / K.O. text
      y: round(agent.y),
      killerId: killer ? killer.id : null,
      killerSpecies: killer ? killer.speciesId : null,
      killerTeam: killer ? killer.team : null,
      cause,
    };
    this.killLog.push(record);
    this.pushEvent(EVENTS.DEATH, record);

    // Death hook fires while the body still has a valid position (e.g. Fire Ant's
    // ember burst). Any secondary kills recurse safely — the guard above dedupes.
    agent.species.hooks.on_death?.(agent, this.api, killer);

    this._toRemove.push(agent);
  }

  _eatFood(agent, food) {
    const idx = this.food.indexOf(food);
    if (idx === -1) return;
    this.food.splice(idx, 1);
    this._heal(agent, this.config.food.healAmount);
    agent.memory.foodEaten = (agent.memory.foodEaten ?? 0) + 1;
    this.pushEvent(EVENTS.FOOD_EATEN, { agentId: agent.id, foodId: food.id, team: agent.team });

    // Colony growth: bank the food toward this team's next reinforcement. Skipped
    // in custom-roster fights so the exact matchup you built stays the matchup.
    this._teamFoodTotal[agent.team] += 1;
    const custom = this.config.teams.custom;
    const isCustomFight = !!(custom && (custom.A || custom.B));
    const every = this.config.food.reinforceEvery;
    if (!isCustomFight && every > 0) {
      this._reinforceCredit[agent.team] += 1;
      // A `while` (not `if`) so a config with a small threshold can't fall behind.
      while (this._reinforceCredit[agent.team] >= every) {
        this._reinforceCredit[agent.team] -= every;
        this._spawnReinforcement(agent.team);
      }
    }
  }

  /**
   * Muster one fresh unit for `team` at its home wall. Almost always a soldier
   * ant; with `food.bugChance` it's a champion-tier BUG instead. Tier-driven — it
   * picks from the same registry pools as the opening roster, so any newly added
   * soldier/bug is eligible with no change here.
   */
  _spawnReinforcement(team) {
    const isBug = this.rng() < this.config.food.bugChance;
    const tier = isBug ? 'champion' : 'soldier';
    const poolOverride = isBug ? this.config.teams.championPool : this.config.teams.soldierPool;
    const pool = this._resolveTierPool(tier, poolOverride);
    const species = pool[Math.floor(this.rng() * pool.length)];
    const { x, y } = this._reinforceSpawnPosition(team);
    this._spawnAgent(team, species, x, y);

    this.pushEvent(EVENTS.REINFORCEMENT, {
      team,
      speciesId: species.id,
      speciesName: species.name,
      tier,
      isBug,
      x: round(x),
      y: round(y),
    });
    // A spawn-in flourish at the muster point (team-tinted; gold when it's a bug).
    this.pushEvent(EVENTS.EFFECT, { kind: 'spawn_in', x: round(x), y: round(y), team, isBug });
  }

  /** A muster point just inside `team`'s home wall, at a random lane. */
  _reinforceSpawnPosition(team) {
    const { width, height, wallThickness: t } = this.config.arena;
    const top = t + 30;
    const bottom = height - t - 30;
    const y = top + this.rng() * (bottom - top);
    const depth = 24 + this.rng() * 44;
    const x = team === TEAMS.A ? t + depth : width - t - depth;
    return { x, y };
  }

  _flushRemovals() {
    if (!this._toRemove.length) return;
    for (const agent of this._toRemove) {
      Composite.remove(this.matter.world, agent.body);
    }
    this._toRemove = [];
  }

  _maybeSpawnFood() {
    const { spawnEveryTicks } = this.config.food;
    if (spawnEveryTicks > 0 && this.tick % spawnEveryTicks === 0) this._spawnFood();
  }

  // ---------------------------------------------------------------------------
  // Movement helpers
  // ---------------------------------------------------------------------------

  _moveToward(agent, target) {
    const dx = target.x - agent.x;
    const dy = target.y - agent.y;
    const len = Math.hypot(dx, dy) || 1;
    const speed = agent.stats.speed * agent.speedMultiplier;
    this._setVelocity(agent, (dx / len) * speed, (dy / len) * speed);
    if (speed > 0) Body.setAngle(agent.body, Math.atan2(dy, dx));
  }

  _faceToward(agent, target) {
    Body.setAngle(agent.body, Math.atan2(target.y - agent.y, target.x - agent.x));
  }

  _wander(agent) {
    // Lightweight idle drift: pick a heading occasionally and amble at half speed.
    const m = agent.memory;
    if (m.wanderUntil == null || this.tick >= m.wanderUntil) {
      m.wanderDir = this.rng() * Math.PI * 2;
      m.wanderUntil = this.tick + 30 + Math.floor(this.rng() * 60);
    }
    const speed = agent.stats.speed * agent.speedMultiplier * 0.4;
    this._setVelocity(agent, Math.cos(m.wanderDir) * speed, Math.sin(m.wanderDir) * speed);
  }

  _setVelocity(agent, x, y) {
    Body.setVelocity(agent.body, { x, y });
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  _dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /**
   * Attack range is measured surface-to-surface (edge gap), NOT center-to-center.
   * Physics collision keeps two bodies' centers >= (sizeA + sizeB) apart, so a
   * center-distance check made a small-reach attacker (e.g. Fire Ant, range 16)
   * unable to ever reach a larger body (e.g. Spider, radii sum 19). Comparing the
   * gap between surfaces fixes that for every pairing.
   */
  _inAttackRange(agent, target) {
    const gap = this._dist(agent, target) - agent.stats.size - target.stats.size;
    return gap <= agent.stats.attackRange;
  }

  _nearestEnemy(agent, maxR = Infinity) {
    let best = null;
    let bestD = maxR;
    for (const o of this.agents) {
      if (!o.alive || o.team === agent.team) continue;
      const d = this._dist(agent, o);
      if (d <= bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  _nearestFood(agent) {
    let best = null;
    let bestD = Infinity;
    for (const f of this.food) {
      const d = this._dist(agent, f);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best;
  }

  _countAlive(team) {
    let n = 0;
    for (const a of this.agents) if (a.alive && a.team === team) n++;
    return n;
  }

  _randInt(min, max) {
    return min + Math.floor(this.rng() * (max - min + 1));
  }

  // ---------------------------------------------------------------------------
  // Win conditions
  // ---------------------------------------------------------------------------

  _checkWinCondition() {
    const a = this._countAlive(TEAMS.A);
    const b = this._countAlive(TEAMS.B);

    if (a === 0 && b === 0) return this._endBattle('draw', 'elimination');
    if (a === 0) return this._endBattle(TEAMS.B, 'elimination');
    if (b === 0) return this._endBattle(TEAMS.A, 'elimination');

    if (this.tick >= this.config.maxTicks) {
      // Timeout: most survivors wins, tie-broken by total surviving HP, then food.
      if (a !== b) return this._endBattle(a > b ? TEAMS.A : TEAMS.B, 'timeout');
      const hpA = this._teamHealth(TEAMS.A);
      const hpB = this._teamHealth(TEAMS.B);
      if (hpA !== hpB) return this._endBattle(hpA > hpB ? TEAMS.A : TEAMS.B, 'timeout');
      const foodA = this._teamFood(TEAMS.A);
      const foodB = this._teamFood(TEAMS.B);
      if (foodA !== foodB) return this._endBattle(foodA > foodB ? TEAMS.A : TEAMS.B, 'timeout');
      return this._endBattle('draw', 'timeout');
    }
    return undefined;
  }

  _teamHealth(team) {
    let hp = 0;
    for (const a of this.agents) if (a.alive && a.team === team) hp += a.health;
    return hp;
  }

  _teamFood(team) {
    let n = 0;
    for (const a of this.agents) if (a.team === team) n += a.memory.foodEaten ?? 0;
    return n;
  }

  _endBattle(winner, reason) {
    if (this.status === 'finished') return;
    this.status = 'finished';
    this.summary = this._buildSummary(winner, reason);
    this.pushEvent(EVENTS.BATTLE_OVER, { winner, reason });
  }

  _buildSummary(winner, reason) {
    const teams = {};
    for (const team of [TEAMS.A, TEAMS.B]) {
      const members = this.agents.filter((a) => a.team === team);
      const survivors = members.filter((a) => a.alive);
      const bySpecies = {};
      for (const a of members) {
        bySpecies[a.speciesId] = bySpecies[a.speciesId] ?? { spawned: 0, alive: 0 };
        bySpecies[a.speciesId].spawned += 1;
        if (a.alive) bySpecies[a.speciesId].alive += 1;
      }
      teams[team] = {
        spawned: members.length,
        survivors: survivors.length,
        survivorHealth: round(this._teamHealth(team)),
        kills: this.killLog.filter((k) => k.killerTeam === team).length,
        foodCollected: this._teamFood(team),
        species: bySpecies,
      };
    }

    return {
      winner, // 'A' | 'B' | 'draw'
      reason, // 'elimination' | 'timeout'
      seed: this.seed,
      mode: this.config.mode,
      durationTicks: this.tick,
      durationSeconds: round(this.tick / this.config.tickRate, 2),
      totalKills: this.killLog.length,
      teams,
      killLog: this.killLog,
    };
  }

  // ---------------------------------------------------------------------------
  // Snapshots & init payload (the entire renderer-facing contract)
  // ---------------------------------------------------------------------------

  pushEvent(type, data = {}) {
    // Spread `data` first so the canonical `type`/`tick` discriminators can
    // never be clobbered by a same-named field inside a payload.
    this._tickEvents.push({ ...data, type, tick: this.tick });
  }

  /**
   * One-time payload a renderer needs before it can draw: arena dimensions plus
   * the species *catalog* (id -> visual descriptor + meta). Per-tick snapshots
   * then only carry a `speciesId`, and the renderer resolves the visual here.
   */
  getInitPayload() {
    return {
      seed: this.seed,
      mode: this.config.mode,
      arena: { ...this.config.arena },
      tickRate: this.config.tickRate,
      maxTicks: this.config.maxTicks,
      catalog: registry.getCatalog(),
    };
  }

  _buildSnapshot() {
    const rate = this.config.tickRate;
    const agents = [];
    for (const a of this.agents) {
      if (!a.alive) continue;
      const entry = {
        id: a.id,
        team: a.team,
        speciesId: a.speciesId,
        x: round(a.x),
        y: round(a.y),
        angle: round(a.angle, 3),
        health: round(a.health),
        maxHealth: a.maxHealth,
        action: a.action,
        // Rich status objects so the renderer can show labels + a countdown and
        // knows which statuses immobilize (drives the "trapped" web overlay).
        statuses: a.statuses.map((s) => ({
          type: s.type,
          label: s.label,
          remaining: round(s.remaining / rate, 1),
          immobilize: s.preventAttack,
        })),
      };
      // Ability cooldown surfaced for the debug overlay ("ready in 2.3s").
      if (a.species.ability) {
        entry.ability = {
          name: a.species.ability.name,
          cooldown: round(a.abilityCooldown / rate, 1),
          ready: a.abilityCooldown <= 0,
        };
      }
      agents.push(entry);
    }

    const food = this.food.map((f) => ({ id: f.id, x: round(f.x), y: round(f.y), size: f.size }));

    const snap = {
      tick: this.tick,
      time: round(this.tick / this.config.tickRate, 2),
      status: this.status,
      arena: { width: this.config.arena.width, height: this.config.arena.height },
      score: { A: this._countAlive(TEAMS.A), B: this._countAlive(TEAMS.B) },
      agents,
      food,
      events: this._tickEvents,
    };
    if (this.status === 'finished') snap.summary = this.summary;
    return snap;
  }
}
