// Hercules Beetle — the juggernaut. An innate armoured carapace makes it the
// hardest thing on the sand to kill, and its horn can scoop a foe up and hurl it
// clean across the arena. The catch is that it is ponderously slow and half
// blind: it can win any fight it reaches, and it struggles to reach any fight.

import { registerSpecies } from './registry.js';

// --- passive tuning: Iron Carapace --------------------------------------------
const CARAPACE = {
  DAMAGE_TAKEN: 0.7, // 30% off every source of damage, permanently
};

// --- ability tuning: Horn Toss -------------------------------------------------
const TOSS = {
  TRIGGER_CHANCE: 0.4,
  COOLDOWN_SECONDS: 7,
  WINDUP_SECONDS: 0.3, // it drops its head and braces
  DAMAGE: 19,
  DISTANCE: 120, // how far the victim sails
  STAGGER_SECONDS: 1.2, // and how long it lies there afterwards
};

const beetle = {
  id: 'beetle',
  name: 'Hercules Beetle',
  tier: 'champion',
  flavor:
    'An armoured tank on six legs. Nothing hits it harder than it can shrug off — if it can ever catch you.',

  stats: {
    maxHealth: 260, // the toughest unit in the game, before armour even applies
    speed: 1.0, // by far the slowest champion — the core drawback
    size: 15, // and the biggest target on the field
    damage: 12,
    attackRange: 26,
    attackCooldown: 62, // ticks (~1.03s) — heavy, deliberate swings
    visionRange: 200, // poor eyesight: it often doesn't notice a fight at all
  },

  visual: {
    type: 'sprite',
    sprite: 'beetle',
    spriteExt: 'svg',
    spriteScale: 2.9,
    spriteFacing: 'up',
    shape: 'polygon',
    color: '#4a3b2a', // dark chitin brown
    stroke: '#181008',
    size: 15,
  },

  // --- signature ability: Horn Toss (single-target displacement + hard stun) ---
  ability: {
    name: 'Horn Toss',
    description: 'Scoops the target on its horn and hurls it across the arena, leaving it sprawled.',
    triggerChance: TOSS.TRIGGER_CHANCE,
    cooldownSeconds: TOSS.COOLDOWN_SECONDS,
    windupSeconds: TOSS.WINDUP_SECONDS,
    telegraphColor: '#e8c98a',
    log: (self, target) => `${self.species.name} hurled ${target.species.name} across the sand!`,
    onTrigger(self, target, ctx) {
      const dx = target.x - self.x;
      const dy = target.y - self.y;
      const d = Math.hypot(dx, dy) || 1;

      ctx.dealDamage(target, TOSS.DAMAGE, { sourceAgent: self, cause: 'toss' });
      if (!target.alive) return;

      // Straight up and away from the beetle.
      const flight = ctx.push(target, dx / d, dy / d, TOSS.DISTANCE);
      ctx.applyStatus(
        target,
        {
          type: 'stagger',
          label: 'Sprawled',
          duration: ctx.seconds(TOSS.STAGGER_SECONDS),
          speedMultiplier: 0,
          preventMove: true,
          preventAttack: true,
        },
        self
      );
      // An arcing throw line so the flight actually reads on screen.
      ctx.spawnEffect({
        kind: 'toss',
        x1: flight.fromX,
        y1: flight.fromY,
        x2: flight.x,
        y2: flight.y,
      });
    },
  },

  // Deep, woody, and heavy — every sound it makes has mass behind it.
  sfx: {
    attack: [
      { src: 'tone', wave: 'sine', f0: 90, f1: 45, dur: 0.16, gain: 0.32 },
      { src: 'noise', filter: 'lowpass', f0: 900, f1: 250, dur: 0.08, gain: 0.28 },
    ],
    ability: [
      { src: 'tone', wave: 'sawtooth', f0: 112, f1: 72, dur: 0.32, gain: 0.2, cutoff: 700 }, // the bellow
      { src: 'noise', filter: 'bandpass', f0: 500, f1: 2800, q: 1.2, dur: 0.28, gain: 0.3, t0: 0.06 }, // the heave
    ],
    death: [
      { src: 'noise', filter: 'lowpass', f0: 1400, f1: 160, dur: 0.45, gain: 0.38 },
      { src: 'tone', wave: 'sine', f0: 72, f1: 34, dur: 0.5, gain: 0.24 },
    ],
  },

  hooks: {
    /** Iron Carapace: an innate, permanent damage reduction, applied at spawn. */
    on_spawn(self, ctx) {
      ctx.applyStatus(
        self,
        {
          type: 'carapace',
          label: 'Iron Carapace',
          duration: ctx.config.maxTicks + 100, // outlives any battle
          damageTakenMultiplier: CARAPACE.DAMAGE_TAKEN,
          permanent: true, // an innate trait: shown without a countdown
        },
        self
      );
    },
  },
};

export default beetle;
registerSpecies(beetle);
