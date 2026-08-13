// The deploy screen — the tray, the counters and the floor, wired together.
//
// Shared verbatim between the campaign and the battle maker. The campaign opens
// it with one editable team, a budget, a cap and an enemy already standing on
// the far side; the maker opens it with both teams editable and no limits. Those
// are arguments, not branches: everything below reads its behaviour off the
// config it was handed.

import { DeployEditor } from './deployEditor.js';
import { $, escapeHtml, setNum, thumbHtml, tintStyle, toast } from './ui.js';

const REJECTION = {
  cap: 'The nest is full — no room for another body.',
  budget: 'Not enough larvae for that one.',
  zone: 'Units can only be placed in your own half.',
  unknown: 'You have not acquired that specimen yet.',
};

export class DeployScreen {
  constructor({ catalog }) {
    this.catalog = catalog;
    this.byId = new Map(catalog.map((s) => [s.id, s]));
    this.editor = null;
    this.cfg = null;
    this.filter = 'all';
    this._wired = false;
  }

  /**
   * @param {object} cfg
   * @param {string}   cfg.title        - headline (level name / "Battle Maker")
   * @param {string}   cfg.subtitle
   * @param {Array}    cfg.available    - species the player may field (owned only)
   * @param {object}   cfg.prices       - { speciesId: larvae }
   * @param {object}   cfg.arena
   * @param {string[]} cfg.editableTeams
   * @param {object}   [cfg.limits]     - { A: {budget, cap}, B: {...} }
   * @param {object}   [cfg.enemy]      - fixed enemy roster map (campaign)
   * @param {string}   [cfg.enemyName]
   * @param {Function} cfg.onFight      - (rosters) => void
   * @param {Function} cfg.onBack
   */
  open(cfg) {
    this.cfg = cfg;
    this.filter = 'all';
    this.destroy();

    const canvas = $('deploy-canvas');
    // The canvas is sized by the arena, and the CSS aspect-ratio must agree with
    // it or every pointer coordinate lands somewhere other than where it looks.
    canvas.style.aspectRatio = `${cfg.arena.width} / ${cfg.arena.height}`;

    this.editor = new DeployEditor(canvas, {
      arena: cfg.arena,
      catalog: this.catalog,
      editableTeams: cfg.editableTeams,
      onChange: () => this.refresh(),
    });
    this.editor.setPrices(cfg.prices ?? {});
    this.editor.onReject = (why) => toast(REJECTION[why] ?? 'That cannot go there.');
    this.editor.onTrayTap = (id) => {
      this.editor.setBrush(id);
      this.renderTray();
    };

    for (const team of ['A', 'B']) {
      this.editor.setLimits(team, cfg.limits?.[team] ?? { budget: Infinity, cap: Infinity });
    }

    // The opposition, standing where it will start. Seeing the actual formation
    // — not a list of names — is the whole reason the campaign shows you the
    // enemy before you commit.
    if (cfg.enemy) this.editor.fillFormation('B', cfg.enemy);

    $('deploy-title').textContent = cfg.title;
    $('deploy-sub').textContent = cfg.subtitle ?? '';
    $('deploy-teams').hidden = cfg.editableTeams.length < 2;
    $('deploy-enemy-card').hidden = !cfg.enemy;

    if (!this._wired) this.wire();
    this.renderEnemy();
    this.renderTray();
    this.refresh();
  }

  destroy() {
    this.editor?.destroy();
    this.editor = null;
  }

  // --- rendering -------------------------------------------------------------

