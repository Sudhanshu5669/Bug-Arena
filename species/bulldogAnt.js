// Bulldog Ant — the hunter. It has the sharpest eyes of any ant by a wide margin
// and it uses them: it picks out whichever enemy is most alone and leaps the gap
// to land on it. Nothing else in the soldier tier can choose its fight like this.
//
// The price is written into the same behaviour. It hunts on sight and it leaps
// AHEAD of the colony, so it habitually arrives in the enemy line by itself, and
// it isn't nearly tough enough to survive being surrounded.

import { registerSpecies } from './registry.js';

// --- ability tuning (easy to find + tweak) -----------------------------------
const LEAP = {
  TRIGGER_CHANCE: 0.45,
  COOLDOWN_SECONDS: 6.5,
  WINDUP_SECONDS: 0.22, // it crouches before springing
  WINDUP_RECOIL: 8,
  DISTANCE: 105, // how far it can close in one jump
  DAMAGE: 14, // the pounce itself
  STAGGER_SECONDS: 0.45, // the victim is knocked flat by the landing
};

const bulldogAnt = {
  id: 'bulldogAnt',
  name: 'Bulldog Ant',
  tier: 'soldier',
  flavor:
    'The only ant that hunts with its eyes. It picks the loneliest target on the field and jumps on it.',

  // The hunter's profile: it stalks on sight even in a forage-first battle, and it
  // deliberately singles out isolated prey — which is exactly what draws it away
  // from its own colony.
  ai: {
    hunts: true,
    targetPreference: 'isolated',
    herds: false,
    herdWhenExposed: true, // it will fall back to the colony if it's badly exposed
  },

  stats: {
    maxHealth: 70,
    speed: 2.05,
    size: 8,
    damage: 7, // a real bite, before the pounce
    attackRange: 18,
    attackCooldown: 36,
    visionRange: 300, // by far the best eyesight in the soldier tier
  },

  visual: {
    type: 'sprite',
    sprite: 'bulldogAnt',
    spriteExt: 'svg',
    spriteScale: 2.8,
    spriteFacing: 'up',
    shape: 'triangle',
    color: '#d1502a', // hunting orange-red
    stroke: '#3d1005',
    size: 8,
  },

  // --- signature ability: Killer Leap (gap close + burst) ---------------------
  ability: {
    name: 'Killer Leap',
    description: 'Springs the gap onto its target, landing hard enough to knock it flat.',
    triggerChance: LEAP.TRIGGER_CHANCE,
    cooldownSeconds: LEAP.COOLDOWN_SECONDS,
    windupSeconds: LEAP.WINDUP_SECONDS,
    windupRecoil: LEAP.WINDUP_RECOIL,
    telegraphColor: '#ffab6a',
    log: (self, target) => `${self.species.name} sprang onto ${target.species.name}!`,
    onTrigger(self, target, ctx) {
      const fromX = self.x;
      const fromY = self.y;
      // Close the distance — `lunge` stops short of overlapping the target.
      ctx.lunge(self, target, LEAP.DISTANCE);
      ctx.spawnEffect({ kind: 'leap', x1: fromX, y1: fromY, x2: self.x, y2: self.y });

      ctx.dealDamage(target, LEAP.DAMAGE, { sourceAgent: self, cause: 'leap' });
      if (target.alive) {
        ctx.applyStatus(
          target,
          {
            type: 'stagger',
            label: 'Pinned',
            duration: ctx.seconds(LEAP.STAGGER_SECONDS),
            speedMultiplier: 0,
            preventMove: true,
            preventAttack: true,
          },
          self
        );
      }
    },
  },

  sfx: {
    attack: [{ src: 'noise', filter: 'bandpass', f0: 2800, f1: 1500, q: 7, dur: 0.045, gain: 0.26 }],
    ability: [
      { src: 'noise', filter: 'bandpass', f0: 700, f1: 4200, q: 1.4, dur: 0.16, gain: 0.28 }, // the spring
      { src: 'noise', filter: 'lowpass', f0: 2200, f1: 300, dur: 0.14, gain: 0.34, t0: 0.14 }, // the landing
      { src: 'tone', wave: 'sine', f0: 300, f1: 80, dur: 0.18, gain: 0.18, t0: 0.14 },
    ],
    death: [{ src: 'noise', filter: 'bandpass', f0: 1900, f1: 600, q: 5, dur: 0.18, gain: 0.28 }],
  },

  hooks: {},
};

export default bulldogAnt;
registerSpecies(bulldogAnt);
