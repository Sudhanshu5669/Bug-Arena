// Shared enums/constants for the engine. Kept as plain data so both the engine
// and any renderer (browser, headless video) can reference the same vocabulary.

/** High-level behaviour states an agent can be in on any given tick. */
export const ACTIONS = Object.freeze({
  IDLE: 'idle',
  SEEK_FOOD: 'seek_food',
  EAT: 'eat',
  PURSUE: 'pursue',
  ATTACK: 'attack',
  TRAPPED: 'trapped', // immobilized by a status (e.g. webbed): cannot move or attack
  DEAD: 'dead',
});

/**
 * Event types emitted into each snapshot's `events` array. A renderer or a
 * future video-captioning layer consumes these; the engine never draws them.
 */
export const EVENTS = Object.freeze({
  BATTLE_START: 'battle_start',
  ATTACK: 'attack',
  DAMAGE: 'damage', // any HP loss applied (drives floating damage numbers)
  ABILITY: 'ability', // a signature ability actually fired (carries a readable `text`)
  DEATH: 'death',
  EFFECT: 'effect', // transient visual FX described by species hooks (burn, web, dash...)
  STATUS_APPLIED: 'status_applied',
  FOOD_SPAWN: 'food_spawn',
  FOOD_EATEN: 'food_eaten',
  BATTLE_OVER: 'battle_over',
});

export const TEAMS = Object.freeze({ A: 'A', B: 'B' });

/**
 * Battle behaviour modes.
 *  - AGGRESSIVE: agents hunt the nearest visible enemy, only foraging when none in sight.
 *  - PASSIVE:    agents forage; they only fight enemies that get close enough to threaten them.
 */
export const MODES = Object.freeze({ AGGRESSIVE: 'aggressive', PASSIVE: 'passive' });
