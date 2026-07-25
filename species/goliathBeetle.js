// Goliath Beetle — among the heaviest insects alive. This one doesn't stab or
// spray; it simply drops its whole mass onto the ground and lets the shock do the
// work.
//
// It's the roster's heaviest AREA CONTROL: everything around it is thrown
// outward AND stunned, which is the single most reliable way to break a formation
// that has piled onto an ally. Slow, blind, and enormous — it has to be escorted
// into position, and it is very easy to simply walk away from.

import { registerSpecies } from './registry.js';

const SLAM = {
  TRIGGER_CHANCE: 0.4,
  COOLDOWN_SECONDS: 10,
  WINDUP_SECONDS: 0.5, // it rears up first — a big, readable tell
  RADIUS: 150,
  DAMAGE: 24,
  KNOCKBACK: 96,
  STUN_SECONDS: 1.3,
  FALLOFF: 0.45, // damage at the very edge, as a fraction of full
};

const goliathBeetle = {
  id: 'goliathBeetle',
  name: 'Goliath Beetle',
  tier: 'champion',
  flavor:
    'One of the heaviest insects that has ever lived, and its entire strategy is to put that weight into the ground.',

  stats: {
    maxHealth: 252, // second only to the rhinoceros beetle
    speed: 0.95, // the slowest unit in the game
    size: 15,
    damage: 13,
    attackRange: 27,
    attackCooldown: 64, // enormous, deliberate swings
    visionRange: 195, // it barely notices anything until it's underfoot
  },

  visual: {
    type: 'sprite',
    sprite: 'goliathBeetle',
    spriteExt: 'svg',
    spriteScale: 3.1,
    spriteFacing: 'up',
    shape: 'polygon',
    color: '#e8e2d0', // the real thing is strikingly white-and-black
    stroke: '#1a1712',
    size: 15,
  },

  ability: {
    name: 'Ground Slam',
    description:
      'Rears up and drops its full weight — everything nearby is hurled outward and left reeling.',
    triggerChance: SLAM.TRIGGER_CHANCE,
    cooldownSeconds: SLAM.COOLDOWN_SECONDS,
    windupSeconds: SLAM.WINDUP_SECONDS,
    telegraphColor: '#ffe9a8',
    requiresTarget: false,
    log: (self, target, res) => {
      const n = res?.hit ?? 0;
      return n > 2
        ? `${self.species.name} slammed down — ${n} sent flying!`
        : `${self.species.name} slammed the ground!`;
    },
    onTrigger(self, target, ctx) {
      const hit = ctx.enemiesInRadius(self, SLAM.RADIUS);
      for (const enemy of hit) {
        const dx = enemy.x - self.x;
        const dy = enemy.y - self.y;
        const d = Math.hypot(dx, dy) || 1;

        // Distance falloff — standing on top of it should be markedly worse than
        // catching the edge of the shock.
        const t = Math.min(1, d / SLAM.RADIUS);
        const scale = 1 - (1 - SLAM.FALLOFF) * t;

        ctx.dealDamage(enemy, SLAM.DAMAGE * scale, { sourceAgent: self, cause: 'crushed' });
        ctx.push(enemy, dx / d, dy / d, SLAM.KNOCKBACK * scale);
        ctx.applyStatus(
          enemy,
          {
            type: 'reeling',
            label: 'Reeling',
            duration: ctx.seconds(SLAM.STUN_SECONDS),
            preventMove: true,
            preventAttack: true,
            speedMultiplier: 0,
          },
          self
        );
      }

      ctx.spawnEffect({ kind: 'impact', x: self.x, y: self.y, radius: SLAM.RADIUS });
      return { hit: hit.length };
    },
  },

  // Enormous and low — you feel this one before you hear it.
  sfx: {
    attack: [{ src: 'noise', filter: 'lowpass', f0: 700, f1: 260, dur: 0.06, gain: 0.24 }],
    ability: [
      { src: 'tone', wave: 'sine', f0: 90, f1: 28, dur: 0.5, gain: 0.42 }, // the impact
      { src: 'noise', filter: 'lowpass', f0: 1400, f1: 180, dur: 0.44, gain: 0.34, attack: 0.002 },
      { src: 'tone', wave: 'square', f0: 55, f1: 30, dur: 0.3, gain: 0.16, cutoff: 300, t0: 0.03 },
    ],
    death: [
      { src: 'tone', wave: 'sine', f0: 170, f1: 34, dur: 0.42, gain: 0.32 },
      { src: 'noise', filter: 'lowpass', f0: 800, f1: 150, dur: 0.36, gain: 0.22, t0: 0.07 },
    ],
  },

  hooks: {},
};

export default goliathBeetle;
registerSpecies(goliathBeetle);
