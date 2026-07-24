// Fire Ant — attrition champion. Its signature ability sets the target ablaze
// (a damage-over-time burn), and it detonates in an ember burst when it dies.

import { registerSpecies } from './registry.js';

// --- ability tuning (easy to find + tweak) -----------------------------------
const IGNITE = {
  TRIGGER_CHANCE: 0.3, // 30% chance per attack
  COOLDOWN_SECONDS: 5,
  BURN_SECONDS: 2.5, // DoT duration
  DAMAGE_PER_SECOND: 12, // ~30 total burn over the duration — a real threat, not dominant
};

const fireAnt = {
  id: 'fireAnt',
  name: 'Fire Ant',
  tier: 'soldier', // the rank-and-file squad unit
  flavor: 'A living ember. Its bite sets prey ablaze, and it bursts into flame when slain.',

  stats: {
    maxHealth: 72, // rank-and-file ant — the HP baseline every BUG towers over
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
          damagePerSecond: IGNITE.DAMAGE_PER_SECOND,
        },
        self
      );
      ctx.spawnEffect({ kind: 'flare', x: target.x, y: target.y, radius: target.stats.size + 6 });
    },
  },

  // Sound signature: dry crackle up top, with a soft roar under the ignite.
  sfx: {
    attack: [{ src: 'noise', filter: 'bandpass', f0: 2800, f1: 1400, q: 6, dur: 0.055, gain: 0.3 }],
    ability: [
      { src: 'noise', filter: 'bandpass', f0: 900, f1: 3400, q: 1.5, dur: 0.3, gain: 0.3 }, // the flare catching
      { src: 'noise', filter: 'highpass', f0: 4200, dur: 0.2, gain: 0.16, t0: 0.06 }, // crackle
      { src: 'tone', wave: 'sawtooth', f0: 180, f1: 68, dur: 0.3, gain: 0.12, cutoff: 800 },
    ],
    death: [
      { src: 'noise', filter: 'lowpass', f0: 1800, f1: 300, dur: 0.24, gain: 0.34 },
      { src: 'tone', wave: 'sine', f0: 220, f1: 58, dur: 0.26, gain: 0.18 },
    ],
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
