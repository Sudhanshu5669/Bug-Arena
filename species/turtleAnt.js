// Turtle Ant — the living door. Real turtle ant soldiers have a flat, plate-like
// head they use to physically plug the nest entrance. Here it plugs the LINE: it
// roots itself, becomes nearly unkillable, and extends that protection to every
// ally standing behind it.
//
// This is the only ability in the game that willingly gives up all mobility. That
// trade is the design: it cannot chase, cannot retreat, and is useless in an open
// field — but a colony that fights around it is dramatically harder to break.

import { registerSpecies } from './registry.js';

const PLUG = {
  TRIGGER_CHANCE: 0.4,
  COOLDOWN_SECONDS: 11,
  DURATION_SECONDS: 3.6,
  SELF_RESIST: 0.24, // it takes 24% of incoming damage — very nearly a wall
  ALLY_RADIUS: 108,
  ALLY_RESIST: 0.7, // allies in its shadow take 30% less
};

const turtleAnt = {
  id: 'turtleAnt',
  name: 'Turtle Ant',
  tier: 'soldier',
  flavor:
    'Plugs the gap with its own armoured head — it stops moving entirely, and almost nothing gets through it.',

  stats: {
    maxHealth: 126, // the toughest ant in the roster before it even braces
    speed: 1.15, // and by far the slowest
    size: 10,
    damage: 4, // it is not here to kill anything
    attackRange: 16,
    attackCooldown: 56,
    visionRange: 185,
  },

  visual: {
    type: 'sprite',
    sprite: 'turtleAnt',
    spriteExt: 'svg',
    spriteScale: 2.4,
    spriteFacing: 'up',
    shape: 'ellipse',
    color: '#6b705c',
    stroke: '#22261b',
    size: 10,
  },

  ability: {
    name: 'Door Head',
    description:
      'Braces its plated head and stops dead — it takes a fraction of all damage, and shelters the allies behind it.',
    triggerChance: PLUG.TRIGGER_CHANCE,
    cooldownSeconds: PLUG.COOLDOWN_SECONDS,
    telegraphColor: '#b9c4a0',
    requiresTarget: false,
    log: (self, target, res) =>
      res?.sheltered
        ? `${self.species.name} braced — ${res.sheltered} allies in its shadow.`
        : `${self.species.name} plugged the gap!`,
    onTrigger(self, target, ctx) {
      const ticks = ctx.seconds(PLUG.DURATION_SECONDS);

      // The brace: immovable, near-immune, and still able to bite whatever walks
      // into it (preventAttack is deliberately NOT set — a door with mandibles).
      ctx.applyStatus(
        self,
        {
          type: 'braced',
          label: 'Braced',
          duration: ticks,
          preventMove: true,
          speedMultiplier: 0,
          damageTakenMultiplier: PLUG.SELF_RESIST,
        },
        self
      );

      const sheltered = ctx.alliesInRadius(self, PLUG.ALLY_RADIUS);
      for (const ally of sheltered) {
        ctx.applyStatus(
          ally,
          {
            type: 'sheltered',
            label: 'Sheltered',
            duration: ticks,
            damageTakenMultiplier: PLUG.ALLY_RESIST,
          },
          self
        );
      }

      ctx.spawnEffect({
        kind: 'coil',
        x: self.x,
        y: self.y,
        radius: PLUG.ALLY_RADIUS,
        team: self.team,
      });

      return { sheltered: sheltered.length };
    },
  },

  // Chitin on chitin — a low, woody knock and a settling scrape.
  sfx: {
    attack: [{ src: 'noise', filter: 'lowpass', f0: 900, f1: 400, dur: 0.045, gain: 0.18 }],
    ability: [
      { src: 'tone', wave: 'square', f0: 150, f1: 70, dur: 0.18, gain: 0.24, cutoff: 700 }, // the plate dropping
      { src: 'noise', filter: 'lowpass', f0: 600, f1: 200, dur: 0.34, gain: 0.2, t0: 0.06 },
    ],
    death: [{ src: 'tone', wave: 'sine', f0: 210, f1: 55, dur: 0.24, gain: 0.24 }],
  },

  hooks: {},
};

export default turtleAnt;
registerSpecies(turtleAnt);
