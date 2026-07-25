// Amazon Ant — the thief that keeps what it takes. Real amazon ants can't feed
// themselves; they raid other colonies and steal their labour outright. Here that
// becomes the only PERMANENT stat theft in the game: every proc moves a slice of
// the victim's damage onto the Amazon and never gives it back.
//
// Design note: this is a snowball unit, so the numbers are deliberately small per
// proc and hard-capped. An unbounded steal on a fast attacker turns a 60-second
// battle into a single invincible ant, which is not a fight anyone wants to watch.

import { registerSpecies } from './registry.js';

const PILLAGE = {
  TRIGGER_CHANCE: 0.32,
  COOLDOWN_SECONDS: 7,
  // Tuned down from 1.4 / 9 / 6 stacks: at those numbers it took ~83% of its
  // matchups, because a two-way swing (it gains exactly what the enemy loses)
  // compounds far faster than a flat self-buff of the same size.
  DAMAGE_STOLEN: 1.0, // moved from victim to thief, permanently
  HEALTH_STOLEN: 6, // ...along with a bite of max HP
  MAX_STACKS: 4, // the hard cap on snowballing (see note above)
  MIN_VICTIM_DAMAGE: 2, // never strip a victim below this — it stays a combatant
};

const amazonAnt = {
  id: 'amazonAnt',
  name: 'Amazon Ant',
  tier: 'soldier',
  flavor:
    "Cannot feed itself, so it takes what others have — and every raid leaves it a little stronger and its victim a little less.",

  stats: {
    maxHealth: 74,
    speed: 1.95,
    size: 8,
    damage: 6, // starts ordinary; the theft is the whole point
    attackRange: 17,
    attackCooldown: 36,
    visionRange: 225,
  },

  visual: {
    type: 'sprite',
    sprite: 'amazonAnt',
    spriteExt: 'svg',
    spriteScale: 2.2,
    spriteFacing: 'up',
    shape: 'ellipse',
    color: '#c9a227', // burnished raider gold
    stroke: '#3d2a05',
    size: 8,
  },

  ability: {
    name: 'Pillage',
    description:
      "Tears strength straight out of its victim — the Amazon keeps it for the rest of the battle.",
    triggerChance: PILLAGE.TRIGGER_CHANCE,
    cooldownSeconds: PILLAGE.COOLDOWN_SECONDS,
    telegraphColor: '#ffd75e',
    requiresTarget: true,
    log: (self, target, res) =>
      res?.stacks
        ? `${self.species.name} pillaged ${target.species.name} (${res.stacks}/${PILLAGE.MAX_STACKS})`
        : `${self.species.name} found nothing left to take.`,
    onTrigger(self, target, ctx) {
      if (!target || !target.alive) return { stacks: 0 };

      const stacks = self.memory.pillageStacks ?? 0;
      if (stacks >= PILLAGE.MAX_STACKS) return { stacks };

      // Only take what the victim can spare — a bug stripped to zero damage stops
      // being an opponent and starts being scenery.
      const take = Math.min(
        PILLAGE.DAMAGE_STOLEN,
        Math.max(0, target.stats.damage - PILLAGE.MIN_VICTIM_DAMAGE)
      );
      if (take <= 0) return { stacks };

      target.stats.damage -= take;
      self.stats.damage += take;

      // The HP theft is real damage (so it can finish a kill and credit properly)
      // paired with a matching gain on the thief.
      ctx.dealDamage(target, PILLAGE.HEALTH_STOLEN, { sourceAgent: self, cause: 'pillage' });
      self.stats.maxHealth += PILLAGE.HEALTH_STOLEN;
      self.maxHealth = self.stats.maxHealth;
      ctx.heal(self, PILLAGE.HEALTH_STOLEN);

      self.memory.pillageStacks = stacks + 1;

      // A visible, permanent marker of how fat it has got — refreshed each proc so
      // the label always shows the current count.
      ctx.applyStatus(
        self,
        {
          type: 'pillaged',
          label: `Pillage x${self.memory.pillageStacks}`,
          duration: ctx.seconds(9999),
          permanent: true,
        },
        self
      );

      ctx.spawnEffect({ kind: 'gorge', x: self.x, y: self.y, team: self.team });
      return { stacks: self.memory.pillageStacks };
    },
  },

  // Metallic, acquisitive — a scrape and a hoarding chime.
  sfx: {
    attack: [{ src: 'noise', filter: 'bandpass', f0: 2400, f1: 1500, q: 7, dur: 0.035, gain: 0.17 }],
    ability: [
      { src: 'noise', filter: 'bandpass', f0: 1800, f1: 700, q: 4, dur: 0.18, gain: 0.26 }, // the tearing
      { src: 'tone', wave: 'triangle', f0: 520, f1: 880, dur: 0.22, gain: 0.2, t0: 0.08 }, // the taking
    ],
    death: [{ src: 'tone', wave: 'sine', f0: 320, f1: 70, dur: 0.18, gain: 0.22 }],
  },

  hooks: {},
};

export default amazonAnt;
registerSpecies(amazonAnt);
