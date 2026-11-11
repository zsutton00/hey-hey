import { readFile } from 'node:fs/promises';
import { StructuredServerLogger } from '../server/logger';
import { parseManifestForVersion, type ReleaseManifest } from '../release/release-manifest';

/** Packaged and rehearsal releases share image validation and use their package's CLI version. */
export class ReleaseSource {
  private readonly logger = new StructuredServerLogger({}, { component: 'local-release-source' });
  constructor(
    private readonly path: string,
    private readonly cliVersion: string,
  ) {}

  async read(): Promise<ReleaseManifest> {
    let json: string;
    try {
      json = await readFile(this.path, 'utf8');
    } catch (error) {
      this.logger.error('local.release_source.manifest_unreadable', { path: this.path, error });
      throw new Error(
        'Packaged release manifest is missing. Install a complete matching CLI release.',
        { cause: error },
      );
    }
    return parseManifestForVersion(json, this.cliVersion);
  }
}

export function sameRelease(left: ReleaseManifest, right: ReleaseManifest): boolean {
  return (
    left.cliVersion === right.cliVersion &&
    Object.entries(left.images).every(([name, image]) =>
      Object.entries(right.images).some(
        ([otherName, other]) => name === otherName && image.reference === other.reference,
      ),
    )
  );
}
