// Antlion — the ambusher. It collapses the sand into a pit and drags every enemy
// around it down into the bottom, where they cannot move. It is the strongest
// setup tool in the game: a whole enemy line yanked into one heap and held there
// for two seconds is a free opening for everything the antlion's team has.
//
// It sets that up and then can barely capitalise on it. It is the slowest champion
// on the field with the worst eyesight and mediocre damage — it cannot chase, and
// if the fight happens anywhere but on top of it, it contributes nothing at all.

import { registerSpecies } from './registry.js';

// --- ability tuning (easy to find + tweak) -----------------------------------
const PIT = {
  TRIGGER_CHANCE: 0.5,
  COOLDOWN_SECONDS: 8, // long — a mass pull-and-root is the strongest control here
  WINDUP_SECONDS: 0.35, // the sand starts sliding before it gives way
  RADIUS: 135, // everything this close is dragged in
  PULL_TO: 34, // how close to the centre they end up
  DAMAGE: 12,
  ROOT_SECONDS: 2, // held at the bottom — no moving, but they CAN still fight
};

const antlion = {
  id: 'antlion',
  name: 'Antlion',
  tier: 'champion',
  flavor:
    'Collapses the ground into a pit and drags the whole line into the bottom of it. Then struggles to do much about it.',

  // A pit predator waits: it does not run the arena down, it holds a spot and lets
  // the battle come to it.
  ai: {
    hunts: false, // it ambushes rather than stalks
    herds: true,
  },

  stats: {
    maxHealth: 205, // buried and armoured — hard to shift
    speed: 0.85, // the slowest champion in the game
    size: 14,
    damage: 12, // still modest: it sets kills up more than it closes them
    attackRange: 26, // long jaws
    attackCooldown: 46,
    visionRange: 175, // it barely sees past its own pit
  },

  visual: {
    type: 'sprite',
    sprite: 'antlion',
    spriteExt: 'svg',
    spriteScale: 2.9,
    spriteFacing: 'up',
    shape: 'polygon',
    color: '#a8906a', // sand grey-brown
    stroke: '#33291a',
    size: 14,
  },

  // --- signature ability: Sand Pit (mass pull + mass root) --------------------
  ability: {
    name: 'Sand Pit',
    description: 'Collapses the sand — every nearby enemy is dragged into the pit and held there.',
    triggerChance: PIT.TRIGGER_CHANCE,
    cooldownSeconds: PIT.COOLDOWN_SECONDS,
    windupSeconds: PIT.WINDUP_SECONDS,
    telegraphColor: '#e3c98a',
    requiresTarget: false, // the ground gives way whether or not the target survived
    log: (self, target, caught) => {
      const n = caught?.length ?? 0;
      return n > 1
        ? `${self.species.name} collapsed the sand — ${n} foes dragged into the pit!`
        : `${self.species.name} collapsed the sand beneath its prey!`;
    },
    onTrigger(self, target, ctx) {
      const caught = ctx.enemiesInRadius(self, PIT.RADIUS);
      for (const victim of caught) {
        // Drag each one inward to the rim of the pit floor.
        const dx = self.x - victim.x;
        const dy = self.y - victim.y;
        const d = Math.hypot(dx, dy) || 1;
        const travel = Math.max(0, d - PIT.PULL_TO);
        if (travel > 1) {
          const slide = ctx.push(victim, dx / d, dy / d, travel);
          ctx.spawnEffect({ kind: 'impact', x: slide.x, y: slide.y, x0: slide.fromX, y0: slide.fromY });
        }
        ctx.dealDamage(victim, PIT.DAMAGE, { sourceAgent: self, cause: 'pit' });
        if (!victim.alive) continue;
        ctx.applyStatus(
          victim,
          {
            type: 'pitted',
            label: 'In the Pit',
            duration: ctx.seconds(PIT.ROOT_SECONDS),
            speedMultiplier: 0,
            preventMove: true,
            // NOT preventAttack: they're stuck at the bottom, not helpless. That
            // keeps this a setup tool rather than a second, better web trap.
          },
          self
        );
      }
      ctx.spawnEffect({ kind: 'sand_pit', x: self.x, y: self.y, radius: PIT.RADIUS });
      return caught;
    },
  },

  sfx: {
    attack: [{ src: 'noise', filter: 'bandpass', f0: 1700, f1: 800, q: 7, dur: 0.05, gain: 0.26 }],
    ability: [
      { src: 'noise', filter: 'lowpass', f0: 3200, f1: 400, dur: 0.55, gain: 0.36 }, // the sand giving way
      { src: 'tone', wave: 'sine', f0: 130, f1: 44, dur: 0.5, gain: 0.22 }, // the collapse
      { src: 'noise', filter: 'bandpass', f0: 900, f1: 2200, q: 2, dur: 0.3, gain: 0.16, t0: 0.16 }, // the slide
    ],
    death: [
      { src: 'noise', filter: 'lowpass', f0: 1400, f1: 200, dur: 0.34, gain: 0.32 },
      { src: 'tone', wave: 'sine', f0: 90, f1: 40, dur: 0.36, gain: 0.2 },
    ],
  },

  hooks: {},
};

export default antlion;
registerSpecies(antlion);
