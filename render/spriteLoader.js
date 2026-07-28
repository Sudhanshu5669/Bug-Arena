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
 * @param {string} basePath  - absolute URL to the sprite root, e.g. the result of
 *                             `new URL('../assets/sprites', import.meta.url).href`
 * @param {(loaded:number, total:number) => void} [onProgress]
 * @returns {Promise<void>} resolves once every image has loaded or failed
 */
export function preloadSprites(catalog, cache, basePath, onProgress) {
  // Resolve one image URL per unique sprite key. A species can opt into loading
  // its source SVG directly (crisp, no rasterization step needed) with
  // `visual.spriteExt: 'svg'`; otherwise the rasterized PNG under basePath is used.
  const entries = [];
  const seen = new Set();
  for (const species of catalog) {
    const v = species.visual;
    if (!v || v.type !== 'sprite') continue;
    const key = v.sprite || v.spriteSheet;
    if (!key || cache.get(key) || seen.has(key)) continue;
    seen.add(key);
    const url = v.spriteExt === 'svg' ? `${basePath}/src/${key}.svg` : `${basePath}/${key}.png`;
    entries.push({ key, url });
  }

  let loaded = 0;
  const total = entries.length;
  if (total === 0) return Promise.resolve();

  return new Promise((resolve) => {
    const done = (key, img) => {
      if (img) cache.set(key, img);
      loaded += 1;
      onProgress?.(loaded, total);
      if (loaded === total) resolve();
    };

    for (const { key, url } of entries) {
      const img = new Image();
      img.onload = () => done(key, img);
      img.onerror = () => {
        console.warn(`[sprites] "${key}" not found at ${url} — using shape fallback.`);
        done(key, null);
      };
      img.src = url;
    }
  });
}
