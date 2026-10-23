import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Run } from '../../run/run';
import type { AgenticSession } from '../../session/types';
import { CliReadErrorCode } from '../../shared/local-agent-api/generated/api';
import { NOOP_LOGGER } from '../logger';
import { RunChangedFilesContextError } from '../run-changed-files';
import { RunReadPreparationError } from '../restore-persisted-runs';
import { createRunChangedFileDetailRouter } from './run-changed-file-detail';

const ALLOWED_ORIGIN = 'https://allowed.test';
const MACHINE_ID = 'machine-1';
const RUN_ID = '44444444-4444-4444-8444-444444444444';
const SERVICE_ID = '55555555-5555-4555-8555-555555555555';
const file = {
  serviceId: SERVICE_ID,
  repoPath: '/workspace/service',
  filePath: 'src/example.ts',
};

const OTHER_SERVICE_ID = '66666666-6666-4666-8666-666666666666';
const inventory = [
  { ...file, status: 'modify' as const },
  {
    serviceId: OTHER_SERVICE_ID,
    repoPath: '/workspace/other-service',
    filePath: 'src/example.ts',
    status: 'create' as const,
  },
];

interface RouteResponsePayload {
  operation?: string;
  status?: string;
  result?: {
    runId?: string;
    entries?: Record<string, unknown>[];
    file?: { preContent?: string | null; postContent?: string | null };
  };
  error?: { code?: string; message?: string };
}

const readPayload = async (response: Response): Promise<RouteResponsePayload> =>
  (await response.json()) as RouteResponsePayload;

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve) => server.close(() => resolve()));

