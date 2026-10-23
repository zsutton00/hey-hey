import { describe, expect, it, vi } from 'vitest';
import type { AgenticSession } from '../../../session/types';
import type { LocalFreeFormPromptPayload } from '../../../shared/agent-bridge-contract/index';
import type { LocalPromptStartupInput } from '../../../shared/agent-bridge-contract/generated/api';
import type { ImplementationReadinessSourceSnapshot } from '../../../shared/api/generated/api';
import type { AssistantCompleteEvent } from '../../../run/types';
import { NOOP_LOGGER } from '../../../server/logger';
import { buildCompletionReconciliationPromptFor } from '../../completion-reconciliation/prompts/common';
import { PromptTypeRegistry } from '../../prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../../prompt-type-registry.test-support';
import type {
  OnCompleteContext,
  PromptTypeHandlerContext,
  PromptTypeHandlerDeps,
} from '../../prompt-type-handler';
import {
  createOnCompleteTestDeps,
  createPromptTypeHandlerTestAuth,
  createPromptTypeHandlerTestDeps,
} from '../../prompt-type-handler.test-support';
import {
  buildCodingConversationPrompt,
  type CodingConversationPreparedPayload,
} from '../../prompts/coding-conversation';
import { codingFreeformHandler, freeFormHandler } from '../coding-conversation.handler';

const makeStartupInput = (): LocalPromptStartupInput => ({
  task: {
    id: 'run-task',
    title: 'Investigate the rehydrate path',
    description: 'Free-form enrichment.',
    acceptanceCriteria: 'Handler returns a usable startupInput.',
    taskType: 'STANDARD',
  },
  adjacentScopeTasks: [],
  evidenceItems: [],
});

const makeLaunchPayload = (
  overrides: Partial<LocalFreeFormPromptPayload> = {},
): LocalFreeFormPromptPayload => ({
  startupInput: makeStartupInput(),
  userMessage: '',
  ...overrides,
});

const makeLaunchSession = (overrides: Partial<AgenticSession> = {}): AgenticSession =>
  ({
    agentic_session_id: 'run-free-form-1',
    entity: { entityType: 'TASK', entityId: 'run-task' },
    conversationId: 'conv-1',
    services: [],
    sessionContext: {},
    contextMetadata: { organizationId: 'org-1', projectId: 'proj-1' },
    ...overrides,
  }) as unknown as AgenticSession;

const makeFollowUpSession = (overrides: Partial<AgenticSession> = {}): AgenticSession =>
  ({
    agentic_session_id: 'run-coding-1',
    services: [],
    sessionContext: {},
    contextMetadata: { organizationId: 'org-1', projectId: 'proj-1' },
    ...overrides,
  }) as unknown as AgenticSession;

const makeCanonicalContext = (): PromptTypeHandlerContext => ({
  loadedEntityContext: {
    kind: 'entity',
    focalEntity: { entityType: 'TASK', entityId: 'run-task' },
    entity: { title: 'Investigate the rehydrate path' } as never,
    context: { displayName: 'Investigate the rehydrate path' } as never,
  },
  recentUserReplies: [],
  triggerParentMessageId: null,
});

const makeLaunchDeps = (): PromptTypeHandlerDeps =>
  createPromptTypeHandlerTestDeps({
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    } as unknown as PromptTypeHandlerDeps['logger'],
    fetchImpl: vi.fn(),
    apiBaseUrl: 'https://api.example/api/v1',
  });

const noopDeps = createPromptTypeHandlerTestDeps();

const makeFetchDeps = (
  responseBody: unknown,
  ok = true,
): { deps: PromptTypeHandlerDeps; fetchImpl: ReturnType<typeof vi.fn> } => {
  const fetchImpl = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => responseBody,
  })) as unknown as ReturnType<typeof vi.fn>;
  const deps = createPromptTypeHandlerTestDeps({
    fetchImpl: fetchImpl as unknown as typeof fetch,
    auth: createPromptTypeHandlerTestAuth('test-token'),
    apiBaseUrl: 'https://api.test',
    logger: NOOP_LOGGER,
  });
  return { deps, fetchImpl };
};

