import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SharedBrowserDisabledError } from '../../browser/project-browser-manager';
import type { Run } from '../../run/run';
import { LocalRunBrowserOpenErrorCode } from '../../shared/local-agent-api/generated/api';
import { NOOP_LOGGER } from '../logger';
import { RunReadPreparationError } from '../run-read-preparation-error';
import { createRunBrowserOpenRouter } from './run-browser-open';

const ALLOWED_ORIGIN = 'https://allowed.test';
const MACHINE_ID = 'machine-1';
const RUN_ID = '44444444-4444-4444-8444-444444444444';
const PROJECT_ID = 'project-1';

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve) => server.close(() => resolve()));

describe('createRunBrowserOpenRouter', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(closeServer));
  });

  const createHarness = async (
    options: { restoreError?: Error; enabled?: boolean; openError?: Error } = {},
  ) => {
    const restoreIdentity = vi.fn(() =>
      options.restoreError
        ? Promise.reject(options.restoreError)
        : Promise.resolve({ projectId: PROJECT_ID } as Run),
    );
    const open = vi.fn(() =>
      options.openError ? Promise.reject(options.openError) : Promise.resolve(),
    );
    const record = vi.fn();
    const app = express();
    app.use(express.json());
    app.use(
      '/api/local/runs',
      createRunBrowserOpenRouter({
        allowedOrigins: [ALLOWED_ORIGIN],
        keyPairStore: { loadCurrentMachineId: () => Promise.resolve(MACHINE_ID) },
        restoreCoordinator: { restoreIdentity },
        projectBrowsers: { isEnabled: () => Promise.resolve(options.enabled ?? true) },
        tabs: { open, notices: { record } },
        logger: NOOP_LOGGER,
      }),
    );
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No server address');
    const post = (body: unknown, origin = ALLOWED_ORIGIN, runId = RUN_ID) =>
      fetch(`http://127.0.0.1:${String(address.port)}/api/local/runs/${runId}/browser/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify(body),
      });
    return { post, open, record, restoreIdentity };
  };

  const expectNoEffect = (harness: { open: unknown; record: unknown }) => {
    expect(harness.open).not.toHaveBeenCalled();
    expect(harness.record).not.toHaveBeenCalled();
  };

  it('opens and selects a Run tab, then records the next-Turn notice', async () => {
    const harness = await createHarness();
    const response = await harness.post({ machineId: MACHINE_ID, url: 'https://example.com/' });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    expect(await response.json()).toEqual({ runId: RUN_ID, url: 'https://example.com/' });
    expect(harness.open).toHaveBeenCalledWith(RUN_ID, PROJECT_ID, 'https://example.com/');
    expect(harness.record).toHaveBeenCalledOnce();
    expect(harness.record.mock.calls[0]).toMatchObject([RUN_ID, { url: 'https://example.com/' }]);
  });

  it('defaults to the CLI start page so the tab never starts blank', async () => {
    const harness = await createHarness();
    const response = await harness.post({ machineId: MACHINE_ID });

    expect(response.status).toBe(200);
    expect(harness.open).toHaveBeenCalledWith(
      RUN_ID,
      PROJECT_ID,
      expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/browser\/start$/u),
    );
  });

  it('rejects a blocked origin', async () => {
    const harness = await createHarness();
    const response = await harness.post({ machineId: MACHINE_ID }, 'https://evil.test');

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: LocalRunBrowserOpenErrorCode.OriginNotAllowed,
    });
    expectNoEffect(harness);
  });

  it('rejects a machine mismatch', async () => {
    const harness = await createHarness();
    const response = await harness.post({ machineId: 'other-machine' });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: LocalRunBrowserOpenErrorCode.MachineMismatch,
    });
    expect(harness.restoreIdentity).not.toHaveBeenCalled();
    expectNoEffect(harness);
  });

  it('rejects an unknown Run', async () => {
    const harness = await createHarness({
      restoreError: new RunReadPreparationError('RUN_NOT_FOUND', 'Run not found'),
    });
    const response = await harness.post({ machineId: MACHINE_ID });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      code: LocalRunBrowserOpenErrorCode.RunNotFound,
    });
    expectNoEffect(harness);
  });

  it('rejects when Shared Browser is turned off', async () => {
    const harness = await createHarness({ enabled: false });
    const response = await harness.post({ machineId: MACHINE_ID });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: LocalRunBrowserOpenErrorCode.SharedBrowserDisabled,
    });
    expectNoEffect(harness);
  });

  it('reports Shared Browser turned off between the check and the open without a notice', async () => {
    const harness = await createHarness({ openError: new SharedBrowserDisabledError() });
    const response = await harness.post({ machineId: MACHINE_ID });

    expect(response.status).toBe(422);
    expect(harness.record).not.toHaveBeenCalled();
  });

  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'not a url'])(
    'rejects the unsupported URL %s',
    async (url) => {
      const harness = await createHarness();
      const response = await harness.post({ machineId: MACHINE_ID, url });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: LocalRunBrowserOpenErrorCode.UnsupportedUrl,
      });
      expectNoEffect(harness);
    },
  );

  it('rejects unknown body fields', async () => {
    const harness = await createHarness();
    const response = await harness.post({ machineId: MACHINE_ID, extra: true });

    expect(response.status).toBe(400);
    expectNoEffect(harness);
  });
});
