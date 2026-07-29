// Persistent player state.
//
// The title screen's storage warning is driven from here: if localStorage is
// unavailable (private mode, an embedding portal), the game still runs fully —
// it just tells the player their progress will not survive a reload, and the
// warning line's 20px is reserved on the title screen whether or not it fires.

const KEY = 'colony-gladiator/v1';

const FRESH = {
  cleared: 0, // campaign levels cleared
  stars: {}, // levelIndex -> 0..3
  jelly: 0,
  owned: [], // specimen ids (seeded from the roster on first load)
  descent: null, // { chamber, roster: {id:count}, mutations: [], larvae, best }
  sound: true,
};

let data = { ...FRESH };
let storageOk = true;

export function storageAvailable() {
  return storageOk;
}

export function load(seedOwned) {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) data = { ...FRESH, ...JSON.parse(raw) };
    // Probe for real write access — reading can succeed where writing throws.
    localStorage.setItem(KEY + '/probe', '1');
    localStorage.removeItem(KEY + '/probe');
  } catch {
    storageOk = false;
    data = { ...FRESH };
  }
  if (!data.owned.length && seedOwned) {
    data.owned = [...seedOwned];
    save();
  }
  return data;
}

export function save() {
  if (!storageOk) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    storageOk = false;
  }
}

export function get() {
  return data;
}

export function reset() {
  data = { ...FRESH, owned: [...data.owned].slice(0, 2) };
  save();
}

// --- Derived readouts ------------------------------------------------------
export function totalStars() {
  return Object.values(data.stars).reduce((n, s) => n + s, 0);
}

export function starsFor(levelIndex) {
  return data.stars[levelIndex] ?? 0;
}

/** 'cleared' | 'next' | 'locked'. There is no free level select ahead of you. */
export function levelState(levelIndex) {
  if (levelIndex < data.cleared) return 'cleared';
  if (levelIndex === data.cleared) return 'next';
  return 'locked';
}

export function owns(id) {
  return data.owned.includes(id);
}

// --- Mutations -------------------------------------------------------------
export function acquire(id) {
  if (!data.owned.includes(id)) data.owned.push(id);
  save();
}

export function addJelly(n) {
  data.jelly = Math.max(0, data.jelly + n);
  save();
}

/**
 * Record a finished campaign level.
 * @returns {{ starsGained: number, firstClear: boolean }}
 */
export function recordClear(levelIndex, stars) {
  const prev = data.stars[levelIndex] ?? 0;
  const firstClear = levelIndex >= data.cleared;
  data.stars[levelIndex] = Math.max(prev, stars);
  if (firstClear) data.cleared = Math.max(data.cleared, levelIndex + 1);
  save();
  return { starsGained: Math.max(0, stars - prev), firstClear };
}

export function setSound(on) {
  data.sound = on;
  save();
}

// --- Endless Descent -------------------------------------------------------
export { DESCENT_DEPTH } from './data.js'; // fifteen chambers, one life

export function startDescent() {
  data.descent = { chamber: 1, roster: {}, mutations: [], larvae: 40, slain: 0, best: 0 };
  save();
  return data.descent;
}

export function endDescent() {
  data.descent = null;
  save();
}

export function descent() {
  return data.descent;
}
