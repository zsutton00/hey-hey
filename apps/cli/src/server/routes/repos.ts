import { Router, type RequestHandler } from 'express';
import type { KeyPairStore } from '../../credentials';
import {
  RepoPathNotDirectoryError,
  RepoPathNotFoundError,
  RepoPathNotReadableError,
  type RepoMappingStore,
  type ServiceRepoBinding,
  toServiceId,
} from '../../repo';
import {
  LocalRepositoryBindingErrorCode,
  type LocalListRepoBindingsResponse,
  type LocalPickRepoDirectoryRequest,
  type LocalPickRepoDirectoryResponse,
  type LocalRepositoryBindingErrorResponse,
  type LocalSetRepoBindingRequest,
  type LocalSetRepoBindingResponse,
  type LocalServiceRepoBinding,
} from '../../shared/local-agent-api/generated/api';
import {
  DirectoryPickerUnavailableError,
  pickServiceDirectory,
  type DirectoryPicker,
} from '../directory-picker';
import { NOOP_LOGGER, type ServerLogger } from '../logger';

export interface ReposRouteDependencies {
  allowedOrigins: readonly string[];
  keyPairStore: Pick<KeyPairStore, 'loadCurrentMachineId'>;
  repoStore: Pick<RepoMappingStore, 'listBindings' | 'setBinding'>;
  directoryPicker?: DirectoryPicker;
  logger?: ServerLogger;
}

const readNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const readPickDirectoryRequest = (value: unknown): LocalPickRepoDirectoryRequest | null => {
  if (typeof value !== 'object' || value === null) return null;
  const machineId = readNonEmptyString((value as Record<string, unknown>)['machineId']);
  return machineId ? ({ machineId } satisfies LocalPickRepoDirectoryRequest) : null;
};

const readSetBindingRequest = (value: unknown): LocalSetRepoBindingRequest | null => {
  if (typeof value !== 'object' || value === null) return null;
  const body = value as Record<string, unknown>;
  const machineId = readNonEmptyString(body['machineId']);
  const repositoryPath = body['repositoryPath'];
  if (!machineId || typeof repositoryPath !== 'string' || repositoryPath.length === 0) {
    return null;
  }
  return { machineId, repositoryPath } satisfies LocalSetRepoBindingRequest;
};

const toLocalBinding = (binding: ServiceRepoBinding): LocalServiceRepoBinding => ({
  serviceId: binding.serviceId,
  repositoryPath: binding.repositoryPath,
  createdAt: binding.createdAt,
  updatedAt: binding.updatedAt,
});

const errorResponse = (
  code: LocalRepositoryBindingErrorResponse['code'],
  message: string,
): LocalRepositoryBindingErrorResponse => ({ code, message });

const createCorsMiddleware = (
  allowedOrigins: readonly string[],
  logger: ServerLogger,
): RequestHandler => {
  const allowed = new Set(allowedOrigins);
  return (request, response, next) => {
    const origin = request.get('origin');
    if (!origin) {
      next();
      return;
    }
    if (!allowed.has(origin)) {
      logger.warn('local.service_directory_bindings.cors_blocked', { origin });
      response
        .status(403)
        .json(
          errorResponse(
            LocalRepositoryBindingErrorCode.OriginNotAllowed,
            'This browser origin is not allowed to access local Service directory bindings.',
          ),
        );
      return;
    }

    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') {
      response.status(204).end();
      return;
    }
    next();
  };
};

const loadMachineId = async (
  keyPairStore: Pick<KeyPairStore, 'loadCurrentMachineId'>,
): Promise<string | null> => readNonEmptyString(await keyPairStore.loadCurrentMachineId());

