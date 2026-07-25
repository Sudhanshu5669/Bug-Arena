// Jumping Spider — it doesn't build webs. It has the sharpest vision of any
// arthropod, and it uses it to stalk: creep, freeze, measure the distance, then
// cross the entire gap in one jump.
//
// So the ability has two halves and that's the whole design. It vanishes into a
// stalk first (almost untouchable, but it can't attack either), and the pounce
// only lands when the stalk expires. Interrupt it and you get nothing; let it
// finish and it deletes something. It is the game's only DELAYED burst.

import { registerSpecies } from './registry.js';

const POUNCE = {
  TRIGGER_CHANCE: 0.35,
  COOLDOWN_SECONDS: 10,
  STALK_SECONDS: 1.1, // the crouch — it is nearly untouchable and totally harmless
  STALK_EVASION: 0.2,
  LUNGE: 190, // it crosses a serious gap
  DAMAGE: 42, // the single biggest hit in the game...
  EXECUTE_BONUS: 1.6, // ...and worse against something already wounded
  EXECUTE_THRESHOLD: 0.4, // "wounded" = below 40% health
};

const jumpingSpider = {
  id: 'jumpingSpider',
  name: 'Jumping Spider',
  tier: 'champion',
  flavor:
    'The best eyes of any arthropod, used for exactly one thing: working out precisely how far away you are before it crosses that distance in a single jump.',

  stats: {
    maxHealth: 142,
    speed: 2.4,
    size: 11,
    damage: 8, // its ordinary bite is nothing special
    attackRange: 20,
    attackCooldown: 34,
    visionRange: 300, // the stalk needs to start from a long way out
  },

  visual: {
    type: 'sprite',
    sprite: 'jumpingSpider',
    spriteExt: 'svg',
    spriteScale: 2.7,
    spriteFacing: 'up',
    shape: 'ellipse',
    color: '#4a4e69',
    stroke: '#16182b',
    size: 11,
  },

  ability: {
    name: 'Stalk & Pounce',
    description:
      'Freezes into a stalk — hard to touch, unable to bite — then crosses the whole gap in one devastating jump.',
    triggerChance: POUNCE.TRIGGER_CHANCE,
    cooldownSeconds: POUNCE.COOLDOWN_SECONDS,
    telegraphColor: '#b3b8ff',
    requiresTarget: true,
    log: (self, target, res) =>
      res?.pounced
        ? `${self.species.name} crossed the gap and landed on ${res.victim}!`
        : `${self.species.name} dropped into a stalk…`,
    onTrigger(self, target, ctx) {
      // The stalk. `preventAttack` is the real cost — for over a second it is
      // contributing nothing at all to the fight.
      ctx.applyStatus(
        self,
        {
          type: 'stalking',
          label: 'Stalking',
          duration: ctx.seconds(POUNCE.STALK_SECONDS),
          damageTakenMultiplier: POUNCE.STALK_EVASION,
          preventAttack: true,
        },
        self
      );
      self.memory.pounceTicks = ctx.seconds(POUNCE.STALK_SECONDS);
      ctx.spawnEffect({ kind: 'coil', x: self.x, y: self.y, radius: 40, team: self.team });
      return { pounced: false };
    },
  },

  hooks: {
    // The pounce fires when the stalk runs out — NOT when the ability procs. That
    // delay is the entire risk/reward of the unit.
    on_tick(self, ctx) {
      if (!(self.memory.pounceTicks > 0)) return;
      self.memory.pounceTicks -= 1;
      if (self.memory.pounceTicks > 0) return;

      // Re-acquire on landing: the original target may be dead or long gone, and
      // a pounce onto empty ground would be a wasted 10-second cooldown.
      const victim = ctx.nearestEnemy(self, POUNCE.LUNGE);
      if (!victim) {
        ctx.spawnEffect({ kind: 'leap', x: self.x, y: self.y, team: self.team });
        return;
      }

      const fromX = self.x;
      const fromY = self.y;
      ctx.lunge(self, victim, POUNCE.LUNGE);

      const wounded = victim.health < victim.maxHealth * POUNCE.EXECUTE_THRESHOLD;
      const damage = POUNCE.DAMAGE * (wounded ? POUNCE.EXECUTE_BONUS : 1);
      ctx.dealDamage(victim, damage, { sourceAgent: self, cause: 'leap' });

      ctx.spawnEffect({
        kind: 'leap',
        x: fromX,
        y: fromY,
        toX: victim.x,
        toY: victim.y,
        team: self.team,
      });
      ctx.emitEvent('ability', {
        casterId: self.id,
        casterTeam: self.team,
        casterSpecies: self.speciesId,
        ability: 'Stalk & Pounce',
        text: `${self.species.name} pounced on ${victim.species.name}!`,
        x: Math.round(victim.x),
        y: Math.round(victim.y),
      });
    },
  },

  // Silence, then a single hard landing.
  sfx: {
    attack: [{ src: 'noise', filter: 'bandpass', f0: 2200, f1: 1400, q: 8, dur: 0.03, gain: 0.16 }],
    ability: [
      { src: 'tone', wave: 'sine', f0: 420, f1: 180, dur: 0.3, gain: 0.14 }, // the crouch
      { src: 'noise', filter: 'lowpass', f0: 1600, f1: 400, dur: 0.14, gain: 0.34, t0: 0.9 }, // the landing
      { src: 'tone', wave: 'square', f0: 140, f1: 50, dur: 0.16, gain: 0.24, cutoff: 600, t0: 0.9 },
    ],
    death: [{ src: 'tone', wave: 'sine', f0: 300, f1: 65, dur: 0.24, gain: 0.24 }],
  },
};

export default jumpingSpider;
registerSpecies(jumpingSpider);
