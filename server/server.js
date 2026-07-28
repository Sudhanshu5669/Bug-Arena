// Static dev server.
//
// The simulation used to run HERE and stream snapshots to the browser over a
// WebSocket. It doesn't any more: the engine runs in the page (see
// public/localArena.js), which is what makes the game deployable as a static
// site with no backend. So this file's only remaining job is to serve the source
// tree with the same URL layout the production build produces.
//
// It mirrors tools/buildStatic.js exactly — public/ at the root, plus the three
// source directories the page imports from. If you change one, change both.

import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 3000;

const app = express();

// public/ is the web root: /index.html, /client.js, /assets/…, /vendor/…
app.use(express.static(path.join(ROOT, 'public')));

// The page imports these as absolute URLs (/engine/index.js, /species/index.js,
// /render/canvasRenderer.js), so they're mounted at matching paths.
app.use('/engine', express.static(path.join(ROOT, 'engine')));
app.use('/species', express.static(path.join(ROOT, 'species')));
app.use('/render', express.static(path.join(ROOT, 'render')));
app.use('/game', express.static(path.join(ROOT, 'game')));

app.listen(PORT, () => {
  console.log(`\n  Bug Arena → http://localhost:${PORT}\n`);
  console.log('  Simulation runs in the browser. This server only serves files.\n');
});
