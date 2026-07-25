// Weaver Ant — the setup piece. Real weaver ants build nests by hauling leaves
// together with silk, and that hauling is what this ability is: it whips silk
// onto several enemies at once and DRAGS THEM INTO A PILE next to itself.
//
// It is the only unit in the game that moves enemies toward a point. On its own
// that's mediocre — the payoff is handing a clumped target to whatever AoE your
// colony brought (a Bombardier's cone, a Goliath's slam). It's a combo enabler.

import { registerSpecies } from './registry.js';

const ANCHOR = {
  TRIGGER_CHANCE: 0.3,
  COOLDOWN_SECONDS: 8.5,
  WINDUP_SECONDS: 0.3, // the wind-up is the silk going taut
  RADIUS: 120, // how far the silk reaches
  MAX_TARGETS: 4,
  HAUL_FRACTION: 0.62, // pulls each victim this much of the way in
  MIN_GAP: 26, // ...but never closer than this, so they pile AROUND it, not inside it
  ROOT_SECONDS: 1.1, // held just long enough for an ally to line up a shot
  // The silk used to do 4, which made the whole unit contribute nothing in a fight
  // with no allied AoE to set up — it lost literally every isolated matchup. It's
  // still a setup tool, it just no longer rounds to zero on its own.
  DAMAGE: 9,
};

const weaverAnt = {
  id: 'weaverAnt',
  name: 'Weaver Ant',
  tier: 'soldier',
  flavor:
    'Hauls its enemies together with silk the way it hauls leaves — bunching a scattered line into one convenient pile.',

  stats: {
    maxHealth: 70,
    speed: 1.9,
    size: 8,
    damage: 6,
    attackRange: 16,
    attackCooldown: 38,
    visionRange: 250, // it needs to see the group before it can gather it
  },

  visual: {
    type: 'sprite',
    sprite: 'weaverAnt',
    spriteExt: 'svg',
    spriteScale: 2.2,
    spriteFacing: 'up',
    shape: 'ellipse',
    color: '#8ac926', // leaf green
    stroke: '#25400a',
    size: 8,
  },

  ability: {
    name: 'Silk Anchor',
    description:
      'Whips silk onto several nearby foes and hauls them into a pile beside it, rooted in place.',
    triggerChance: ANCHOR.TRIGGER_CHANCE,
    cooldownSeconds: ANCHOR.COOLDOWN_SECONDS,
    windupSeconds: ANCHOR.WINDUP_SECONDS,
    telegraphColor: '#c9f26a',
    requiresTarget: false, // it gathers a crowd, not a specific bug
    log: (self, target, res) => {
      const n = res?.caught ?? 0;
      return n > 1
        ? `${self.species.name} hauled ${n} foes into a heap!`
        : `${self.species.name} anchored its silk!`;
    },
    onTrigger(self, target, ctx) {
      // Nearest first, so the pile forms tight instead of the reach being spent
      // on one stray at the edge of the radius.
      const caught = ctx
        .enemiesInRadius(self, ANCHOR.RADIUS)
        .sort((a, b) => ctx.distance(self, a) - ctx.distance(self, b))
        .slice(0, ANCHOR.MAX_TARGETS);

      for (const enemy of caught) {
        const dx = self.x - enemy.x;
        const dy = self.y - enemy.y;
        const d = Math.hypot(dx, dy) || 1;
        // Haul it most of the way in, stopping short of `MIN_GAP` so bodies don't
        // end up stacked on the weaver itself (matter.js would then shove them
        // apart hard and undo the whole pull).
        const pull = Math.max(0, Math.min(d * ANCHOR.HAUL_FRACTION, d - ANCHOR.MIN_GAP));
        if (pull > 0) ctx.push(enemy, dx / d, dy / d, pull);

        ctx.dealDamage(enemy, ANCHOR.DAMAGE, { sourceAgent: self, cause: 'silk' });
        ctx.applyStatus(
          enemy,
          {
            type: 'anchored',
            label: 'Anchored',
            duration: ctx.seconds(ANCHOR.ROOT_SECONDS),
            preventMove: true, // rooted, but it can still swing back
            speedMultiplier: 0,
          },
          self
        );
      }

      ctx.spawnEffect({
        kind: 'web_splash',
        x: self.x,
        y: self.y,
        radius: ANCHOR.RADIUS,
        team: self.team,
      });

      return { caught: caught.length };
    },
  },

  // Silk under tension: a dry fibrous creak, not a wet one.
  sfx: {
    attack: [{ src: 'noise', filter: 'bandpass', f0: 2100, f1: 1300, q: 6, dur: 0.035, gain: 0.16 }],
    ability: [
      { src: 'noise', filter: 'bandpass', f0: 900, f1: 3400, q: 3, dur: 0.26, gain: 0.3 }, // the whip-out
      { src: 'tone', wave: 'triangle', f0: 180, f1: 420, dur: 0.3, gain: 0.18, t0: 0.06 }, // the haul
    ],
    death: [{ src: 'tone', wave: 'sine', f0: 300, f1: 80, dur: 0.16, gain: 0.2 }],
  },

  hooks: {},
};

export default weaverAnt;
registerSpecies(weaverAnt);
