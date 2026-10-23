import { admitMachine, createCorsMiddleware } from './local-run-admission';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { KeyPairStore } from '../../credentials';
import {
  CliReadErrorCode,
  type CliReadChangedFileIdentity,
  type CliReadRunChangedFileDetailErrorResponseDto,
  type CliReadRunChangedFileDetailSuccessResponseDto,
  type CliReadRunChangedFilesInventoryErrorResponseDto,
  type CliReadRunChangedFilesInventorySuccessResponseDto,
  type LocalRunChangedFileDetailRequest,
  type LocalRunChangedFilesInventoryRequest,
} from '../../shared/local-agent-api/generated/api';
import { NOOP_LOGGER, type ServerLogger } from '../logger';
import { RunChangedFilesContextError, type RunChangedFilesReader } from '../run-changed-files';
import { RunReadPreparationError, type RunReadRestoreCoordinator } from '../restore-persisted-runs';

const MAX_CHANGED_FILE_PATH_LENGTH = 4_096;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RunChangedFileDetailRouteDependencies {
  allowedOrigins: readonly string[];
  keyPairStore: Pick<KeyPairStore, 'loadCurrentMachineId'>;
  restoreCoordinator: Pick<RunReadRestoreCoordinator, 'restore'>;
  runChangedFilesReader: Pick<
    RunChangedFilesReader,
    'getLiveRunChangedFileDetail' | 'getLiveRunChangedFilesInventory'
  >;
  logger?: ServerLogger;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key)) &&
  keys.every((key) => Object.hasOwn(value, key));

const readNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const readChangedFileIdentity = (value: unknown): CliReadChangedFileIdentity | null => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['serviceId', 'repoPath', 'filePath'])) return null;
  const serviceId = readNonEmptyString(value['serviceId']);
  const repoPath = readNonEmptyString(value['repoPath']);
  const filePath = readNonEmptyString(value['filePath']);
  if (
    !serviceId ||
    !UUID_PATTERN.test(serviceId) ||
    !repoPath ||
    repoPath.length > MAX_CHANGED_FILE_PATH_LENGTH ||
    !filePath ||
    filePath.length > MAX_CHANGED_FILE_PATH_LENGTH
  ) {
    return null;
  }
  return { serviceId, repoPath, filePath } satisfies CliReadChangedFileIdentity;
};

const readRequest = (value: unknown): LocalRunChangedFileDetailRequest | null => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['machineId', 'file'])) return null;
  const machineId = readNonEmptyString(value['machineId']);
  const file = readChangedFileIdentity(value['file']);
  return machineId && file
    ? ({ machineId, file } satisfies LocalRunChangedFileDetailRequest)
    : null;
};

const readInventoryRequest = (value: unknown): LocalRunChangedFilesInventoryRequest | null => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['machineId'])) return null;
  const machineId = readNonEmptyString(value['machineId']);
  return machineId ? ({ machineId } satisfies LocalRunChangedFilesInventoryRequest) : null;
};

type LocalRunChangedFilesOperation = 'run.changed_files.detail' | 'run.changed_files.inventory';

type LocalRunChangedFilesErrorResponse<TOperation extends LocalRunChangedFilesOperation> =
  TOperation extends 'run.changed_files.detail'
    ? CliReadRunChangedFileDetailErrorResponseDto
    : CliReadRunChangedFilesInventoryErrorResponseDto;

const errorResponse = <TOperation extends LocalRunChangedFilesOperation>(
  operation: TOperation,
  requestId: string,
  code: CliReadErrorCode,
  message: string,
): LocalRunChangedFilesErrorResponse<TOperation> =>
  ({
    requestId,
    operation,
    status: 'error',
    error: { code, message },
  }) as LocalRunChangedFilesErrorResponse<TOperation>;

const resolveFailure = (
  error: Error,
): { status: number; code: CliReadErrorCode; message: string } => {
  if (error instanceof RunReadPreparationError) {
    const status =
      error.code === 'RUN_NOT_FOUND'
        ? 404
        : error.code === 'RUN_ID_MISMATCH' || error.code === 'INVALID_RUN_CONTEXT'
          ? 409
          : error.code === 'READ_FAILED'
            ? 500
            : 422;
    return { status, code: error.code, message: error.message };
  }
  if (error instanceof RunChangedFilesContextError) {
    return {
      status:
        error.code === 'REPOSITORY_NOT_FOUND' ? 404 : error.code === 'GIT_READ_FAILED' ? 500 : 422,
      code:
        error.code === 'REPOSITORY_NOT_FOUND'
          ? CliReadErrorCode.RepositoryNotFound
          : error.code === 'INVALID_FILE_MEMBERSHIP'
            ? CliReadErrorCode.InvalidFileMembership
            : error.code === 'GIT_READ_FAILED'
              ? CliReadErrorCode.ReadFailed
              : CliReadErrorCode.InvalidRepositoryPath,
      message: error.message,
    };
  }
  return { status: 500, code: CliReadErrorCode.ReadFailed, message: 'The CLI read failed.' };
};

