import { describe, expect, it, vi } from 'vitest';
import {
  createTestRunEventPublisher,
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunOwnership,
  createTestRunStore,
  createTestRunnerPicker,
} from './run.test-support';

import type { PromptTypeHandlerDeps } from '../agents/prompt-type-handler';
import type { RepoMappingStore } from '../repo/index';
import type { AgenticSession } from '../session/types';
import { Run, type RunArgs, type RunCollaborators } from './run';
import type { RunnerContext } from './runners/types';
import type { Runner } from '../turn/turn';
import { defaultTestTurnHandler, makeTestTurn } from './handlers/__test-utils';

const makeSession = (overrides?: Partial<AgenticSession>): AgenticSession =>
  ({
    entity: null,
    agentic_session_id: 'run-1',
    provider: 'claude',
    provider_session_id: 'pending_abc-123',
    provider_conversation_id: null,
    provider_session_agent_id: 'coding_freeform',
    provider_session_history: [],
    status: 'idle',
    serviceId: 'svc-1',
    conversationId: 'conv-1',
    contextMetadata: {
      organizationId: 'org-1',
      projectId: 'proj-1',
    },
    events: [],
    createdAt: '2026-04-26T00:00:00.000Z',
    updatedAt: '2026-04-26T00:00:00.000Z',
    ...overrides,
  }) as unknown as AgenticSession;

const makeRunArgs = (overrides?: Partial<RunArgs>): RunArgs => ({
  runId: 'run-1',
  organizationId: 'org-1',
  projectId: 'proj-1',
  conversationId: 'conv-1',
  provider: 'claude',
  session: makeSession(),
  ...overrides,
});

const makeBroadcaster = createTestRunEventPublisher;

const makePoster = () =>
  createTestMessagePoster({
    createOutOfBand: vi.fn().mockResolvedValue('opener-msg-1'),
  });

