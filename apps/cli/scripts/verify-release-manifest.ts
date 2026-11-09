/**
 * Fails unless the packaged release manifest exists, is valid, and belongs to
 * this package version. Runs from `prepack`, so no publish path can ship a CLI
 * without its pinned image set.
 *
 *   tsx scripts/verify-release-manifest.ts [manifestFile] [packageJsonFile]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod/v4';
import { parseManifestForVersion } from '../src/release/release-manifest';

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [
  manifestFile = path.join(cliRoot, 'release-manifest.json'),
  packageFile = path.join(cliRoot, 'package.json'),
] = process.argv.slice(2);

const { version } = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(packageFile, 'utf8')));

let manifestJson: string;
try {
  manifestJson = readFileSync(manifestFile, 'utf8');
} catch {
  throw new Error(
    `${manifestFile} is missing. Release through the Release CLI workflow, which generates it; a manual publish cannot ship a CLI without its image set.`,
  );
}

parseManifestForVersion(manifestJson, version);
