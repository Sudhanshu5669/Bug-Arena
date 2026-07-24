// Scorpion — a patient chip-damage bug. Its tail sting drips venom that wears an
// opponent down over time. But the sting must be CHARGED: during that wind-up the
// scorpion is committed and vulnerable, so a quick foe can catch it mid-strike.
// It prefers to pick off lone ants and bugs, wading into a horde only when it must.

import { registerSpecies } from './registry.js';

// --- ability tuning (easy to find + tweak) -----------------------------------
const STING = {
  TRIGGER_CHANCE: 0.5, // stings often — chipping is its whole game
  COOLDOWN_SECONDS: 3,
  WINDUP_SECONDS: 0.45, // the charge — its window of vulnerability
  BONUS_DAMAGE: 8, // the sting's bite on top of the venom
  VENOM_SECONDS: 4, // lingering damage-over-time
  VENOM_PER_SECOND: 9, // ~36 total chip per sting — steady wear, not a delete
};

const scorpion = {
  id: 'scorpion',
  name: 'Scorpion',
  tier: 'champion',
  flavor: 'A patient venom-dealer. It charges a tail sting to chip prey down — and is open to a counter mid-charge.',

  // Bug behaviour, but it hunts the loneliest target it can find first.
  ai: {
    targetPreference: 'isolated',
  },

  stats: {
    maxHealth: 175, // bug-tier bulk, well above any ant
    speed: 1.7,
    size: 13,
    damage: 6, // modest base bite — the damage is in the venom
    attackRange: 24, // tail reach
    attackCooldown: 35,
    visionRange: 260,
  },

  // Rendered straight from its source SVG (assets/sprites/src/scorpion.svg);
  // the shape fields below are the fallback if the art fails to load.
  visual: {
    type: 'sprite',
    sprite: 'scorpion',
    spriteExt: 'svg',
    spriteScale: 2.8,
    spriteFacing: 'up',
    shape: 'polygon',
    color: '#b5892b', // sandy amber, distinct from the purple spider
    stroke: '#4a3410',
    size: 13,
  },

  // --- signature ability: Venom Sting (wind-up → burst + damage-over-time) -----
  ability: {
    name: 'Venom Sting',
    description: 'Charges a tail sting that bites and injects a lasting venom.',
    triggerChance: STING.TRIGGER_CHANCE,
    cooldownSeconds: STING.COOLDOWN_SECONDS,
    windupSeconds: STING.WINDUP_SECONDS, // the charge — catchable mid-sting
    telegraphColor: '#d7c23a',
    log: (self, target) => `${self.species.name} stung ${target.species.name} — venom sets in!`,
    onTrigger(self, target, ctx) {
      ctx.dealDamage(target, STING.BONUS_DAMAGE, { sourceAgent: self, cause: 'sting' });
      ctx.applyStatus(
        target,
        {
          type: 'poison',
          label: 'Envenomed',
          duration: ctx.seconds(STING.VENOM_SECONDS),
          damagePerSecond: STING.VENOM_PER_SECOND,
        },
        self
      );
      ctx.spawnEffect({ kind: 'venom', x: target.x, y: target.y, radius: target.stats.size + 6 });
    },
  },

  // Sound signature: hard pincer clacks, then the whip and hiss of the sting.
  sfx: {
    attack: [{ src: 'noise', filter: 'bandpass', f0: 1800, f1: 900, q: 12, dur: 0.045, gain: 0.26 }],
    ability: [
      { src: 'tone', wave: 'square', f0: 180, f1: 1500, dur: 0.13, gain: 0.13, cutoff: 2200 }, // the tail whip
      { src: 'noise', filter: 'bandpass', f0: 3000, f1: 1200, q: 5, dur: 0.3, gain: 0.22, t0: 0.1 }, // venom
    ],
    death: [{ src: 'noise', filter: 'lowpass', f0: 1100, f1: 200, dur: 0.28, gain: 0.32 }],
  },

  hooks: {},
};

export default scorpion;
registerSpecies(scorpion);