const makeFailingFetchDeps = (): PromptTypeHandlerDeps =>
  createPromptTypeHandlerTestDeps({
    fetchImpl: vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch,
    auth: createPromptTypeHandlerTestAuth('test-token'),
    apiBaseUrl: 'https://api.test',
    logger: NOOP_LOGGER,
  });

const ctxWithParent = (id: string | null): PromptTypeHandlerContext => ({
  recentUserReplies: [],
  triggerParentMessageId: id,
});

const completionEvent = (summary: string): AssistantCompleteEvent => ({
  kind: 'assistant_complete',
  summary,
  runId: 'run',
  source: 'provider',
  eventType: 'complete',
  timestamp: '2026-09-04T00:00:00Z',
  sessionId: 'provider-session',
  agentId: null,
  payload: {},
});

const readinessDisposition = {
  state: 'REVIEW_REQUIRED',
  sourceSnapshot: {
    runId: 'run-free-form-1',
    focalEntityId: 'run-task',
    focalEntityType: 'TASK',
    sourceRevision: 'sha256:readiness-source',
    capturedAt: '2026-09-17T19:00:00.000Z',
  },
  finding: {
    affectedSourceContext: 'Task context',
    unresolvedDecision: 'Who owns the write?',
    consequentialInventionRisk: 'The implementation would invent ownership.',
    boundedEvidence: [{ category: 'ownership', statement: 'The task leaves ownership open.' }],
    answerKind: 'Name the owner.',
  },
  resolution: { kind: 'NONE' },
};

const readinessSummary = `\`\`\`json\n${JSON.stringify({
  responseType: 'implementation_readiness_v1',
  disposition: readinessDisposition,
})}\n\`\`\``;

const makeOnCompleteContext = (persist: ReturnType<typeof vi.fn>): OnCompleteContext =>
  ({
    runId: 'run-free-form-1',
    run: { persistImplementationReadinessFromAgentResponse: persist },
    organizationId: 'org-1',
    projectId: 'proj-1',
    conversationId: 'conv-1',
    messageId: 'msg-1',
    stamp: {},
    payload: {},
  }) as unknown as OnCompleteContext;

describe('coding-conversation adapters', () => {
  it('keeps each alias declaration: identity, promptType, tools and Project Assistant policy', () => {
    expect(freeFormHandler).toMatchObject({
      id: 'free_form',
      promptType: 'free_form',
      runnerKind: 'provider_session',
      expectedResponseTypes: ['implementation_readiness_v1'],
      projectAssistant: {
        allowEdgeUpdates: false,
        notifyDiscrepancies: false,
        workItemProposalMode: 'all',
      },
    });
    expect(freeFormHandler.mcpToolUseCase).toBeUndefined();
    expect(freeFormHandler.submissionTools?.map((tool) => tool.name)).toEqual([
      'report_changed_files',
      'request_agent_session_service_scope',
      'submit_implementation_readiness',
    ]);

    expect(codingFreeformHandler).toMatchObject({
      id: 'coding_freeform',
      promptType: 'coding_freeform',
      runnerKind: 'provider_session',
      mcpToolUseCase: 'general',
    });
    expect(codingFreeformHandler.projectAssistant).toBeUndefined();
    expect(codingFreeformHandler.expectedResponseTypes).toBeUndefined();
    expect(codingFreeformHandler.buildStartingMessage).toBeUndefined();
    expect(codingFreeformHandler.submissionTools?.map((tool) => tool.name)).toEqual([
      'report_changed_files',
      'request_agent_session_service_scope',
    ]);
  });

  it('resolves both registry aliases to the shared adapters', () => {
    const registry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);
    expect(registry.get('free_form')).toBe(freeFormHandler);
    expect(registry.get('coding_freeform')).toBe(codingFreeformHandler);
  });

  it.each([
    ['launch', freeFormHandler, makeLaunchPayload({ userMessage: 'go' })],
    ['follow-up', codingFreeformHandler, { userMessage: 'go' }],
  ] as const)(
    'the %s prompt ends with the shared completion instruction',
    (_label, handler, payload) => {
      const prompt = handler.buildPrompt(payload as never, makeCanonicalContext());
      expect(prompt.endsWith(buildCompletionReconciliationPromptFor(new Set()))).toBe(true);
      expect(prompt).toContain('changedFiles');
    },
  );

  it.each([
    ['launch', freeFormHandler],
    ['follow-up', codingFreeformHandler],
  ] as const)(
    'the %s alias validates, maps and reports changedFiles from an ordinary completion',
    (_label, handler) => {
      const changedFiles = [{ serviceId: 'service-1', path: 'src/a.ts' }];
      const event = completionEvent(JSON.stringify({ response: 'Done', changedFiles }));
      expect(handler.validateCompletion?.(event)).toEqual({ ok: true });
      expect(handler.transformCompletionOutput?.(event)).toMatchObject({
        data: { type: 'AGENT', response: 'Done' },
      });
      expect(handler.requiresChangedFileReporting).toBe(true);
    },
  );
});

