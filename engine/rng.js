// Small seeded PRNG (mulberry32). A seeded RNG makes every battle fully
// reproducible from its config — important for the future headless video
// pipeline, where the same seed must always render the same battle.

/**
 * @param {number} seed - 32-bit unsigned integer seed.
 * @returns {() => number} a function returning floats in [0, 1).
 */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generate a random 32-bit seed (used when the caller doesn't supply one). */
export function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
