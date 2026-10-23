import { Router } from 'express';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { reportErrorSchemas } from '../../shared/api/generated/report-error-schemas';
import type {
  LocalWalkthroughSourceRequest,
  LocalWalkthroughSourceLocation,
} from '../../shared/local-agent-api/generated/api';
import {
  resolveWalkthroughWorkspaceFile,
  walkthroughServiceRoot,
} from '../../agents/review-subagent/change-walkthrough-sources';
import { admitMachine } from './local-run-admission';
import type { RunChangedFileDetailRouteDependencies } from './run-changed-file-detail';
import { NOOP_LOGGER } from '../logger';

const validate = addFormats(new Ajv({ strict: false })).compile<LocalWalkthroughSourceRequest>(
  reportErrorSchemas.LocalWalkthroughSourceRequest,
);
const route = '/:runId/walkthrough/source';

export function createWalkthroughSourceRouter(
  deps: Pick<
    RunChangedFileDetailRouteDependencies,
    'allowedOrigins' | 'keyPairStore' | 'restoreCoordinator' | 'logger'
  >,
): Router {
  const router = Router();
  const logger = deps.logger ?? NOOP_LOGGER;
  router.use(route, (req, res, next) => {
    const origin = req.get('origin');
    if (origin && !deps.allowedOrigins.includes(origin)) {
      logger.warn('local.walkthrough.source.origin_rejected');
      res.status(403).json({ message: 'Origin not allowed' });
      return;
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
  router.post(route, async (req, res) => {
    const body: unknown = req.body;
    const runId = req.params.runId;
    if (!validate(body) || !/^[0-9a-f-]{36}$/i.test(runId)) {
      logger.warn('local.walkthrough.source.invalid_request');
      res.status(400).json({ message: 'Invalid source request' });
      return;
    }
    const admission = await admitMachine(deps.keyPairStore, body.machineId, () => {
      logger.warn('local.walkthrough.source.machine_unavailable', { runId });
    });
    if (!admission.admitted) {
      res.status(admission.status).json({ message: admission.message });
      return;
    }
    try {
      const run = await deps.restoreCoordinator.restore(runId);
      const root = walkthroughServiceRoot(run.session, body.excerpt.serviceId);
      const filePath = await resolveWalkthroughWorkspaceFile(body.excerpt, root);
      if (!filePath) {
        logger.debug('local.walkthrough.source.unresolved', { runId });
        res.status(422).json({ message: 'Current source unavailable' });
        return;
      }
      const location = {
        runId,
        serviceId: body.excerpt.serviceId,
        file: body.excerpt.file,
        path: filePath,
        line: body.excerpt.startLine,
        column: 1,
      } satisfies LocalWalkthroughSourceLocation;
      logger.debug('local.walkthrough.source.resolved', {
        runId,
        serviceId: body.excerpt.serviceId,
      });
      res.json(location);
    } catch {
      logger.warn('local.walkthrough.source.unavailable', { runId });
      res.status(422).json({ message: 'Run workspace unavailable' });
    }
  });
  return router;
}
