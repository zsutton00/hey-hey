import { Router } from 'express';
import type { BrowserToolsHttpController } from '../../agents/browser-tools/http-mcp';
export const createBrowserToolsRouter = (controller: BrowserToolsHttpController): Router => {
  const router = Router();
  router.post('/:token', controller.handle);
  return router;
};