describe('launch readiness response', () => {
  it('passes validation without ordinary mapping or changed-file reading', () => {
    const event = completionEvent(readinessSummary);
    expect(freeFormHandler.validateCompletion?.(event)).toEqual({ ok: true });
    expect(freeFormHandler.transformCompletionOutput?.(event)).toBeNull();
  });

  it('persists the disposition through onComplete', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    await freeFormHandler.onComplete?.(
      completionEvent(readinessSummary),
      makeOnCompleteContext(persist),
      createOnCompleteTestDeps(),
    );
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'REVIEW_REQUIRED', sourceSnapshot: expect.any(Object) }),
    );
  });

  it('does not persist readiness from an ordinary completion', async () => {
    const persist = vi.fn();
    await freeFormHandler.onComplete?.(
      completionEvent(JSON.stringify({ response: 'Done' })),
      makeOnCompleteContext(persist),
      createOnCompleteTestDeps(),
    );
    expect(persist).not.toHaveBeenCalled();
  });

  it('is still rejected on a follow-up and never persisted', async () => {
    const event = completionEvent(readinessSummary);
    expect(codingFreeformHandler.validateCompletion?.(event)).toMatchObject({ ok: false });

    const persist = vi.fn();
    await codingFreeformHandler.onComplete?.(
      event,
      makeOnCompleteContext(persist),
      createOnCompleteTestDeps(),
    );
    expect(persist).not.toHaveBeenCalled();
  });
});

