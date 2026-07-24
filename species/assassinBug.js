// Assassin Bug — the finisher. Its proboscis does ordinary damage to a healthy
// target and horrific damage to a hurt one, and it drinks back a share of
// everything it deals. Send it at a wounded champion and it removes it from the
// board while healing itself to full.
//
// Its whole design is "second in": it is the frailest champion in the game and it
// wants no part of an even fight. Against something at full health it is simply a
// mediocre bug with a bad health pool.

import { registerSpecies } from './registry.js';

// --- ability tuning (easy to find + tweak) -----------------------------------
const INJECT = {
  TRIGGER_CHANCE: 0.4,
  COOLDOWN_SECONDS: 6.5,
  BASE_DAMAGE: 10, // what it does to something at full health
  EXECUTE_BONUS: 46, // ...scaled by how much health the target is MISSING
  DRAIN_FRACTION: 0.45, // share of the damage it drinks back
};

// --- passive tuning: Sanguine -------------------------------------------------
const DRAIN = {
  FRACTION: 0.3, // ordinary bites also feed it, at a lower rate
};

const assassinBug = {
  id: 'assassinBug',
  name: 'Assassin Bug',
  tier: 'champion',
  flavor:
    'Harmless to the healthy and lethal to the hurt. It finishes what something else started, and drinks the difference.',

  // It hunts stragglers rather than fronts — the loneliest enemy is usually also
  // the most wounded one.
  ai: {
    targetPreference: 'isolated',
  },

  stats: {
    maxHealth: 112, // the frailest champion on the field
    speed: 2.4,
    size: 11,
    damage: 9,
    attackRange: 22,
    attackCooldown: 32,
    visionRange: 275,
  },

  visual: {
    type: 'sprite',
    sprite: 'assassinBug',
    spriteExt: 'svg',
    spriteScale: 2.8,
    spriteFacing: 'up',
    shape: 'diamond',
    color: '#a01b3f', // blood red
    stroke: '#2c0410',
    size: 11,
  },

  // --- signature ability: Lethal Injection (execute + drain) ------------------
  ability: {
    name: 'Lethal Injection',
    description:
      "Drives its proboscis home — devastating against a wounded target, and it drinks back what it deals.",
    triggerChance: INJECT.TRIGGER_CHANCE,
    cooldownSeconds: INJECT.COOLDOWN_SECONDS,
    telegraphColor: '#ff5a7a',
    log: (self, target, dealt) =>
      `${self.species.name} drained ${target.species.name} for ${Math.round(dealt ?? 0)}!`,
    onTrigger(self, target, ctx) {
      // Scale with MISSING health: ~0 bonus at full, full bonus at death's door.
      const missing = 1 - Math.max(0, Math.min(1, target.health / target.maxHealth));
      const damage = INJECT.BASE_DAMAGE + INJECT.EXECUTE_BONUS * missing;

      // Measure what actually landed so the drain can't exceed the target's health.
      const before = target.health;
      ctx.dealDamage(target, damage, { sourceAgent: self, cause: 'execute' });
      const dealt = Math.max(0, before - target.health);

      ctx.heal(self, dealt * INJECT.DRAIN_FRACTION);
      ctx.spawnEffect({ kind: 'drain', x1: target.x, y1: target.y, x2: self.x, y2: self.y });
      return dealt; // feeds the kill-feed line
    },
  },

  sfx: {
    attack: [
      { src: 'noise', filter: 'bandpass', f0: 2600, f1: 1500, q: 9, dur: 0.04, gain: 0.22 },
      { src: 'tone', wave: 'sine', f0: 420, f1: 220, dur: 0.06, gain: 0.12 },
    ],
    ability: [
      { src: 'tone', wave: 'sine', f0: 180, f1: 620, dur: 0.26, gain: 0.2 }, // the draw
      { src: 'noise', filter: 'bandpass', f0: 900, f1: 2600, q: 4, dur: 0.3, gain: 0.24, t0: 0.04 }, // the suck
      { src: 'tone', wave: 'triangle', f0: 700, f1: 300, dur: 0.2, gain: 0.12, t0: 0.2 },
    ],
    death: [{ src: 'noise', filter: 'lowpass', f0: 1300, f1: 240, dur: 0.26, gain: 0.3 }],
  },

  hooks: {
    /** Sanguine: even its ordinary bites feed it, at a lower rate than the injection. */
    on_attack(self, target, ctx) {
      ctx.heal(self, self.stats.damage * DRAIN.FRACTION);
    },
  },
};

export default assassinBug;
registerSpecies(assassinBug);
