import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** A short-lived empty cwd for provider sessions that must not inspect a repository. */
export class IsolatedProviderWorkingDirectory {
  private constructor(public readonly path: string) {}

  public static async create(): Promise<IsolatedProviderWorkingDirectory> {
    const directory = await mkdtemp(path.join(tmpdir(), 'heyhey-provider-isolated-'));
    return new IsolatedProviderWorkingDirectory(directory);
  }

  public async cleanup(): Promise<void> {
    await rm(this.path, { recursive: true, force: true });
  }
}
