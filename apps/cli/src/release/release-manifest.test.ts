import { sameRelease } from '../local-app/release-source';
import { modelsFromPins } from './model-pins';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
  models: {
    modelQuantized: {
      file: 'model_quantized.onnx',
      url: `https://huggingface.co/Snowflake/snowflake-arctic-embed-s/resolve/${'1'.repeat(40)}/onnx/model_quantized.onnx`,
      sha256: 'a'.repeat(64),
    },
    tokenizer: {
      file: 'tokenizer.json',
      url: `https://huggingface.co/Snowflake/snowflake-arctic-embed-s/resolve/${'1'.repeat(40)}/tokenizer.json`,
      sha256: 'b'.repeat(64),
    },
  },
});

describe('release manifest', () => {
  it('accepts a complete digest-pinned release covering both platforms', () => {
    expect(parseReleaseManifest(JSON.stringify(manifest()))).toEqual(manifest());
  });

  it('rejects an image that is only pinned by tag', () => {
    const release = manifest();
    release.images.api.reference = 'ghcr.io/zsutton00/api-service:latest';

    expect(() => parseReleaseManifest(JSON.stringify(release))).toThrow(/sha256 digest/);
  });

  it('rejects an image missing either required platform', () => {
    const release = manifest();
    release.images.redis.platforms = ['linux/amd64'];

    expect(() => parseReleaseManifest(JSON.stringify(release))).toThrow(/linux\/arm64/);
  });

  it('accepts a manifest only for the package version being published', () => {
    const json = JSON.stringify(manifest());

    expect(parseManifestForVersion(json, '4.3.0')).toEqual(manifest());
    expect(() => parseManifestForVersion(json, '4.3.1')).toThrow(/for CLI 4\.3\.0/);
  });

  it('rejects images outside the release set, such as Agents', () => {
    const release = {
      ...manifest(),
      images: { ...manifest().images, agents: image('ghcr.io/x/agents', 'f') },
    };

    expect(() => parseReleaseManifest(JSON.stringify(release))).toThrow();
  });

  it('rejects a manifest without pinned model files', () => {
    const { models: _models, ...withoutModels } = manifest();

    expect(() => parseReleaseManifest(JSON.stringify(withoutModels))).toThrow();
  });

  it('rejects model sources that are not pinned to a revision or checksum', () => {
    const unpinned = manifest();
    unpinned.models.tokenizer.url = unpinned.models.tokenizer.url.replace('1'.repeat(40), 'main');
    const badSum = manifest();
    badSum.models.modelQuantized.sha256 = 'XYZ';

    expect(() => parseReleaseManifest(JSON.stringify(unpinned))).toThrow(/pinned/);
    expect(() => parseReleaseManifest(JSON.stringify(badSum))).toThrow(/checksum/);
  });

  it('treats a changed model pin as a different release', () => {
    const changed = manifest();
    changed.models.tokenizer.sha256 = 'c'.repeat(64);

    expect(sameRelease(manifest(), manifest())).toBe(true);
    expect(sameRelease(manifest(), changed)).toBe(false);
  });

  it('matches the pin file shared with fetch-model.sh', () => {
    const pinned = modelsFromPins(join(process.cwd(), '..', 'graph-search', 'model-pins.json'));

    expect(pinned.modelQuantized.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(parseReleaseManifest(JSON.stringify({ ...manifest(), models: pinned })).models).toEqual(
      pinned,
    );
  });
});
