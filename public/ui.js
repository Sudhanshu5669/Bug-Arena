// Tiny shared UI helpers. No state, no rules — just the four things every screen
// module would otherwise redefine.

export const $ = (id) => document.getElementById(id);

/** Show exactly one `.screen`. Screens are sections with id `screen-<name>`. */
export function show(name) {
  for (const el of document.querySelectorAll('.screen')) {
    el.classList.toggle('active', el.id === `screen-${name}`);
  }
  // A screen change is a context change; anything scrolled halfway down from the
  // last one should not carry over into it.
  document.querySelector('.screen.active')?.scrollTo?.(0, 0);
}

let toastTimer = 0;
export function toast(text, ms = 2200) {
  const el = $('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/**
 * Sprite URL for a species card.
 *
 * Resolved against THIS MODULE rather than the document: an `img.src` in markup
 * resolves relative to the page, which breaks the moment a portal serves the
 * build from a subpath. `import.meta.url` follows the code wherever it is mounted.
 */
export function thumbUrl(sp) {
  const v = sp?.visual;
  if (!v || v.type !== 'sprite') return null;
  const key = v.sprite || v.spriteSheet;
  if (!key) return null;
  const rel = v.spriteExt === 'svg' ? `src/${key}.svg` : `${key}.png`;
  return new URL(`./assets/sprites/${rel}`, import.meta.url).href;
}

/** The little art blob used on every specimen card, with a colour-dot fallback. */
export function thumbHtml(sp) {
  const url = thumbUrl(sp);
  return url
    ? `<img src="${url}" alt="" loading="lazy" />`
    : `<span class="dot-art" style="background:${sp?.visual?.color || '#888'}"></span>`;
}
