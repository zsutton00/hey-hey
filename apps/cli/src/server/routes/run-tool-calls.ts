import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { KeyPairStore } from '../../credentials';
import { reportErrorSchemas } from '../../shared/api/generated/report-error-schemas';
import {
  CliReadErrorCode,
  type LocalRunToolCallsLatestTurnRequest,
  type CliReadRunToolCallsLatestTurnErrorResponseDto,
  type CliReadRunToolCallsLatestTurnSuccessResponseDto,
} from '../../shared/local-agent-api/generated/api';
import type { SessionActivitySource } from '../session-activity-source';
import { projectLatestTurnToolCalls } from '../latest-turn-tool-calls';
import { NOOP_LOGGER, type ServerLogger } from '../logger';
import { RunReadPreparationError, type RunReadRestoreCoordinator } from '../restore-persisted-runs';
import { admitMachine, createCorsMiddleware } from './local-run-admission';

export interface RunToolCallsRouteDependencies {
  allowedOrigins: readonly string[];
  keyPairStore: Pick<KeyPairStore, 'loadCurrentMachineId'>;
  restoreCoordinator: Pick<RunReadRestoreCoordinator, 'restoreIdentity'>;
  sessionActivity: Pick<SessionActivitySource, 'snapshot'>;
  isRemoteToolCallViewingEnabled: () => Promise<boolean>;
  logger?: ServerLogger;
}

const ajv = addFormats(new Ajv({ strict: false }));
const validateBody = ajv.compile<LocalRunToolCallsLatestTurnRequest>(
  reportErrorSchemas.LocalRunToolCallsLatestTurnRequest,
);
const validateRunId = ajv.compile<string>(reportErrorSchemas.LocalRunToolCallsLatestTurnRunId);
const operation = 'run.tool_calls.latest_turn';
const route = '/:runId/tool-calls/latest-turn';

export function createRunToolCallsRouter(deps: RunToolCallsRouteDependencies): Router {
  const router = Router();
  const logger = deps.logger ?? NOOP_LOGGER;
  router.use(
    route,
    (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    },
    createCorsMiddleware(deps.allowedOrigins, logger, operation),
  );
  router.post(route, async (req, res) => {
    const requestId = randomUUID();
    const runId = req.params.runId;
    const body: unknown = req.body;
    const fail = (status: number, code: CliReadErrorCode, message: string) => {
      logger.warn('local.tool_calls.rejected', { requestId, runId, code });
      res.status(status).json({
        requestId,
        operation,
        status: 'error',
        error: { code, message },
      } satisfies CliReadRunToolCallsLatestTurnErrorResponseDto);
    };
    if (!validateRunId(runId) || !validateBody(body)) {
      fail(
        400,
        CliReadErrorCode.InvalidRequest,
        'Expected a persisted Run ID and machine identity.',
      );
      return;
    }
    const admission = await admitMachine(deps.keyPairStore, body.machineId, () => {
      logger.warn('local.tool_calls.machine_identity_failed', { requestId, runId });
    });
    if (!admission.admitted) {
      fail(admission.status, admission.code, admission.message);
      return;
    }
    try {
      // Only a Run persisted on this CLI may be read; file context is unrelated.
      const run = await deps.restoreCoordinator.restoreIdentity(runId);
      if (run.runId !== runId || run.session.contextMetadata.agentSessionId !== runId) {
        fail(409, CliReadErrorCode.InvalidRunContext, 'The Run identity does not match.');
        return;
      }
      const result = (await deps.isRemoteToolCallViewingEnabled())
        ? projectLatestTurnToolCalls({
            runId,
            activeTurnId: run.activeTurn?.turnId ?? null,
            activity:
              deps.sessionActivity.snapshot().runs.find((item) => item.runId === runId) ?? null,
          })
        : { state: 'disabled' as const, runId };
      logger.debug('local.tool_calls.completed', { requestId, runId, state: result.state });
      res.json({
        requestId,
        operation,
        status: 'success',
        result,
      } satisfies CliReadRunToolCallsLatestTurnSuccessResponseDto);
    } catch (error) {
      const code =
        error instanceof RunReadPreparationError ? error.code : CliReadErrorCode.ReadFailed;
      fail(
        code === 'RUN_NOT_FOUND' ? 404 : code === 'READ_FAILED' ? 500 : 409,
        code,
        'The local Run could not be read.',
      );
    }
  });
  return router;
}
