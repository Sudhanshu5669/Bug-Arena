// An Agent is one bug in the arena. It owns the *simulation* state; its physical
// position/velocity live on a matter.js body (`this.body`) so the engine never
// hand-rolls collision. Species-specific behaviour is NOT here — the engine
// calls hooks on `this.species` generically (see engine.js).

export class Agent {
  /**
   * @param {object} p
   * @param {string} p.id            - stable id assigned by the engine (per-battle sequence)
   * @param {string} p.team          - 'A' | 'B'
   * @param {object} p.species       - a registered species config (from the registry)
   * @param {Matter.Body} p.body     - the physics body backing this agent
   */
  constructor({ id, team, species, body }) {
    this.id = id;
    this.team = team;
    this.species = species; // full config incl. hooks + visual + stats
    this.speciesId = species.id;
    this.body = body;

    // Stats are copied so per-agent buffs/debuffs never mutate the shared species config.
    this.stats = { ...species.stats };
    this.maxHealth = this.stats.maxHealth;
    this.health = this.stats.maxHealth;

    this.alive = true;
    this.action = 'idle';
    this.targetId = null;

    this.attackCooldown = 0; // ticks remaining until this agent can attack again
    this.abilityCooldown = 0; // ticks remaining until the signature ability can fire again
    this.statuses = []; // active status effects (burn/web/...) — see engine._updateStatuses
    this.speedMultiplier = 1; // derived from statuses each tick

    this.killerId = null; // set on death, for the kill log
    this.memory = {}; // free scratch space species hooks may use (per-agent)
  }

  get x() {
    return this.body.position.x;
  }

  get y() {
    return this.body.position.y;
  }

  get angle() {
    return this.body.angle;
  }
}
