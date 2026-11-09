import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeSessionReader } from '../../provider-transcripts/claude-session-reader';
import { NOOP_LOGGER } from '../logger';
import { RunReadPreparationError } from '../run-read-preparation-error';
import { createRunProviderSessionTranscriptRouter } from './run-provider-session-transcript';

const ORIGIN = 'https://allowed.test';
const MACHINE_ID = 'machine-1';
const RUN_ID = '44444444-4444-4444-8444-444444444444';
const SESSION_ID = 'a1b2c3d4-0000-4000-8000-123456789abc';
const FILE_TEXT = '{"type":"user","message":"hi"}\n{"type":"assistant","message":"héllo"}\n';

describe('createRunProviderSessionTranscriptRouter', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(() => r(null)))));
  });

  const createHarness = async (options: { restoreError?: Error } = {}) => {
    const projectsDir = await mkdtemp(path.join(tmpdir(), 'claude-projects-'));
    await mkdir(path.join(projectsDir, '-some-project'));
    await writeFile(path.join(projectsDir, '-some-project', `${SESSION_ID}.jsonl`), FILE_TEXT);
    await writeFile(path.join(projectsDir, 'outside.jsonl'), 'secret');
    const run = { ownsProviderSession: (id: string) => id === SESSION_ID || id === 'gone-1' };
    const restoreIdentity = vi.fn(() =>
      options.restoreError ? Promise.reject(options.restoreError) : Promise.resolve(run),
    );
    const app = express();
    app.use(express.json());
    app.use(
      '/api/local/runs',
      createRunProviderSessionTranscriptRouter({
        allowedOrigins: [ORIGIN],
        keyPairStore: { loadCurrentMachineId: () => Promise.resolve(MACHINE_ID) },
        // Only the ownership check of the restored Run matters to this route.
        restoreCoordinator: { restoreIdentity: restoreIdentity as never },
        claudeSessions: new ClaudeSessionReader({ projectsDir }),
        logger: NOOP_LOGGER,
      }),
    );
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No server address');
    const post = (body: unknown) =>
      fetch(
        `http://127.0.0.1:${String(address.port)}/api/local/runs/${RUN_ID}/provider-sessions/transcript`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
          body: JSON.stringify(body),
        },
      );
    return { post };
  };

  const request = (overrides: Record<string, unknown> = {}) => ({
    machineId: MACHINE_ID,
    providerId: 'claude',
    providerSessionId: SESSION_ID,
    ...overrides,
  });

  it('returns the provider file unmodified', async () => {
    const { post } = await createHarness();
    const response = await post(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      runId: RUN_ID,
      providerSessionId: SESSION_ID,
      state: 'available',
      text: FILE_TEXT,
      truncated: false,
    });
  });

  it('rejects traversal-shaped ids and a wrong machine without reading anything', async () => {
    const { post } = await createHarness();

    for (const id of ['../outside', '..%2Foutside', 'a/b', '.hidden']) {
      expect((await post(request({ providerSessionId: id }))).status).toBe(400);
    }
    const wrongMachine = await post(request({ machineId: 'other' }));
    expect(wrongMachine.status).toBe(409);
    expect(await wrongMachine.json()).toMatchObject({ code: 'MACHINE_MISMATCH' });
  });

  it('reports ids outside the Run, missing files and unsupported providers per request', async () => {
    const { post } = await createHarness();

    const foreign = await (await post(request({ providerSessionId: 'other-run-session' }))).json();
    expect(foreign).toMatchObject({ state: 'unavailable', reason: 'SESSION_NOT_IN_RUN' });

    const missing = await (await post(request({ providerSessionId: 'gone-1' }))).json();
    expect(missing).toMatchObject({ state: 'unavailable', reason: 'SESSION_FILE_NOT_FOUND' });

    const codex = await (await post(request({ providerId: 'codex' }))).json();
    expect(codex).toMatchObject({ state: 'unavailable', reason: 'PROVIDER_NOT_SUPPORTED' });

    const stillWorks = await (await post(request())).json();
    expect(stillWorks).toMatchObject({ state: 'available' });
  });

  it('says the Run is not on this computer', async () => {
    const { post } = await createHarness({
      restoreError: new RunReadPreparationError('RUN_NOT_FOUND', 'missing'),
    });
    const response = await post(request());

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'RUN_NOT_FOUND' });
  });
});