export const createReposRouter = ({
  allowedOrigins,
  keyPairStore,
  repoStore,
  directoryPicker = pickServiceDirectory,
  logger = NOOP_LOGGER,
}: ReposRouteDependencies): Router => {
  const router = Router();
  router.use(createCorsMiddleware(allowedOrigins, logger));

  router.get('/', async (_request, response) => {
    logger.debug('local.service_directory_bindings.read.started');
    let machineId: string | null;
    try {
      machineId = await loadMachineId(keyPairStore);
    } catch (error) {
      logger.error('local.service_directory_bindings.machine_identity.failed', { error });
      response
        .status(503)
        .json(
          errorResponse(
            LocalRepositoryBindingErrorCode.MachineIdUnavailable,
            'The CLI paired-machine identity is unavailable.',
          ),
        );
      return;
    }
    if (!machineId) {
      response
        .status(503)
        .json(
          errorResponse(
            LocalRepositoryBindingErrorCode.MachineIdUnavailable,
            'The CLI is not paired with a machine.',
          ),
        );
      return;
    }

    try {
      const bindings = await repoStore.listBindings();
      const payload = {
        machineId,
        bindings: bindings.map(toLocalBinding),
      } satisfies LocalListRepoBindingsResponse;
      logger.debug('local.service_directory_bindings.read.completed', {
        bindingCount: bindings.length,
      });
      response.json(payload);
    } catch (error) {
      logger.error('local.service_directory_bindings.read.failed', { error });
      response
        .status(500)
        .json(
          errorResponse(
            LocalRepositoryBindingErrorCode.BindingReadFailed,
            'Failed to read machine-local Service directory bindings.',
          ),
        );
    }
  });

  router.post('/pick-directory', async (request, response) => {
    const body = readPickDirectoryRequest(request.body);
    if (!body) {
      response
        .status(400)
        .json(
          errorResponse(
            LocalRepositoryBindingErrorCode.MachineIdRequired,
            'Request body must include a non-empty "machineId".',
          ),
        );
      return;
    }

    let machineId: string | null;
    try {
      machineId = await loadMachineId(keyPairStore);
    } catch (error) {
      logger.error('local.service_directory_picker.machine_identity.failed', { error });
      response
        .status(503)
        .json(
          errorResponse(
            LocalRepositoryBindingErrorCode.MachineIdUnavailable,
            'The CLI paired-machine identity is unavailable.',
          ),
        );
      return;
    }
    if (!machineId) {
      response
        .status(503)
        .json(
          errorResponse(
            LocalRepositoryBindingErrorCode.MachineIdUnavailable,
            'The CLI is not paired with a machine.',
          ),
        );
      return;
    }
    if (body.machineId !== machineId) {
      logger.warn('local.service_directory_picker.rejected', { reason: 'machine_mismatch' });
      response
        .status(409)
        .json(
          errorResponse(
            LocalRepositoryBindingErrorCode.MachineMismatch,
            'The requested machine does not match the locally paired CLI machine.',
          ),
        );
      return;
    }

    logger.debug('local.service_directory_picker.started');
    try {
      const picked = await directoryPicker();
      const payload =
        picked.status === 'selected'
          ? ({
              status: 'selected',
              machineId,
              repositoryPath: picked.repositoryPath,
            } satisfies LocalPickRepoDirectoryResponse)
          : ({ status: 'cancelled', machineId } satisfies LocalPickRepoDirectoryResponse);
      logger.debug('local.service_directory_picker.completed', {
        selected: picked.status === 'selected',
      });
      response.json(payload);
    } catch (error) {
      logger.error('local.service_directory_picker.failed', { error });
      const unavailable = error instanceof DirectoryPickerUnavailableError;
      response
        .status(unavailable ? 503 : 500)
        .json(
          errorResponse(
            unavailable
              ? LocalRepositoryBindingErrorCode.DirectoryPickerUnavailable
              : LocalRepositoryBindingErrorCode.DirectoryPickerFailed,
            unavailable ? error.message : 'Failed to open or complete the native directory picker.',
          ),
        );
    }
  });

  router.put('/:serviceId', async (request, response) => {
    const serviceId = readNonEmptyString(request.params.serviceId);
    if (!serviceId) {
      response
        .status(400)
        .json(
          errorResponse(
            LocalRepositoryBindingErrorCode.InvalidServiceId,
            'Path parameter "serviceId" is required.',
          ),
        );
      return;
    }

    const body = readSetBindingRequest(request.body);
    if (!body) {
      const rawMachineId =
        typeof request.body === 'object' && request.body !== null
          ? readNonEmptyString((request.body as Record<string, unknown>)['machineId'])
          : null;
      response
        .status(400)
        .json(
          rawMachineId
            ? errorResponse(
                LocalRepositoryBindingErrorCode.InvalidRepositoryPath,
                'Request body must include a non-empty "repositoryPath".',
              )
            : errorResponse(
                LocalRepositoryBindingErrorCode.MachineIdRequired,
                'Request body must include a non-empty "machineId".',
              ),
        );
      return;
    }

    let machineId: string | null;
    try {
      machineId = await loadMachineId(keyPairStore);
    } catch (error) {
      logger.error('local.service_directory_binding.machine_identity.failed', {
        error,
        serviceId,
      });
      response
        .status(503)
        .json(
          errorResponse(
            LocalRepositoryBindingErrorCode.MachineIdUnavailable,
            'The CLI paired-machine identity is unavailable.',
          ),
        );
      return;
    }
    if (!machineId) {
      response
        .status(503)
        .json(
          errorResponse(
            LocalRepositoryBindingErrorCode.MachineIdUnavailable,
            'The CLI is not paired with a machine.',
          ),
        );
      return;
    }
    if (body.machineId !== machineId) {
      logger.warn('local.service_directory_binding.save.rejected', {
        reason: 'machine_mismatch',
        serviceId,
      });
      response
        .status(409)
        .json(
          errorResponse(
            LocalRepositoryBindingErrorCode.MachineMismatch,
            'The requested machine does not match the locally paired CLI machine.',
          ),
        );
      return;
    }

    logger.debug('local.service_directory_binding.save.started', { serviceId });
    try {
      const binding = await repoStore.setBinding(toServiceId(serviceId), body.repositoryPath);
      const payload = {
        machineId,
        binding: toLocalBinding(binding),
      } satisfies LocalSetRepoBindingResponse;
      logger.info('local.service_directory_binding.save.completed', { serviceId });
      response.json(payload);
    } catch (error) {
      logger.warn('local.service_directory_binding.save.failed', { error, serviceId });
      if (error instanceof RepoPathNotFoundError) {
        response
          .status(422)
          .json(
            errorResponse(LocalRepositoryBindingErrorCode.RepositoryPathNotFound, error.message),
          );
        return;
      }
      if (error instanceof RepoPathNotDirectoryError) {
        response
          .status(422)
          .json(
            errorResponse(
              LocalRepositoryBindingErrorCode.RepositoryPathNotDirectory,
              error.message,
            ),
          );
        return;
      }
      if (error instanceof RepoPathNotReadableError) {
        response
          .status(422)
          .json(
            errorResponse(LocalRepositoryBindingErrorCode.RepositoryPathNotReadable, error.message),
          );
        return;
      }
      response
        .status(500)
        .json(
          errorResponse(
            LocalRepositoryBindingErrorCode.BindingWriteFailed,
            'Failed to save the machine-local directory binding for this Service.',
          ),
        );
    }
  });

  return router;
};
