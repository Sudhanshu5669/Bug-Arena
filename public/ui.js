// Tiny shared UI helpers. No state, no rules — just the handful of things every
// screen module would otherwise redefine.

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
    ? `<img src="${url}" alt="" loading="lazy" draggable="false" />`
    : `<span class="dot-art" style="background:${sp?.visual?.color || '#888'}"></span>`;
}

/** `#rrggbb` (or `#rgb`) -> `[r, g, b]`. Returns null for anything else. */
function parseHex(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
}

/**
 * The per-species tint, as an inline `style` attribute.
 *
 * Every species already declares a `visual.color` for the arena renderer. Feeding
 * that same colour to the card it appears on is what makes a tray of 44 cards
 * read as a collection of 44 organisms rather than 44 identical brown boxes — and
 * it costs nothing, because the data is already there.
 *
 * Emitted as three concrete values rather than one, so the stylesheet never has
 * to derive a colour at paint time. See the `--sp` note in game.css.
 */
export function tintStyle(sp) {
  const rgb = parseHex(sp?.visual?.color);
  if (!rgb) return '';
  const [r, g, b] = rgb;
  return `style="--sp:rgb(${r},${g},${b});--sp-soft:rgba(${r},${g},${b},0.34);--sp-faint:rgba(${r},${g},${b},0.15)"`;
}

/** Same tint, applied to a live element (used by the title screen's swarm). */
export function applyTint(el, sp) {
  const rgb = parseHex(sp?.visual?.color);
  if (!el || !rgb) return;
  const [r, g, b] = rgb;
  el.style.setProperty('--sp', `rgb(${r},${g},${b})`);
  el.style.setProperty('--sp-soft', `rgba(${r},${g},${b},0.34)`);
  el.style.setProperty('--sp-faint', `rgba(${r},${g},${b},0.15)`);
}

/**
 * Write a number into an element and flash it if it actually changed.
 *
 * The currencies in this game are the whole meta-progression, and a counter that
 * silently swaps from 340 to 536 is a reward the player never sees arrive. The
 * class removes itself on animationend so repeated writes always re-fire.
 */
export function setNum(el, value) {
  if (!el) return;
  const next = String(value);
  if (el.textContent === next) return;
  const first = el.textContent === '' || el.dataset.primed !== '1';
  el.textContent = next;
  el.dataset.primed = '1';
  if (first) return;
  el.classList.remove('tick');
  // Force a reflow so the animation restarts even on back-to-back writes.
  void el.offsetWidth;
  el.classList.add('tick');
}
