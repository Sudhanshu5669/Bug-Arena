// Hornet — the assassin. The fastest, sharpest-eyed thing in the arena, and the
// only unit that can delete a target outright: a barrage of stings plus a vicious
// venom load. It pays for it twice over — it is the frailest champion on the
// field, and the barrage leaves it spent, slow and wide open for three seconds.
// Time the dive badly and it dies to whatever it just failed to kill.

import { registerSpecies } from './registry.js';

// --- ability tuning (easy to find + tweak) -----------------------------------
const BARRAGE = {
  TRIGGER_CHANCE: 0.4,
  COOLDOWN_SECONDS: 7.5,
  STINGS: 3,
  DAMAGE_PER_STING: 9, // 27 up front...
  VENOM_SECONDS: 3.5,
  VENOM_PER_SECOND: 11, // ...plus ~38 more over the venom's life
  // The price: it is completely spent afterwards.
  // Long enough to be a real window for the enemy, short enough that the hornet
  // isn't simply killed every time it uses its own signature move.
  SPENT_SECONDS: 2.2,
  SPENT_SPEED: 0.5,
  SPENT_DEALT: 0.6,
  SPENT_TAKEN: 1.35,
};

const hornet = {
  id: 'hornet',
  name: 'Hornet',
  tier: 'champion',
  flavor:
    'A hunting wasp with a hair trigger. It can erase almost anything it lands on, then hangs exhausted and defenceless.',

  stats: {
    maxHealth: 120, // the most fragile champion by a wide margin
    speed: 3.4, // the fastest unit in the game
    size: 10,
    damage: 11,
    attackRange: 20,
    attackCooldown: 22, // ticks (~0.37s) — and the fastest attacker
    visionRange: 300, // it sees the whole arena
  },

  visual: {
    type: 'sprite',
    sprite: 'hornet',
    spriteExt: 'svg',
    spriteScale: 2.8,
    spriteFacing: 'up',
    shape: 'diamond',
    color: '#f2c012', // wasp yellow
    stroke: '#2b2205',
    size: 10,
  },

  // --- signature ability: Venom Barrage (burst kill + self-inflicted exhaustion) --
  ability: {
    name: 'Venom Barrage',
    description:
      'Drives its sting home three times and pumps in venom — then hangs exhausted, slowed and easy to hit.',
    triggerChance: BARRAGE.TRIGGER_CHANCE,
    cooldownSeconds: BARRAGE.COOLDOWN_SECONDS,
    telegraphColor: '#ffe14a',
    log: (self, target) => `${self.species.name} emptied its sting into ${target.species.name}!`,
    onTrigger(self, target, ctx) {
      for (let i = 0; i < BARRAGE.STINGS; i++) {
        if (!target.alive) break;
        ctx.dealDamage(target, BARRAGE.DAMAGE_PER_STING, { sourceAgent: self, cause: 'barrage' });
      }
      if (target.alive) {
        ctx.applyStatus(
          target,
          {
            type: 'poison',
            label: 'Envenomed',
            duration: ctx.seconds(BARRAGE.VENOM_SECONDS),
            damagePerSecond: BARRAGE.VENOM_PER_SECOND,
          },
          self
        );
      }
      ctx.spawnEffect({
        kind: 'barrage',
        x1: self.x,
        y1: self.y,
        x2: target.x,
        y2: target.y,
        stings: BARRAGE.STINGS,
      });
      ctx.spawnEffect({ kind: 'venom', x: target.x, y: target.y, radius: target.stats.size + 6 });

      // Spent. Everything that makes the hornet dangerous switches off at once.
      ctx.applyStatus(
        self,
        {
          type: 'exhausted',
          label: 'Spent',
          duration: ctx.seconds(BARRAGE.SPENT_SECONDS),
          speedMultiplier: BARRAGE.SPENT_SPEED,
          damageDealtMultiplier: BARRAGE.SPENT_DEALT,
          damageTakenMultiplier: BARRAGE.SPENT_TAKEN,
        },
        self
      );
    },
  },

  // Wing buzz, all of it — a live, wobbling saw tone under every sound it makes.
  sfx: {
    attack: [
      { src: 'tone', wave: 'sawtooth', f0: 330, f1: 220, dur: 0.07, gain: 0.15, cutoff: 2400, vibrato: { rate: 70, depth: 60 } },
      { src: 'noise', filter: 'bandpass', f0: 3400, f1: 2000, q: 8, dur: 0.035, gain: 0.2 },
    ],
    ability: [
      { src: 'tone', wave: 'sawtooth', f0: 260, dur: 0.42, gain: 0.18, cutoff: 2000, vibrato: { rate: 55, depth: 95 } }, // the angry hover
      { src: 'noise', filter: 'bandpass', f0: 4000, f1: 1800, q: 10, dur: 0.05, gain: 0.3, repeat: { times: 3, every: 0.09 } }, // three stings
    ],
    death: [
      { src: 'tone', wave: 'sawtooth', f0: 300, f1: 60, dur: 0.5, gain: 0.2, cutoff: 1800, vibrato: { rate: 40, depth: 50 } },
    ],
  },

  hooks: {},
};

export default hornet;
registerSpecies(hornet);
