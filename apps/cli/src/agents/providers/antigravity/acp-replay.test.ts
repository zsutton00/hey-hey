/** @vitest-environment node */

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { OAuthClient } from '../../../auth';
import type { LocalAgentOutputEvent } from '../../../run/types';
import { handleDiff } from '../../../run/handlers/diff';
import { makeDeps } from '../../../run/handlers/__test-utils';
import { inboundCallSchema } from './acp-schemas';
import { normalizeEvent } from '../../../run/normalize';
import { createTestRun, createTestRunStore } from '../../../run/run.test-support';
import { LocalAgentEndpoint } from '../../../server/local-base-url';
import { NOOP_LOGGER } from '../../../server/logger';
import { ProjectMaturity } from '../../../shared/api/index';
import { translatePermissionDecisionToDispatch } from '../../permission-response-routing';
import { SubmissionToolRegistry } from '../../submission-tools/registry';
import { AntigravityAgentSessionRunner } from './session-runner-antigravity';
import { SCENARIOS } from '../../../scripts/antigravity-capture-scenarios';
import { mountReplayMcp } from './mcp-replay.test-support';
import { AntigravityAcpClient, type AcpHttpServer } from './acp-client';
import {
  mapAntigravityPermission,
  mapAntigravityUpdate,
  normalizeAntigravityEvent,
} from './antigravity-event-mapper';

vi.mock(import('node:child_process'), async (original) => ({
  ...(await original()),
  spawn: vi.fn(),
}));
vi.mock('../../prompts/session-start-context', () => ({
  readSessionStartContext: async () => ({
    workItemTypeDefinitions: [],
    maturity: ProjectMaturity.Established,
    intentFirst: false,
    hintsEnabled: false,
    hintsProductDevelopment: false,
  }),
}));

interface ReplayFrame {
  proc: number;
  direction: 'client->agent' | 'agent->client' | 'driver';
  frame: {
    id?: number | string;
    method?: string;
    params?: {
      sessionId?: string;
      modeId?: string;
      mcpServers?: AcpHttpServer[];
      prompt?: Array<{ text?: string }>;
      update?: { sessionUpdate: string; content?: { text?: string } };
    };
    result?: { stopReason?: string; sessionId?: string };
  };
}

