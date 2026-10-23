import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SharedBrowserDisabledError } from '../../browser/project-browser-manager';
import { LocalStagedBrowserTabOpenErrorCode } from '../../shared/local-agent-api/generated/api';
import { NOOP_LOGGER } from '../logger';
import { createStagedBrowserTabOpenRouter } from './staged-browser-tab-open';

const ALLOWED_ORIGIN = 'https://allowed.test';
const MACHINE_ID = 'machine-1';
const PROJECT_ID = '55555555-5555-4555-8555-555555555555';
const STAGED_TAB_ID = '66666666-6666-4666-8666-666666666666';

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve) => server.close(() => resolve()));

describe('createStagedBrowserTabOpenRouter', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(closeServer));
  });

  const createHarness = async (options: { enabled?: boolean; stageError?: Error } = {}) => {
    const stage = vi.fn(() =>
      options.stageError ? Promise.reject(options.stageError) : Promise.resolve(STAGED_TAB_ID),
    );
    const app = express();
    app.use(express.json());
    app.use(
      '/api/local/browser',
      createStagedBrowserTabOpenRouter({
        allowedOrigins: [ALLOWED_ORIGIN],
        keyPairStore: { loadCurrentMachineId: () => Promise.resolve(MACHINE_ID) },
        projectBrowsers: { isEnabled: () => Promise.resolve(options.enabled ?? true) },
        tabs: { stage },
        logger: NOOP_LOGGER,
      }),
    );
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No server address');
    const post = (body: unknown, origin = ALLOWED_ORIGIN) =>
      fetch(`http://127.0.0.1:${String(address.port)}/api/local/browser/staged-tabs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify(body),
      });
    return { post, stage };
  };

  it('opens a tab owned by no Run and returns its staged reference', async () => {
    const harness = await createHarness();
    const response = await harness.post({
      machineId: MACHINE_ID,
      projectId: PROJECT_ID,
      url: 'https://example.com/',
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    expect(await response.json()).toEqual({
      stagedBrowserTab: { stagedTabId: STAGED_TAB_ID },
      url: 'https://example.com/',
    });
    expect(harness.stage).toHaveBeenCalledWith(PROJECT_ID, 'https://example.com/');
  });

  it('defaults to the CLI start page', async () => {
    const harness = await createHarness();
    const response = await harness.post({ machineId: MACHINE_ID, projectId: PROJECT_ID });

    expect(response.status).toBe(200);
    expect(harness.stage).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/browser\/start$/u),
    );
  });

  it('rejects a blocked origin without opening a tab', async () => {
    const harness = await createHarness();
    const response = await harness.post(
      { machineId: MACHINE_ID, projectId: PROJECT_ID },
      'https://evil.test',
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: LocalStagedBrowserTabOpenErrorCode.OriginNotAllowed,
    });
    expect(harness.stage).not.toHaveBeenCalled();
  });

  it('rejects a machine mismatch without opening a tab', async () => {
    const harness = await createHarness();
    const response = await harness.post({ machineId: 'other-machine', projectId: PROJECT_ID });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: LocalStagedBrowserTabOpenErrorCode.MachineMismatch,
    });
    expect(harness.stage).not.toHaveBeenCalled();
  });

  it('rejects when Shared Browser is turned off without opening a tab', async () => {
    const harness = await createHarness({ enabled: false });
    const response = await harness.post({ machineId: MACHINE_ID, projectId: PROJECT_ID });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: LocalStagedBrowserTabOpenErrorCode.SharedBrowserDisabled,
    });
    expect(harness.stage).not.toHaveBeenCalled();
  });

  it('reports Shared Browser turned off between the check and the open', async () => {
    const harness = await createHarness({ stageError: new SharedBrowserDisabledError() });
    const response = await harness.post({ machineId: MACHINE_ID, projectId: PROJECT_ID });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: LocalStagedBrowserTabOpenErrorCode.SharedBrowserDisabled,
    });
  });

  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'not a url'])(
    'rejects the unsupported URL %s without opening a tab',
    async (url) => {
      const harness = await createHarness();
      const response = await harness.post({ machineId: MACHINE_ID, projectId: PROJECT_ID, url });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: LocalStagedBrowserTabOpenErrorCode.UnsupportedUrl,
      });
      expect(harness.stage).not.toHaveBeenCalled();
    },
  );

  it.each([
    { machineId: MACHINE_ID },
    { machineId: MACHINE_ID, projectId: 'not-a-uuid' },
    { machineId: MACHINE_ID, projectId: PROJECT_ID, runId: PROJECT_ID },
  ])('rejects the malformed request %j', async (body) => {
    const harness = await createHarness();
    const response = await harness.post(body);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: LocalStagedBrowserTabOpenErrorCode.InvalidRequest,
    });
    expect(harness.stage).not.toHaveBeenCalled();
  });
});
