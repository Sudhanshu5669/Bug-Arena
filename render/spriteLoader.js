// Browser sprite preloader. Loads one PNG per sprite-declaring species ONCE at
// startup into a SpriteCache — never per frame. Missing/failed images are simply
// skipped, so the renderer falls back to shapes and the sim never crashes.
//
// This is the browser-specific asset step (uses `Image`). A future headless
// videoRenderer would swap this for a node-canvas `loadImage()` loader while
// reusing the exact same SpriteCache + rendererAbstraction drawing code.

/**
 * @param {Array}  catalog   - init.catalog (species with visual descriptors)
 * @param {object} cache     - a SpriteCache to populate
 * @param {string} basePath  - e.g. '/assets/sprites'
 * @param {(loaded:number, total:number) => void} [onProgress]
 * @returns {Promise<void>} resolves once every image has loaded or failed
 */
export function preloadSprites(catalog, cache, basePath, onProgress) {
  const keys = [];
  for (const species of catalog) {
    const v = species.visual;
    if (!v || v.type !== 'sprite') continue;
    const key = v.sprite || v.spriteSheet;
    if (key && !cache.get(key) && !keys.includes(key)) keys.push(key);
  }

  let loaded = 0;
  const total = keys.length;
  if (total === 0) return Promise.resolve();

  return new Promise((resolve) => {
    const done = (key, img) => {
      if (img) cache.set(key, img);
      loaded += 1;
      onProgress?.(loaded, total);
      if (loaded === total) resolve();
    };

    for (const key of keys) {
      const img = new Image();
      img.onload = () => done(key, img);
      img.onerror = () => {
        console.warn(`[sprites] "${key}" not found at ${basePath}/${key}.png — using shape fallback.`);
        done(key, null);
      };
      img.src = `${basePath}/${key}.png`;
    }
  });
}
