import { NOOP_LOGGER, type ServerLogger } from '../../server/logger';
import fs from 'node:fs/promises';
import {
  runAttachmentFormat,
  RUN_ATTACHMENT_FORMAT_HELP,
  type RunAttachmentContent,
} from '../../agent-runtime/index';
import type { RunAttachmentReference } from '../../shared/agent-bridge-contract/generated/api';
import { LocalAgentApiError } from '../../shared/agent-bridge-contract/errors';
import { RunAttachmentStore, RunAttachmentNotFoundError } from '../../server/run-attachment-store';

export class RunAttachmentContentReader {
  constructor(private readonly store = new RunAttachmentStore()) {}

  async read(
    runId: string | undefined,
    references: readonly RunAttachmentReference[],
    logger: ServerLogger = NOOP_LOGGER,
  ): Promise<RunAttachmentContent[]> {
    if (references.length === 0) return [];
    if (!runId)
      throw new LocalAgentApiError('INVALID_REQUEST', 'Attachments require their owning Run.', 400);
    logger.debug('run.attachments.reading', {
      runId,
      attachments: references.map(({ attachmentId, fileName }) => ({ attachmentId, fileName })),
    });
    const paths = await this.store.resolvePaths(runId, references);
    const contents = await Promise.all(
      references.map(async (reference, index): Promise<RunAttachmentContent> => {
        const bytes = await fs.readFile(paths[index]!).catch(() => {
          throw new RunAttachmentNotFoundError(runId, reference);
        });
        return readRunAttachmentContent(reference.fileName, bytes);
      }),
    );
    logger.debug('run.attachments.ready', {
      runId,
      attachments: references.map(({ attachmentId, fileName }) => ({ attachmentId, fileName })),
    });
    return contents;
  }

  async validate(
    runId: string,
    references: readonly RunAttachmentReference[],
    logger: ServerLogger,
  ): Promise<void> {
    await this.read(runId, references, logger);
  }
}

export function readRunAttachmentContent(
  fileName: string,
  bytes: Uint8Array,
): RunAttachmentContent {
  const format = runAttachmentFormat(fileName);
  const reject = (): never => {
    throw new LocalAgentApiError('INVALID_REQUEST', RUN_ATTACHMENT_FORMAT_HELP, 400);
  };
  if (!format) return reject();
  if (format === 'text') {
    try {
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      if (text.includes('\0')) return reject();
      return { kind: 'text', fileName, text };
    } catch {
      return reject();
    }
  }
  const buffer = Buffer.from(bytes);
  const valid =
    format === 'image/png'
      ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : format === 'image/jpeg'
        ? buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
        : buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
          buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!valid) return reject();
  return { kind: 'image', fileName, mediaType: format, data: buffer.toString('base64') };
}
