import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { KeyPairStore } from '../../credentials';
import { SharedBrowserDisabledError } from '../../browser/project-browser-manager';
import type { ProjectBrowser } from '../../browser/project-browser-manager';
import type { RunTabs } from '../../browser/run-tabs';
import {
  LocalStagedBrowserTabOpenErrorCode,
  type LocalStagedBrowserTabOpenErrorResponse,
  type LocalStagedBrowserTabOpenSuccessResponse,
} from '../../shared/local-agent-api/generated/api';
import { NOOP_LOGGER, type ServerLogger } from '../logger';
import { browserStartPageUrl } from './browser-start-page';
import {
  admitMachine,
  createBrowserOpenCors,
  isRecord,
  openFailedMessage,
  readNonEmptyString,
  readOpenUrl,
} from './browser-open-admission';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Mounted under `/api/local/browser`. */
const ROUTE = '/staged-tabs';
const REQUEST_KEYS = new Set(['machineId', 'projectId', 'url']);

export interface StagedBrowserTabOpenRouteDependencies {
  allowedOrigins: readonly string[];
  keyPairStore: Pick<KeyPairStore, 'loadCurrentMachineId'>;
  projectBrowsers: Pick<ProjectBrowser, 'isEnabled'>;
  tabs: Pick<RunTabs, 'stage'>;
  logger?: ServerLogger;
}

const errorBody = (
  code: LocalStagedBrowserTabOpenErrorCode,
  message: string,
): LocalStagedBrowserTabOpenErrorResponse => ({ code, message });

type ParsedRequest =
  | { ok: true; machineId: string; projectId: string; url: string }
  | { ok: false; body: LocalStagedBrowserTabOpenErrorResponse };

const readRequest = (value: unknown, defaultUrl: string): ParsedRequest => {
  const invalid = {
    ok: false,
    body: errorBody(
      LocalStagedBrowserTabOpenErrorCode.InvalidRequest,
      'The request must include a machine ID, a project ID and an optional URL only.',
    ),
  } as const;
  if (!isRecord(value) || !Object.keys(value).every((key) => REQUEST_KEYS.has(key))) return invalid;
  const machineId = readNonEmptyString(value['machineId']);
  const projectId = readNonEmptyString(value['projectId']);
  if (!machineId || !projectId || !UUID_PATTERN.test(projectId)) return invalid;
  if (value['url'] !== undefined && typeof value['url'] !== 'string') return invalid;
  const url = readOpenUrl(value['url'], defaultUrl);
  if (!url.ok) return { ok: false, body: url.error };
  return { ok: true, machineId, projectId, url: url.url };
};

/**
 * Same-machine Open browser before a Run exists: opens a tab owned by no Run
 * and returns the staged reference a start-run carries so the new Run adopts
 * it. Any rejection opens no tab; a tab no Run adopts is left open.
 */
export const createStagedBrowserTabOpenRouter = ({
  allowedOrigins,
  keyPairStore,
  projectBrowsers,
  tabs,
  logger = NOOP_LOGGER,
}: StagedBrowserTabOpenRouteDependencies): Router => {
  const router = Router();
  const cors = createBrowserOpenCors(allowedOrigins, logger, {
    event: 'local.staged_browser_tab_open.cors_blocked',
    message: 'This browser origin is not allowed to open local browser tabs.',
  });
  router.options(ROUTE, cors);

  router.post(ROUTE, cors, async (request, response) => {
    const requestId = randomUUID();
    // Without an address the tab starts on this CLI's start page rather than a blank document.
    const startPage = browserStartPageUrl(request.get('host'));
    const parsed: ParsedRequest = startPage
      ? readRequest(request.body, startPage)
      : {
          ok: false,
          body: errorBody(
            LocalStagedBrowserTabOpenErrorCode.InvalidRequest,
            'The CLI must be reached on a loopback host.',
          ),
        };
    if (!parsed.ok) {
      logger.warn('local.staged_browser_tab_open.rejected', {
        requestId,
        reason: parsed.body.code,
      });
      response.status(400).json(parsed.body);
      return;
    }
    const { machineId, projectId, url } = parsed;

    const admission = await admitMachine(keyPairStore, machineId, (error) => {
      logger.error('local.staged_browser_tab_open.machine_identity.failed', { requestId, error });
    });
    if (!admission.admitted) {
      logger.warn('local.staged_browser_tab_open.rejected', {
        requestId,
        reason: admission.reason,
      });
      response.status(admission.status).json(admission.body);
      return;
    }

    try {
      if (!(await projectBrowsers.isEnabled())) throw new SharedBrowserDisabledError();
      const stagedTabId = await tabs.stage(projectId, url);
      logger.info('local.staged_browser_tab_open.completed', { requestId, stagedTabId });
      response.json({
        stagedBrowserTab: { stagedTabId },
        url,
      } satisfies LocalStagedBrowserTabOpenSuccessResponse);
    } catch (error) {
      const failure =
        error instanceof SharedBrowserDisabledError
          ? {
              status: 422,
              body: errorBody(
                LocalStagedBrowserTabOpenErrorCode.SharedBrowserDisabled,
                error.message,
              ),
            }
          : {
              status: 500,
              body: errorBody(
                LocalStagedBrowserTabOpenErrorCode.OpenFailed,
                openFailedMessage(error),
              ),
            };
      logger.warn('local.staged_browser_tab_open.failed', {
        requestId,
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
