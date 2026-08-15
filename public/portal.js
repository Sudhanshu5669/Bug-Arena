// Portal adapter — CrazyGames SDK, with a no-op fallback.
//
// The SDK is injected by the portal itself and simply is not there during local
// development, on itch, or in a desktop wrapper. Every call in this module is
// therefore feature-detected and wrapped: a missing SDK must be indistinguishable
// from a working one as far as the rest of the game is concerned. The game never
// branches on "are we on a portal" — it just reports events and asks for ads, and
// this file decides whether anything happens.
//
// The loader lives in index.html <head>, marked `async`, and boot() races the
// handshake against a deadline (see withDeadline() in game.js). A 404 or a hang
// therefore costs the player nothing at all.

/** Resolve the SDK object if the portal injected one. */
function sdk() {
  try {
    return window.CrazyGames?.SDK ?? null;
  } catch {
    return null;
  }
}

/** Set by init(): the SDK only accepts calls once the handshake has resolved. */
let ready = false;

/**
 * Call an SDK method, swallowing anything it throws. Portal SDKs are not our code.
 *
 * Gated on `ready` as well as on the SDK existing. The loader is `async`, so the
 * object can be on `window` a long time before `init()` resolves — and calling
 * into it during that window makes the SDK log "CrazySDK is not initialized yet"
 * to the console on every single event. Harmless, but a reviewer opening the
 * console sees a broken integration, and the events are dropped anyway.
 */
function attempt(label, fn) {
  const s = sdk();
  if (!ready || !s) return false;
  try {
    fn(s);
    return true;
  } catch (err) {
    console.warn(`[portal] ${label} failed`, err);
    return false;
  }
}

/**
 * Muted around every ad, then restored.
 *
 * Required by the portal ("mute your audio whenever an advertisement starts
 * playing, and unmute it when the ad has finished"), and obviously right anyway:
 * an arena full of chittering under a video ad is the fastest way to make a
 * player reach for the tab close button. Injected rather than imported so this
 * module keeps knowing nothing about the rest of the game.
 */
let audioGate = null;

/**
 * Told about `SDK.game.settings.muteAudio`, which is the portal's OWN mute
 * button — separate from the ad gate above, and outranking the player's sound
 * toggle. Set by setMuteSetting(); called on init and again on every change.
 */
let muteSetting = null;

/** Push the portal's current muteAudio value at whoever asked for it. */
function pushMuteSetting(settings) {
  if (!muteSetting) return;
  try {
    muteSetting(settings?.muteAudio === true);
  } catch (err) {
    console.warn('[portal] mute setting handler threw', err);
  }
}

export const portal = {
  /** True when a real portal SDK is present and initialised. */
  get available() {
    return ready && sdk() !== null;
  },

  /**
   * 'local' | 'crazygames' | 'disabled' — what the SDK thinks it is running in.
   * Diagnostics only; nothing in the game branches on it.
   */
  get environment() {
    try {
      return sdk()?.environment ?? 'none';
    } catch {
      return 'none';
    }
  },

  /**
   * Hand over the pair of functions used to silence the game around an ad.
   * @param {{mute:() => void, unmute:() => void}} gate
   */
  setAudioGate(gate) {
    audioGate = gate;
  },

  /**
   * Subscribe to the portal's mute-audio setting.
   *
   * Called once with the value the SDK already holds, then again on every
   * change. Safe to call before or after init(): with no SDK the handler is
   * simply told `false` and never hears from us again, which is the local /
   * itch / desktop case.
   *
   * @param {(muted:boolean) => void} fn
   */
  setMuteSetting(fn) {
    muteSetting = fn;
    const s = sdk();
    if (!ready || !s) {
      pushMuteSetting(null); // no portal — nothing is muting us
      return;
    }
    try {
      pushMuteSetting(s.game?.settings);
    } catch (err) {
      console.warn('[portal] reading game settings failed', err);
    }
  },

  /** Called once before assets load. */
  async init() {
    const s = sdk();
    if (!s) return false;
    try {
      await s.init?.();
      ready = true;
      s.game?.loadingStart?.();
      // The setting can be on from the very first frame (the portal remembers a
      // player who muted the last game), so read it here rather than waiting for
      // a change event that may never come. Registered once, never removed: the
      // game lives as long as the page does.
      attempt('addSettingsChangeListener', (sdkObj) =>
        sdkObj.game?.addSettingsChangeListener?.(pushMuteSetting)
      );
      if (muteSetting) pushMuteSetting(s.game?.settings);
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

  /**
   * Fired when the player reaches a meaningful milestone; the portal throws
   * confetti. Used sparingly — a warlord chamber and the end of the campaign,
   * never a routine level clear, which is what the portal asks for.
   */
  happytime() {
    attempt('happytime', (s) => s.game?.happytime?.());
  },

  /**
   * The portal's cross-device save store, or null.
   *
   * For a signed-in player this syncs progress between their phone and their
   * desktop; for a guest it is localStorage with extra steps. Either way it is
   * the storage the portal expects a full-launch game to use, and it is the only
   * thing that survives the third-party-cookie blocking that makes a raw
   * `localStorage` access THROW inside a portal iframe.
   *
   * Only offered once init() has resolved — the module is not usable before that.
   */
  storage() {
    if (!ready) return null;
    const d = sdk()?.data;
    if (!d || typeof d.getItem !== 'function' || typeof d.setItem !== 'function') return null;
    return {
      getItem: (k) => d.getItem(k),
      setItem: (k, v) => d.setItem(k, v),
      removeItem: (k) => d.removeItem?.(k),
    };
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
    if (!ready || !s?.ad?.requestAd) return Promise.resolve(false);

    return new Promise((resolve) => {
      let settled = false;
      let muted = false;

      const unmute = () => {
        if (!muted) return;
        muted = false;
        try {
          audioGate?.unmute();
        } catch {
          /* the game's own audio is not worth failing an ad over */
        }
      };

      const finish = (ok) => {
        if (settled) return;
        settled = true;
        unmute();
        resolve(ok);
      };

      // A portal ad that never calls back would soft-lock the game on the screen
      // that requested it. This bounds that failure to 30 seconds.
      const bail = setTimeout(() => finish(false), 30000);

      try {
        s.ad.requestAd(type, {
          // Mute on START, not on request: an unfilled ad never starts, and
          // silencing the game for one that never plays is a bug the player
          // hears rather than sees.
          adStarted: () => {
            muted = true;
            try {
              audioGate?.mute();
            } catch {
              /* as above */
            }
          },
          adFinished: () => {
            clearTimeout(bail);
            finish(true);
          },
          adError: (err) => {
            clearTimeout(bail);
            // 'unfilled' is the ordinary case, not a fault: the portal simply had
            // nothing to show. Logged at debug volume so a console full of these
            // never looks like a broken integration.
            const code = err?.code ?? 'unknown';
            if (code === 'unfilled') console.debug('[portal] no ad available');
            else console.warn('[portal] ad error', err);
            finish(false);
          },
        });
      } catch (err) {
        clearTimeout(bail);
        console.warn('[portal] requestAd threw', err);
        finish(false);
      }
    });
  },
};