const makeCollaborators = (): RunCollaborators => {
  const runStore = createTestRunStore();
  vi.spyOn(runStore, 'appendRunProviderSessionHistory').mockImplementation(async (_runId, entry) =>
    makeSession({ provider_session_history: [entry] }),
  );
  return {
    runStore,
    repoStore: createTestRepoMappingStore(),
    poster: makePoster(),
    broadcaster: makeBroadcaster(),
    ...createTestRunOwnership(),
    handlerDeps: {} as unknown as PromptTypeHandlerDeps,
    runnerPicker: createTestRunnerPicker(() => ({ run: async () => {} })),
    logger: {
      info: vi.fn(),
      trace: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as RunCollaborators['logger'],
  };
};

describe('Run.onAgentOutput provider session promotion', () => {
  it('replaces the pending placeholder when an event arrives with a real session id', () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    expect(run.session.provider_session_id).toBe('pending_abc-123');

    run.onAgentOutput({
      event: {
        source: 'provider',
        eventType: 'system',
        timestamp: '2026-04-26T00:00:01.000Z',
        sessionId: 'real-prov-id',
        agentId: 'claude',
        payload: { messageType: 'provider_event' },
      },
    });

    expect(run.session.provider_session_id).toBe('real-prov-id');
    expect(run.providerSessionId).toBe('real-prov-id');
  });

  it('ignores incoming session ids that are themselves pending placeholders', () => {
    const run = new Run(makeRunArgs(), makeCollaborators());

    run.onAgentOutput({
      event: {
        source: 'provider',
        eventType: 'system',
        timestamp: '2026-04-26T00:00:01.000Z',
        sessionId: 'pending_other',
        agentId: 'claude',
        payload: { messageType: 'provider_event' },
      },
    });

    expect(run.session.provider_session_id).toBe('pending_abc-123');
  });

  it('ignores events with no sessionId so a real id is not overwritten with null', () => {
    const run = new Run(
      makeRunArgs({ session: makeSession({ provider_session_id: 'real-prov-id' }) }),
      makeCollaborators(),
    );

    run.onAgentOutput({
      event: {
        source: 'local',
        eventType: 'processing_status',
        timestamp: '2026-04-26T00:00:01.000Z',
        sessionId: null,
        agentId: 'claude',
        payload: { messageType: 'provider_event' },
      },
    });

    expect(run.session.provider_session_id).toBe('real-prov-id');
  });

  it('is a no-op when the incoming id matches the current id', () => {
    const run = new Run(
      makeRunArgs({ session: makeSession({ provider_session_id: 'real-prov-id' }) }),
      makeCollaborators(),
    );
    const refreshSpy = vi.spyOn(run, 'refreshSessionFields');

    run.onAgentOutput({
      event: {
        source: 'provider',
        eventType: 'assistant',
        timestamp: '2026-04-26T00:00:01.000Z',
        sessionId: 'real-prov-id',
        agentId: 'claude',
        payload: {},
      },
    });

    expect(refreshSpy).not.toHaveBeenCalled();
    expect(run.session.provider_session_id).toBe('real-prov-id');
  });

  it('rejects provider-native events from another active session', () => {
    const collaborators = makeCollaborators();
    const run = new Run(
      makeRunArgs({ session: makeSession({ provider_session_id: 'real-prov-id' }) }),
      collaborators,
    );

    run.onAgentOutput({
      event: {
        source: 'provider',
        eventType: 'file_diff_detected',
        timestamp: '2026-04-26T00:00:01.000Z',
        sessionId: 'other-provider-session',
        agentId: 'claude',
        payload: { messageType: 'provider_event' },
      },
    });

    expect(run.session.provider_session_id).toBe('real-prov-id');
    expect(collaborators.broadcaster.publishAgentOutput).not.toHaveBeenCalled();
    expect(collaborators.logger.debug).toHaveBeenCalledWith(
      'local.run.event_rejected_provider_session_mismatch',
      expect.objectContaining({
        runId: 'run-1',
        turnId: null,
        hasActiveTurn: false,
        provider: 'claude',
        source: 'provider',
        agentId: 'claude',
        eventType: 'file_diff_detected',
        messageType: 'provider_event',
        expectedProviderSessionId: 'real-prov-id',
        receivedProviderSessionId: 'other-provider-session',
      }),
    );
  });

  it('accepts active Codex subagent events through broadcast and canonical file-change handling and records the session in history without replacing Run identity', async () => {
    const collaborators = makeCollaborators();
    const run = new Run(
      makeRunArgs({
        provider: 'codex',
        session: makeSession({
          provider: 'codex',
          provider_session_id: 'run-provider-session',
          provider_session_agent_id: 'run-owner',
        }),
      }),
      collaborators,
    );
    run.setActiveTurn(makeTestTurn({ ...defaultTestTurnHandler, runnerKind: 'subagent' }));
    const recordFileChanges = vi.spyOn(run, 'recordFileChanges').mockResolvedValue(undefined);

    const emit = (
      eventType: string,
      payload: Record<string, unknown>,
      sessionId = 'ephemeral-codex-session',
    ) =>
      run.onActiveTurnAgentOutput('turn-1', {
        event: {
          source: 'provider',
          eventType,
          timestamp: '2026-04-26T00:00:01.000Z',
          sessionId,
          agentId: 'codex',
          payload: { messageType: 'provider_event', ...payload },
        },
      });

    emit('thread/started', { routing: { thread_id: 'ephemeral-thread' } });
    emit('turn/started', {
      routing: { thread_id: 'ephemeral-thread', turn_id: 'ephemeral-turn' },
    });
    emit('file_diff_detected', {
      eventType: 'item/completed',
      routing: { thread_id: 'ephemeral-thread', turn_id: 'ephemeral-turn' },
      canonical_event: {
        schema_version: 1,
        canonical_event_type: 'diff',
        routing: { thread_id: 'ephemeral-thread', turn_id: 'ephemeral-turn' },
        diff: {
          files: ['src/changed.ts'],
          diff_blob: '--- old\n+++ new',
          delivery_mode: 'incremental',
          attribution_authority: 'confirmed',
        },
      },
    });
    await run.drainInFlightDispatch(1_000);

    expect(collaborators.broadcaster.publishAgentOutput).toHaveBeenCalledTimes(3);
    expect(recordFileChanges).toHaveBeenCalledWith(
      expect.objectContaining({
        providerSessionId: 'ephemeral-codex-session',
        providerThreadId: 'ephemeral-thread',
        providerTurnId: 'ephemeral-turn',
        paths: ['src/changed.ts'],
      }),
    );
    expect(run.session.provider_session_id).toBe('run-provider-session');
    expect(run.session.provider_session_agent_id).toBe('run-owner');
    // The subagent session joins history once, under its own handler.
    expect(collaborators.runStore.appendRunProviderSessionHistory).toHaveBeenCalledTimes(1);
    expect(collaborators.runStore.appendRunProviderSessionHistory).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        providerSessionId: 'ephemeral-codex-session',
        providerSessionAgentId: 'coding_freeform',
      }),
    );
    expect(collaborators.broadcaster.emitProviderIdentity).not.toHaveBeenCalled();
  });

  it('rejects a foreign session and a stale Turn callback after pinning active subagent identity', () => {
    const collaborators = makeCollaborators();
    const run = new Run(
      makeRunArgs({
        provider: 'codex',
        session: makeSession({
          provider: 'codex',
          provider_session_id: 'run-provider-session',
        }),
      }),
      collaborators,
    );
    run.setActiveTurn(makeTestTurn({ ...defaultTestTurnHandler, runnerKind: 'subagent' }));
    const event = (sessionId: string) => ({
      event: {
        source: 'provider' as const,
        eventType: 'system',
        timestamp: '2026-04-26T00:00:01.000Z',
        sessionId,
        agentId: 'codex',
        payload: { messageType: 'provider_event' },
      },
    });

    run.onActiveTurnAgentOutput('turn-1', event('ephemeral-codex-session'));
    run.onActiveTurnAgentOutput('turn-1', event('foreign-codex-session'));
    run.onActiveTurnAgentOutput('stale-turn', event('ephemeral-codex-session'));

    expect(collaborators.broadcaster.publishAgentOutput).toHaveBeenCalledTimes(1);
    // Only the admitted event reaches run-output listeners, attributed to its subagent Turn.
    expect(collaborators.broadcaster.publishAgentOutput).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'ephemeral-codex-session' }),
      { run, turnId: 'turn-1', subagentTurnId: 'turn-1' },
    );
    expect(collaborators.logger.debug).toHaveBeenCalledWith(
      'local.run.event_rejected_provider_session_mismatch',
      expect.objectContaining({
        producerTurnId: 'turn-1',
        rejectionReason: 'provider-session-mismatch',
        expectedProviderSessionId: 'ephemeral-codex-session',
        receivedProviderSessionId: 'foreign-codex-session',
      }),
    );
    expect(collaborators.logger.debug).toHaveBeenCalledWith(
      'local.run.event_rejected_provider_session_mismatch',
      expect.objectContaining({
        producerTurnId: 'stale-turn',
        rejectionReason: 'stale-turn',
      }),
    );
    expect(run.session.provider_session_id).toBe('run-provider-session');
  });
});

