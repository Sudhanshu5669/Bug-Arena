// Queen Ant — the only unit that makes more units. She does not fight, chase, or
// forage; she sits in the middle of her colony laying brood, and the workers she
// births do everything else. Left undisturbed she wins a long battle on sheer
// numbers, because the arena's win condition counts bodies.
//
// She is also the softest target on the field for her size: barely mobile, nearly
// harmless, and enormous. Every fight involving a queen is really a question of
// whether the enemy can get to her before the brood gets out of hand.

import { registerSpecies } from './registry.js';

// --- passive tuning: Brood ----------------------------------------------------
const BROOD = {
  SPECIES: 'workerAnt', // what she lays
  // Cadence and ceiling are THE balance levers: survivors decide a timed battle,
  // so an unchecked queen simply out-populates any opponent.
  EVERY_TICKS: 420, // a clutch every 7s
  CLUTCH: 2, // workers per clutch
  MAX_LIVING: 6, // she stops laying while this many of her brood are alive
  RADIUS: 46, // they emerge in a ring around her
};

const queenAnt = {
  id: 'queenAnt',
  name: 'Queen Ant',
  tier: 'champion',
  flavor:
    'She never throws a punch. She just keeps laying, and the colony keeps arriving — as long as nothing reaches her.',

  // She is not a combatant: she never hunts, never forages, and stays buried in
  // the middle of the colony she is producing.
  ai: {
    hunts: false,
    forages: false,
    herds: true,
    loneSurvivorRage: false, // a cornered queen does not become a warrior
  },

  stats: {
    maxHealth: 230, // a lot of health, and every point of it is a liability to guard
    speed: 0.62, // the slowest thing in the arena — she cannot flee anything
    size: 16, // and the largest, so she is impossible to miss
    damage: 4, // functionally harmless
    attackRange: 18,
    attackCooldown: 72,
    visionRange: 175, // she barely sees the fight she's in
  },

  visual: {
    type: 'sprite',
    sprite: 'queenAnt',
    spriteExt: 'svg',
    spriteScale: 3.0,
    spriteFacing: 'up',
    shape: 'circle',
    color: '#8d3fb0', // royal purple
    stroke: '#2c0d3d',
    size: 16,
  },

  ability: null, // her brood IS the ability — and it needs no attack to trigger

  sfx: {
    attack: [{ src: 'noise', filter: 'lowpass', f0: 1100, f1: 500, dur: 0.06, gain: 0.16 }],
    death: [
      { src: 'tone', wave: 'sawtooth', f0: 220, f1: 52, dur: 0.6, gain: 0.26, cutoff: 1100 }, // the colony's heart stopping
      { src: 'noise', filter: 'lowpass', f0: 1600, f1: 200, dur: 0.5, gain: 0.3 },
      { src: 'tone', wave: 'sine', f0: 110, f1: 44, dur: 0.7, gain: 0.2, t0: 0.1 },
    ],
  },

  hooks: {
    /**
     * Brood. Lays a clutch on a fixed cadence — no attack required, which is the
     * point: she contributes without ever engaging.
     *
     * Two ceilings keep her from running away with a battle: she pauses while
     * MAX_LIVING of her workers are already out, and `ctx.summon` itself is capped
     * by the engine's global agent limit.
     */
    on_tick(self, ctx) {
      if (ctx.tick % BROOD.EVERY_TICKS !== 0) return;
      if (ctx.countAllies(self, BROOD.SPECIES) >= BROOD.MAX_LIVING) return;
      const born = ctx.summon(self, BROOD.SPECIES, { count: BROOD.CLUTCH, radius: BROOD.RADIUS });
      if (born.length) {
        ctx.spawnEffect({ kind: 'brood', x: self.x, y: self.y, radius: BROOD.RADIUS, team: self.team });
      }
    },
  },
};

export default queenAnt;
registerSpecies(queenAnt);
