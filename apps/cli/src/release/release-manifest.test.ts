import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  RELEASE_PLATFORMS,
  parseManifestForVersion,
  parseReleaseManifest,
  type ReleaseManifest,
} from './release-manifest';

const digest = (char: string) => `sha256:${char.repeat(64)}`;
const image = (repository: string, char: string) => ({
  reference: `${repository}@${digest(char)}`,
  platforms: [...RELEASE_PLATFORMS],
});

const manifest = (): ReleaseManifest => ({
  schemaVersion: 1,
  cliVersion: '4.3.0',
  images: {
    api: image('ghcr.io/zsutton00/api-service', 'a'),
    ui: image('ghcr.io/zsutton00/ui-service', 'b'),
    graphSearch: image('ghcr.io/zsutton00/graph-search-service', 'c'),
    postgres: image('docker.io/pgvector/pgvector', 'd'),
    redis: image('docker.io/library/redis', 'e'),
  },
});

describe('release manifest', () => {
  it('pack verification accepts pinned images independently of the package version', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'manifest-verification-'));
    const manifestFile = path.join(directory, 'release-manifest.json');
    writeFileSync(manifestFile, JSON.stringify(manifest()));
    try {
      execFileSync(
        process.execPath,
        ['--import', 'tsx', 'scripts/verify-release-manifest.ts', manifestFile],
        { cwd: path.resolve(__dirname, '../..') },
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('accepts a complete digest-pinned release covering both platforms', () => {
    expect(parseReleaseManifest(JSON.stringify(manifest()))).toEqual(manifest());
  });

  it.each(RELEASE_PLATFORMS)('accepts a single-platform manifest for %s', (platform) => {
    const release = manifest();
    for (const image of Object.values(release.images)) {
      image.platforms = [platform];
    }

    expect(parseReleaseManifest(JSON.stringify(release))).toEqual(release);
  });

  it('rejects an image that is only pinned by tag', () => {
    const release = manifest();
    release.images.api.reference = 'ghcr.io/zsutton00/api-service:latest';

    expect(() => parseReleaseManifest(JSON.stringify(release))).toThrow(/sha256 digest/);
  });

  it('rejects an image with no declared platform', () => {
    const release = manifest();
    release.images.redis.platforms = [];

    expect(() => parseReleaseManifest(JSON.stringify(release))).toThrow();
  });

  it('reuses pinned images with the CLI package version being run or published', () => {
    const json = JSON.stringify(manifest());

    expect(parseManifestForVersion(json, '4.3.0')).toEqual(manifest());
    expect(parseManifestForVersion(json, '4.3.1')).toEqual({ ...manifest(), cliVersion: '4.3.1' });
  });

  it('rejects images outside the release set, such as Agents', () => {
    const release = {
      ...manifest(),
      images: { ...manifest().images, agents: image('ghcr.io/x/agents', 'f') },
    };

    expect(() => parseReleaseManifest(JSON.stringify(release))).toThrow();
  });
});
