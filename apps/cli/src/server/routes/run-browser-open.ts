import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { KeyPairStore } from '../../credentials';
import type { ProjectBrowser } from '../../browser/project-browser-manager';
import { SharedBrowserDisabledError } from '../../browser/project-browser-manager';
import type { BrowserTabNotices } from '../../browser/browser-tab-notices';
import type { RunTabs } from '../../browser/run-tabs';
import {
  LocalRunBrowserOpenErrorCode,
  type LocalRunBrowserOpenErrorResponse,
  type LocalRunBrowserOpenRequest,
  type LocalRunBrowserOpenSuccessResponse,
} from '../../shared/local-agent-api/generated/api';
import { NOOP_LOGGER, type ServerLogger } from '../logger';
import { browserStartPageUrl } from './browser-start-page';
import type { RunReadRestoreCoordinator } from '../restore-persisted-runs';
import { RunReadPreparationError } from '../run-read-preparation-error';
import {
  admitMachine,
  createBrowserOpenCors,
  isRecord,
  openFailedMessage,
  readNonEmptyString,
  readOpenUrl,
} from './browser-open-admission';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROUTE = '/:runId/browser/open';

export interface RunBrowserOpenRouteDependencies {
  allowedOrigins: readonly string[];
  keyPairStore: Pick<KeyPairStore, 'loadCurrentMachineId'>;
  restoreCoordinator: Pick<RunReadRestoreCoordinator, 'restoreIdentity'>;
  projectBrowsers: Pick<ProjectBrowser, 'isEnabled'>;
  tabs: Pick<RunTabs, 'open'> & { notices: Pick<BrowserTabNotices, 'record'> };
  logger?: ServerLogger;
}

type ParsedRequest =
  | { ok: true; request: Required<LocalRunBrowserOpenRequest> }
  | { ok: false; code: LocalRunBrowserOpenErrorCode; message: string };

const readRequest = (value: unknown, defaultUrl: string): ParsedRequest => {
  const invalid = {
    ok: false,
    code: LocalRunBrowserOpenErrorCode.InvalidRequest,
    message: 'The request must include a persisted Run ID, a machine ID and an optional URL only.',
  } as const;
  if (!isRecord(value) || !Object.keys(value).every((key) => key === 'machineId' || key === 'url'))
    return invalid;
  const machineId = readNonEmptyString(value['machineId']);
  if (!machineId) return invalid;
  if (value['url'] !== undefined && typeof value['url'] !== 'string') return invalid;
  const url = readOpenUrl(value['url'], defaultUrl);
  if (!url.ok) return { ok: false, ...url.error };
  return { ok: true, request: { machineId, url: url.url } };
};

const errorBody = (
  code: LocalRunBrowserOpenErrorCode,
  message: string,
): LocalRunBrowserOpenErrorResponse => ({ code, message });

/**
 * Same-machine Open browser: opens and selects a Run-owned tab, then queues
 * the notice the Run's next Turn tells the agent. Any rejection leaves
 * neither a tab nor a notice.
 */
export const createRunBrowserOpenRouter = ({
  allowedOrigins,
  keyPairStore,
  restoreCoordinator,
  projectBrowsers,
  tabs,
  logger = NOOP_LOGGER,
}: RunBrowserOpenRouteDependencies): Router => {
  const router = Router();
  const cors = createBrowserOpenCors(allowedOrigins, logger, {
    event: 'local.run_browser_open.cors_blocked',
    message: 'This browser origin is not allowed to open local Run browser tabs.',
  });
  router.options(ROUTE, cors);

  router.post(ROUTE, cors, async (request, response) => {
    const requestId = randomUUID();
    const runId = readNonEmptyString(request.params['runId']);
    // Without an address the tab starts on this CLI's start page rather than a blank document.
    const startPage = browserStartPageUrl(request.get('host'));
    const parsed = startPage
      ? readRequest(request.body, startPage)
      : ({
          ok: false,
          code: LocalRunBrowserOpenErrorCode.InvalidRequest,
          message: 'The CLI must be reached on a loopback host.',
        } as const);
    if (!runId || !UUID_PATTERN.test(runId) || !parsed.ok) {
      const failure = parsed.ok
        ? errorBody(LocalRunBrowserOpenErrorCode.InvalidRequest, 'The Run ID must be a UUID.')
        : errorBody(parsed.code, parsed.message);
      logger.warn('local.run_browser_open.rejected', { requestId, runId, reason: failure.code });
      response.status(400).json(failure);
      return;
    }
    const { machineId, url } = parsed.request;

    const admission = await admitMachine(keyPairStore, machineId, (error) => {
      logger.error('local.run_browser_open.machine_identity.failed', { requestId, runId, error });
    });
    if (!admission.admitted) {
      logger.warn('local.run_browser_open.rejected', {
        requestId,
        runId,
        reason: admission.reason,
      });
      response.status(admission.status).json(admission.body);
      return;
    }

    try {
      const run = await restoreCoordinator.restoreIdentity(runId);
      if (!(await projectBrowsers.isEnabled())) throw new SharedBrowserDisabledError();
      await tabs.open(runId, run.projectId, url);
      tabs.notices.record(runId, { id: randomUUID(), url });
      logger.info('local.run_browser_open.completed', { requestId, runId });
      response.json({ runId, url } satisfies LocalRunBrowserOpenSuccessResponse);
    } catch (error) {
      const failure =
        error instanceof RunReadPreparationError && error.code === 'RUN_NOT_FOUND'
          ? {
              status: 404,
              body: errorBody(LocalRunBrowserOpenErrorCode.RunNotFound, error.message),
            }
          : error instanceof SharedBrowserDisabledError
            ? {
                status: 422,
                body: errorBody(LocalRunBrowserOpenErrorCode.SharedBrowserDisabled, error.message),
              }
            : {
                status: 500,
                body: errorBody(LocalRunBrowserOpenErrorCode.OpenFailed, openFailedMessage(error)),
              };
      logger.warn('local.run_browser_open.failed', {
        requestId,
        runId,
        code: failure.body.code,
        errorName: error instanceof Error ? error.name : 'NonError',
        message: error instanceof Error ? error.message : String(error),
        url,
      });
      response.status(failure.status).json(failure.body);
    }
  });

  return router;
};
