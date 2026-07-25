// Dragonfly — the most successful aerial predator on earth, with a hit rate
// around 95%. It intercepts prey by predicting where the prey is GOING, and it
// almost never has to make a second pass.
//
// Here that becomes a multi-pass STRAFE: three separate charges through three
// separate targets in one proc, each one plowing through whatever is in the line.
// It is the only ability that relocates the caster repeatedly, so it also breaks
// contact with whatever was pinning it down.

import { registerSpecies } from './registry.js';

const STRAFE = {
  TRIGGER_CHANCE: 0.38,
  COOLDOWN_SECONDS: 9,
  PASSES: 3,
  RANGE: 260, // how far it will look for each successive target
  DISTANCE: 150, // length of one charge
  DAMAGE_PER_PASS: 13,
  KNOCKBACK: 34,
  // dashThrough stuns everything it clips. At the default 0.55s, three passes
  // chain into a near-permanent lockdown across half a squad — so each individual
  // pass is deliberately made much less sticky than a single-charge ability's.
  STAGGER_SECONDS: 0.22,
};

const dragonfly = {
  id: 'dragonfly',
  name: 'Dragonfly',
  tier: 'champion',
  flavor:
    'Catches what it goes after roughly nineteen times in twenty. It does not circle, it does not stalk — it intercepts.',

  stats: {
    maxHealth: 116, // the most fragile champion in the game
    speed: 3.35,
    size: 11,
    damage: 10,
    attackRange: 21,
    attackCooldown: 24,
    visionRange: 305, // the best eyes on the field, by a distance
  },

  visual: {
    type: 'sprite',
    sprite: 'dragonfly',
    spriteExt: 'svg',
    spriteScale: 2.95,
    spriteFacing: 'up',
    shape: 'polygon',
    color: '#2ec4b6',
    stroke: '#0b2f2b',
    size: 11,
  },

  ability: {
    name: 'Aerial Strafe',
    description:
      'Three interception runs in one breath, each tearing straight through whatever stands in the line.',
    triggerChance: STRAFE.TRIGGER_CHANCE,
    cooldownSeconds: STRAFE.COOLDOWN_SECONDS,
    telegraphColor: '#8ef7ea',
    requiresTarget: false, // it picks its own line each pass
    log: (self, target, res) => {
      const n = res?.hit ?? 0;
      return n > 2
        ? `${self.species.name} strafed through ${n} of them!`
        : `${self.species.name} ran an interception pass.`;
    },
    onTrigger(self, target, ctx) {
      const struck = new Set();
      let passes = 0;

      for (let i = 0; i < STRAFE.PASSES; i++) {
        // Re-pick every pass from where it now IS: the whole point is that each
        // run starts from the end of the last one, so it zig-zags across the field
        // instead of shuttling back and forth along one line.
        const next = i === 0 && target?.alive ? target : ctx.nearestEnemy(self, STRAFE.RANGE);
        if (!next) break;

        const res = ctx.dashThrough(self, next, {
          distance: STRAFE.DISTANCE,
          damage: STRAFE.DAMAGE_PER_PASS,
          knockback: STRAFE.KNOCKBACK,
          staggerSeconds: STRAFE.STAGGER_SECONDS,
        });
        passes++;
        for (const victim of res?.hit ?? []) struck.add(victim.id);

        ctx.spawnEffect({
          kind: 'dash',
          x: res?.startX ?? self.x,
          y: res?.startY ?? self.y,
          toX: res?.endX ?? self.x,
          toY: res?.endY ?? self.y,
          team: self.team,
        });
      }

      return { hit: struck.size, passes };
    },
  },

  // Dry, papery wings at very high frequency — a clatter, not a buzz.
  sfx: {
    attack: [{ src: 'noise', filter: 'bandpass', f0: 3400, f1: 2400, q: 10, dur: 0.025, gain: 0.16 }],
    ability: [
      { src: 'noise', filter: 'bandpass', f0: 2000, f1: 5200, q: 2, dur: 0.16, gain: 0.28 },
      { src: 'noise', filter: 'bandpass', f0: 2000, f1: 5200, q: 2, dur: 0.16, gain: 0.26, t0: 0.13 },
      { src: 'noise', filter: 'bandpass', f0: 2000, f1: 5200, q: 2, dur: 0.16, gain: 0.24, t0: 0.26 },
      { src: 'tone', wave: 'triangle', f0: 900, f1: 1600, dur: 0.4, gain: 0.12 },
    ],
    death: [{ src: 'tone', wave: 'triangle', f0: 620, f1: 90, dur: 0.26, gain: 0.24 }],
  },

  hooks: {},
};

export default dragonfly;
registerSpecies(dragonfly);
