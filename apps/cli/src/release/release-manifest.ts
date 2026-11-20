import { z } from 'zod/v4';

/** Recognized image platforms; each manifest declares the platforms actually built. */
export const RELEASE_PLATFORMS = ['linux/amd64', 'linux/arm64'] as const;

const pinnedReferenceSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9./_-]*(?::[0-9]+)?(?:\/[a-z0-9._-]+)*@sha256:[a-f0-9]{64}$/,
    'Image reference must be pinned by sha256 digest',
  );

const platformsSchema = z.array(z.enum(RELEASE_PLATFORMS)).min(1);

const releaseImageSchema = z.strictObject({
  reference: pinnedReferenceSchema,
  platforms: platformsSchema,
});

/**
 * The pinned image set for a release. The package supplies its CLI version;
 * install, matching checks and update offers never resolve image tags on their own.
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

/** Reads the image set for the CLI package using it, independently of its build-time version. */
export function parseManifestForVersion(json: string, cliVersion: string): ReleaseManifest {
  return { ...parseReleaseManifest(json), cliVersion };
}
