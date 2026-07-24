// Trap-Jaw Ant — the fastest strike in the colony, and the clumsiest aftermath.
// Its normal bite is nothing; everything is invested in the snap. Winding that
// snap leaves it rooted and exposed, and the recoil physically catapults it
// backward out of the fight, where it lands dazed and defenceless for a moment.

import { registerSpecies } from './registry.js';

// --- ability tuning (easy to find + tweak) -----------------------------------
const SNAP = {
  TRIGGER_CHANCE: 0.45,
  COOLDOWN_SECONDS: 6,
  WINDUP_SECONDS: 0.5, // the jaws latch open — its window of vulnerability
  WINDUP_RECOIL: 10, // it hauls its head back during the wind-up
  DAMAGE: 27, // an enormous hit for a soldier-tier ant
  TARGET_KNOCKBACK: 46, // the victim is bowled away
  TARGET_STAGGER: 0.5, // ...and briefly dazed
  SELF_KICKBACK: 40, // THE DRAWBACK: the snap catapults the ant backward
  SELF_RECOVER: 0.3, // ...and it lands stunned, unable to move or bite
};

const trapjawAnt = {
  id: 'trapjawAnt',
  name: 'Trap-Jaw Ant',
  tier: 'soldier',
  flavor:
    'Latched jaws with a hair trigger. The snap hits like nothing else its size — and flings the ant clean out of the fight.',

  stats: {
    maxHealth: 66, // fragile; it cannot afford to be caught mid-wind-up
    speed: 1.85,
    size: 8,
    // An unremarkable bite — the snap is the species. It can't be TOO weak though:
    // the recoil keeps flinging the ant out of the scrum, so it spends a lot of a
    // battle walking back in on nothing but this.
    damage: 6,
    attackRange: 16,
    attackCooldown: 44,
    visionRange: 215,
  },

  visual: {
    type: 'sprite',
    sprite: 'trapjawAnt',
    spriteExt: 'svg',
    spriteScale: 2.8,
    spriteFacing: 'up',
    shape: 'triangle',
    color: '#c98a2e', // burnt amber
    stroke: '#4a2d08',
    size: 8,
  },

  // --- signature ability: Mandible Snap (huge burst, self-inflicted recoil) ----
  ability: {
    name: 'Mandible Snap',
    description:
      'Releases its latched jaws for a devastating hit — and is hurled backward by the recoil, landing stunned.',
    triggerChance: SNAP.TRIGGER_CHANCE,
    cooldownSeconds: SNAP.COOLDOWN_SECONDS,
    windupSeconds: SNAP.WINDUP_SECONDS,
    windupRecoil: SNAP.WINDUP_RECOIL,
    telegraphColor: '#ffd9a0',
    log: (self, target) => `${self.species.name} snapped its jaws shut on ${target.species.name}!`,
    onTrigger(self, target, ctx) {
      // Aim from the ant to its victim — used for both the knockback and the kick.
      const dx = target.x - self.x;
      const dy = target.y - self.y;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d;
      const uy = dy / d;

      ctx.dealDamage(target, SNAP.DAMAGE, { sourceAgent: self, cause: 'snap' });
      ctx.spawnEffect({ kind: 'snap', x: target.x, y: target.y, radius: 26 });

      if (target.alive) {
        const shove = ctx.push(target, ux, uy, SNAP.TARGET_KNOCKBACK);
        ctx.spawnEffect({ kind: 'impact', x: shove.x, y: shove.y, x0: shove.fromX, y0: shove.fromY });
        ctx.applyStatus(
          target,
          {
            type: 'stagger',
            label: 'Dazed',
            duration: ctx.seconds(SNAP.TARGET_STAGGER),
            speedMultiplier: 0,
            preventMove: true,
            preventAttack: true,
          },
          self
        );
      }

      // The cost: Newton's third law. The ant is flung the opposite way and needs
      // a moment on its back before it can do anything at all.
      const kick = ctx.push(self, -ux, -uy, SNAP.SELF_KICKBACK);
      ctx.spawnEffect({ kind: 'impact', x: kick.x, y: kick.y, x0: kick.fromX, y0: kick.fromY });
      ctx.applyStatus(
        self,
        {
          type: 'recoil',
          label: 'Recoiling',
          duration: ctx.seconds(SNAP.SELF_RECOVER),
          speedMultiplier: 0,
          preventMove: true,
          preventAttack: true,
        },
        self
      );
    },
  },

  // The snap is famously one of the loudest sounds in the insect world — a bare,
  // brutal transient with almost no body to it.
  sfx: {
    attack: [{ src: 'noise', filter: 'bandpass', f0: 2600, f1: 1600, q: 9, dur: 0.035, gain: 0.22 }],
    ability: [
      { src: 'noise', filter: 'highpass', f0: 9000, f1: 3000, dur: 0.035, gain: 0.5, attack: 0.001 }, // the crack
      { src: 'noise', filter: 'lowpass', f0: 3000, f1: 220, dur: 0.2, gain: 0.36 }, // the body of the blow
      { src: 'tone', wave: 'sine', f0: 400, f1: 70, dur: 0.22, gain: 0.2 }, // the thump
    ],
    death: [{ src: 'noise', filter: 'bandpass', f0: 2000, f1: 700, q: 6, dur: 0.14, gain: 0.26 }],
  },

  hooks: {},
};

export default trapjawAnt;
registerSpecies(trapjawAnt);
