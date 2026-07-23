// Public entry point for the simulation engine.
//
// IMPORTANT: this module deliberately does NOT import any species files. It only
// touches the registry. Callers must load species first (e.g. `import
// "../species/index.js"`) so they self-register. This is what lets you add a new
// species without ever editing the engine.

import { BugArenaEngine } from './engine.js';

export { BugArenaEngine };
export { DEFAULT_CONFIG, resolveConfig, mergeConfig } from './config.js';
export { ACTIONS, EVENTS, TEAMS, MODES } from './constants.js';

/**
 * Run a battle to completion synchronously and return its result. This is the
 * function the future `POST /api/simulate` endpoint and the headless video
 * renderer will call:
 *
 *   // server/api.js (future)
 *   app.post('/api/simulate', (req, res) => {
 *     const result = runBattle(req.body.config, { collectSnapshots: true });
 *     res.json(result.summary);          // or hand result.snapshots to videoRenderer
 *   });
 *
 * @param {object} config                     - partial battle config (deep-merged onto defaults).
 * @param {object} [opts]
 * @param {boolean} [opts.collectSnapshots]   - also return every per-tick snapshot
 *                                              (needed to render a video; off by default to save memory).
 * @returns {{ summary: object, init: object, snapshots: object[] }}
 */
export function runBattle(config = {}, opts = {}) {
  const engine = new BugArenaEngine(config);
  const init = engine.getInitPayload();

  const snapshots = [];
  if (opts.collectSnapshots) {
    engine.on('snapshot', (s) => snapshots.push(s));
  }

  const summary = engine.runToCompletion();
  return { summary, init, snapshots };
}
