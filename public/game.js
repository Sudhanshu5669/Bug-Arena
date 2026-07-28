// Colony Gladiator — the game shell.
//
// Owns screens, input and presentation. It holds NO rules: what a unit costs,
// what the enemy fields, what a victory pays and when a run ends all live in
// game/*.js, and the simulation lives in engine/*.js. This file's job is to show
// that state and turn taps into calls on it.
//
// Screen flow:
//   title -> draft -> battle -> result -> draft -> ... -> victory | over

import { CanvasRenderer } from './render/canvasRenderer.js';
import { ArenaAudio, ARENA_SFX } from './render/audio.js';
import { BugArenaEngine } from './engine/index.js';
import './species/index.js'; // side-effect: every species self-registers
import { getCatalog } from './species/registry.js';
import { Run, RUN_DEPTH, STARTER_POOL } from './game/run.js';
import { isBossDepth } from './game/campaign.js';
import * as store from './game/save.js';
import { portal } from './portal.js';

const $ = (id) => document.getElementById(id);
const catalog = getCatalog();
const byId = new Map(catalog.map((s) => [s.id, s]));

const audio = new ArenaAudio({ volume: 0.55 });

let saved = store.load();
let run = null;
let renderer = null;
let engine = null;
let rafStarted = false;
let speed = 1;
let filter = 'all';
let battleResolved = false;

// --- screens -----------------------------------------------------------------

function show(name) {
  for (const el of document.querySelectorAll('.screen')) el.classList.toggle('active', el.id === `screen-${name}`);
}

function toast(text, ms = 2200) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms);
}

function persist() {
  saved.run = run ? run.toJSON() : null;
  store.save(saved);
}

// --- title -------------------------------------------------------------------

function renderTitle() {
  const m = saved.meta;
  // The starter pool is always available, so it counts toward what the player has
  // access to — reporting only the earned unlocks read as "you have 1 species".
  const unlockedCount = new Set([...STARTER_POOL, ...m.unlocked]).size;
  const bits = [
    `<span>Deepest chamber <b>${m.bestDepth}</b></span>`,
    `<span>Runs won <b>${m.runsWon}</b></span>`,
    `<span>Species <b>${unlockedCount}</b> of <b>${catalog.length}</b></span>`,
  ];
  if (m.ascension > 0) bits.push(`<span>Ascension <b>${m.ascension}</b></span>`);
  if (!store.isPersistent) bits.push('<span style="color:var(--danger)">Progress will not be saved</span>');
  $('title-meta').innerHTML = bits.join('');

  // Only one primary action at a time. With a run in progress, resuming is the
  // obvious thing to want — so starting over demotes itself rather than sitting
  // beside it in the same colour competing for the same tap.
  const canResume = !!saved.run && saved.run.phase !== 'lost' && saved.run.phase !== 'won';
  $('btn-continue').hidden = !canResume;
  $('btn-new-run').classList.toggle('btn-primary', !canResume);
  $('btn-new-run').classList.toggle('btn-ghost', canResume);
  $('btn-new-run').textContent = canResume ? 'Abandon it and start over' : 'Found a colony';

  show('title');
}

// --- draft -------------------------------------------------------------------

