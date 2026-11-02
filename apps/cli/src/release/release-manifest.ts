import { z } from 'zod/v4';

/** Platforms every release image must cover: Mac ARM (via Linux ARM) and Linux x86. */
export const RELEASE_PLATFORMS = ['linux/amd64', 'linux/arm64'] as const;

const pinnedReferenceSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9./_-]*(?::[0-9]+)?(?:\/[a-z0-9._-]+)*@sha256:[a-f0-9]{64}$/,
    'Image reference must be pinned by sha256 digest',
  );

const platformsSchema = z
  .array(z.enum(RELEASE_PLATFORMS))
  .refine(
    (platforms) => RELEASE_PLATFORMS.every((platform) => platforms.includes(platform)),
    `Image must cover ${RELEASE_PLATFORMS.join(' and ')}`,
  );

const releaseImageSchema = z.strictObject({
  reference: pinnedReferenceSchema,
  platforms: platformsSchema,
});

/**
 * The single version source for one CLI release: install, matching checks and
 * update offers read this file and never resolve image tags on their own.
 * Agents is deliberately not part of the set.
 */
export const releaseManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  cliVersion: z.string().min(1),
  images: z.strictObject({
    api: releaseImageSchema,
    ui: releaseImageSchema,
    graphSearch: releaseImageSchema,
    postgres: releaseImageSchema,
    redis: releaseImageSchema,
  }),
});

export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;
export type ReleaseImageName = keyof ReleaseManifest['images'];

/** Parses manifest JSON from the packaged file; throws a readable error if it is not a valid release. */
export function parseReleaseManifest(json: string): ReleaseManifest {
  return releaseManifestSchema.parse(JSON.parse(json));
}

/** Parses the manifest and requires it to belong to the given CLI version. */
export function parseManifestForVersion(json: string, cliVersion: string): ReleaseManifest {
  const manifest = parseReleaseManifest(json);
  if (manifest.cliVersion !== cliVersion) {
    throw new Error(
      `Release manifest is for CLI ${manifest.cliVersion}, but package.json is ${cliVersion}.`,
    );
  }

  return manifest;
}
