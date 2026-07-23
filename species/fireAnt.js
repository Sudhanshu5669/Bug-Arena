// Fire Ant — attrition champion. Its signature ability sets the target ablaze
// (a damage-over-time burn), and it detonates in an ember burst when it dies.

import { registerSpecies } from './registry.js';

// --- ability tuning (easy to find + tweak) -----------------------------------
const IGNITE = {
  TRIGGER_CHANCE: 0.35, // 35% chance per attack
  COOLDOWN_SECONDS: 5,
  BURN_SECONDS: 3, // DoT duration
  DAMAGE_PER_TICK: 2.0, // burn damage each tick while it lasts
};

const fireAnt = {
  id: 'fireAnt',
  name: 'Fire Ant',
  tier: 'soldier', // the rank-and-file squad unit
  flavor: 'A living ember. Its bite sets prey ablaze, and it bursts into flame when slain.',

  stats: {
    maxHealth: 46,
    speed: 1.7,
    size: 8,
    damage: 5,
    attackRange: 16,
    attackCooldown: 40, // ticks (~0.66s)
    visionRange: 210,
  },

  visual: {
    type: 'sprite',
    sprite: 'fireAnt',
    spriteScale: 2.6,
    spriteFacing: 'up',
    shape: 'circle',
    color: '#ff5a2c',
    stroke: '#7a1f00',
    size: 8,
  },

  // --- signature ability: Ignite (damage-over-time) ---------------------------
  ability: {
    name: 'Ignite',
    description: 'Sets the target on fire for damage over time.',
    triggerChance: IGNITE.TRIGGER_CHANCE,
    cooldownSeconds: IGNITE.COOLDOWN_SECONDS,
    log: (self, target) => `${self.species.name} set ${target.species.name} ablaze!`,
    onTrigger(self, target, ctx) {
      ctx.applyStatus(
        target,
        {
          type: 'burn',
          label: 'Burning',
          duration: ctx.seconds(IGNITE.BURN_SECONDS),
          damagePerTick: IGNITE.DAMAGE_PER_TICK,
        },
        self
      );
      ctx.spawnEffect({ kind: 'flare', x: target.x, y: target.y, radius: target.stats.size + 6 });
    },
  },

  hooks: {
    // Death throes: a small AoE ember burst against nearby enemies (a death
    // trigger, distinct from the gated signature ability above).
    on_death(self, ctx) {
      const radius = 34;
      for (const enemy of ctx.enemiesInRadius(self, radius)) {
        ctx.dealDamage(enemy, 6, { sourceAgent: self, cause: 'ember_burst' });
      }
      ctx.spawnEffect({ kind: 'explosion', x: self.x, y: self.y, radius, color: '#ff7a2c' });
    },
  },
};

export default fireAnt;
registerSpecies(fireAnt);
