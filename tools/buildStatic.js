// Produce `dist/` — a fully static, deployable copy of the game.
//
// There is no bundler and no transpile step: the browser loads the engine source
// directly as ES modules, and index.html's import map maps the two bare
// specifiers (`matter-js`, `events`) onto the shims in public/vendor. So a
// "build" is just a file copy into the layout the page's absolute imports expect:
//
//   dist/            <- public/          (index.html, client.js, assets/, vendor/)
//   dist/engine/     <- engine/
//   dist/species/    <- species/
//   dist/render/     <- render/
//
// Deploy `dist/` to any static host (Vercel, Netlify, Cloudflare Pages, GitHub
// Pages). Serve it locally with `npx serve dist` or `npm start`.

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// public/ flattens into the web root; the rest keep their directory names so the
// page's `/engine/...`, `/species/...`, `/render/...` imports resolve.
const COPIES = [
  { from: 'public', to: '.' },
  { from: 'engine', to: 'engine' },
  { from: 'species', to: 'species' },
  { from: 'render', to: 'render' },
  { from: 'game', to: 'game' }, // run/draft/economy layer (the game on top of the sim)
];

async function build() {
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });

  for (const { from, to } of COPIES) {
    const src = path.join(ROOT, from);
    const dest = path.resolve(DIST, to);
    await fs.cp(src, dest, { recursive: true });
    console.log(`  ${from}/  ->  dist/${to === '.' ? '' : `${to}/`}`);
  }

  // Fail loudly rather than shipping a build whose entry point is missing.
  for (const required of ['index.html', 'engine/index.js', 'vendor/matter.min.js']) {
    try {
      await fs.access(path.join(DIST, required));
    } catch {
      throw new Error(`build incomplete — dist/${required} is missing`);
    }
  }

  console.log('\n  dist/ ready. Deploy it to any static host.\n');
}

build().catch((err) => {
  console.error(`\n  build failed: ${err.message}\n`);
  process.exit(1);
});
