import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveBaseDir } from '../session/paths';
import { LocalAgentApiError } from '../shared/agent-bridge-contract/errors';
import type { RunAttachmentReference } from '../shared/agent-bridge-contract/generated/api';
import type { LocalRunAttachment } from '../shared/local-agent-api/generated/api';

export const MAX_RUN_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const isPlainAttachmentName = (name: string): boolean =>
  name.length > 0 && name !== '.' && name !== '..' && !/[\/\\\0]/.test(name);
export const isAttachmentRunId = (id: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

export class RunAttachmentNotFoundError extends LocalAgentApiError {
  public constructor(runId: string, reference: RunAttachmentReference) {
    super(
      'ATTACHMENT_NOT_FOUND',
      `Attachment ${reference.attachmentId} (${reference.fileName}) is not stored for run ${runId}`,
      404,
    );
    this.name = 'RunAttachmentNotFoundError';
  }
}

export class RunAttachmentStore {
  public constructor(private readonly baseDir = resolveBaseDir()) {}

  /** Preflight the whole message before moving anything; retries retain already-bound files. */
  public async bindStaged(
    runId: string,
    references: readonly RunAttachmentReference[],
  ): Promise<void> {
    const pending: Array<{ source: string; target: string; reference: RunAttachmentReference }> =
      [];
    for (const reference of references) {
      if (
        !isAttachmentRunId(runId) ||
        !isAttachmentRunId(reference.attachmentId) ||
        !isPlainAttachmentName(reference.fileName)
      ) {
        throw new RunAttachmentNotFoundError(runId, reference);
      }
      const source = path.join(this.baseDir, 'run-attachments-staging', reference.attachmentId);
      const target = path.join(this.baseDir, 'run-attachments', runId, reference.attachmentId);
      const containsFile = async (directory: string): Promise<boolean> => {
        try {
          if (!(await fs.lstat(directory)).isDirectory()) return false;
          return (await fs.lstat(path.join(directory, reference.fileName))).isFile();
        } catch (error) {
          if (
            error instanceof Error &&
            'code' in error &&
            (error.code === 'ENOENT' || error.code === 'ENOTDIR')
          )
            return false;
          if (error instanceof Error && 'code' in error) {
            throw new Error(
              `Attachment binding failed for ${reference.attachmentId} (${reference.fileName})`,
            );
          }
          throw error;
        }
      };
      if (await containsFile(target)) continue;
      if (!(await containsFile(source))) throw new RunAttachmentNotFoundError(runId, reference);
      // An existing destination must never be replaced, even if it contains a different file.
      try {
        await fs.lstat(target);
        throw new RunAttachmentNotFoundError(runId, reference);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
          if (error instanceof RunAttachmentNotFoundError) throw error;
          throw new Error(
            `Attachment binding failed for ${reference.attachmentId} (${reference.fileName})`,
          );
        }
      }
      if (!pending.some((item) => item.target === target))
        pending.push({ source, target, reference });
    }
    if (pending.length === 0) return;
    await fs
      .mkdir(path.join(this.baseDir, 'run-attachments', runId), { recursive: true })
      .catch(() => {
        throw new Error(`Cannot prepare attachments for Run ${runId}`);
      });
    for (const item of pending) {
      try {
        await fs.rename(item.source, item.target);
      } catch (error) {
        if (error instanceof Error && 'code' in error) {
          if (error.code === 'ENOENT') throw new RunAttachmentNotFoundError(runId, item.reference);
          throw new Error(
            `Attachment binding failed for ${item.reference.attachmentId} (${item.reference.fileName})`,
          );
        }
        throw error;
      }
    }
    await this.resolvePaths(runId, references);
  }

  public async save(
    runId: string,
    fileName: string,
    bytes: Buffer,
    signal: AbortSignal,
  ): Promise<LocalRunAttachment> {
    if (
      !isAttachmentRunId(runId) ||
      !isPlainAttachmentName(fileName) ||
      bytes.length > MAX_RUN_ATTACHMENT_BYTES
    ) {
      throw new Error('Invalid attachment input');
    }
    signal.throwIfAborted();
    const attachmentId = randomUUID();
    const directory = path.join(this.baseDir, 'run-attachments', runId, attachmentId);
    try {
      await fs.mkdir(directory, { recursive: true });
      signal.throwIfAborted();
      await fs.writeFile(path.join(directory, fileName), bytes, { flag: 'wx', signal });
      signal.throwIfAborted();
      return { attachmentId, fileName, sizeBytes: bytes.length } satisfies LocalRunAttachment;
    } catch (error) {
      await fs.rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  public async saveStaged(
    fileName: string,
    bytes: Buffer,
    signal: AbortSignal,
  ): Promise<LocalRunAttachment> {
    if (!isPlainAttachmentName(fileName) || bytes.length > MAX_RUN_ATTACHMENT_BYTES) {
      throw new Error('Invalid attachment input');
    }
    signal.throwIfAborted();
    const attachmentId = randomUUID();
    const directory = path.join(this.baseDir, 'run-attachments-staging', attachmentId);
    try {
      await fs.mkdir(directory, { recursive: true });
      signal.throwIfAborted();
      await fs.writeFile(path.join(directory, fileName), bytes, { flag: 'wx', signal });
      signal.throwIfAborted();
      return { attachmentId, fileName, sizeBytes: bytes.length } satisfies LocalRunAttachment;
    } catch (error) {
      await fs.rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  // References arrive on a signed but externally authored frame, so each one is
  // checked to name a plain file inside this Run's own attachment directory.
  public async resolvePaths(
    runId: string,
    references: readonly RunAttachmentReference[],
  ): Promise<string[]> {
    const runDirectory = path.join(this.baseDir, 'run-attachments', runId);
    return Promise.all(
      references.map(async (reference) => {
        const filePath = path.join(runDirectory, reference.attachmentId, reference.fileName);
        const isContained =
          isAttachmentRunId(runId) &&
          isAttachmentRunId(reference.attachmentId) &&
          isPlainAttachmentName(reference.fileName) &&
          path.dirname(path.dirname(filePath)) === runDirectory;
        const stat = isContained
          ? await fs.lstat(filePath).catch((error: unknown) => {
              const code = (error as NodeJS.ErrnoException).code;
              if (code === 'ENOENT' || code === 'ENOTDIR') return undefined;
              throw error;
            })
          : undefined;
        if (!stat?.isFile()) {
          throw new RunAttachmentNotFoundError(runId, reference);
        }
        return filePath;
      }),
    );
  }
}
