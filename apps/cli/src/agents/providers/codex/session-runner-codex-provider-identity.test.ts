import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CodexSdkEvent,
  CodexSdkEventHandler,
  CodexSdkServerRequest,
  CodexSdkServerRequestHandler,
} from '../../../agent-runtime/index';
import type { RepoMappingStore } from '../../../repo/index';
import type { RunStore } from '../../../run-store/run-store';
import type { AgenticSession } from '../../../session/index';
import { CodexAgentSessionRunner } from './session-runner-codex';
import { LocalAgentEndpoint } from '../../../server/local-base-url';
import { SubmissionToolRegistry } from '../../submission-tools/registry';
import {
  createProviderTestAgentOutputOwner,
  createProviderTestRepoMappingStore,
  createProviderTestRunStore,
} from '../provider-owner.test-support';

const localAgentEndpoint = new LocalAgentEndpoint();
const submissionToolRegistry = new SubmissionToolRegistry();

const startSessionMock = vi.fn();
const resumeSessionMock = vi.fn();
const getSessionIdMock = vi.fn();
const disconnectMock = vi.fn();
const submitClientResponseMock = vi.fn();
const compactMock = vi.fn();
let eventHandler: CodexSdkEventHandler | null = null;
let serverRequestHandler: CodexSdkServerRequestHandler | null = null;

vi.mock('../../../agent-runtime/index', async () => {
  const actual = await vi.importActual<typeof import('../../../agent-runtime/index')>(
    '../../../agent-runtime/index',
  );
  return {
    ...actual,
    CodexSdkClient: class {
      startSession(...args: Parameters<typeof startSessionMock>) {
        return startSessionMock(...args);
      }
      resumeSession(...args: Parameters<typeof resumeSessionMock>) {
        return resumeSessionMock(...args);
      }
      getSessionId(): string | null {
        return getSessionIdMock() ?? null;
      }
      getRootTurnIdentity(): null {
        return null;
      }
      onEvent(handler: CodexSdkEventHandler | null): void {
        eventHandler = handler;
      }
      onServerRequest(handler: CodexSdkServerRequestHandler | null): void {
        serverRequestHandler = handler;
      }
      submitClientResponse(...args: Parameters<typeof submitClientResponseMock>): void {
        submitClientResponseMock(...args);
      }
      compact(...args: Parameters<typeof compactMock>) {
        return compactMock(...args);
      }
      disconnect(...args: Parameters<typeof disconnectMock>) {
        return disconnectMock(...args);
      }
    },
  };
});

const emitCodexEvent = (event: CodexSdkEvent): void => {
  eventHandler?.(event);
};

void serverRequestHandler;

const createContextMetadata = () => ({
  capturedAt: '2026-06-20T00:00:00.000Z',
  organizationId: 'org-1',
  projectId: 'project-1',
  agentSessionId: 'agent-session-1',
  launchPlanId: 'plan-1',
  launchStepId: 'step-1',
  task: {
    id: 'task-1',
    name: 'Task one',
    type: 'STANDARD' as const,
    organizationId: 'org-1',
    projectId: 'project-1',
    initiativeId: 'initiative-1',
    status: 'ACTIVE' as const,
    source: 'user' as const,
  },
  userComments: [],
  fileReferences: {
    resolved: [],
    unresolved: [],
  },
});

const makeSession = (overrides: Partial<AgenticSession> = {}): AgenticSession =>
  ({
    agentic_session_id: 'agentic-1',
    services: [{ id: 'svc-1', path: '/tmp/repo' }],
    launchServiceId: 'svc-1',
    provider: 'codex',
    provider_session_id: 'pending_abc',
    provider_conversation_id: null,
    provider_session_agent_id: 'test-agent',
    status: 'idle',
    conversationId: 'conv-1',
    contextMetadata: createContextMetadata(),
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
    events: [],
    ...overrides,
  }) as AgenticSession;

const makeRunStore = (): RunStore => createProviderTestRunStore(makeSession);

const makeRepoStore = (): RepoMappingStore => createProviderTestRepoMappingStore();

const findRunCompletedPayload = (runStore: RunStore): Record<string, unknown> | null => {
  for (const [, event] of vi.mocked(runStore.appendEvent).mock.calls) {
    if (
      event.event_type === 'run_completed' &&
      event.payload &&
      typeof event.payload === 'object'
    ) {
      return event.payload as Record<string, unknown>;
    }
  }
  return null;
};

