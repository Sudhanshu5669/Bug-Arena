// Deploy — the sand (UI spec 04). The screen the player lives in.
//
// Two placement gestures share one model: arm a tray card then tap the sand, or
// drag a card straight onto it. Placed units can be dragged to reposition and
// flicked out of the zone to remove. "Start the fight" lives in the tools row at
// every size, so it can never scroll out of the viewport.

import { $, $$, esc, go, toast, watchFade, layout, countTo } from '../ui.js';
import { glyph, levelPlan, descentPlan, LEVELS } from '../data.js';
import * as paint from '../paint.js';
import * as state from '../state.js';
import { session, spec, spent, unitCap } from '../session.js';

let armed = null; // species id waiting for a tap on the sand
let filter = 'all';
let dragging = null; // { id, art, from } — a card or a placed unit in flight
let ghost = null;
let rejectFlash = 0;
let enemyUnits = [];
let trayFade = null;

const sand = () => $('#sand');

// --- Painting ---------------------------------------------------------------

function repaint() {
  paint.paintSand(sand(), [...enemyUnits, ...session.placed], {
    ghost,
    reject: rejectFlash > Date.now(),
  });
}

// --- Tray -------------------------------------------------------------------

function countOf(id) {
  return session.placed.filter((u) => u.id === id).length;
}

