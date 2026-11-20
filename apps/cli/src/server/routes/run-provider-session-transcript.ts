import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { KeyPairStore } from '../../credentials';
import {
  LocalRunProviderSessionTranscriptErrorCode,
  type LocalRunProviderSessionTranscriptErrorResponse,
  type LocalRunProviderSessionTranscriptRequest,
  type LocalRunProviderSessionTranscriptResult,
} from '@hey-hey/contracts/local';
import type { ClaudeSessionReader } from '../../provider-transcripts/claude-session-reader';
import { NOOP_LOGGER, type ServerLogger } from '../logger';
import type { RunReadRestoreCoordinator } from '../restore-persisted-runs';
import { RunReadPreparationError } from '../run-read-preparation-error';
import {
  admitMachine,
  createBrowserOpenCors,
  isRecord,
  readNonEmptyString,
} from './browser-open-admission';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const PROVIDERS = ['claude', 'codex', 'opencode'] as const;
const REQUEST_KEYS = ['machineId', 'providerId', 'providerSessionId'];
const ROUTE = '/:runId/provider-sessions/transcript';

export interface RunProviderSessionTranscriptRouteDependencies {
  allowedOrigins: readonly string[];
  keyPairStore: Pick<KeyPairStore, 'loadCurrentMachineId'>;
  restoreCoordinator: Pick<RunReadRestoreCoordinator, 'restoreIdentity'>;
  claudeSessions: Pick<ClaudeSessionReader, 'read'>;
  logger?: ServerLogger;
}

const isProviderId = (
  value: unknown,
): value is LocalRunProviderSessionTranscriptRequest['providerId'] =>
  PROVIDERS.some((provider) => provider === value);

/** The one place the external provider session id is validated. */
const readRequest = (value: unknown): LocalRunProviderSessionTranscriptRequest | null => {
  if (!isRecord(value) || !Object.keys(value).every((key) => REQUEST_KEYS.includes(key))) {
    return null;
  }

  const machineId = readNonEmptyString(value['machineId']);
  const providerId = value['providerId'];
  const providerSessionId = value['providerSessionId'];
  if (
    !machineId ||
    !isProviderId(providerId) ||
    typeof providerSessionId !== 'string' ||
    !SESSION_ID_PATTERN.test(providerSessionId)
  ) {
    return null;
  }

  return { machineId, providerId, providerSessionId };
};

const errorBody = (
  code: LocalRunProviderSessionTranscriptErrorCode,
  message: string,
): LocalRunProviderSessionTranscriptErrorResponse => ({ code, message });

/**
 * Same-machine raw provider session read. The text is returned to the caller
 * and never written anywhere: not the Run store, messages, reports or judge input.
 */
export const createRunProviderSessionTranscriptRouter = ({
  allowedOrigins,
  keyPairStore,
  restoreCoordinator,
  claudeSessions,
  logger = NOOP_LOGGER,
}: RunProviderSessionTranscriptRouteDependencies): Router => {
  const router = Router();
  const cors = createBrowserOpenCors(allowedOrigins, logger, {
    event: 'local.provider_session_transcript.cors_blocked',
    message: 'This browser origin is not allowed to read local provider sessions.',
  });
  router.options(ROUTE, cors);

  router.post(ROUTE, cors, async (request, response) => {
    const requestId = randomUUID();
    response.setHeader('Cache-Control', 'no-store');
    const runId = readNonEmptyString(request.params['runId']);
    const parsed = readRequest(request.body);
    if (!runId || !UUID_PATTERN.test(runId) || !parsed) {
      logger.warn('local.provider_session_transcript.rejected', { requestId, runId });
      response
        .status(400)
        .json(
          errorBody(
            LocalRunProviderSessionTranscriptErrorCode.InvalidRequest,
            'Expected a Run ID, a machine ID, a provider and a provider session id.',
          ),
        );
      return;
    }

    const admission = await admitMachine(keyPairStore, parsed.machineId, (error) => {
      logger.error('local.provider_session_transcript.machine_identity.failed', {
        requestId,
        runId,
        error,
      });
    });
    if (!admission.admitted) {
      logger.warn('local.provider_session_transcript.rejected', {
        requestId,
        runId,
        reason: admission.reason,
      });
      response.status(admission.status).json({
        code:
          admission.reason === 'machine_mismatch'
            ? LocalRunProviderSessionTranscriptErrorCode.MachineMismatch
            : LocalRunProviderSessionTranscriptErrorCode.MachineIdUnavailable,
        message: admission.body.message,
      } satisfies LocalRunProviderSessionTranscriptErrorResponse);
      return;
    }

    try {
      const run = await restoreCoordinator.restoreIdentity(runId);
      const { providerId, providerSessionId } = parsed;
      const base = { runId, providerSessionId };
      let result: LocalRunProviderSessionTranscriptResult;
      if (!run.ownsProviderSession(providerSessionId)) {
        result = { ...base, state: 'unavailable', reason: 'SESSION_NOT_IN_RUN' };
      } else if (providerId !== 'claude') {
        result = { ...base, state: 'unavailable', reason: 'PROVIDER_NOT_SUPPORTED' };
      } else {
        const read = await claudeSessions.read(providerSessionId);
        result =
          read.state === 'available'
            ? { ...base, state: 'available', text: read.text, truncated: read.truncated }
            : { ...base, state: 'unavailable', reason: read.reason };
      }

      logger.debug('local.provider_session_transcript.completed', {
        requestId,
        runId,
        providerId,
        state: result.state,
        reason: result.reason,
      });
      response.json(result);
    } catch (error) {
      const notFound = error instanceof RunReadPreparationError && error.code === 'RUN_NOT_FOUND';
      logger.warn('local.provider_session_transcript.failed', {
        requestId,
        runId,
        message: error instanceof Error ? error.message : String(error),
      });
      response
        .status(notFound ? 404 : 500)
        .json(
          errorBody(
            notFound
              ? LocalRunProviderSessionTranscriptErrorCode.RunNotFound
              : LocalRunProviderSessionTranscriptErrorCode.ReadFailed,
            notFound
              ? 'This computer has no record of that Run.'
              : 'The session could not be read.',
          ),
        );
    }
  });

  return router;
};
