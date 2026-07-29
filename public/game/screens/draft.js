// Endless Descent — draft (UI spec 06).
//
// Fifteen chambers, one life. You buy a colony with the larvae you carry, take a
// mutation between chambers, and lose everything when a chamber beats you. The
// scout report is the screen's honest warning: it compares your strength against
// the opposition's before you commit.

import { $, esc, go, toast, watchFade, countTo } from '../ui.js';
import { glyph, descentPlan, MUTATIONS, UNIT_CAP } from '../data.js';
import * as state from '../state.js';
import { session, spec } from '../session.js';

const roster = () => state.descent()?.roster ?? {};

function strength() {
  return Object.entries(roster()).reduce(
    (n, [id, c]) => n + (spec(id)?.cost ?? 0) * c,
    0
  );
}

function units() {
  return Object.values(roster()).reduce((n, c) => n + c, 0);
}

function draftCard(sp) {
  const run = state.descent();
  const owned = run.roster[sp.id] ?? 0;
  const afford = run.larvae >= sp.cost;
  return `<div class="draft-card ${owned ? 'is-owned' : ''} ${!afford && !owned ? 'is-poor' : ''}" data-sp="${sp.id}">
      <div class="head">
        <span class="roundel sz-38"><img src="${sp.art}" alt="" /></span>
        <div style="min-width:0">
          <div class="n">${esc(sp.name)}</div>
          <div class="a">${esc(sp.ability)}</div>
        </div>
        <span class="tier-tag ${sp.tier === 'champion' ? 'is-bug' : ''}">${sp.tag}</span>
      </div>
      <div class="stats">hp ${sp.hp} · dmg ${sp.dmg}</div>
      <div class="buy">
        <span class="p">${sp.cost}</span>
        ${owned ? `<span class="own">×${owned}</span>` : ''}
        <button class="step" data-act="dec" aria-label="Sell one ${esc(sp.name)}"${owned ? '' : ' disabled'}>−</button>
        <button class="step is-add step-lg" data-act="inc" aria-label="Draft one ${esc(sp.name)}"${
          afford ? '' : ' disabled'
        }>+</button>
      </div>
    </div>`;
}

function render() {
  const run = state.descent();
  if (!run) return;
  const plan = descentPlan(run.chamber, session.roster);
  session.plan = plan;
  session.chamber = run.chamber;

  const warlord = run.chamber % 5 === 0;
  $('#draft-title').textContent = warlord
    ? `Chamber ${run.chamber} · Warlord`
    : `Chamber ${run.chamber}`;
  const foeName = plan.lineup[0]?.name ?? 'the deep nest';
  $('#draft-sub').innerHTML = `Next: <strong style="color:var(--team-b)">${esc(
    warlord ? `${foeName} Warlord` : foeName
  )}</strong>`;
  countTo($('#draft-larvae'), run.larvae);

  $('#draft-drawer').innerHTML = session.roster.map(draftCard).join('');

  const rosterRows = Object.entries(run.roster).filter(([, c]) => c > 0);
  $('#draft-roster').innerHTML = rosterRows.length
    ? rosterRows
        .map(([id, c]) => {
          const sp = spec(id);
          return `<div class="roster-row" data-sp="${id}">
            <span class="roundel sz-22 is-ally"><img src="${sp.art}" alt="" /></span>
            <span class="n">${esc(sp.name)}</span>
            <span class="c">×${c}</span>
            <button class="step" data-act="dec" aria-label="Remove one ${esc(sp.name)}">−</button>
          </div>`;
        })
        .join('')
    : `<div class="empty" style="height:auto;padding:var(--sp-4) 0">
        <span class="copy">No units drafted. A colony of nobody loses to anybody.</span>
      </div>`;

  $('#draft-units').textContent = `${units()}/${UNIT_CAP}`;
  $('#draft-strength').textContent = String(strength());

  const mine = strength();
  const verdict =
    mine >= plan.strength * 1.15
      ? '<em class="verdict" style="color:var(--good)">You outweigh them.</em>'
      : mine >= plan.strength * 0.9
        ? '<em class="verdict" style="color:var(--muted)">An even match.</em>'
        : '<em class="verdict">They outweigh you.</em>';
  $('#draft-scout').innerHTML = `Scouts report <strong class="foe">${esc(
    foeName
  )}</strong> fielding roughly <strong class="num">${plan.strength}</strong> larvae of strength. ${verdict}`;

  $('#draft-muts').innerHTML = run.mutations.length
    ? run.mutations
        .map((id) => {
          const m = MUTATIONS.find((x) => x.id === id);
          return `<span class="mut-chip ${m.rare ? 'is-rare' : ''}">${m.rare ? '★ ' : ''}${esc(m.name)}</span>`;
        })
        .join('')
    : '<span class="mut-chip" style="opacity:.6">No mutations yet</span>';

  $('#draft-send').disabled = units() === 0;
}

function adjust(id, delta) {
  const run = state.descent();
  const sp = spec(id);
  if (!run || !sp) return;
  const have = run.roster[id] ?? 0;
  if (delta > 0) {
    if (units() >= UNIT_CAP) return toast('The nest is full — no room for another body.');
    if (run.larvae < sp.cost) return toast(`Not enough larvae — ${sp.name} costs ${sp.cost}.`);
    run.roster[id] = have + 1;
    run.larvae -= sp.cost;
  } else {
    if (!have) return;
    run.roster[id] = have - 1;
    if (!run.roster[id]) delete run.roster[id];
    run.larvae += sp.cost;
  }
  state.save();
  render();
}

export function init() {
  $('#send-glyph').innerHTML = glyph('sword', 16);
  watchFade($('#draft-drawer').parentElement);

  const onStep = (e) => {
    const step = e.target.closest('.step');
    const card = e.target.closest('[data-sp]');
    if (!step || !card || step.disabled) return;
    adjust(card.dataset.sp, step.dataset.act === 'inc' ? 1 : -1);
  };
  $('#draft-drawer').addEventListener('click', onStep);
  $('#draft-roster').addEventListener('click', onStep);

  $('#draft-send').addEventListener('click', () => {
    const run = state.descent();
    if (!run || !units()) return;
    // The drafted colony deploys itself: the descent's tension is the draft, not
    // the placement, so it skips the sand and goes straight to the fight.
    session.mode = 'descent';
    session.placed = [];
    let i = 0;
    for (const [id, count] of Object.entries(run.roster)) {
      const sp = spec(id);
      for (let k = 0; k < count; k++, i++) {
        session.placed.push({
          id,
          art: sp.art,
          team: 'a',
          x: 0.08 + (i % 4) * 0.075,
          y: 0.14 + Math.floor(i / 4) * 0.12,
        });
      }
    }
    session.seed = null;
    go('battle');
  });

  $('#draft-abandon').addEventListener('click', () => {
    state.endDescent();
    toast('The run is over. Your campaign progress is untouched.');
    go('title');
  });
}

export function enter() {
  if (!state.descent()) state.startDescent();
  render();
}
