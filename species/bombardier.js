// Bombardier Beetle — the artillery piece. It brews a boiling chemical charge and
// sprays it in a scalding cone, which is the single best answer to a packed
// formation in the game. It is also the only unit whose signature ability
// genuinely hurts itself: the reaction chamber scalds it on every shot and leaves
// it overheated and fragile while it cools.

import { registerSpecies } from './registry.js';

// --- ability tuning (easy to find + tweak) -----------------------------------
const BLAST = {
  TRIGGER_CHANCE: 0.45,
  COOLDOWN_SECONDS: 6.5,
  WINDUP_SECONDS: 0.4, // the chamber builds pressure — it's committed and open
  RANGE: 135,
  HALF_ANGLE: 0.74, // radians (~42°) either side of its heading
  DAMAGE: 21,
  BURN_SECONDS: 3,
  BURN_PER_SECOND: 9,
  // The price of firing:
  SELF_DAMAGE: 8, // the chamber scalds it every single time
  OVERHEAT_SECONDS: 3,
  OVERHEAT_TAKEN: 1.35, // and it takes 35% more damage while it cools
};

const bombardier = {
  id: 'bombardier',
  name: 'Bombardier Beetle',
  tier: 'champion',
  flavor:
    'Brews a boiling chemical charge and sprays it in a scalding arc — cooking itself a little every time it fires.',

  stats: {
    maxHealth: 140, // the frailest beetle-shaped thing here: it cannot trade for long
    speed: 1.5,
    size: 12,
    damage: 7, // a modest bite; the artillery is the point
    attackRange: 24,
    attackCooldown: 40,
    visionRange: 245,
  },

  visual: {
    type: 'sprite',
    sprite: 'bombardier',
    spriteExt: 'svg',
    spriteScale: 2.8,
    spriteFacing: 'up',
    shape: 'polygon',
    color: '#d94f2b', // hot orange abdomen over dark plating
    stroke: '#2a1408',
    size: 12,
  },

  // --- signature ability: Chemical Blast (cone AoE + burn, with real recoil) ---
  ability: {
    name: 'Chemical Blast',
    description:
      'Sprays a boiling cone that scorches everything in front of it — and leaves the beetle overheated and vulnerable.',
    triggerChance: BLAST.TRIGGER_CHANCE,
    cooldownSeconds: BLAST.COOLDOWN_SECONDS,
    windupSeconds: BLAST.WINDUP_SECONDS,
    telegraphColor: '#c8ff6a',
    requiresTarget: false, // a direction-based spray: it fires even if the target flees
    log: (self, target, res) => {
      const n = res?.hit?.length ?? 0;
      return n > 1
        ? `${self.species.name} boiled ${n} foes in one blast!`
        : `${self.species.name} let loose a scalding blast!`;
    },
    onTrigger(self, target, ctx) {
      // Fire along the heading it committed to during the wind-up (the engine keeps
      // the body aimed), falling back to the live target if there still is one.
      let dirX = Math.cos(self.angle);
      let dirY = Math.sin(self.angle);
      if (target) {
        const dx = target.x - self.x;
        const dy = target.y - self.y;
        const d = Math.hypot(dx, dy) || 1;
        dirX = dx / d;
        dirY = dy / d;
      }

      const hit = ctx.enemiesInCone(self, dirX, dirY, BLAST.RANGE, BLAST.HALF_ANGLE);
      for (const enemy of hit) {
        ctx.dealDamage(enemy, BLAST.DAMAGE, { sourceAgent: self, cause: 'chemical_blast' });
        ctx.applyStatus(
          enemy,
          {
            type: 'burn',
            label: 'Scalded',
            duration: ctx.seconds(BLAST.BURN_SECONDS),
            damagePerSecond: BLAST.BURN_PER_SECOND,
          },
          self
        );
      }

      ctx.spawnEffect({
        kind: 'chemical_blast',
        x: self.x,
        y: self.y,
        dirX,
        dirY,
        radius: BLAST.RANGE,
        halfAngle: BLAST.HALF_ANGLE,
      });

      // The recoil. `sourceAgent: null` keeps a self-kill out of its own team's
      // kill count — it reads as "died to backblast", which is exactly right.
      ctx.dealDamage(self, BLAST.SELF_DAMAGE, { sourceAgent: null, cause: 'backblast' });
      if (self.alive) {
        ctx.applyStatus(
          self,
          {
            type: 'overheat',
            label: 'Overheated',
            duration: ctx.seconds(BLAST.OVERHEAT_SECONDS),
            damageTakenMultiplier: BLAST.OVERHEAT_TAKEN,
          },
          self
        );
      }

      return { hit };
    },
  },

  // Pressurised steam and hot gas — the blast is the loudest thing in the arena.
  sfx: {
    attack: [{ src: 'noise', filter: 'bandpass', f0: 1600, f1: 900, q: 8, dur: 0.04, gain: 0.24 }],
    ability: [
      { src: 'noise', filter: 'highpass', f0: 1200, f1: 6500, dur: 0.1, gain: 0.38, attack: 0.002 }, // the crack of release
      { src: 'noise', filter: 'bandpass', f0: 3000, f1: 600, q: 1, dur: 0.5, gain: 0.4 }, // the spray
      { src: 'tone', wave: 'sawtooth', f0: 220, f1: 58, dur: 0.32, gain: 0.16, cutoff: 900 }, // the chamber
      { src: 'noise', filter: 'highpass', f0: 5200, dur: 0.36, gain: 0.14, t0: 0.14 }, // the hiss tail
    ],
    death: [
      { src: 'tone', wave: 'sine', f0: 260, f1: 60, dur: 0.2, gain: 0.26 },
      { src: 'noise', filter: 'bandpass', f0: 2600, f1: 800, q: 2, dur: 0.4, gain: 0.24, t0: 0.05 },
    ],
  },

  hooks: {},
};

export default bombardier;
registerSpecies(bombardier);
