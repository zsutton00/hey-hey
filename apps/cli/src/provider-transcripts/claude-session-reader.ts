import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { NOOP_LOGGER, type ServerLogger } from '../server/logger';

/** Generous cap so a very long session cannot exhaust memory; truncation is always reported. */
export const MAX_TRANSCRIPT_BYTES = 20 * 1024 * 1024;

export type ClaudeSessionRead =
  | { state: 'available'; text: string; truncated: boolean }
  | { state: 'unavailable'; reason: 'SESSION_FILE_NOT_FOUND' | 'SESSION_FILE_UNREADABLE' };

/**
 * Reads Claude's own stored session file, unmodified. The file is found by
 * listing Claude's project folders and matching the exact `<sessionId>.jsonl`
 * name; the session id is never joined into a path.
 */
export class ClaudeSessionReader {
  private readonly projectsDir: string;
  private readonly logger: ServerLogger;

  public constructor(options: { projectsDir?: string; logger?: ServerLogger } = {}) {
    this.projectsDir = options.projectsDir ?? path.join(homedir(), '.claude', 'projects');
    this.logger = options.logger ?? NOOP_LOGGER;
  }

  public async read(providerSessionId: string): Promise<ClaudeSessionRead> {
    const fileName = `${providerSessionId}.jsonl`;
    try {
      const folders = await readdir(this.projectsDir, { withFileTypes: true });
      for (const folder of folders) {
        if (!folder.isDirectory()) {
          continue;
        }

        const names = await readdir(path.join(this.projectsDir, folder.name));
        if (!names.includes(fileName)) {
          continue;
        }

        return await this.readFile(path.join(this.projectsDir, folder.name, fileName));
      }
    } catch (error) {
      if (isMissing(error)) {
        this.logger.debug('provider_transcript.claude.not_found', { providerSessionId });
        return { state: 'unavailable', reason: 'SESSION_FILE_NOT_FOUND' };
      }

      this.logger.warn('provider_transcript.claude.unreadable', {
        providerSessionId,
        message: error instanceof Error ? error.message : String(error),
      });
      return { state: 'unavailable', reason: 'SESSION_FILE_UNREADABLE' };
    }

    this.logger.debug('provider_transcript.claude.not_found', { providerSessionId });
    return { state: 'unavailable', reason: 'SESSION_FILE_NOT_FOUND' };
  }

  private async readFile(filePath: string): Promise<ClaudeSessionRead> {
    const { size } = await stat(filePath);
    const length = Math.min(size, MAX_TRANSCRIPT_BYTES);
    const handle = await open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      return {
        state: 'available',
        text: buffer.subarray(0, bytesRead).toString('utf8'),
        truncated: size > MAX_TRANSCRIPT_BYTES,
      };
    } finally {
      await handle.close();
    }
  }
}

const isMissing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';