function trayCard(sp) {
  const n = countOf(sp.id);
  const afford = spent() + sp.cost <= session.plan.larvae;
  const dim = !afford && n === 0;
  const cls = [
    'tray-card',
    armed === sp.id ? 'is-armed' : '',
    n > 0 ? 'has-count' : '',
    dim ? 'is-dim' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return `<div class="${cls}" data-sp="${sp.id}" draggable="true" role="button" tabindex="0"
        aria-label="${esc(sp.name)}, ${sp.cost} larvae, ${n} placed">
      <div class="head">
        <span class="roundel sz-30"><img src="${sp.art}" alt="" /></span>
        <div style="min-width:0">
          <div class="n">${esc(sp.name)}</div>
          <div class="a">${esc(sp.ability)}</div>
        </div>
      </div>
      <div class="price">
        <span class="p">${sp.cost}</span><span class="u">larvae</span>
        <button class="step" data-act="dec" aria-label="Remove one ${esc(sp.name)}">−</button>
        <button class="step is-add" data-act="inc" aria-label="Add one ${esc(sp.name)}">+</button>
      </div>
      ${n ? `<div class="count-badge">×${n}</div>` : ''}
      ${armed === sp.id ? '<div class="armed-flag">TAP THE SAND</div>' : ''}
    </div>`;
}

function renderTray() {
  // Write into the scroller, never over it — the fade wrapper and the scroll
  // element itself have to survive every re-render.
  const scroller = $('#deploy-tray-host [data-scroll]');
  const owned = session.roster.filter((s) => state.owns(s.id));

  if (!owned.length) {
    scroller.innerHTML = `<div class="empty">
        <span class="glyph">${glyph('specimen', 26)}</span>
        <span class="copy">Nothing here yet. Clear campaign levels to acquire specimens.</span>
      </div>`;
    return;
  }

  let grid = scroller.querySelector('#deploy-tray');
  if (!grid) {
    scroller.innerHTML = '<div id="deploy-tray"></div>';
    grid = scroller.querySelector('#deploy-tray');
  }
  const shown = owned.filter((s) => filter === 'all' || s.tier === filter);
  grid.innerHTML = shown.map(trayCard).join('');
  trayFade?.();
}

// --- Placement --------------------------------------------------------------

function place(id, x, y) {
  const sp = spec(id);
  if (!sp) return false;
  if (!paint.inPlayerZone(x, y)) {
    rejectFlash = Date.now() + 260;
    toast('Your colony deploys on the left of the sand only.');
    return false;
  }
  if (session.placed.length >= unitCap()) {
    toast('The nest is full — no room for another body.');
    return false;
  }
  if (spent() + sp.cost > session.plan.larvae) {
    toast(`Not enough larvae — ${sp.name} costs ${sp.cost}.`);
    return false;
  }
  session.placed.push({ id, art: sp.art, team: 'a', x, y });
  return true;
}

function removeOne(id) {
  const i = session.placed.map((u) => u.id).lastIndexOf(id);
  if (i >= 0) session.placed.splice(i, 1);
}

/** The nearest placed unit to a point, within grab range. */
function unitAt(x, y) {
  const s = 0.052 * 0.9; // ring radius as a fraction of height
  let best = null;
  let bestD = Infinity;
  session.placed.forEach((u, i) => {
    const d = Math.hypot((u.x - x) * 1.6, u.y - y); // 8:5 aspect correction
    if (d < s * 1.6 && d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

// --- Chrome -----------------------------------------------------------------

function syncCounters() {
  const left = session.plan.larvae - spent();
  countTo($('#deploy-larvae'), left);
  $('#deploy-units').textContent = `${session.placed.length}/${unitCap()}`;
  const fight = $('#deploy-fight');
  fight.disabled = session.placed.length === 0;
}

function renderEnemy() {
  const card = $('#deploy-enemy');
  const lineup = session.plan.lineup;
  card.querySelector('.rows').innerHTML = lineup
    .map(
      (l) => `<div class="foe-row">
        <span class="roundel sz-24 is-foe"><img src="${l.art}" alt="" /></span>
        <span class="n">${esc(l.name)}</span><span class="a">${esc(l.ability)}</span>
        <span class="c">×${l.count}</span>
      </div>`
    )
    .join('');
  card.querySelector('.summary').textContent = lineup
    .map((l) => `${l.name} ×${l.count}`)
    .join(' · ');

  // Under 700px of height the card collapses to that one summary line; tapping
  // it expands the full lineup back.
  const collapsible = layout.short;
  card.classList.toggle('is-collapsible', collapsible);
  card.classList.toggle('is-collapsed', collapsible);
}

// --- Wiring -----------------------------------------------------------------

export function init() {
  $('#foe-glyph').innerHTML = glyph('flag', 11);
  $('#fight-glyph').innerHTML = glyph('sword', 16);
  trayFade = watchFade($('#deploy-tray-host'));

  // Filters
  $$('.tray-bar .filter-pill').forEach((btn) =>
    btn.addEventListener('click', () => {
      filter = btn.dataset.filter;
      $$('.tray-bar .filter-pill').forEach((b) => b.classList.toggle('is-on', b === btn));
      renderTray();
    })
  );

  // Tray: steppers, arming, keyboard.
  $('#deploy-tray-host').addEventListener('click', (e) => {
    const card = e.target.closest('.tray-card');
    if (!card) return;
    const id = card.dataset.sp;
    const step = e.target.closest('.step');
    if (step) {
      if (step.dataset.act === 'inc') {
        // The + button drops the unit into the first free slot in the zone.
        const n = session.placed.length;
        place(id, 0.08 + (n % 4) * 0.075, 0.18 + Math.floor(n / 4) * 0.13);
      } else {
        removeOne(id);
      }
      renderTray();
      syncCounters();
      repaint();
      return;
    }
    armed = armed === id ? null : id;
    renderTray();
  });
  $('#deploy-tray-host').addEventListener('keydown', (e) => {
    const card = e.target.closest('.tray-card');
    if (card && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      armed = armed === card.dataset.sp ? null : card.dataset.sp;
      renderTray();
    }
  });

  // Drag a card onto the sand.
  $('#deploy-tray-host').addEventListener('dragstart', (e) => {
    const card = e.target.closest('.tray-card');
    if (!card) return;
    dragging = { id: card.dataset.sp, from: 'tray' };
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', card.dataset.sp);
  });

  const cv = sand();
  cv.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!dragging) return;
    const p = paint.pointerToSand(cv, e);
    ghost = { ...p, art: spec(dragging.id)?.art };
    repaint();
  });
  cv.addEventListener('dragleave', () => {
    ghost = null;
    repaint();
  });
  cv.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!dragging) return;
    const p = paint.pointerToSand(cv, e);
    ghost = null;
    if (place(dragging.id, p.x, p.y)) {
      renderTray();
      syncCounters();
    }
    dragging = null;
    repaint();
  });

  // Pointer: tap to place an armed card, or drag a placed unit around.
  let held = null;
  cv.addEventListener('pointerdown', (e) => {
    const p = paint.pointerToSand(cv, e);
    const hit = unitAt(p.x, p.y);
    if (hit != null) {
      held = hit;
      session.placed[hit].selected = true;
      cv.setPointerCapture(e.pointerId);
      repaint();
      return;
    }
    if (armed) {
      if (place(armed, p.x, p.y)) {
        renderTray();
        syncCounters();
      }
      repaint();
    }
  });
  cv.addEventListener('pointermove', (e) => {
    if (held == null) return;
    const p = paint.pointerToSand(cv, e);
    session.placed[held].x = p.x;
    session.placed[held].y = p.y;
    repaint();
  });
  const release = () => {
    if (held == null) return;
    const u = session.placed[held];
    delete u.selected;
    // Dragged out of the deploy zone? That is how you take a unit back.
    if (!paint.inPlayerZone(u.x, u.y)) {
      session.placed.splice(held, 1);
      renderTray();
      syncCounters();
    }
    held = null;
    repaint();
  };
  cv.addEventListener('pointerup', release);
  cv.addEventListener('pointercancel', release);

  // Tools
  $('#deploy-tidy').addEventListener('click', () => {
    session.placed = paint.tidy(session.placed);
    repaint();
  });
  $('#deploy-clear').addEventListener('click', () => {
    session.placed = [];
    armed = null;
    renderTray();
    syncCounters();
    repaint();
  });
  $('#deploy-fight').addEventListener('click', () => {
    if (!session.placed.length) return;
    go('battle');
  });

  // Opposition card collapse toggle.
  $('#deploy-enemy').addEventListener('click', () => {
    const card = $('#deploy-enemy');
    if (card.classList.contains('is-collapsible')) card.classList.toggle('is-collapsed');
  });

  window.addEventListener('cg:layout', () => {
    // Portrait: a horizontal thumb-strip with a right-edge fade. Wide: a
    // vertical grid, so the fade has to move to the bottom edge with it.
    $('#deploy-tray-host').classList.toggle('is-horizontal', !layout.wide);
    if (session.plan) renderEnemy();
  });
  $('#deploy-tray-host').classList.toggle('is-horizontal', !layout.wide);
}

