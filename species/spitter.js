// Spitting Spider — the arena's only true RANGED unit. Everything else has to
// close the distance; this one opens fire at nearly three times a normal bug's
// reach and glues whatever it hits to the floor so it can never arrive.
//
// The trade is absolute: it has no melee game whatsoever. Its reach is its only
// defence, and anything that survives the glue and gets on top of it kills it in
// a couple of bites.
//
// (The engine already classifies an attack with `attackRange > 60` as 'ranged',
// so this needed no engine change at all — just a species with a long reach.)

import { registerSpecies } from './registry.js';

// --- ability tuning (easy to find + tweak) -----------------------------------
const GLUE = {
  TRIGGER_CHANCE: 0.45,
  COOLDOWN_SECONDS: 6,
  SECONDS: 3.5,
  SPEED: 0.25, // near-rooted, but not a full immobilize — it can still fight back
  SPLASH: 55, // the gob spreads over anything bunched around the target
  DAMAGE: 8,
};

const spitter = {
  id: 'spitter',
  name: 'Spitting Spider',
  tier: 'champion',
  flavor:
    'Opens fire long before anything can reach it, and glues whatever it hits to the floor so it never does.',

  stats: {
    maxHealth: 128, // frail: its reach is its armour
    speed: 1.35, // slow — it holds ground rather than kiting
    size: 11,
    damage: 10,
    attackRange: 155, // THE species trait: it shoots from across the arena
    attackCooldown: 54, // ticks (~0.9s) — deliberate, aimed shots
    visionRange: 310, // it has to see what it's shooting at
  },

  visual: {
    type: 'sprite',
    sprite: 'spitter',
    spriteExt: 'svg',
    spriteScale: 2.8,
    spriteFacing: 'up',
    shape: 'diamond',
    color: '#4fb3a8', // pale sticky teal
    stroke: '#12403c',
    size: 11,
  },

  // --- signature ability: Glue Shot (ranged control) --------------------------
  ability: {
    name: 'Glue Shot',
    description: 'Spits a gob of adhesive silk that all but roots its target where it stands.',
    triggerChance: GLUE.TRIGGER_CHANCE,
    cooldownSeconds: GLUE.COOLDOWN_SECONDS,
    telegraphColor: '#8ff0e4',
    log: (self, target, stuck) => {
      const n = stuck?.length ?? 1;
      return n > 1
        ? `${self.species.name} glued ${n} foes to the sand!`
        : `${self.species.name} glued ${target.species.name} to the sand!`;
    },
    onTrigger(self, target, ctx) {
      const stuck = ctx.enemiesOf(self).filter((e) => ctx.distance(e, target) <= GLUE.SPLASH);
      if (!stuck.includes(target)) stuck.push(target);

      for (const victim of stuck) {
        ctx.dealDamage(victim, GLUE.DAMAGE, { sourceAgent: self, cause: 'spit' });
        if (!victim.alive) continue;
        ctx.applyStatus(
          victim,
          {
            type: 'glued',
            label: 'Glued',
            duration: ctx.seconds(GLUE.SECONDS),
            speedMultiplier: GLUE.SPEED,
          },
          self
        );
      }
      ctx.spawnEffect({ kind: 'spit', x1: self.x, y1: self.y, x2: target.x, y2: target.y, radius: GLUE.SPLASH });
      return stuck;
    },
  },

  sfx: {
    attack: [
      { src: 'noise', filter: 'bandpass', f0: 1200, f1: 3600, q: 5, dur: 0.07, gain: 0.24 }, // the launch
      { src: 'tone', wave: 'sine', f0: 620, f1: 1500, dur: 0.06, gain: 0.1 },
    ],
    ability: [
      { src: 'noise', filter: 'bandpass', f0: 800, f1: 4800, q: 3, dur: 0.14, gain: 0.3 }, // the gob leaving
      { src: 'noise', filter: 'lowpass', f0: 2400, f1: 500, dur: 0.22, gain: 0.28, t0: 0.11 }, // the wet splat
      { src: 'tone', wave: 'sine', f0: 260, f1: 90, dur: 0.2, gain: 0.12, t0: 0.11 },
    ],
    death: [{ src: 'noise', filter: 'lowpass', f0: 1500, f1: 260, dur: 0.26, gain: 0.3 }],
  },

  hooks: {},
};

export default spitter;
registerSpecies(spitter);
