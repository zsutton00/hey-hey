import { once } from 'node:events';
import express from 'express';
import { expect, vi } from 'vitest';
import { createTestOAuthClient } from '../../../auth/oauth-client.test-support';
import { browserHarness } from '../../../browser/__tests__/browser-test-support';
import { BrowserTools } from '../../../browser/browser-tools';
import type { Run } from '../../../run/run';
import { createTestMessagePoster, createTestRunRegistry } from '../../../run/run.test-support';
import { NOOP_LOGGER } from '../../../server/logger';
import { createBrowserToolsRouter } from '../../../server/routes/browser-tools';
import { createSubmissionToolsRouter } from '../../../server/routes/submission-tools';
import { RunLifecycleEvents } from '../../../server/run-lifecycle-events';
import { ChangedFileReporting } from '../../../turn/changed-file-reporting';
import { BrowserMcpAccess } from '../../browser-tools/browser-mcp-access';
import { BrowserToolsHttpController } from '../../browser-tools/http-mcp';
import { ActivePlatformToolCatalog } from '../../platform-mcp-proxy/catalog';
import { PlatformMcpProxyHttpController } from '../../platform-mcp-proxy/http-mcp';
import { TurnPlatformMcpProxy } from '../../platform-mcp-proxy/turn-proxy';
import type { SubmissionToolRegistry } from '../../submission-tools/registry';
import type { AcpHttpServer } from './acp-client';

export async function mountReplayMcp(run: Run, registry: SubmissionToolRegistry) {
  const logger = NOOP_LOGGER;
  const turnId = 'mcp-replay-turn';
  const platformMcpProxy = new TurnPlatformMcpProxy({
    runId: run.runId,
    turnId,
    context: { projectId: run.projectId },
    catalog: new ActivePlatformToolCatalog({ exactTools: ['get_entity_identities'] }),
    activeHandlerPromptType: 'quick',
  });
  const submitted = vi.fn(() => ({ content: [{ type: 'text', text: 'Recorded by CLI' }] }));
  registry.register({
    runId: run.runId,
    projectId: run.projectId,
    organizationId: run.organizationId,
    conversationId: run.conversationId,
    externalAgentNodeId: null,
    triggerMessageId: null,
    tools: [
      {
        kind: 'pass_through',
        name: 'submit_replay',
        description: 'Record the MCP replay probe.',
        inputSchema: { type: 'object', additionalProperties: false },
        execute: submitted,
      },
    ],
  });
  // Only the Turn's endpoint ownership is needed by the three HTTP controllers.
  run.activeTurn = {
    turnId,
    platformMcpProxy,
    changedFileReporting: new ChangedFileReporting(turnId, logger),
  } as Run['activeTurn'];
  const runRegistry = createTestRunRegistry((id) => (id === run.runId ? run : null));
  const browser = browserHarness();
  const access = new BrowserMcpAccess(
    browser.manager,
    new RunLifecycleEvents(),
    browser.tabs,
    logger,
  );
  access.bindRegistry(runRegistry);
  const browserMcpMount = await access.mount(run.runId, run.projectId, turnId);
  if (!browserMcpMount) {
    throw new Error('Browser MCP mount was unavailable in the replay harness');
  }
  const forwarded = vi.fn<typeof fetch>(async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    const result =
      request.method === 'tools/list'
        ? {
            tools: ['get_entity_identities', 'get_context'].map((name) => ({
              name,
              description: name,
              inputSchema: { type: 'object' },
            })),
          }
        : { content: [{ type: 'text', text: 'Platform call reached the upstream boundary' }] };
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  });
  const platform = new PlatformMcpProxyHttpController(
    runRegistry,
    createTestOAuthClient(),
    logger,
    forwarded,
    'https://platform.test/mcp',
  );
  const app = express();
  app.use(express.json());
  app.post('/mcp/platform/:runId/:turnId/:token', platform.handle);
  app.use(
    '/mcp/submission-tools',
    createSubmissionToolsRouter({
      registry,
      runRegistry,
      poster: createTestMessagePoster(),
      logger,
    }),
  );
  app.use(
    '/mcp/browser-tools',
    createBrowserToolsRouter(
      new BrowserToolsHttpController(access, new BrowserTools(browser.tabs, logger), logger),
    ),
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing replay HTTP listener address');
  }

  return {
    baseUrl: 'http://127.0.0.1:' + address.port,
    mounts: { browserMcpMount, platformMcpProxyMount: platformMcpProxy.mount },
    async verify(servers: readonly AcpHttpServer[]) {
      expect(servers.map(({ name, type }) => ({ name, type }))).toEqual([
        { name: 'heyhey-platform', type: 'http' },
        { name: 'heyhey-submission-tools', type: 'http' },
        { name: 'heyhey-browser', type: 'http' },
      ]);
      for (const { name, url, headers } of servers) {
        const request = async (method: string, params?: object) => {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...Object.fromEntries(headers.map(({ name, value }) => [name, value])),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          });
          expect(response.ok).toBe(true);
          return response.json();
        };
        const call = (tool: string) => request('tools/call', { name: tool, arguments: {} });
        expect(
          await request('initialize', { protocolVersion: '2025-06-18', capabilities: {} }),
        ).toHaveProperty('result.serverInfo');
        const catalog = await request('tools/list');
        if (name === 'heyhey-platform') {
          expect(catalog.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
            'get_entity_identities',
          ]);
          expect(await call('get_entity_identities')).toMatchObject({
            result: { content: [{ text: 'Platform call reached the upstream boundary' }] },
          });
          const previousCalls = forwarded.mock.calls.length;
          expect(await call('get_context')).toMatchObject({
            result: {
              isError: true,
              content: [
                expect.objectContaining({ text: expect.stringContaining('tool-surface mismatch') }),
              ],
            },
          });
          expect(forwarded).toHaveBeenCalledTimes(previousCalls);
        } else if (name === 'heyhey-submission-tools') {
          expect(catalog.result.tools).toEqual([
            expect.objectContaining({ name: 'submit_replay' }),
          ]);
          expect(await call('submit_replay')).toMatchObject({
            result: { content: [{ text: 'Recorded by CLI' }] },
          });
          expect(submitted).toHaveBeenCalledOnce();
        } else {
          expect(catalog.result.tools).toContainEqual(
            expect.objectContaining({ name: 'list_pages' }),
          );
          expect(await call('list_pages')).toMatchObject({
            result: { content: [{ type: 'text', text: expect.stringContaining('pageId') }] },
          });
        }
      }
    },
    async dispose() {
      run.activeTurn = null;
      platformMcpProxy.close();
      await access.dispose();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
