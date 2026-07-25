// Devil's Coach Horse — a rove beetle that answers threats with theatre. It curls
// its abdomen up over its back like a scorpion, opens its jaws, and releases a
// genuinely foul-smelling secretion from two glands at the tip. Most things that
// were about to eat it decide not to.
//
// It's the only ability in the game that makes enemies LEAVE. Nothing is rooted,
// stunned or silenced — they're just driven back and made slower and more
// cowardly. Against a push that has committed, it undoes the commitment.

import { registerSpecies } from './registry.js';

const REEK = {
  TRIGGER_CHANCE: 0.44,
  COOLDOWN_SECONDS: 7.5,
  RADIUS: 145,
  REPEL: 88, // driven this far back, away from the beetle
  DAMAGE: 9,
  FEAR_SECONDS: 3.4,
  FEAR_SLOW: 0.6,
  FEAR_WEAKEN: 0.72, // a frightened thing does not commit to its swings
};

const coachHorse = {
  id: 'coachHorse',
  name: "Devil's Coach Horse",
  tier: 'champion',
  flavor:
    'Curls its abdomen over its back, opens its jaws, and releases something so foul that most attackers simply change their minds.',

  stats: {
    maxHealth: 174,
    speed: 1.75,
    size: 12,
    damage: 10,
    attackRange: 24,
    attackCooldown: 38,
    visionRange: 240,
  },

  visual: {
    type: 'sprite',
    sprite: 'coachHorse',
    spriteExt: 'svg',
    spriteScale: 2.85,
    spriteFacing: 'up',
    shape: 'polygon',
    color: '#1c1c1c', // matte black, like the real beetle
    stroke: '#000000',
    size: 12,
  },

  ability: {
    name: 'Rear & Reek',
    description:
      'Rears up and releases a foul cloud — everything nearby is driven back, slowed, and put off its swing.',
    triggerChance: REEK.TRIGGER_CHANCE,
    cooldownSeconds: REEK.COOLDOWN_SECONDS,
    telegraphColor: '#a88bd6',
    requiresTarget: false,
    log: (self, target, res) => {
      const n = res?.repelled ?? 0;
      return n > 1
        ? `${self.species.name} reared up — ${n} of them backed off!`
        : `${self.species.name} reared and reeked.`;
    },
    onTrigger(self, target, ctx) {
      const caught = ctx.enemiesInRadius(self, REEK.RADIUS);
      for (const enemy of caught) {
        const dx = enemy.x - self.x;
        const dy = enemy.y - self.y;
        const d = Math.hypot(dx, dy) || 1;

        // Closer enemies get shoved harder — the stench is worst at the source.
        const scale = 1 - 0.5 * Math.min(1, d / REEK.RADIUS);
        ctx.push(enemy, dx / d, dy / d, REEK.REPEL * scale);
        ctx.dealDamage(enemy, REEK.DAMAGE * scale, { sourceAgent: self, cause: 'reek' });
        ctx.applyStatus(
          enemy,
          {
            type: 'repelled',
            label: 'Repelled',
            duration: ctx.seconds(REEK.FEAR_SECONDS),
            speedMultiplier: REEK.FEAR_SLOW,
            damageDealtMultiplier: REEK.FEAR_WEAKEN,
          },
          self
        );
      }

      ctx.spawnEffect({ kind: 'flare', x: self.x, y: self.y, radius: REEK.RADIUS, team: self.team });
      return { repelled: caught.length };
    },
  },

  // A dry rear-up, then something rank venting out.
  sfx: {
    attack: [{ src: 'noise', filter: 'bandpass', f0: 1500, f1: 900, q: 6, dur: 0.042, gain: 0.2 }],
    ability: [
      { src: 'tone', wave: 'sawtooth', f0: 190, f1: 95, dur: 0.26, gain: 0.2, cutoff: 700 }, // the rear
      { src: 'noise', filter: 'lowpass', f0: 1800, f1: 350, dur: 0.5, gain: 0.3, t0: 0.08 }, // the vent
      { src: 'tone', wave: 'sine', f0: 70, f1: 40, dur: 0.4, gain: 0.16, t0: 0.1 },
    ],
    death: [{ src: 'tone', wave: 'sine', f0: 190, f1: 45, dur: 0.3, gain: 0.26 }],
  },

  hooks: {},
};

export default coachHorse;
registerSpecies(coachHorse);
