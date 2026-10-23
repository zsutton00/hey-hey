/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StructuredServerLogger } from '../logger';
import {
  createCcusageSessionJsonReader,
  resolveCcusageLauncher,
  SessionCostAdapter,
} from './session-cost-adapter';

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

type ExecFileCallback = (error: Error | null, result?: { stdout: string; stderr: string }) => void;

const createLogger = (): StructuredServerLogger =>
  new StructuredServerLogger({ minLevel: 'debug', writeLine: () => undefined });

beforeEach(() => {
  execFileMock.mockReset();
});

describe('SessionCostAdapter', () => {
  it('passes the date cutoff with an explicit UTC timezone to ccusage', async () => {
    execFileMock.mockImplementation(
      (_file: string, _args: readonly string[], _options: object, callback: ExecFileCallback) => {
        callback(null, { stdout: '{"sessions":[]}', stderr: '' });
        return {};
      },
    );
    await createCcusageSessionJsonReader()('codex', '2026-08-13');
    expect(execFileMock).toHaveBeenCalledWith(
      process.execPath,
      [
        expect.any(String),
        'codex',
        'session',
        '--json',
        '--since',
        '2026-08-13',
        '--timezone',
        'UTC',
      ],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('resolves the installed package launcher instead of a global command', () => {
    expect(resolveCcusageLauncher()).toMatch(/node_modules[\\/]ccusage[\\/]src[\\/]cli\.js$/);
  });

  it('returns unavailable and logs package resolution failures', async () => {
    const logger = createLogger();
    const debug = vi.spyOn(logger, 'debug');
    const adapter = new SessionCostAdapter(
      createCcusageSessionJsonReader(() => {
        throw new Error('ccusage package is missing');
      }),
    );

    await expect(
      adapter.read({
        providerId: 'codex',
        providerSessionId: 'codex-session',
        logger,
      }),
    ).resolves.toMatchObject({ state: 'unavailable', reason: 'cost_source_unavailable' });

    expect(debug).toHaveBeenCalledWith(
      'local.service.session_cost_batch.source_read_failed',
      expect.objectContaining({
        providerId: 'codex',
        failureKind: 'resolution',
      }),
    );
  });

  it('executes the packaged launcher without relying on PATH', async () => {
    execFileMock.mockImplementation(
      (
        _file: string,
        _args: readonly string[],
        _options: { timeout: number; maxBuffer: number },
        callback: ExecFileCallback,
      ) => {
        callback(null, {
          stdout: JSON.stringify({ sessions: [{ sessionId: 'claude-session', totalCost: 2.75 }] }),
          stderr: '',
        });
        return {};
      },
    );
    const adapter = new SessionCostAdapter(createCcusageSessionJsonReader());

    await expect(
      adapter.read({
        providerId: 'claude',
        providerSessionId: 'claude-session',
      }),
    ).resolves.toMatchObject({ state: 'available', amountUsd: 2.75 });

    expect(execFileMock).toHaveBeenCalledWith(
      process.execPath,
      [
        expect.stringMatching(/node_modules[\\/]ccusage[\\/]src[\\/]cli\.js$/),
        'claude',
        'session',
        '--json',
      ],
      expect.objectContaining({ timeout: 10_000, maxBuffer: 64 * 1024 * 1024 }),
      expect.any(Function),
    );
  });

  it('returns unavailable and logs normalized execution failure metadata', async () => {
    const processError = Object.assign(new Error('ccusage exited with status 1'), {
      code: 1,
      killed: false,
      signal: undefined,
      cmd: '/path/to/node /path/to/ccusage claude session --json',
      stderr: 'native runtime failed',
    });
    execFileMock.mockImplementation(
      (
        _file: string,
        _args: readonly string[],
        _options: { timeout: number; maxBuffer: number },
        callback: ExecFileCallback,
      ) => {
        callback(processError);
        return {};
      },
    );
    const logger = createLogger();
    const debug = vi.spyOn(logger, 'debug');
    const adapter = new SessionCostAdapter(createCcusageSessionJsonReader());

    await expect(
      adapter.read({
        providerId: 'claude',
        providerSessionId: 'claude-session',
        logger,
      }),
    ).resolves.toEqual({
      state: 'unavailable',
      reason: 'cost_source_unavailable',
      message: 'Local cost data is unavailable because ccusage could not be loaded or executed.',
    });

    expect(debug).toHaveBeenCalledWith(
      'local.service.session_cost_batch.source_read_failed',
      expect.objectContaining({
        providerId: 'claude',
        failureKind: 'execution',
        exitCode: 1,
        killed: false,
        signal: null,
        timedOut: false,
      }),
    );
  });

  it('marks a killed packaged runtime as timed out in diagnostics', async () => {
    const timeoutError = Object.assign(new Error('command timed out'), {
      code: null,
      killed: true,
      signal: 'SIGTERM' as const,
      stderr: '',
    });
    execFileMock.mockImplementation(
      (
        _file: string,
        _args: readonly string[],
        _options: { timeout: number; maxBuffer: number },
        callback: ExecFileCallback,
      ) => {
        callback(timeoutError);
        return {};
      },
    );
    const logger = createLogger();
    const debug = vi.spyOn(logger, 'debug');

    await expect(
      new SessionCostAdapter(createCcusageSessionJsonReader()).read({
        providerId: 'codex',
        providerSessionId: 'codex-session',
        logger,
      }),
    ).resolves.toMatchObject({ state: 'unavailable', reason: 'cost_source_unavailable' });

    expect(debug).toHaveBeenCalledWith(
      'local.service.session_cost_batch.source_read_failed',
      expect.objectContaining({
        providerId: 'codex',
        timedOut: true,
        killed: true,
        signal: 'SIGTERM',
      }),
    );
  });

  it('reads Codex cost from a rollout-path session id', async () => {
    const readCcusageSessionJson = vi.fn(() =>
      Promise.resolve(
        JSON.stringify({
          sessions: [
            {
              sessionId:
                '2026/07/22/rollout-2026-07-22T19-37-32-019f8cd5-d705-73a3-b43c-c331701233fe',
              costUSD: 3.2,
            },
          ],
        }),
      ),
    );
    const adapter = new SessionCostAdapter(readCcusageSessionJson);

    await expect(
      adapter.read({
        providerId: 'codex',
        providerSessionId: '019f8cd5-d705-73a3-b43c-c331701233fe',
      }),
    ).resolves.toEqual({
      state: 'available',
      amountUsd: 3.2,
      currency: 'USD',
      source: 'ccusage',
    });
    expect(readCcusageSessionJson).toHaveBeenCalledWith('codex', '2026-07-23', {
      sessionIds: ['019f8cd5-d705-73a3-b43c-c331701233fe'],
    });
  });

  it('preserves exact Claude session matching', async () => {
    const readCcusageSessionJson = vi.fn(() =>
      Promise.resolve(
        JSON.stringify({
          sessions: [
            {
              sessionId: 'ef827949-14d3-49be-9a1c-6a9c3da06c69',
              totalCost: 1.25,
            },
          ],
        }),
      ),
    );
    const adapter = new SessionCostAdapter(readCcusageSessionJson);

    await expect(
      adapter.read({
        providerId: 'claude',
        providerSessionId: 'ef827949-14d3-49be-9a1c-6a9c3da06c69',
      }),
    ).resolves.toEqual({
      state: 'available',
      amountUsd: 1.25,
      currency: 'USD',
      source: 'ccusage',
    });
    expect(readCcusageSessionJson).toHaveBeenCalledWith('claude');
  });

  it('keeps providers without a cost adapter unavailable', async () => {
    const readCcusageSessionJson = vi.fn(() => Promise.resolve(JSON.stringify({ sessions: [] })));
    const adapter = new SessionCostAdapter(readCcusageSessionJson);

    await expect(
      adapter.read({
        providerId: 'opencode',
        providerSessionId: 'provider-session-1',
      }),
    ).resolves.toEqual({
      state: 'unavailable',
      reason: 'unsupported_provider',
      message: 'Provider opencode does not expose local session cost data through ccusage.',
    });
    expect(readCcusageSessionJson).not.toHaveBeenCalled();
  });

  it('maps invalid provider output to malformed cost data', async () => {
    const adapter = new SessionCostAdapter(() => Promise.resolve('{not-json'));

    await expect(
      adapter.read({
        providerId: 'codex',
        providerSessionId: '019f8cd5-d705-73a3-b43c-c331701233fe',
      }),
    ).resolves.toEqual({
      state: 'unavailable',
      reason: 'malformed_cost_data',
      message: 'ccusage returned output that was not valid JSON.',
    });
  });

  it('indexes many sessions with one source read per represented provider', async () => {
    const readCcusageSessionJson = vi.fn((providerId: 'claude' | 'codex') =>
      Promise.resolve(
        JSON.stringify({
          sessions:
            providerId === 'codex'
              ? [
                  { sessionId: 'codex-session-a', costUSD: 1.5 },
                  { sessionId: 'codex-session-b', costUSD: 2.5 },
                ]
              : [{ sessionId: 'claude-session-a', totalCost: 3.5 }],
        }),
      ),
    );
    const adapter = new SessionCostAdapter(readCcusageSessionJson);

    const result = await adapter.readBatch([
      { providerId: 'codex', providerSessionId: 'codex-session-a' },
      { providerId: 'codex', providerSessionId: 'codex-session-b' },
      { providerId: 'claude', providerSessionId: 'claude-session-a' },
      { providerId: 'opencode', providerSessionId: 'opencode-session-a' },
    ]);

    expect(readCcusageSessionJson).toHaveBeenCalledTimes(2);
    expect(result.costs).toEqual([
      { state: 'available', amountUsd: 1.5, currency: 'USD', source: 'ccusage' },
      { state: 'available', amountUsd: 2.5, currency: 'USD', source: 'ccusage' },
      { state: 'available', amountUsd: 3.5, currency: 'USD', source: 'ccusage' },
      {
        state: 'unavailable',
        reason: 'unsupported_provider',
        message: 'Provider opencode does not expose local session cost data through ccusage.',
      },
    ]);
    expect(result.sourceStates).toEqual(
      new Map([
        ['codex', 'available'],
        ['claude', 'available'],
        ['opencode', 'unsupported'],
      ]),
    );
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('shared validated provider reports', () => {
  it('coalesces single and batch consumers across adapters and expires exactly at 30 seconds from receipt', async () => {
    vi.useFakeTimers();
    let resolve!: (value: string) => void;
    const reader = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    const first = new SessionCostAdapter(reader);
    const second = new SessionCostAdapter(reader);
    const selected = { providerId: 'codex', providerSessionId: 'one' } as const;
    const single = first.read(selected);
    const batch = second.readBatch([selected]);
    expect(reader).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    resolve('{"sessions":[{"sessionId":"one","costUSD":0},{"sessionId":"two","costUSD":2}]}');
    expect(await single).toMatchObject({ state: 'available', amountUsd: 0 });
    expect((await batch).costs[0]).toMatchObject({ amountUsd: 0 });
    vi.advanceTimersByTime(29999);
    await second.read(selected);
    expect(reader).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    const expired = first.read(selected);
    expect(reader).toHaveBeenCalledTimes(2);
    resolve('{"sessions":[{"sessionId":"one","costUSD":3}]}');
    expect(await expired).toMatchObject({ amountUsd: 3 });
  });

  it('separates providers, readers and inherited source roots', async () => {
    const reader = vi.fn(async () => '{"sessions":[{"sessionId":"one","costUSD":1}]}');
    const adapter = new SessionCostAdapter(reader);
    const selected = { providerId: 'codex', providerSessionId: 'one' } as const;
    await adapter.read(selected);
    await adapter.read({ ...selected, providerId: 'claude' });
    expect(reader).toHaveBeenCalledTimes(2);
    vi.stubEnv('CODEX_HOME', '/fixture/another-source');
    await adapter.read(selected);
    expect(reader).toHaveBeenCalledTimes(3);
    const otherReader = vi.fn(async () => '{"sessions":[{"sessionId":"one","costUSD":9}]}');
    expect(await new SessionCostAdapter(otherReader).read(selected)).toMatchObject({
      amountUsd: 9,
    });
    expect(otherReader).toHaveBeenCalledTimes(1);
  });

  it('retries malformed JSON, invalid schemas and execution failures without caching failures', async () => {
    const reader = vi
      .fn()
      .mockResolvedValueOnce('{bad')
      .mockResolvedValueOnce('{"sessions":[{"costUSD":-1}]}')
      .mockRejectedValueOnce(new Error('source failed'))
      .mockResolvedValue('{"sessions":[{"sessionId":"one","costUSD":4}]}');
    const adapter = new SessionCostAdapter(reader);
    const selected = { providerId: 'claude', providerSessionId: 'one' } as const;
    expect(await adapter.read(selected)).toMatchObject({ reason: 'malformed_cost_data' });
    expect(await adapter.read(selected)).toMatchObject({ reason: 'malformed_cost_data' });
    expect(await adapter.read(selected)).toMatchObject({ reason: 'cost_source_unavailable' });
    expect(await adapter.read(selected)).toMatchObject({ amountUsd: 4 });
    await adapter.read(selected);
    expect(reader).toHaveBeenCalledTimes(4);
  });

  it('keeps failed refreshes unavailable and allows immediate retry after expiry', async () => {
    vi.useFakeTimers();
    const reader = vi
      .fn()
      .mockResolvedValueOnce('{"sessions":[{"sessionId":"one","costUSD":1}]}')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue('{"sessions":[{"sessionId":"one","costUSD":2}]}');
    const adapter = new SessionCostAdapter(reader);
    const selected = { providerId: 'codex', providerSessionId: 'one' } as const;
    await adapter.read(selected);
    vi.advanceTimersByTime(30000);
    expect(await adapter.read(selected)).toMatchObject({ reason: 'cost_source_unavailable' });
    expect(await adapter.read(selected)).toMatchObject({ amountUsd: 2 });
    expect(reader).toHaveBeenCalledTimes(3);
  });
});

it('does not retain a schema-shaped report whose selected session has no cost amount', async () => {
  const reader = vi
    .fn()
    .mockResolvedValueOnce('{"sessions":[{"sessionId":"one"}]}')
    .mockResolvedValue('{"sessions":[{"sessionId":"one","costUSD":2}]}');
  const adapter = new SessionCostAdapter(reader);
  const selected = { providerId: 'codex', providerSessionId: 'one' } as const;
  expect(await adapter.read(selected)).toMatchObject({
    state: 'unavailable',
    reason: 'malformed_cost_data',
  });
  expect(await adapter.read(selected)).toMatchObject({ amountUsd: 2 });
  expect(reader).toHaveBeenCalledTimes(2);
});
