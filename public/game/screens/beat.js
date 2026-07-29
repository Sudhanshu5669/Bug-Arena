// Endless Descent end-of-chamber beats (UI spec 06): mutation reward on a win,
// game over on a loss, victory at the nest floor. All three reuse the result
// screen's single centred column — the beat stays single-focus, never
// side-by-side.

import { $, esc, go, toast, fmtTime } from '../ui.js';
import { MUTATIONS, descentIncome } from '../data.js';
import * as state from '../state.js';
import { session } from '../session.js';

/** Three choices: two commons and, sometimes, the rare one that glows. */
function offer(taken) {
  const pool = MUTATIONS.filter((m) => !taken.includes(m.id));
  const commons = pool.filter((m) => !m.rare);
  const rares = pool.filter((m) => m.rare);
  const picked = [];
  const draw = (from) => {
    if (!from.length) return;
    picked.push(from.splice(Math.floor(Math.random() * from.length), 1)[0]);
  };
  draw(commons);
  if (rares.length && Math.random() < 0.4) draw(rares);
  else draw(commons);
  draw(commons.length ? commons : rares);
  return picked.filter(Boolean).slice(0, 3);
}

function mutationCard(m) {
  return `<button class="mutation ${m.rare ? 'is-rare' : ''}" data-mut="${m.id}">
      ${m.rare ? '<span class="rare-tag">★ RARE</span>' : ''}
      <span class="t">${esc(m.name)}</span>
      <span class="d">${esc(m.desc)}</span>
    </button>`;
}

function glow(color) {
  $('#beat-glow').style.background = `radial-gradient(500px 340px at 50% 0%, ${color}, transparent)`;
}

// --- The three beats --------------------------------------------------------

function reward(run, summary) {
  glow('rgba(232,163,61,0.14)');
  const choices = offer(run.mutations);
  // Clearing a chamber always pays; the choice is whether to bank that pay as a
  // permanent mutation or take it as larvae you can spend on bodies right now.
  const income = descentIncome(run.chamber, session.roster);
  const consolation = Math.round(income * 1.5);

  $('#beat-col').innerHTML = `
    <div class="eyebrow">Chamber ${run.chamber} cleared</div>
    <div class="headline is-win" style="font-size:26px">The colony holds</div>
    <div style="font:600 12px/1.2 var(--f-num);color:var(--muted)">
      ${summary.survivors} survivors · ${summary.enemiesSlain} slain · ${fmtTime(summary.durationSeconds)}
    </div>
    <div style="font:600 11px/1.2 var(--f-num);letter-spacing:.14em;color:var(--faint);margin-top:6px">
      CHOOSE A MUTATION
    </div>
    <div class="mutations">${choices.map(mutationCard).join('')}</div>
    <button class="btn-link" id="beat-skip">Take ${consolation} larvae instead</button>
  `;

  const advance = () => {
    // The colony that walks out is the colony that walks on. Losses are
    // permanent — that is what makes each chamber's draft a real decision
    // rather than a formality.
    run.roster = { ...summary.survivingRoster };
    run.chamber += 1;
    run.slain += summary.enemiesSlain;
    run.best = Math.max(run.best, summary.enemiesSlain);
    state.save();
    if (run.chamber > state.DESCENT_DEPTH) victory(run);
    else go('draft');
  };

  $('#beat-col').querySelectorAll('.mutation').forEach((btn) =>
    btn.addEventListener('click', () => {
      run.mutations.push(btn.dataset.mut);
      // A mutation is the permanent option, so it pays less larvae than taking
      // the payout outright — that is the trade the screen is asking about.
      run.larvae += income;
      toast(`<strong>${esc(MUTATIONS.find((m) => m.id === btn.dataset.mut).name)}</strong> takes hold.`);
      advance();
    })
  );
  $('#beat-skip').addEventListener('click', () => {
    run.larvae += consolation;
    advance();
  });
}

function gameOver(run, summary) {
  glow('rgba(217,88,74,0.12)');
  const foe = session.plan?.lineup?.[0]?.name ?? 'the deep nest';
  $('#beat-col').innerHTML = `
    <div class="headline is-loss" style="font-size:30px">The colony falls</div>
    <div style="font-size:12px;color:var(--muted);font-style:italic">
      Overrun in chamber ${run.chamber} by ${esc(foe)}.
    </div>
    <div style="font:600 12px/1.2 var(--f-num);color:var(--muted)">
      ${run.chamber - 1} chambers · ${run.slain + summary.enemiesSlain} slain · best strength ${run.best || summary.enemiesSlain}
    </div>
    <button class="btn btn-primary" id="beat-again">Found a new colony</button>
    <button class="btn-link" id="beat-menu">Back to menu</button>
  `;
  state.endDescent();
  $('#beat-again').addEventListener('click', () => {
    state.startDescent();
    go('draft');
  });
  $('#beat-menu').addEventListener('click', () => go('title'));
}

function victory(run) {
  glow('rgba(232,163,61,0.2)');
  const chambers = state.DESCENT_DEPTH;
  const slain = run.slain;
  const finalStrength = run.best;
  state.endDescent();
  $('#beat-col').innerHTML = `
    <div class="headline is-victory" style="font-size:30px">The old queen falls</div>
    <div style="font:600 12px/1.2 var(--f-num);color:var(--muted)">
      ${chambers} chambers · ${slain} slain · final strength ${finalStrength}
    </div>
    <button class="btn btn-primary" id="beat-again">Descend again, harder</button>
    <button class="btn-link" id="beat-menu">Back to menu</button>
  `;
  $('#beat-again').addEventListener('click', () => {
    state.startDescent();
    go('draft');
  });
  $('#beat-menu').addEventListener('click', () => go('title'));
}

export function enter() {
  const run = state.descent();
  const summary = session.summary;
  if (!summary) return go('title');
  if (!run) return go('title');

  if (summary.winner === 'A') reward(run, summary);
  else gameOver(run, summary);
}