describe('createRunChangedFileDetailRouter', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(closeServer));
  });

  const createHarness = async (
    options: {
      machineId?: string | null;
      restoreError?: Error;
      detailError?: Error;
      inventoryError?: Error;
      detail?: {
        serviceId: string;
        repoPath: string;
        filePath: string;
        status: 'modify';
        diff: string;
        preContent: string | null;
        postContent: string | null;
      };
    } = {},
  ) => {
    const projection = [{ serviceId: SERVICE_ID, repoRelativePath: file.filePath }];
    const run = {
      session: { agentic_session_id: RUN_ID } as AgenticSession,
      getFileChangeProjection: () => projection,
    } as Run;
    const restore = vi.fn(() =>
      options.restoreError ? Promise.reject(options.restoreError) : Promise.resolve(run),
    );
    const getLiveRunChangedFileDetail = vi.fn(() =>
      options.detailError
        ? Promise.reject(options.detailError)
        : Promise.resolve(
            options.detail ?? {
              ...file,
              status: 'modify' as const,
              diff: '@@ -1 +1 @@\n-before\n+after',
              preContent: 'before',
              postContent: 'after',
            },
          ),
    );
    const getLiveRunChangedFilesInventory = vi.fn(() =>
      options.inventoryError ? Promise.reject(options.inventoryError) : Promise.resolve(inventory),
    );
    const loadCurrentMachineId = vi.fn(() =>
      Promise.resolve(options.machineId === undefined ? MACHINE_ID : options.machineId),
    );
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use(
      '/api/local/runs',
      createRunChangedFileDetailRouter({
        allowedOrigins: [ALLOWED_ORIGIN],
        keyPairStore: { loadCurrentMachineId },
        restoreCoordinator: { restore },
        runChangedFilesReader: { getLiveRunChangedFileDetail, getLiveRunChangedFilesInventory },
        logger: NOOP_LOGGER,
      }),
    );
    app.all('/api/local/runs/:runId/other', (_request, response) => response.status(200).end());
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected router TCP port.');
    return {
      baseUrl: `http://127.0.0.1:${String(address.port)}`,
      restore,
      getLiveRunChangedFileDetail,
      getLiveRunChangedFilesInventory,
      loadCurrentMachineId,
      run,
      projection,
    };
  };

  const postDetail = (
    baseUrl: string,
    body: unknown = { machineId: MACHINE_ID, file },
    origin = ALLOWED_ORIGIN,
  ) =>
    fetch(`${baseUrl}/api/local/runs/${RUN_ID}/changed-files/detail`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('leaves unrelated Run requests and preflight to their owning routes', async () => {
    const harness = await createHarness();
    for (const method of ['POST', 'OPTIONS']) {
      const response = await fetch(`${harness.baseUrl}/api/local/runs/${RUN_ID}/other`, {
        method,
        headers: { origin: 'https://blocked.test' },
      });
      expect(response.status).toBe(200);
    }
    expect(harness.loadCurrentMachineId).not.toHaveBeenCalled();
  });

  it('returns complete one-file detail larger than the shared socket receive limit', async () => {
    const largePreContent = 'a'.repeat(1_000_000);
    const largePostContent = 'b'.repeat(1_000_000);
    const harness = await createHarness({
      detail: {
        ...file,
        status: 'modify',
        diff: '@@ oversized @@',
        preContent: largePreContent,
        postContent: largePostContent,
      },
    });

    const response = await postDetail(harness.baseUrl);
    const payload = await readPayload(response);

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      operation: 'run.changed_files.detail',
      status: 'success',
      result: { runId: RUN_ID, file },
    });
    expect(payload.result?.file?.preContent).toHaveLength(1_000_000);
    expect(payload.result?.file?.postContent).toHaveLength(1_000_000);
    expect(harness.restore).toHaveBeenCalledWith(RUN_ID);
    expect(harness.getLiveRunChangedFileDetail).toHaveBeenCalledWith(
      harness.run.session,
      harness.projection,
      file,
    );
  });

  it('blocks an unapproved origin before machine or Run access', async () => {
    const harness = await createHarness();
    const response = await postDetail(harness.baseUrl, undefined, 'https://blocked.test');
    const payload = await readPayload(response);

    expect(response.status).toBe(403);
    expect(payload).toMatchObject({
      operation: 'run.changed_files.detail',
      status: 'error',
      error: { code: CliReadErrorCode.InvalidRequest },
    });
    expect(harness.loadCurrentMachineId).not.toHaveBeenCalled();
    expect(harness.restore).not.toHaveBeenCalled();
  });

  it.each([
    { machineId: null, status: 503, message: 'not paired' },
    { machineId: 'another-machine', status: 409, message: 'does not match' },
  ])(
    'rejects unavailable or mismatched machine identity',
    async ({ machineId, status, message }) => {
      const harness = await createHarness({ machineId });
      const response = await postDetail(harness.baseUrl);
      const payload = await readPayload(response);

      expect(response.status).toBe(status);
      expect(payload.error).toMatchObject({
        code: CliReadErrorCode.MachineNotBound,
        message: expect.stringContaining(message) as string,
      });
      expect(harness.restore).not.toHaveBeenCalled();
    },
  );

  it('rejects arbitrary-path-shaped input before restoring the Run', async () => {
    const harness = await createHarness();
    const response = await postDetail(harness.baseUrl, {
      machineId: MACHINE_ID,
      file: { ...file, absolutePath: '/etc/passwd' },
    });
    const payload = await readPayload(response);

    expect(response.status).toBe(400);
    expect(payload.error?.code).toBe(CliReadErrorCode.InvalidRequest);
    expect(harness.restore).not.toHaveBeenCalled();
  });

  it('returns the existing typed missing-Run failure', async () => {
    const harness = await createHarness({
      restoreError: new RunReadPreparationError(
        'RUN_NOT_FOUND',
        `Persisted Run not found: ${RUN_ID}`,
      ),
    });
    const response = await postDetail(harness.baseUrl);
    const payload = await readPayload(response);

    expect(response.status).toBe(404);
    expect(payload).toMatchObject({
      operation: 'run.changed_files.detail',
      status: 'error',
      error: { code: CliReadErrorCode.RunNotFound },
    });
  });

  it.each([
    new RunChangedFilesContextError(
      'The selected file is not part of this Run membership.',
      SERVICE_ID,
      'INVALID_FILE_MEMBERSHIP',
    ),
    new RunChangedFilesContextError(
      'The selected repository path does not match the Run repository.',
      SERVICE_ID,
      'INVALID_FILE_MEMBERSHIP',
    ),
  ])('returns a typed membership failure without file content', async (detailError) => {
    const harness = await createHarness({ detailError });
    const response = await postDetail(harness.baseUrl);
    const payload = await readPayload(response);

    expect(response.status).toBe(422);
    expect(payload.error?.code).toBe(CliReadErrorCode.InvalidFileMembership);
    expect(payload).not.toHaveProperty('result');
  });

  it('returns a generic read failure for a Git capability error', async () => {
    const harness = await createHarness({
      detailError: new RunChangedFilesContextError(
        'Git changed-file read failed for the selected service.',
        SERVICE_ID,
        'GIT_READ_FAILED',
      ),
    });
    const response = await postDetail(harness.baseUrl);
    const payload = await readPayload(response);

    expect(response.status).toBe(500);
    expect(payload.error?.code).toBe(CliReadErrorCode.ReadFailed);
    expect(payload).not.toHaveProperty('result');
  });

  describe('changed-file inventory', () => {
    const postInventory = (
      baseUrl: string,
      body: unknown = { machineId: MACHINE_ID },
      origin = ALLOWED_ORIGIN,
      runId = RUN_ID,
    ) =>
      fetch(`${baseUrl}/api/local/runs/${runId}/changed-files/inventory`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    it('returns the reader inventory for the restored Run on a matched machine', async () => {
      const harness = await createHarness();
      const response = await postInventory(harness.baseUrl);
      const payload = await readPayload(response);

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        operation: 'run.changed_files.inventory',
        status: 'success',
        result: { runId: RUN_ID },
      });
      expect(payload.result?.entries).toEqual(inventory);
      for (const entry of payload.result?.entries ?? []) {
        expect(entry).not.toHaveProperty('diff');
        expect(entry).not.toHaveProperty('preContent');
        expect(entry).not.toHaveProperty('postContent');
      }
      expect(harness.restore).toHaveBeenCalledWith(RUN_ID);
      expect(harness.getLiveRunChangedFilesInventory).toHaveBeenCalledWith(
        harness.run.session,
        harness.projection,
      );
      expect(harness.getLiveRunChangedFileDetail).not.toHaveBeenCalled();
    });

    it('blocks an unapproved origin before machine or Run access', async () => {
      const harness = await createHarness();
      const response = await postInventory(harness.baseUrl, undefined, 'https://blocked.test');
      const payload = await readPayload(response);

      expect(response.status).toBe(403);
      expect(payload).toMatchObject({
        operation: 'run.changed_files.inventory',
        status: 'error',
        error: { code: CliReadErrorCode.InvalidRequest },
      });
      expect(harness.loadCurrentMachineId).not.toHaveBeenCalled();
      expect(harness.restore).not.toHaveBeenCalled();
      expect(harness.getLiveRunChangedFilesInventory).not.toHaveBeenCalled();
    });

    it.each([
      { machineId: null, status: 503, message: 'not paired' },
      { machineId: 'another-machine', status: 409, message: 'does not match' },
    ])(
      'rejects unavailable or mismatched machine identity ($status)',
      async ({ machineId, status, message }) => {
        const harness = await createHarness({ machineId });
        const response = await postInventory(harness.baseUrl);
        const payload = await readPayload(response);

        expect(response.status).toBe(status);
        expect(payload).toMatchObject({
          operation: 'run.changed_files.inventory',
          status: 'error',
          error: {
            code: CliReadErrorCode.MachineNotBound,
            message: expect.stringContaining(message) as string,
          },
        });
        expect(payload).not.toHaveProperty('result');
        expect(harness.restore).not.toHaveBeenCalled();
        expect(harness.getLiveRunChangedFilesInventory).not.toHaveBeenCalled();
      },
    );

    it('returns 503 when the machine identity cannot be loaded', async () => {
      const harness = await createHarness();
      harness.loadCurrentMachineId.mockRejectedValueOnce(new Error('keychain unavailable'));
      const response = await postInventory(harness.baseUrl);
      const payload = await readPayload(response);

      expect(response.status).toBe(503);
      expect(payload.error?.code).toBe(CliReadErrorCode.MachineNotBound);
      expect(harness.getLiveRunChangedFilesInventory).not.toHaveBeenCalled();
    });

    it('returns the typed missing-Run failure without inventory', async () => {
      const harness = await createHarness({
        restoreError: new RunReadPreparationError(
          'RUN_NOT_FOUND',
          `Persisted Run not found: ${RUN_ID}`,
        ),
      });
      const response = await postInventory(harness.baseUrl);
      const payload = await readPayload(response);

      expect(response.status).toBe(404);
      expect(payload).toMatchObject({
        operation: 'run.changed_files.inventory',
        status: 'error',
        error: { code: CliReadErrorCode.RunNotFound },
      });
      expect(payload).not.toHaveProperty('result');
      expect(harness.getLiveRunChangedFilesInventory).not.toHaveBeenCalled();
    });

    it.each([
      { body: { machineId: MACHINE_ID, file }, runId: RUN_ID },
      { body: {}, runId: RUN_ID },
      { body: { machineId: MACHINE_ID }, runId: 'not-a-run-id' },
    ])('rejects malformed requests before machine or Run access', async ({ body, runId }) => {
      const harness = await createHarness();
      const response = await postInventory(harness.baseUrl, body, ALLOWED_ORIGIN, runId);
      const payload = await readPayload(response);

      expect(response.status).toBe(400);
      expect(payload).toMatchObject({
        operation: 'run.changed_files.inventory',
        error: { code: CliReadErrorCode.InvalidRequest },
      });
      expect(harness.loadCurrentMachineId).not.toHaveBeenCalled();
      expect(harness.restore).not.toHaveBeenCalled();
      expect(harness.getLiveRunChangedFilesInventory).not.toHaveBeenCalled();
    });

    it('maps a Git capability failure to a typed read failure', async () => {
      const harness = await createHarness({
        inventoryError: new RunChangedFilesContextError(
          'Git changed-file read failed for the selected service.',
          SERVICE_ID,
          'GIT_READ_FAILED',
        ),
      });
      const response = await postInventory(harness.baseUrl);
      const payload = await readPayload(response);

      expect(response.status).toBe(500);
      expect(payload.error?.code).toBe(CliReadErrorCode.ReadFailed);
      expect(payload).not.toHaveProperty('result');
    });
  });
});
