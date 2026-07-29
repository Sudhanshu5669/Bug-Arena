// The live match — everything that exists only between "Continue" and a result.
//
// Persistent progress lives in state.js; this is the scratch pad the Deploy,
// Battle and Result screens hand between each other. It is deliberately not
// saved: abandoning mid-fight should cost you the fight, not corrupt the save.

import { UNIT_CAP } from './data.js';

export const session = {
  roster: [], // every species, from the engine catalog
  byId: new Map(),

  mode: 'campaign', // 'campaign' | 'descent' | 'maker'
  levelIndex: 0,
  chamber: 1,
  plan: null, // { lineup, larvae, strength }

  placed: [], // [{ id, art, x, y }] — the player's units on the sand
  larvaeLeft: 0,
  seed: null,

  summary: null, // the engine's own summary of the last fight
  reward: null, // { specimen, jelly, stars }
};

export function setRoster(roster) {
  session.roster = roster;
  session.byId = new Map(roster.map((s) => [s.id, s]));
}

export function spec(id) {
  return session.byId.get(id);
}

/** Unit counts by species, in the shape the engine's custom roster expects. */
export function placedTeam() {
  const counts = new Map();
  for (const u of session.placed) counts.set(u.id, (counts.get(u.id) || 0) + 1);
  return [...counts.entries()].map(([species, count]) => ({ species, count }));
}

export function enemyTeam() {
  return (session.plan?.lineup ?? []).map((l) => ({ species: l.id, count: l.count }));
}

/** Larvae spent so far, and the cap the level allows. */
export function spent() {
  return session.placed.reduce((n, u) => n + (spec(u.id)?.cost ?? 0), 0);
}

export function unitCap() {
  // The nest holds this many bodies — the same limit the opposition is built
  // under, and the number the "nest is full" toast is talking about.
  return UNIT_CAP;
}
