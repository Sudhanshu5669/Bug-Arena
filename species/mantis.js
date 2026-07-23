// Blade Mantis — glass-cannon duelist. Its signature ability is a dash-strike:
// it lunges at the target and lands a single brutal hit, then must recover.

import { registerSpecies } from './registry.js';

// --- ability tuning (easy to find + tweak) -----------------------------------
const DASH = {
  TRIGGER_CHANCE: 0.4, // 40% chance per attack (dashes fairly often)
  COOLDOWN_SECONDS: 3.5, // short — it's a bread-and-butter burst
  BONUS_DAMAGE: 16, // extra damage on top of the normal hit, dealt to ALL it plows through
  DASH_DISTANCE: 165, // px the mantis charges across — a long, arena-spanning lunge
  HIT_RADIUS: 20, // half-width of the swept lane that catches enemies
  KNOCKBACK: 36, // px each foe in the lane is bowled aside
  WINDUP_SECONDS: 0.22, // it coils back for a beat before exploding forward
  WINDUP_RECOIL: 16, // px it pulls BACKWARD during the coil (sells the launch)
};

const mantis = {
  id: 'mantis',
  name: 'Blade Mantis',
  tier: 'champion', // squad-leading special unit
  flavor:
    'A glass-cannon duelist. It charges across the arena, scything through and scattering everything in its lane.',

  stats: {
    maxHealth: 150, // a BUG through and through — a wall of ants can't trade it down cheaply
    speed: 3.1,
    size: 12,
    damage: 15,
    attackRange: 22,
    attackCooldown: 28, // ticks (~0.47s)
    visionRange: 270,
  },

  visual: {
    type: 'sprite',
    sprite: 'mantis',
    spriteScale: 2.7,
    spriteFacing: 'up',
    shape: 'triangle',
    color: '#38b000',
    stroke: '#12420a',
    size: 12,
  },

  // --- signature ability: Dash Strike (wind-up → line AoE + knockback) ---------
  ability: {
    name: 'Dash Strike',
    description:
      'Coils back, then explodes forward through the target — damaging and knocking back every enemy in its path.',
    triggerChance: DASH.TRIGGER_CHANCE,
    cooldownSeconds: DASH.COOLDOWN_SECONDS,
    // Telegraph: a coil-back before the launch (see the engine's cast lifecycle).
    windupSeconds: DASH.WINDUP_SECONDS,
    windupRecoil: DASH.WINDUP_RECOIL,
    telegraphColor: '#8bff6a',
    requiresTarget: false, // a direction-based leap: it still launches if the target flees
    log: (self, target, res) => {
      const n = res?.hit?.length ?? 0;
      if (n > 1) return `${self.species.name} scythed through ${n} foes on its dash!`;
      const who = res?.hit?.[0]?.species?.name ?? target?.species?.name ?? 'the pack';
      return `${self.species.name} dashed clean through ${who}!`;
    },
    onTrigger(self, target, ctx) {
      // One long charge: the mantis ends PAST its foes, having plowed the whole
      // lane. Every enemy the sweep touches takes the strike and is knocked aside.
      const res = ctx.dashThrough(self, target, {
        distance: DASH.DASH_DISTANCE,
        radius: DASH.HIT_RADIUS,
        damage: self.stats.damage + DASH.BONUS_DAMAGE,
        knockback: DASH.KNOCKBACK,
      });
      // Feed the renderer everything it needs to trail crisp AFTERIMAGES of the
      // mantis along the whole charge (not just a line).
      ctx.spawnEffect({
        kind: 'dash',
        x1: res.startX,
        y1: res.startY,
        x2: res.endX,
        y2: res.endY,
        speciesId: self.speciesId,
        team: self.team,
        angle: Math.atan2(res.endY - res.startY, res.endX - res.startX),
      });
      return res; // fed to `log` above for the "scythed through N" line
    },
  },

  hooks: {},
};

export default mantis;
registerSpecies(mantis);
