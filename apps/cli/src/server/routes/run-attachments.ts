import { readRunAttachmentContent } from '../../agents/providers/run-attachment-content-reader';
import { randomUUID } from 'node:crypto';
import express, { Router } from 'express';
import type { KeyPairStore } from '../../credentials';
import {
  CliReadErrorCode,
  LocalRunAttachmentOpenErrorCode,
  type LocalRunAttachmentErrorResponse,
  type LocalRunAttachmentOpenAction,
  type LocalRunAttachmentOpenErrorResponse,
  type LocalRunAttachmentOpenSuccessResponse,
  type LocalRunAttachmentSuccessResponse,
} from '../../shared/local-agent-api/generated/api';
import {
  AttachmentOpenerUnavailableError,
  createAttachmentShower,
  type ShowAttachment,
} from '../attachment-opener';
import { NOOP_LOGGER, type ServerLogger } from '../logger';
import { RunReadPreparationError, type RunReadRestoreCoordinator } from '../restore-persisted-runs';
import {
  RunAttachmentStore,
  RunAttachmentNotFoundError,
  MAX_RUN_ATTACHMENT_BYTES,
  isPlainAttachmentName,
  isAttachmentRunId,
} from '../run-attachment-store';
import { admitMachine, createCorsMiddleware } from './local-run-admission';