export function enter(params = {}) {
  const s = state.get();
  if (params.maker) {
    // Battle Maker: no level, no budget ceiling worth speaking of — a free fight
    // against a mirror of the deepest chamber you have cleared.
    session.mode = 'maker';
    session.levelIndex = Math.max(0, s.cleared - 1);
    session.plan = levelPlan(session.levelIndex, session.roster);
    session.plan.larvae = 120;
    $('#deploy-title').textContent = 'Battle Maker';
    $('#deploy-sub').textContent = 'A free fight. Nothing here is recorded.';
  } else if (session.mode === 'descent') {
    // The descent normally deploys itself straight from the draft; this branch
    // only runs if something routes here, and it must still have a plan.
    session.plan = descentPlan(session.chamber, session.roster);
    $('#deploy-title').textContent = `Chamber ${session.chamber}`;
    $('#deploy-sub').textContent = 'Arrange your colony, then send them in.';
  } else {
    session.levelIndex = params.levelIndex ?? session.levelIndex;
    const lv = LEVELS[session.levelIndex];
    session.plan = levelPlan(session.levelIndex, session.roster);
    $('#deploy-title').textContent = `${lv.n}. ${lv.name}`;
    $('#deploy-sub').textContent =
      state.starsFor(session.levelIndex) > 0
        ? 'You have cleared this before. Beat it cleaner for more stars.'
        : 'Arrange your colony, then send them in.';
  }

  // A boost taken on the loss screen is spent on exactly one attempt.
  if (session.boost) {
    session.plan.larvae += session.boost;
    $('#deploy-sub').textContent = `Reinforced: +${session.boost} larvae for this attempt.`;
    session.boost = 0;
  }

  session.placed = [];
  session.seed = null;
  armed = null;
  paint.reseed();
  enemyUnits = paint.enemyPositions(session.plan.lineup);

  // Warm the sprite cache; each arrival triggers one repaint.
  const seen = new Set();
  for (const sp of session.roster) {
    if (seen.has(sp.art)) continue;
    seen.add(sp.art);
    paint.loadArt(sp.art, repaint);
  }

  // Baseline the purse so it does not count down from the previous level's
  // remainder the moment the screen opens.
  $('#deploy-larvae').dataset.value = String(session.plan.larvae);

  renderEnemy();
  renderTray();
  syncCounters();
  repaint();
}
