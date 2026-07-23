// Blade Mantis — glass-cannon duelist. Its signature ability is a dash-strike:
// it lunges at the target and lands a single brutal hit, then must recover.

import { registerSpecies } from './registry.js';

// --- ability tuning (easy to find + tweak) -----------------------------------
const DASH = {
  TRIGGER_CHANCE: 0.4, // 40% chance per attack (dashes fairly often)
  COOLDOWN_SECONDS: 3, // short — it's a bread-and-butter burst
  BONUS_DAMAGE: 14, // extra damage on top of the normal hit
  LUNGE_DISTANCE: 26, // px the mantis snaps forward for the strike
};

const mantis = {
  id: 'mantis',
  name: 'Blade Mantis',
  tier: 'champion', // squad-leading special unit
  flavor:
    'A glass-cannon duelist. Explosive dash, brutal strike — but it folds under sustained fire.',

  stats: {
    maxHealth: 40,
    speed: 3.1,
    size: 12,
    damage: 15,
    attackRange: 22,
    attackCooldown: 28, // ticks (~0.47s)
    visionRange: 270,
  },

  visual: {
    type: 'sprite',
    sprite: 'mantis',
    spriteScale: 2.7,
    spriteFacing: 'up',
    shape: 'triangle',
    color: '#38b000',
    stroke: '#12420a',
    size: 12,
  },

  // --- signature ability: Dash Strike (mobility + burst damage) ----------------
  ability: {
    name: 'Dash Strike',
    description: 'Lunges at the target and lands a single high-damage blow.',
    triggerChance: DASH.TRIGGER_CHANCE,
    cooldownSeconds: DASH.COOLDOWN_SECONDS,
    log: (self, target) =>
      `${self.species.name} dashed and struck for ${self.stats.damage + DASH.BONUS_DAMAGE}!`,
    onTrigger(self, target, ctx) {
      const fromX = self.x;
      const fromY = self.y;
      ctx.lunge(self, target, DASH.LUNGE_DISTANCE); // snap forward (mobility)
      ctx.dealDamage(target, DASH.BONUS_DAMAGE, { sourceAgent: self, cause: 'dash_strike' });
      // Motion streak from the wind-up position to the strike — reads as a dash,
      // not a speed glitch.
      ctx.spawnEffect({ kind: 'dash', x1: fromX, y1: fromY, x2: self.x, y2: self.y });
    },
  },

  hooks: {},
};

export default mantis;
registerSpecies(mantis);
