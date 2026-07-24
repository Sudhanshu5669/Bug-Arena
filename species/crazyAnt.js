// Tawny Crazy Ant — the saboteur. It cannot kill anything worth killing, but the
// formic acid it sprays eats through chitin and leaves an enemy hitting like a
// worker for the next few seconds. Two or three of these turn a champion into a
// nuisance. Anything that reaches them, though, kills them instantly.

import { registerSpecies } from './registry.js';

// --- ability tuning (easy to find + tweak) -----------------------------------
const ACID = {
  TRIGGER_CHANCE: 0.5, // sprays constantly — it's the only thing it's good at
  COOLDOWN_SECONDS: 5,
  RADIUS: 85, // splashes over everything bunched around the target
  SECONDS: 5,
  DAMAGE_DEALT: 0.58, // victims hit for 42% less
  CHIP: 4, // a token amount of burn on contact
};

const crazyAnt = {
  id: 'crazyAnt',
  name: 'Crazy Ant',
  tier: 'soldier',
  flavor:
    'Erratic, everywhere at once, and soaked in acid. It can barely hurt you — it just makes sure you can barely hurt anyone.',

  stats: {
    maxHealth: 56, // still frail — but it has to live long enough to spray
    speed: 2.3, // the fastest ant — it skitters unpredictably
    size: 6,
    damage: 5, // negligible on its own; the debuff is the contribution
    attackRange: 15,
    attackCooldown: 30,
    visionRange: 225,
  },

  visual: {
    type: 'sprite',
    sprite: 'crazyAnt',
    spriteExt: 'svg',
    spriteScale: 2.6,
    spriteFacing: 'up',
    shape: 'triangle',
    color: '#b8c43a', // acid yellow-green
    stroke: '#3c4210',
    size: 6,
  },

  // --- signature ability: Formic Spray (an offensive DEBUFF, not damage) -------
  ability: {
    name: 'Formic Spray',
    description: "Sprays acid over a cluster of foes — everything it touches hits far weaker.",
    triggerChance: ACID.TRIGGER_CHANCE,
    cooldownSeconds: ACID.COOLDOWN_SECONDS,
    telegraphColor: '#d8e84a',
    log: (self, target, soaked) => {
      const n = soaked?.length ?? 1;
      return n > 1
        ? `${self.species.name} soaked ${n} foes in acid — their bite is ruined!`
        : `${self.species.name} soaked ${target.species.name} in acid!`;
    },
    onTrigger(self, target, ctx) {
      const soaked = ctx.enemiesOf(self).filter((e) => ctx.distance(e, target) <= ACID.RADIUS);
      if (!soaked.includes(target)) soaked.push(target);

      for (const victim of soaked) {
        ctx.dealDamage(victim, ACID.CHIP, { sourceAgent: self, cause: 'acid' });
        if (!victim.alive) continue;
        ctx.applyStatus(
          victim,
          {
            type: 'weakened',
            label: 'Corroded',
            duration: ctx.seconds(ACID.SECONDS),
            damageDealtMultiplier: ACID.DAMAGE_DEALT,
          },
          self
        );
      }
      ctx.spawnEffect({ kind: 'acid', x: target.x, y: target.y, radius: ACID.RADIUS });
      return soaked;
    },
  },

  sfx: {
    attack: [{ src: 'noise', filter: 'bandpass', f0: 3400, f1: 2200, q: 9, dur: 0.028, gain: 0.17 }],
    ability: [
      { src: 'noise', filter: 'highpass', f0: 2000, f1: 6000, dur: 0.24, gain: 0.3 }, // the spray
      { src: 'noise', filter: 'bandpass', f0: 1400, f1: 700, q: 3, dur: 0.4, gain: 0.16, t0: 0.1 }, // the sizzle
    ],
    death: [{ src: 'tone', wave: 'sine', f0: 820, f1: 240, dur: 0.1, gain: 0.16 }],
  },

  hooks: {},
};

export default crazyAnt;
registerSpecies(crazyAnt);
