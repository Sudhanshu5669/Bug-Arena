// Leafcutter Ant — the colony's shield-bearer. It hauls a cut leaf everywhere it
// goes, which makes it the slowest, feeblest attacker in the colony. In exchange
// it can plant that leaf as a canopy: everyone under it takes far less damage —
// but everyone under it is also bogged down while they huddle.

import { registerSpecies } from './registry.js';

// --- ability tuning (easy to find + tweak) -----------------------------------
const BULWARK = {
  TRIGGER_CHANCE: 0.45,
  // Duration vs cooldown sets the canopy's uptime, and uptime is the whole reason
  // to field a leafcutter at all — it has to roughly pay for the damage you gave
  // up to bring one. ~5s up on a 6.5s cycle keeps it worth the slot.
  COOLDOWN_SECONDS: 6.5,
  RADIUS: 115, // how far the canopy reaches
  SECONDS: 5, // how long it holds
  DAMAGE_TAKEN: 0.5, // sheltered allies take HALF damage...
  SPEED: 0.72, // ...but shuffle along at 72% speed (the drawback)
};

const leafcutterAnt = {
  id: 'leafcutterAnt',
  name: 'Leafcutter Ant',
  tier: 'soldier',
  flavor:
    'Hauls a cut leaf like a tower shield. It can barely bite, but the canopy it raises keeps the whole colony standing.',

  stats: {
    maxHealth: 96, // sturdy — the leaf soaks a lot on its own
    speed: 1.15, // the slowest ant: it is carrying a leaf
    size: 9,
    damage: 3, // its mandibles are shears, not weapons — the real drawback
    attackRange: 15,
    // Ponderous swings — but note the ability gate fires on ATTACKS, so an ant
    // that swings too rarely also shelters the colony too rarely.
    attackCooldown: 55, // ticks (~0.92s)
    visionRange: 190,
  },

  visual: {
    type: 'sprite',
    sprite: 'leafcutterAnt',
    spriteExt: 'svg',
    spriteScale: 2.8,
    spriteFacing: 'up',
    shape: 'polygon',
    color: '#5fa832', // leaf green (roster dot + shape fallback)
    stroke: '#26461a',
    size: 9,
  },

  // --- signature ability: Leaf Bulwark (team shield with a mobility cost) ------
  ability: {
    name: 'Leaf Bulwark',
    description:
      'Plants its leaf as a canopy: nearby allies take half damage, but move sluggishly while sheltered.',
    triggerChance: BULWARK.TRIGGER_CHANCE,
    cooldownSeconds: BULWARK.COOLDOWN_SECONDS,
    telegraphColor: '#9ee06a',
    requiresTarget: false, // a defensive stance — it holds even if the attacker dies
    log: (self, target, sheltered) => {
      const n = sheltered?.length ?? 1;
      return `${self.species.name} raised a leaf canopy over ${n} of its colony!`;
    },
    onTrigger(self, target, ctx) {
      // The canopy covers the leafcutter and every ally huddled around it.
      const sheltered = [self, ...ctx.alliesInRadius(self, BULWARK.RADIUS)];
      for (const ally of sheltered) {
        ctx.applyStatus(
          ally,
          {
            type: 'bulwark',
            label: 'Sheltered',
            duration: ctx.seconds(BULWARK.SECONDS),
            damageTakenMultiplier: BULWARK.DAMAGE_TAKEN,
            speedMultiplier: BULWARK.SPEED,
          },
          self
        );
      }
      ctx.spawnEffect({
        kind: 'leaf_shield',
        x: self.x,
        y: self.y,
        radius: BULWARK.RADIUS,
        team: self.team,
      });
      return sheltered; // feeds the "canopy over N" kill-feed line
    },
  },

  // Its sound signature: dry, papery, vegetal — nothing about it sounds dangerous.
  sfx: {
    attack: [{ src: 'noise', filter: 'highpass', f0: 3800, f1: 2400, q: 2, dur: 0.05, gain: 0.2 }],
    ability: [
      { src: 'noise', filter: 'bandpass', f0: 2000, f1: 5400, q: 1, dur: 0.36, gain: 0.24 }, // leaf rustle
      { src: 'tone', wave: 'triangle', f0: 523, f1: 784, dur: 0.32, gain: 0.13, t0: 0.05 }, // shield chime
    ],
    death: [{ src: 'noise', filter: 'highpass', f0: 2600, f1: 900, q: 1.5, dur: 0.24, gain: 0.26 }],
  },

  hooks: {},
};

export default leafcutterAnt;
registerSpecies(leafcutterAnt);
