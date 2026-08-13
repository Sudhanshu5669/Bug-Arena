// The campaign: level select, deploy, fight, reward.
//
// The rules all live in game/levels.js and game/progress.js. This file shows
// them and turns taps into calls on them — it decides nothing about difficulty,
// pricing, gating or rewards.

import { $, show, escapeHtml, setNum, thumbHtml, tintStyle, toast } from './ui.js';
import { startBattle } from './battle.js';
import { portal } from './portal.js';
import { costOf } from './game/economy.js';

/** Arena the campaign fights in. Landscape; the deploy zones split it left/right. */
const ARENA = Object.freeze({ width: 820, height: 520, wallThickness: 22 });

/** Fights between interstitials. */
const AD_EVERY_FIGHTS = 3;

/** Extra larvae a rewarded ad buys, as a fraction of the level's own budget. */
const BOOST_FRACTION = 0.3;

/**
 * The campaign reads as a shaft dug downward, so the level select is banded into
 * chapters of five rather than run as one grid of thirty. Each band ends on a
 * warlord, which is what makes the boss levels look like the milestones they are.
 * Names are flavour only — nothing keys off them.
 */
const CHAPTERS = [
  'The Surface Trails',
  'The Upper Galleries',
  'The Middle Nest',
  'The Silk Deeps',
  'The Rotting Core',
  'The Queen’s Chamber',
];
const CHAPTER_SIZE = 5;

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
    setNum($('camp-cleared'), `${p.clearedCount}/${p.levels.length}`);
    setNum($('camp-stars'), `${p.totalStars}/${p.levels.length * 3}`);
    setNum($('camp-coins'), p.coins);

    const card = (lv) => {
      const cleared = p.isCleared(lv.index);
      const open = p.isUnlocked(lv.index);
      const stars = p.starsFor(lv.index);
      const state = cleared ? 'done' : open ? 'open' : 'locked';
      const pips = [0, 1, 2].map((i) => `<i class="${i < stars ? 'on' : ''}"></i>`).join('');

      // Who is waiting in there, as pictures. Thirty cards that differ only by a
      // name and a number are a table of contents; thirty cards showing the
      // things you are about to fight are a map. Locked chambers stay blank —
      // finding out what is down there is the reason to keep going.
      const foes = open
        ? Object.entries(lv.enemy ?? {})
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([id]) => this.byId.get(id))
            .filter(Boolean)
            .map((sp) => `<span class="foe-pip">${thumbHtml(sp)}</span>`)
            .join('')
        : '';

      return `<button class="lv ${state} ${lv.isBoss ? 'boss' : ''} ${next && next.index === lv.index ? 'next' : ''}"
                data-lv="${lv.index}" ${open ? '' : 'disabled'}
                aria-label="Level ${lv.index}: ${escapeHtml(lv.name)}${open ? '' : ' (locked)'}">
          <span class="n">${lv.index}</span>
          <span class="nm">${open ? escapeHtml(lv.name) : 'Locked'}</span>
          ${foes ? `<span class="foes">${foes}</span>` : ''}
          <span class="stars">${pips}</span>
          ${lv.isBoss ? '<span class="crown">WARLORD</span>' : ''}
        </button>`;
    };

    const chapters = [];
    for (let start = 0; start < p.levels.length; start += CHAPTER_SIZE) {
      const band = p.levels.slice(start, start + CHAPTER_SIZE);
      const n = Math.floor(start / CHAPTER_SIZE);
      const allDone = band.every((lv) => p.isCleared(lv.index));
      chapters.push(`<section class="chapter ${allDone ? 'done' : ''}">
          <div class="chapter-head">
            <span class="depth">Depth ${n + 1}</span>
            <span class="nm">${escapeHtml(CHAPTERS[n] ?? `Chambers ${band[0].index}–${band[band.length - 1].index}`)}</span>
            <span class="rule"></span>
          </div>
          <div class="chapter-row">${band.map(card).join('')}</div>
        </section>`);
    }
    $('camp-grid').innerHTML = chapters.join('');

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
        // No foraging either, for the same reason one step further on. Pellets
        // pay out FREE REINFORCEMENTS (config.food.reinforceEvery), so a level
        // could hand both colonies units the player never chose and never paid
        // for — and hand the bigger colony more of them. It also broke the star
        // rating outright: survivors are counted against what you deployed, and
        // a colony that grew mid-fight could walk out with more bodies than it
        // walked in with. tools/campaignProbe.js runs the same config.
        food: { initial: 0, spawnEveryTicks: 0 },
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
      <div><span class="v">${Number(summary.durationSeconds).toFixed(1)}s</span><span class="k">duration</span></div>
      ${won ? `<div><span class="v gain">+${report.coins}</span><span class="k">royal jelly</span></div>` : ''}`;

    // On a loss, say exactly how close it was. "The colony breaks" with no number
    // beside it reads as a wall; "2 of theirs left standing" reads as a puzzle
    // that is nearly solved, which is the difference between a retry and a quit.
    const enemyLeft = Object.values(summary.teams?.B?.species ?? {}).reduce((n, r) => n + (r.alive ?? 0), 0);

    // The reward beat. A granted species gets the whole line to itself — it is
    // the single most motivating thing that happens in a campaign level, and
    // burying it in a stat row wastes it.
    const grantEl = $('lr-grant');
    if (report.granted) {
      const sp = this.byId.get(report.granted);
      // The species' own ability line is the promise the card is making — it is
      // what tells the player why the thing they just beat is worth having. The
      // flavour text is the consolation prize for the handful with no ability.
      const promise = sp?.ability
        ? `<b class="ab-name">${escapeHtml(sp.ability.name)}</b> — ${escapeHtml(sp.ability.description || sp.flavor || '')}`
        : escapeHtml(sp?.flavor ?? '');
      // Replaced wholesale rather than refilled: a CSS animation only plays when
      // the element enters the document, so reusing the node would grant the
      // second species in total silence.
      grantEl.outerHTML = `<div class="grant" id="lr-grant" ${tintStyle(sp)}>
          <span class="art">${thumbHtml(sp)}</span>
          <span class="txt">
            <span class="role">${sp?.tier === 'champion' ? 'Bug acquired' : 'Ant acquired'}</span>
            <b>${escapeHtml(sp?.name ?? report.granted)}</b>
            joins your colony, permanently.
            <em>${promise}</em>
          </span>
        </div>`;
    } else {
      grantEl.hidden = true;
    }

    const note = $('lr-note');
    if (!won) {
      note.hidden = false;
      note.textContent =
        enemyLeft <= 2
          ? `Close — ${enemyLeft} of theirs still standing. The same fight is waiting, so you can plan for it.`
          : 'Rebuild the lineup and try again — the same fight is waiting, so you can plan for it.';
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
    // Write the LABEL, not the button: `textContent` on the button itself wipes
    // the video icon beside it, which the portal requires a rewarded prompt to
    // carry.
    boostBtn.querySelector('span').textContent =
      `Watch an ad: +${Math.round(lv.budget * BOOST_FRACTION)} larvae next attempt`;

    show('levelresult');
    // Confetti on the portal's own page. Reserved for the beats that earn it —
    // a warlord chamber, or the end of the campaign. The portal asks for this
    // explicitly ("the celebration should remain a special moment"), and firing
    // it on every routine clear is what makes it stop meaning anything.
    if (won && (lv.isBoss || report.campaignComplete)) portal.happytime();
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
