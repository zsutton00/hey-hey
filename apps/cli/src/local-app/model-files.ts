import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReleaseManifest, ReleaseModelFile } from '../release/release-manifest';

type ReleaseModels = ReleaseManifest['models'];

/** The network boundary: fetch one URL. Replaced in tests; production uses global fetch. */
export type ModelDownload = (url: string) => Promise<Response>;

async function sha256Of(path: string): Promise<string | undefined> {
  const hash = createHash('sha256');
  try {
    await pipeline(createReadStream(path), hash);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }

  return hash.digest('hex');
}

/**
 * Supplies the pinned graph/search model files from the installation's own storage. Present files
 * whose SHA-256 matches the release are reused; anything else is replaced, never trusted.
 * With an override directory (rehearsals, `local dev`) the files there are verified and used.
 */
export class ModelFiles {
  /** Absolute, resolved once, so verification and the Compose mount always see the same files. */
  private readonly override: string | undefined;

  constructor(
    /** The installation's own models directory. */
    private readonly installed: string,
    override: string | undefined = undefined,
    private readonly download: ModelDownload = (url) => fetch(url),
  ) {
    this.override = override ? resolve(override) : undefined;
  }

  /** The directory the graph/search container mounts. */
  get directory(): string {
    return this.override || this.installed;
  }

  /** Verifies (and when needed downloads) both files; returns the directory to mount. */
  async ensure(models: ReleaseModels, onDownload: () => void = () => {}): Promise<string> {
    const files = Object.values(models);
    if (this.override) {
      for (const model of files) {
        await this.verifyOverride(model);
      }

      return this.override;
    }

    await mkdir(this.installed, { recursive: true, mode: 0o700 });
    let announced = false;
    for (const model of files) {
      if ((await sha256Of(join(this.installed, model.file))) === model.sha256) {
        continue;
      }
      if (!announced) {
        announced = true;
        onDownload();
      }
      await this.fetchVerified(model);
    }

    return this.installed;
  }

  private async verifyOverride(model: ReleaseModelFile): Promise<void> {
    const actual = await sha256Of(join(this.override ?? '', model.file));
    if (actual !== model.sha256) {
      throw new Error(
        `HEYHEY_LOCAL_MODEL_DIR must contain the pinned ${model.file}; ${actual ? 'its checksum does not match the release' : 'it is missing'}. Fix the directory or unset HEYHEY_LOCAL_MODEL_DIR to download it, then retry.`,
      );
    }
  }

  private async fetchVerified(model: ReleaseModelFile): Promise<void> {
    const host = new URL(model.url).host;
    const target = join(this.installed, model.file);
    const temporary = `${target}.${process.pid}.download`;
    const failure = (reason: string) =>
      new Error(`Could not download ${model.file} from ${host}: ${reason}. Retry will try again.`);
    try {
      let response: Response;
      try {
        response = await this.download(model.url);
      } catch (error) {
        throw failure(error instanceof Error ? error.message : 'host unreachable');
      }
      if (!response.ok || !response.body) {
        throw failure(`HTTP ${response.status}`);
      }
      try {
        await pipeline(
          Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
          createWriteStream(temporary),
        );
      } catch (error) {
        throw failure(error instanceof Error ? error.message : 'connection lost');
      }
      if ((await sha256Of(temporary)) !== model.sha256) {
        throw failure('the downloaded file failed its checksum and was discarded');
      }
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
}
