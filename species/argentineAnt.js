// Argentine Ant — the one that wins by coordination. Argentine ants form
// supercolonies stretching thousands of kilometres, and they win territory not by
// being strong but by all showing up to the same place.
//
// Its ability is the game's only FOCUS-FIRE MARK: it lays a pheromone trail on one
// enemy, and everything that hits the marked bug hits far harder — including its
// own allies, who have no idea why. It's a pure force multiplier and does almost
// nothing on its own, which is exactly right for an ant that only matters en masse.

import { registerSpecies } from './registry.js';

const TRAIL = {
  TRIGGER_CHANCE: 0.35,
  COOLDOWN_SECONDS: 7,
  DURATION_SECONDS: 5,
  // Raised from 1.5: the mark's whole value is multiplying OTHER units' output, so
  // in a single-species fight it was near-worthless (it won 3% of them). A steeper
  // multiplier keeps the identity and stops the unit being dead weight.
  VULNERABILITY: 1.7, // the marked bug takes 70% more from EVERY source
  RALLY_RADIUS: 160, // allies this close get pointed at it
  RALLY_SPEED: 1.2, // ...and hurry over
  RALLY_SECONDS: 2.5,
};

const argentineAnt = {
  id: 'argentineAnt',
  name: 'Argentine Ant',
  tier: 'soldier',
  flavor:
    'Lays a trail on one target and the whole colony reads it. Nothing it does is impressive alone; together it is how supercolonies take continents.',

  stats: {
    maxHealth: 62,
    speed: 2.0,
    size: 6,
    damage: 6,
    attackRange: 15,
    attackCooldown: 30,
    visionRange: 250,
  },

  visual: {
    type: 'sprite',
    sprite: 'argentineAnt',
    spriteExt: 'svg',
    spriteScale: 2.05,
    spriteFacing: 'up',
    shape: 'ellipse',
    color: '#7a6a58',
    stroke: '#241c14',
    size: 6,
  },

  ability: {
    name: 'Trail Pheromone',
    description:
      'Marks one enemy for the colony — everything that lands on it from then on hits half again as hard.',
    triggerChance: TRAIL.TRIGGER_CHANCE,
    cooldownSeconds: TRAIL.COOLDOWN_SECONDS,
    telegraphColor: '#9fe8b0',
    requiresTarget: true,
    log: (self, target) => `${self.species.name} marked ${target.species.name} — swarm it!`,
    onTrigger(self, target, ctx) {
      if (!target || !target.alive) return {};

      // The mark is a vulnerability, NOT bonus damage from the marker — so it
      // multiplies the whole colony's output, which is the entire fantasy.
      ctx.applyStatus(
        target,
        {
          type: 'marked',
          label: 'Marked',
          duration: ctx.seconds(TRAIL.DURATION_SECONDS),
          damageTakenMultiplier: TRAIL.VULNERABILITY,
        },
        self
      );

      const rallied = ctx.alliesInRadius(self, TRAIL.RALLY_RADIUS);
      for (const ally of rallied) {
        ctx.applyStatus(
          ally,
          {
            type: 'on_trail',
            label: 'On the Trail',
            duration: ctx.seconds(TRAIL.RALLY_SECONDS),
            speedMultiplier: TRAIL.RALLY_SPEED,
          },
          self
        );
      }

      ctx.spawnEffect({ kind: 'flare', x: target.x, y: target.y, team: self.team });
      return { rallied: rallied.length };
    },
  },

  // Chemical, not physical — a thin sharp signal that carries.
  sfx: {
    attack: [{ src: 'noise', filter: 'bandpass', f0: 2900, f1: 2000, q: 9, dur: 0.026, gain: 0.13 }],
    ability: [
      { src: 'tone', wave: 'sine', f0: 1200, f1: 1800, dur: 0.18, gain: 0.22 },
      { src: 'tone', wave: 'sine', f0: 1800, f1: 1200, dur: 0.2, gain: 0.16, t0: 0.1 },
    ],
    death: [{ src: 'tone', wave: 'sine', f0: 350, f1: 85, dur: 0.13, gain: 0.18 }],
  },

  hooks: {},
};

export default argentineAnt;
registerSpecies(argentineAnt);
