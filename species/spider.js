// Web Spider — control champion. A close-range ambusher whose signature ability
// snares its prey in a web, locking it down so the spider can bite freely.

import { registerSpecies } from './registry.js';

// --- ability tuning (easy to find + tweak) -----------------------------------
const WEB = {
  TRIGGER_CHANCE: 0.35, // 35% chance per attack (while off cooldown)
  COOLDOWN_SECONDS: 6, // > immobilize duration, so it can't be chain-locked forever
  IMMOBILIZE_SECONDS: 3.5, // how long the target is fully locked down
};

const spider = {
  id: 'spider',
  name: 'Web Spider',
  tier: 'champion', // squad-leading special unit
  flavor:
    'A patient ambusher. Snares its prey in a web, then bites at leisure while it struggles.',

  stats: {
    maxHealth: 64,
    speed: 1.25,
    size: 11,
    damage: 4,
    attackRange: 30, // close-range bite (no more long-range "laser")
    attackCooldown: 45, // ticks (~0.75s)
    visionRange: 250,
  },

  visual: {
    type: 'sprite',
    sprite: 'spider',
    spriteScale: 2.9,
    spriteFacing: 'up',
    shape: 'diamond',
    color: '#9b5de5',
    stroke: '#3a1a5e',
    size: 11,
  },

  // --- signature ability: Web Trap (control / status effect) ------------------
  ability: {
    name: 'Web Trap',
    description: 'Immobilizes the target in a web — it cannot move or attack.',
    triggerChance: WEB.TRIGGER_CHANCE,
    cooldownSeconds: WEB.COOLDOWN_SECONDS,
    log: (self, target) => `${self.species.name} webbed ${target.species.name}!`,
    onTrigger(self, target, ctx) {
      // Full immobilize: no move, no attack. The target can still take damage —
      // that helpless window is exactly what the spider exploits.
      ctx.applyStatus(
        target,
        {
          type: 'web',
          label: 'Webbed',
          duration: ctx.seconds(WEB.IMMOBILIZE_SECONDS),
          speedMultiplier: 0,
          preventMove: true,
          preventAttack: true,
        },
        self
      );
      // A few strands that shoot to the target and fade fast — NOT a beam. The
      // persistent web overlay while trapped is driven by the 'web' status.
      ctx.spawnEffect({
        kind: 'web_cast',
        x1: self.x,
        y1: self.y,
        x2: target.x,
        y2: target.y,
        targetId: target.id,
      });
    },
  },

  hooks: {},
};

export default spider;
registerSpecies(spider);
