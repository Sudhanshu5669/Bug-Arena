// Tarantula Hawk — the specialist. It doesn't kill spiders, it PARALYSES them,
// drags the still-living body to a burrow, and lays an egg in it. The sting is
// rated among the most painful of any insect, and the victim stays awake for all
// of it.
//
// So this is the game's only TOTAL lockdown: the target cannot move and cannot
// swing, full stop, and takes extra damage the whole time. Any other hard CC in
// the roster leaves you one of the two. The cost is that it's aimed at exactly one
// bug — against a squad it removes a single unit and nothing else.

import { registerSpecies } from './registry.js';

const STING = {
  TRIGGER_CHANCE: 0.34,
  COOLDOWN_SECONDS: 12, // the longest cooldown in the game — it's the strongest CC
  WINDUP_SECONDS: 0.45, // a long, readable telegraph: it hovers, then commits
  PARALYSIS_SECONDS: 3.2,
  VULNERABILITY: 1.45, // helpless things are easier to hurt
  DAMAGE: 16,
};

const tarantulaHawk = {
  id: 'tarantulaHawk',
  name: 'Tarantula Hawk',
  tier: 'champion',
  flavor:
    'Does not kill what it stings. The victim stays perfectly conscious and perfectly unable to move, which is the point.',

  stats: {
    maxHealth: 132, // fragile for a champion; it must not be a brawler too
    speed: 3.0, // second only to the hornet — it closes on whatever it picks
    size: 11,
    damage: 9,
    attackRange: 22,
    attackCooldown: 30,
    visionRange: 290,
  },

  visual: {
    type: 'sprite',
    sprite: 'tarantulaHawk',
    spriteExt: 'svg',
    spriteScale: 2.7,
    spriteFacing: 'up',
    shape: 'polygon',
    color: '#1b1b2f', // blue-black body, rust wings
    stroke: '#0a0a14',
    size: 11,
  },

  ability: {
    name: 'Paralytic Sting',
    description:
      'Drives in a sting that shuts the body down completely — awake, aware, and unable to do anything about it.',
    triggerChance: STING.TRIGGER_CHANCE,
    cooldownSeconds: STING.COOLDOWN_SECONDS,
    windupSeconds: STING.WINDUP_SECONDS,
    telegraphColor: '#ff7a1a',
    requiresTarget: true,
    log: (self, target) => `${self.species.name} paralysed ${target.species.name}!`,
    onTrigger(self, target, ctx) {
      if (!target || !target.alive) return {};

      ctx.dealDamage(target, STING.DAMAGE, { sourceAgent: self, cause: 'sting' });
      if (!target.alive) return { killed: true };

      ctx.applyStatus(
        target,
        {
          type: 'paralysed',
          label: 'Paralysed',
          duration: ctx.seconds(STING.PARALYSIS_SECONDS),
          preventMove: true,
          preventAttack: true, // both — this is the only ability that takes everything
          speedMultiplier: 0,
          damageTakenMultiplier: STING.VULNERABILITY,
        },
        self
      );

      ctx.spawnEffect({ kind: 'venom', x: target.x, y: target.y, team: self.team });
      return { paralysed: true };
    },
  },

  // A hard wingbeat and a sting that lands like a needle in a drum.
  sfx: {
    attack: [{ src: 'noise', filter: 'bandpass', f0: 1900, f1: 1100, q: 7, dur: 0.035, gain: 0.2 }],
    ability: [
      { src: 'tone', wave: 'sawtooth', f0: 160, f1: 90, dur: 0.3, gain: 0.22, cutoff: 800 }, // the hover
      { src: 'tone', wave: 'sine', f0: 1400, f1: 380, dur: 0.24, gain: 0.3, t0: 0.12 }, // the sting
      { src: 'noise', filter: 'highpass', f0: 3000, dur: 0.2, gain: 0.16, t0: 0.14 },
    ],
    death: [
      { src: 'tone', wave: 'sawtooth', f0: 240, f1: 60, dur: 0.28, gain: 0.26, cutoff: 900 },
      { src: 'noise', filter: 'bandpass', f0: 1800, f1: 500, q: 3, dur: 0.3, gain: 0.18, t0: 0.06 },
    ],
  },

  hooks: {},
};

export default tarantulaHawk;
registerSpecies(tarantulaHawk);
