// The Endless Descent — the original roguelite mode, kept intact.
//
// Draft under a budget, fight, keep your survivors, take a mutation, go deeper.
// Fifteen chambers. Unlike the campaign it does NOT grant species: it draws from
// whatever the campaign has already given you, so there is exactly one ledger of
// what you own (game/progress.js) and one place it grows.

import { $, show, escapeHtml, thumbHtml, toast } from './ui.js';
import { startBattle } from './battle.js';
import { Run } from './game/run.js';
import { isBossDepth } from './game/campaign.js';
import { portal } from './portal.js';

export class DescentScreen {
  constructor({ catalog, progress, saved, persist, onHome }) {
    this.catalog = catalog;
    this.byId = new Map(catalog.map((s) => [s.id, s]));
    this.progress = progress;
    this.saved = saved;
    this.persist = persist;
    this.onHome = onHome;
    this.run = null;
    this.filter = 'all';
    this.wire();
  }

  get canResume() {
    const r = this.saved.run;
    return !!r && r.phase !== 'lost' && r.phase !== 'won';
  }

  newRun(ascension = 0) {
    this.run = Run.create({
      seed: (Math.random() * 0xffffffff) >>> 0,
      catalog: this.catalog,
      unlocked: [...this.progress.owned],
      ascension,
    });
    this.save();
    this.renderDraft();
  }

  resume() {
    this.run = Run.restore(this.saved.run, this.catalog);
    // A run whose colony predates a species you no longer... can't happen, but a
    // run saved before the ownership ledger existed can carry ids you never
    // earned. Re-anchor the pool to what you actually own.
    this.run.unlocked = [...new Set([...this.progress.owned])];
    if (this.run.phase === 'battle') this.run.phase = 'draft'; // interrupted by a reload -> re-fight
    if (this.run.phase === 'reward') {
      this.showResult(this.run.lastResult ?? { survivors: this.run.roster, kills: 0, larvae: 0 });
      return;
    }
    this.renderDraft();
  }

  save() {
    this.saved.run = this.run ? this.run.toJSON() : null;
    this.persist();
  }

  // --- draft -----------------------------------------------------------------

  renderDraft() {
    const run = this.run;
    const prices = run.prices;
    const enemy = run.enemy;
    const boss = isBossDepth(run.depth);

    const tag = $('draft-depth');
    tag.textContent = boss ? `Chamber ${run.depth} · Warlord` : `Chamber ${run.depth}`;
    tag.classList.toggle('boss', boss);
    $('draft-foe').textContent = enemy.name;
    $('draft-purse').textContent = run.larvae;

    $('specimens').innerHTML = run.available
      .filter((sp) => this.filter === 'all' || sp.tier === this.filter)
      .map((sp) => {
        const price = prices[sp.id];
        const owned = run.roster[sp.id] ?? 0;
        const st = sp.stats;
        return `<div class="specimen ${owned ? 'owned' : ''} ${run.larvae < price && !owned ? 'unaffordable' : ''}" data-sp="${sp.id}">
            <div class="art">${thumbHtml(sp)}</div>
            <div class="tier ${sp.tier}">${sp.tier === 'champion' ? 'Bug' : 'Ant'}</div>
            <div class="nm">${escapeHtml(sp.name)}</div>
            <div class="ab">${sp.ability ? escapeHtml(sp.ability.name) : 'No signature ability'}</div>
            <div class="stats"><span>hp <b>${Math.round(st.maxHealth)}</b></span><span>dmg <b>${st.damage}</b></span></div>
            <div class="buy-row">
              <span class="price">${price}</span>
              ${owned ? `<span class="have">×${owned}</span>` : ''}
              <button class="btn-small" data-act="sell" ${owned ? '' : 'disabled'} aria-label="Remove one ${escapeHtml(sp.name)}">−</button>
              <button class="btn-small" data-act="buy" ${run.larvae >= price && !run.atCap ? '' : 'disabled'} aria-label="Add one ${escapeHtml(sp.name)}">+</button>
            </div>
          </div>`;
      })
      .join('');

    this.renderColony();
    show('draft');
  }

