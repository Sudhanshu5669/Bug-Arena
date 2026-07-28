// Persistence.
//
// IMPORTANT: this must never throw. The game ships to portals, where it runs
// inside a cross-origin iframe — and a browser blocking third-party storage makes
// `localStorage` throw on ACCESS, not just on write. A save system that assumes
// storage exists takes the whole game down on exactly the platform it was built
// for. So every path here falls back to an in-memory store: the player silently
// loses persistence between sessions instead of losing the game.

const KEY = 'colony-gladiator/v1';

/** In-memory stand-in used when real storage is unavailable. */
const memory = new Map();

/** Resolve a working storage backend once, tolerating every way it can fail. */
const backend = (() => {
  try {
    const probe = '__cg_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    console.warn('[save] localStorage unavailable — progress will not survive a reload.');
    return {
      getItem: (k) => (memory.has(k) ? memory.get(k) : null),
      setItem: (k, v) => memory.set(k, v),
      removeItem: (k) => memory.delete(k),
    };
  }
})();

/** True when progress actually survives a reload (surfaced in the UI). */
export const isPersistent = backend === (typeof window !== 'undefined' ? window.localStorage : null);

const EMPTY = Object.freeze({
  version: 1,
  run: null, // the in-progress run, or null
  meta: {
    unlocked: [], // species ids unlocked beyond the starter pool
    bestDepth: 0,
    runsWon: 0,
    runsPlayed: 0,
    ascension: 0, // highest difficulty tier cleared
    totalKills: 0,
  },
});

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

export function load() {
  try {
    const raw = backend.getItem(KEY);
    if (!raw) return clone(EMPTY);
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== EMPTY.version) return clone(EMPTY);
    // Merge onto the empty shape so a save written by an older build that lacked
    // a field still loads instead of producing undefined-shaped state downstream.
    return { ...clone(EMPTY), ...parsed, meta: { ...EMPTY.meta, ...(parsed.meta ?? {}) } };
  } catch (err) {
    console.warn('[save] could not read save; starting fresh.', err);
    return clone(EMPTY);
  }
}

export function save(state) {
  try {
    backend.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    // Quota exceeded, storage disabled mid-session, serialization cycle — none of
    // these are worth interrupting play for.
    console.warn('[save] could not write save.', err);
    return false;
  }
}

export function clearSave() {
  try {
    backend.removeItem(KEY);
  } catch {
    /* nothing to do — the next load falls back to EMPTY anyway */
  }
}