export const createRunAttachmentsRouter = (dependencies: {
  allowedOrigins: readonly string[];
  keyPairStore: Pick<KeyPairStore, 'loadCurrentMachineId'>;
  restoreCoordinator: Pick<RunReadRestoreCoordinator, 'restore'>;
  attachmentStore: RunAttachmentStore;
  showAttachment?: ShowAttachment;
  logger?: ServerLogger;
}): Router => {
  const router = Router();
  const logger = dependencies.logger ?? NOOP_LOGGER;
  const operation = 'run.attachments.upload';
  const route = '/:runId/attachments';
  const parse = express.raw({
    type: 'application/octet-stream',
    limit: MAX_RUN_ATTACHMENT_BYTES,
    inflate: false,
  });
  // Exact-path matching keeps the upload middleware off the nested open route.
  router.all(route, createCorsMiddleware(dependencies.allowedOrigins, logger, operation));
  router.post(route, async (request, response) => {
    const requestId = randomUUID();
    const runId = request.params.runId;
    const machineId = request.query['machineId'];
    const fileName = request.query['fileName'];
    const fail = (status: number, code: CliReadErrorCode, message: string): void => {
      logger.warn('local.run_attachments.rejected', { requestId, runId, code });
      if (!response.destroyed && !response.headersSent)
        response.status(status).json({
          requestId,
          operation,
          status: 'error',
          error: { code, message },
        } satisfies LocalRunAttachmentErrorResponse);
    };
    logger.debug('local.run_attachments.started', { requestId, runId });
    if (
      !isAttachmentRunId(runId) ||
      typeof machineId !== 'string' ||
      !machineId.trim() ||
      typeof fileName !== 'string' ||
      !isPlainAttachmentName(fileName)
    ) {
      fail(
        400,
        CliReadErrorCode.InvalidRequest,
        'A persisted Run ID, machine ID and plain file name are required.',
      );
      return;
    }
    const admission = await admitMachine(dependencies.keyPairStore, machineId, () =>
      logger.warn('local.run_attachments.machine_identity.failed', { requestId, runId }),
    );
    if (!admission.admitted) {
      fail(admission.status, admission.code, admission.message);
      return;
    }
    try {
      await dependencies.restoreCoordinator.restore(runId);
      logger.debug('local.run_attachments.run_restored', { requestId, runId });
    } catch (error) {
      const code =
        error instanceof RunReadPreparationError ? error.code : CliReadErrorCode.ReadFailed;
      fail(
        code === 'RUN_NOT_FOUND'
          ? 404
          : code === 'READ_FAILED'
            ? 500
            : code === 'RUN_ID_MISMATCH' || code === 'INVALID_RUN_CONTEXT'
              ? 409
              : 422,
        code,
        'The persisted Run is unavailable for upload.',
      );
      return;
    }
    if (!request.is('application/octet-stream')) {
      fail(400, CliReadErrorCode.InvalidRequest, 'An application/octet-stream body is required.');
      return;
    }
    const controller = new AbortController();
    request.once('aborted', () => controller.abort());
    response.once('close', () => {
      if (!response.writableFinished) controller.abort();
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
        const attachment = await dependencies.attachmentStore.save(
          runId,
          fileName,
          request.body,
          controller.signal,
        );
        logger.info('local.run_attachments.completed', {
          requestId,
          runId,
          attachmentId: attachment.attachmentId,
          fileName: attachment.fileName,
        });
        response.json({
          requestId,
          operation,
          status: 'success',
          result: { runId, attachment },
        } satisfies LocalRunAttachmentSuccessResponse);
      } catch {
        fail(500, CliReadErrorCode.ReadFailed, 'The attachment could not be stored.');
      }
    });
  });
  const openOperation = 'run.attachments.open';
  const openRoute = '/:runId/attachments/:attachmentId/open';
  const showAttachment = dependencies.showAttachment ?? createAttachmentShower();
  router.all(openRoute, createCorsMiddleware(dependencies.allowedOrigins, logger, openOperation));
  router.post(openRoute, async (request, response) => {
    const requestId = randomUUID();
    const { runId, attachmentId } = request.params;
    const machineId = request.query['machineId'];
    const fileName = request.query['fileName'];
    const fail = (status: number, code: LocalRunAttachmentOpenErrorCode, message: string): void => {
      logger.warn('local.run_attachments.open.rejected', { requestId, runId, attachmentId, code });
      response.status(status).json({
        requestId,
        operation: openOperation,
        status: 'error',
        error: { code, message },
      } satisfies LocalRunAttachmentOpenErrorResponse);
    };
    const notFound = (): void =>
      fail(
        404,
        LocalRunAttachmentOpenErrorCode.AttachmentNotFound,
        'The attachment is no longer stored.',
      );
    if (
      !isAttachmentRunId(runId) ||
      !isAttachmentRunId(attachmentId) ||
      typeof machineId !== 'string' ||
      !machineId.trim() ||
      typeof fileName !== 'string' ||
      !isPlainAttachmentName(fileName)
    ) {
      fail(
        400,
        LocalRunAttachmentOpenErrorCode.InvalidRequest,
        'A Run ID, attachment ID, machine ID and plain file name are required.',
      );
      return;
    }
    const admission = await admitMachine(dependencies.keyPairStore, machineId, () =>
      logger.warn('local.run_attachments.machine_identity.failed', { requestId, runId }),
    );
    if (!admission.admitted) {
      fail(admission.status, LocalRunAttachmentOpenErrorCode.MachineNotBound, admission.message);
      return;
    }
    try {
      await dependencies.restoreCoordinator.restore(runId);
    } catch (error) {
      const code = error instanceof RunReadPreparationError ? error.code : 'READ_FAILED';
      // Retention removes a Run together with its attachments.
      if (code === 'RUN_NOT_FOUND') notFound();
      else if (code === 'RUN_ID_MISMATCH' || code === 'INVALID_RUN_CONTEXT')
        fail(409, code, 'The persisted Run is unavailable.');
      else
        fail(
          500,
          LocalRunAttachmentOpenErrorCode.ReadFailed,
          'The persisted Run could not be read.',
        );
      return;
    }
    let filePath: string;
    try {
      const reference = { attachmentId, fileName };
      const [resolved] = await dependencies.attachmentStore.resolvePaths(runId, [reference]);
      if (resolved === undefined) throw new RunAttachmentNotFoundError(runId, reference);
      filePath = resolved;
    } catch (error) {
      if (error instanceof RunAttachmentNotFoundError) notFound();
      else
        fail(500, LocalRunAttachmentOpenErrorCode.ReadFailed, 'The attachment could not be read.');
      return;
    }
    let action: LocalRunAttachmentOpenAction;
    try {
      action = await showAttachment(filePath);
    } catch (error) {
      if (error instanceof AttachmentOpenerUnavailableError)
        fail(
          503,
          LocalRunAttachmentOpenErrorCode.OpenerUnavailable,
          'No application is available on this computer to show the attachment.',
        );
      else
        fail(500, LocalRunAttachmentOpenErrorCode.OpenFailed, 'The attachment could not be shown.');
      return;
    }
    logger.info('local.run_attachments.open.completed', { requestId, runId, attachmentId, action });
    response.json({
      requestId,
      operation: openOperation,
      status: 'success',
      result: { runId, attachmentId, action },
    } satisfies LocalRunAttachmentOpenSuccessResponse);
  });
  return router;
};
