// Portal adapter — CrazyGames SDK, with a no-op fallback.
//
// The SDK is injected by the portal itself and simply is not there during local
// development, on itch, or in a desktop wrapper. Every call in this module is
// therefore feature-detected and wrapped: a missing SDK must be indistinguishable
// from a working one as far as the rest of the game is concerned. The game never
// branches on "are we on a portal" — it just reports events and asks for ads, and
// this file decides whether anything happens.
//
// TO SUBMIT TO CRAZYGAMES, add their loader to index.html <head>:
//
//   <script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>
//
// It is deliberately NOT in index.html now: an external script that 404s or hangs
// would delay first paint on every non-portal build, and the whole point of this
// adapter is that its absence costs nothing.

/** Resolve the SDK object if the portal injected one. */
function sdk() {
  try {
    return window.CrazyGames?.SDK ?? null;
  } catch {
    return null;
  }
}

/** Call an SDK method, swallowing anything it throws. Portal SDKs are not our code. */
function attempt(label, fn) {
  const s = sdk();
  if (!s) return false;
  try {
    fn(s);
    return true;
  } catch (err) {
    console.warn(`[portal] ${label} failed`, err);
    return false;
  }
}

export const portal = {
  /** True when a real portal SDK is present (used only for diagnostics). */
  get available() {
    return sdk() !== null;
  },

  /** Called once before assets load. */
  async init() {
    const s = sdk();
    if (!s) return false;
    try {
      await s.init?.();
      s.game?.loadingStart?.();
      return true;
    } catch (err) {
      console.warn('[portal] init failed; continuing without the SDK.', err);
      return false;
    }
  },

  /** Called once assets are ready and the title screen is interactive. */
  loadingDone() {
    attempt('loadingStop', (s) => s.game?.loadingStop?.());
  },

  /**
   * Gameplay boundaries. The portal uses these to decide when it is safe to show
   * an ad, so they must bracket ACTUAL play — a battle in progress — and not the
   * menus. Getting this wrong is the most common reason a portal build feels like
   * it interrupts at random.
   */
  gameplayStart() {
    attempt('gameplayStart', (s) => s.game?.gameplayStart?.());
  },

  gameplayStop() {
    attempt('gameplayStop', (s) => s.game?.gameplayStop?.());
  },

  /** Fired when the player reaches a meaningful milestone. */
  happytime() {
    attempt('happytime', (s) => s.game?.happytime?.());
  },

  /**
   * Show an ad and resolve when it is over.
   *
   * Resolves `true` only when an ad actually completed — the caller uses that to
   * decide whether a reward was earned. With no SDK it resolves `false` immediately,
   * so a rewarded revive simply never appears rather than being granted for free.
   *
   * @param {'midgame'|'rewarded'} type
   * @returns {Promise<boolean>}
   */
  requestAd(type = 'midgame') {
    const s = sdk();
    if (!s?.ad?.requestAd) return Promise.resolve(false);

    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };

      // A portal ad that never calls back would soft-lock the game on the screen
      // that requested it. This bounds that failure to 30 seconds.
      const bail = setTimeout(() => finish(false), 30000);

      try {
        s.ad.requestAd(type, {
          adFinished: () => {
            clearTimeout(bail);
            finish(true);
          },
          adError: (err) => {
            clearTimeout(bail);
            console.warn('[portal] ad error', err);
            finish(false);
          },
          // Some SDK versions report a blocked/unavailable ad through this only.
          adStarted: () => {},
        });
      } catch (err) {
        clearTimeout(bail);
        console.warn('[portal] requestAd threw', err);
        finish(false);
      }
    });
  },
};
