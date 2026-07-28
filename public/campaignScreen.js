// The campaign: level select, deploy, fight, reward.
//
// The rules all live in game/levels.js and game/progress.js. This file shows
// them and turns taps into calls on them — it decides nothing about difficulty,
// pricing, gating or rewards.

import { $, show, escapeHtml, thumbHtml, toast } from './ui.js';
import { startBattle } from './battle.js';
import { portal } from './portal.js';
import { costOf } from './game/economy.js';

/** Arena the campaign fights in. Landscape; the deploy zones split it left/right. */
const ARENA = Object.freeze({ width: 960, height: 600, wallThickness: 24 });

/** Fights between interstitials. */
const AD_EVERY_FIGHTS = 3;

/** Extra larvae a rewarded ad buys, as a fraction of the level's own budget. */
const BOOST_FRACTION = 0.3;

export class CampaignScreen {
  constructor({ catalog, progress, deploy, persist, onHome }) {
    this.catalog = catalog;
    this.byId = new Map(catalog.map((s) => [s.id, s]));
    this.progress = progress;
    this.deploy = deploy;
    this.persist = persist;
    this.onHome = onHome;
    this.current = null;
    this.lastDeployed = 0;
    // Fights since the last interstitial. Counted in FIGHTS rather than screen
    // changes so a player bouncing around the level select never triggers one.
    this.sinceAd = 0;
    // A rewarded-ad boost, valid for one attempt at one level. Held here rather
    // than persisted: it is a leg-up for the fight in front of you, not a
    // permanent upgrade that would quietly re-tune the difficulty curve.
    this.boost = null;
    this.wire();
  }

  /**
   * Show an interstitial between fights, never during one.
   *
   * Called on the transitions OUT of the result screen, which is the only moment
   * in the campaign where the player is already waiting for a screen to change —
   * so the ad lands in a gap that existed anyway. Resolves either way; a portal
   * that has no ad to show must not stop the player from continuing.
   */
  async interstitial() {
    if (this.sinceAd < AD_EVERY_FIGHTS) return;
    this.sinceAd = 0;
    await portal.requestAd('midgame');
  }

  // --- level select ----------------------------------------------------------

  openSelect() {
    const p = this.progress;
    const next = p.nextLevel;

    $('camp-rank').textContent = p.rank;
    $('camp-cleared').textContent = `${p.clearedCount}/${p.levels.length}`;
    $('camp-stars').textContent = `${p.totalStars}/${p.levels.length * 3}`;
    $('camp-coins').textContent = p.coins;

    $('camp-grid').innerHTML = p.levels
      .map((lv) => {
        const cleared = p.isCleared(lv.index);
        const open = p.isUnlocked(lv.index);
        const stars = p.starsFor(lv.index);
        const state = cleared ? 'done' : open ? 'open' : 'locked';
        const pips = [0, 1, 2].map((i) => `<i class="${i < stars ? 'on' : ''}"></i>`).join('');
        return `<button class="lv ${state} ${lv.isBoss ? 'boss' : ''} ${next && next.index === lv.index ? 'next' : ''}"
                  data-lv="${lv.index}" ${open ? '' : 'disabled'}
                  aria-label="Level ${lv.index}: ${escapeHtml(lv.name)}${open ? '' : ' (locked)'}">
            <span class="n">${lv.index}</span>
            <span class="nm">${open ? escapeHtml(lv.name) : 'Locked'}</span>
            <span class="stars">${pips}</span>
            ${lv.isBoss ? '<span class="crown">WARLORD</span>' : ''}
          </button>`;
      })
      .join('');

    show('campaign');
    // Keep the level the player is actually on in view — by level 20 the grid is
    // taller than a phone screen and opening it scrolled to the top means
    // scrolling past everything already beaten, every single time.
    requestAnimationFrame(() => {
      $('camp-grid').querySelector('.lv.next')?.scrollIntoView({ block: 'center' });
    });
  }

  // --- deploy ----------------------------------------------------------------

