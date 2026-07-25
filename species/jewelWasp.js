// Emerald Cockroach Wasp — the one that does something genuinely worse than
// killing. It makes two stings: the first paralyses the front legs, the second is
// delivered directly into the brain and removes the roach's WILL to escape. The
// roach stays alive, healthy and mobile — it simply stops caring what happens to
// it, and can be led away by the antenna like a dog on a leash.
//
// That's this ability exactly. The victim keeps its health, its speed and its
// legs, and loses only the ability to fight. It is the longest disable in the
// game precisely because it takes nothing else away.

import { registerSpecies } from './registry.js';

const ZOMBIFY = {
  TRIGGER_CHANCE: 0.3,
  COOLDOWN_SECONDS: 13, // the longest cooldown of any champion
  WINDUP_SECONDS: 0.5, // the second sting is slow and precise — it has to be
  DURATION_SECONDS: 6, // ...and the result lasts a very long time
  DAMAGE: 8, // almost none: it isn't trying to hurt anything
  WANDER_SPEED: 0.75, // it drifts, docile
};

const jewelWasp = {
  id: 'jewelWasp',
  name: 'Jewel Wasp',
  tier: 'champion',
  flavor:
    "Stings once to stop the legs and once into the brain to remove the will to run. The victim stays healthy — it just stops minding.",

  stats: {
    maxHealth: 126, // it cannot survive a real fight; it must never be in one
    speed: 2.9,
    size: 10,
    damage: 7,
    attackRange: 21,
    attackCooldown: 32,
    visionRange: 285,
  },

  visual: {
    type: 'sprite',
    sprite: 'jewelWasp',
    spriteExt: 'svg',
    spriteScale: 2.65,
    spriteFacing: 'up',
    shape: 'polygon',
    color: '#0f9b8e', // the real thing is a metallic blue-green
    stroke: '#062e2a',
    size: 10,
  },

  ability: {
    name: 'Zombify',
    description:
      'A sting placed precisely into the brain. The victim keeps its health and its legs, and simply stops fighting.',
    triggerChance: ZOMBIFY.TRIGGER_CHANCE,
    cooldownSeconds: ZOMBIFY.COOLDOWN_SECONDS,
    windupSeconds: ZOMBIFY.WINDUP_SECONDS,
    telegraphColor: '#3df2df',
    requiresTarget: true,
    log: (self, target) => `${self.species.name} zombified ${target.species.name} — it just stopped caring.`,
    onTrigger(self, target, ctx) {
      if (!target || !target.alive) return {};

      ctx.dealDamage(target, ZOMBIFY.DAMAGE, { sourceAgent: self, cause: 'sting' });
      if (!target.alive) return { killed: true };

      // Note what is NOT here: no preventMove, no damageTakenMultiplier, no DoT.
      // It walks around perfectly fine. It just never swings at anything again for
      // six seconds, which against a champion is most of a fight.
      ctx.applyStatus(
        target,
        {
          type: 'zombified',
          label: 'Zombified',
          duration: ctx.seconds(ZOMBIFY.DURATION_SECONDS),
          preventAttack: true,
          speedMultiplier: ZOMBIFY.WANDER_SPEED,
        },
        self
      );

      ctx.spawnEffect({ kind: 'venom', x: target.x, y: target.y, team: self.team });
      return { zombified: true };
    },
  },

  // Clean, surgical, and unnervingly quiet for a wasp.
  sfx: {
    attack: [{ src: 'noise', filter: 'bandpass', f0: 2600, f1: 1800, q: 9, dur: 0.028, gain: 0.16 }],
    ability: [
      { src: 'tone', wave: 'sine', f0: 2200, f1: 2600, dur: 0.22, gain: 0.16 }, // the approach
      { src: 'tone', wave: 'sine', f0: 1800, f1: 300, dur: 0.36, gain: 0.28, t0: 0.2 }, // the sting going in
      { src: 'tone', wave: 'triangle', f0: 120, f1: 60, dur: 0.4, gain: 0.14, t0: 0.26 }, // the lights going out
    ],
    death: [{ src: 'tone', wave: 'triangle', f0: 700, f1: 90, dur: 0.24, gain: 0.24 }],
  },

  hooks: {},
};

export default jewelWasp;
registerSpecies(jewelWasp);
