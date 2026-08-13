// The Hatchery — spend royal jelly on the species the campaign never hands out.
//
// Stock, prices and the "is this earnable instead?" rule all come from
// game/progress.js. This is a list with buttons on it.

import { $, show, escapeHtml, setNum, thumbHtml, tintStyle, toast } from './ui.js';

export class HatcheryScreen {
  constructor({ catalog, progress, persist, onHome }) {
    this.byId = new Map(catalog.map((s) => [s.id, s]));
    this.progress = progress;
    this.persist = persist;
    this.onHome = onHome;
    this.wire();
  }

  open() {
    this.render();
    show('hatchery');
  }

  render() {
    const p = this.progress;
    setNum($('hatch-coins'), p.coins);

    const stock = p.shopStock();
    $('hatch-list').innerHTML = stock
      .map((item) => {
        const sp = this.byId.get(item.id);
        const afford = p.coins >= item.price;
        const st = sp?.stats ?? {};
        return `<div class="hatch-row ${item.owned ? 'owned' : afford ? '' : 'dim'}" data-sp="${item.id}" ${tintStyle(sp)}>
            <span class="art">${thumbHtml(sp)}</span>
            <span class="info">
              <b>${escapeHtml(sp?.name ?? item.id)}</b>
              <em>${sp?.ability ? escapeHtml(`${sp.ability.name} — ${sp.ability.description || sp.flavor || ''}`) : escapeHtml(sp?.flavor ?? '')}</em>
              <small>${item.tier === 'champion' ? 'BUG' : 'ANT'} · hp ${Math.round(st.maxHealth ?? 0)} · dmg ${st.damage ?? 0}</small>
            </span>
            ${
              item.owned
                ? '<span class="tag-owned">Acquired</span>'
                : `<button class="btn-small btn-primary" data-act="buy" ${afford ? '' : 'disabled'}>${item.price} jelly</button>`
            }
          </div>`;
      })
      .join('');

    const left = stock.filter((s) => !s.owned).length;
    $('hatch-sub').textContent = left
      ? `${left} specimen${left === 1 ? '' : 's'} still for sale. Royal jelly comes from winning campaign levels.`
      : 'Every specimen in the hatchery is yours.';
  }

  wire() {
    $('hatch-list').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act="buy"]');
      const row = e.target.closest('.hatch-row');
      if (!btn || !row) return;

      const id = row.dataset.sp;
      const res = this.progress.buy(id);
      if (!res.ok) {
        toast(
          res.reason === 'poor'
            ? 'Not enough royal jelly yet.'
            : res.reason === 'earnable'
              ? 'That one is earned in the campaign, not bought.'
              : 'Cannot acquire that specimen.'
        );
        return;
      }
      this.persist();
      toast(`${this.byId.get(id)?.name ?? id} joins your colony.`);
      this.render();
    });

    $('btn-hatch-back').addEventListener('click', () => this.onHome());
  }
}
