// Zombie Ant — an ant that is already lost. Ophiocordyceps takes a carpenter ant
// over, marches the body somewhere useful to the fungus, and fruits out of its
// head. What walks into this arena is the fungus wearing an ant.
//
// It is the game's only CONTAGION: the rot it spreads jumps one hop from each
// victim to whatever is standing next to them. Against a spread-out line that's
// nothing much. Against a packed formation it goes through the whole block — and
// it fires again when the ant dies, so killing it is not the answer either.

import { registerSpecies } from './registry.js';

const SPORE = {
  TRIGGER_CHANCE: 0.33,
  COOLDOWN_SECONDS: 8,
  BURST_RADIUS: 92, // the initial bloom
  HOP_RADIUS: 62, // how far the rot jumps from each victim
  ROT_SECONDS: 5,
  ROT_PER_SECOND: 5.5,
  DEATH_RADIUS: 118, // the bloom on death is wider — the fungus fruits
};

/**
 * Infect everything in `radius` of (x, y), then let the rot jump ONE hop from each
 * of those victims. Shared by the ability and the death burst so both spread the
 * same way.
 *
 * Bounded on purpose: a hop count above one, or hops that re-hop, chains through
 * an entire team from a single proc. One hop is contagious; two is a wipe.
 */
function bloom(self, ctx, x, y, radius) {
  const seen = new Set();
  const infect = (victim) => {
    if (!victim.alive || seen.has(victim.id)) return;
    seen.add(victim.id);
    ctx.applyStatus(
      victim,
      {
        type: 'cordyceps',
        label: 'Infested',
        duration: ctx.seconds(SPORE.ROT_SECONDS),
        damagePerSecond: SPORE.ROT_PER_SECOND,
        preventHeal: true, // nothing closes a fungal wound
      },
      self
    );
  };

  // `enemiesInRadius` measures from an AGENT, so probe with a lightweight stand-in
  // positioned at the blast centre / at each victim.
  const probeAt = (px, py, r) => ctx.enemiesInRadius({ x: px, y: py, team: self.team }, r);

  const first = probeAt(x, y, radius);
  for (const victim of first) infect(victim);
  for (const victim of first) {
    for (const neighbour of probeAt(victim.x, victim.y, SPORE.HOP_RADIUS)) infect(neighbour);
  }

  ctx.spawnEffect({ kind: 'brood', x, y, radius, team: self.team });
  return seen.size;
}

const zombieAnt = {
  id: 'zombieAnt',
  name: 'Zombie Ant',
  tier: 'soldier',
  flavor:
    'The ant died days ago. What is walking is the fungus — and it fruits again the moment you put the body down.',

  stats: {
    maxHealth: 76, // the dead are not fragile
    speed: 1.5, // but they are not quick either
    size: 8,
    damage: 4,
    attackRange: 16,
    attackCooldown: 46,
    visionRange: 200,
  },

  visual: {
    type: 'sprite',
    sprite: 'zombieAnt',
    spriteExt: 'svg',
    spriteScale: 2.25,
    spriteFacing: 'up',
    shape: 'ellipse',
    color: '#9aa77e', // fungal grey-green
    stroke: '#222a16',
    size: 8,
  },

  ability: {
    name: 'Cordyceps Bloom',
    description:
      'Fruits a cloud of spores. Everything caught rots and cannot be healed — and passes it to whatever is next to it.',
    triggerChance: SPORE.TRIGGER_CHANCE,
    cooldownSeconds: SPORE.COOLDOWN_SECONDS,
    telegraphColor: '#c3d98a',
    requiresTarget: false,
    log: (self, target, res) => {
      const n = res?.infected ?? 0;
      return n > 2
        ? `${self.species.name} spread the rot to ${n} of them!`
        : `${self.species.name} fruited a cloud of spores.`;
    },
    onTrigger(self, target, ctx) {
      return { infected: bloom(self, ctx, self.x, self.y, SPORE.BURST_RADIUS) };
    },
  },

  hooks: {
    // Killing it releases the fruiting body — a wider bloom than the ability. The
    // engine fires this while the corpse still has a valid position.
    on_death(self, ctx) {
      bloom(self, ctx, self.x, self.y, SPORE.DEATH_RADIUS);
    },
  },

  // Damp, soft, and organic — nothing about this sounds like an insect.
  sfx: {
    attack: [{ src: 'noise', filter: 'lowpass', f0: 700, f1: 300, dur: 0.05, gain: 0.16 }],
    ability: [
      { src: 'noise', filter: 'lowpass', f0: 1100, f1: 260, dur: 0.5, gain: 0.3 }, // the puff
      { src: 'tone', wave: 'sine', f0: 70, f1: 40, dur: 0.44, gain: 0.2 }, // something under it
    ],
    death: [
      { src: 'noise', filter: 'lowpass', f0: 900, f1: 200, dur: 0.6, gain: 0.3 },
      { src: 'tone', wave: 'sine', f0: 120, f1: 34, dur: 0.5, gain: 0.22 },
    ],
  },
};

export default zombieAnt;
registerSpecies(zombieAnt);
