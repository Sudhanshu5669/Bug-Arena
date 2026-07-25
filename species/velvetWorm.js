// Velvet Worm — an animal that hunts by shooting glue. Two nozzles either side of
// its head oscillate rapidly and throw jets of adhesive slime in a spreading
// zig-zag, which sets in seconds and leaves the prey completely stuck.
//
// The Spider webs one target and the Spitter glues one target; this is the only
// ability that ROOTS A WHOLE CONE at once. It doesn't do meaningful damage — its
// entire job is to freeze a line of advancing ants so somebody else can kill them.

import { registerSpecies } from './registry.js';

const SLIME = {
  TRIGGER_CHANCE: 0.4,
  COOLDOWN_SECONDS: 9,
  WINDUP_SECONDS: 0.3, // the nozzles start oscillating before anything comes out
  RANGE: 155,
  HALF_ANGLE: 0.85, // radians (~49°) — a wide spray, matching the real zig-zag
  DAMAGE: 15, // raised from 7 — see the stat note below
  ROOT_SECONDS: 2.6,
  SET_SECONDS: 4.2, // after the root breaks, the residue still slows them
  SET_SLOW: 0.5,
};

const velvetWorm = {
  id: 'velvetWorm',
  name: 'Velvet Worm',
  tier: 'champion',
  flavor:
    'Hunts with glue. Two nozzles whip back and forth and lay a spreading net of adhesive that sets hard in seconds.',

  stats: {
    // A champion that only roots things loses to every champion that kills things:
    // at 7 damage it won 7% of its matchups. It is still the worst duellist in the
    // tier — it just no longer needs an escort to accomplish anything at all.
    maxHealth: 158,
    speed: 1.45, // it is, fundamentally, a worm
    size: 12,
    damage: 10,
    attackRange: 23,
    attackCooldown: 40,
    visionRange: 230,
  },

  visual: {
    type: 'sprite',
    sprite: 'velvetWorm',
    spriteExt: 'svg',
    spriteScale: 2.8,
    spriteFacing: 'up',
    shape: 'ellipse',
    color: '#3f7d8c',
    stroke: '#122c33',
    size: 12,
  },

  ability: {
    name: 'Slime Net',
    description:
      'Throws a spreading net of adhesive across everything in front of it — the whole line sets fast and stops moving.',
    triggerChance: SLIME.TRIGGER_CHANCE,
    cooldownSeconds: SLIME.COOLDOWN_SECONDS,
    windupSeconds: SLIME.WINDUP_SECONDS,
    telegraphColor: '#7fe3f5',
    requiresTarget: false, // a directional spray — it fires whether or not they flee
    log: (self, target, res) => {
      const n = res?.caught ?? 0;
      return n > 1
        ? `${self.species.name} glued ${n} of them to the ground!`
        : `${self.species.name} threw a net of slime.`;
    },
    onTrigger(self, target, ctx) {
      // Fire along the committed heading, or at the live target if it's still there.
      let dirX = Math.cos(self.angle);
      let dirY = Math.sin(self.angle);
      if (target) {
        const dx = target.x - self.x;
        const dy = target.y - self.y;
        const d = Math.hypot(dx, dy) || 1;
        dirX = dx / d;
        dirY = dy / d;
      }

      const caught = ctx.enemiesInCone(self, dirX, dirY, SLIME.RANGE, SLIME.HALF_ANGLE);
      for (const enemy of caught) {
        ctx.dealDamage(enemy, SLIME.DAMAGE, { sourceAgent: self, cause: 'slime' });
        // Rooted, but NOT silenced — anything in reach can still bite back. A cone
        // this wide with a full lockdown would simply end fights on cast.
        ctx.applyStatus(
          enemy,
          {
            type: 'glued',
            label: 'Glued',
            duration: ctx.seconds(SLIME.ROOT_SECONDS),
            preventMove: true,
            speedMultiplier: 0,
          },
          self
        );
        ctx.applyStatus(
          enemy,
          {
            type: 'tacky',
            label: 'Tacky',
            duration: ctx.seconds(SLIME.SET_SECONDS),
            speedMultiplier: SLIME.SET_SLOW,
          },
          self
        );
      }

      ctx.spawnEffect({
        kind: 'web_splash',
        x: self.x,
        y: self.y,
        dirX,
        dirY,
        radius: SLIME.RANGE,
        halfAngle: SLIME.HALF_ANGLE,
        team: self.team,
      });

      return { caught: caught.length };
    },
  },

  // Wet, stringy, and rhythmic — the oscillating nozzles are audible.
  sfx: {
    attack: [{ src: 'noise', filter: 'lowpass', f0: 1000, f1: 400, dur: 0.045, gain: 0.17 }],
    ability: [
      { src: 'noise', filter: 'bandpass', f0: 600, f1: 2600, q: 2, dur: 0.34, gain: 0.3 },
      { src: 'tone', wave: 'sine', f0: 320, f1: 140, dur: 0.3, gain: 0.18, t0: 0.05 },
    ],
    death: [{ src: 'tone', wave: 'sine', f0: 240, f1: 55, dur: 0.28, gain: 0.24 }],
  },

  hooks: {},
};

export default velvetWorm;
registerSpecies(velvetWorm);
