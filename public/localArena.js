// In-page battle driver — the client-side replacement for the dev WebSocket server.
//
// It plays the exact role server/server.js used to: own a BugArenaEngine, relay
// its snapshot stream, and auto-restart when a battle ends. The difference is
// that the simulation now runs in THIS tab instead of a Node process, which is
// what makes the whole thing deployable as a static site (no server, no sockets,
// no per-viewer cost — every visitor simulates their own fight).
//
// The message shape ({ type: 'init' | 'snapshot' | 'end', data }) is deliberately
// identical to the old socket protocol, so the renderer and HUD are unchanged and
// a networked mode could be dropped back in later without touching them.

import { BugArenaEngine } from '/engine/index.js';
import '/species/index.js'; // side-effect import: every species self-registers

/** Matches the old server's restart delay — long enough for the showreel outro. */
const RESTART_DELAY_MS = 9000;

export class LocalArena {
  /**
   * @param {(msg: {type: string, data: any}) => void} onMessage
   * @param {object} [initialOverrides]
   */
  constructor(onMessage, initialOverrides = { mode: 'passive' }) {
    this.onMessage = onMessage;
    this.engine = null;
    this.overrides = { ...initialOverrides };
    this._restartTimer = null;
    this._autoRestart = true;
  }

  /** Whether a finished battle rolls straight into the next one. */
  setAutoRestart(on) {
    this._autoRestart = !!on;
    if (!on) clearTimeout(this._restartTimer);
  }

  /**
   * Start a battle. `overrides` is merged onto the running config, so callers can
   * change one thing (mode, roster, arena) without restating the rest.
   */
  start(overrides = {}) {
    clearTimeout(this._restartTimer);
    if (this.engine) this.engine.stop();

    this.overrides = { ...this.overrides, ...overrides };
    this.engine = new BugArenaEngine(this.overrides);

    this.engine.on('snapshot', (snapshot) => this.onMessage({ type: 'snapshot', data: snapshot }));
    this.engine.on('end', (summary) => {
      this.onMessage({ type: 'end', data: summary });
      if (!this._autoRestart) return;
      this._restartTimer = setTimeout(() => this.start(), RESTART_DELAY_MS);
    });

    this.onMessage({ type: 'init', data: this.engine.getInitPayload() });
    this.engine.start();
  }

  /** Restart with the same roster/config but a fresh seed. */
  restart(config = {}) {
    this.start(config);
  }

  setMode(mode) {
    this.start({ mode });
  }

  stop() {
    clearTimeout(this._restartTimer);
    this.engine?.stop();
  }

  /**
   * Command bridge. Accepts the same `{ cmd, ... }` objects the client used to
   * `send()` down the socket, so the UI's call sites stay as they were.
   */
  send(msg) {
    if (!msg) return;
    if (msg.cmd === 'restart') this.start(msg.config || {});
    else if (msg.cmd === 'setMode') this.start({ mode: msg.mode });
  }
}
