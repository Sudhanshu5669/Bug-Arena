// Honeypot Ant — the colony's living larder. Its gaster is a swollen cask of
// nectar, which makes it enormous, sluggish and effectively unable to fight.
// What it does instead is keep everyone else alive: it seeps nectar into the
// nearest wounded ally continuously, and when it finally bursts, the colony
// drinks the lot.
//
// Like the suicide ant it has no gated signature ability — its whole identity is
// in its passive and its death.

import { registerSpecies } from './registry.js';

// --- passive tuning: Nectar Seep ---------------------------------------------
const SEEP = {
  RADIUS: 95,
  EVERY_TICKS: 40, // heal pulse cadence (~0.67s at 60Hz)
  // Per pulse, to ONE ally — the most wounded in reach. Kept deliberately small:
  // several honeypots all top up the SAME worst-hurt ally, so throughput stacks
  // fast and a big enough huddle would otherwise be unkillable.
  AMOUNT: 3,
};

// --- death tuning: Sweet Rupture ---------------------------------------------
const RUPTURE = {
  RADIUS: 130, // a generous splash — this is the payoff for protecting it
  HEAL: 34,
};

const honeypotAnt = {
  id: 'honeypotAnt',
  name: 'Honeypot Ant',
  tier: 'soldier',
  flavor:
    'A living cask of nectar. Helpless in a fight, but it drips life back into the colony — and floods it on death.',

  // It is the food store, so it never goes looking for food. It stays welded to
  // the herd, which is exactly where its healing does the most good.
  ai: {
    forages: false,
    herds: true,
  },

  stats: {
    maxHealth: 132, // a big sack of HP — but every point of it is a liability to guard
    speed: 0.95, // the slowest unit in the arena, bloated with nectar
    size: 11, // and the largest ant: an unmissable target
    damage: 3, // very nearly harmless
    attackRange: 14,
    attackCooldown: 70,
    visionRange: 170, // poor
  },

  visual: {
    type: 'sprite',
    sprite: 'honeypotAnt',
    spriteExt: 'svg',
    spriteScale: 2.9,
    spriteFacing: 'up',
    shape: 'circle',
    color: '#f0b429', // amber nectar
    stroke: '#6b4407',
    size: 11,
  },

  ability: null, // no gated ability — see the hooks below

  // Thick, wet and sweet. Nothing about it is sharp.
  sfx: {
    attack: [{ src: 'noise', filter: 'lowpass', f0: 1200, f1: 600, dur: 0.05, gain: 0.14 }],
    death: [
      { src: 'tone', wave: 'sine', f0: 500, f1: 110, dur: 0.36, gain: 0.28 }, // the cask giving way
      { src: 'noise', filter: 'lowpass', f0: 1600, f1: 280, dur: 0.32, gain: 0.3 }, // the wet burst
      { src: 'tone', wave: 'triangle', f0: 392, f1: 587, dur: 0.5, gain: 0.16, t0: 0.1 }, // the colony drinking
    ],
  },

  hooks: {
    /**
     * Nectar Seep. Every half-second, top up the single most wounded ally within
     * reach. One target per pulse on purpose: it's a steady trickle that keeps a
     * front line standing, not a mass heal that trivialises damage.
     */
    on_tick(self, ctx) {
      if (ctx.tick % SEEP.EVERY_TICKS !== 0) return;
      let worst = null;
      let worstMissing = 0;
      for (const ally of ctx.alliesInRadius(self, SEEP.RADIUS)) {
        const missing = ally.maxHealth - ally.health;
        if (missing > worstMissing) {
          worstMissing = missing;
          worst = ally;
        }
      }
      if (!worst) return;
      ctx.heal(worst, SEEP.AMOUNT);
      ctx.spawnEffect({ kind: 'nectar', x1: self.x, y1: self.y, x2: worst.x, y2: worst.y });
    },

    /** Sweet Rupture: the cask splits and every ally in range drinks deep. */
    on_death(self, ctx) {
      const drinkers = ctx.alliesInRadius(self, RUPTURE.RADIUS);
      for (const ally of drinkers) ctx.heal(ally, RUPTURE.HEAL);
      ctx.spawnEffect({
        kind: 'heal_burst',
        x: self.x,
        y: self.y,
        radius: RUPTURE.RADIUS,
        team: self.team,
      });
    },
  },
};

export default honeypotAnt;
registerSpecies(honeypotAnt);
