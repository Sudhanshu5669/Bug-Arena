// Centipede — the constrictor. Its long body lets every bite catch a second
// victim standing beside the first, and its coil pins a target in place and
// crushes the life out of it. The coil is a mutual commitment though: while it
// is wrapped around something it cannot move a step, and its soft underside is
// exposed to everything else on the field.

import { registerSpecies } from './registry.js';

// --- passive tuning: Many Legs -------------------------------------------------
const SWEEP = {
  SPLASH_RADIUS: 42, // how far from the bitten target the body reaches
  // The neighbour's share of the bite. This is free damage on EVERY attack with
  // no cost attached, so it compounds harder than it looks on paper.
  SPLASH_FRACTION: 0.3,
};

// --- ability tuning: Coil Crush ------------------------------------------------
const COIL = {
  TRIGGER_CHANCE: 0.4,
  COOLDOWN_SECONDS: 8,
  WINDUP_SECONDS: 0.25, // it rears before it wraps
  CRUSH_SECONDS: 2.2,
  CRUSH_PER_SECOND: 13, // ~29 total if it holds the full duration
  CRUSH_TAKEN: 1.3, // and the squeezed victim takes more from everyone else too
  // The commitment. Note the root alone is a WEAK cost: the centipede is usually
  // already standing on the thing it just pinned, so being unable to walk away
  // costs it nothing. The real price has to be the exposure.
  SELF_SECONDS: 2.2, // rooted for most of the crush...
  SELF_TAKEN: 1.55, // ...and badly exposed to everything else on the field
};

const centipede = {
  id: 'centipede',
  name: 'Centipede',
  tier: 'champion',
  flavor:
    'A long, fast predator that bites two at a time — and pins one down to crush it, rooting itself to do it.',

  stats: {
    maxHealth: 172,
    speed: 1.9,
    size: 13,
    damage: 8,
    attackRange: 28, // a long body means long reach
    attackCooldown: 30,
    visionRange: 240,
  },

  visual: {
    type: 'sprite',
    sprite: 'centipede',
    spriteExt: 'svg',
    spriteScale: 3.0,
    spriteFacing: 'up',
    shape: 'polygon',
    color: '#b8452f', // rust-red segments
    stroke: '#2e0f08',
    size: 13,
  },

  // --- signature ability: Coil Crush (hard lockdown, at the cost of its own) ---
  ability: {
    name: 'Coil Crush',
    description:
      'Wraps the target and crushes it — pinning it helpless, while the centipede itself is rooted and exposed.',
    triggerChance: COIL.TRIGGER_CHANCE,
    cooldownSeconds: COIL.COOLDOWN_SECONDS,
    windupSeconds: COIL.WINDUP_SECONDS,
    telegraphColor: '#ff8a6a',
    log: (self, target) => `${self.species.name} coiled around ${target.species.name} and squeezed!`,
    onTrigger(self, target, ctx) {
      ctx.applyStatus(
        target,
        {
          type: 'crushed',
          label: 'Crushed',
          duration: ctx.seconds(COIL.CRUSH_SECONDS),
          damagePerSecond: COIL.CRUSH_PER_SECOND,
          damageTakenMultiplier: COIL.CRUSH_TAKEN,
          speedMultiplier: 0,
          preventMove: true,
          preventAttack: true,
        },
        self
      );

      // The other half of the bargain: it is wrapped up too. It can still bite
      // what it's holding, but it cannot disengage, and everything else on the
      // field gets a free run at its underside.
      ctx.applyStatus(
        self,
        {
          type: 'coiled',
          label: 'Coiled',
          duration: ctx.seconds(COIL.SELF_SECONDS),
          damageTakenMultiplier: COIL.SELF_TAKEN,
          preventMove: true, // rooted — but NOT preventAttack: it keeps crushing
        },
        self
      );

      ctx.spawnEffect({ kind: 'coil', x: target.x, y: target.y, radius: target.stats.size + 14 });
    },
  },

  // Dry skittering chitin, and a low grinding creak when it squeezes.
  sfx: {
    attack: [
      { src: 'noise', filter: 'bandpass', f0: 4200, f1: 2400, q: 10, dur: 0.03, gain: 0.2, repeat: { times: 2, every: 0.038 } },
    ],
    ability: [
      { src: 'noise', filter: 'lowpass', f0: 800, f1: 180, dur: 0.5, gain: 0.3 }, // the constriction
      { src: 'tone', wave: 'sawtooth', f0: 140, f1: 58, dur: 0.46, gain: 0.18, cutoff: 620 },
      { src: 'tone', wave: 'square', f0: 90, f1: 132, dur: 0.4, gain: 0.07, t0: 0.08, cutoff: 500 }, // the creak
    ],
    death: [{ src: 'noise', filter: 'bandpass', f0: 2200, f1: 900, q: 7, dur: 0.35, gain: 0.26 }],
  },

  hooks: {
    /**
     * Many Legs. Its body is long enough that a bite on one bug rakes whoever is
     * standing next to it — one extra victim per bite, at a fraction of the damage.
     */
    on_attack(self, target, ctx) {
      let neighbour = null;
      let bestD = Infinity;
      for (const enemy of ctx.enemiesInRadius(self, self.stats.attackRange + self.stats.size + SWEEP.SPLASH_RADIUS)) {
        if (enemy === target) continue;
        const d = ctx.distance(enemy, target);
        if (d <= SWEEP.SPLASH_RADIUS && d < bestD) {
          bestD = d;
          neighbour = enemy;
        }
      }
      if (!neighbour) return;
      ctx.dealDamage(neighbour, self.stats.damage * SWEEP.SPLASH_FRACTION, {
        sourceAgent: self,
        cause: 'sweep',
      });
      ctx.spawnEffect({ kind: 'slash', x: neighbour.x, y: neighbour.y });
    },
  },
};

export default centipede;
registerSpecies(centipede);
