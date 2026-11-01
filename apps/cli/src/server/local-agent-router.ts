import {
  createRunToolCallsRouter,
  type RunToolCallsRouteDependencies,
} from './routes/run-tool-calls';
import { createStagedRunAttachmentsRouter } from './routes/staged-run-attachments';
import { createWalkthroughSourceRouter } from './routes/walkthrough-source';
import { RunAttachmentStore } from './run-attachment-store';
import { createRunAttachmentsRouter } from './routes/run-attachments';
import express from 'express';
import type { BrowserToolsHttpController } from '../agents/browser-tools/http-mcp';
import { createBrowserToolsRouter } from './routes/browser-tools';
import type { SubmissionToolRegistry } from '../agents/submission-tools/registry';
import type { OAuthClient } from '../auth/oauth-client';
import type { ProjectBrowser } from '../browser/project-browser-manager';
import type { RunTabs } from '../browser/run-tabs';
import type { MockupReader } from './mockup-page-reader';
import type { KeyPairStore } from '../credentials';
import type { RepoMappingStore } from '../repo';
import { MessagePoster } from '../run/message-poster';
import { RunRegistry } from '../run/run-registry';
import type { ServerLogger } from './logger';
import { requestContext } from './request-context';
import type { RunChangedFilesReader } from './run-changed-files';
import type { RunReadRestoreCoordinator } from './restore-persisted-runs';
import { createPlatformMcpProxyRouter } from './routes/platform-mcp-proxy';
import { createReposRouter } from './routes/repos';
import { createBrowserStartPageRouter } from './routes/browser-start-page';
import { createMockupPageRouter } from './routes/mockup-page';
import { createRunBrowserOpenRouter } from './routes/run-browser-open';
import { createStagedBrowserTabOpenRouter } from './routes/staged-browser-tab-open';
import { createRunChangedFileDetailRouter } from './routes/run-changed-file-detail';
import { createSubmissionToolsRouter } from './routes/submission-tools';

export interface LocalAgentRouterDependencies {
  toolCalls: Pick<
    RunToolCallsRouteDependencies,
    'sessionActivity' | 'isRemoteToolCallViewingEnabled'
  >;
  browserToolsController?: BrowserToolsHttpController;
  /** Present only when the Shared Browser subsystem exists; mounts Open browser. */
  sharedBrowser?: { projectBrowsers: ProjectBrowser; tabs: RunTabs; readMockup: MockupReader };
  allowedOrigins: readonly string[];
  keyPairStore: KeyPairStore;
  logger: ServerLogger;
  oauthClient: OAuthClient;
  repoStore: RepoMappingStore;
  runRegistry: RunRegistry;
  runChangedFilesReader: RunChangedFilesReader;
  runReadRestoreCoordinator: RunReadRestoreCoordinator;
  poster: MessagePoster;
  submissionToolRegistry: SubmissionToolRegistry;
}

/** Owns the loopback HTTP bridge used by agent processes and its error boundary. */
export class LocalAgentRouter {
  public readonly app = express();

  public constructor(private readonly dependencies: LocalAgentRouterDependencies) {
    this.registerMiddleware();
    this.registerRoutes();
    this.registerErrorBoundary();
  }

  private registerMiddleware(): void {
    const { allowedOrigins, keyPairStore, logger, runReadRestoreCoordinator } = this.dependencies;
    this.app.use(
      '/api/local/runs',
      createRunAttachmentsRouter({
        allowedOrigins,
        keyPairStore,
        logger,
        restoreCoordinator: runReadRestoreCoordinator,
        attachmentStore: new RunAttachmentStore(),
      }),
    );
    this.app.use(
      '/api/local/run-attachments',
      createStagedRunAttachmentsRouter({
        allowedOrigins,
        keyPairStore,
        logger,
        attachmentStore: new RunAttachmentStore(),
      }),
    );
    this.app.use(express.json({ limit: '2mb' }));
  }

