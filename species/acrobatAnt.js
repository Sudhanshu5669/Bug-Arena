// Acrobat Ant — named for the way it folds its heart-shaped gaster up over its
// own back when threatened. That flick is the ability: a 360° repellent burst
// that shoves everything off it and leaves the victims fumbling.
//
// Its job is to break up a pile. Where the Weaver Ant gathers enemies in, this
// one throws them out — it's the answer to being swarmed, and the reason a squad
// with one in it is much harder to collapse on.

import { registerSpecies } from './registry.js';

const FLICK = {
  TRIGGER_CHANCE: 0.38,
  COOLDOWN_SECONDS: 6,
  RADIUS: 96,
  SHOVE: 74, // px of knockback, straight out from the ant
  DAMAGE: 6,
  FUMBLE_SECONDS: 0.9, // they can still walk — they just can't swing
};

const acrobatAnt = {
  id: 'acrobatAnt',
  name: 'Acrobat Ant',
  tier: 'soldier',
  flavor:
    'Folds its gaster over its back and flicks a repellent burst in every direction, scattering whatever had closed in.',

  stats: {
    maxHealth: 62,
    speed: 2.05,
    size: 7,
    damage: 5,
    attackRange: 15,
    attackCooldown: 34,
    visionRange: 215,
  },

  visual: {
    type: 'sprite',
    sprite: 'acrobatAnt',
    spriteExt: 'svg',
    spriteScale: 2.15,
    spriteFacing: 'up',
    shape: 'ellipse',
    color: '#e8734a',
    stroke: '#3a1206',
    size: 7,
  },

  ability: {
    name: 'Gaster Flick',
    description:
      'A repellent burst in every direction — everything nearby is thrown clear and left fumbling.',
    triggerChance: FLICK.TRIGGER_CHANCE,
    cooldownSeconds: FLICK.COOLDOWN_SECONDS,
    telegraphColor: '#ffb37a',
    requiresTarget: false,
    log: (self, target, res) => {
      const n = res?.hit ?? 0;
      return n > 1
        ? `${self.species.name} flicked ${n} attackers off itself!`
        : `${self.species.name} flicked its gaster!`;
    },
    onTrigger(self, target, ctx) {
      const hit = ctx.enemiesInRadius(self, FLICK.RADIUS);
      for (const enemy of hit) {
        const dx = enemy.x - self.x;
        const dy = enemy.y - self.y;
        const d = Math.hypot(dx, dy) || 1;
        ctx.push(enemy, dx / d, dy / d, FLICK.SHOVE); // outward, away from the ant
        ctx.dealDamage(enemy, FLICK.DAMAGE, { sourceAgent: self, cause: 'flick' });
        ctx.applyStatus(
          enemy,
          {
            type: 'fumbling',
            label: 'Fumbling',
            duration: ctx.seconds(FLICK.FUMBLE_SECONDS),
            preventAttack: true, // mobility intact, offence interrupted
          },
          self
        );
      }

      ctx.spawnEffect({ kind: 'impact', x: self.x, y: self.y, radius: FLICK.RADIUS });
      return { hit: hit.length };
    },
  },

  // A sharp chemical puff — bright, dry, and over instantly.
  sfx: {
    attack: [{ src: 'noise', filter: 'bandpass', f0: 2600, f1: 1700, q: 8, dur: 0.03, gain: 0.15 }],
    ability: [
      { src: 'noise', filter: 'highpass', f0: 1400, f1: 5200, dur: 0.09, gain: 0.32, attack: 0.002 },
      { src: 'tone', wave: 'triangle', f0: 700, f1: 240, dur: 0.16, gain: 0.18 },
    ],
    death: [{ src: 'tone', wave: 'sine', f0: 290, f1: 75, dur: 0.15, gain: 0.2 }],
  },

  hooks: {},
};

export default acrobatAnt;
registerSpecies(acrobatAnt);
