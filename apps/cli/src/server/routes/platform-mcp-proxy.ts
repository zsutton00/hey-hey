import { Router } from 'express';
import { PlatformMcpProxyHttpController } from '../../agents/platform-mcp-proxy/http-mcp';
import type { OAuthClient } from '../../auth';
import { RunRegistry } from '../../run/run-registry';
import type { ServerLogger } from '../logger';

export interface PlatformMcpProxyRouterDeps {
  runRegistry: RunRegistry;
  oauthClient: OAuthClient;
  logger: ServerLogger;
}

export const createPlatformMcpProxyRouter = ({
  runRegistry,
  oauthClient,
  logger,
}: PlatformMcpProxyRouterDeps): Router => {
  const controller = new PlatformMcpProxyHttpController(runRegistry, oauthClient, logger);
  const router = Router();
  router.post('/:runId/:turnId/:token', controller.handle);

  return router;
};
