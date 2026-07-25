// Dracula Ant — the sustain unit. Real Dracula ants practise "social
// hemolymph feeding": they chew holes in their own larvae and drink from them.
// Here it's turned outward — for a few seconds every bite it lands feeds it.
//
// It's the only true LIFESTEAL in the game. The Assassin Bug's drain is a single
// burst; this is a window during which an ordinary ant out-sustains the damage
// coming back at it. Left alone in a brawl it can win fights it should have lost.

import { registerSpecies } from './registry.js';

const FEED = {
  TRIGGER_CHANCE: 0.34,
  COOLDOWN_SECONDS: 9,
  // Tuned down from 4.5s / 0.85: paired with a 30-tick attack interval, that let
  // it out-heal incoming damage outright rather than merely surviving longer.
  DURATION_SECONDS: 3.5,
  LIFESTEAL: 0.55, // fraction of each hit's damage returned as healing
  OPENING_BITE: 7, // the proc itself draws blood immediately
};

const draculaAnt = {
  id: 'draculaAnt',
  name: 'Dracula Ant',
  tier: 'soldier',
  flavor:
    'Chews a hole and drinks. For a few seconds after it tastes blood, every bite it lands heals it.',

  stats: {
    maxHealth: 68,
    speed: 1.85,
    size: 8,
    damage: 6,
    attackRange: 16,
    attackCooldown: 30, // fast bites — lifesteal scales with hits landed, not hit size
    visionRange: 220,
  },

  visual: {
    type: 'sprite',
    sprite: 'draculaAnt',
    spriteExt: 'svg',
    spriteScale: 2.2,
    spriteFacing: 'up',
    shape: 'ellipse',
    color: '#8e2f4a',
    stroke: '#2b0a13',
    size: 8,
  },

  ability: {
    name: 'Blood Feed',
    description: 'Opens a wound and starts drinking — for a few seconds, every bite it lands heals it.',
    triggerChance: FEED.TRIGGER_CHANCE,
    cooldownSeconds: FEED.COOLDOWN_SECONDS,
    telegraphColor: '#ff6b8a',
    requiresTarget: true,
    log: (self) => `${self.species.name} tasted blood — it's feeding!`,
    onTrigger(self, target, ctx) {
      if (target?.alive) {
        ctx.dealDamage(target, FEED.OPENING_BITE, { sourceAgent: self, cause: 'feed' });
      }

      // The window is tracked on `memory` (a tick count) rather than read back off
      // the status, so `on_attack` stays a cheap counter check instead of a scan
      // through the status list on every single bite.
      self.memory.feedTicks = ctx.seconds(FEED.DURATION_SECONDS);

      ctx.applyStatus(
        self,
        {
          type: 'feeding',
          label: 'Feeding',
          duration: ctx.seconds(FEED.DURATION_SECONDS),
        },
        self
      );

      ctx.spawnEffect({ kind: 'drain', x: self.x, y: self.y, team: self.team });
      return { fed: true };
    },
  },

  hooks: {
    // Tick the window down here (not in on_attack) so it expires on schedule even
    // if the ant spends the whole duration chasing something it never catches.
    on_tick(self) {
      if (self.memory.feedTicks > 0) self.memory.feedTicks -= 1;
    },

    // The lifesteal itself. Base weapon damage has already been applied by the
    // engine at this point, so healing off `stats.damage` matches what landed.
    on_attack(self, target, ctx) {
      if (!(self.memory.feedTicks > 0)) return;
      const healed = self.stats.damage * self.damageDealtMultiplier * FEED.LIFESTEAL;
      if (healed > 0) ctx.heal(self, healed);
    },
  },

  // Wet, close, and unpleasant — a soft puncture and a draw.
  sfx: {
    attack: [{ src: 'noise', filter: 'bandpass', f0: 1200, f1: 600, q: 5, dur: 0.04, gain: 0.16 }],
    ability: [
      { src: 'tone', wave: 'sine', f0: 90, f1: 240, dur: 0.3, gain: 0.24 }, // the draw
      { src: 'noise', filter: 'lowpass', f0: 800, f1: 300, dur: 0.36, gain: 0.2, t0: 0.05 },
    ],
    death: [{ src: 'tone', wave: 'sine', f0: 280, f1: 60, dur: 0.18, gain: 0.22 }],
  },
};

export default draculaAnt;
registerSpecies(draculaAnt);
