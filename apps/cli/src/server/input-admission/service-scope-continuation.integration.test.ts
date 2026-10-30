import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { InputAdmissionOwner } from './input-admission-owner';
import { InputAdmissionLifecycle } from './admission-lifecycle';
import type { RunFollowUpPayload } from './input-admission-payload';
import { RunStore } from '../../run-store/run-store';
import { Run } from '../../run/run';
import type { RunRegistry } from '../../run/run-registry';
import {
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunEventPublisher,
  createTestRunOwnership,
  createTestRunnerPicker,
} from '../../run/run.test-support';
import { createTestKeyPairStore } from '../../credentials/keypair.test-support';
import { toRepositoryPath } from '../../repo';
import { toInternalRunPromptRequest } from '../../shared/agent-bridge-contract/contract';
import type { PromptTypeHandlerDeps } from '../../agents/prompt-type-handler';
import { RunWorkspaceWriteBoundary } from '../../agents/workspace-write-boundary';
import type { LocalAgentService } from '../local-agent-service';
import type { ServerLogger } from '../logger';
import type { Runner } from '../../turn/turn';
import type { AgenticSession } from '../../session/types';

type Script = (execution: number, signal: AbortSignal) => Promise<void>;

/**
 * Composes the durable input queue with real Runs and the real Service-scope coordinator.
 * Only external boundaries are controlled: the provider runner, the platform HTTP grant, the
 * message poster, and the machine credential. Admission, pickup, delivery, the Run's approval
 * continuation, and the admission `onStarted`/`onSettled` callbacks all run for real.
 * A "process" is one owner + lifecycle + set of Runs; restarting builds a new process over the
 * same durable directories.
 */