export const createRunChangedFileDetailRouter = ({
  allowedOrigins,
  keyPairStore,
  restoreCoordinator,
  runChangedFilesReader,
  logger = NOOP_LOGGER,
}: RunChangedFileDetailRouteDependencies): Router => {
  const router = Router();
  router.use(
    '/:runId/changed-files/inventory',
    createCorsMiddleware(allowedOrigins, logger, 'run.changed_files.inventory'),
  );
  router.use(
    '/:runId/changed-files/detail',
    createCorsMiddleware(allowedOrigins, logger, 'run.changed_files.detail'),
  );

  router.post('/:runId/changed-files/inventory', async (request, response) => {
    const operation = 'run.changed_files.inventory';
    const requestId = randomUUID();
    const runId = readNonEmptyString(request.params.runId);
    const body = readInventoryRequest(request.body);
    logger.debug('local.run_changed_files_inventory.started', { requestId, runId });
    if (!runId || !UUID_PATTERN.test(runId) || !body) {
      logger.warn('local.run_changed_files_inventory.rejected', {
        requestId,
        runId,
        reason: 'invalid_request',
      });
      response
        .status(400)
        .json(
          errorResponse(
            operation,
            requestId,
            CliReadErrorCode.InvalidRequest,
            'The request must include a persisted Run ID and machine ID only.',
          ),
        );
      return;
    }

    const admission = await admitMachine(keyPairStore, body.machineId, () => {
      logger.error('local.run_changed_files_inventory.machine_identity.failed', {
        requestId,
        runId,
      });
    });
    if (!admission.admitted) {
      logger.warn('local.run_changed_files_inventory.rejected', {
        requestId,
        runId,
        reason: admission.reason,
      });
      response
        .status(admission.status)
        .json(errorResponse(operation, requestId, admission.code, admission.message));
      return;
    }

    try {
      const run = await restoreCoordinator.restore(runId);
      const entries = await runChangedFilesReader.getLiveRunChangedFilesInventory(
        run.session,
        run.getFileChangeProjection(),
      );
      const payload = {
        requestId,
        operation,
        status: 'success',
        result: { runId, entries },
      } satisfies CliReadRunChangedFilesInventorySuccessResponseDto;
      logger.info('local.run_changed_files_inventory.completed', {
        requestId,
        runId,
        entryCount: entries.length,
      });
      response.json(payload);
    } catch (error) {
      const failure = resolveFailure(error instanceof Error ? error : new Error(String(error)));
      logger.warn('local.run_changed_files_inventory.failed', {
        requestId,
        runId,
        code: failure.code,
        errorName: error instanceof Error ? error.name : 'NonError',
      });
      response
        .status(failure.status)
        .json(errorResponse(operation, requestId, failure.code, failure.message));
    }
  });

  router.post('/:runId/changed-files/detail', async (request, response) => {
    const operation = 'run.changed_files.detail';
    const requestId = randomUUID();
    const runId = readNonEmptyString(request.params.runId);
    const body = readRequest(request.body);
    logger.debug('local.run_changed_file_detail.started', { requestId, runId });
    if (!runId || !UUID_PATTERN.test(runId) || !body) {
      logger.warn('local.run_changed_file_detail.rejected', {
        requestId,
        runId,
        reason: 'invalid_request',
      });
      response
        .status(400)
        .json(
          errorResponse(
            operation,
            requestId,
            CliReadErrorCode.InvalidRequest,
            'The request must include a persisted Run ID, machine ID, and exact inventory file identity.',
          ),
        );
      return;
    }

    const admission = await admitMachine(keyPairStore, body.machineId, () => {
      logger.error('local.run_changed_file_detail.machine_identity.failed', {
        requestId,
        runId,
      });
    });
    if (!admission.admitted) {
      logger.warn('local.run_changed_file_detail.rejected', {
        requestId,
        runId,
        reason: admission.reason,
      });
      response
        .status(admission.status)
        .json(errorResponse(operation, requestId, admission.code, admission.message));
      return;
    }

    try {
      const run = await restoreCoordinator.restore(runId);
      const file = await runChangedFilesReader.getLiveRunChangedFileDetail(
        run.session,
        run.getFileChangeProjection(),
        body.file,
      );
      const payload = {
        requestId,
        operation,
        status: 'success',
        result: { runId, file },
      } satisfies CliReadRunChangedFileDetailSuccessResponseDto;
      logger.info('local.run_changed_file_detail.completed', {
        requestId,
        runId,
        serviceId: body.file.serviceId,
        filePath: body.file.filePath,
      });
      response.json(payload);
    } catch (error) {
      const failure = resolveFailure(error instanceof Error ? error : new Error(String(error)));
      logger.warn('local.run_changed_file_detail.failed', {
        requestId,
        runId,
        serviceId: body.file.serviceId,
        filePath: body.file.filePath,
        code: failure.code,
        errorName: error instanceof Error ? error.name : 'NonError',
      });
      response
        .status(failure.status)
        .json(errorResponse(operation, requestId, failure.code, failure.message));
    }
  });

  return router;
};