  renderColony() {
    const run = this.run;
    const entries = Object.entries(run.roster).sort((a, b) => b[1] - a[1]);
    $('roster-list').innerHTML = entries.length
      ? entries
          .map(([id, n]) => {
            const sp = this.byId.get(id);
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

    const enemy = run.enemy;
    const ratio = run.armyValue / Math.max(1, enemy.budget);
    const read = ratio >= 1.15 ? 'You outweigh them.' : ratio >= 0.85 ? 'An even match.' : 'They outweigh you.';
    const capNote = run.atCap
      ? ' <b style="color:var(--amber)">The nest is full — sell a unit to make room for a better one.</b>'
      : '';
    $('scout-report').innerHTML =
      `Scouts report <b>${escapeHtml(enemy.name)}</b> fielding roughly <b>${enemy.budget}</b> larvae of strength. ${read}${capNote}`;

    $('mutation-chips').innerHTML = run.mutations.map((m) => `<span class="chip">${escapeHtml(m.name)}</span>`).join('');
    $('btn-fight').disabled = run.armySize === 0;
  }

  // --- battle ----------------------------------------------------------------

  fight() {
    const config = this.run.beginBattle();
    if (!config) return;
    this.save();
    startBattle(config, {
      title: `Chamber ${this.run.depth}`,
      onEnd: (summary) => this.afterBattle(summary),
    });
  }

  afterBattle(summary) {
    const run = this.run;
    const result = run.resolveBattle(summary);
    if (!result) return this.onHome();

    this.saved.meta.bestDepth = Math.max(this.saved.meta.bestDepth, run.depth);
    this.saved.meta.totalKills += result.kills;

    if (run.phase === 'won') return this.showVictory();
    if (run.phase === 'lost') return this.showGameOver();

    if (result.revived) {
      this.save();
      toast('The queen endures. The colony regroups.', 3200);
      this.renderDraft();
      return;
    }
    this.showResult(result);
  }

  showResult(result) {
    const run = this.run;
    $('result-eyebrow').textContent = `Chamber ${run.depth} cleared`;
    $('result-title').textContent = 'The colony holds';
    $('result-title').className = 'win';

    const survivors = Object.values(result.survivors ?? {}).reduce((a, b) => a + b, 0);
    $('result-tally').innerHTML = `
      <div><span class="v">${survivors}</span><span class="k">survivors</span></div>
      <div><span class="v">${result.kills}</span><span class="k">enemies slain</span></div>
      <div><span class="v gain">+${result.larvae}</span><span class="k">larvae</span></div>`;
    $('result-unlock').hidden = true;

    $('mutation-grid').innerHTML = run.mutationOffer
      .map(
        (m) => `<button class="mutation" data-mut="${m.id}">
          ${m.rarity === 'rare' ? '<span class="rare">Rare</span>' : ''}
          <span class="mn">${escapeHtml(m.name)}</span>
          <span class="mt">${escapeHtml(m.text)}</span>
        </button>`
      )
      .join('');

    this.save();
    show('result');
    portal.happytime();
  }

  showGameOver() {
    const run = this.run;
    this.saved.meta.runsPlayed += 1;
    this.saved.run = null;
    this.persist();

    $('over-sub').textContent = `The ${run.enemy.name} overran the nest at chamber ${run.depth}.`;
    $('over-tally').innerHTML = `
      <div><span class="v">${run.depth}</span><span class="k">chambers deep</span></div>
      <div><span class="v">${run.stats.kills}</span><span class="k">enemies slain</span></div>
      <div><span class="v">${run.stats.battlesWon}</span><span class="k">battles won</span></div>`;
    show('over');
  }

  showVictory() {
    const run = this.run;
    this.saved.meta.runsWon += 1;
    this.saved.meta.runsPlayed += 1;
    this.saved.meta.ascension = Math.max(this.saved.meta.ascension, run.ascension + 1);
    this.saved.run = null;
    this.persist();

    $('victory-sub').textContent = `The colony took the nest with ${run.armySize} still standing.`;
    $('victory-tally').innerHTML = `
      <div><span class="v">${run.stats.kills}</span><span class="k">enemies slain</span></div>
      <div><span class="v">${run.stats.battlesWon}</span><span class="k">battles won</span></div>
      <div><span class="v gain">${run.mutationIds.length}</span><span class="k">mutations</span></div>`;
    show('victory');
    portal.happytime();
  }

  // --- wiring ----------------------------------------------------------------

  wire() {
    // Delegated: the drawer is rebuilt on every purchase.
    $('specimens').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      const card = e.target.closest('.specimen');
      if (!btn || !card) return;
      if (btn.dataset.act === 'buy') this.run.buy(card.dataset.sp);
      else this.run.sell(card.dataset.sp);
      this.renderDraft();
      this.save();
    });

    $('roster-list').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      const row = e.target.closest('.roster-row');
      if (!btn || !row) return;
      this.run.sell(row.dataset.sp);
      this.renderDraft();
      this.save();
    });

    for (const btn of document.querySelectorAll('#draft-filters button')) {
      btn.addEventListener('click', () => {
        this.filter = btn.dataset.filter;
        for (const o of document.querySelectorAll('#draft-filters button')) o.classList.toggle('active', o === btn);
        this.renderDraft();
      });
    }

    $('btn-fight').addEventListener('click', () => this.fight());

    $('btn-abandon').addEventListener('click', () => {
      this.saved.run = null;
      this.saved.meta.runsPlayed += 1;
      this.persist();
      this.run = null;
      this.onHome();
    });

    $('mutation-grid').addEventListener('click', (e) => {
      const card = e.target.closest('.mutation');
      if (!card) return;
      this.run.chooseMutation(card.dataset.mut);
      this.save();
      this.renderDraft();
    });

    $('btn-skip-mutation').addEventListener('click', () => {
      this.run.skipMutation();
      this.save();
      this.renderDraft();
    });

    $('btn-retry').addEventListener('click', () => this.newRun(0));
    $('btn-over-title').addEventListener('click', () => this.onHome());
    $('btn-victory-title').addEventListener('click', () => this.onHome());
    $('btn-ascend').addEventListener('click', () => this.newRun(this.saved.meta.ascension));
  }
}