describe('session-runner-codex provider identity persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventHandler = null;
    serverRequestHandler = null;
    startSessionMock.mockImplementation(async () => {
      emitCodexEvent({ method: 'agent_message', params: { message: 'ok' } } as CodexSdkEvent);
      emitCodexEvent({ method: 'task_complete', params: {} } as CodexSdkEvent);
    });
    resumeSessionMock.mockImplementation(async () => {
      emitCodexEvent({ method: 'agent_message', params: { message: 'ok' } } as CodexSdkEvent);
      emitCodexEvent({ method: 'task_complete', params: {} } as CodexSdkEvent);
    });
    disconnectMock.mockResolvedValue(undefined);
    submitClientResponseMock.mockReturnValue(undefined);
    compactMock.mockResolvedValue(undefined);
    getSessionIdMock.mockReturnValue('codex-thread-xyz');
  });

  it('persists the native thread id with a null conversation id after a fresh prompt run', async () => {
    const runStore = makeRunStore();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
    });

    const result = await runner.runPrompt({
      session: makeSession(),
      prompt: 'Run this fresh.',
    });

    expect(result).toEqual({
      providerSessionId: 'codex-thread-xyz',
      providerConversationId: null,
      errorCount: 0,
    });

    const identityCalls = vi.mocked(runStore.updateRunProviderIdentity).mock.calls;
    expect(identityCalls.length).toBeGreaterThan(0);
    const [, identityInput] = identityCalls[identityCalls.length - 1]!;
    expect(identityInput).toEqual({
      providerSessionId: 'codex-thread-xyz',
      providerConversationId: null,
      providerSessionAgentId: 'test-agent',
    });
  });

  it('writes provider_conversation_id: null on the run_completed event payload', async () => {
    const runStore = makeRunStore();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
    });

    await runner.runPrompt({
      session: makeSession(),
      prompt: 'Verify run_completed payload.',
    });

    const payload = findRunCompletedPayload(runStore);
    expect(payload).not.toBeNull();
    expect(payload!['provider_session_id']).toBe('codex-thread-xyz');
    expect(payload!['provider_conversation_id']).toBeNull();
  });

  it('emits run_completed externally with provider_conversation_id: null', async () => {
    const onAgentOutput = vi.fn();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
    });

    await runner.runPrompt({
      session: makeSession(),
      prompt: 'Verify externally emitted run_completed.',
    });

    const runCompletedEmit = onAgentOutput.mock.calls.find(
      (call) => call[0]?.event?.eventType === 'run_completed' && call[0]?.event?.source === 'local',
    );
    expect(runCompletedEmit).toBeDefined();
    const emittedPayload = runCompletedEmit?.[0]?.event?.payload as Record<string, unknown>;
    expect(emittedPayload['provider_session_id']).toBe('codex-thread-xyz');
    expect(emittedPayload['provider_conversation_id']).toBeNull();
  });

  it('persists the native thread id with a null conversation id on a resumed turn', async () => {
    const runStore = makeRunStore();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
    });

    // A prior turn already persisted the native thread id; the next turn must
    // resume against it and re-write the same identity with a null conversation
    // id, with no carry-forward of any conversation field.
    getSessionIdMock.mockReturnValue('codex-thread-xyz');
    const result = await runner.runPrompt({
      session: makeSession({ provider_session_id: 'codex-thread-xyz' }),
      prompt: 'Resume turn.',
    });

    expect(resumeSessionMock).toHaveBeenCalledTimes(1);
    expect(resumeSessionMock.mock.calls[0]?.[0]).toBe('codex-thread-xyz');
    expect(result).toEqual({
      providerSessionId: 'codex-thread-xyz',
      providerConversationId: null,
      errorCount: 0,
    });
    const identityCalls = vi.mocked(runStore.updateRunProviderIdentity).mock.calls;
    const [, identityInput] = identityCalls[identityCalls.length - 1]!;
    expect(identityInput).toEqual({
      providerSessionId: 'codex-thread-xyz',
      providerConversationId: null,
      providerSessionAgentId: 'test-agent',
    });
  });

  it('writes the captured thread id with a null conversation id on the failure path', async () => {
    resumeSessionMock.mockImplementationOnce(async () => {
      throw new Error('codex transport failed mid-turn');
    });
    const runStore = makeRunStore();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
    });

    // The session record's persisted id is stale; the live SDK client has a
    // fresh thread id. The failure-path write must persist that fresh id with
    // a null conversation id rather than carrying any conversation field
    // forward from the resolved identity.
    getSessionIdMock.mockReturnValue('codex-thread-failure');
    await expect(
      runner.runPrompt({
        session: makeSession({ provider_session_id: 'codex-thread-stale' }),
        prompt: 'Failing resume.',
      }),
    ).rejects.toMatchObject({ code: 'RUN_FAILED' });

    const identityCalls = vi.mocked(runStore.updateRunProviderIdentity).mock.calls;
    expect(identityCalls.length).toBeGreaterThan(0);
    const [, identityInput] = identityCalls[identityCalls.length - 1]!;
    expect(identityInput).toEqual({
      providerSessionId: 'codex-thread-failure',
      providerConversationId: null,
      providerSessionAgentId: 'test-agent',
    });

    const payload = findRunCompletedPayload(runStore);
    expect(payload).not.toBeNull();
    expect(payload!['provider_session_id']).toBe('codex-thread-failure');
    expect(payload!['provider_conversation_id']).toBeNull();
  });
});
