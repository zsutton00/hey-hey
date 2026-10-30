import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Run } from '../../run/run';
import type { SessionToolEntry } from '../session-activity-source';
import { RunReadPreparationError } from '../restore-persisted-runs';
import { createRunToolCallsRouter } from './run-tool-calls';

const runId = '44444444-4444-4444-8444-444444444444';
const entry = (seq: number, turnId: string, subagentTurnId: string | null): SessionToolEntry => ({
  entryId: `entry-${seq}`,
  seq,
  turnId,
  providerTurnId: null,
  lane: { subagentTurnId, providerThreadId: null, parentToolUseId: null },
  createdAt: '2026-10-25T00:00:00.000Z',
  updatedAt: '2026-10-25T00:00:00.000Z',
  kind: 'tool',
  toolUseId: `tool-${seq}`,
  toolName: 'read_file',
  input: null,
  status: 'completed',
  output: { text: 'private output', truncatedBytes: 10 },
  result: null,
  exitCode: 0,
});

describe('loopback tool-call read', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(
      servers
        .splice(0)
        .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
  });
  async function harness(enabled = true) {
    const run = {
      runId,
      session: { contextMetadata: { agentSessionId: runId } },
      activeTurn: { turnId: 'turn-2' },
    } as Run;
    const restoreIdentity = vi.fn(async () => run);
    const snapshot = vi.fn(() => ({
      revision: 1,
      runs: [
        {
          runId,
          runInstanceId: 1,
          entries: [
            entry(1, 'turn-1', null),
            entry(2, 'turn-2', null),
            entry(3, 'turn-2', 'child'),
          ],
          gap: { evictedCount: 0, throughSeq: null },
        },
      ],
    }));
    const app = express();
    app.use(express.json());
    app.use(
      '/api/local/runs',
      createRunToolCallsRouter({
        allowedOrigins: ['https://allowed.test'],
        keyPairStore: { loadCurrentMachineId: async () => 'machine-1' },
        restoreCoordinator: { restoreIdentity },
        sessionActivity: { snapshot },
        isRemoteToolCallViewingEnabled: async () => enabled,
      }),
    );
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    const request = (
      body = { machineId: 'machine-1' },
      origin = 'https://allowed.test',
      method = 'POST',
    ) =>
      fetch(`http://127.0.0.1:${address.port}/api/local/runs/${runId}/tool-calls/latest-turn`, {
        method,
        headers: { origin, 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      });
    return { request, snapshot, restoreIdentity };
  }
  it('returns ordered latest-Turn calls with distinct subagents and explicit truncation', async () => {
    const { request } = await harness();
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const payload = await response.json();
    expect(payload.result.turnId).toBe('turn-2');
    expect(payload.result.toolCalls.map((call: { entryId: string }) => call.entryId)).toEqual([
      'entry-2',
      'entry-3',
    ]);
    expect(payload.result.toolCalls[1].lane.subagentTurnId).toBe('child');
    expect(payload.result.toolCalls[0].detail.output.truncated).toBe(true);
  });
  it('does not read activity when viewing is disabled', async () => {
    const { request, snapshot } = await harness(false);
    expect((await (await request()).json()).result).toEqual({ state: 'disabled', runId });
    expect(snapshot).not.toHaveBeenCalled();
  });
  it('rejects blocked origins before Run restoration', async () => {
    const { request, snapshot, restoreIdentity } = await harness();
    const response = await request(undefined, 'https://blocked.test');
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('private output');
    expect(restoreIdentity).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
  });
  it('allows approved-origin preflight without reading content', async () => {
    const { request, snapshot } = await harness();
    expect((await request(undefined, undefined, 'OPTIONS')).status).toBe(204);
    expect(snapshot).not.toHaveBeenCalled();
  });
  it('rejects machine mismatch without reading content', async () => {
    const { request, snapshot, restoreIdentity } = await harness();
    expect((await request({ machineId: 'other-machine' })).status).toBe(409);
    expect(restoreIdentity).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
  });
  it('rejects a Run absent from this CLI', async () => {
    const { request, snapshot, restoreIdentity } = await harness();
    restoreIdentity.mockRejectedValue(new RunReadPreparationError('RUN_NOT_FOUND', 'missing'));
    const response = await request();
    expect(response.status).toBe(404);
    expect((await response.json()).result).toBeUndefined();
    expect(snapshot).not.toHaveBeenCalled();
  });
  it('rejects unexpected request fields using the generated schema', async () => {
    const { request, snapshot } = await harness();
    expect(
      (await request({ machineId: 'machine-1', path: '/private' } as { machineId: string })).status,
    ).toBe(400);
    expect(snapshot).not.toHaveBeenCalled();
  });
});