function capture(scenario: string): ReplayFrame[] {
  const file = `src/agent-runtime/node/__fixtures__/antigravity/${scenario}.ndjson`;
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

describe('Antigravity ACP replay', () => {
  it.each(SCENARIOS)('accepts and maps the recorded %s traffic', async (scenario) => {
    const logger = {
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      trace: vi.fn(),
      child: () => logger,
    };
    const frames = capture(scenario);
    const events: ReturnType<typeof normalizeAntigravityEvent>[] = [];
    const context = { runId: 'replay', timestamp: '2026-11-20T07:00:00.000Z' };
    const replies: unknown[] = [];

    for (const proc of new Set(frames.map((entry) => entry.proc))) {
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        kill: vi.fn(),
      });
      vi.mocked(spawn).mockImplementation(
        () =>
          Object.assign(child, {
            stderr: null,
            pid: 123,
            stdin: child.stdin,
            stdout: child.stdout,
          }) as unknown as ReturnType<typeof spawn>,
      );

      const client = new AntigravityAcpClient(
        process.cwd(),
        logger,
        ({ sessionId, update }) => {
          const event = mapAntigravityUpdate({ ...context, sessionId }, update, logger);
          if (event) {
            events.push(event);
          }
        },
        ({ id, params }) => {
          events.push(
            mapAntigravityPermission(
              { ...context, sessionId: params.sessionId },
              String(id),
              params,
            ),
          );
          const recordedReply = frames.find(
            (entry) =>
              entry.proc === proc &&
              entry.direction === 'client->agent' &&
              entry.frame.id === id &&
              !entry.frame.method,
          );
          const option = params.options.find(
            ({ optionId }) =>
              optionId ===
              (recordedReply?.frame.result as { outcome?: { optionId?: string } } | undefined)
                ?.outcome?.optionId,
          );
          client.respondToPermission(id, option);
        },
      );
      expect(spawn).toHaveBeenLastCalledWith(
        'agy',
        ['acp', '--process-per-session'],
        expect.anything(),
      );
      child.stdin.on('data', (chunk: Buffer) => replies.push(JSON.parse(chunk.toString())));

      const pending: Promise<unknown>[] = [];
      const receivedResponses: unknown[] = [];
      const config = { cwd: process.cwd(), mcpServers: [] };
      const pushFrame = (frame: ReplayFrame['frame']) =>
        child.stdout.write(JSON.stringify(frame) + '\n');
      if (scenario === 'quick') {
        child.stdout.write('{\n');
        pushFrame({ method: 'unknown' });
      }

      try {
        for (const { direction, frame } of frames.filter((entry) => entry.proc === proc)) {
          if (direction === 'agent->client') {
            pushFrame(frame);
            if (frame.result && typeof frame.id === 'number') {
              receivedResponses.push(frame.result);
            }
            continue;
          }
          if (direction !== 'client->agent') {
            continue;
          }

          const sessionId = frame.params?.sessionId ?? '';
          switch (frame.method) {
            case 'initialize':
              pending.push(client.initialize());
              break;
            case 'session/new':
              pending.push(
                client.createSession(config).then((result) => {
                  events.push(
                    normalizeAntigravityEvent(
                      { ...context, sessionId: result.sessionId },
                      'session_started',
                      {},
                    ),
                  );
                  return result;
                }),
              );
              break;
            case 'session/resume':
              pending.push(client.resumeSession(sessionId, config));
              break;
            case 'session/set_mode':
              pending.push(client.setMode(sessionId, frame.params?.modeId ?? 'default'));
              break;
            case 'session/prompt':
              pending.push(client.prompt(sessionId, []));
              break;
            case 'session/cancel':
              client.cancel(sessionId);
              break;
          }
        }

        const results = await Promise.all(pending);
        expect(results).toHaveLength(receivedResponses.length);
        expect(
          results.map((result) => (result as { stopReason?: string }).stopReason).filter(Boolean),
        ).toEqual(
          receivedResponses
            .map((result) => (result as { stopReason?: string }).stopReason)
            .filter(Boolean),
        );
      } finally {
        client.dispose();
        child.stdin.destroy();
        child.stdout.destroy();
      }
    }

    expect(events.some(({ providerFacts }) => providerFacts.identity?.providerSessionId)).toBe(
      true,
    );
    expect(
      events.flatMap(({ providerFacts }) =>
        providerFacts.narration ? [providerFacts.narration.text] : [],
      ),
    ).toEqual(
      frames.flatMap(({ frame }) =>
        frame.params?.update?.sessionUpdate === 'agent_message_chunk'
          ? [frame.params.update.content?.text]
          : [],
      ),
    );
    expect(events.every(({ providerFacts }) => providerFacts.provider === 'antigravity')).toBe(
      true,
    );
    const capturedPermissionReplies = frames
      .filter(
        ({ direction, frame }) =>
          direction === 'client->agent' && typeof frame.id === 'string' && frame.result,
      )
      .map(({ frame }) => frame);
    expect(replies.filter((frame) => typeof (frame as { id?: unknown }).id === 'string')).toEqual(
      capturedPermissionReplies,
    );
    if (scenario === 'quick') {
      expect(logger.warn.mock.calls.map(([event]) => event)).toEqual([
        'antigravity.acp.invalid_json',
        'antigravity.acp.invalid_frame',
      ]);
    } else {
      expect(logger.warn).not.toHaveBeenCalled();
    }
  });
});

it('expires a prompt whose malformed reply is never replaced', async () => {
  const reply = capture('quick').find(({ frame }) => frame.result?.stopReason)?.frame;
  expect(reply).toBeDefined();
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    kill: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  vi.useFakeTimers();
  const client = new AntigravityAcpClient(
    process.cwd(),
    NOOP_LOGGER,
    () => {},
    () => {},
  );
  try {
    const prompt = client.prompt('recorded-session', []);
    const timedOut = expect(prompt).rejects.toThrow('malformed reply and no valid replacement');
    const malformed = JSON.stringify({ ...reply, id: 1, result: {} }) + '\n';
    child.stdout.write(malformed);
    await vi.advanceTimersByTimeAsync(29_999);
    child.stdout.write(malformed);
    await vi.advanceTimersByTimeAsync(1);
    await timedOut;
    expect(child.kill).not.toHaveBeenCalled();
  } finally {
    client.dispose();
    vi.useRealTimers();
  }
});

