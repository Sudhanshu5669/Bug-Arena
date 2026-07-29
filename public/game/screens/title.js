// Title screen (UI spec 02).
//
// The stat chips carry underfill bars so progress reads without being read, and
// the storage-warning line reserves its 20px whether or not it ever fires.

import { $, go, esc } from '../ui.js';
import { glyph, rankFor, LEVELS } from '../data.js';
import * as state from '../state.js';
import { session } from '../session.js';

function chip(k, v, pct) {
  return `<div class="stat-chip">
    <div class="k">${esc(k)}</div>
    <div class="v">${esc(v)}</div>
    <div class="fill" style="width:${pct}%"></div>
  </div>`;
}

export function init() {
  $('#orn-a').innerHTML = glyph('diamond', 10);
  $('#orn-b').innerHTML = glyph('diamond', 10);
  $('#orn-sword').innerHTML = glyph('sword', 14);
  $('#camp-glyph').innerHTML = glyph('sword', 22);

  $('#mode-campaign').addEventListener('click', () => go('campaign'));
  $('#mode-hatchery').addEventListener('click', () => go('hatchery'));
  $('#mode-maker').addEventListener('click', () => {
    session.mode = 'maker';
    go('deploy', { maker: true });
  });
  $('#mode-descent').addEventListener('click', () => {
    if (!state.descent()) state.startDescent();
    session.mode = 'descent';
    go('draft');
  });
  $('#mode-sandbox').addEventListener('click', () => {
    window.location.href = '/sandbox.html';
  });
}

export function enter() {
  const s = state.get();
  const owned = s.owned.length;
  const total = session.roster.length || 1;
  const cleared = s.cleared;

  $('#title-stats').innerHTML = [
    chip('Rank', rankFor(cleared), 0),
    chip('Chambers', `${cleared}/${LEVELS.length}`, (cleared / LEVELS.length) * 100),
    chip('Specimens', `${owned}/${total}`, (owned / total) * 100),
    chip('Jelly', String(s.jelly), 0),
  ].join('');

  const next = LEVELS[Math.min(cleared, LEVELS.length - 1)];
  $('#camp-sub').textContent =
    cleared >= LEVELS.length ? 'The descent is complete' : `Level ${next.n} · ${next.name}`;
  $('#maker-sub').textContent = `${owned} specimen${owned === 1 ? '' : 's'} acquired`;
  $('#hatch-sub').textContent = `${s.jelly} royal jelly`;

  const run = state.descent();
  const descentBtn = $('#mode-descent');
  descentBtn.classList.toggle('is-resumable', Boolean(run));
  $('#descent-sub').textContent = run
    ? 'Run in progress — resume'
    : 'Fifteen chambers, one life';

  // The warning line's space is always reserved; only its text is conditional.
  $('#title-warning').textContent = state.storageAvailable()
    ? ''
    : 'Storage is blocked here — progress will not survive a reload.';
}
