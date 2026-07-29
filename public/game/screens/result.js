// Level result (UI spec 05).
//
// The win has a rhythm: verdict → rating → prize. The grant card lands last,
// after the stars, and it is the only element in the whole game with corner
// cuts, amber-glow and a 600ms entrance. On a loss it is absent — but the note
// line keeps its 18px so the buttons never jump between the two outcomes.

import { $, esc, go, starRow, toast, fmtTime } from '../ui.js';
import { glyph, grantFor, LEVELS } from '../data.js';
import * as state from '../state.js';
import { session } from '../session.js';

/**
 * Stars are earned for winning, for winning with most of the colony intact, and
 * for winning quickly — so replaying a cleared level for a better rating is a
 * real puzzle rather than a grind.
 */
function rate(summary, deployed) {
  if (summary.winner !== 'A') return 0;
  let stars = 1;
  if (summary.survivors >= Math.ceil(deployed * 0.5)) stars++;
  if (Number(summary.durationSeconds) <= 25) stars++;
  return Math.min(3, stars);
}

function tally(cells) {
  return `<div class="tally">${cells
    .map(
      (c) => `<div class="cell">
        <div class="v ${c.cls ?? ''}">${esc(c.v)}</div>
        <div class="k">${esc(c.k)}</div>
      </div>`
    )
    .join('')}</div>`;
}

function grantCard(sp) {
  return `<div id="lr-grant">
      <span class="roundel sz-64"><img src="${sp.art}" alt="" style="width:46px;height:46px" /></span>
      <div style="min-width:0">
        <div class="eyebrow">New specimen · pinned to your drawer</div>
        <div class="name">${esc(sp.name)} <span class="joins">joins your colony</span></div>
        <div class="desc"><em class="ability">${esc(sp.ability)}</em> — ${esc(sp.desc)}</div>
      </div>
      <div class="stamp is-grant">ACQUIRED</div>
    </div>`;
}

export function enter() {
  const summary = session.summary;
  if (!summary) {
    go('campaign');
    return;
  }

  const win = summary.winner === 'A';
  const deployed = session.placed.length || 1;
  const stars = rate(summary, deployed);
  const lv = LEVELS[session.levelIndex];
  const maker = session.mode === 'maker';

  // --- Bank the outcome before painting, so the screen reads real numbers ---
  let granted = null;
  let jelly = 0;
  if (win && !maker) {
    const before = state.starsFor(session.levelIndex);
    const { firstClear } = state.recordClear(session.levelIndex, stars);
    jelly = Math.round(28 * stars + summary.enemiesSlain * 4 * (firstClear ? 1 : 0.4));
    granted = firstClear ? grantFor(session.levelIndex, session.roster, state.get().owned) : null;
    if (granted) state.acquire(granted.id);
    state.addJelly(jelly);
    session.reward = { stars, jelly, granted, improved: stars > before };
  } else {
    session.reward = { stars: 0, jelly: 0, granted: null, improved: false };
  }

  $('#result-glow').style.background = `radial-gradient(500px 340px at 50% 0%, ${
    win ? 'rgba(232,163,61,0.14)' : 'rgba(217,88,74,0.10)'
  }, transparent)`;

  const eyebrow = maker
    ? 'Battle Maker'
    : `Level ${lv.n} ${win ? 'cleared' : 'failed'}`;

  const cells = [
    { k: 'Survivors', v: String(summary.survivors) },
    { k: 'Enemies slain', v: String(summary.enemiesSlain) },
    { k: 'Duration', v: fmtTime(summary.durationSeconds) },
    {
      k: 'Royal jelly',
      v: `+${jelly}`,
      cls: jelly > 0 ? 'is-good' : 'is-nil',
    },
  ];

  const note = maker
    ? 'Nothing here is recorded.'
    : win
      ? session.reward.improved
        ? 'A better rating than last time.'
        : 'The chamber is yours.'
      : 'Rebuild the lineup and try again — the same fight is waiting, so you can plan for it.';

  const nextLv = LEVELS[session.levelIndex + 1];
  const primary = maker
    ? 'Fight again'
    : win
      ? nextLv
        ? `Level ${nextLv.n}: ${nextLv.name} ▸`
        : 'Back to the descent'
      : 'Replay this level';
  const secondary = maker ? 'Back to title' : win ? 'Replay this level' : 'Level select';

  $('#result-col').innerHTML = `
    <div class="eyebrow">${esc(eyebrow)}</div>
    <div class="headline ${win ? 'is-win' : 'is-loss'}">${
      win ? 'The colony holds' : 'The colony breaks'
    }</div>
    ${starRow(stars, true)}
    ${tally(cells)}
    ${granted ? grantCard(granted) : ''}
    <div class="note">${esc(note)}</div>
    <button class="btn btn-primary" id="lr-primary">${esc(primary)}</button>
    <div class="actions">
      <button class="btn" id="lr-secondary">${esc(secondary)}</button>
      ${
        !win && !maker
          ? `<button class="btn btn-boost" id="lr-boost">${glyph('play', 12)} Watch an ad: +${boost()} larvae next attempt</button>`
          : ''
      }
    </div>
    <button class="btn-link" id="lr-select">Level select</button>
  `;

  $('#lr-primary').addEventListener('click', () => {
    if (maker) return go('deploy', { maker: true });
    if (!win) return go('deploy', { levelIndex: session.levelIndex });
    if (nextLv) return go('deploy', { levelIndex: session.levelIndex + 1 });
    return go('campaign');
  });
  $('#lr-secondary').addEventListener('click', () => {
    if (maker) return go('title');
    if (win) return go('deploy', { levelIndex: session.levelIndex });
    return go('campaign');
  });
  $('#lr-select').addEventListener('click', () => go(maker ? 'title' : 'campaign'));
  $('#lr-boost')?.addEventListener('click', () => {
    session.boost = boost();
    toast(`Reinforced — +${session.boost} larvae on your next attempt.`);
    $('#lr-boost').disabled = true;
  });
}

/** A meaningful but not decisive leg-up: a fifth of the level's purse. */
function boost() {
  return Math.max(8, Math.round((session.plan?.larvae ?? 40) * 0.2));
}
