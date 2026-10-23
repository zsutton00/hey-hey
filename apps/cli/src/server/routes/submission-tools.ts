/**
 * Mounts the EXTERNAL_AGENT submission-tools MCP endpoint.
 *
 * The Claude session runner inserts an `mcpServers` entry pointing at this
 * route when the active prompt-type handler declares submission tools. The
 * route mounts the concrete HTTP controller at the Express boundary.
 */

import { Router } from 'express';
import { SubmissionToolsHttpController } from '../../agents/submission-tools/http-mcp';
import { SubmissionToolRegistry } from '../../agents/submission-tools/registry';
import { MessagePoster } from '../../run/message-poster';
import { RunRegistry } from '../../run/run-registry';
import type { ServerLogger } from '../logger';

export interface SubmissionToolsRouterDeps {
  registry: SubmissionToolRegistry;
  runRegistry: RunRegistry;
  poster: MessagePoster;
  logger: ServerLogger;
}

export const createSubmissionToolsRouter = ({
  registry,
  runRegistry,
  poster,
  logger,
}: SubmissionToolsRouterDeps): Router => {
  const controller = new SubmissionToolsHttpController(registry, runRegistry, poster, logger);
  const router = Router();
  router.post('/:token', controller.handle);

  return router;
};
