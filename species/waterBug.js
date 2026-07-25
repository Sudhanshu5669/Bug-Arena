// Giant Water Bug — "toe-biter". It grips prey with raptorial forelegs, injects
// digestive enzymes, and drinks the animal out of its own shell. It takes fish and
// frogs several times its size this way.
//
// Mechanically that's a GRAPPLE: it locks one target down, pours damage into it
// over several seconds, and heals off every tick of it. Nothing else in the game
// converts a single held target into sustain like this — which makes it brutal
// one-on-one and mediocre against a squad that just walks around it.

import { registerSpecies } from './registry.js';

const LIQUEFY = {
  TRIGGER_CHANCE: 0.36,
  COOLDOWN_SECONDS: 9.5,
  GRIP_SECONDS: 3.4,
  DAMAGE_PER_SECOND: 15, // heavy, but it's spread over the whole grip
  INITIAL: 10,
  DRAIN_PER_SECOND: 9, // what the water bug drinks back each second
  GRIP_SLOW: 0.15, // the victim is held, not rooted — it can barely crawl
};

const waterBug = {
  id: 'waterBug',
  name: 'Giant Water Bug',
  tier: 'champion',
  flavor:
    'Grips, injects, and drinks its prey out of its own shell. It regularly does this to things much bigger than itself.',

  stats: {
    maxHealth: 208,
    speed: 1.35, // ponderous on land
    size: 14,
    damage: 8,
    attackRange: 26, // long raptorial forelegs
    attackCooldown: 44,
    visionRange: 225,
  },

  visual: {
    type: 'sprite',
    sprite: 'waterBug',
    spriteExt: 'svg',
    spriteScale: 2.9,
    spriteFacing: 'up',
    shape: 'ellipse',
    color: '#6b5b3e',
    stroke: '#241d10',
    size: 14,
  },

  ability: {
    name: 'Liquefy',
    description:
      'Locks the target in its forelegs and digests it alive — draining health straight back into itself.',
    triggerChance: LIQUEFY.TRIGGER_CHANCE,
    cooldownSeconds: LIQUEFY.COOLDOWN_SECONDS,
    telegraphColor: '#c2b280',
    requiresTarget: true,
    log: (self, target) => `${self.species.name} has ${target.species.name} in its grip — digesting!`,
    onTrigger(self, target, ctx) {
      if (!target || !target.alive) return {};

      ctx.dealDamage(target, LIQUEFY.INITIAL, { sourceAgent: self, cause: 'liquefy' });

      // The victim's side: a heavy damage-over-time it cannot walk out of quickly.
      ctx.applyStatus(
        target,
        {
          type: 'digested',
          label: 'Digested',
          duration: ctx.seconds(LIQUEFY.GRIP_SECONDS),
          damagePerSecond: LIQUEFY.DAMAGE_PER_SECOND,
          speedMultiplier: LIQUEFY.GRIP_SLOW,
          preventHeal: true, // it's being dissolved; nothing is closing
        },
        self
      );

      // The bug's side: a feeding window ticked down in `on_tick` below. Storing
      // the ticks on memory keeps the drain independent of whether the ORIGINAL
      // victim survives — it's drinking what it already took.
      self.memory.feedTicks = ctx.seconds(LIQUEFY.GRIP_SECONDS);
      ctx.applyStatus(
        self,
        { type: 'gorging', label: 'Gorging', duration: ctx.seconds(LIQUEFY.GRIP_SECONDS) },
        self
      );

      ctx.spawnEffect({
        kind: 'acid',
        x: target.x,
        y: target.y,
        team: self.team,
      });
      return { gripped: true };
    },
  },

  hooks: {
    on_tick(self, ctx) {
      if (!(self.memory.feedTicks > 0)) return;
      self.memory.feedTicks -= 1;
      ctx.heal(self, LIQUEFY.DRAIN_PER_SECOND / ctx.config.tickRate);
    },
  },

  // Wet and awful — suction, and something dissolving.
  sfx: {
    attack: [{ src: 'noise', filter: 'lowpass', f0: 1100, f1: 420, dur: 0.05, gain: 0.2 }],
    ability: [
      { src: 'tone', wave: 'sine', f0: 60, f1: 180, dur: 0.4, gain: 0.26 }, // the grip closing
      { src: 'noise', filter: 'bandpass', f0: 700, f1: 2200, q: 1.5, dur: 0.6, gain: 0.24, t0: 0.1 },
    ],
    death: [
      { src: 'tone', wave: 'sine', f0: 200, f1: 45, dur: 0.34, gain: 0.28 },
      { src: 'noise', filter: 'lowpass', f0: 900, f1: 200, dur: 0.4, gain: 0.2, t0: 0.08 },
    ],
  },
};

export default waterBug;
registerSpecies(waterBug);
