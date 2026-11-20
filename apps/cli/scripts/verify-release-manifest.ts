/**
 * Fails unless the packaged image manifest exists and is valid.
 * Runs from `prepack`, so no publish path can ship a CLI
 * without its pinned image set.
 *
 *   tsx scripts/verify-release-manifest.ts [manifestFile]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReleaseManifest } from '../src/release/release-manifest';

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [manifestFile = path.join(cliRoot, 'release-manifest.json')] = process.argv.slice(2);

let manifestJson: string;
try {
  manifestJson = readFileSync(manifestFile, 'utf8');
} catch {
  throw new Error(
    `${manifestFile} is missing. Release through the Release CLI workflow, which generates it; a manual publish cannot ship a CLI without its image set.`,
  );
}

parseReleaseManifest(manifestJson);
