// Suicide Ant — a fast, fragile kamikaze. It barely scratches in melee, but when
// it dies it ruptures, spraying a poison cloud that keeps eating at nearby enemies.
// It's a loner: it doesn't cluster with the colony unless danger forces it to.

import { registerSpecies } from './registry.js';

// --- ability tuning (easy to find + tweak) -----------------------------------
const SPRAY = {
  RADIUS: 46, // splash of the death burst
  POISON_SECONDS: 3.5, // lingering damage-over-time on anyone caught in it
  DAMAGE_PER_SECOND: 10, // ~35 total per caught foe — potent AoE, no longer obscene
  IMPACT_DAMAGE: 5, // small immediate hit from the rupture itself
};

const suicideAnt = {
  id: 'suicideAnt',
  name: 'Suicide Ant',
  tier: 'soldier',
  flavor: 'A volatile loner. Weak in life, lethal in death — it bursts into a cloud of poison.',

  // A loner: forages and fights like any ant, but won't herd up with the colony
  // unless it's exposed to a looming threat with no allies nearby.
  ai: {
    herds: false,
    herdWhenExposed: true,
  },

  stats: {
    maxHealth: 40, // frail — it's meant to die and take others with it
    speed: 2.1, // quick to close and detonate
    size: 7,
    damage: 4, // its bite is an afterthought
    attackRange: 15,
    attackCooldown: 38,
    visionRange: 220,
  },

  // Rendered straight from its source SVG (assets/sprites/src/suicideAnt.svg);
  // the shape fields below are the fallback if the art fails to load.
  visual: {
    type: 'sprite',
    sprite: 'suicideAnt',
    spriteExt: 'svg',
    spriteScale: 2.7,
    spriteFacing: 'up',
    shape: 'triangle',
    color: '#7cae3a', // sickly green telegraphs the poison
    stroke: '#2f4a12',
    size: 7,
  },

  // No gated signature ability — its whole identity is the death burst below.
  ability: null,

  hooks: {
    on_death(self, ctx) {
      for (const enemy of ctx.enemiesInRadius(self, SPRAY.RADIUS)) {
        ctx.dealDamage(enemy, SPRAY.IMPACT_DAMAGE, { sourceAgent: self, cause: 'poison' });
        ctx.applyStatus(
          enemy,
          {
            type: 'poison',
            label: 'Poisoned',
            duration: ctx.seconds(SPRAY.POISON_SECONDS),
            damagePerSecond: SPRAY.DAMAGE_PER_SECOND,
          },
          self
        );
      }
      ctx.spawnEffect({ kind: 'poison_cloud', x: self.x, y: self.y, radius: SPRAY.RADIUS });
    },
  },
};

export default suicideAnt;
registerSpecies(suicideAnt);
