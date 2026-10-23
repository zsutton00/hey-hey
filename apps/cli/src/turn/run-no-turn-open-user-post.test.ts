import { describe, expect, it, vi } from 'vitest';
import {
  createTestRunEventPublisher,
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunOwnership,
  createTestRunStore,
  createTestRunnerPicker,
} from '../run/run.test-support';

import type { PromptTypeHandler, PromptTypeHandlerDeps } from '../agents/prompt-type-handler';
import { MessageType, MessageStatus } from '../shared/api/index';
import type { InternalRunPromptRequest } from '../shared/agent-bridge-contract/contract';
import type { AgenticSession } from '../session/types';
import { Run, type RunArgs, type RunCollaborators } from '../run/run';
import type { RunnerContext } from '../run/runners/types';
import type { Runner } from './turn';
import type { RunEventPublisher } from '../server/run-event-publisher';

// Pin the invariant: a turn-open posts no conversation message at all — no
// SYSTEM processing placeholder (the anchor is gone; every write now appends
// to the tail) and no USER row (authoring it is the platform's job — the CLI
// must not double-author it on engine-bound conversations).

const handlerStub: PromptTypeHandler<unknown> = {
  id: 'coding_freeform',
  promptType: 'coding_freeform',
  service: 'required',
  launchEntity: 'none',
  implementationReadiness: 'gated_and_clarifiable',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  buildPrompt: () => 'unused',
};

vi.mock('../run/resolve-prompt', () => ({
  resolvePrompt: async () => ({
    resolvedPrompt: 'resolved',
    startingMessage: undefined,
    sessionContext: undefined,
    preparedPayload: undefined,
    isSubagentOwned: false,
    consumedPreviousProviderSession: false,
  }),
}));

vi.mock('../server/services/run.service', () => ({
  validateResolvedPromptReferences: async () => {},
}));

const makeSession = (overrides?: Partial<AgenticSession>): AgenticSession =>
  ({
    entity: null,
    agentic_session_id: 'run-1',
    provider: 'claude',
    provider_session_id: 'prov-1',
    provider_conversation_id: null,
    status: 'idle',
    services: [{ id: 'svc-1', path: '/tmp/repo' }],
    launchServiceId: 'svc-1',
    conversationId: 'conv-1',
    contextMetadata: {
      organizationId: 'org-1',
      projectId: 'proj-1',
    },
    events: [],
    model: 'claude-opus-4-6',
    reasoningEffort: 'medium',
    ...overrides,
  }) as unknown as AgenticSession;

const makeRunArgs = (overrides?: Partial<RunArgs>): RunArgs => ({
  runId: 'run-1',
  organizationId: 'org-1',
  projectId: 'proj-1',
  conversationId: 'conv-1',
  provider: 'claude',
  session: makeSession(),
  hasProviderSession: true,
  ...overrides,
});

const makeBroadcaster = createTestRunEventPublisher;

const makePoster = () =>
  createTestMessagePoster({
    createOutOfBand: vi.fn().mockResolvedValue('processing-msg-1'),
  });

const makeRunStore = () => {
  const store = createTestRunStore();
  vi.spyOn(store, 'updateRunPromptType').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunSessionContext').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunWorktreeState').mockResolvedValue(makeSession());
  vi.spyOn(store, 'addTouchedFiles').mockResolvedValue(undefined);
  vi.spyOn(store, 'addToolUsage').mockResolvedValue(undefined);
  vi.spyOn(store, 'updateRunPreviousProviderSession').mockResolvedValue(makeSession());
  vi.spyOn(store, 'getRun').mockResolvedValue(null);
  return store;
};

const makeCollaborators = (
  broadcaster: RunEventPublisher,
  pickRunner: (ctx: RunnerContext) => Runner,
  poster: RunCollaborators['poster'],
): RunCollaborators => ({
  runStore: makeRunStore(),
  repoStore: createTestRepoMappingStore(),
  poster,
  broadcaster,
  ...createTestRunOwnership(() => handlerStub),
  handlerDeps: {} as unknown as PromptTypeHandlerDeps,
  runnerPicker: createTestRunnerPicker(pickRunner),
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as RunCollaborators['logger'],
});

const makeUserMessageInput = (): InternalRunPromptRequest =>
  ({
    promptType: 'coding_freeform',
    payload: { promptType: 'coding_freeform', userMessage: 'hi from the user' },
    references: { resolved: [], unresolved: [] },
    triggerContext: null,
  }) as InternalRunPromptRequest;

describe('Run turn-open — no turn-open message post', () => {
  it('posts zero SYSTEM placeholder and zero USER messages for a single user-message turn', async () => {
    const broadcaster = makeBroadcaster();
    const poster = makePoster();
    const runFn = vi.fn(async () => {});
    const pickRunner: (ctx: RunnerContext) => Runner = () => ({ run: runFn });

    const run = new Run(makeRunArgs(), makeCollaborators(broadcaster, pickRunner, poster));
    await run.handleMessage(makeUserMessageInput());
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    const createOutOfBandCalls = (poster.createOutOfBand as ReturnType<typeof vi.fn>).mock.calls;
    const dtoTypes = createOutOfBandCalls.map(
      (call) => (call[0] as { dto: { type: string } }).dto.type,
    );
    const userPosts = dtoTypes.filter((t) => t === MessageType.User);
    const systemPosts = createOutOfBandCalls.filter((call) => {
      const dto = (call[0] as { dto: { type: string; status: string } }).dto;
      return dto.type === MessageType.System && dto.status === MessageStatus.SystemProcessing;
    });

    expect(userPosts).toHaveLength(0);
    expect(systemPosts).toHaveLength(0);
    expect(runFn).toHaveBeenCalledTimes(1);
  });
});
