import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StructuredServerLogger } from '../server/logger';

export interface ModelFile {
  /** File name inside the model directory. */
  name: string;
  /** Path of the file inside the pinned model repository. */
  path: string;
  sha256: string;
}

const ARCTIC_EMBED_S_BASE_URL =
  'https://huggingface.co/Snowflake/snowflake-arctic-embed-s/resolve/e596f507467533e48a2e17c007f0e1dacc837b33';

/** Same pinned revision and checksums as apps/graph-search/scripts/fetch-model.sh. */
export const ARCTIC_EMBED_S_FILES: readonly ModelFile[] = [
  {
    name: 'model_quantized.onnx',
    path: 'onnx/model_quantized.onnx',
    sha256: 'f93ff225320628d2e88baf2a395cae791b0e3b27edf5c70bf7b312a4d3260c14',
  },
  {
    name: 'tokenizer.json',
    path: 'tokenizer.json',
    sha256: '91f1def9b9391fdabe028cd3f3fcc4efd34e5d1f08c3bf2de513ebb5911a1854',
  },
];

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** Makes sure graph/search's embedding model is present and verified; downloads whatever is not. */
export class ModelDownloader {
  private readonly logger = new StructuredServerLogger({}, { component: 'local-model' });

  constructor(
    private readonly files: readonly ModelFile[] = ARCTIC_EMBED_S_FILES,
    private readonly baseUrl: string = ARCTIC_EMBED_S_BASE_URL,
  ) {}

  async ensure(directory: string, progress: (action: string) => void): Promise<void> {
    await mkdir(directory, { recursive: true });

    for (const file of this.files) {
      const target = join(directory, file.name);

      if (await this.isInstalled(target, file)) {
        this.logger.debug('local.model.present', { file: file.name });
        continue;
      }

      progress(`Downloading ${file.name}`);
      await this.download(file, target);
    }
  }

  private async isInstalled(target: string, file: ModelFile): Promise<boolean> {
    try {
      return sha256(await readFile(target)) === file.sha256;
    } catch (error) {
      if (isMissingFile(error)) {
        return false;
      }
      throw error;
    }
  }

  private async download(file: ModelFile, target: string): Promise<void> {
    const url = `${this.baseUrl}/${file.path}`;
    const temporary = `${target}.${process.pid}.tmp`;
    this.logger.info('local.model.download_started', { file: file.name, url });

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const content = Buffer.from(await response.arrayBuffer());
      const actual = sha256(content);
      if (actual !== file.sha256) {
        throw new Error(`checksum mismatch: expected ${file.sha256}, received ${actual}`);
      }

      await writeFile(temporary, content);
      await rename(temporary, target);
      this.logger.info('local.model.download_finished', { file: file.name, bytes: content.length });
    } catch (error) {
      await rm(temporary, { force: true });
      const cause = error instanceof Error ? error.message : String(error);
      this.logger.error('local.model.download_failed', { file: file.name, url, cause });
      throw new Error(`Could not download ${file.name} from ${url}: ${cause}`);
    }
  }
}
