import { sameRelease } from './release-source';
import { name as packageName } from '../../package.json';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod/v4';
import { parseManifestForVersion, type ReleaseManifest } from '../release/release-manifest';

const exec = promisify(execFile);
async function execute(
  command: string,
  args: string[],
  options: { timeout: number },
): Promise<{ stdout: string }> {
  try {
    return await exec(command, args, options);
  } catch {
    throw new Error(
      `${command} could not complete the release operation. Check npm access, permissions and disk space, then retry. Your local data is preserved.`,
    );
  }
}
const versionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/);

/** npm is the package boundary; images always come from the package's pinned manifest. */
export class ReleasePackage {
  private directory: string | undefined;
  private archive: string | undefined;
  private target: ReleaseManifest | undefined;

  async newerThan(current: string): Promise<ReleaseManifest | undefined> {
    const { stdout } = await execute(
      'npm',
      ['view', `${packageName}@latest`, 'version', '--json'],
      { timeout: 30_000 },
    );
    const version = versionSchema.parse(JSON.parse(stdout));
    const numeric = (value: string) => value.split('-')[0]!.split('.').map(Number);
    const left = numeric(version),
      right = numeric(current);
    const first = left.findIndex((part, index) => part !== right[index]);
    if (first < 0 || left[first]! < right[first]!) {
      return undefined;
    }
    return this.read(version);
  }

  async read(version: string): Promise<ReleaseManifest> {
    versionSchema.parse(version);
    await this.dispose();
    this.directory = await mkdtemp(join(tmpdir(), 'heyhey-release-'));
    const { stdout } = await execute(
      'npm',
      [
        'pack',
        `${packageName}@${version}`,
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        this.directory,
      ],
      { timeout: 120_000 },
    );
    const [packed] = z
      .array(z.object({ filename: z.string().regex(/^[a-zA-Z0-9._-]+\.tgz$/) }))
      .length(1)
      .parse(JSON.parse(stdout));
    this.archive = join(this.directory, packed!.filename);
    const manifest = await execute('tar', ['-xOf', this.archive, 'package/release-manifest.json'], {
      timeout: 30_000,
    });
    this.target = parseManifestForVersion(manifest.stdout, version);
    return this.target;
  }

  async install(target: ReleaseManifest): Promise<void> {
    if (!this.archive || !this.target || !sameRelease(this.target, target)) {
      throw new Error('The reviewed release package is unavailable. Retry the update offer.');
    }
    await execute('npm', ['install', '--global', this.archive], {
      timeout: 120_000,
    });
  }

  async dispose(): Promise<void> {
    if (this.directory) {
      await rm(this.directory, { recursive: true, force: true });
    }
    this.directory = undefined;
    this.archive = undefined;
    this.target = undefined;
  }
}
