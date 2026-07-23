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

  hooks: {},
};

export default bulletAnt;
registerSpecies(bulletAnt);