describe('launch preparation', () => {
  const prepare = freeFormHandler.prepare!.bind(freeFormHandler);

  it('retains payload startup input without reconstructing focal content', async () => {
    const deps = makeLaunchDeps();
    const result = await prepare(makeLaunchSession(), makeLaunchPayload(), deps);

    expect(result.payload.startupInput?.task).toEqual(makeStartupInput().task);
    expect(result.payload.startupInput?.focalEntity).toBeUndefined();
    expect(result.payload.priorPromptType).toBeUndefined();
    expect(result.sessionContext).toBeUndefined();
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it('carries Run-owned worktree state into the shared Services prompt', async () => {
    const result = await prepare(
      makeLaunchSession({
        services: [
          { id: 'service-a', path: '/host/service-a' },
          { id: 'service-b', path: '/host/service-b' },
        ],
        launchServiceId: 'service-b',
        worktreeState: {
          'service-a': {
            repoPath: '/host/service-a',
            worktreePath: '/worktrees/service-a',
            branch: 'feature/worktrees',
          },
          'service-b': {
            repoPath: '/host/service-b',
            worktreePath: '/worktrees/service-b',
            branch: 'feature/worktrees',
          },
        },
      }),
      makeLaunchPayload(),
      makeLaunchDeps(),
    );

    const prompt = freeFormHandler.buildPrompt(result.payload);
    expect(prompt).toContain('Launch service `service-b` at `/worktrees/service-b`');
    expect(prompt).toContain('`service-a` at `/worktrees/service-a`');
    expect(prompt).not.toContain('/host/service-a');
    expect(prompt).not.toContain('/host/service-b');
    expect(prompt).toContain("Host checkouts are outside this session's working context");
  });

  it('does not synthesize startup input from persisted Run identity alone', async () => {
    const deps = makeLaunchDeps();
    const result = await prepare(
      makeLaunchSession({
        sessionContext: { 'freeForm.startupInput': makeStartupInput() },
        contextMetadata: {
          organizationId: 'org-1',
          projectId: 'proj-1',
          task: { id: 'stale-context-task' },
        } as never,
      }),
      { userMessage: 'continue' },
      deps,
    );

    expect(result.payload.startupInput).toBeUndefined();
    expect(result.sessionContext).toBeUndefined();
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it('does not validate or rewrite a caller-provided startup task identity', async () => {
    const payload = makeLaunchPayload();
    payload.startupInput!.task.id = 'stale-task';

    const result = await prepare(makeLaunchSession(), payload, makeLaunchDeps());
    expect(result.payload.startupInput?.task.id).toBe('stale-task');
  });

  it('fails closed when persisted Run identity is missing', async () => {
    await expect(
      prepare(makeLaunchSession({ entity: null }), makeLaunchPayload(), makeLaunchDeps()),
    ).rejects.toThrow(/persisted Run entity/);
  });

  it('quotes the userMessage in the starting message, else names the task', () => {
    const build = freeFormHandler.buildStartingMessage!.bind(freeFormHandler);
    expect(build(makeLaunchPayload({ userMessage: 'hi' }))).toBe('"hi"\n\nI\'ll get started...');
    expect(build(makeLaunchPayload(), makeCanonicalContext())).toBe(
      'Getting started on Investigate the rehydrate path...',
    );
  });

  it('carries the canonical source binding into the readiness preflight prompt', async () => {
    const result = await prepare(makeLaunchSession(), makeLaunchPayload(), makeLaunchDeps());
    const sourceSnapshot =
      readinessDisposition.sourceSnapshot as ImplementationReadinessSourceSnapshot;

    const prompt = freeFormHandler.buildPrompt(result.payload, {
      ...makeCanonicalContext(),
      implementationReadinessSourceSnapshot: sourceSnapshot,
    });

    expect(prompt).toContain('## Implementation-readiness preflight');
    expect(prompt).toContain('## Implementation-readiness evidence');
    expect(prompt).toContain('`run-free-form-1`');
    expect(prompt).toContain('`sha256:readiness-source`');
    expect(prompt).toContain('do not use code-capable tools in the same turn');
    expect(prompt).toContain('A readiness response replaces the completion JSON below');
    expect(prompt).not.toContain('## Readiness clarification');
  });

  it('asks a routed clarification to resolve the pending finding with CLEAR', async () => {
    const result = await prepare(makeLaunchSession(), makeLaunchPayload(), makeLaunchDeps());

    const prompt = freeFormHandler.buildPrompt(result.payload, {
      ...makeCanonicalContext(),
      implementationReadinessSourceSnapshot:
        readinessDisposition.sourceSnapshot as ImplementationReadinessSourceSnapshot,
      implementationReadinessClarification: {
        finding: {
          affectedSourceContext: 'Task context',
          unresolvedDecision: 'Who owns the write?',
          consequentialInventionRisk: 'The implementation would invent ownership.',
          boundedEvidence: [{ category: 'ownership', statement: 'Ownership is open.' }],
          answerKind: 'Name the owner.',
        },
      },
    });

    expect(prompt).toContain('## Readiness clarification');
    expect(prompt).toContain('The open decision was: Who owns the write?');
    expect(prompt).toContain('with a `CLEAR` disposition');
    expect(prompt.indexOf('## Readiness clarification')).toBeLessThan(
      prompt.indexOf('## Implementation-readiness preflight'),
    );
  });
});

describe('follow-up preparation', () => {
  const prepare = codingFreeformHandler.prepare!.bind(codingFreeformHandler);

  it('stitches priorPromptType and the Run services onto the payload', async () => {
    const worktreeState = {
      'svc-42': {
        repoPath: '/tmp/repo',
        worktreePath: '/tmp/worktrees/svc-42',
        branch: 'feature/worktrees',
      },
    };
    const run = makeFollowUpSession({
      promptType: 'startup_session',
      services: [{ id: 'svc-42', path: '/tmp/repo' }],
      launchServiceId: 'svc-42',
      worktreeState,
    });
    const result = await prepare(run, { userMessage: 'hi' }, noopDeps);
    expect(result.payload).toEqual({
      userMessage: 'hi',
      priorPromptType: 'startup_session',
      services: [{ id: 'svc-42', path: '/tmp/repo' }],
      launchServiceId: 'svc-42',
      worktreeState,
    });

    expect(codingFreeformHandler.buildPrompt(result.payload)).toContain(
      'Launch service `svc-42` at `/tmp/worktrees/svc-42`',
    );
  });

  it('does not require a persisted Run entity', async () => {
    const result = await prepare(
      makeFollowUpSession({ entity: null }),
      { userMessage: 'hi' },
      noopDeps,
    );
    expect(result.payload.userMessage).toBe('hi');
  });

  it('ignores duplicate task identity in context metadata', async () => {
    const run = makeFollowUpSession({
      contextMetadata: {
        organizationId: 'org-1',
        projectId: 'proj-1',
        task: { id: 'task-99' },
      } as AgenticSession['contextMetadata'],
    });
    const result = await prepare(run, { userMessage: 'hi' }, noopDeps);
    expect(result.payload.taskId).toBeUndefined();
  });

  it('leaves stitched fields undefined when the run has none', async () => {
    const result = await prepare(makeFollowUpSession(), { userMessage: 'hi' }, noopDeps);
    expect(result.payload.priorPromptType).toBeUndefined();
    expect(result.payload.services).toBeUndefined();
    expect(result.payload.launchServiceId).toBeUndefined();
    expect(result.payload.priorAssistantMessage).toBeUndefined();
    expect(result.payload.taskId).toBeUndefined();
  });

  it('stitches priorAssistantMessage from an AGENT parent with a non-empty response', async () => {
    const { deps, fetchImpl } = makeFetchDeps({
      success: true,
      data: {
        id: 'parent-1',
        type: 'SYSTEM',
        data: { type: 'AGENT', response: 'Here is the prior answer.' },
      },
    });
    const result = await prepare(
      makeFollowUpSession({ promptType: 'startup_session' }),
      { userMessage: 'follow up' },
      deps,
      ctxWithParent('parent-1'),
    );
    expect(result.payload.priorAssistantMessage).toBe('Here is the prior answer.');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const callArgs = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(callArgs[0]).toBe(
      'https://api.test/organizations/org-1/projects/proj-1/messages/parent-1',
    );
    expect((callArgs[1].headers as Record<string, string>)['Authorization']).toBe(
      'Bearer test-token',
    );
  });

  it('does not fetch when the trigger has no parent', async () => {
    const { deps, fetchImpl } = makeFetchDeps({ success: true, data: null });
    const result = await prepare(
      makeFollowUpSession(),
      { userMessage: 'hi' },
      deps,
      ctxWithParent(null),
    );
    expect(result.payload.priorAssistantMessage).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['a USER message', { id: 'parent-1', type: 'USER', data: { comment: 'just a user reply' } }],
    [
      'an empty AGENT response',
      { id: 'parent-1', type: 'SYSTEM', data: { type: 'AGENT', response: '   ' } },
    ],
  ])('omits priorAssistantMessage when the parent is %s', async (_label, data) => {
    const { deps } = makeFetchDeps({ success: true, data });
    const result = await prepare(
      makeFollowUpSession(),
      { userMessage: 'hi' },
      deps,
      ctxWithParent('parent-1'),
    );
    expect(result.payload.priorAssistantMessage).toBeUndefined();
  });

  it('degrades without priorAssistantMessage when the fetch throws', async () => {
    const result = await prepare(
      makeFollowUpSession(),
      { userMessage: 'hi' },
      makeFailingFetchDeps(),
      ctxWithParent('parent-1'),
    );
    expect(result.payload.priorAssistantMessage).toBeUndefined();
    expect(result.payload.userMessage).toBe('hi');
  });
});

describe('follow-up orientation', () => {
  const basePayload: CodingConversationPreparedPayload = {
    userMessage: 'what does the dispatcher do?',
    priorPromptType: 'startup_session',
    services: [{ id: 'svc-42', path: '/tmp/repo' }],
    launchServiceId: 'svc-42',
  };
  const followUp = (
    payload: CodingConversationPreparedPayload,
    overrides: { awaitingUserReview?: boolean; taskId?: string | null } = {},
  ): string =>
    buildCodingConversationPrompt(payload, {
      kind: 'follow_up',
      awaitingUserReview: overrides.awaitingUserReview ?? false,
      taskId: overrides.taskId ?? null,
    });

  it('names the session as a coding session and orients on the latest message', () => {
    const prompt = followUp(basePayload);
    expect(prompt.toLowerCase()).toContain('coding session');
    expect(prompt).toContain('startup session');
    expect(prompt.toLowerCase()).toContain("user's most recent message");
    expect(prompt).not.toMatch(/do not repeat/i);
    expect(prompt).not.toMatch(/^> /m);
  });

  it('falls back to the generic orient line without a prior label or quote', () => {
    const prompt = followUp({ userMessage: 'hi' });
    expect(prompt.toLowerCase()).toContain("user's most recent message");
    expect(prompt).not.toMatch(/^> /m);
  });

  it('does not re-embed ambient platform context', () => {
    const prompt = followUp(basePayload);
    expect(prompt).not.toContain('## Platform Context');
    expect(prompt).not.toContain('## Entity References (MANDATORY)');
  });

  it('quotes the previous assistant message with or without a prior label', () => {
    const labelled = followUp({
      ...basePayload,
      priorAssistantMessage: 'I refactored the dispatcher.\nHere are the details.',
    });
    expect(labelled).toContain('startup session');
    expect(labelled).toContain('> I refactored the dispatcher.');
    expect(labelled).toContain('> Here are the details.');
    expect(labelled.toLowerCase()).toContain('replied to that message');

    const unlabelled = followUp({
      userMessage: 'hi',
      priorAssistantMessage: 'Sure, happy to help.',
    });
    expect(unlabelled).toContain('> Sure, happy to help.');
    expect(unlabelled).not.toContain('**startup');
  });

  it('renders the fixed Task scope only when a task id is projected', () => {
    const prompt = followUp(basePayload, { taskId: 'task-99' });
    expect(prompt).toContain('## Task scope');
    expect(prompt).toContain('task-99');
    expect(prompt.toLowerCase()).toContain('do not search for the task');
    expect(followUp(basePayload)).not.toContain('## Task scope');
  });

  it('threads the workflow review gate from the handler context', () => {
    const parked = codingFreeformHandler.buildPrompt(basePayload, {
      recentUserReplies: [],
      triggerParentMessageId: null,
      awaitingUserReview: true,
    });
    const unparked = codingFreeformHandler.buildPrompt(basePayload, {
      recentUserReplies: [],
      triggerParentMessageId: null,
      awaitingUserReview: false,
    });
    expect(parked).toContain('## Workflow is waiting on the user');
    expect(parked.toLowerCase()).toContain('parked on a review');
    expect(parked.toLowerCase()).toContain('pending review');
    expect(unparked).not.toContain('Workflow is waiting on the user');
  });

  it('never carries the launch readiness preflight', () => {
    expect(followUp(basePayload)).not.toContain('## Implementation-readiness preflight');
  });
});
