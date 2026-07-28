// Serve `dist/` from a nested SUBPATH — the way a portal actually hosts it.
//
// This exists because the most common way a web build breaks on CrazyGames /
// itch / Poki is invisible on a normal dev server: root-absolute URLs ("/x.js")
// resolve fine at localhost:3000/ and 404 at localhost:3000/games/slug/. Serving
// from the root is therefore NOT a valid test of a portal build.
//
//   npm run build && npm run serve:portal
//   -> http://localhost:4000/games/colony-gladiator/
//
// If the game loads there, it will load on a portal.

import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', 'dist');
const PORT = process.env.PORT || 4000;
const MOUNT = '/games/colony-gladiator';

const app = express();

// Deliberately mounted deep, and nothing is served at the root: any asset that
// only resolves from "/" will fail loudly here instead of silently working.
app.use(MOUNT, express.static(DIST));

app.get('/', (_req, res) => {
  res.status(404).send(`Nothing at the root — that is the point. Try <a href="${MOUNT}/">${MOUNT}/</a>`);
});

app.listen(PORT, () => {
  console.log(`\n  Portal-shaped host → http://localhost:${PORT}${MOUNT}/\n`);
  console.log('  Root is intentionally empty so absolute-path regressions fail fast.\n');
});
