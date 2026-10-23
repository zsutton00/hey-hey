import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { KeyPairStore } from '../../credentials';
import {
  CliReadErrorCode,
  type LocalRunAttachmentErrorResponse,
  type LocalRunAttachmentOpenErrorResponse,
  type LocalStagedRunAttachmentErrorResponse,
  type CliReadRunChangedFileDetailErrorResponseDto,
  type CliReadRunChangedFilesInventoryErrorResponseDto,
} from '../../shared/local-agent-api/generated/api';
import type { ServerLogger } from '../logger';
type LocalRunFailure =
  | LocalRunAttachmentErrorResponse
  | LocalRunAttachmentOpenErrorResponse
  | LocalStagedRunAttachmentErrorResponse
  | CliReadRunChangedFileDetailErrorResponseDto
  | CliReadRunChangedFilesInventoryErrorResponseDto;
type LocalRunOperation = LocalRunFailure['operation'];
const errorResponse = (operation: LocalRunOperation, requestId: string, message: string) =>
  ({
    requestId,
    operation,
    status: 'error' as const,
    error: { code: CliReadErrorCode.InvalidRequest, message },
  }) satisfies LocalRunFailure;
export const createCorsMiddleware = (
  allowedOrigins: readonly string[],
  logger: ServerLogger,
  operation: LocalRunOperation,
): RequestHandler => {
  const allowed = new Set(allowedOrigins);
  return (request, response, next) => {
    const origin = request.get('origin');
    if (!origin) {
      next();
      return;
    }
    if (!allowed.has(origin)) {
      const requestId = randomUUID();
      logger.warn('local.run_changed_files.cors_blocked', { origin, requestId, operation });
      response
        .status(403)
        .json(
          errorResponse(
            operation,
            requestId,
            operation === 'run.attachments.upload' || operation === 'run.attachments.stage'
              ? 'This browser origin is not allowed to upload local Run attachments.'
              : operation === 'run.attachments.open'
                ? 'This browser origin is not allowed to open local Run attachments.'
                : 'This browser origin is not allowed to read local Run changed files.',
          ),
        );
      return;
    }
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') {
      response.status(204).end();
      return;
    }
    next();
  };
};

type MachineAdmission =
  | { admitted: true }
  | { admitted: false; status: 409 | 503; code: CliReadErrorCode; message: string; reason: string };

/**
 * Being on loopback is the authorization: once the origin is approved, the
 * only remaining gate is that the requested machine is this paired CLI.
 */
export const admitMachine = async (
  keyPairStore: Pick<KeyPairStore, 'loadCurrentMachineId'>,
  requestedMachineId: string,
  onLoadFailure: () => void,
): Promise<MachineAdmission> => {
  let localMachineId: string | null;
  try {
    localMachineId = (await keyPairStore.loadCurrentMachineId())?.trim() || null;
  } catch {
    onLoadFailure();
    return {
      admitted: false,
      status: 503,
      code: CliReadErrorCode.MachineNotBound,
      message: 'The CLI paired-machine identity is unavailable.',
      reason: 'machine_identity_failed',
    };
  }
  if (!localMachineId) {
    return {
      admitted: false,
      status: 503,
      code: CliReadErrorCode.MachineNotBound,
      message: 'The CLI is not paired with a machine.',
      reason: 'machine_identity_unavailable',
    };
  }
  if (requestedMachineId !== localMachineId) {
    return {
      admitted: false,
      status: 409,
      code: CliReadErrorCode.MachineNotBound,
      message: 'The requested machine does not match the locally paired CLI machine.',
      reason: 'machine_mismatch',
    };
  }
  return { admitted: true };
};
