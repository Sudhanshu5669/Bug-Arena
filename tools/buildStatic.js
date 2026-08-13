// Produce `dist/` — a fully static, deployable copy of the game — and check it
// against the things a portal will reject it for.
//
//   npm run build
//
// There is no bundler and no transpile step: the browser loads the engine source
// directly as ES modules, and index.html's import map maps the two bare
// specifiers (`matter-js`, `events`) onto the shims in public/vendor. So a
// "build" is just a file copy into the layout the page's imports expect:
//
//   dist/            <- public/          (index.html, game.js, assets/, vendor/)
//   dist/engine/     <- engine/
//   dist/species/    <- species/
//   dist/render/     <- render/
//   dist/game/       <- game/
//
// Deploy `dist/` to any static host, or zip its CONTENTS (not the folder) for
// the CrazyGames developer portal.

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// public/ flattens into the web root; the rest keep their directory names so the
// page's `./engine/...`, `./species/...`, `./render/...` imports resolve.
const COPIES = [
  { from: 'public', to: '.' },
  { from: 'engine', to: 'engine' },
  { from: 'species', to: 'species' },
  { from: 'render', to: 'render' },
  { from: 'game', to: 'game' }, // run/draft/economy layer (the game on top of the sim)
];

/**
 * Developer-only files, removed after the copy.
 *
 * The sandbox is a technical tool with its own, deliberately different chrome.
 * Shipping it means a reviewer can reach a screen that looks like it belongs to
 * another product, and portals mark a game down for exactly that. It stays in
 * the repo and is served by `npm start`; it just is not part of the build — and
 * neither is the module graph only it uses.
 *
 * The check below fails the build if anything the GAME loads still references
 * one of these, so dropping a file that turned out to be load-bearing is caught
 * here rather than by a reviewer staring at a blank screen.
 */
const DEV_ONLY = [
  'sandbox.html',
  'client.js', // the sandbox's controller — nothing else imports it
  'localArena.js', // ...and its engine host
];

// A portal serves the game from a subpath (/games/<slug>/), where a leading "/"
// resolves to the portal's own root and 404s.
const ABSOLUTE_URL = /(?:src|href)\s*=\s*["']\/(?!\/)/g;

/** Hosts we are allowed to talk to. Everything else has to be in the zip. */
const ALLOWED_REMOTE = ['sdk.crazygames.com'];
const REMOTE_URL = /(?:src|href)\s*=\s*["']https?:\/\/([^/"']+)/g;

/** What the portal will refuse. Initial download must be under 50MB / 1500 files. */
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 1500;

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

/** Fail the build on anything a portal review would send back. */
async function verify(files) {
  const problems = [];

  for (const required of ['index.html', 'engine/index.js', 'vendor/matter.min.js', 'game.css']) {
    try {
      await fs.access(path.join(DIST, required));
    } catch {
      problems.push(`missing dist/${required}`);
    }
  }

  let bytes = 0;
  for (const f of files) bytes += (await fs.stat(f)).size;
  if (bytes > MAX_BYTES) problems.push(`build is ${(bytes / 1e6).toFixed(1)}MB — the portal limit is 50MB`);
  if (files.length > MAX_FILES) problems.push(`build has ${files.length} files — the portal limit is 1500`);

  // Root-absolute URLs, unexpected remote hosts, and dangling references to
  // anything DEV_ONLY removed — in every text file we ship.
  for (const f of files) {
    if (!/\.(html|css|js|json|svg)$/i.test(f)) continue;
    const rel = path.relative(DIST, f).replace(/\\/g, '/');
    const text = await fs.readFile(f, 'utf8');

    for (const gone of DEV_ONLY) {
      if (text.includes(`./${gone}`)) {
        problems.push(`${rel} still references ${gone}, which the build removes`);
      }
    }

    for (const m of text.matchAll(ABSOLUTE_URL)) {
      const line = text.slice(0, m.index).split('\n').length;
      problems.push(`${rel}:${line} root-absolute URL — a portal subpath will 404 it`);
    }
    for (const m of text.matchAll(REMOTE_URL)) {
      if (!ALLOWED_REMOTE.includes(m[1])) {
        const line = text.slice(0, m.index).split('\n').length;
        problems.push(`${rel}:${line} external request to ${m[1]} — the build must be self-contained`);
      }
    }
  }

  return { problems, bytes };
}

async function build() {
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });

  for (const { from, to } of COPIES) {
    const src = path.join(ROOT, from);
    const dest = path.resolve(DIST, to);
    await fs.cp(src, dest, { recursive: true });
    console.log(`  ${from}/  ->  dist/${to === '.' ? '' : `${to}/`}`);
  }

  for (const name of DEV_ONLY) {
    await fs.rm(path.join(DIST, name), { force: true });
    console.log(`  dropped dist/${name} (developer tool)`);
  }

  const files = await walk(DIST);
  const { problems, bytes } = await verify(files);

  console.log(`\n  ${files.length} files, ${(bytes / 1024).toFixed(0)} KB`);

  if (problems.length) {
    console.error('\n  build FAILED portal checks:');
    for (const p of problems) console.error(`    ✗ ${p}`);
    throw new Error(`${problems.length} problem(s)`);
  }

  console.log('  ✓ relative paths, self-contained, within portal limits');
  console.log('\n  dist/ ready. Zip its CONTENTS (index.html at the zip root) to submit.\n');
}

build().catch((err) => {
  console.error(`\n  build failed: ${err.message}\n`);
  process.exit(1);
});
