// Camel Spider (solifuge) — neither spider nor scorpion. It carries the largest
// jaws relative to body size of any arachnid: four independently moving chelicerae
// that work like shears and never stop once they start.
//
// Every other burst ability in the game is one big hit. This is the opposite — it
// doesn't hit harder, it hits FAR more often, for a few seconds. That makes it the
// only champion whose damage scales with how long it can stay in contact, and the
// only one that directly manipulates its own attack speed.

import { registerSpecies } from './registry.js';

const FRENZY = {
  TRIGGER_CHANCE: 0.4,
  COOLDOWN_SECONDS: 10,
  DURATION_SECONDS: 4,
  COOLDOWN_DIVISOR: 3.2, // attack interval divided by this — it shears ~3x as fast
  DAMAGE_MULTIPLIER: 0.78, // each individual bite is weaker, so it isn't a flat 3x
  SPEED: 1.35, // and it closes faster, to actually make use of the window
};

const solifuge = {
  id: 'solifuge',
  name: 'Camel Spider',
  tier: 'champion',
  flavor:
    'Four independently moving jaws that work like shears. Once they start they do not stop, and they do not slow down.',

  stats: {
    maxHealth: 152,
    speed: 2.7, // genuinely fast — the real animal is famous for it
    size: 12,
    damage: 9,
    attackRange: 22,
    attackCooldown: 34,
    visionRange: 265,
  },

  visual: {
    type: 'sprite',
    sprite: 'solifuge',
    spriteExt: 'svg',
    spriteScale: 2.8,
    spriteFacing: 'up',
    shape: 'ellipse',
    color: '#d9a066',
    stroke: '#3d2410',
    size: 12,
  },

  ability: {
    name: 'Shearing Frenzy',
    description:
      'The jaws open up and do not stop — it attacks roughly three times as fast for a few brutal seconds.',
    triggerChance: FRENZY.TRIGGER_CHANCE,
    cooldownSeconds: FRENZY.COOLDOWN_SECONDS,
    telegraphColor: '#ffc48a',
    requiresTarget: false,
    log: (self) => `${self.species.name} went into a shearing frenzy!`,
    onTrigger(self, target, ctx) {
      // Already frenzied: refresh the window rather than stacking the stat change,
      // which would otherwise compound toward a 1-tick attack interval.
      if (self.memory.frenzyTicks > 0) {
        self.memory.frenzyTicks = ctx.seconds(FRENZY.DURATION_SECONDS);
        return { refreshed: true };
      }

      // `agent.stats` is a per-agent copy (see Agent's constructor), so mutating it
      // here is safe — it never touches the shared species config. The originals are
      // stashed for `on_tick` to put back.
      self.memory.baseAttackCooldown = self.stats.attackCooldown;
      self.stats.attackCooldown = Math.max(
        1,
        Math.round(self.stats.attackCooldown / FRENZY.COOLDOWN_DIVISOR)
      );
      self.memory.frenzyTicks = ctx.seconds(FRENZY.DURATION_SECONDS);

      ctx.applyStatus(
        self,
        {
          type: 'frenzied',
          label: 'Frenzied',
          duration: ctx.seconds(FRENZY.DURATION_SECONDS),
          damageDealtMultiplier: FRENZY.DAMAGE_MULTIPLIER,
          speedMultiplier: FRENZY.SPEED,
        },
        self
      );

      ctx.spawnEffect({ kind: 'enrage', x: self.x, y: self.y, team: self.team });
      return { frenzied: true };
    },
  },

  hooks: {
    // Restore the attack interval when the window closes. This MUST run off the
    // memory counter rather than the status: a status can be overwritten or
    // refreshed by another source, and a missed restore leaves it permanently fast.
    on_tick(self) {
      if (!(self.memory.frenzyTicks > 0)) return;
      self.memory.frenzyTicks -= 1;
      if (self.memory.frenzyTicks === 0 && self.memory.baseAttackCooldown != null) {
        self.stats.attackCooldown = self.memory.baseAttackCooldown;
        self.memory.baseAttackCooldown = null;
      }
    },
  },

  // Fast, dry, and mechanical — like scissors that will not stop.
  sfx: {
    attack: [{ src: 'noise', filter: 'bandpass', f0: 2800, f1: 1600, q: 9, dur: 0.026, gain: 0.17 }],
    ability: [
      { src: 'noise', filter: 'bandpass', f0: 2400, f1: 3600, q: 6, dur: 0.05, gain: 0.26 },
      { src: 'noise', filter: 'bandpass', f0: 2400, f1: 3600, q: 6, dur: 0.05, gain: 0.24, t0: 0.07 },
      { src: 'noise', filter: 'bandpass', f0: 2400, f1: 3600, q: 6, dur: 0.05, gain: 0.22, t0: 0.14 },
      { src: 'tone', wave: 'sawtooth', f0: 260, f1: 420, dur: 0.34, gain: 0.14, cutoff: 1200 },
    ],
    death: [{ src: 'tone', wave: 'sine', f0: 260, f1: 58, dur: 0.26, gain: 0.24 }],
  },
};

export default solifuge;
registerSpecies(solifuge);
