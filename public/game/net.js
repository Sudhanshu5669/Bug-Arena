// The bridge to the simulation engine.
//
// The game never simulates anything itself: a fight is a real BugArenaEngine run
// on the server, driven by the lineup the player built on the sand and streamed
// back as snapshots. That is the same contract the sandbox uses — this module
// just runs battles one at a time and resolves when the engine says it is over.

let ws = null;
let ready = null;
const listeners = { init: [], snapshot: [], end: [], status: [] };

function emit(kind, payload) {
  for (const fn of listeners[kind]) fn(payload);
}

export function on(kind, fn) {
  listeners[kind].push(fn);
  return () => {
    const i = listeners[kind].indexOf(fn);
    if (i >= 0) listeners[kind].splice(i, 1);
  };
}

export function connect() {
  if (ready) return ready;
  ready = new Promise((resolve) => {
    const open = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}`);
      ws.onopen = () => {
        emit('status', 'connected');
        resolve(true);
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (listeners[msg.type]) emit(msg.type, msg.data);
      };
      ws.onclose = () => {
        emit('status', 'disconnected');
        setTimeout(open, 1000);
      };
      ws.onerror = () => ws.close();
    };
    open();
  });
  return ready;
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

/** Change playback pacing of the running fight. Does not touch the simulation. */
export function setSpeed(speed) {
  send({ cmd: 'speed', speed });
}

/** Species metadata, straight from the registry. */
export async function fetchCatalog() {
  const res = await fetch('/api/catalog');
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  return res.json();
}

/**
 * Run one authored fight to completion.
 *
 * @param {{A: Array<{species,count}>, B: Array<{species,count}>}} teams
 * @param {{seed?: number|null, mode?: string, onInit?: Function, onSnapshot?: Function}} opts
 * @returns {Promise<object>} the engine's summary
 */
export async function runFight(teams, opts = {}) {
  await connect();
  return new Promise((resolve) => {
    // The server may still be broadcasting the previous battle when our restart
    // is sent. Nothing counts until OUR init arrives — otherwise a stale `end`
    // could resolve this fight with someone else's summary.
    let live = false;
    const offInit = on('init', (init) => {
      live = true;
      opts.onInit?.(init);
    });
    const offSnap = on('snapshot', (s) => {
      if (live) opts.onSnapshot?.(s);
    });
    const offEnd = on('end', (summary) => {
      if (!live) return;
      offInit();
      offSnap();
      offEnd();
      resolve(summary);
    });
    send({
      cmd: 'restart',
      oneShot: true, // a campaign fight ends and stays ended
      config: {
        mode: opts.mode ?? 'aggressive', // authored matches are fights, not foraging
        seed: opts.seed ?? null,
        teams: { custom: teams },
      },
    });
  });
}
