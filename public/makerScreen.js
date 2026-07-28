// The battle maker — arrange both sides, then let them go.
//
// No budget, no cap, no opponent chosen for you. The only rule it keeps is the
// one the whole game keeps: you can field a species once you have acquired it,
// and the campaign is the only place that happens.

import { $, show, toast } from './ui.js';
import { startBattle } from './battle.js';
import { costOf } from './game/economy.js';

const ARENA = Object.freeze({ width: 960, height: 600, wallThickness: 24 });

export class MakerScreen {
  constructor({ catalog, progress, deploy, onHome }) {
    this.catalog = catalog;
    this.progress = progress;
    this.deploy = deploy;
    this.onHome = onHome;
    // Kept across a fight so returning from the battle screen puts the player
    // back in front of the arrangement they built, not an empty floor.
    this.saved = null;
    this.wire();
  }

  open() {
    const prices = {};
    for (const s of this.catalog) prices[s.id] = costOf(s);

    const owned = this.progress.ownedSpecies();
    this.deploy.open({
      title: 'Battle Maker',
      subtitle: 'Arrange both colonies. Nothing moves until you start the fight.',
      available: owned,
      prices,
      arena: ARENA,
      editableTeams: ['A', 'B'],
      limits: {
        // Not truly unlimited: a thousand ants would hang the simulation, and a
        // cap the player can't realistically reach reads as no cap at all.
        A: { budget: Infinity, cap: 60 },
        B: { budget: Infinity, cap: 60 },
      },
      onBack: () => this.onHome(),
      onFight: (rosters) => this.fight(rosters),
    });

    if (this.saved) {
      this.deploy.editor.setTeam('A', this.saved.A);
      this.deploy.editor.setTeam('B', this.saved.B);
    }

    if (owned.length <= 2) {
      toast('Clear campaign levels to acquire more specimens for the maker.', 3600);
    }
    show('deploy');
  }

  fight(rosters) {
    this.saved = rosters;
    startBattle(
      {
        arena: ARENA,
        mode: 'aggressive',
        teams: { custom: rosters },
        // Off, so the maker answers the question the player is actually asking:
        // which of these two arrangements wins. Rubber-banding would make the
        // answer "whichever one was losing at the time".
        drama: { comeback: false },
        maxTicks: 60 * 90,
      },
      {
        title: 'Battle Maker',
        onEnd: (summary) => this.resolve(summary),
      }
    );
  }

  resolve(summary) {
    const winner = summary.winner === 'A' ? 'Blue' : summary.winner === 'B' ? 'Red' : 'Nobody';
    toast(`${winner} wins — ${summary.totalKills} dead in ${summary.durationSeconds}s.`, 3600);
    this.open();
  }

  wire() {
    // The maker reuses the deploy screen's own back/fight buttons; nothing else
    // to bind. Kept as a hook so a maker-only control has somewhere to live.
  }
}
