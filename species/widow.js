// Black Widow — the answer to sustain. Her venom is necrotic: on top of the
// damage-over-time, the wound simply will not close, so while it lasts NOTHING
// can heal the victim — not a honeypot's nectar, not a worker's haul, not food.
// Against a colony built to out-heal its damage she is the whole counter.
//
// She pays for it with the worst body in the champion tier: slow, brittle, and
// weak in a straight exchange. She has to land the bite and then stay away.

import { registerSpecies } from './registry.js';

// --- ability tuning (easy to find + tweak) -----------------------------------
const NECROSIS = {
  TRIGGER_CHANCE: 0.45,
  COOLDOWN_SECONDS: 6,
  SECONDS: 5, // a long window — that's the point
  DAMAGE_PER_SECOND: 11, // ~55 total; the denied healing is the situational upside
  TAKEN: 1.2, // the rotting wound makes everything else hurt more too
};

const widow = {
  id: 'widow',
  name: 'Black Widow',
  tier: 'champion',
  flavor:
    "Her bite doesn't close. Nothing heals what she's touched — no nectar, no food, no rest.",

  stats: {
    maxHealth: 124, // brittle
    speed: 1.3, // and slow: she cannot chase, she has to be met
    size: 10,
    damage: 11,
    attackRange: 24,
    attackCooldown: 36,
    visionRange: 255,
  },

  visual: {
    type: 'sprite',
    sprite: 'widow',
    spriteExt: 'svg',
    spriteScale: 2.8,
    spriteFacing: 'up',
    shape: 'diamond',
    color: '#1c1420', // glossy black with the red mark
    stroke: '#000000',
    size: 10,
  },

  // --- signature ability: Necrotic Bite (damage-over-time + HEAL DENIAL) ------
  ability: {
    name: 'Necrotic Bite',
    description: 'A wound that will not close — it rots, and nothing can heal it while it lasts.',
    triggerChance: NECROSIS.TRIGGER_CHANCE,
    cooldownSeconds: NECROSIS.COOLDOWN_SECONDS,
    telegraphColor: '#c0392b',
    log: (self, target) => `${self.species.name} opened a wound on ${target.species.name} that won't close!`,
    onTrigger(self, target, ctx) {
      ctx.applyStatus(
        target,
        {
          type: 'necrosis',
          label: 'Necrotic',
          duration: ctx.seconds(NECROSIS.SECONDS),
          damagePerSecond: NECROSIS.DAMAGE_PER_SECOND,
          damageTakenMultiplier: NECROSIS.TAKEN,
          preventHeal: true, // the trait that makes her worth fielding
        },
        self
      );
      ctx.spawnEffect({ kind: 'necrosis', x: target.x, y: target.y, radius: target.stats.size + 10 });
    },
  },

  sfx: {
    attack: [{ src: 'noise', filter: 'bandpass', f0: 3800, f1: 2400, q: 10, dur: 0.035, gain: 0.22 }],
    ability: [
      { src: 'tone', wave: 'sawtooth', f0: 300, f1: 70, dur: 0.4, gain: 0.18, cutoff: 900 }, // the bite going in
      { src: 'noise', filter: 'bandpass', f0: 700, f1: 260, q: 6, dur: 0.5, gain: 0.22, t0: 0.06 }, // the rot
      { src: 'tone', wave: 'sine', f0: 96, dur: 0.55, gain: 0.12, t0: 0.1 },
    ],
    death: [{ src: 'noise', filter: 'lowpass', f0: 1200, f1: 220, dur: 0.28, gain: 0.3 }],
  },

  hooks: {},
};

export default widow;
registerSpecies(widow);
