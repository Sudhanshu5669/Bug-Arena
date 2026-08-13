// Zip dist/ into the exact shape the CrazyGames developer portal expects.
//
//   npm run package        # builds dist/, then writes release/colony-gladiator.zip
//
// The portal unpacks the archive and looks for `index.html` at its ROOT, so the
// zip must contain the CONTENTS of dist/ and not the dist/ folder itself — the
// single most common reason an upload is rejected before anyone plays it.
//
// Uses the OS zip tool rather than adding a dependency: PowerShell's
// Compress-Archive on Windows, `zip` everywhere else.

import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const run = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT_DIR = path.join(ROOT, 'release');
const OUT = path.join(OUT_DIR, 'colony-gladiator.zip');

async function main() {
  try {
    await fs.access(path.join(DIST, 'index.html'));
  } catch {
    throw new Error('dist/index.html is missing — run `npm run build` first');
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.rm(OUT, { force: true });

  if (process.platform === 'win32') {
    // `dist\*` (not `dist`) is what puts index.html at the zip root.
    await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -Path '${DIST}\\*' -DestinationPath '${OUT}' -Force`,
    ]);
  } else {
    await run('zip', ['-r', '-q', OUT, '.'], { cwd: DIST });
  }

  const { size } = await fs.stat(OUT);
  console.log(`\n  release/colony-gladiator.zip — ${(size / 1024).toFixed(0)} KB`);
  console.log('  index.html is at the archive root. Upload this file to the CrazyGames portal.\n');
}

main().catch((err) => {
  console.error(`\n  packaging failed: ${err.message}\n`);
  process.exit(1);
});
