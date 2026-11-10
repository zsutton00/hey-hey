/**
 * Writes the packaged release manifest from the image digests a release run
 * produced. The file is generated per release, never committed.
 *
 *   tsx scripts/write-release-manifest.ts <digests.json> [outfile]
 *
 * digests.json maps each image name to its multi-arch manifest-list reference:
 *   { "api": "ghcr.io/zsutton00/api-service@sha256:…", "ui": …, "graphSearch": …, "postgres": …, "redis": … }
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod/v4';
import {
  RELEASE_PLATFORMS,
  releaseManifestSchema,
  type ReleaseManifest,
} from '../src/release/release-manifest';

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(path.join(cliRoot, 'package.json'), 'utf8')));

const [digestsFile, outfile = path.join(cliRoot, 'release-manifest.json')] = process.argv.slice(2);
if (!digestsFile) {
  throw new Error('Usage: write-release-manifest.ts <digests.json> [outfile]');
}

const references = z
  .strictObject({
    api: z.string(),
    ui: z.string(),
    graphSearch: z.string(),
    postgres: z.string(),
    redis: z.string(),
  })
  .parse(JSON.parse(readFileSync(digestsFile, 'utf8')));

const platforms = process.env.RELEASE_IMAGE_PLATFORMS
  ? z.array(z.enum(RELEASE_PLATFORMS)).parse(JSON.parse(process.env.RELEASE_IMAGE_PLATFORMS))
  : [...RELEASE_PLATFORMS];

const withPlatforms = (reference: string) => ({ reference, platforms });

const manifest: ReleaseManifest = releaseManifestSchema.parse({
  schemaVersion: 1,
  cliVersion: version,
  images: {
    api: withPlatforms(references.api),
    ui: withPlatforms(references.ui),
    graphSearch: withPlatforms(references.graphSearch),
    postgres: withPlatforms(references.postgres),
    redis: withPlatforms(references.redis),
  },
});

writeFileSync(outfile, `${JSON.stringify(manifest, null, 2)}\n`);
