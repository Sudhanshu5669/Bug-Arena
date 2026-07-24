// Army Ant — the swarm. One is nearly harmless; a column of them is the most
// dangerous thing on the sand. Its passive scales its bite with the number of
// allies packed around it, so it is genuinely feeble when cut off from the
// column and genuinely terrifying when the colony arrives together.
//
// Unlike the other ants it doesn't wait to be provoked: army ants raid.

import { registerSpecies } from './registry.js';

// --- passive tuning: Swarm Bond ----------------------------------------------
const SWARM = {
  RADIUS: 115, // how close an ally must be to count toward the column
  CHECK_EVERY: 12, // ticks between recounts (cheap, and plenty responsive)
  MAX_COUNT: 6, // allies beyond this stop adding (keeps the top end bounded)
  // Damage multiplier = BASE + PER_ALLY * alliesNearby (capped at MAX_COUNT).
  BASE_DAMAGE: 0.58, // ALONE: little over half damage — the drawback, and a harsh one
  PER_ALLY_DAMAGE: 0.14, // 3 allies ≈ break-even, 6 allies ≈ +34%
  BASE_SPEED: 0.92,
  PER_ALLY_SPEED: 0.03,
  SECONDS: 2, // status lifetime; refreshed long before it lapses
};

// --- ability tuning: Raid Call -----------------------------------------------
const RAID = {
  TRIGGER_CHANCE: 0.25,
  COOLDOWN_SECONDS: 11,
  RADIUS: 140,
  SECONDS: 3,
  DAMAGE_DEALT: 1.3, // every ally in earshot hits 30% harder
  SPEED: 1.18,
};

const armyAnt = {
  id: 'armyAnt',
  name: 'Army Ant',
  tier: 'soldier',
  flavor:
    'Never fights alone. Its bite is feeble when cut off from the column and brutal when the column arrives.',

  // The raiding colony: it hunts on sight even in passive (forage-first) battles,
  // which is what makes an army ant squad feel like an advancing front.
  ai: {
    hunts: true,
    herds: true,
  },

  stats: {
    maxHealth: 56, // the frailest ant on the field
    speed: 2.0,
    size: 7,
    damage: 6, // before the swarm multiplier — see the passive above
    attackRange: 15,
    attackCooldown: 26, // ticks (~0.43s) — bites fast
    visionRange: 235,
  },

  visual: {
    type: 'sprite',
    sprite: 'armyAnt',
    spriteExt: 'svg',
    spriteScale: 2.6,
    spriteFacing: 'up',
    shape: 'triangle',
    color: '#a8452a', // rust red
    stroke: '#3d1409',
    size: 7,
  },

  // --- signature ability: Raid Call (a team-wide offensive rally) --------------
  ability: {
    name: 'Raid Call',
    description: 'Signals the column — every nearby ally hits harder and moves faster.',
    triggerChance: RAID.TRIGGER_CHANCE,
    cooldownSeconds: RAID.COOLDOWN_SECONDS,
    telegraphColor: '#ff9a5c',
    requiresTarget: false,
    log: (self, target, rallied) =>
      `${self.species.name} sounded the raid — ${rallied?.length ?? 1} answered!`,
    onTrigger(self, target, ctx) {
      const rallied = [self, ...ctx.alliesInRadius(self, RAID.RADIUS)];
      for (const ally of rallied) {
        ctx.applyStatus(
          ally,
          {
            type: 'rally',
            label: 'Raiding',
            duration: ctx.seconds(RAID.SECONDS),
            damageDealtMultiplier: RAID.DAMAGE_DEALT,
            speedMultiplier: RAID.SPEED,
          },
          self
        );
      }
      ctx.spawnEffect({ kind: 'rally', x: self.x, y: self.y, radius: RAID.RADIUS, team: self.team });
      return rallied;
    },
  },

  // Small, dry, and relentless — a lot of tiny mandibles working at once.
  sfx: {
    attack: [{ src: 'noise', filter: 'bandpass', f0: 3200, f1: 1800, q: 8, dur: 0.032, gain: 0.2 }],
    ability: [
      { src: 'tone', wave: 'square', f0: 300, f1: 430, dur: 0.09, gain: 0.12, cutoff: 1800, repeat: { times: 3, every: 0.1 } },
      { src: 'tone', wave: 'sine', f0: 95, f1: 62, dur: 0.38, gain: 0.24 }, // the marching drum under it
    ],
    death: [{ src: 'tone', wave: 'sine', f0: 900, f1: 300, dur: 0.1, gain: 0.16 }],
  },

  hooks: {
    /**
     * Swarm Bond. Recounts the column every few ticks and rewrites one `swarm`
     * status accordingly — the engine multiplies every active status together, so
     * simply refreshing this one entry is enough to retune the ant continuously.
     * The status is only rewritten when the count actually CHANGES, which keeps
     * the snapshot event stream quiet.
     */
    on_tick(self, ctx) {
      if (ctx.tick % SWARM.CHECK_EVERY !== 0) return;

      const nearby = Math.min(SWARM.MAX_COUNT, ctx.alliesInRadius(self, SWARM.RADIUS).length);
      const held = self.statuses.find((s) => s.type === 'swarm');
      // Re-apply on a change, or when the existing one is close to lapsing.
      if (held && self.memory.swarmCount === nearby && held.remaining > SWARM.CHECK_EVERY * 2) return;
      self.memory.swarmCount = nearby;

      ctx.applyStatus(
        self,
        {
          type: 'swarm',
          label: nearby === 0 ? 'Alone' : `Swarm ×${nearby}`,
          duration: ctx.seconds(SWARM.SECONDS),
          damageDealtMultiplier: SWARM.BASE_DAMAGE + SWARM.PER_ALLY_DAMAGE * nearby,
          speedMultiplier: SWARM.BASE_SPEED + SWARM.PER_ALLY_SPEED * nearby,
          permanent: true, // an innate trait, not a timed debuff — no countdown on screen
          quiet: true, // recomputed continuously; keep it out of the event stream
        },
        self
      );
    },
  },
};

export default armyAnt;
registerSpecies(armyAnt);
