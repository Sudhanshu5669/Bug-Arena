// Bullet Ant — the colony's heavy infantry. Slower and tankier than a fire ant,
// it hits hard and its neurotoxic sting leaves victims sluggish and easy to finish.

import { registerSpecies } from './registry.js';

// --- ability tuning (easy to find + tweak) -----------------------------------
const STING = {
  TRIGGER_CHANCE: 0.3, // 30% chance per attack
  COOLDOWN_SECONDS: 5,
  SLOW_SECONDS: 2.5, // how long the victim is crippled
  SLOW_MULTIPLIER: 0.45, // move/attack-approach speed while envenomed
};

const bulletAnt = {
  id: 'bulletAnt',
  name: 'Bullet Ant',
  tier: 'soldier',
  flavor: 'Heavy infantry with the most painful sting in the colony — its venom leaves prey crawling.',

  stats: {
    maxHealth: 110, // a bruiser ant: much tankier than a fire ant, still short of any bug
    speed: 1.5, // heavy and deliberate
    size: 9,
    damage: 9, // hits noticeably harder than a fire ant
    attackRange: 17,
    attackCooldown: 50, // ticks (~0.83s) — slow, weighty swings
    visionRange: 200,
  },

  // Rendered straight from its source SVG (see assets/sprites/src/bulletAnt.svg);
  // the shape fields are the fallback if the art ever fails to load.
  visual: {
    type: 'sprite',
    sprite: 'bulletAnt',
    spriteExt: 'svg',
    spriteScale: 2.7,
    spriteFacing: 'up',
    shape: 'polygon',
    color: '#1a1a1e', // near-black (also the roster dot + shape fallback)
    stroke: '#050405',
    size: 9,
  },

  // --- signature ability: Neurotoxic Sting (control / slow) --------------------
  ability: {
    name: 'Neurotoxic Sting',
    description: 'Envenoms the target, sharply slowing it for a few seconds.',
    triggerChance: STING.TRIGGER_CHANCE,
    cooldownSeconds: STING.COOLDOWN_SECONDS,
    log: (self, target) => `${self.species.name} envenomed ${target.species.name}!`,
    onTrigger(self, target, ctx) {
      ctx.applyStatus(
        target,
        {
          type: 'slow',
          label: 'Envenomed',
          duration: ctx.seconds(STING.SLOW_SECONDS),
          speedMultiplier: STING.SLOW_MULTIPLIER,
        },
        self
      );
      ctx.spawnEffect({ kind: 'venom', x: target.x, y: target.y, radius: target.stats.size + 4 });
    },
  },

  // Sound signature: weight. Every hit lands like a dropped stone.
  sfx: {
    attack: [
      { src: 'tone', wave: 'sine', f0: 120, f1: 48, dur: 0.12, gain: 0.3 },
      { src: 'noise', filter: 'lowpass', f0: 1200, f1: 400, dur: 0.06, gain: 0.24 },
    ],
    ability: [
      { src: 'tone', wave: 'sawtooth', f0: 520, f1: 130, dur: 0.32, gain: 0.18, cutoff: 1400 },
      { src: 'noise', filter: 'bandpass', f0: 2200, f1: 700, q: 8, dur: 0.22, gain: 0.2 },
    ],
    death: [
      { src: 'noise', filter: 'lowpass', f0: 900, f1: 180, dur: 0.3, gain: 0.34 },
      { src: 'tone', wave: 'sine', f0: 90, f1: 40, dur: 0.3, gain: 0.2 },
    ],
  },

  hooks: {},
};

export default bulletAnt;
registerSpecies(bulletAnt);