  renderEnemy() {
    if (!this.cfg?.enemy) return;
    const rows = Object.entries(this.cfg.enemy)
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => {
        const sp = this.byId.get(id);
        return `<div class="lineup-row" ${tintStyle(sp)}>
            <span class="art">${thumbHtml(sp)}</span>
            <span class="nm">${escapeHtml(sp?.name ?? id)}</span>
            <span class="ab">${sp?.ability ? escapeHtml(sp.ability.name) : '—'}</span>
            <span class="n">×${n}</span>
          </div>`;
      })
      .join('');
    $('deploy-enemy-name').textContent = this.cfg.enemyName ?? 'Opposition';
    $('deploy-enemy').innerHTML = rows;
  }

  renderTray() {
    const team = this.editor.activeTeam;
    const counts = this.editor.rosterOf(team);
    const prices = this.cfg.prices ?? {};
    const brush = this.editor.brush;

    const list = this.cfg.available.filter((sp) => this.filter === 'all' || sp.tier === this.filter);

    $('deploy-tray').innerHTML = list.length
      ? list
          .map((sp) => {
            const n = counts[sp.id] ?? 0;
            const price = prices[sp.id] ?? 0;
            const afford = this.editor.remainingBudget(team) >= price;
            const room = this.editor.countOf(team) < this.editor.limits[team].cap;
            return `<div class="tcard ${brush === sp.id ? 'armed' : ''} ${n ? 'has' : ''} ${afford && room ? '' : 'dim'}" data-sp="${sp.id}" ${tintStyle(sp)}>
              <i class="tier-pip" aria-hidden="true"></i>
              <div class="art">${thumbHtml(sp)}</div>
              <div class="nm">${escapeHtml(sp.name)}</div>
              <div class="ab">${sp.ability ? escapeHtml(sp.ability.name) : 'No ability'}</div>
              <div class="row">
                <span class="price">${price}</span>
                ${n ? `<span class="cnt">×${n}</span>` : ''}
                <button class="btn-small" data-act="sub" ${n ? '' : 'disabled'} aria-label="Remove one ${escapeHtml(sp.name)}">−</button>
                <button class="btn-small" data-act="add" ${afford && room ? '' : 'disabled'} aria-label="Add one ${escapeHtml(sp.name)}">+</button>
              </div>
            </div>`;
          })
          .join('')
      : '<div class="empty">Nothing here yet. Clear campaign levels to acquire specimens.</div>';
  }

  /** Counters + the fight button's enabled state. Cheap; runs on every change. */
  refresh() {
    const team = this.editor.activeTeam;
    const lim = this.editor.limits[team];
    const spent = this.editor.spentBy(team);
    const count = this.editor.countOf(team);

    const left = lim.budget - spent;
    setNum($('deploy-budget'), Number.isFinite(lim.budget) ? `${left}` : '∞');
    setNum($('deploy-cap'), Number.isFinite(lim.cap) ? `${count}/${lim.cap}` : `${count}`);

    // Colour the two gauges the moment they stop being able to buy anything, so
    // "why is every card dimmed" answers itself instead of needing arithmetic.
    const cheapest = Math.min(
      Infinity,
      ...this.cfg.available.map((sp) => this.cfg.prices?.[sp.id] ?? 0)
    );
    $('gauge-budget')?.classList.toggle('spent', Number.isFinite(lim.budget) && left < cheapest);
    $('gauge-cap')?.classList.toggle('spent', Number.isFinite(lim.cap) && count >= lim.cap);

    // The maker needs BOTH sides on the field; the campaign only needs yours.
    const ready = this.cfg.editableTeams.every((t) => this.editor.countOf(t) > 0);
    $('btn-deploy-fight').disabled = !ready;

    for (const btn of document.querySelectorAll('#deploy-teams button')) {
      btn.classList.toggle('active', btn.dataset.team === team);
    }
    this.renderTray();
  }

  // --- wiring ----------------------------------------------------------------

  wire() {
    this._wired = true;

    // Delegated, because the tray is rebuilt on every single change — per-card
    // listeners would be re-attached (and leaked) dozens of times per deploy.
    const tray = $('deploy-tray');

    tray.addEventListener('pointerdown', (ev) => {
      const card = ev.target.closest('.tcard');
      if (!card) return;
      // The +/− buttons are taps, not the start of a drag.
      if (ev.target.closest('button')) return;
      this.editor.beginTrayDrag(card.dataset.sp, ev);
    });

    tray.addEventListener('click', (ev) => {
      const card = ev.target.closest('.tcard');
      const btn = ev.target.closest('button');
      if (!card || !btn) return;
      const id = card.dataset.sp;
      const team = this.editor.activeTeam;
      if (btn.dataset.act === 'add') {
        const why = this.editor.addAuto(team, id);
        if (why) toast(REJECTION[why] ?? 'That cannot go there.');
      } else {
        this.editor.removeOne(team, id);
      }
    });

    for (const btn of document.querySelectorAll('#deploy-filters button')) {
      btn.addEventListener('click', () => {
        this.filter = btn.dataset.filter;
        for (const o of document.querySelectorAll('#deploy-filters button')) o.classList.toggle('active', o === btn);
        this.renderTray();
      });
    }

    for (const btn of document.querySelectorAll('#deploy-teams button')) {
      btn.addEventListener('click', () => {
        this.editor.setActiveTeam(btn.dataset.team);
        this.refresh();
      });
    }

    $('btn-deploy-auto').addEventListener('click', () => {
      this.editor.tidy(this.editor.activeTeam);
      toast('Formation tidied.');
    });

    $('btn-deploy-clear').addEventListener('click', () => {
      this.editor.clear(this.editor.activeTeam);
    });

    $('btn-deploy-back').addEventListener('click', () => this.cfg?.onBack?.());

    $('btn-deploy-fight').addEventListener('click', () => {
      const rosters = this.editor.toEngineRoster();
      const deployed = this.editor.countOf('A');
      this.cfg?.onFight?.(rosters, { deployed });
    });
  }
}