  openLevel(index) {
    const p = this.progress;
    if (!p.isUnlocked(index)) {
      toast('Clear the level before it first.');
      return;
    }
    const lv = p.levelAt(index);
    if (!lv) return;
    this.current = lv;

    const prices = {};
    for (const s of this.catalog) prices[s.id] = costOf(s);

    const cleared = p.isCleared(index);
    const bonus = this.boost?.index === index ? this.boost.larvae : 0;
    this.deploy.open({
      title: `${lv.index}. ${lv.name}`,
      subtitle: bonus
        ? `Reinforced: +${bonus} larvae for this attempt.`
        : lv.isBoss
          ? 'Warlord chamber — this colony fights above its weight.'
          : cleared ? 'Cleared. Replay for a better rating.' : 'Arrange your colony, then send them in.',
      available: p.ownedSpecies(),
      prices,
      arena: ARENA,
      editableTeams: ['A'],
      limits: { A: { budget: lv.budget + bonus, cap: lv.cap }, B: { budget: Infinity, cap: Infinity } },
      enemy: lv.enemy,
      enemyName: lv.name,
      onBack: () => this.openSelect(),
      onFight: (rosters, meta) => this.fight(rosters, meta),
    });
    show('deploy');
  }

  // --- the fight -------------------------------------------------------------

  fight(rosters, { deployed }) {
    const lv = this.current;
    if (!lv) return;
    this.lastDeployed = deployed;
    this.sinceAd += 1;

    startBattle(
      {
        // Fixed per level: the fight you retry is the fight you lost. Nothing
        // about a campaign level is allowed to reroll on defeat.
        seed: lv.seed,
        arena: ARENA,
        // Hunt on sight. Both armies start where they were placed, so a passive
        // fight would open with two lines standing still looking at each other.
        mode: 'aggressive',
        teams: { custom: rosters },
        teamBuffs: { A: null, B: lv.buff },
        // Rubber-banding off. It exists to make an unwatched battle dramatic;
        // in a campaign it would quietly undo the player's build decisions,
        // which are the only thing they actually control here.
        drama: { comeback: false },
        maxTicks: 60 * 80,
      },
      {
        title: `${lv.index}. ${lv.name}`,
        onEnd: (summary) => this.resolve(summary),
      }
    );
  }

  resolve(summary) {
    const lv = this.current;
    const mine = summary.teams?.A ?? { species: {}, kills: 0 };
    const survivors = Object.values(mine.species ?? {}).reduce((n, r) => n + (r.alive ?? 0), 0);

    const report = this.progress.completeLevel(lv.index, {
      won: summary.winner === 'A',
      deployed: this.lastDeployed,
      survivors,
      kills: mine.kills ?? 0,
    });
    this.persist();
    this.showResult(report, { survivors, kills: mine.kills ?? 0, summary });
  }

  // --- result ----------------------------------------------------------------

