// Carpenter Ant — the counter-puncher. Big, armoured and almost entirely passive:
// it barely attacks, but anything that bites it splits its own mandibles on the
// ant's timber-hard shell and takes the damage straight back. Against a swarm of
// fast attackers it grinds them down without swinging once. Against something
// slow and heavy it does almost nothing.

import { registerSpecies } from './registry.js';

// --- passive tuning: Splintered Shell ----------------------------------------
const THORNS = {
  FRACTION: 0.4, // share of each incoming hit reflected at the attacker
  MAX_PER_HIT: 9, // cap, so a single huge blow can't one-shot its own dealer
  RANGE: 60, // the attacker must still be adjacent — no reflecting a dash from afar
};

const carpenterAnt = {
  id: 'carpenterAnt',
  name: 'Carpenter Ant',
  tier: 'soldier',
  flavor:
    'Timber-hard and slow to anger. It hardly fights back — it just makes attacking it a bad idea.',

  stats: {
    maxHealth: 118, // built to be hit
    speed: 1.3,
    size: 10,
    damage: 4, // its own offence is an afterthought
    attackRange: 16,
    attackCooldown: 58, // slow swings
    visionRange: 195,
  },

  visual: {
    type: 'sprite',
    sprite: 'carpenterAnt',
    spriteExt: 'svg',
    spriteScale: 2.8,
    spriteFacing: 'up',
    shape: 'polygon',
    color: '#6b4a2a', // dark timber brown
    stroke: '#221407',
    size: 10,
  },

  // --- signature ability: Harden (a defensive stance, not an attack) -----------
  ability: {
    name: 'Harden',
    description: 'Sets its shell — it takes much less damage, and reflects far more of it.',
    triggerChance: 0.4,
    cooldownSeconds: 8,
    requiresTarget: false,
    telegraphColor: '#c9a06a',
    log: (self) => `${self.species.name} set its shell!`,
    onTrigger(self, target, ctx) {
      ctx.applyStatus(
        self,
        {
          type: 'hardened',
          label: 'Hardened',
          duration: ctx.seconds(4),
          damageTakenMultiplier: 0.65,
          // The trade: braced hard, it can barely move.
          speedMultiplier: 0.4,
        },
        self
      );
      ctx.spawnEffect({ kind: 'thorns', x: self.x, y: self.y, radius: self.stats.size + 12 });
    },
  },

  sfx: {
    attack: [{ src: 'noise', filter: 'lowpass', f0: 1500, f1: 600, dur: 0.06, gain: 0.24 }],
    ability: [
      { src: 'tone', wave: 'square', f0: 150, f1: 96, dur: 0.22, gain: 0.16, cutoff: 800 }, // shell setting
      { src: 'noise', filter: 'lowpass', f0: 1100, f1: 300, dur: 0.16, gain: 0.24 },
    ],
    death: [{ src: 'noise', filter: 'bandpass', f0: 1500, f1: 400, q: 4, dur: 0.28, gain: 0.3 }],
  },

  hooks: {
    /**
     * Splintered Shell. Reflect a slice of every hit back at whoever landed it.
     *
     * Two guards matter here. The reflect only fires for a LIVING, ADJACENT
     * attacker, so damage-over-time ticks and long-range hits don't feed it. And
     * it is capped per hit — otherwise a big burst would kill its own dealer,
     * which turns a defensive trait into a better offence than most attackers have.
     */
    on_damaged(self, amount, source, ctx, meta) {
      // Never reflect a reflection: two carpenter ants facing each other would
      // otherwise ping damage back and forth until the recursion bottomed out.
      if (meta?.cause === 'thorns') return;
      if (!source || !source.alive || source.team === self.team) return;
      if (ctx.distance(self, source) > THORNS.RANGE) return;
      const back = Math.min(THORNS.MAX_PER_HIT, amount * THORNS.FRACTION);
      if (back < 0.5) return; // ignore chip damage — no reflect off a DoT tick
      ctx.dealDamage(source, back, { sourceAgent: self, cause: 'thorns' });
      ctx.spawnEffect({ kind: 'thorns', x: source.x, y: source.y, radius: source.stats.size + 6 });
    },
  },
};

export default carpenterAnt;
registerSpecies(carpenterAnt);
