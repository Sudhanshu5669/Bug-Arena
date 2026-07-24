// Harvester Ant — the one unit that GROWS. It starts as one of the weakest things
// on the sand, but every seed it hauls in permanently swells it: more damage, more
// reach, more bulk. Left alone next to a food pile it becomes the biggest ant in
// the arena. Rushed early, it dies as the nobody it started as.
//
// It is also the only species whose strength depends on the battle's *pace* — in a
// long forage-first fight it snowballs; in a fast brawl it never gets going.

import { registerSpecies } from './registry.js';

// --- passive tuning: Gorge ----------------------------------------------------
// Tuned against the arena's actual food economy, which is deliberately sparse: a
// forager only manages ~1-3 meals in a typical battle. Small per-meal bonuses are
// therefore invisible — each stack has to be a real, felt jump for the growth to
// mean anything before the fight is over.
const GORGE = {
  MAX_STACKS: 6, // hard ceiling so a runaway forager stays beatable
  DAMAGE_PER_STACK: 0.3, // +30% damage per seed hauled in
  HEALTH_PER_STACK: 16, // and a real slab of bulk each time
};

const harvesterAnt = {
  id: 'harvesterAnt',
  name: 'Harvester Ant',
  tier: 'soldier',
  flavor:
    'Starts as nothing and eats its way to the top. Every seed it hauls in makes it permanently bigger and meaner.',

  // Food is the whole strategy, so it forages hard and stays with the colony.
  ai: {
    forages: true,
    herds: true,
  },

  stats: {
    maxHealth: 62, // a weak starting point on purpose — the growth is the payoff
    speed: 1.6,
    size: 8,
    damage: 5,
    attackRange: 16,
    attackCooldown: 42,
    visionRange: 235, // it finds food before anyone else does
  },

  visual: {
    type: 'sprite',
    sprite: 'harvesterAnt',
    spriteExt: 'svg',
    spriteScale: 2.7,
    spriteFacing: 'up',
    shape: 'polygon',
    color: '#c2543a', // brick red
    stroke: '#3f150c',
    size: 8,
  },

  ability: null, // its whole identity is the growth below

  sfx: {
    attack: [{ src: 'noise', filter: 'bandpass', f0: 2400, f1: 1300, q: 6, dur: 0.045, gain: 0.24 }],
    death: [{ src: 'noise', filter: 'lowpass', f0: 1200, f1: 260, dur: 0.24, gain: 0.28 }],
  },

  hooks: {
    /**
     * Gorge. Each meal adds a permanent stack.
     *
     * Bulk is applied by mutating the agent's OWN stats copy (safe — `Agent`
     * clones species stats per unit), while the damage bonus rides a permanent
     * status so the engine's multiplier system handles it and the stack count is
     * visible on screen.
     */
    on_food(self, ctx) {
      const stacks = Math.min(GORGE.MAX_STACKS, (self.memory.gorge ?? 0) + 1);
      if (stacks === self.memory.gorge) return; // already capped out
      self.memory.gorge = stacks;

      // Permanent bulk: raise the ceiling AND heal by the same amount, so growing
      // is a reward rather than a dilution of its current health bar.
      self.stats.maxHealth += GORGE.HEALTH_PER_STACK;
      self.maxHealth = self.stats.maxHealth;
      self.health += GORGE.HEALTH_PER_STACK;

      ctx.applyStatus(
        self,
        {
          type: 'gorged',
          label: `Gorged ×${stacks}`,
          duration: ctx.config.maxTicks + 100, // it never wears off
          damageDealtMultiplier: 1 + GORGE.DAMAGE_PER_STACK * stacks,
          permanent: true,
        },
        self
      );
      ctx.spawnEffect({ kind: 'gorge', x: self.x, y: self.y, stacks });
    },
  },
};

export default harvesterAnt;
registerSpecies(harvesterAnt);