describe('durable input with agent-requested Service approval', () => {
  let directory: string;
  const cleanups: Array<() => void | Promise<void>> = [];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'scope-continuation-'));
  });
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  const shared = {
    organizationId: randomUUID(),
    projectId: randomUUID(),
    userId: randomUUID(),
    machineId: randomUUID(),
    launchServiceId: randomUUID(),
    additionalServiceId: randomUUID(),
  };

  function environment() {
    const errors: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const logger = {
      trace: () => undefined,
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: (event: string, fields: Record<string, unknown> = {}) => {
        errors.push({ event, fields });
      },
      child() {
        return this;
      },
    } as unknown as ServerLogger;

    // Keep the real write boundary, but hold its provider state inside this test's directory.
    const createBoundary = RunWorkspaceWriteBoundary.create.bind(RunWorkspaceWriteBoundary);
    vi.spyOn(RunWorkspaceWriteBoundary, 'create').mockImplementation((workspace, options) =>
      createBoundary(workspace, {
        runScopeId: options!.runScopeId,
        ...(options?.readOnlyDirectories
          ? { readOnlyDirectories: options.readOnlyDirectories }
          : {}),
        providerStateRoot: join(directory, 'provider-state'),
      }),
    );

    // External platform boundary: the AgentSession Service grant and Service name lookup.
    const grants: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        grants.push({ url: String(url), body: JSON.parse(String(init.body)) });
        return new Response(null, { status: 200 });
      }
      return Response.json({
        data: [
          { id: shared.launchServiceId, name: 'CLI' },
          { id: shared.additionalServiceId, name: 'API' },
        ],
      });
    }) as unknown as typeof fetch;

    // Controlled provider boundary, recorded across restarts. Each execution receives the
    // prompt request the Run is executing; the session's script decides what the agent does.
    const executions: Array<{ sessionId: string; userMessage: unknown }> = [];
    const scripts = new Map<string, Script>();

    return { errors, logger, grants, fetchImpl, executions, scripts };
  }

  type Environment = ReturnType<typeof environment>;

  async function createSession(runStore: RunStore): Promise<AgenticSession> {
    const agentSessionId = randomUUID();
    return runStore.createRun({
      agentic_session_id: agentSessionId,
      entity: null,
      services: [{ id: shared.launchServiceId, path: directory }],
      launchServiceId: shared.launchServiceId,
      provider: 'claude',
      provider_session_id: '',
      provider_conversation_id: null,
      conversationId: randomUUID(),
      contextMetadata: {
        organizationId: shared.organizationId,
        projectId: shared.projectId,
        agentSessionId,
        capturedAt: '2026-10-05T00:00:00.000Z',
        userComments: [],
        fileReferences: { resolved: [], unresolved: [] },
      },
    });
  }

  /** One CLI process over the shared durable directories. */
  async function boot(env: Environment, sessions: readonly AgenticSession[]) {
    const runStore = new RunStore({
      paths: {
        baseDir: join(directory, 'runs-base'),
        runsDir: join(directory, 'runs-base', 'runs'),
        indexPath: join(directory, 'runs-base', 'runs', 'run-index.json'),
        preferencesPath: join(directory, 'runs-base', 'preferences.json'),
      },
    });
    await runStore.initialize();
    const keyPairStore = createTestKeyPairStore({ currentMachineId: shared.machineId });
    vi.spyOn(keyPairStore, 'loadMachineCredential').mockResolvedValue('machine-credential');
    const ownership = createTestRunOwnership();
    let lifecycle!: InputAdmissionLifecycle;

    const runs = new Map<string, Run>();
    for (const created of sessions) {
      const session = (await runStore.getRun(created.agentic_session_id))!;
      const runnerPicker = createTestRunnerPicker(
        (ctx): Runner => ({
          run: async (signal) => {
            env.executions.push({
              sessionId: session.agentic_session_id,
              userMessage: (ctx.input.payload as { userMessage?: unknown } | null)?.userMessage,
            });
            const script = env.scripts.get(session.agentic_session_id);
            await script?.(
              env.executions.filter((e) => e.sessionId === session.agentic_session_id).length,
              signal,
            );
            // As NewSessionRunner does once a fresh provider session receives the checkpoint.
            if (ctx.serviceScopeRecovery)
              await run.serviceScope.completeServiceScopeRecoveryDelivery(ctx.serviceScopeRecovery);
          },
        }),
      );
      const run: Run = new Run(
        {
          runId: session.agentic_session_id,
          organizationId: shared.organizationId,
          projectId: shared.projectId,
          conversationId: session.conversationId!,
          provider: 'claude',
          session,
          skipProjectAssistant: true,
        },
        {
          runStore,
          repoStore: createTestRepoMappingStore(async (serviceId) => ({
            serviceId,
            repositoryPath: toRepositoryPath(directory),
            createdAt: '2026-10-05T00:00:00.000Z',
            updatedAt: '2026-10-05T00:00:00.000Z',
          })),
          poster: createTestMessagePoster(),
          broadcaster: createTestRunEventPublisher(),
          keyPairStore,
          handlerDeps: {
            runStore,
            fetchImpl: env.fetchImpl,
            auth: { getAccessToken: async () => 'access-token' },
            apiBaseUrl: 'https://api.example.test/api/v1',
            logger: env.logger,
          } as unknown as PromptTypeHandlerDeps,
          promptTypeRegistry: ownership.promptTypeRegistry,
          submissionToolRegistry: ownership.submissionToolRegistry,
          runFollowUpAdmission: {
            admit: (input) => lifecycle.admit(input),
            durableInputReady: (runId) => lifecycle.durableInputReady(runId),
          },
          durableInputReady: () => lifecycle.durableInputReady(session.agentic_session_id),
          runnerPicker,
          logger: env.logger,
        },
      );
      // Rotating the provider session on scope change belongs to the provider boundary.
      vi.spyOn(run, 'discardProviderSessionForScopeChange').mockResolvedValue(undefined);
      runs.set(run.runId, run);
    }

    const registry = {
      get: (runId: string) => runs.get(runId),
      canAcceptDurableInput: (runId: string) => runs.get(runId)?.canAcceptDurableInput ?? false,
    } as unknown as RunRegistry;
    // Message-service routing onto the registered Run, as `sendMessage` does after activation.
    const service = {
      sendSystemMessage: async (
        runId: string,
        request: Parameters<typeof toInternalRunPromptRequest>[0],
        options: Parameters<Run['handleMessage']>[1],
      ) => {
        await runs.get(runId)!.handleMessage(toInternalRunPromptRequest(request), options);
      },
    } as unknown as LocalAgentService;

    const owner = new InputAdmissionOwner(
      { directory: join(directory, 'inputs'), legacyStoreFile: join(directory, 'inputs.json') },
      env.logger,
    );
    // Pass-through recorder: every lifecycle transition with the state it was requested from.
    const transitions: Array<{
      sessionId: string;
      previous: string;
      requested: string;
      accepted: boolean;
    }> = [];
    const transition = owner.transition.bind(owner);
    vi.spyOn(owner, 'transition').mockImplementation(async (sessionId, key, state, settlement) => {
      const before = await owner.record(sessionId, key);
      const entry = { sessionId, previous: before.state, requested: state, accepted: true };
      transitions.push(entry);
      try {
        return await transition(sessionId, key, state, settlement);
      } catch (error) {
        entry.accepted = false;
        throw error;
      }
    });
    lifecycle = new InputAdmissionLifecycle(
      owner,
      service,
      registry,
      keyPairStore,
      'https://api.example.test/api/v1',
      env.logger,
      () => true,
      runStore,
      createTestMessagePoster(),
    );
    await lifecycle.start();

    let stopped = false;
    const stop = async () => {
      if (stopped) return;
      stopped = true;
      const disposed = lifecycle.dispose();
      for (const run of runs.values()) run.cleanup();
      await disposed;
    };
    cleanups.push(stop);

    const admit = (sessionId: string, requestId: string, userMessage: string) =>
      lifecycle.admit({
        stableKey: `test:${requestId}`,
        agentSessionId: sessionId,
        runId: sessionId,
        organizationId: shared.organizationId,
        projectId: shared.projectId,
        userId: shared.userId,
        payload: {
          kind: 'run_follow_up',
          origin: 'permission_recovery',
          requestId,
          agentInput: { promptType: 'coding_freeform', userMessage },
        } satisfies RunFollowUpPayload,
      });

    const settled = async (sessionId: string) => {
      const run = runs.get(sessionId)!;
      await vi.waitFor(async () => {
        expect(run.isProcessing).toBe(false);
        expect(await owner.openRecords(sessionId)).toEqual([]);
      });
      await run.awaitIdle();
    };

    const decide = async (sessionId: string, requestId: string, decision: 'approve' | 'deny') => {
      const pending = runs.get(sessionId)!.serviceScope.getServiceScopeRequest(requestId)!;
      return runs.get(sessionId)!.serviceScopeCoordinator.decide({
        requestId: pending.request.id,
        sessionId: pending.request.sessionId,
        agentType: pending.request.agentType,
        decision,
        reason: decision === 'approve' ? 'Approved' : 'Denied',
        idempotencyToken: pending.request.idempotencyToken,
      });
    };

    return { runs, owner, transitions, admit, settled, decide, stop };
  }

  /** The agent asks for the API Service in its first execution; the Run pauses that Turn. */
  function requestScopeOnFirstExecution(env: Environment, run: Run) {
    const requested: { id: string | null } = { id: null };
    env.scripts.set(run.runId, async (execution, signal) => {
      if (execution !== 1) return;
      const result = await run.serviceScopeCoordinator.request({
        serviceIds: [shared.additionalServiceId],
        reason: 'The change also spans the API Service.',
      });
      expect(result.status).toBe('requested');
      if (result.status === 'requested') requested.id = result.request.id;
      expect(signal.aborted).toBe(true);
    });
    return requested;
  }

  const messagesFor = (env: Environment, sessionId: string) =>
    env.executions.filter((e) => e.sessionId === sessionId).map((e) => e.userMessage);

  const startupFailures = (env: Environment) =>
    env.errors.filter(
      ({ event }) =>
        event === 'local.run.start_turn.begin_failed' ||
        event === 'local.run.drain.failed' ||
        event === 'input_admission.transition_rejected',
    );

  async function newSession(): Promise<AgenticSession> {
    const store = new RunStore({
      paths: {
        baseDir: join(directory, 'runs-base'),
        runsDir: join(directory, 'runs-base', 'runs'),
        indexPath: join(directory, 'runs-base', 'runs', 'run-index.json'),
        preferencesPath: join(directory, 'runs-base', 'preferences.json'),
      },
    });
    await store.initialize();
    return createSession(store);
  }

  async function pausedSession(env: Environment, others: readonly AgenticSession[] = []) {
    const session = await newSession();
    const process = await boot(env, [session, ...others]);
    const run = process.runs.get(session.agentic_session_id)!;
    const requested = requestScopeOnFirstExecution(env, run);
    await process.admit(run.runId, 'original', 'implement the change');
    await vi.waitFor(() => expect(requested.id).not.toBeNull());
    await vi.waitFor(() => expect(run.isProcessing).toBe(false));
    return { session, process, run, requestId: requested.id! };
  }

  it('executes the preserved input once after approval and keeps the session usable', async () => {
    const env = environment();
    const { process, run, requestId } = await pausedSession(env);
    // While the user reviews, the paused input is not finished: it holds the session's slot.
    expect((await process.owner.session(run.runId)).map((record) => record.state)).toEqual([
      'started',
    ]);

    expect(await process.decide(run.runId, requestId, 'approve')).toEqual({
      outcome: 'delivered',
      callbackType: 'service_scope_decision',
    });
    await process.settled(run.runId);

    // The grant was persisted additively before the continuation ran.
    expect(env.grants.map((grant) => grant.body)).toEqual([
      expect.objectContaining({ serviceIds: [shared.additionalServiceId] }),
    ]);
    expect(run.session.services.map((service) => service.id)).toEqual([
      shared.launchServiceId,
      shared.additionalServiceId,
    ]);

    // One admission, started once and settled once across the pause.
    expect(process.transitions).toEqual([
      expect.objectContaining({ previous: 'picked', requested: 'started', accepted: true }),
      expect.objectContaining({ previous: 'started', requested: 'settled', accepted: true }),
    ]);
    expect(startupFailures(env)).toEqual([]);
    // The interrupted execution plus exactly one continuation execution of the preserved input.
    expect(messagesFor(env, run.runId)).toEqual(['implement the change', 'implement the change']);
    const [original] = await process.owner.session(run.runId);
    expect(original).toMatchObject({
      state: 'settled',
      settlementDelivered: true,
      settlement: expect.objectContaining({ terminalOutcome: 'COMPLETED' }),
    });

    // A later follow-up runs without asking again for the granted Service.
    await process.admit(run.runId, 'follow-up', 'and now the tests');
    await process.settled(run.runId);
    expect(messagesFor(env, run.runId)).toEqual([
      'implement the change',
      'implement the change',
      'and now the tests',
    ]);
    expect(run.serviceScope.hasPendingServiceScopeRequest()).toBe(false);
    expect(env.grants).toHaveLength(1);
    const durable = await process.owner.session(run.runId);
    expect(durable.map((record) => record.state)).toEqual(['settled', 'settled']);
    expect(durable.every((record) => record.settlementDelivered)).toBe(true);

    // Replayed or duplicate delivery of either input executes nothing again.
    expect(await process.admit(run.runId, 'original', 'implement the change')).toEqual({
      replayed: true,
    });
    expect(await process.admit(run.runId, 'follow-up', 'and now the tests')).toEqual({
      replayed: true,
    });
    await process.settled(run.runId);
    expect(messagesFor(env, run.runId)).toHaveLength(3);
    expect(startupFailures(env)).toEqual([]);
  });

  it('settles the held input once when the request is denied and keeps the session usable', async () => {
    const env = environment();
    const { process, run, requestId } = await pausedSession(env);

    expect(await process.decide(run.runId, requestId, 'deny')).toEqual({
      outcome: 'delivered',
      callbackType: 'service_scope_decision',
    });
    await process.settled(run.runId);

    expect(env.grants).toEqual([]);
    expect(messagesFor(env, run.runId)).toEqual(['implement the change']);
    const [original] = await process.owner.session(run.runId);
    expect(original).toMatchObject({
      state: 'settled',
      settlementDelivered: true,
      settlement: expect.objectContaining({ terminalOutcome: 'ABORTED' }),
    });

    await process.admit(run.runId, 'follow-up', 'do what you can without the API');
    await process.settled(run.runId);
    expect(messagesFor(env, run.runId)).toEqual([
      'implement the change',
      'do what you can without the API',
    ]);
    expect(startupFailures(env)).toEqual([]);
  });

  it('continues once after a restart while approval is pending', async () => {
    const env = environment();
    const { session, process: first, requestId } = await pausedSession(env);
    await first.stop();

    // Restart: recovery settles the interrupted input without calling the provider again.
    const second = await boot(env, [session]);
    const run = second.runs.get(session.agentic_session_id)!;
    await vi.waitFor(async () => expect(await second.owner.openRecords(run.runId)).toEqual([]));
    expect(messagesFor(env, run.runId)).toEqual(['implement the change']);
    const [recovered] = await second.owner.session(run.runId);
    expect(recovered).toMatchObject({
      state: 'settled',
      settlement: expect.objectContaining({ terminalOutcome: 'ABORTED' }),
    });

    // The pending approval survives the restart and its continuation runs exactly once.
    expect(await second.decide(run.runId, requestId, 'approve')).toEqual({
      outcome: 'delivered',
      callbackType: 'service_scope_decision',
    });
    await second.settled(run.runId);
    expect(messagesFor(env, run.runId)).toEqual(['implement the change', 'implement the change']);
    expect(env.grants).toHaveLength(1);
    expect(startupFailures(env)).toEqual([]);

    await second.admit(run.runId, 'follow-up', 'and now the tests');
    await second.settled(run.runId);
    expect(messagesFor(env, run.runId)).toEqual([
      'implement the change',
      'implement the change',
      'and now the tests',
    ]);
    expect(env.grants).toHaveLength(1);
    expect(startupFailures(env)).toEqual([]);
  });

  it.each(['approve', 'deny'] as const)(
    'settles the input once when the %s decision arrives before the paused Turn ends',
    async (decision) => {
      const env = environment();
      const session = await newSession();
      const process = await boot(env, [session]);
      const run = process.runs.get(session.agentic_session_id)!;
      env.scripts.set(run.runId, async (execution) => {
        if (execution !== 1) return;
        const result = await run.serviceScopeCoordinator.request({
          serviceIds: [shared.additionalServiceId],
          reason: 'The change also spans the API Service.',
        });
        if (result.status !== 'requested') throw new Error('expected a Service-scope request');
        // The decision lands while the paused Turn is still active.
        await process.decide(run.runId, result.request.id, decision);
      });
      await process.admit(run.runId, 'original', 'implement the change');
      await process.settled(run.runId);

      expect(messagesFor(env, run.runId)).toEqual(
        decision === 'approve'
          ? ['implement the change', 'implement the change']
          : ['implement the change'],
      );
      expect(process.transitions).toEqual([
        expect.objectContaining({ previous: 'picked', requested: 'started', accepted: true }),
        expect.objectContaining({ previous: 'started', requested: 'settled', accepted: true }),
      ]);
      expect(startupFailures(env)).toEqual([]);

      await process.admit(run.runId, 'follow-up', 'and now the tests');
      await process.settled(run.runId);
      expect(messagesFor(env, run.runId).at(-1)).toBe('and now the tests');
      expect((await process.owner.session(run.runId)).map((record) => record.state)).toEqual([
        'settled',
        'settled',
      ]);
      expect(startupFailures(env)).toEqual([]);
    },
  );

  it('keeps an independent session usable while another waits on approval', async () => {
    const env = environment();
    const independent = await newSession();
    const { process, run } = await pausedSession(env, [independent]);
    const other = independent.agentic_session_id;

    await process.admit(other, 'other', 'unrelated work');
    await process.settled(other);
    expect(messagesFor(env, other)).toEqual(['unrelated work']);
    expect((await process.owner.session(other)).map((record) => record.state)).toEqual(['settled']);
    // The paused session is still waiting on its own review, untouched.
    expect((await process.owner.session(run.runId)).map((record) => record.state)).toEqual([
      'started',
    ]);
    expect(startupFailures(env)).toEqual([]);
  });
});
