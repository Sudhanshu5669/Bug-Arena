// Worker Ant — the colony's baseline. The weakest fighter in the arena by a clear
// margin, and the best forager: every morsel it finds gets carried back and shared
// out, healing the ants around it. It is also what a Queen's brood is made of, so
// a fight with a queen in it fills up with these.

import { registerSpecies } from './registry.js';

// --- passive tuning: Share the Haul ------------------------------------------
// Food is scarce by design — a worker manages only a couple of meals in a typical
// battle — so each haul has to be worth carrying home, or the mechanic never
// visibly fires at all.
const SHARE = {
  RADIUS: 100, // how far it distributes a find
  HEAL: 18, // to EVERY ally in reach, itself included
};

const workerAnt = {
  id: 'workerAnt',
  name: 'Worker Ant',
  tier: 'soldier',
  flavor:
    'Hopeless in a fight, tireless everywhere else. Every scrap it finds gets carried home and shared out.',

  // Foraging is its entire contribution, so it goes looking harder than anything
  // else does and sticks close to the colony it feeds.
  ai: {
    forages: true,
    herds: true,
  },

  stats: {
    maxHealth: 50, // the frailest unit in the game
    speed: 2.15, // and among the quickest — it is always busy
    size: 6, // the smallest, too
    damage: 4, // it genuinely cannot fight
    attackRange: 14,
    attackCooldown: 34,
    visionRange: 240, // excellent at spotting food
  },

  visual: {
    type: 'sprite',
    sprite: 'workerAnt',
    spriteExt: 'svg',
    spriteScale: 2.6,
    spriteFacing: 'up',
    shape: 'circle',
    color: '#8a6a3e', // plain working brown
    stroke: '#33240f',
    size: 6,
  },

  ability: null, // no signature ability — it's a worker, not a warrior

  sfx: {
    attack: [{ src: 'noise', filter: 'bandpass', f0: 3000, f1: 1900, q: 7, dur: 0.03, gain: 0.16 }],
    death: [{ src: 'tone', wave: 'sine', f0: 760, f1: 260, dur: 0.09, gain: 0.15 }],
  },

  hooks: {
    /**
     * Share the Haul. A worker doesn't eat a find so much as distribute it — every
     * ally nearby gets topped up. One worker is negligible; a foraging column of
     * them keeps a whole front line healthy without ever throwing a punch.
     */
    on_food(self, ctx) {
      const fed = [self, ...ctx.alliesInRadius(self, SHARE.RADIUS)];
      for (const ally of fed) ctx.heal(ally, SHARE.HEAL);
      ctx.spawnEffect({ kind: 'heal_burst', x: self.x, y: self.y, radius: SHARE.RADIUS, team: self.team });
    },
  },
};

export default workerAnt;
registerSpecies(workerAnt);
