import { readFile } from 'node:fs/promises';
import { parseManifestForVersion, type ReleaseManifest } from '../release/release-manifest';

/** Packaged and rehearsal releases share the exact same parsing and version gate. */
export class ReleaseSource {
  constructor(
    private readonly path: string,
    private readonly cliVersion: string,
  ) {}

  async read(): Promise<ReleaseManifest> {
    let json: string;
    try {
      json = await readFile(this.path, 'utf8');
    } catch {
      throw new Error(
        'Packaged release manifest is missing. Install a complete matching CLI release.',
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
