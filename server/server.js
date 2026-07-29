// Dev preview server. THIS IS A DEV TOOL, not the future public API.
//
// It runs a BugArenaEngine in this Node process and relays its snapshot stream
// to any connected browser over WebSocket. The browser is a pure renderer — all
// simulation happens here, headless-capable, exactly as it will on a server.
//
// The future public `POST /api/simulate` is a DIFFERENT concern: it would call
// `runBattle(config)` from engine/index.js and return a summary / video, with no
// WebSocket and no browser. See the marked spot below.

import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { WebSocketServer } from 'ws';

import { BugArenaEngine } from '../engine/index.js';
import '../species/index.js'; // <-- loads + self-registers all species (engine never imports them)
import { getCatalog } from '../species/registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(ROOT, 'public')));
app.use('/render', express.static(path.join(ROOT, 'render'))); // client imports the shared renderer

// The game front-end prices and describes specimens from the real registry
// rather than a hardcoded list, so it needs the catalog before any battle runs.
app.get('/api/catalog', (_req, res) => res.json(getCatalog()));

// ---- Future public API would live here (NOT built for v1) -------------------
// import { runBattle } from '../engine/index.js';
// app.post('/api/simulate', express.json(), (req, res) => {
//   const result = runBattle(req.body?.config ?? {}, { collectSnapshots: true });
//   res.json(result.summary);            // or pipe result.snapshots -> videoRenderer.js
// });
// -----------------------------------------------------------------------------

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let engine = null;
let lastOverrides = { mode: 'passive' }; // forage-first is the default battle feel
let restartTimer = null;
// The sandbox wants a lively, self-restarting preview. A campaign fight is a
// single authored match: it must end and stay ended so the result screen can
// read its summary. `oneShot` on the restart command picks which.
let oneShot = false;

function broadcast(message) {
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */) client.send(data);
  }
}

function startBattle(overrides = {}) {
  clearTimeout(restartTimer);
  if (engine) engine.stop();

  lastOverrides = { ...lastOverrides, ...overrides };
  engine = new BugArenaEngine(lastOverrides);

  engine.on('snapshot', (snapshot) => broadcast({ type: 'snapshot', data: snapshot }));
  engine.on('end', (summary) => {
    broadcast({ type: 'end', data: summary });
    console.log(
      `[battle] over — winner ${summary.winner} by ${summary.reason} ` +
        `in ${summary.durationSeconds}s (seed ${summary.seed}).` +
        (oneShot ? '' : ' Auto-restarting in 5s.')
    );
    if (!oneShot) restartTimer = setTimeout(() => startBattle(), 5000); // keep the preview lively during dev
  });

  broadcast({ type: 'init', data: engine.getInitPayload() });
  engine.start();
  console.log(`[battle] started — mode "${lastOverrides.mode}", seed ${engine.seed}`);
}

wss.on('connection', (ws) => {
  // Bring a freshly-connected client up to speed on the battle already running.
  if (engine) {
    ws.send(JSON.stringify({ type: 'init', data: engine.getInitPayload() }));
    if (engine.lastSnapshot) {
      ws.send(JSON.stringify({ type: 'snapshot', data: engine.lastSnapshot }));
    }
  }

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.cmd === 'restart') {
      oneShot = Boolean(msg.oneShot);
      startBattle(msg.config || {});
    } else if (msg.cmd === 'setMode') {
      oneShot = false;
      startBattle({ mode: msg.mode });
    } else if (msg.cmd === 'speed') {
      // Playback pacing only — the running battle is not restarted or reseeded.
      if (engine) engine.setSpeed(msg.speed);
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n  Bug Arena preview → http://localhost:${PORT}\n`);
  startBattle(lastOverrides);
});
