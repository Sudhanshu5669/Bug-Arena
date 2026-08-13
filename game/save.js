// Persistence.
//
// IMPORTANT: this must never throw. The game ships to portals, where it runs
// inside a cross-origin iframe — and a browser blocking third-party storage makes
// `localStorage` throw on ACCESS, not just on write. A save system that assumes
// storage exists takes the whole game down on exactly the platform it was built
// for. So every path here falls back to an in-memory store: the player silently
// loses persistence between sessions instead of losing the game.
//
// There are three backends, in order of preference:
//
//   portal    the host's own save store (CrazyGames' data module). Syncs across
//             a signed-in player's devices, and works inside an iframe where
//             localStorage does not. Adopted by `useBackend()` once the portal
//             handshake resolves — it does not exist before then, which is why
//             this cannot simply be chosen at module load.
//   local     window.localStorage.
//   memory    a Map. Progress lasts as long as the tab.

const KEY = 'colony-gladiator/v1';

/** In-memory stand-in used when real storage is unavailable. */
const memory = new Map();

const memoryBackend = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, v),
  removeItem: (k) => memory.delete(k),
};

/** Resolve a working local backend once, tolerating every way it can fail. */
const localBackend = (() => {
  try {
    const probe = '__cg_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    console.warn('[save] localStorage unavailable — falling back to memory.');
    return null;
  }
})();

let backend = localBackend ?? memoryBackend;
let kind = localBackend ? 'local' : 'memory';

/**
 * Adopt the host's save store.
 *
 * Called from boot() with `portal.storage()` the moment the SDK handshake lands,
 * before anything reads a save. Anything already written to the fallback is
 * carried across, so a player who started while the SDK was still negotiating
 * does not lose the seconds before it arrived.
 *
 * @param {{getItem:Function,setItem:Function,removeItem:Function}|null} store
 * @returns {boolean} whether it was adopted
 */
export function useBackend(store) {
  if (!store) return false;
  try {
    // Prove it works before trusting the whole save system to it.
    const probe = '__cg_probe__';
    store.setItem(probe, '1');
    store.removeItem(probe);

    const carried = backend.getItem(KEY);
    backend = store;
    kind = 'portal';
    if (carried && !store.getItem(KEY)) store.setItem(KEY, carried);
    return true;
  } catch (err) {
    console.warn('[save] portal storage rejected; keeping the local one.', err);
    return false;
  }
}

/** True when progress actually survives a reload (surfaced in the UI). */
export function isPersistent() {
  return kind !== 'memory';
}

/** Which backend is live: 'portal' | 'local' | 'memory'. Diagnostics only. */
export function backendKind() {
  return kind;
}

const EMPTY = Object.freeze({
  version: 1,
  run: null, // the in-progress run, or null
  // Campaign progression + the ownership ledger the whole game reads from.
  // See game/progress.js for the shape; kept as a plain blob here so save.js
  // stays a storage concern and never a rules one.
  campaign: {
    coins: 0,
    cleared: {},
    bought: [],
    granted: [],
    totalKills: 0,
    battlesWon: 0,
  },
  meta: {
    unlocked: [], // species ids unlocked beyond the starter pool
    bestDepth: 0,
    runsWon: 0,
    runsPlayed: 0,
    ascension: 0, // highest difficulty tier cleared
    totalKills: 0,
    seenHowto: false,
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
    // The nested blobs are merged key-by-key for the same reason: a save from
    // before the campaign existed has no `campaign` at all, and one from before
    // a field was added must not leave that field undefined.
    return {
      ...clone(EMPTY),
      ...parsed,
      meta: { ...EMPTY.meta, ...(parsed.meta ?? {}) },
      campaign: { ...clone(EMPTY.campaign), ...(parsed.campaign ?? {}) },
    };
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
