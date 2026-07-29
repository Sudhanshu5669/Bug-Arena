// UI kernel: the screen router, toast, animated counters, scroll fades and the
// two responsive classes. Motion here follows UI spec 09 exactly — everything
// animates transform and opacity only; no layout property is ever animated.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// --- Responsive classes ----------------------------------------------------
// CSS owns the breakpoints; this mirrors them onto <html> so screen code can
// branch on exactly the same rule rather than re-deriving one from innerWidth.
const mqWide = window.matchMedia('(min-aspect-ratio: 1/1)');
const mqDesktop = window.matchMedia('(min-width: 1000px)');
const mqShort = window.matchMedia('(max-height: 699px)');

export const layout = {
  get wide() { return mqWide.matches; },
  get desktop() { return mqDesktop.matches; },
  get short() { return mqShort.matches; },
};

function syncLayout() {
  const el = document.documentElement;
  el.classList.toggle('wide', mqWide.matches);
  el.classList.toggle('desktop', mqDesktop.matches);
  el.classList.toggle('short', mqShort.matches);
}
[mqWide, mqDesktop, mqShort].forEach((m) => m.addEventListener('change', () => {
  syncLayout();
  window.dispatchEvent(new CustomEvent('cg:layout'));
}));
syncLayout();

// --- Screen router ---------------------------------------------------------
// Outgoing fades and shrinks over 180ms; incoming rises and fades over 220ms,
// starting 120ms in so the two overlap. Screens never slide.
const screens = new Map();
let current = null;

export function registerScreen(name, controller) {
  screens.set(name, controller);
}

export function activeScreen() {
  return current;
}

export function go(name, params = {}) {
  const next = screens.get(name);
  if (!next) throw new Error(`Unknown screen "${name}"`);
  const prev = current;
  if (prev === name) {
    screens.get(name).enter?.(params);
    return;
  }

  if (prev) {
    const prevEl = document.getElementById(`screen-${prev}`);
    screens.get(prev).leave?.();
    prevEl.classList.remove('is-active');
    prevEl.classList.add('is-leaving');
    setTimeout(() => prevEl.classList.remove('is-leaving'), 180);
  }

  current = name;
  const show = () => {
    const el = document.getElementById(`screen-${name}`);
    el.classList.add('is-active');
    next.enter?.(params);
    // Focus order follows visual order; moving focus to the screen root keeps
    // the keyboard ring in sync with what is on screen.
    el.setAttribute('tabindex', '-1');
    if (document.activeElement && document.activeElement !== document.body) el.focus({ preventScroll: true });
  };
  if (prev && !reduced()) setTimeout(show, 120);
  else show();
}

// --- Toast -----------------------------------------------------------------
// One at a time; a new toast replaces the old instantly rather than queueing.
let toastEl = null;
let toastTimer = null;

export function toast(html) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'toast';
    toastEl.setAttribute('role', 'status');
    document.body.appendChild(toastEl);
  }
  clearTimeout(toastTimer);
  toastEl.innerHTML = html;
  // Force a reflow so a replacement toast re-runs the entrance.
  toastEl.classList.remove('is-up');
  void toastEl.offsetWidth;
  toastEl.classList.add('is-up');
  toastTimer = setTimeout(() => toastEl.classList.remove('is-up'), 2200);
}

// --- Counters --------------------------------------------------------------
// Values count to their target over 480ms ease-out and flash their delta colour
// for 240ms. A "+196" ghost floats 12px up and fades over 600ms.
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

export function countTo(el, to, { prefix = '', suffix = '', ghost = false } = {}) {
  const from = Number(String(el.dataset.value ?? el.textContent).replace(/[^\d-]/g, '')) || 0;
  el.dataset.value = String(to);
  const delta = to - from;

  if (delta !== 0 && ghost) floatGhost(el, delta);
  if (delta !== 0) {
    el.classList.add('is-flash');
    setTimeout(() => el.classList.remove('is-flash'), 240);
  }

  if (reduced() || delta === 0) {
    el.textContent = `${prefix}${to}${suffix}`;
    return;
  }
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / 480);
    el.textContent = `${prefix}${Math.round(from + delta * easeOut(p))}${suffix}`;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function floatGhost(el, delta) {
  const host = el.offsetParent ? el : el.parentElement;
  if (!host) return;
  const g = document.createElement('span');
  g.className = 'delta-ghost';
  g.textContent = `${delta > 0 ? '+' : ''}${delta}`;
  if (delta < 0) g.style.color = 'var(--danger)';
  const r = el.getBoundingClientRect();
  g.style.left = `${r.left + r.width / 2}px`;
  g.style.top = `${r.top - 4}px`;
  g.style.position = 'fixed';
  document.body.appendChild(g);
  setTimeout(() => g.remove(), 620);
}

// --- Scroll fades ----------------------------------------------------------
// A 36px bottom fade (24px right, for horizontal trays) whenever a region
// overflows, removed once the scroll reaches the end.
export function watchFade(host) {
  if (!host) return;
  const scroller = host.querySelector('[data-scroll]');
  if (!scroller) return;
  const update = () => {
    // Read the axis each time: the deploy tray flips from a horizontal
    // thumb-strip to a vertical grid when the layout goes wide.
    const horizontal = host.classList.contains('is-horizontal');
    const size = horizontal
      ? scroller.scrollWidth - scroller.clientWidth
      : scroller.scrollHeight - scroller.clientHeight;
    const pos = horizontal ? scroller.scrollLeft : scroller.scrollTop;
    host.classList.toggle('no-overflow', size <= 2);
    host.classList.toggle('at-end', pos >= size - 2);
  };
  scroller.addEventListener('scroll', update, { passive: true });
  window.addEventListener('cg:layout', update);
  new ResizeObserver(update).observe(scroller);
  // Content grows and shrinks as screens re-render, not only on resize.
  new MutationObserver(update).observe(scroller, { childList: true, subtree: true });
  update();
  return update;
}

// --- Small helpers ---------------------------------------------------------
export function el(tag, className, html) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (html != null) n.innerHTML = html;
  return n;
}

/** Escape interpolated game strings before they reach innerHTML. */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/** Render a 0–3 star row. `animate` fires the sequential pop on the filled pips. */
export function starRow(filled, animate = false) {
  const pips = [0, 1, 2].map((i) => `<span class="pip${i < filled ? ' is-on' : ''}">★</span>`).join('');
  return `<div class="stars${animate ? ' is-animating' : ''}" role="img" aria-label="${filled} of 3 stars">${pips}</div>`;
}

/** Inline star text for level cards: ★ earned, ☆ available, blank when locked. */
export function starText(state, stars) {
  if (state === 'locked') return '';
  if (state === 'cleared') return '★'.repeat(stars) + '☆'.repeat(3 - stars);
  return '☆☆☆';
}

export function fmtTime(seconds) {
  return `${Number(seconds).toFixed(1)}s`;
}