it('projects only a completed ACP edit inside the Run root', async () => {
  const frame = capture('write-outside').find(({ frame }) => {
    const parsed = inboundCallSchema.safeParse(frame);
    return (
      parsed.success &&
      parsed.data.method === 'session/update' &&
      parsed.data.params.update.sessionUpdate === 'tool_call_update' &&
      parsed.data.params.update.status === 'completed' &&
      parsed.data.params.update.content?.some(({ type }) => type === 'diff')
    );
  });
  const call = inboundCallSchema.parse(frame?.frame);
  if (call.method !== 'session/update' || call.params.update.sessionUpdate !== 'tool_call_update') {
    throw new Error('Expected a recorded edit update');
  }
  const { sessionId, update } = call.params;
  const root = await mkdtemp(path.join(tmpdir(), 'antigravity-file-projection-'));
  try {
    const runStore = createTestRunStore();
    vi.spyOn(runStore, 'appendFileChangeFacts').mockResolvedValue(undefined);
    const run = createTestRun({ provider: 'antigravity' }, { runStore });
    run.refreshSessionFields({
      provider_session_id: sessionId,
      services: [{ id: 'test-service-id', path: root }],
    });
    run.activeTurn = { turnId: 'attribution-turn', handler: {} } as typeof run.activeTurn;
    await run.ensureFileChangeFactsSeeded();
    const context = { runId: run.runId, sessionId, timestamp: new Date().toISOString() };
    const receive = async (candidate: typeof update) => {
      const mapped = mapAntigravityUpdate(context, candidate, NOOP_LOGGER);
      if (!mapped) {
        throw new Error('Expected a mapped ACP edit');
      }
      const event = normalizeEvent({ runId: run.runId, ...mapped }, 'antigravity');
      if (event.kind !== 'diff') {
        throw new Error('Expected an ACP diff');
      }
      await handleDiff(event, run, makeDeps());
    };
    await receive(update);
    const content =
      update.content?.map((block) =>
        block.type === 'diff' ? { ...block, path: path.join(root, 'captured.txt') } : block,
      ) ?? [];
    await receive({ ...update, status: 'failed', content });
    expect(run.getFileChangeProjection()).toEqual([]);

    await receive({ ...update, content });
    expect(run.getFileChangeProjection()).toEqual([
      expect.objectContaining({ serviceId: 'test-service-id', repoRelativePath: 'captured.txt' }),
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

describe('Antigravity Run ownership', () => {
  it.each([
    'quick',
    'follow-up',
    'malformed-reply-follow-up',
    'resume',
    'cancel',
    'permission-allow-once',
    'permission-allow-always',
    'permission-reject',
    'heyhey-planning',
    'mcp-tools',
  ])('drives the runner with the recorded %s exchange', async (scenario) => {
    const frames = capture(
      scenario === 'heyhey-planning'
        ? 'permission-allow-once'
        : scenario === 'malformed-reply-follow-up'
          ? 'follow-up'
          : scenario,
    ).filter((entry) => entry.direction !== 'driver');
    const processes = [...new Set(frames.map((entry) => entry.proc))];
    const outgoing: ReplayFrame['frame'][] = [];
    let controller = new AbortController();
    let currentProcess = 0;
    let injectedMalformedReplies = false;
    const warn = vi.fn();
    vi.mocked(spawn).mockImplementation(() => {
      const proc = processes[currentProcess++];
      const traffic = frames.filter((entry) => entry.proc === proc);
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        kill: vi.fn(),
      });
      child.stdin.on('data', (chunk: Buffer) => {
        const request: ReplayFrame['frame'] = JSON.parse(chunk.toString());
        outgoing.push(request);
        queueMicrotask(() => {
          traffic.shift();
          while (traffic[0]?.direction === 'agent->client') {
            const reply = traffic.shift()?.frame;
            if (
              scenario === 'malformed-reply-follow-up' &&
              !injectedMalformedReplies &&
              reply?.result?.stopReason
            ) {
              child.stdout.write(JSON.stringify({ ...reply, result: {} }) + '\n');
              child.stdout.write(JSON.stringify({ ...reply, result: undefined, error: {} }) + '\n');
              injectedMalformedReplies = true;
            }
            child.stdout.write(JSON.stringify(reply) + '\n');
          }
          if (traffic[0]?.frame.method === 'session/cancel') {
            controller.abort();
          }
        });
      });
      return child as unknown as ReturnType<typeof spawn>;
    });

    const run = createTestRun({ provider: 'antigravity' });
    const submissionToolRegistry = new SubmissionToolRegistry();
    const localAgentEndpoint = new LocalAgentEndpoint();
    const mcp =
      scenario === 'mcp-tools' ? await mountReplayMcp(run, submissionToolRegistry) : undefined;
    if (mcp) {
      localAgentEndpoint.set(mcp.baseUrl);
    }
    const published = vi.spyOn(run, 'onAgentOutput').mockImplementation(() => {});
    const runner = new AntigravityAgentSessionRunner({
      agentOutputOwner: run,
      runStore: createTestRunStore(),
      submissionToolRegistry,
      oauthClient: new OAuthClient(),
      localAgentEndpoint,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        trace: vi.fn(),
        warn,
        child: () => NOOP_LOGGER,
      },
    });
    const pendingDecisions: Promise<unknown>[] = [];
    published.mockImplementation(({ event }) => {
      const normalized = normalizeEvent(
        { runId: run.runId, ...event } satisfies LocalAgentOutputEvent,
        'antigravity',
      );
      const permission = normalized.providerFacts?.permissionRequest;
      if (!permission) {
        return;
      }
      const decision =
        scenario === 'permission-reject'
          ? 'deny'
          : scenario === 'permission-allow-always'
            ? 'always_approve'
            : 'approve';
      pendingDecisions.push(
        runner.submitPermissionDecision({
          session: run.session,
          dispatch: translatePermissionDecisionToDispatch({
            agentType: 'antigravity',
            decision,
            requestId: permission.requestId,
            runId: run.runId,
            sessionId: event.sessionId ?? '',
            idempotencyToken: permission.requestId,
            reason: null,
            deciderUserId: 'test-user',
          }),
        }),
      );
    });
    const expectedRequests = frames.filter(({ direction }) => direction === 'client->agent');
    const prompts = expectedRequests.filter(({ frame }) => frame.method === 'session/prompt');
    try {
      let providerSessionId: string | null = null;
      for (const { frame } of prompts) {
        const prompt = frame.params?.prompt?.[0]?.text;
        const { launchServiceId: _launch, ...baseSession } = run.session;
        const session = { ...baseSession, provider: 'antigravity' as const, services: [] };
        controller = new AbortController();
        const args = {
          session,
          prompt: prompt ?? '',
          signal: controller.signal,
          ...mcp?.mounts,
          ...(scenario === 'heyhey-planning' ? { mcpToolUseCase: 'planning' as const } : {}),
        };
        const result = providerSessionId
          ? runner.resumeSession({ ...args, providerSessionId })
          : runner.runPrompt(args);
        if (scenario === 'cancel' && frame === prompts[0]?.frame) {
          await expect(result).rejects.toMatchObject({ name: 'AbortError' });
          providerSessionId = frame.params?.sessionId ?? null;
          continue;
        }
        const outcome = await result;
        expect(outcome.providerSessionId).toBe(frame.params?.sessionId);
        providerSessionId = outcome.providerSessionId;
        // A cold resume starts a second bridge while the follow-up keeps the first.
        if (scenario === 'resume' && frame === prompts[0]?.frame) {
          await runner.discardSession();
        }
      }
      await Promise.all(pendingDecisions);
      if (scenario === 'malformed-reply-follow-up') {
        expect(currentProcess).toBe(1);
        expect(injectedMalformedReplies).toBe(true);
        expect(
          warn.mock.calls.filter(([name]) => name === 'antigravity.acp.invalid_frame'),
        ).toHaveLength(2);
      }
      if (mcp) {
        const servers = outgoing.find(({ method }) => method === 'session/new')?.params?.mcpServers;
        await mcp.verify(servers ?? []);
      }
      expect(outgoing.filter(({ method }) => !method)).toMatchObject(
        expectedRequests.filter(({ frame }) => !frame.method).map(({ frame }) => frame),
      );
      expect(outgoing.map(({ method, id }) => ({ method, id }))).toEqual(
        expectedRequests.map(({ frame: { method, id } }) => ({ method, id })),
      );
      expect(
        outgoing
          .filter(({ method }) => method === 'session/set_mode')
          .map(({ params }) => params?.modeId),
      ).toEqual(
        expectedRequests
          .filter(({ frame }) => frame.method === 'session/set_mode')
          .map(({ frame }) => frame.params?.modeId),
      );
      expect(
        published.mock.calls.filter(
          ([{ event }]) =>
            normalizeEvent({ runId: run.runId, ...event }, 'antigravity').kind ===
            'assistant_complete',
        ),
      ).toHaveLength(
        scenario === 'permission-allow-always' || scenario === 'permission-reject'
          ? 0
          : prompts.length - (scenario === 'cancel' ? 1 : 0),
      );
    } finally {
      await runner.dispose();
      await mcp?.dispose();
    }
  });
});
