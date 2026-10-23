import { readRunAttachmentContent } from '../../agents/providers/run-attachment-content-reader';
import { randomUUID } from 'node:crypto';
import express, { Router } from 'express';
import type { KeyPairStore } from '../../credentials';
import {
  CliReadErrorCode,
  type LocalStagedRunAttachmentErrorResponse,
  type LocalStagedRunAttachmentSuccessResponse,
} from '../../shared/local-agent-api/generated/api';
import { NOOP_LOGGER, type ServerLogger } from '../logger';
import {
  RunAttachmentStore,
  MAX_RUN_ATTACHMENT_BYTES,
  isPlainAttachmentName,
} from '../run-attachment-store';
import { admitMachine, createCorsMiddleware } from './local-run-admission';

export const createStagedRunAttachmentsRouter = (dependencies: {
  allowedOrigins: readonly string[];
  keyPairStore: Pick<KeyPairStore, 'loadCurrentMachineId'>;
  attachmentStore: RunAttachmentStore;
  logger?: ServerLogger;
}): Router => {
  const router = Router();
  const logger = dependencies.logger ?? NOOP_LOGGER;
  const operation = 'run.attachments.stage';
  const route = '/staging';
  const parse = express.raw({
    type: 'application/octet-stream',
    limit: MAX_RUN_ATTACHMENT_BYTES,
    inflate: false,
  });
  router.use(route, createCorsMiddleware(dependencies.allowedOrigins, logger, operation));
  router.post(route, async (request, response) => {
    const requestId = randomUUID();
    const machineId = request.query['machineId'];
    const fileName = request.query['fileName'];
    const fail = (status: number, code: CliReadErrorCode, message: string): void => {
      logger.warn('local.staged_run_attachments.rejected', { requestId, status, code, message });
      if (!response.destroyed && !response.headersSent)
        response.status(status).json({
          requestId,
          operation,
          status: 'error',
          error: { code, message },
        } satisfies LocalStagedRunAttachmentErrorResponse);
    };
    logger.debug('local.staged_run_attachments.started', { requestId });
    if (
      typeof machineId !== 'string' ||
      !machineId.trim() ||
      typeof fileName !== 'string' ||
      !isPlainAttachmentName(fileName)
    ) {
      fail(400, CliReadErrorCode.InvalidRequest, 'A machine ID and plain file name are required.');
      return;
    }
    const admission = await admitMachine(dependencies.keyPairStore, machineId, () =>
      logger.warn('local.staged_run_attachments.machine_identity.failed', { requestId }),
    );
    if (!admission.admitted) {
      fail(admission.status, admission.code, admission.message);
      return;
    }
    logger.debug('local.staged_run_attachments.admitted', { requestId });
    if (!request.is('application/octet-stream')) {
      fail(400, CliReadErrorCode.InvalidRequest, 'An application/octet-stream body is required.');
      return;
    }
    const controller = new AbortController();
    request.once('aborted', () => {
      logger.debug('local.staged_run_attachments.aborted', { requestId });
      controller.abort();
    });
    response.once('close', () => {
      if (!response.writableFinished) {
        logger.debug('local.staged_run_attachments.response_closed', { requestId });
        controller.abort();
      }
    });
    parse(request, response, async (error?: Error & { type?: string }) => {
      if (error) {
        fail(
          error.type === 'entity.too.large' ? 413 : 400,
          error.type === 'entity.too.large'
            ? CliReadErrorCode.FileTooLarge
            : CliReadErrorCode.InvalidRequest,
          'The upload body was rejected.',
        );
        return;
      }
      if (controller.signal.aborted) return;
      if (!Buffer.isBuffer(request.body)) {
        fail(400, CliReadErrorCode.InvalidRequest, 'A binary file body is required.');
        return;
      }
      try {
        readRunAttachmentContent(fileName, request.body);
      } catch {
        fail(
          400,
          CliReadErrorCode.InvalidRequest,
          'Attach UTF-8 text/code files or PNG, JPEG and WebP images. Unsupported formats or invalid file contents were rejected.',
        );
        return;
      }
      try {
        logger.debug('local.staged_run_attachments.storing', {
          requestId,
          fileName,
          sizeBytes: request.body.length,
        });
        const attachment = await dependencies.attachmentStore.saveStaged(
          fileName,
          request.body,
          controller.signal,
        );
        logger.info('local.staged_run_attachments.completed', {
          requestId,
          attachmentId: attachment.attachmentId,
          fileName: attachment.fileName,
          sizeBytes: attachment.sizeBytes,
        });
        response.json({
          requestId,
          operation,
          status: 'success',
          result: { attachment },
        } satisfies LocalStagedRunAttachmentSuccessResponse);
      } catch {
        fail(500, CliReadErrorCode.ReadFailed, 'The attachment could not be stored.');
      }
    });
  });
  return router;
};
