// The Hatchery (UI spec 06).
//
// Shop rows are ordered cheapest-first and that order is fixed. Unaffordable
// dims the whole row and makes its button inert rather than hiding it — you can
// always see what you are saving toward. Acquired specimens keep their row and
// swap the button for a green stamp.

import { $, esc, countTo, toast, watchFade } from '../ui.js';
import { glyph } from '../data.js';
import * as state from '../state.js';
import { session } from '../session.js';

export function init() {
  $('#jelly-glyph').innerHTML = glyph('jelly', 13);
  watchFade($('#shop-grid').parentElement);

  $('#shop-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-buy]');
    if (!btn) return;
    buy(btn.dataset.buy);
  });
}

function buy(id) {
  const sp = session.byId.get(id);
  const s = state.get();
  if (!sp || state.owns(id)) return;
  if (s.jelly < sp.price) {
    toast(`${sp.name} costs ${sp.price} royal jelly. Win a level to earn more.`);
    return;
  }
  state.addJelly(-sp.price);
  state.acquire(id);
  toast(`<strong>${esc(sp.name)}</strong> joins your colony.`);
  render(true);
}

function row(sp) {
  const s = state.get();
  const acquired = state.owns(sp.id);
  const afford = s.jelly >= sp.price;
  return `<div class="shop-row ${!acquired && !afford ? 'is-poor' : ''}">
      <span class="roundel sz-44"><img src="${sp.art}" alt="" /></span>
      <div class="body">
        <div class="line-1">
          <span class="nm">${esc(sp.name)}</span>
          <span class="stat">${esc(sp.tag)} · hp ${sp.hp} · dmg ${sp.dmg}</span>
        </div>
        <div class="desc"><span class="ability">${esc(sp.ability)}</span> — ${esc(sp.desc)}</div>
      </div>
      ${
        acquired
          ? '<div class="stamp">ACQUIRED</div>'
          : `<button class="btn ${afford ? 'btn-primary' : ''} buy" data-buy="${sp.id}"${
              afford ? '' : ' disabled'
            } aria-label="Buy ${esc(sp.name)} for ${sp.price} royal jelly">
              ${glyph('jelly', 12)}${sp.price}
            </button>`
      }
    </div>`;
}

// `spend` distinguishes arriving on the screen (the total is just a fact) from
// a purchase (the total should visibly count down and drop a "−480" ghost).
function render(spend = false) {
  const s = state.get();
  const forSale = session.roster.filter((sp) => !state.owns(sp.id));
  const jellyEl = $('#hatchery-jelly');
  if (!spend) jellyEl.dataset.value = String(s.jelly);
  countTo(jellyEl, s.jelly, { ghost: spend });
  $('#hatchery-sub').textContent = forSale.length
    ? `${forSale.length} specimen${forSale.length === 1 ? '' : 's'} still for sale. Royal jelly comes from winning campaign levels.`
    : 'Every specimen is yours. The drawer is full.';

  $('#shop-grid').innerHTML = forSale.length
    ? session.roster.map(row).join('')
    : `<div class="empty">
        <span class="glyph">${glyph('specimen', 26)}</span>
        <span class="copy">Every specimen is yours. The drawer is full.</span>
      </div>`;
}

export function enter() {
  render();
}
