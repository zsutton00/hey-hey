/** @vitest-environment node */

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { LocalPromptType } from '@hey-hey/contracts/agent-bridge';
import type { AgentSessionCurrentState } from '@hey-hey/contracts/api/models';

import { OAuthClient } from '../../../auth';
import { ToolRuleStore } from '../../../session/tool-rules';
import type { LocalAgentOutputEvent } from '../../../run/types';
import { handleDiff } from '../../../run/handlers/diff';
import { RunRegistry } from '../../../run/run-registry';
import { RunLifecycleEvents } from '../../../server/run-lifecycle-events';
import { makeDeps } from '../../../run/handlers/__test-utils';
import { inboundCallSchema } from './acp-schemas';
import { normalizeEvent } from '../../../run/normalize';
import {
  createTestRun,
  createTestMessagePoster,
  createTestMonitorProjectContext,
  createTestRepoMappingStore,
  createTestRunEventPublisher,
  createTestRunOwnership,
  createTestRunnerPicker,
  createTestRunStore,
  createTestSessionRunnerFacade,
} from '../../../run/run.test-support';
import { LocalAgentEndpoint } from '../../../server/local-base-url';
import { NOOP_LOGGER } from '../../../server/logger';
import { ExtendedUIFieldType, ProjectMaturity } from '../../../shared/api/index';
import {
  translatePermissionDecisionToDispatch,
  type PermissionDecision,
} from '../../permission-response-routing';
import type { AgentRequestPermissionPayload } from '../../../shared/api/index';
import { SubmissionToolRegistry } from '../../submission-tools/registry';
import { nativeProviderSessionId } from '../runner-common';
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
    productDevelopment: false,
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
      options?: Array<{ optionId: string; kind: string; name: string }>;
      update?: { sessionUpdate: string; content?: { text?: string } };
    };
    result?: {
      stopReason?: string;
      sessionId?: string;
      outcome?: { outcome: string; optionId?: string };
    };
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
        stderr: new PassThrough(),
        kill: vi.fn(),
      });
      vi.mocked(spawn).mockImplementation(
        () =>
          Object.assign(child, {
            stderr: child.stderr,
            pid: 123,
            stdin: child.stdin,
            stdout: child.stdout,
          }) as unknown as ReturnType<typeof spawn>,
      );

      const writes: Promise<void>[] = [];
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
          writes.push(client.respondToPermission(id, option));
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
              writes.push(client.cancel(sessionId));
              break;
          }
        }

        const results = await Promise.all(pending);
        await Promise.all(writes);
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
    // Message chunks are passage fragments; the runner, not the mapper, turns
    // them into narration, so no single chunk may reach the conversation alone.
    expect(events.some(({ providerFacts }) => providerFacts.narration)).toBe(false);
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
    stderr: new PassThrough(),
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
    'permission-offers-always',
    'permission-reply-pipe-error',
    'permission-always-approve',
    'permission-whitelist',
    'permission-stored-rule',
    'permission-reject',
    'heyhey-planning',
    'mcp-tools',
  ])('drives the runner with the recorded %s exchange', async (scenario) => {
    const offersAlways = scenario === 'permission-offers-always';
    const failsPermissionWrite = scenario === 'permission-reply-pipe-error';
    const remembers =
      offersAlways || ['permission-always-approve', 'permission-whitelist'].includes(scenario);
    const storedRule = scenario === 'permission-stored-rule';
    const verifyPermission =
      offersAlways ||
      failsPermissionWrite ||
      remembers ||
      storedRule ||
      scenario === 'permission-allow-once';
    const firstDecision: PermissionDecision =
      scenario === 'permission-always-approve' || offersAlways
        ? 'always_approve'
        : scenario === 'permission-whitelist' || failsPermissionWrite
          ? 'whitelist'
          : 'approve';
    const rulesDirectory = mkdtempSync(path.join(tmpdir(), 'antigravity-rules-'));
    const rulesPath = path.join(rulesDirectory, 'tool-rules.json');
    const toolRuleStore = new ToolRuleStore(rulesPath);
    if (storedRule) {
      writeFileSync(rulesPath, JSON.stringify(['antigravity:run_command']));
    }
    const frames = capture(
      scenario === 'heyhey-planning' || verifyPermission
        ? 'permission-allow-once'
        : scenario === 'malformed-reply-follow-up'
          ? 'follow-up'
          : scenario,
    ).filter((entry) => entry.direction !== 'driver');
    if (offersAlways) {
      // Replay the successful captured tool exchange with one additional ACP
      // option. The captured Antigravity version only advertised allow_once.
      for (const { direction, frame } of frames) {
        if (frame.method === 'session/request_permission') {
          frame.params?.options?.push({
            optionId: 'always-for-this-tool',
            kind: 'allow_always',
            name: 'Always allow',
          });
        }
      }
    }
    const processes = [...new Set(frames.map((entry) => entry.proc))];
    const outgoing: ReplayFrame['frame'][] = [];
    let controller = new AbortController();
    let currentProcess = 0;
    let injectedMalformedReplies = false;
    const warn = vi.fn();
    const broadcaster = createTestRunEventPublisher();
    const currentState = vi.mocked(broadcaster.emitAgentSessionCurrentStateObservation);
    const conversationPhase = vi.mocked(broadcaster.emitConversationPhaseObservation);
    const statesBeforePromptReply: (AgentSessionCurrentState | undefined)[] = [];
    vi.mocked(spawn).mockImplementation(() => {
      const proc = processes[currentProcess++];
      const traffic = frames.filter((entry) => entry.proc === proc);
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough({
          transform(chunk: Buffer, _encoding, callback) {
            const frame: ReplayFrame['frame'] = JSON.parse(chunk.toString());
            if (failsPermissionWrite && frame.result?.outcome?.outcome === 'selected') {
              const error = Object.assign(new Error('Broken pipe'), { code: 'EPIPE' });
              queueMicrotask(() => callback(error));
              return;
            }
            callback(null, chunk);
          },
        }),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
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
            if (scenario === 'follow-up' && reply?.result?.stopReason) {
              statesBeforePromptReply.push(currentState.mock.lastCall?.[0].currentState);
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

    const runnerPicker = createTestRunnerPicker(({ run, resolvedPrompt }) => ({
      run: async (signal) => {
        const { launchServiceId: _launch, ...baseSession } = run.session;
        const session = { ...baseSession, provider: 'antigravity' as const, services: [] };
        const args = { session, prompt: resolvedPrompt, signal };
        const providerSessionId = nativeProviderSessionId(run.providerSessionId);
        if (providerSessionId) {
          await runner.resumeSession({ ...args, providerSessionId });
        } else {
          await runner.runPrompt(args);
        }
      },
    }));
    const runStore = createTestRunStore();
    const poster = createTestMessagePoster();
    const ownership = createTestRunOwnership();
    const registry = new RunRegistry({
      runCollaborators: {
        ...ownership,
        broadcaster,
        runnerPicker,
        runStore,
        poster,
        repoStore: createTestRepoMappingStore(),
        handlerDeps: {} as never,
        logger: NOOP_LOGGER,
      },
      submissionToolRegistry: ownership.submissionToolRegistry,
      sessionRunnerFacade: createTestSessionRunnerFacade(),
      monitorProjectContext: createTestMonitorProjectContext(),
      runLifecycleEvents: new RunLifecycleEvents(),
    });
    await runStore.initialize();
    const session = await runStore.createRun({
      entity: null,
      agentic_session_id: 'test-run-id',
      services: [{ id: 'test-service-id', path: process.cwd() }],
      launchServiceId: 'test-service-id',
      provider: 'antigravity',
      provider_session_id: 'pending_test-run-id',
      conversationId: 'test-conversation-id',
      contextMetadata: {
        organizationId: 'test-org-id',
        projectId: 'test-project-id',
        agentSessionId: 'test-run-id',
        capturedAt: '2026-11-20T07:00:00.000Z',
        userComments: [],
        fileReferences: { resolved: [], unresolved: [] },
      },
    });
    const run = registry.create({
      runId: 'test-run-id',
      organizationId: 'test-org-id',
      projectId: 'test-project-id',
      conversationId: 'test-conversation-id',
      provider: 'antigravity',
      session,
      skipProjectAssistant: true,
    });
    const submissionToolRegistry = new SubmissionToolRegistry();
    const localAgentEndpoint = new LocalAgentEndpoint();
    const mcp =
      scenario === 'mcp-tools' ? await mountReplayMcp(run, submissionToolRegistry) : undefined;
    if (mcp) {
      localAgentEndpoint.set(mcp.baseUrl);
    }
    const published = vi.spyOn(run, 'onAgentOutput');
    const runner = new AntigravityAgentSessionRunner({
      agentOutputOwner: run,
      runStore,
      submissionToolRegistry,
      toolRuleStore,
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
    run.setRunner(runner);
    const pendingDecisions: Promise<unknown>[] = [];
    const respondToPermission = ({ event }: Parameters<typeof run.onAgentOutput>[0]) => {
      const normalized = normalizeEvent(
        { runId: run.runId, ...event } satisfies LocalAgentOutputEvent,
        'antigravity',
      );
      const permission = normalized.providerFacts?.permissionRequest;
      if (!permission) {
        return;
      }
      const decision = scenario === 'permission-reject' ? 'deny' : 'approve';
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
    };
    if (scenario !== 'follow-up' && !verifyPermission) {
      published.mockImplementation(respondToPermission);
    }
    const expectedRequests = frames.filter(({ direction }) => direction === 'client->agent');
    const prompts = expectedRequests.filter(({ frame }) => frame.method === 'session/prompt');
    try {
      let providerSessionId: string | null = null;
      for (const [promptIndex, { frame }] of prompts.entries()) {
        const prompt = frame.params?.prompt?.[0]?.text ?? '';
        if (scenario === 'follow-up' || verifyPermission) {
          currentState.mockClear();
          conversationPhase.mockClear();
          vi.mocked(poster.createOutOfBand).mockClear();
          vi.mocked(poster.complete).mockClear();
          await run.handleMessage({
            promptType: LocalPromptType.CodingFreeform,
            payload: { promptType: LocalPromptType.CodingFreeform, userMessage: prompt },
            references: { resolved: [], unresolved: [] },
            triggerContext: null,
          });
          const showsCard = !storedRule && (promptIndex === 0 || !remembers);
          if (verifyPermission && showsCard) {
            const card = await vi.waitFor(() => {
              const marker = vi
                .mocked(poster.createOutOfBand)
                .mock.calls.flatMap(([message]) =>
                  'uiElements' in message.dto.data ? (message.dto.data.uiElements ?? []) : [],
                )
                .find((element) => element.type === ExtendedUIFieldType.AgentRequestPermission);
              expect(marker).toBeDefined();
              expect(currentState.mock.lastCall?.[0].currentState).toBe('AWAITING_APPROVAL');
              return marker?.payload as unknown as AgentRequestPermissionPayload;
            });
            const request = card.permissionRequest;
            expect(request.availableDecisions).toEqual([
              'approve',
              'always_approve',
              'deny',
              'whitelist',
            ]);
            expect(card.enrichmentMetadata?.['command']).toContain("printf 'attempt");
            expect(request.reason).toContain('probe file');
            const submit = (decision: PermissionDecision) =>
              registry.submitPermissionDecision(run.runId, {
                agentType: request.agentType,
                decision,
                requestId: request.id,
                runId: run.runId,
                sessionId: request.sessionId,
                idempotencyToken: request.idempotencyToken,
                reason: null,
                deciderUserId: 'test-user',
              });
            const decision = promptIndex === 0 ? firstDecision : 'approve';
            const delivery = submit(decision);
            await expect(submit(decision)).resolves.toMatchObject({ outcome: 'dropped' });
            if (failsPermissionWrite) {
              await expect(delivery).resolves.toMatchObject({
                outcome: 'failed',
                reason: expect.stringContaining('Resend your prompt'),
              });
              // The rule was saved before the reply failed, and the session allowance was not added.
              expect(JSON.parse(readFileSync(rulesPath, 'utf8'))).toEqual([
                'antigravity:run_command',
              ]);
              await run.awaitIdle();
              expect(poster.complete).not.toHaveBeenCalled();
              expect(outgoing.some(({ result }) => result?.outcome?.outcome === 'selected')).toBe(
                false,
              );
              expect(warn).toHaveBeenCalledWith(
                'antigravity.permission.reply_failed',
                expect.objectContaining({ error: expect.stringContaining('Broken pipe') }),
              );
              return;
            }
            await expect(delivery).resolves.toMatchObject({ outcome: 'delivered' });
            await vi.waitFor(() => {
              expect(poster.complete).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything(),
                expect.anything(),
                expect.objectContaining({
                  status: 'completed',
                  data: expect.objectContaining({
                    uiElements: expect.arrayContaining([
                      expect.objectContaining({
                        payload: expect.objectContaining({ decision, permissionRequest: request }),
                      }),
                    ]),
                  }),
                }),
                null,
              );
            });
          }
          await run.awaitIdle();
          expect(run.providerSessionId).toBe(frame.params?.sessionId);
          if (verifyPermission && !showsCard) {
            const states = currentState.mock.calls.map(([observation]) => observation.currentState);
            expect(states).not.toContain('AWAITING_APPROVAL');
            expect(states.at(-1)).toBe('IDLE');
            continue;
          }
          if (verifyPermission) {
            const states = currentState.mock.calls.map(([observation]) => observation.currentState);
            const awaitingApproval = states.indexOf('AWAITING_APPROVAL');
            expect(awaitingApproval).toBeGreaterThanOrEqual(0);
            expect(states.slice(awaitingApproval + 1)).toContain('THINKING');
            expect(states.at(-1)).toBe('IDLE');
            continue;
          }
          expect(currentState.mock.calls.map(([observation]) => observation.currentState)).toEqual([
            'STARTING',
            'THINKING',
            'WRITING',
            'IDLE',
          ]);
          expect(conversationPhase.mock.calls.map(([observation]) => observation.phase)).toEqual([
            'starting',
            'thinking',
            'writing',
            'idle',
          ]);
          continue;
        }
        const { launchServiceId: _launch, ...baseSession } = run.session;
        const session = { ...baseSession, provider: 'antigravity' as const, services: [] };
        controller = new AbortController();
        const args = {
          session,
          prompt,
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
      if (scenario === 'permission-whitelist') {
        expect(JSON.parse(readFileSync(rulesPath, 'utf8'))).toEqual(['antigravity:run_command']);
      }
      if (scenario === 'permission-always-approve') {
        // Always Approve is remembered for the session only; nothing is stored.
        expect(existsSync(rulesPath)).toBe(false);
      }
      if (scenario === 'follow-up') {
        expect(statesBeforePromptReply).toEqual(['WRITING', 'WRITING']);
      }
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
        scenario === 'permission-reject' ? 0 : prompts.length - (scenario === 'cancel' ? 1 : 0),
      );
    } finally {
      await runner.dispose();
      await mcp?.dispose();
      rmSync(rulesDirectory, { recursive: true, force: true });
    }
  });
});