describe('Run.onAgentOutput upstream provider identity write', () => {
  it('persists membership before emitting provider identity once', async () => {
    const broadcaster = makeBroadcaster();
    const collaborators = { ...makeCollaborators(), broadcaster };
    const run = new Run(makeRunArgs(), collaborators);

    const emit = (sessionId: string, payload: Record<string, unknown> = {}) =>
      run.onAgentOutput({
        event: {
          source: 'provider',
          eventType: 'system',
          timestamp: '2026-04-26T00:00:01.000Z',
          sessionId,
          agentId: 'claude',
          payload: { messageType: 'provider_event', ...payload },
        },
      });

    emit('real-prov-id', { provider_conversation_id: 'conv-prov-1' });
    // A second real-id event must not re-emit — the write is once per Run.
    emit('real-prov-id', { provider_conversation_id: 'conv-prov-1' });
    expect(broadcaster.emitProviderIdentity).not.toHaveBeenCalled();
    await run.drainInFlightDispatch(1_000);

    expect(collaborators.runStore.appendRunProviderSessionHistory).toHaveBeenCalledTimes(1);
    expect(collaborators.runStore.appendRunProviderSessionHistory).toHaveBeenCalledWith('run-1', {
      providerSessionId: 'real-prov-id',
      providerConversationId: 'conv-prov-1',
      providerSessionAgentId: 'coding_freeform',
      observedAt: '2026-04-26T00:00:01.000Z',
    });
    expect(broadcaster.emitProviderIdentity).toHaveBeenCalledTimes(1);
    expect(broadcaster.emitProviderIdentity).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      agentSessionId: 'run-1',
      providerSessionId: 'real-prov-id',
      providerConversationId: 'conv-prov-1',
    });
  });

  it('does not emit while the session id is still a pending placeholder', () => {
    const broadcaster = makeBroadcaster();
    const run = new Run(makeRunArgs(), { ...makeCollaborators(), broadcaster });

    run.onAgentOutput({
      event: {
        source: 'provider',
        eventType: 'system',
        timestamp: '2026-04-26T00:00:01.000Z',
        sessionId: 'pending_other',
        agentId: 'claude',
        payload: { messageType: 'provider_event' },
      },
    });

    expect(broadcaster.emitProviderIdentity).not.toHaveBeenCalled();
  });

  it('emits a null providerConversationId when the event carries none (Claude)', async () => {
    const broadcaster = makeBroadcaster();
    const run = new Run(makeRunArgs(), { ...makeCollaborators(), broadcaster });

    run.onAgentOutput({
      event: {
        source: 'provider',
        eventType: 'system',
        timestamp: '2026-04-26T00:00:01.000Z',
        sessionId: 'real-prov-id',
        agentId: 'claude',
        payload: { messageType: 'provider_event' },
      },
    });
    await run.drainInFlightDispatch(1_000);

    expect(broadcaster.emitProviderIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ providerConversationId: null }),
    );
  });
});
