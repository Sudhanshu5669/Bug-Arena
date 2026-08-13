// Thief Ant — the medic that doesn't own any medicine. Real thief ants nest
// alongside larger colonies and live entirely on what they steal from them.
//
// So it heals, but it never generates: every point it gives an ally is torn out
// of an enemy first. That makes it the mirror of the Honeypot Ant, which carries
// its own stores. This one has nothing until it takes something — and it always
// gives the take to whoever needs it most, not to itself.

import { registerSpecies } from './registry.js';

const LARCENY = {
  TRIGGER_CHANCE: 0.34,
  COOLDOWN_SECONDS: 7.5,
  // Raised from 14 / 1.35: a 52 HP ant with a 4-damage bite needs the theft itself
  // to be a real threat, or it contributes nothing in any fight it can't win by
  // out-healing — which was every fight.
  STEAL: 18, // HP torn out of the victim
  TRANSFER: 1.5, // ...and delivered at a premium (it's a good thief)
  ALLY_RADIUS: 150,
};

const thiefAnt = {
  id: 'thiefAnt',
  name: 'Thief Ant',
  tier: 'soldier',
  flavor:
    'Owns nothing and gives constantly — every point of health it hands an ally was stolen out of somebody else a moment earlier.',

  stats: {
    maxHealth: 58, // tiny and fragile: it works from inside the scrum
    speed: 2.1,
    size: 6,
    damage: 5,
    attackRange: 14,
    attackCooldown: 32,
    visionRange: 245,
  },

  visual: {
    type: 'sprite',
    sprite: 'thiefAnt',
    spriteExt: 'svg',
    spriteScale: 2.0,
    spriteFacing: 'up',
    shape: 'ellipse',
    color: '#b08968',
    stroke: '#2f2013',
    size: 6,
  },

  ability: {
    name: 'Larceny',
    description:
      "Tears health out of its victim and hands it straight to whichever ally is worst off.",
    triggerChance: LARCENY.TRIGGER_CHANCE,
    cooldownSeconds: LARCENY.COOLDOWN_SECONDS,
    telegraphColor: '#ffd9a0',
    requiresTarget: true,
    log: (self, target, res) =>
      res?.to
        ? `${self.species.name} stole from ${target.species.name} to patch up ${res.to}!`
        : `${self.species.name} picked a pocket.`,
    onTrigger(self, target, ctx) {
      if (!target || !target.alive) return {};

      ctx.dealDamage(target, LARCENY.STEAL, { sourceAgent: self, cause: 'larceny' });

      // Find the ally in the worst shape by MISSING hp, not by percentage — a
      // champion down 200 is a better use of the steal than an ant down 20.
      const candidates = ctx.alliesInRadius(self, LARCENY.ALLY_RADIUS).concat(self);
      let worst = null;
      let worstMissing = 0;
      for (const ally of candidates) {
        const missing = ally.maxHealth - ally.health;
        if (missing > worstMissing) {
          worstMissing = missing;
          worst = ally;
        }
      }
      // Nobody hurt: the steal is still real damage, it just has nowhere to go.
      if (!worst) return {};

      ctx.heal(worst, LARCENY.STEAL * LARCENY.TRANSFER);
      // A `nectar` arc runs (x1,y1) -> (x2,y2). It was emitting toX/toY, which
      // the renderer never reads. See tools/fxCheck.js.
      ctx.spawnEffect({
        kind: 'nectar',
        x1: self.x,
        y1: self.y,
        x2: worst.x,
        y2: worst.y,
        team: self.team,
      });

      return { to: worst.species.name };
    },
  },

  // Quick, furtive, light-fingered.
  sfx: {
    attack: [{ src: 'noise', filter: 'bandpass', f0: 3200, f1: 2200, q: 10, dur: 0.022, gain: 0.12 }],
    ability: [
      { src: 'tone', wave: 'triangle', f0: 880, f1: 460, dur: 0.16, gain: 0.2 }, // the lift
      { src: 'tone', wave: 'sine', f0: 520, f1: 900, dur: 0.22, gain: 0.18, t0: 0.1 }, // the handoff
    ],
    death: [{ src: 'tone', wave: 'sine', f0: 380, f1: 95, dur: 0.12, gain: 0.18 }],
  },

  hooks: {},
};

export default thiefAnt;
registerSpecies(thiefAnt);
