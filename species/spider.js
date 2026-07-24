// Web Spider — control champion. A close-range ambusher whose signature ability
// snares its prey in a web, locking it down so the spider can bite freely.

import { registerSpecies } from './registry.js';

// --- ability tuning (easy to find + tweak) -----------------------------------
const WEB = {
  TRIGGER_CHANCE: 0.35, // 35% chance per attack (while off cooldown)
  COOLDOWN_SECONDS: 8, // long — an AoE snare is far stronger than a single-target one
  IMMOBILIZE_SECONDS: 3.5, // how long each caught bug is fully locked down
  SPLASH_RADIUS: 78, // a wide burst of webbing — everyone bunched near the hit is caught
  WINDUP_SECONDS: 0.28, // it rears up and gathers silk before loosing the burst
};

const spider = {
  id: 'spider',
  name: 'Web Spider',
  tier: 'champion', // squad-leading special unit
  flavor:
    'A patient ambusher. Snares its prey in a web, then bites at leisure while it struggles.',

  stats: {
    maxHealth: 200, // a hulking BUG — dwarfs any ant; soaks a whole squad's bites
    speed: 1.25,
    size: 11,
    damage: 4,
    attackRange: 30, // close-range bite (no more long-range "laser")
    attackCooldown: 45, // ticks (~0.75s)
    visionRange: 250,
  },

  visual: {
    type: 'sprite',
    sprite: 'spider',
    spriteScale: 2.9,
    spriteFacing: 'up',
    shape: 'diamond',
    color: '#9b5de5',
    stroke: '#3a1a5e',
    size: 11,
  },

  // --- signature ability: Web Trap (control / AoE status effect) --------------
  ability: {
    name: 'Web Trap',
    description:
      'Bursts a wide web over the target, immobilizing it and every enemy bunched around it.',
    triggerChance: WEB.TRIGGER_CHANCE,
    cooldownSeconds: WEB.COOLDOWN_SECONDS,
    // Telegraph: the spider rears and gathers silk before the burst (see engine cast).
    windupSeconds: WEB.WINDUP_SECONDS,
    telegraphColor: '#c9a8ff',
    log: (self, target, victims) => {
      const n = victims?.length ?? 1;
      return n > 1
        ? `${self.species.name} webbed ${n} foes in one burst!`
        : `${self.species.name} webbed ${target.species.name}!`;
    },
    onTrigger(self, target, ctx) {
      // The web bursts over the TARGET; anyone clustered within SPLASH_RADIUS of
      // it is caught too. Full immobilize: no move, no attack — but still damageable,
      // and now the spider can lock down a whole knot of attackers at once.
      const victims = ctx
        .enemiesOf(self)
        .filter((e) => ctx.distance(e, target) <= WEB.SPLASH_RADIUS);
      if (!victims.includes(target)) victims.push(target); // the epicentre is always caught

      for (const v of victims) {
        ctx.applyStatus(
          v,
          {
            type: 'web',
            label: 'Webbed',
            duration: ctx.seconds(WEB.IMMOBILIZE_SECONDS),
            speedMultiplier: 0,
            preventMove: true,
            preventAttack: true,
          },
          self
        );
        // Strands shoot from the spider to each caught bug and fade fast (not a beam).
        ctx.spawnEffect({
          kind: 'web_cast',
          x1: self.x,
          y1: self.y,
          x2: v.x,
          y2: v.y,
          targetId: v.id,
        });
      }
      // The splash itself: a wide net that flashes over the whole caught area.
      ctx.spawnEffect({ kind: 'web_splash', x: target.x, y: target.y, radius: WEB.SPLASH_RADIUS });

      // Hand the caught list back so the kill-feed line can read "webbed N foes".
      return victims;
    },
  },

  // Sound signature: fine chittering, and a taut "thwip" when silk goes out.
  sfx: {
    attack: [
      { src: 'noise', filter: 'bandpass', f0: 3600, f1: 2200, q: 9, dur: 0.04, gain: 0.24, repeat: { times: 2, every: 0.045 } },
    ],
    ability: [
      { src: 'noise', filter: 'bandpass', f0: 800, f1: 5200, q: 3, dur: 0.17, gain: 0.3 }, // silk paying out
      { src: 'tone', wave: 'sine', f0: 900, f1: 2400, dur: 0.15, gain: 0.1 },
    ],
    death: [{ src: 'noise', filter: 'lowpass', f0: 1400, f1: 250, dur: 0.26, gain: 0.3 }],
  },

  hooks: {},
};

export default spider;
registerSpecies(spider);
