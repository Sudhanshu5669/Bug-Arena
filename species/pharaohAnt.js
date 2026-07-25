// Pharaoh Ant — the colony that will not stop growing. Real pharaoh ant colonies
// spread by BUDDING: a piece simply walks away and becomes a new colony. It is
// famously near-impossible to exterminate for exactly this reason.
//
// It is the only SOLDIER that summons. The Queen's brood is a champion privilege
// that arrives in a clutch; this is slower and quieter — one ant at a time, from
// any pharaoh ant on the field, each of which can then bud in turn. Ignore it and
// the arithmetic gets away from you.

import { registerSpecies } from './registry.js';

const BUD = {
  TRIGGER_CHANCE: 0.28,
  COOLDOWN_SECONDS: 10,
  // Softened from 0.22 cost / 0.6 offspring hp / 14 cap. At those numbers budding
  // was a net LOSS of colony health — it paid 22% to gain a 60%-health copy of a
  // 54 HP ant — so the species that exists to out-multiply you lost 95% of fights.
  HEALTH_COST: 0.15, // fraction of CURRENT hp spent to bud (it splits itself)
  MIN_HEALTH_FRACTION: 0.5, // won't bud below this — a wounded ant fights instead
  BROOD_CAP: 18, // team-wide ceiling on living pharaoh ants
  OFFSPRING_HEALTH: 0.75, // buds arrive at 75% hp, not fresh
};

const pharaohAnt = {
  id: 'pharaohAnt',
  name: 'Pharaoh Ant',
  tier: 'soldier',
  flavor:
    'Splits a piece of itself off and sends it walking. Every bud can bud again — which is why nothing ever really clears them out.',

  stats: {
    maxHealth: 54, // individually feeble; that was never the point
    speed: 1.95,
    size: 6,
    damage: 4,
    attackRange: 14,
    attackCooldown: 36,
    visionRange: 215,
  },

  visual: {
    type: 'sprite',
    sprite: 'pharaohAnt',
    spriteExt: 'svg',
    spriteScale: 2.0,
    spriteFacing: 'up',
    shape: 'ellipse',
    color: '#e0c097',
    stroke: '#4a3520',
    size: 6,
  },

  ability: {
    name: 'Budding',
    description: 'Splits off a piece of itself as a fresh ant — and that one can split again.',
    triggerChance: BUD.TRIGGER_CHANCE,
    cooldownSeconds: BUD.COOLDOWN_SECONDS,
    telegraphColor: '#ffe9c2',
    requiresTarget: false,
    log: (self, target, res) =>
      res?.born ? `${self.species.name} budded — the colony grows.` : `${self.species.name} is too weak to bud.`,
    onTrigger(self, target, ctx) {
      // Two independent brakes on runaway growth: it must be healthy enough to
      // split, and the team is capped. `summon` also respects config.maxAgents,
      // so this can never outrun the simulation.
      if (self.health < self.maxHealth * BUD.MIN_HEALTH_FRACTION) return { born: 0 };
      if (ctx.countAllies(self, 'pharaohAnt') >= BUD.BROOD_CAP) return { born: 0 };

      const born = ctx.summon(self, 'pharaohAnt', { count: 1, radius: 26 });
      if (!born?.length) return { born: 0 };

      // The bud is made of the parent — so the parent pays for it, in HP.
      const cost = self.health * BUD.HEALTH_COST;
      self.health = Math.max(1, self.health - cost);
      for (const child of born) child.health = child.maxHealth * BUD.OFFSPRING_HEALTH;

      ctx.spawnEffect({ kind: 'spawn_in', x: self.x, y: self.y, team: self.team });
      return { born: born.length };
    },
  },

  // Small, papery, and slightly unsettling — a dry rustle of something dividing.
  sfx: {
    attack: [{ src: 'noise', filter: 'bandpass', f0: 3000, f1: 2000, q: 9, dur: 0.025, gain: 0.13 }],
    ability: [
      { src: 'noise', filter: 'bandpass', f0: 1400, f1: 2800, q: 2, dur: 0.24, gain: 0.24 },
      { src: 'tone', wave: 'triangle', f0: 420, f1: 640, dur: 0.2, gain: 0.16, t0: 0.06 },
    ],
    death: [{ src: 'tone', wave: 'sine', f0: 360, f1: 90, dur: 0.13, gain: 0.18 }],
  },

  hooks: {},
};

export default pharaohAnt;
registerSpecies(pharaohAnt);