  showResult(report, { survivors, kills, summary }) {
    const lv = this.current;
    const won = report.won;

    $('lr-eyebrow').textContent = won ? `Level ${lv.index} cleared` : `Level ${lv.index} failed`;
    $('lr-title').textContent = won ? (lv.isBoss ? 'The warlord falls' : 'The colony holds') : 'The colony breaks';
    $('lr-title').className = won ? 'win' : 'loss';

    $('lr-stars').innerHTML = won
      ? [0, 1, 2].map((i) => `<i class="${i < report.stars ? 'on' : ''}" style="animation-delay:${i * 160}ms"></i>`).join('')
      : '';
    $('lr-stars').hidden = !won;

    $('lr-tally').innerHTML = `
      <div><span class="v">${survivors}</span><span class="k">survivors</span></div>
      <div><span class="v">${kills}</span><span class="k">enemies slain</span></div>
      <div><span class="v">${summary.durationSeconds}s</span><span class="k">duration</span></div>
      ${won ? `<div><span class="v gain">+${report.coins}</span><span class="k">royal jelly</span></div>` : ''}`;

    // The reward beat. A granted species gets the whole line to itself — it is
    // the single most motivating thing that happens in a campaign level, and
    // burying it in a stat row wastes it.
    const grantEl = $('lr-grant');
    if (report.granted) {
      const sp = this.byId.get(report.granted);
      grantEl.hidden = false;
      grantEl.innerHTML = `<span class="art">${thumbHtml(sp)}</span>
        <span class="txt"><b>${escapeHtml(sp?.name ?? report.granted)}</b> joins your colony.
        <em>${escapeHtml(sp?.ability?.name ? `${sp.ability.name} — ${sp.flavor || ''}` : sp?.flavor || '')}</em></span>`;
    } else {
      grantEl.hidden = true;
    }

    const note = $('lr-note');
    if (!won) {
      note.hidden = false;
      note.textContent = 'Rebuild the lineup and try again — the same fight is waiting, so you can plan for it.';
    } else if (report.campaignComplete) {
      note.hidden = false;
      note.textContent = 'Every chamber is yours. The whole roster is unlocked in the battle maker.';
    } else if (!report.firstClear) {
      note.hidden = false;
      note.textContent = report.improvedStars ? 'A better rating than last time.' : 'Cleared again.';
    } else {
      note.hidden = true;
    }

    const next = this.progress.levelAt(lv.index + 1);
    const nextOpen = next && this.progress.isUnlocked(next.index);
    $('btn-lr-next').hidden = !nextOpen;
    $('btn-lr-next').textContent = won && report.unlockedNext ? `Level ${next.index}: ${next.name}` : 'Next level';
    $('btn-lr-retry').textContent = won ? 'Replay this level' : 'Try again';

    // A rewarded top-up, offered only where it does something useful: after a
    // loss, on the retry, once. It is the anti-wall — a player who cannot quite
    // clear a chamber gets a concrete leg-up instead of being asked to grind a
    // mode that has nothing left to give them. Winning clears it.
    if (won) this.boost = null;
    const boostBtn = $('btn-lr-boost');
    const canBoost = !won && this.boost?.index !== lv.index;
    boostBtn.hidden = !canBoost;
    boostBtn.textContent = `Watch an ad: +${Math.round(lv.budget * BOOST_FRACTION)} larvae next attempt`;

    show('levelresult');
    if (won) portal.happytime();
  }

  // --- wiring ----------------------------------------------------------------

  wire() {
    $('camp-grid').addEventListener('click', (e) => {
      const btn = e.target.closest('.lv');
      if (!btn || btn.disabled) return;
      this.openLevel(Number(btn.dataset.lv));
    });

    $('btn-camp-back').addEventListener('click', () => this.onHome());
    $('btn-camp-continue').addEventListener('click', () => {
      const next = this.progress.nextLevel ?? this.progress.levelAt(this.progress.levels.length);
      if (next) this.openLevel(next.index);
    });

    $('btn-lr-next').addEventListener('click', async () => {
      await this.interstitial();
      const next = this.progress.levelAt((this.current?.index ?? 0) + 1);
      if (next && this.progress.isUnlocked(next.index)) this.openLevel(next.index);
      else this.openSelect();
    });

    $('btn-lr-retry').addEventListener('click', async () => {
      await this.interstitial();
      this.openLevel(this.current.index);
    });

    $('btn-lr-boost').addEventListener('click', async (e) => {
      const lv = this.current;
      e.currentTarget.disabled = true;
      const watched = await portal.requestAd('rewarded');
      e.currentTarget.disabled = false;
      if (!watched) {
        // No SDK, no fill, or the player closed it early — say so plainly rather
        // than silently granting the reward or silently doing nothing.
        toast('No reinforcements available right now.');
        return;
      }
      this.boost = { index: lv.index, larvae: Math.round(lv.budget * BOOST_FRACTION) };
      $('btn-lr-boost').hidden = true;
      toast(`+${this.boost.larvae} larvae for your next attempt at this chamber.`, 3200);
    });

    $('btn-lr-select').addEventListener('click', () => this.openSelect());
  }
}
