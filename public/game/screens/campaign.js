// Campaign — The Descent (UI spec 03).
//
// The thirty levels render as a winding shaft: a dashed tunnel down the middle,
// slabs alternating left and right, a chapter divider every five chambers, the
// six Warlords as full-width corner-cut slabs, and a nest-floor endcap so the
// journey visibly ends. On entry the view auto-centres the NEXT slab.

import { $, esc, go, starText, watchFade, toast } from '../ui.js';
import { LEVELS, rankFor, glyph } from '../data.js';
import * as state from '../state.js';
import { session } from '../session.js';

let fade = null;

export function init() {
  $('#camp-continue').addEventListener('click', () => open(state.get().cleared));
  fade = watchFade($('#camp-scroll').parentElement);
}

function open(levelIndex) {
  if (levelIndex > state.get().cleared) {
    toast('That chamber is still sealed. Clear the one above it first.');
    return;
  }
  session.mode = 'campaign';
  go('deploy', { levelIndex });
}

function chips() {
  const s = state.get();
  const rows = [
    ['Rank', rankFor(s.cleared)],
    ['Cleared', `${s.cleared}/${LEVELS.length}`],
    ['Stars', `${state.totalStars()}/${LEVELS.length * 3}`],
    ['Jelly', String(s.jelly)],
  ];
  return rows
    .map(([k, v]) => `<div class="chip"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`)
    .join('');
}

function levelCard(lv, i) {
  const st = state.levelState(i);
  const stars = state.starsFor(i);
  const cls = [
    'lv',
    lv.warlord ? 'is-warlord' : '',
    st === 'locked' ? 'is-locked' : '',
    st === 'cleared' ? 'is-cleared' : '',
    st === 'next' ? 'is-next' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const name = st === 'locked' ? 'Locked' : lv.name;
  const pips = `<div class="stars-inline${st === 'cleared' ? ' is-earned' : ''}">${starText(st, stars)}</div>`;
  const flag = st === 'next' ? '<div class="next-flag">NEXT ▾</div>' : '';

  const body = lv.warlord
    ? `<div style="min-width:0;flex:1">
         <div class="warlord-mark">${glyph('flag', 11)}Warlord</div>
         <div class="name">${esc(name)}</div>
       </div>`
    : `<div class="name">${esc(name)}</div>`;

  return `<button class="${cls}" data-level="${i}"${st === 'locked' ? ' disabled aria-disabled="true"' : ''}>
      <div class="num">${lv.n}</div>
      ${body}
      ${pips}
      ${flag}
    </button>`;
}

export function enter() {
  $('#camp-chips').innerHTML = chips();

  const s = state.get();
  const done = s.cleared >= LEVELS.length;
  $('#camp-continue').textContent = done ? 'Replay' : 'Continue ▸';

  const path = $('#camp-path');
  const parts = [];
  LEVELS.forEach((lv, i) => {
    if (i % 5 === 0) {
      parts.push(
        `<div class="chapter-rule"><span>Chambers ${i + 1}–${i + 5}</span></div>`
      );
    }
    const card = levelCard(lv, i);
    parts.push(
      lv.warlord
        ? card
        : `<div class="lv-slot ${i % 2 ? 'is-right' : 'is-left'}">${card}</div>`
    );
  });
  parts.push(`<div class="nest-floor">${glyph('skull', 12)} The Nest Floor ${glyph('skull', 12)}</div>`);
  path.innerHTML = parts.join('');

  path.onclick = (e) => {
    const btn = e.target.closest('.lv');
    if (btn && !btn.disabled) open(Number(btn.dataset.level));
  };

  // Auto-centre the next chamber so the player never has to hunt for it.
  requestAnimationFrame(() => {
    const next = path.querySelector('.lv.is-next') || path.querySelector('.lv:last-of-type');
    if (next) {
      const scroll = $('#camp-scroll');
      scroll.scrollTop = Math.max(
        0,
        next.offsetTop - scroll.clientHeight / 2 + next.offsetHeight / 2
      );
    }
    fade?.();
  });
}
