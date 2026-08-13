// Jack Jumper Ant — the one you cannot pin down. A real jack jumper doesn't walk
// at a threat, it bounds at it in erratic hops, tracking with excellent eyesight.
//
// Mechanically it is the game's only EVASION unit: for a few seconds it takes a
// fraction of incoming damage without any of the armour a Turtle Ant carries. It
// is not tanky — it is simply not where the blow lands. Focus fire is the counter,
// because the window is short and the cooldown is long.

import { registerSpecies } from './registry.js';

const BOUND = {
  TRIGGER_CHANCE: 0.36,
  COOLDOWN_SECONDS: 8,
  DURATION_SECONDS: 3,
  EVASION: 0.35, // takes 35% of incoming damage while bounding
  SPEED: 1.6, // and moves 60% faster
  HOP: 46, // an immediate hop off the spot it was standing on
};

const jackJumperAnt = {
  id: 'jackJumperAnt',
  name: 'Jack Jumper Ant',
  tier: 'soldier',
  flavor:
    "Doesn't walk anywhere — it bounds, erratically and fast, and most of what gets swung at it hits the space it just left.",

  stats: {
    maxHealth: 64,
    speed: 2.1,
    size: 7,
    damage: 7, // it stings well for its size
    attackRange: 17,
    attackCooldown: 33,
    visionRange: 285, // superb eyesight, second only to the Bulldog Ant
  },

  visual: {
    type: 'sprite',
    sprite: 'jackJumperAnt',
    spriteExt: 'svg',
    spriteScale: 2.15,
    spriteFacing: 'up',
    shape: 'ellipse',
    color: '#f0a202',
    stroke: '#3a2600',
    size: 7,
  },

  ability: {
    name: 'Erratic Bound',
    description:
      'Breaks into unpredictable hops — it moves far faster, and most incoming blows find empty ground.',
    triggerChance: BOUND.TRIGGER_CHANCE,
    cooldownSeconds: BOUND.COOLDOWN_SECONDS,
    telegraphColor: '#ffd257',
    requiresTarget: false,
    log: (self) => `${self.species.name} broke into a bound — good luck hitting it.`,
    onTrigger(self, target, ctx) {
      // Hop off the current spot immediately, in a random direction, so the proc
      // visibly breaks whatever was lined up on it rather than only helping later.
      const a = ctx.randRange(0, Math.PI * 2);
      ctx.push(self, Math.cos(a), Math.sin(a), BOUND.HOP);

      ctx.applyStatus(
        self,
        {
          type: 'bounding',
          label: 'Bounding',
          duration: ctx.seconds(BOUND.DURATION_SECONDS),
          damageTakenMultiplier: BOUND.EVASION,
          speedMultiplier: BOUND.SPEED,
        },
        self
      );

      // The streak has to show WHERE it bounded to, so it is a line along the
      // hop, not a point. Emitted with the same field names the renderer reads
      // (x1/y1 -> x2/y2); a bare x/y left all four undefined, and undefined
      // geometry reaching a canvas gradient throws mid-frame and leaves the
      // arena stuck in additive blend. See tools/fxCheck.js.
      //
      // The endpoint is computed rather than read back: `push` is an impulse, so
      // the body has not moved yet at this point in the tick.
      ctx.spawnEffect({
        kind: 'dash',
        x1: self.x,
        y1: self.y,
        x2: self.x + Math.cos(a) * BOUND.HOP,
        y2: self.y + Math.sin(a) * BOUND.HOP,
        speciesId: self.speciesId,
        team: self.team,
        angle: a,
      });
      return { bounding: true };
    },
  },

  // Light and springy — a tick of chitin and a rising whip of air.
  sfx: {
    attack: [{ src: 'noise', filter: 'bandpass', f0: 2800, f1: 1900, q: 9, dur: 0.028, gain: 0.15 }],
    ability: [
      { src: 'tone', wave: 'triangle', f0: 300, f1: 1100, dur: 0.14, gain: 0.24 }, // the spring
      { src: 'noise', filter: 'highpass', f0: 2600, f1: 6000, dur: 0.12, gain: 0.18, t0: 0.04 },
    ],
    death: [{ src: 'tone', wave: 'sine', f0: 340, f1: 80, dur: 0.15, gain: 0.2 }],
  },

  hooks: {},
};

export default jackJumperAnt;
registerSpecies(jackJumperAnt);