  private registerRoutes(): void {
    const {
      allowedOrigins,
      keyPairStore,
      logger,
      oauthClient,
      repoStore,
      runRegistry,
      runChangedFilesReader,
      runReadRestoreCoordinator,
      poster,
      submissionToolRegistry,
      sharedBrowser,
    } = this.dependencies;
    this.app.use(
      '/api/local/runs',
      createRunToolCallsRouter({
        allowedOrigins,
        keyPairStore,
        logger,
        restoreCoordinator: runReadRestoreCoordinator,
        ...this.dependencies.toolCalls,
      }),
    );
    // Browser routes own their admission middleware.
    this.app.use(
      '/api/local/runs',
      createWalkthroughSourceRouter({
        allowedOrigins,
        keyPairStore,
        restoreCoordinator: runReadRestoreCoordinator,
        logger,
      }),
    );
    if (sharedBrowser) {
      this.app.use(
        '/api/local/runs',
        requestContext.middleware({ logger: logger.child({ component: 'http' }) }),
        createRunBrowserOpenRouter({
          allowedOrigins,
          keyPairStore,
          restoreCoordinator: runReadRestoreCoordinator,
          projectBrowsers: sharedBrowser.projectBrowsers,
          tabs: sharedBrowser.tabs,
          logger: logger.child({ component: 'route.run-browser-open' }),
        }),
      );
      this.app.use(
        '/api/local/browser',
        requestContext.middleware({ logger: logger.child({ component: 'http' }) }),
        createStagedBrowserTabOpenRouter({
          allowedOrigins,
          keyPairStore,
          projectBrowsers: sharedBrowser.projectBrowsers,
          tabs: sharedBrowser.tabs,
          logger: logger.child({ component: 'route.staged-browser-tab-open' }),
        }),
      );
      this.app.use(
        requestContext.middleware({ logger: logger.child({ component: 'http' }) }),
        createMockupPageRouter({
          readMockup: sharedBrowser.readMockup,
          serves: sharedBrowser.tabs.mockupServes,
          logger: logger.child({ component: 'route.mockup-page' }),
        }),
        createBrowserStartPageRouter({
          logger: logger.child({ component: 'route.browser-start-page' }),
        }),
      );
    }
    this.app.use(
      '/api/local/repos',
      requestContext.middleware({ logger: logger.child({ component: 'http' }) }),
      createReposRouter({
        allowedOrigins,
        keyPairStore,
        repoStore,
        logger: logger.child({ component: 'route.repos' }),
      }),
    );
    this.app.use(
      '/api/local/runs',
      requestContext.middleware({ logger: logger.child({ component: 'http' }) }),
      createRunChangedFileDetailRouter({
        allowedOrigins,
        keyPairStore,
        restoreCoordinator: runReadRestoreCoordinator,
        runChangedFilesReader,
        logger: logger.child({ component: 'route.run-changed-files' }),
      }),
    );
    if (this.dependencies.browserToolsController) {
      this.app.use(
        '/mcp/browser-tools',
        createBrowserToolsRouter(this.dependencies.browserToolsController),
      );
    }
    this.app.use(
      '/mcp/submission-tools',
      createSubmissionToolsRouter({
        registry: submissionToolRegistry,
        runRegistry,
        poster,
        logger: logger.child({ component: 'route.submission-tools' }),
      }),
    );
    this.app.use(
      '/mcp/platform',
      createPlatformMcpProxyRouter({
        runRegistry,
        oauthClient,
        logger: logger.child({ component: 'route.platform-mcp-proxy' }),
      }),
    );
  }

  private registerErrorBoundary(): void {
    const { logger } = this.dependencies;
    this.app.use(
      (
        error: unknown,
        request: express.Request,
        response: express.Response,
        _next: express.NextFunction,
      ) => {
        void _next;
        if (request.path.startsWith('/mcp/browser-tools')) {
          logger.warn('browser.mcp.invalid_request');
          response.status(400).json({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32600, message: 'Invalid browser MCP request' },
          });
          return;
        }
        requestContext.log(logger, 'error', 'local.http.unhandled_error', {
          method: request.method,
          path: request.originalUrl,
          error,
        });
        response.status(500).json({
          error: error instanceof Error ? error.message : 'Unexpected local server error.',
        });
      },
    );
  }
}
