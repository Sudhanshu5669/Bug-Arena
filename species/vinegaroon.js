// Vinegaroon (whip scorpion) — it has no venom at all. What it has is a whip-like
// tail that swivels in any direction and sprays concentrated acetic acid, and it
// is uncannily accurate with it.
//
// So this is the game's only pure DEBUFF field: a 360° mist that doesn't do much
// damage but leaves everything around it half as dangerous. Its role is to walk
// into the middle of a squad and blunt the entire squad at once — the anti-swarm
// counterpart to the Bombardier's directional cone.

import { registerSpecies } from './registry.js';

const MIST = {
  TRIGGER_CHANCE: 0.42,
  COOLDOWN_SECONDS: 8,
  RADIUS: 138, // it sprays all the way round — no aiming required
  DAMAGE: 14, // raised from 8 — see the stat note below
  BLIND_SECONDS: 4.5,
  WEAKEN: 0.55, // caught enemies deal 45% less damage
  SLOW: 0.82,
  BURN_PER_SECOND: 3.5, // the acid keeps working
};

const vinegaroon = {
  id: 'vinegaroon',
  name: 'Vinegaroon',
  tier: 'champion',
  flavor:
    'No venom, no sting — just a swivelling tail and a jet of concentrated acid it can aim in any direction at once.',

  stats: {
    // Same problem the Velvet Worm had: a pure debuffer with a 6-damage bite won
    // 15% of its matchups, because halving an opponent's output does nothing if you
    // can't convert the window into a kill.
    maxHealth: 168,
    speed: 1.55,
    size: 13,
    damage: 8, // its own bite is still unremarkable
    attackRange: 25,
    attackCooldown: 42,
    visionRange: 235,
  },

  visual: {
    type: 'sprite',
    sprite: 'vinegaroon',
    spriteExt: 'svg',
    spriteScale: 2.85,
    spriteFacing: 'up',
    shape: 'polygon',
    color: '#3b2f2f',
    stroke: '#140f0f',
    size: 13,
  },

  ability: {
    name: 'Acetic Mist',
    description:
      'Sprays acid in every direction at once — everything caught is left burning and barely able to fight.',
    triggerChance: MIST.TRIGGER_CHANCE,
    cooldownSeconds: MIST.COOLDOWN_SECONDS,
    telegraphColor: '#d6ff5c',
    requiresTarget: false,
    log: (self, target, res) => {
      const n = res?.hit ?? 0;
      return n > 1
        ? `${self.species.name} blinded ${n} of them in acid mist!`
        : `${self.species.name} sprayed a jet of acid.`;
    },
    onTrigger(self, target, ctx) {
      const hit = ctx.enemiesInRadius(self, MIST.RADIUS);
      for (const enemy of hit) {
        ctx.dealDamage(enemy, MIST.DAMAGE, { sourceAgent: self, cause: 'acid' });
        ctx.applyStatus(
          enemy,
          {
            type: 'blinded',
            label: 'Blinded',
            duration: ctx.seconds(MIST.BLIND_SECONDS),
            damageDealtMultiplier: MIST.WEAKEN,
            speedMultiplier: MIST.SLOW,
            damagePerSecond: MIST.BURN_PER_SECOND,
          },
          self
        );
      }

      ctx.spawnEffect({ kind: 'poison_cloud', x: self.x, y: self.y, radius: MIST.RADIUS });
      return { hit: hit.length };
    },
  },

  // Sharp, sour, and hissing — it smells like vinegar and sounds like it too.
  sfx: {
    attack: [{ src: 'noise', filter: 'bandpass', f0: 1700, f1: 1000, q: 6, dur: 0.04, gain: 0.18 }],
    ability: [
      { src: 'noise', filter: 'highpass', f0: 2200, f1: 7000, dur: 0.5, gain: 0.32 }, // the spray
      { src: 'tone', wave: 'sawtooth', f0: 300, f1: 120, dur: 0.3, gain: 0.14, cutoff: 1100 },
    ],
    death: [{ src: 'tone', wave: 'sine', f0: 230, f1: 55, dur: 0.26, gain: 0.26 }],
  },

  hooks: {},
};

export default vinegaroon;
registerSpecies(vinegaroon);