/** Sprite URL for a species card, resolved against this module (not the document). */
function thumbUrl(sp) {
  const v = sp?.visual;
  if (!v || v.type !== 'sprite') return null;
  const key = v.sprite || v.spriteSheet;
  if (!key) return null;
  const rel = v.spriteExt === 'svg' ? `src/${key}.svg` : `${key}.png`;
  return new URL(`./assets/sprites/${rel}`, import.meta.url).href;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function renderDraft() {
  const prices = run.prices;
  const enemy = run.enemy;
  const boss = isBossDepth(run.depth);

  const tag = $('draft-depth');
  tag.textContent = boss ? `Chamber ${run.depth} · Warlord` : `Chamber ${run.depth}`;
  tag.classList.toggle('boss', boss);
  $('draft-foe').textContent = enemy.name;
  $('draft-purse').textContent = run.larvae;

  // Specimen drawer
  $('specimens').innerHTML = run.available
    .filter((sp) => filter === 'all' || sp.tier === filter)
    .map((sp) => {
      const price = prices[sp.id];
      const owned = run.roster[sp.id] ?? 0;
      const url = thumbUrl(sp);
      const st = sp.stats;
      const art = url
        ? `<img src="${url}" alt="" loading="lazy" />`
        : `<span style="width:26px;height:26px;border-radius:50%;background:${sp.visual?.color || '#888'}"></span>`;
      return `<div class="specimen ${owned ? 'owned' : ''} ${run.larvae < price && !owned ? 'unaffordable' : ''}" data-sp="${sp.id}">
          <div class="art">${art}</div>
          <div class="tier ${sp.tier}">${sp.tier === 'champion' ? 'Bug' : 'Ant'}</div>
          <div class="nm">${escapeHtml(sp.name)}</div>
          <div class="ab">${sp.ability ? escapeHtml(sp.ability.name) : 'No signature ability'}</div>
          <div class="stats">
            <span>hp <b>${Math.round(st.maxHealth)}</b></span>
            <span>dmg <b>${st.damage}</b></span>
          </div>
          <div class="buy-row">
            <span class="price">${price}</span>
            ${owned ? `<span class="have">×${owned}</span>` : ''}
            <button class="btn-small" data-act="sell" ${owned ? '' : 'disabled'} aria-label="Remove one ${escapeHtml(sp.name)}">−</button>
            <button class="btn-small" data-act="buy" ${run.larvae >= price && !run.atCap ? '' : 'disabled'} aria-label="Add one ${escapeHtml(sp.name)}">+</button>
          </div>
        </div>`;
    })
    .join('');

  renderColony();
}

function renderColony() {
  const entries = Object.entries(run.roster).sort((a, b) => b[1] - a[1]);
  $('roster-list').innerHTML = entries.length
    ? entries
        .map(([id, n]) => {
          const sp = byId.get(id);
          return `<div class="roster-row" data-sp="${id}">
            <span class="dot" style="background:${sp?.visual?.color || '#888'}"></span>
            <span class="nm">${escapeHtml(sp?.name ?? id)}</span>
            <span class="n">×${n}</span>
            <button class="btn-small" data-act="sell" aria-label="Remove one ${escapeHtml(sp?.name ?? id)}">−</button>
          </div>`;
        })
        .join('')
    : '<div class="empty">No units drafted. A colony of nobody loses to anybody.</div>';

  $('army-size').textContent = `${run.armySize}/${run.cap}`;
  $('army-value').textContent = run.armyValue;
  $('draft-purse').textContent = run.larvae;

  // The difficulty dial, shown plainly. A player who loses should be able to see
  // that they were outspent, not guess at it.
  const enemy = run.enemy;
  const ratio = run.armyValue / Math.max(1, enemy.budget);
  const read =
    ratio >= 1.15 ? 'You outweigh them.' : ratio >= 0.85 ? 'An even match.' : 'They outweigh you.';
  const capNote = run.atCap
    ? ' <b style="color:var(--amber)">The nest is full — sell a unit to make room for a better one.</b>'
    : '';
  $('scout-report').innerHTML =
    `Scouts report <b>${enemy.name}</b> fielding roughly <b>${enemy.budget}</b> larvae of strength. ${read}${capNote}`;

  $('mutation-chips').innerHTML = run.mutations.map((m) => `<span class="chip">${escapeHtml(m.name)}</span>`).join('');
  $('btn-fight').disabled = run.armySize === 0;
}

// --- battle ------------------------------------------------------------------

function startBattle() {
  const config = run.beginBattle();
  if (!config) return;
  persist();
  battleResolved = false;

  show('battle');
  $('battle-veil').classList.remove('show');
  $('btn-skip').disabled = false;

  engine = new BugArenaEngine(config);
  engine.setTimeScale(speed);

  const init = engine.getInitPayload();
  if (!renderer) renderer = new CanvasRenderer($('arena'), init, { format: 'wide', showreel: true });
  else renderer.setInit(init);

  engine.on('snapshot', onSnapshot);
  engine.on('end', onBattleEnd);

  if (!rafStarted) {
    rafStarted = true;
    // The reschedule is unconditional: a single throw inside a frame must not end
    // the render loop forever while the simulation carries on invisibly.
    let errors = 0;
    const loop = (t) => {
      requestAnimationFrame(loop);
      try {
        renderer?.render(t);
      } catch (err) {
        if (errors++ < 5) console.error('[render] frame failed:', err);
      }
    };
    requestAnimationFrame(loop);
  }

  portal.gameplayStart();
  engine.start();
}

function onSnapshot(snap) {
  renderer?.ingest(snap);
  const a = snap.score.A;
  const b = snap.score.B;
  $('score-a').textContent = a;
  $('score-b').textContent = b;
  $('score-track').style.width = `${(a / (a + b || 1)) * 100}%`;
  $('battle-clock').textContent = `${snap.time.toFixed(1)}s`;
  playSounds(snap.events);
}

function playSounds(events) {
  for (const ev of events) {
    switch (ev.type) {
      case 'attack': {
        const sfx = byId.get(ev.speciesId)?.sfx?.attack;
        if (sfx) audio.play(sfx, { gain: 0.5, key: `atk:${ev.speciesId}`, throttleMs: 90 });
        break;
      }
      case 'ability': {
        const sfx = byId.get(ev.casterSpecies)?.sfx?.ability;
        if (sfx) audio.play(sfx, { gain: 1, key: `ab:${ev.casterSpecies}`, throttleMs: 140 });
        break;
      }
      case 'death': {
        const sfx = byId.get(ev.victimSpecies)?.sfx?.death;
        if (sfx) audio.play(sfx, { gain: 0.85, key: `die:${ev.victimSpecies}`, throttleMs: 70 });
        break;
      }
      case 'battle_start':
        audio.play(ARENA_SFX.battleStart, { gain: 1, key: 'start', throttleMs: 1500 });
        break;
      case 'battle_over':
        audio.play(ev.winner === 'draw' ? ARENA_SFX.draw : ARENA_SFX.victory, { gain: 1, key: 'over', throttleMs: 1500 });
        break;
      default:
        break;
    }
  }
}

function onBattleEnd(summary) {
  if (battleResolved) return;
  battleResolved = true;
  portal.gameplayStop();

  const won = summary.winner === 'A';
  $('veil-title').textContent = won ? 'The colony holds' : 'The colony breaks';
  $('veil-title').style.color = won ? 'var(--good)' : 'var(--danger)';
  $('veil-sub').textContent = `${summary.totalKills} dead in ${summary.durationSeconds}s`;
  $('battle-veil').classList.add('show');
  $('btn-skip').disabled = true;

  // Let the renderer's outro play before cutting to the results plate.
  setTimeout(() => {
    const result = run.resolveBattle(summary);
    afterBattle(result);
  }, 1900);
}

/** Skip straight to the outcome — the fight is deterministic, so nothing is lost. */
function skipBattle() {
  if (!engine || battleResolved) return;
  $('btn-skip').disabled = true;
  engine.stop();
  const summary = engine.runToCompletion();
  onBattleEnd(summary);
}

// --- results -----------------------------------------------------------------

function afterBattle(result) {
  // Meta-progression is banked whatever happened — a lost run still moved the
  // account forward, which is the reason to start another one.
  saved.meta.bestDepth = Math.max(saved.meta.bestDepth, run.depth);
  saved.meta.totalKills += result.kills;
  if (result.unlocked && !saved.meta.unlocked.includes(result.unlocked)) {
    saved.meta.unlocked.push(result.unlocked);
  }

  if (run.phase === 'won') return showVictory();
  if (run.phase === 'lost') return showGameOver(result);

  if (result.revived) {
    persist();
    toast('The queen endures. The colony regroups.', 3200);
    renderDraft();
    show('draft');
    return;
  }

  showResult(result);
}

function showResult(result) {
  $('result-eyebrow').textContent = `Chamber ${run.depth} cleared`;
  $('result-title').textContent = 'The colony holds';
  $('result-title').className = 'win';

  const survivors = Object.values(result.survivors).reduce((a, b) => a + b, 0);
  $('result-tally').innerHTML = `
    <div><span class="v">${survivors}</span><span class="k">survivors</span></div>
    <div><span class="v">${result.kills}</span><span class="k">enemies slain</span></div>
    <div><span class="v gain">+${result.larvae}</span><span class="k">larvae</span></div>`;

  const un = $('result-unlock');
  if (result.unlocked) {
    un.hidden = false;
    un.textContent = `A new specimen joins the drawer: ${byId.get(result.unlocked)?.name ?? result.unlocked}.`;
  } else {
    un.hidden = true;
  }

  const offer = run.mutationOffer;
  $('mutation-grid').innerHTML = offer
    .map(
      (m) => `<button class="mutation" data-mut="${m.id}">
        ${m.rarity === 'rare' ? '<span class="rare">Rare</span>' : ''}
        <span class="mn">${escapeHtml(m.name)}</span>
        <span class="mt">${escapeHtml(m.text)}</span>
      </button>`
    )
    .join('');

  persist();
  show('result');
  portal.happytime();
}

function showGameOver(result) {
  saved.meta.runsPlayed += 1;
  saved.run = null;
  store.save(saved);

  $('over-sub').textContent = `The ${run.enemy.name} overran the nest at chamber ${run.depth}.`;
  $('over-tally').innerHTML = `
    <div><span class="v">${run.depth}</span><span class="k">chambers deep</span></div>
    <div><span class="v">${run.stats.kills}</span><span class="k">enemies slain</span></div>
    <div><span class="v">${run.stats.battlesWon}</span><span class="k">battles won</span></div>`;
  show('over');
}

function showVictory() {
  saved.meta.runsWon += 1;
  saved.meta.runsPlayed += 1;
  saved.meta.ascension = Math.max(saved.meta.ascension, run.ascension + 1);
  saved.run = null;
  store.save(saved);

  $('victory-sub').textContent = `The colony took the nest with ${run.armySize} still standing.`;
  $('victory-tally').innerHTML = `
    <div><span class="v">${run.stats.kills}</span><span class="k">enemies slain</span></div>
    <div><span class="v">${run.stats.battlesWon}</span><span class="k">battles won</span></div>
    <div><span class="v gain">${run.mutationIds.length}</span><span class="k">mutations</span></div>`;
  show('victory');
  portal.happytime();
}

// --- run lifecycle -----------------------------------------------------------

function newRun(ascension = 0) {
  run = Run.create({
    seed: (Math.random() * 0xffffffff) >>> 0,
    catalog,
    unlocked: saved.meta.unlocked,
    ascension,
  });
  persist();
  renderDraft();
  show('draft');
}

function resumeRun() {
  run = Run.restore(saved.run, catalog);
  if (run.phase === 'battle') run.phase = 'draft'; // a battle interrupted by a reload is re-fought
  if (run.phase === 'reward') {
    showResult(run.lastResult ?? { survivors: run.roster, kills: 0, larvae: 0, unlocked: null });
    return;
  }
  renderDraft();
  show('draft');
}

// --- wiring ------------------------------------------------------------------

function wire() {
  $('btn-new-run').addEventListener('click', () => newRun(0));
  $('btn-continue').addEventListener('click', resumeRun);
  $('btn-sandbox').addEventListener('click', () => {
    window.location.href = new URL('./sandbox.html', import.meta.url).href;
  });

  // Delegated: the drawer is re-rendered on every purchase, so per-card listeners
  // would be re-attached (and leaked) dozens of times per draft.
  $('specimens').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    const card = e.target.closest('.specimen');
    if (!btn || !card) return;
    const id = card.dataset.sp;
    if (btn.dataset.act === 'buy') run.buy(id);
    else run.sell(id);
    renderDraft();
    persist();
  });

  $('roster-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    const row = e.target.closest('.roster-row');
    if (!btn || !row) return;
    run.sell(row.dataset.sp);
    renderDraft();
    persist();
  });

  for (const btn of document.querySelectorAll('.filters button')) {
    btn.addEventListener('click', () => {
      filter = btn.dataset.filter;
      for (const other of document.querySelectorAll('.filters button')) {
        other.classList.toggle('active', other === btn);
      }
      renderDraft();
    });
  }

  $('btn-fight').addEventListener('click', startBattle);

  $('btn-abandon').addEventListener('click', () => {
    if (!confirm('Abandon this colony? The run ends here.')) return;
    saved.run = null;
    saved.meta.runsPlayed += 1;
    store.save(saved);
    run = null;
    renderTitle();
  });

  $('btn-speed').addEventListener('click', () => {
    speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
    engine?.setTimeScale(speed);
    $('btn-speed').textContent = `Speed ×${speed}`;
  });

  $('btn-sound').addEventListener('click', () => {
    audio.setMuted(!audio.muted);
    $('btn-sound').textContent = audio.muted ? 'Sound off' : 'Sound on';
  });

  $('btn-skip').addEventListener('click', skipBattle);

  $('mutation-grid').addEventListener('click', (e) => {
    const card = e.target.closest('.mutation');
    if (!card) return;
    run.chooseMutation(card.dataset.mut);
    persist();
    renderDraft();
    show('draft');
  });

  $('btn-skip-mutation').addEventListener('click', () => {
    run.skipMutation();
    persist();
    renderDraft();
    show('draft');
  });

  $('btn-retry').addEventListener('click', () => newRun(0));
  $('btn-over-title').addEventListener('click', renderTitle);
  $('btn-victory-title').addEventListener('click', renderTitle);
  $('btn-ascend').addEventListener('click', () => newRun(saved.meta.ascension));

  // Losing focus mid-battle (a tab switch, a phone call) should pause rather than
  // run the fight to completion off-screen.
  document.addEventListener('visibilitychange', () => {
    if (!engine || battleResolved) return;
    if (document.hidden) engine.stop();
    else engine.start();
  });
}

// --- boot --------------------------------------------------------------------

async function boot() {
  const bar = $('boot-bar');
  bar.style.width = '20%';

  await portal.init();
  bar.style.width = '55%';

  wire();
  renderTitle();
  bar.style.width = '100%';

  // Lift the gate on a timer, not on requestAnimationFrame: rAF is throttled to a
  // standstill in a background tab, which left the loading screen up until the
  // player switched back to it — exactly the wrong first impression.
  setTimeout(() => {
    $('boot').classList.add('gone');
    portal.loadingDone();
  }, 200);
}

boot();
