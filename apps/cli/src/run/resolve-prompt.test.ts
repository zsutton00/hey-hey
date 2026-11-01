/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createFirstTurnPromptRunState,
  resolvePrompt,
  type ResolvePromptArgs,
  type ResolvePromptRunState,
} from './resolve-prompt';
import { projectProviderSessionStartupInput } from './provider-session-startup-input';
import type { ReportChainEntry } from './types';
import type { AgenticSession, AgenticSessionContextMetadata } from '../session/index';
import {
  defaultAddUserMessage,
  type PromptTypeHandler,
  type PromptTypeHandlerContext,
  type PromptTypeHandlerDeps,
} from '../agents/prompt-type-handler';
import type { AgentStartupPromptInputResult } from '../agents/prompt-type-handler';
import { createPromptTypeHandlerTestDeps } from '../agents/prompt-type-handler.test-support';
import { PromptTypeRegistry } from '../agents/prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../agents/prompt-type-registry.test-support';
import { WorkflowAboutReader } from '../agents/submission-tools/search-messages-proxy';
import { mentionFormatReminder } from '../agents/prompts/common';
import type { InternalRunPromptRequest } from '../shared/agent-bridge-contract/contract';
import type { RunEntityReference } from '../shared/agent-bridge-contract/contract';
import {
  LocalPromptType,
  LocalPromptTaskType,
  RunEntityReferenceEntityTypeEnum as RunEntityType,
} from '../shared/agent-bridge-contract/generated/api';

// Test promptTypes are unique strings that don't match the generated
// `LocalPromptType` literal union. The registry lookup is keyed on `string`
// at runtime, so the cast is safe — it only placates the strict DTO type.
type TestPromptType = NonNullable<InternalRunPromptRequest['promptType']>;
const asPromptType = (s: string): TestPromptType => s as TestPromptType;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeContextMetadata = (): AgenticSessionContextMetadata =>
  ({
    capturedAt: '2026-04-21T00:00:00.000Z',
    organizationId: 'org-1',
    projectId: 'proj-1',
    agentSessionId: 'agent-1',
    userComments: [],
    fileReferences: { resolved: [], unresolved: [] },
  }) as unknown as AgenticSessionContextMetadata;

interface MakeSessionOverrides {
  /** Pass `null` to simulate "no service repository bound to this session". */
  serviceId?: string | null;
  /** Persisted promptType on the session. Pass a plain string. */
  promptType?: string | null;
  entity?: RunEntityReference | null;
}

const makeSession = (overrides?: MakeSessionOverrides): AgenticSession => {
  const session: AgenticSession = {
    entity: null,
    agentic_session_id: 'run-1',
    services: [{ id: 'svc-1', path: '/tmp/repo' }],
    launchServiceId: 'svc-1',
    provider: 'claude',
    provider_session_id: 'provider-1',
    provider_conversation_id: null,
    conversationId: 'conv-1',
    status: 'idle',
    contextMetadata: makeContextMetadata(),
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z',
    events: [],
  };
  if (overrides?.serviceId === null) {
    session.services = [];
    delete session.launchServiceId;
  } else if (typeof overrides?.serviceId === 'string') {
    session.services = [{ id: overrides.serviceId, path: '/tmp/repo' }];
    session.launchServiceId = overrides.serviceId;
  }
  if (typeof overrides?.promptType === 'string') {
    session.promptType = overrides.promptType;
  }
  if (overrides && 'entity' in overrides) {
    session.entity = overrides.entity ?? null;
  }
  return session;
};

const makeHandlerDeps = (): PromptTypeHandlerDeps => {
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn((): unknown => logger),
  } as unknown as PromptTypeHandlerDeps['logger'];

  return createPromptTypeHandlerTestDeps({
    fetchImpl: (() => Promise.resolve(Response.json({ data: [] }))) as typeof fetch,
    apiBaseUrl: 'http://localhost',
    logger,
  });
};

const makeRunState = (overrides?: Partial<ResolvePromptRunState>): ResolvePromptRunState => ({
  ...createFirstTurnPromptRunState(),
  ...overrides,
});

const makeChainEntry = (overrides?: Partial<ReportChainEntry>): ReportChainEntry => ({
  createdAt: '2026-04-26T01:00:00.000Z',
  phase: 'startup_session' as ReportChainEntry['phase'],
  reportId: 'rep-1',
  reportType: 'SESSION_SUMMARY' as ReportChainEntry['reportType'],
  summary: 'first summary',
  audience: 'EXTERNAL',
  ...overrides,
});

interface MakeInputOverrides {
  promptType?: string;
  userMessage?: string;
  payload?: unknown;
}

// `promptType` is required on `InternalRunPromptRequest` at the wire layer, and
// the message-service edge always resolves `workflow-defined` to a concrete
// value before calling `resolvePrompt`.
const makeInput = (overrides?: MakeInputOverrides): InternalRunPromptRequest => {
  const base = { references: { resolved: [], unresolved: [] } };
  const promptType =
    overrides?.promptType !== undefined ? asPromptType(overrides.promptType) : undefined;
  const payload =
    overrides?.payload !== undefined
      ? overrides.payload
      : overrides?.userMessage !== undefined
        ? {
            ...(promptType !== undefined ? { promptType } : {}),
            userMessage: overrides.userMessage,
          }
        : undefined;
  return {
    ...base,
    ...(promptType !== undefined ? { promptType } : {}),
    ...(payload !== undefined
      ? { payload: payload as NonNullable<InternalRunPromptRequest['payload']> }
      : {}),
  } as unknown as InternalRunPromptRequest;
};

const callResolve = (overrides: Partial<ResolvePromptArgs>) => {
  // Production sources the handler from the registry keyed on the request's
  // promptType (run.ts), so the test mirrors that lookup.
  const input = overrides.input ?? makeInput();
  const registryHandler = input.promptType ? registeredHandlers.get(input.promptType) : undefined;
  const args: ResolvePromptArgs = {
    handler: registryHandler as PromptTypeHandler<unknown>,
    run: makeSession(),
    runState: makeRunState(),
    input,
    handlerDeps: makeHandlerDeps(),
    turnId: 'turn-1',
    abortSignal: () => undefined,
    recentUserReplies: [],
    triggerParentMessageId: null,
    ...overrides,
  };
  return resolvePrompt(args);
};

const stripMentionReminder = (prompt: string | null): string | null => {
  if (prompt === null) return null;
  const suffix = `\n\n${mentionFormatReminder}`;
  return prompt.endsWith(suffix) ? prompt.slice(0, -suffix.length) : prompt;
};

const expectResolvedPromptBody = (
  result: Awaited<ReturnType<typeof resolvePrompt>>,
  expected: string,
): void => {
  expect(stripMentionReminder(result.resolvedPrompt)).toBe(expected);
  expect(result.resolvedPrompt).toContain(mentionFormatReminder);
};

const registeredPromptTypes: string[] = [];
const registeredHandlers = new Map<string, PromptTypeHandler<unknown>>();

const registerHandler = (
  promptType: string,
  handler: Partial<PromptTypeHandler<unknown>> &
    Pick<PromptTypeHandler<unknown>, 'buildPrompt'> & {
      // Launchable handlers carry `addUserMessage`; the resolver's
      // `isUserLaunchable` guard keys off its presence. Optional here so
      // non-launchable test handlers stay terse.
      addUserMessage?: (payload: { userMessage?: string }) => string | null;
    },
): PromptTypeHandler<unknown> => {
  const full: PromptTypeHandler<unknown> = {
    promptType,
    ...handler,
  } as PromptTypeHandler<unknown>;
  registeredHandlers.set(promptType, full);
  registeredPromptTypes.push(promptType);
  return full;
};

afterEach(() => {
  for (const promptType of registeredPromptTypes) {
    registeredHandlers.delete(promptType);
  }
  registeredPromptTypes.length = 0;
});

// ---------------------------------------------------------------------------
// Branch 1 — First turn + handler + payload
// ---------------------------------------------------------------------------

const authoritativeStartupResult = (): AgentStartupPromptInputResult => ({
  startupInput: {
    task: {
      id: 'task-1',
      title: 'Current task',
      taskType: LocalPromptTaskType.Standard,
      description: 'CURRENT ENTITY CONTEXT',
    },
    focalEntity: { entityType: RunEntityType.Task, entityId: 'task-1' },
    adjacentScopeTasks: [],
    evidenceItems: [],
  },
  renderedInput: 'CURRENT ENTITY CONTEXT',
  loadedEntityContext: {
    kind: 'entity',
    focalEntity: { entityType: RunEntityType.Task, entityId: 'task-1' },
    entity: {} as never,
    context: { displayName: 'CURRENT ENTITY CONTEXT' } as never,
  },
  provenance: {
    templateKey: 'task',
    ownershipSource: { scope: 'CANONICAL' },
    revisionId: 'revision-1',
    revisionNumber: 1,
  },
  template: {
    templateKey: 'task',
    selector: { entityType: 'WORK_ITEM', workItemTypeKey: 'STANDARD' },
    syntaxVersion: 'V1',
    content: 'CURRENT ENTITY CONTEXT',
    provenance: {
      templateKey: 'task',
      ownershipSource: { scope: 'CANONICAL' },
      revisionId: 'revision-1',
      revisionNumber: 1,
    },
  },
});

const copiedStartupPayload = {
  task: {
    id: 'task-1',
    title: 'Copied task',
    taskType: LocalPromptTaskType.Standard,
    description: 'COPIED LAUNCH CONTEXT',
  },
  focalEntity: { entityType: RunEntityType.Task, entityId: 'task-1' },
  adjacentScopeTasks: [],
  evidenceItems: [],
};

describe('resolvePrompt — first turn with handler and payload', () => {
  it('creates independent empty first-turn snapshots', () => {
    const state = createFirstTurnPromptRunState();
    const nextState = createFirstTurnPromptRunState();

    expect(state).toEqual({
      currentPromptType: null,
      isFirstTurn: true,
      previousProviderSession: null,
      reportChain: [],
      memos: [],
      startedPromptTypes: new Set(),
    });
    expect(nextState).toEqual(state);
    expect(nextState.reportChain).not.toBe(state.reportChain);
    expect(nextState.memos).not.toBe(state.memos);
    expect(nextState.startedPromptTypes).not.toBe(state.startedPromptTypes);
  });

  it('hands the prompt types that already started on the Run to the handler prompt context', async () => {
    const promptType = 'resolve_prompt_test_started_types';
    const buildPrompt = vi.fn(() => 'PROMPT');
    const handler = registerHandler(promptType, { buildPrompt });

    await callResolve({
      handler,
      input: makeInput({ promptType, payload: { detail: 'context' } }),
      runState: makeRunState({
        currentPromptType: promptType,
        isFirstTurn: false,
        startedPromptTypes: new Set(['feature_sync_analyze']),
      }),
    });

    expect(buildPrompt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ startedPromptTypes: new Set(['feature_sync_analyze']) }),
    );
  });

  it('resolves authoritative startup input once without deciding provider-session delivery', async () => {
    const startupResult = authoritativeStartupResult();
    const resolveStartupPromptInput = vi.fn().mockResolvedValue(startupResult);
    const handler = registerHandler('resolve_prompt_test_entity_start', {
      buildPrompt: (_payload, ctx) =>
        `HANDLER CONTEXT: ${ctx?.loadedEntityContext?.context.displayName ?? 'MISSING CANONICAL CONTEXT'}`,
      buildPromptSegments: (_payload, ctx) => ({
        stableInstructions: 'STABLE ENTITY INSTRUCTIONS',
        dynamicContext: `HANDLER CONTEXT: ${ctx?.loadedEntityContext?.context.displayName ?? 'MISSING CANONICAL CONTEXT'}`,
      }),
      addUserMessage: defaultAddUserMessage,
    });
    const deps = makeHandlerDeps();
    deps.startupPromptInput = {
      resolve: resolveStartupPromptInput,
    } as unknown as PromptTypeHandlerDeps['startupPromptInput'];
    const rerun = await callResolve({
      handler,
      run: makeSession({
        entity: { entityType: RunEntityType.Task, entityId: 'task-1' },
      }),
      input: makeInput({
        promptType: 'resolve_prompt_test_entity_start',
        payload: { startupInput: copiedStartupPayload, userMessage: 'Start now.' },
      }),
      handlerDeps: deps,
    });

    expect(rerun.resolvedPrompt).toContain('CURRENT ENTITY CONTEXT');
    expect(rerun.resolvedPrompt).toContain('HANDLER CONTEXT: CURRENT ENTITY CONTEXT');
    expect(rerun.resolvedPrompt?.match(/CURRENT ENTITY CONTEXT/g)).toHaveLength(1);
    expect(rerun.resolvedPrompt).not.toContain('COPIED LAUNCH CONTEXT');
    expect(resolveStartupPromptInput).toHaveBeenCalledTimes(1);
    expect(rerun.startupPromptInput).toBe(startupResult);
    expect(rerun.providerSessionStartupSegments).toEqual({
      stableInstructions: 'STABLE ENTITY INSTRUCTIONS',
      dynamicContext: 'HANDLER CONTEXT: CURRENT ENTITY CONTEXT',
      userInput: expect.stringContaining('Start now.'),
    });
    expect(rerun.providerSessionStartupSegments?.userInput).toContain('NO partial UUIDs, EVER');
    const firstMintSegments = rerun.providerSessionStartupSegments;
    if (!firstMintSegments) throw new Error('Expected first-mint startup segments.');
    expect(
      projectProviderSessionStartupInput({
        decision: 'first-turn-mint',
        prompt: rerun.resolvedPrompt ?? '',
        startupPromptInput: rerun.startupPromptInput ?? null,
        promptSegments: firstMintSegments,
      }),
    ).toEqual({
      action: 'mint',
      delivered: true,
      input: {
        kind: 'startup',
        segments: {
          stableInstructions: 'STABLE ENTITY INSTRUCTIONS',
          dynamicContext:
            'CURRENT ENTITY CONTEXT\n\n---\n\nHANDLER CONTEXT: CURRENT ENTITY CONTEXT',
          userInput: expect.stringContaining('Start now.'),
        },
      },
    });
  });

  it('falls back to the persisted entity when the copied startup payload is malformed', async () => {
    const startupResult = authoritativeStartupResult();
    const resolveStartupPromptInput = vi.fn().mockResolvedValue(startupResult);
    const handler = registerHandler('resolve_prompt_test_malformed_startup', {
      buildPrompt: () => 'HANDLER CONTEXT',
      addUserMessage: defaultAddUserMessage,
    });
    const deps = makeHandlerDeps();
    deps.startupPromptInput = {
      resolve: resolveStartupPromptInput,
    } as unknown as PromptTypeHandlerDeps['startupPromptInput'];

    await callResolve({
      handler,
      run: makeSession({
        entity: { entityType: RunEntityType.Task, entityId: 'task-1' },
      }),
      handlerDeps: deps,
      input: makeInput({
        promptType: 'resolve_prompt_test_malformed_startup',
        payload: {
          startupInput: {
            task: null,
            adjacentScopeTasks: 'malformed',
            evidenceItems: null,
          },
          userMessage: 'Start now.',
        },
      }),
    });

    expect(resolveStartupPromptInput).toHaveBeenCalledWith({
      runEntity: { entityType: RunEntityType.Task, entityId: 'task-1' },
      organizationId: 'org-1',
      projectId: 'proj-1',
    });
  });

  it('passes the same rendered startup input to an isolated first turn without resolving a second time', async () => {
    const startupResult = authoritativeStartupResult();
    const resolveStartupPromptInput = vi.fn().mockResolvedValue(startupResult);
    const handler = registerHandler('resolve_prompt_test_entity_subagent', {
      runnerKind: 'subagent',
      buildPrompt: () => 'ISOLATED HANDLER',
      addUserMessage: defaultAddUserMessage,
    });
    const deps = makeHandlerDeps();
    deps.startupPromptInput = {
      resolve: resolveStartupPromptInput,
    } as unknown as PromptTypeHandlerDeps['startupPromptInput'];

    const result = await callResolve({
      handler,
      run: makeSession({
        entity: { entityType: RunEntityType.Task, entityId: 'task-1' },
      }),
      input: makeInput({
        promptType: 'resolve_prompt_test_entity_subagent',
        payload: { startupInput: copiedStartupPayload, userMessage: 'Plan this.' },
      }),
      handlerDeps: deps,
    });

    expect(result.resolvedPrompt).toBeNull();
    expect(result.startupPromptInput).toBe(startupResult);
    expect(resolveStartupPromptInput).toHaveBeenCalledTimes(1);
  });

  it('does not resolve or prepend startup input on later messages', async () => {
    const startupResult = authoritativeStartupResult();
    const resolveStartupPromptInput = vi.fn();
    const handler = registerHandler('resolve_prompt_test_entity_follow_up', {
      buildPrompt: () => 'UNREACHABLE',
      addUserMessage: defaultAddUserMessage,
    });
    const deps = makeHandlerDeps();
    deps.startupPromptInput = {
      resolve: resolveStartupPromptInput,
    } as unknown as PromptTypeHandlerDeps['startupPromptInput'];

    const result = await callResolve({
      handler,
      run: makeSession({
        entity: { entityType: RunEntityType.Task, entityId: 'task-1' },
      }),
      runState: makeRunState({
        isFirstTurn: false,
        currentPromptType: 'resolve_prompt_test_entity_follow_up',
        startupPromptInput: startupResult,
      }),
      input: makeInput({
        promptType: 'resolve_prompt_test_entity_follow_up',
        userMessage: 'Follow up.',
      }),
      handlerDeps: deps,
    });

    expectResolvedPromptBody(result, 'Follow up.');
    expect(result.resolvedPrompt).not.toContain('CURRENT ENTITY CONTEXT');
    expect(resolveStartupPromptInput).not.toHaveBeenCalled();
  });

  it('refreshes entity Context for a remint while reusing stable template state', async () => {
    const startupResult = authoritativeStartupResult();
    if (!startupResult.template) throw new Error('Expected a cached startup template.');
    const refreshedStartupResult: AgentStartupPromptInputResult = {
      ...startupResult,
      renderedInput: 'REFRESHED ENTITY CONTEXT',
      loadedEntityContext: {
        ...startupResult.loadedEntityContext,
        context: { displayName: 'REFRESHED ENTITY CONTEXT' } as never,
      },
    };
    const resolveStartupPromptInput = vi.fn().mockResolvedValue(refreshedStartupResult);
    const handler = registerHandler('resolve_prompt_test_entity_remint', {
      buildPrompt: () => 'UNREACHABLE',
      buildPromptSegments: (_payload, context) => ({
        stableInstructions: 'NEW STABLE INSTRUCTIONS',
        dynamicContext: `HANDLER ${context?.loadedEntityContext?.context.displayName ?? 'MISSING'}`,
      }),
      addUserMessage: defaultAddUserMessage,
    });
    const deps = makeHandlerDeps();
    deps.startupPromptInput = {
      resolve: resolveStartupPromptInput,
    } as unknown as PromptTypeHandlerDeps['startupPromptInput'];

    const result = await callResolve({
      handler,
      handlerDeps: deps,
      run: makeSession({
        entity: { entityType: RunEntityType.Task, entityId: 'task-1' },
        promptType: 'resolve_prompt_test_entity_remint',
      }),
      runState: makeRunState({
        isFirstTurn: false,
        currentPromptType: 'resolve_prompt_test_entity_remint',
        startupPromptInput: startupResult,
        startupPromptTemplate: startupResult.template,
        cachedProviderSessionStartupSegments: {
          promptType: handler.promptType,
          stableInstructions: 'CACHED STABLE INSTRUCTIONS',
        },
      }),
      input: makeInput({
        promptType: 'resolve_prompt_test_entity_remint',
        payload: { userMessage: 'Continue after the mutation.' },
      }),
      providerSessionDecision: 'per-turn-mint',
      refreshStartupPromptInput: true,
    });

    expect(resolveStartupPromptInput).toHaveBeenCalledWith(
      {
        runEntity: { entityType: RunEntityType.Task, entityId: 'task-1' },
        organizationId: 'org-1',
        projectId: 'proj-1',
      },
      { cachedTemplate: startupResult.template },
    );
    expect(result.startupPromptInput).toBe(refreshedStartupResult);
    expect(result.resolvedPrompt).toContain('HANDLER REFRESHED ENTITY CONTEXT');
    expect(result.providerSessionStartupSegments?.stableInstructions).toBe(
      'CACHED STABLE INSTRUCTIONS',
    );
    expect(result.providerSessionStartupSegments).toEqual({
      stableInstructions: 'CACHED STABLE INSTRUCTIONS',
      dynamicContext: 'HANDLER REFRESHED ENTITY CONTEXT',
      userInput: expect.stringContaining('Continue after the mutation.'),
    });
    const remintSegments = result.providerSessionStartupSegments;
    if (!remintSegments) throw new Error('Expected remint startup segments.');
    expect(
      projectProviderSessionStartupInput({
        decision: 'per-turn-mint',
        prompt: result.resolvedPrompt ?? '',
        startupPromptInput: result.startupPromptInput ?? null,
        promptSegments: remintSegments,
      }),
    ).toEqual({
      action: 'remint',
      delivered: true,
      input: {
        kind: 'startup',
        segments: {
          stableInstructions: 'CACHED STABLE INSTRUCTIONS',
          dynamicContext: 'REFRESHED ENTITY CONTEXT\n\n---\n\nHANDLER REFRESHED ENTITY CONTEXT',
          userInput: expect.stringContaining('Continue after the mutation.'),
        },
      },
    });
  });

  it('prepares the new projection cycle with refreshed Context after workspace reconciliation', async () => {
    const startupResult = authoritativeStartupResult();
    if (!startupResult.template) throw new Error('Expected a cached startup template.');
    const refreshedStartupResult: AgentStartupPromptInputResult = {
      ...startupResult,
      renderedInput: 'REFRESHED ENTITY CONTEXT',
      loadedEntityContext: {
        ...startupResult.loadedEntityContext,
        context: { displayName: 'REFRESHED ENTITY CONTEXT' } as never,
      },
    };
    const events: string[] = [];
    const resolveStartupPromptInput = vi.fn(async () => {
      events.push('startup');
      return refreshedStartupResult;
    });
    const handler = registerHandler('resolve_prompt_test_deferred_remint', {
      prepare: vi.fn(async () => {
        events.push('prepare');
        return { payload: {} };
      }),
      buildPrompt: (_payload, context) =>
        `HANDLER ${context?.loadedEntityContext?.context.displayName ?? 'MISSING'}`,
    });
    const deps = makeHandlerDeps();
    deps.startupPromptInput = {
      resolve: resolveStartupPromptInput,
    } as unknown as PromptTypeHandlerDeps['startupPromptInput'];

    const result = await callResolve({
      handler,
      handlerDeps: deps,
      run: makeSession({
        entity: { entityType: RunEntityType.Task, entityId: 'task-1' },
        promptType: 'resolve_prompt_test_deferred_remint',
      }),
      runState: makeRunState({
        isFirstTurn: false,
        currentPromptType: 'resolve_prompt_test_deferred_remint',
        startupPromptInput: startupResult,
        startupPromptTemplate: startupResult.template,
      }),
      input: makeInput({
        promptType: 'resolve_prompt_test_deferred_remint',
        payload: {},
      }),
      providerSessionDecision: 'resume',
      onPreparedPayload: async ({ payload, requestStartupPromptInputRefresh }) => {
        events.push('reconcile');
        requestStartupPromptInputRefresh();
        return payload;
      },
    });

    expect(events).toEqual(['prepare', 'reconcile', 'startup', 'prepare', 'reconcile']);
    expect(resolveStartupPromptInput).toHaveBeenCalledTimes(1);
    expect(resolveStartupPromptInput).toHaveBeenCalledWith(
      {
        runEntity: { entityType: RunEntityType.Task, entityId: 'task-1' },
        organizationId: 'org-1',
        projectId: 'proj-1',
      },
      { cachedTemplate: startupResult.template },
    );
    expect(result.startupPromptInput).toBe(refreshedStartupResult);
    expect(result.resolvedPrompt).toContain('HANDLER REFRESHED ENTITY CONTEXT');
  });

  it('reloads a missing startup projection before preparing an entity-scoped handler', async () => {
    const startupResult = authoritativeStartupResult();
    const resolveStartupPromptInput = vi.fn().mockResolvedValue(startupResult);
    let observedPrepareContext: PromptTypeHandlerContext | undefined;
    const handler = registerHandler('resolve_prompt_test_entity_rehydrate', {
      prepare: vi.fn(
        async (
          _run: unknown,
          _payload: unknown,
          _deps: PromptTypeHandlerDeps,
          context?: PromptTypeHandlerContext,
        ) => {
          observedPrepareContext = context;
          return { payload: { userMessage: 'Continue.' } };
        },
      ),
      buildPrompt: () => 'SYSTEM',
      addUserMessage: defaultAddUserMessage,
    });
    const deps = makeHandlerDeps();
    deps.startupPromptInput = {
      resolve: resolveStartupPromptInput,
    } as unknown as PromptTypeHandlerDeps['startupPromptInput'];

    await callResolve({
      handler,
      handlerDeps: deps,
      run: makeSession({ entity: { entityType: RunEntityType.Task, entityId: 'task-1' } }),
      runState: makeRunState({
        isFirstTurn: false,
        currentPromptType: 'previous-handler',
      }),
      input: makeInput({
        promptType: 'resolve_prompt_test_entity_rehydrate',
        payload: { userMessage: 'Continue.' },
      }),
    });

    expect(resolveStartupPromptInput).toHaveBeenCalledTimes(1);
    expect(observedPrepareContext?.loadedEntityContext).toBe(startupResult.loadedEntityContext);
  });

  it('passes the authoritative loaded entity context before prepare and prompt assembly', async () => {
    let observedPrepareContext: PromptTypeHandlerContext | undefined;
    let observedBuildContext: PromptTypeHandlerContext | undefined;
    const startupResult = authoritativeStartupResult();
    const prepare = vi.fn(
      async (
        _run: unknown,
        _payload: unknown,
        _deps: PromptTypeHandlerDeps,
        context?: PromptTypeHandlerContext,
      ) => {
        observedPrepareContext = context;
        return { payload: { userMessage: 'Continue.' } };
      },
    );
    registerHandler('resolve_prompt_test_loaded_entity_context', {
      prepare,
      buildPrompt: (_payload, context) => {
        observedBuildContext = context;
        return 'SYSTEM';
      },
      addUserMessage: defaultAddUserMessage,
    });
    const deps = makeHandlerDeps();
    deps.startupPromptInput = {
      resolve: vi.fn().mockResolvedValue(startupResult),
    } as unknown as PromptTypeHandlerDeps['startupPromptInput'];

    const result = await callResolve({
      run: makeSession({ entity: { entityType: RunEntityType.Task, entityId: 'task-1' } }),
      handlerDeps: deps,
      input: makeInput({
        promptType: 'resolve_prompt_test_loaded_entity_context',
        userMessage: 'Continue.',
      }),
    });

    expect(observedPrepareContext?.loadedEntityContext).toBe(startupResult.loadedEntityContext);
    expect(observedBuildContext?.loadedEntityContext).toBe(startupResult.loadedEntityContext);
    expect(result.resolvedPrompt).toContain('SYSTEM');
  });

  it('builds the handler system prompt and appends the service-context note when the session has no service', async () => {
    registerHandler('resolve_prompt_test_first_no_service', {
      buildPrompt: () => 'SYSTEM',
    });

    const result = await callResolve({
      run: makeSession({ serviceId: null }),
      runState: makeRunState({ isFirstTurn: true }),
      input: makeInput({
        promptType: 'resolve_prompt_test_first_no_service',
        payload: { anything: 'goes' },
      }),
    });

    expect(result.resolvedPrompt).toContain('SYSTEM');
    expect(result.resolvedPrompt).toContain('## Code Search Guidance');
    expect(result.sessionContext).toBeUndefined();
    expect(result.promptTypeChanged).toBe(false);
    expect(result.isSubagentOwned).toBe(false);
  });

  it('omits the service-context note when the session has a serviceId', async () => {
    registerHandler('resolve_prompt_test_first_with_service', {
      buildPrompt: () => 'SYSTEM',
    });

    const result = await callResolve({
      run: makeSession({ serviceId: 'svc-1' }),
      input: makeInput({
        promptType: 'resolve_prompt_test_first_with_service',
        payload: { anything: 'goes' },
      }),
    });

    expectResolvedPromptBody(result, 'SYSTEM');
  });

  it('lets a handler omit the generic service-less code-search note', async () => {
    registerHandler('resolve_prompt_test_handler_scope', {
      buildPrompt: () => 'HANDLER-SCOPED',
      omitServiceContextNote: true,
    });

    const result = await callResolve({
      run: makeSession({ serviceId: null }),
      input: makeInput({
        promptType: 'resolve_prompt_test_handler_scope',
        payload: { anything: 'goes' },
      }),
    });

    expectResolvedPromptBody(result, 'HANDLER-SCOPED');
    expect(result.resolvedPrompt).not.toContain('## Code Search Guidance');
  });

  it('appends a launchable handler payload.userMessage onto the system prompt via addUserMessage', async () => {
    registerHandler('resolve_prompt_test_first_userMessage', {
      buildPrompt: () => 'SYSTEM',
      addUserMessage: defaultAddUserMessage,
    });

    const result = await callResolve({
      run: makeSession({ serviceId: 'svc-1' }),
      input: makeInput({
        promptType: 'resolve_prompt_test_first_userMessage',
        payload: { userMessage: 'hi there' },
      }),
    });

    expect(result.resolvedPrompt).toContain('SYSTEM');
    expect(result.resolvedPrompt).toContain('The user has sent the following message');
    expect(result.resolvedPrompt).toContain('hi there');
  });

  it('does not inject payload.userMessage for a non-launchable handler (no addUserMessage)', async () => {
    registerHandler('resolve_prompt_test_first_non_launchable', {
      buildPrompt: () => 'SYSTEM',
    });

    const result = await callResolve({
      run: makeSession({ serviceId: 'svc-1' }),
      input: makeInput({
        promptType: 'resolve_prompt_test_first_non_launchable',
        payload: { userMessage: 'hi there' },
      }),
    });

    expectResolvedPromptBody(result, 'SYSTEM');
    expect(result.resolvedPrompt).not.toContain('The user has sent the following message');
  });

  it('threads handler.prepare sessionContext back to the caller without persisting it', async () => {
    const prepare = vi.fn().mockResolvedValue({
      payload: { transformed: true },
      sessionContext: { key: 'value' },
    });
    registerHandler('resolve_prompt_test_first_prepare', {
      buildPrompt: () => 'SYSTEM',
      prepare,
      buildStartingMessage: () => 'starting',
    });

    const result = await callResolve({
      run: makeSession({ serviceId: 'svc-1' }),
      input: makeInput({
        promptType: 'resolve_prompt_test_first_prepare',
        payload: { anything: 'goes' },
      }),
    });

    expect(prepare).toHaveBeenCalledOnce();
    expect(result.sessionContext).toEqual({ key: 'value' });
    expect(result.startingMessage).toBe('starting');
  });

  it('threads handler.prepare enriched payload back to the caller so subagent runners can read it', async () => {
    const prepare = vi.fn().mockResolvedValue({
      payload: { userMessage: 'raw', _approvedPlan: '{"sessionTitle":"Approved"}' },
    });
    registerHandler('resolve_prompt_test_prepared_payload', {
      buildPrompt: () => 'SYSTEM',
      prepare,
    });

    const result = await callResolve({
      input: makeInput({
        promptType: 'resolve_prompt_test_prepared_payload',
        payload: { userMessage: 'raw' },
      }),
    });

    expect(prepare).toHaveBeenCalledOnce();
    expect(result.preparedPayload).toEqual({
      userMessage: 'raw',
      _approvedPlan: '{"sessionTitle":"Approved"}',
    });
  });

  it('reconciles a prepared payload before building and returning it', async () => {
    const buildPrompt = vi.fn((payload: unknown) => JSON.stringify(payload));
    registerHandler('resolve_prompt_test_prepared_reconcile', {
      buildPrompt,
      prepare: vi.fn().mockResolvedValue({
        payload: { _services: [{ id: 'svc-1', path: '/repos/service-a' }] },
      }),
    });
    const onPreparedPayload = vi.fn(async ({ payload }: { payload: unknown }) => ({
      ...(payload as Record<string, unknown>),
      _services: [
        { id: 'svc-1', path: '/repos/service-a' },
        { id: 'svc-2', path: '/repos/service-b' },
      ],
    }));

    const result = await callResolve({
      input: makeInput({
        promptType: 'resolve_prompt_test_prepared_reconcile',
        payload: {},
      }),
      onPreparedPayload,
    });

    expect(onPreparedPayload).toHaveBeenCalledOnce();
    expect(buildPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        _services: [
          { id: 'svc-1', path: '/repos/service-a' },
          { id: 'svc-2', path: '/repos/service-b' },
        ],
      }),
      expect.any(Object),
    );
    expect(result.preparedPayload).toMatchObject({
      _services: [
        { id: 'svc-1', path: '/repos/service-a' },
        { id: 'svc-2', path: '/repos/service-b' },
      ],
    });
  });

  it('leaves preparedPayload undefined when the handler has no prepare step', async () => {
    registerHandler('resolve_prompt_test_no_prepare', {
      buildPrompt: () => 'SYSTEM',
    });

    const result = await callResolve({
      input: makeInput({
        promptType: 'resolve_prompt_test_no_prepare',
        payload: { userMessage: 'raw' },
      }),
    });

    expect(result.preparedPayload).toBeUndefined();
  });
});

describe('resolvePrompt — registered handlers consume one preloaded entity Context', () => {
  const productionRegistry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);

  const startupResultWithContext = (renderedInput: string): AgentStartupPromptInputResult => {
    const result = authoritativeStartupResult();
    return {
      ...result,
      renderedInput,
      loadedEntityContext: {
        ...result.loadedEntityContext,
        entity: { id: 'task-1', type: 'STANDARD' } as never,
        context: { displayName: renderedInput } as never,
      },
    };
  };

  const makeRegisteredDeps = (
    startupResolve: PromptTypeHandlerDeps['startupPromptInput']['resolve'],
  ): { deps: PromptTypeHandlerDeps; fetchImpl: ReturnType<typeof vi.fn> } => {
    const deps = makeHandlerDeps();
    deps.startupPromptInput = {
      resolve: startupResolve,
    } as PromptTypeHandlerDeps['startupPromptInput'];
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    deps.fetchImpl = fetchImpl as unknown as typeof fetch;
    return { deps, fetchImpl };
  };

  const composeProviderPrompt = (
    result: Awaited<ReturnType<typeof resolvePrompt>>,
    decision: 'first-turn-mint' | 'agent-transition-mint',
  ): string => {
    const projection = projectProviderSessionStartupInput({
      decision,
      prompt: result.resolvedPrompt ?? '',
      startupPromptInput: result.startupPromptInput ?? null,
      ...(result.providerSessionStartupSegments
        ? { promptSegments: result.providerSessionStartupSegments }
        : {}),
    });
    if (projection.input.kind === 'turn') return projection.input.prompt;
    return [
      projection.input.segments.stableInstructions,
      projection.input.segments.dynamicContext,
      projection.input.segments.userInput,
    ]
      .filter((value) => value.length > 0)
      .join('\n\n---\n\n');
  };

  it('resolves standalone first turns with the real handlers, entity template, and user request', async () => {
    const startupResolve = vi
      .fn<PromptTypeHandlerDeps['startupPromptInput']['resolve']>()
      .mockResolvedValue(startupResultWithContext('PRELOADED ENTITY CONTEXT'));
    const { deps, fetchImpl } = makeRegisteredDeps(startupResolve);
    const workflowAboutRead = vi
      .spyOn(WorkflowAboutReader.prototype, 'read')
      .mockResolvedValue({ workflowAboutId: 'task-1', workflowAboutType: 'task' });
    const run = makeSession({
      entity: { entityType: RunEntityType.Task, entityId: 'task-1' },
    });
    run.provider_session_id = '';
    const userMessage = 'Explain the current entity and its next steps.';

    const cases: ReadonlyArray<{ promptType: string; payload: unknown }> = [
      {
        promptType: LocalPromptType.EntityConversation,
        payload: {
          entity: { entityType: 'TASK', entityId: 'task-1' },
          userMessage,
        },
      },
      {
        promptType: LocalPromptType.Research,
        payload: { userMessage },
      },
      {
        promptType: LocalPromptType.ProjectAssistant,
        payload: {
          promptType: LocalPromptType.Research,
          entity: { entityType: 'TASK', entityId: 'task-1' },
          userMessage,
          projectAssistantHandoff: {
            consumerHandlerId: LocalPromptType.Research,
            policy: {
              allowEdgeUpdates: false,
              notifyDiscrepancies: false,
              workItemProposalMode: 'none',
            },
          },
        },
      },
    ];

    try {
      for (const testCase of cases) {
        const handler = productionRegistry.get(testCase.promptType);
        if (!handler) throw new Error(`Missing registered handler: ${testCase.promptType}`);

        const result = await resolvePrompt({
          handler,
          run,
          runState: createFirstTurnPromptRunState(),
          input: makeInput({ promptType: testCase.promptType, payload: testCase.payload }),
          handlerDeps: deps,
          turnId: 'turn-1',
          abortSignal: () => undefined,
          recentUserReplies: [],
          triggerParentMessageId: null,
        });

        const providerPrompt = composeProviderPrompt(result, 'first-turn-mint');
        expect(providerPrompt).toContain('PRELOADED ENTITY CONTEXT');
        expect(providerPrompt.match(/PRELOADED ENTITY CONTEXT/g)).toHaveLength(1);
        expect(providerPrompt).toContain(userMessage);
        expect(providerPrompt).toContain(
          handler.buildPrompt(result.preparedPayload, {
            runId: run.agentic_session_id,
            provider: 'claude',
            logger: deps.logger,
            ...(result.startupPromptInput
              ? { loadedEntityContext: result.startupPromptInput.loadedEntityContext }
              : {}),
            startedPromptTypes: new Set(),
            recentUserReplies: [],
            triggerParentMessageId: null,
          }),
        );
        expect(result.preparedPayload).toBeDefined();
        expect(result.startupPromptTemplate).toEqual(authoritativeStartupResult().template);
        expect(result.consumedPreviousProviderSession).toBe(false);
      }
      expect(workflowAboutRead).toHaveBeenCalledTimes(1);
    } finally {
      workflowAboutRead.mockRestore();
    }

    expect(startupResolve).toHaveBeenCalledTimes(cases.length);
    const focalContextCalls = fetchImpl.mock.calls.filter(([url]) =>
      String(url).includes('/entities/TASK/task-1/context'),
    );
    expect(focalContextCalls).toHaveLength(0);
  });

  it('names the submission tools in the Run provider form for a Codex Run', async () => {
    const startupResolve = vi
      .fn<PromptTypeHandlerDeps['startupPromptInput']['resolve']>()
      .mockResolvedValue(startupResultWithContext('PRELOADED ENTITY CONTEXT'));
    const { deps } = makeRegisteredDeps(startupResolve);
    const handler = productionRegistry.get(LocalPromptType.Research);
    if (!handler) throw new Error('Missing registered handler: research');
    const run = makeSession({
      entity: { entityType: RunEntityType.Task, entityId: 'task-1' },
    });
    run.provider = 'codex';
    run.provider_session_id = '';

    const result = await resolvePrompt({
      handler,
      run,
      runState: createFirstTurnPromptRunState(),
      input: makeInput({
        promptType: LocalPromptType.Research,
        payload: { userMessage: 'Look into it.' },
      }),
      handlerDeps: deps,
      turnId: 'turn-1',
      abortSignal: () => undefined,
      recentUserReplies: [],
      triggerParentMessageId: null,
    });

    const providerPrompt = composeProviderPrompt(result, 'first-turn-mint');
    expect(providerPrompt).toContain('mcp__heyhey_submission_tools__<name>');
    expect(providerPrompt).not.toContain('mcp__heyhey-submission-tools__');
  });

  it('refreshes the registered Feature Sync prompt with mutated entity and graph Context on remint', async () => {
    const firstStartup = startupResultWithContext(
      'ENTITY BEFORE FEATURE-SYNC MUTATION\nGRAPH NODE BEFORE',
    );
    const secondStartup = startupResultWithContext(
      'ENTITY AFTER FEATURE-SYNC MUTATION\nGRAPH NODE AFTER',
    );
    const startupResolve = vi
      .fn<PromptTypeHandlerDeps['startupPromptInput']['resolve']>()
      .mockResolvedValueOnce(firstStartup)
      .mockResolvedValueOnce(secondStartup);
    const { deps } = makeRegisteredDeps(startupResolve);
    const handler = productionRegistry.get(LocalPromptType.FeatureSyncAnalyze);
    if (!handler) throw new Error('Missing registered Feature Sync handler.');
    const run = makeSession({
      entity: { entityType: RunEntityType.Task, entityId: 'task-1' },
    });
    const input = makeInput({
      promptType: LocalPromptType.FeatureSyncAnalyze,
      payload: { taskId: 'task-1', userMessage: '' },
    });

    const first = await resolvePrompt({
      handler,
      run,
      runState: makeRunState(),
      input,
      handlerDeps: deps,
      turnId: 'turn-1',
      abortSignal: () => undefined,
      recentUserReplies: [],
      triggerParentMessageId: null,
      providerSessionDecision: 'first-turn-mint',
    });
    const second = await resolvePrompt({
      handler,
      run,
      runState: makeRunState({
        isFirstTurn: false,
        currentPromptType: handler.promptType,
        startupPromptInput: first.startupPromptInput ?? null,
        startupPromptTemplate: first.startupPromptTemplate ?? null,
      }),
      input: makeInput({
        promptType: LocalPromptType.FeatureSyncAnalyze,
        payload: { taskId: 'task-1', userMessage: 'Continue after the mutation.' },
      }),
      handlerDeps: deps,
      turnId: 'turn-1',
      abortSignal: () => undefined,
      recentUserReplies: [],
      triggerParentMessageId: null,
      providerSessionDecision: 'agent-transition-mint',
      refreshStartupPromptInput: true,
    });

    expect(startupResolve).toHaveBeenCalledTimes(2);
    expect(startupResolve.mock.calls[1]?.[1]).toEqual({
      cachedTemplate: first.startupPromptTemplate,
    });
    const firstProviderPrompt = composeProviderPrompt(first, 'first-turn-mint');
    const secondProviderPrompt = composeProviderPrompt(second, 'agent-transition-mint');
    expect(firstProviderPrompt).toContain('ENTITY BEFORE FEATURE-SYNC MUTATION');
    expect(firstProviderPrompt).toContain('GRAPH NODE BEFORE');
    expect(firstProviderPrompt).not.toContain('ENTITY AFTER FEATURE-SYNC MUTATION');
    expect(firstProviderPrompt).not.toContain('GRAPH NODE AFTER');
    expect(secondProviderPrompt).toContain('ENTITY AFTER FEATURE-SYNC MUTATION');
    expect(secondProviderPrompt).toContain('GRAPH NODE AFTER');
    expect(secondProviderPrompt).not.toContain('ENTITY BEFORE FEATURE-SYNC MUTATION');
    expect(secondProviderPrompt).not.toContain('GRAPH NODE BEFORE');
  });
});

// ---------------------------------------------------------------------------
// Branch 2 — Follow-up with same handler
// ---------------------------------------------------------------------------

describe('resolvePrompt — follow-up with same handler', () => {
  const PROMPT_TYPE = 'resolve_prompt_test_followup_same';

  it('prefers a launchable handler payload.userMessage as the provider prompt', async () => {
    const buildPrompt = vi.fn(() => 'SYSTEM');
    registerHandler(PROMPT_TYPE, { buildPrompt, addUserMessage: defaultAddUserMessage });

    const result = await callResolve({
      runState: makeRunState({ isFirstTurn: false, currentPromptType: PROMPT_TYPE }),
      input: makeInput({
        promptType: PROMPT_TYPE,
        payload: { userMessage: 'my reply' },
      }),
    });

    expectResolvedPromptBody(result, 'my reply');
    expect(result.promptTypeChanged).toBe(false);
    expect(buildPrompt).not.toHaveBeenCalled();
  });

  it('uses payload.userMessage for a non-launchable handler', async () => {
    registerHandler(`${PROMPT_TYPE}_input_prompt`, {
      buildPrompt: () => 'SYSTEM',
    });

    const result = await callResolve({
      runState: makeRunState({
        isFirstTurn: false,
        currentPromptType: `${PROMPT_TYPE}_input_prompt`,
      }),
      input: makeInput({
        promptType: `${PROMPT_TYPE}_input_prompt`,
        userMessage: 'raw follow-up',
      }),
    });

    expectResolvedPromptBody(result, 'raw follow-up');
  });

  it('rebuilds the handler system prompt when there is no user text but a payload is provided', async () => {
    const prepare = vi.fn().mockResolvedValue({ payload: { x: 1 } });
    registerHandler(`${PROMPT_TYPE}_rebuild`, {
      buildPrompt: () => 'REBUILT',
      prepare,
    });

    const result = await callResolve({
      run: makeSession({ serviceId: 'svc-1' }),
      runState: makeRunState({
        isFirstTurn: false,
        currentPromptType: `${PROMPT_TYPE}_rebuild`,
      }),
      input: makeInput({
        promptType: `${PROMPT_TYPE}_rebuild`,
        payload: { something: true },
      }),
    });

    expect(prepare).toHaveBeenCalledOnce();
    expectResolvedPromptBody(result, 'REBUILT');
  });
});

// ---------------------------------------------------------------------------
// coding_freeform — follow-up after the first turn dispatched by createRun
// ---------------------------------------------------------------------------

describe('resolvePrompt — coding_freeform follow-up after createRun first turn', () => {
  it('routes a follow-up user_message envelope through the same-handler branch instead of rebuilding the system prompt', async () => {
    registerHandler('coding_freeform', {
      buildPrompt: () => 'unused',
      addUserMessage: defaultAddUserMessage,
    });
    // After createRun drives the handler's first turn, the next inbound
    // user_message envelope for the same session arrives with
    // isFirstTurn=false (the Run has a provider session) and the same
    // promptType as the persisted prior turn. The resolver must take the
    // simple userMessage branch — not the rebuild branch — so the follow-up
    // streams as a plain user turn and does not re-seed the coding_freeform
    // system prompt. Asserted by checking the resolved prompt is exactly the
    // userMessage (no system-prompt prelude, no `USER_MESSAGE_PREAMBLE`).
    const result = await callResolve({
      run: makeSession({ serviceId: 'svc-1', promptType: 'coding_freeform' }),
      runState: makeRunState({
        isFirstTurn: false,
        currentPromptType: 'coding_freeform',
      }),
      input: makeInput({
        promptType: 'coding_freeform',
        payload: { userMessage: 'follow up please' },
      }),
    });

    expect(result.promptTypeChanged).toBe(false);
    expectResolvedPromptBody(result, 'follow up please');
    expect(result.resolvedPrompt).not.toContain('The user has sent the following message');
  });
});

describe('resolvePrompt — evidence-backed same-handler follow-up', () => {
  it('rebuilds a handler prompt before appending a same-handler user message when requested', async () => {
    const prepare = vi.fn().mockResolvedValue({
      payload: { userMessage: 'what should I focus on next?' },
      sessionContext: { attentionFetchedAt: '2026-04-26T01:00:00.000Z' },
    });
    const buildPrompt = vi.fn(() => 'COACH_CONTEXT');
    registerHandler('daily_session_coach', {
      buildPrompt,
      prepare,
      rebuildPromptOnUserMessage: true,
      addUserMessage: defaultAddUserMessage,
    });

    const result = await callResolve({
      run: makeSession({ serviceId: 'svc-1', promptType: 'daily_session_coach' }),
      runState: makeRunState({
        isFirstTurn: false,
        currentPromptType: 'daily_session_coach',
      }),
      input: makeInput({
        promptType: 'daily_session_coach',
        payload: { userMessage: 'what should I focus on next?' },
      }),
    });

    expect(prepare).toHaveBeenCalledOnce();
    expect(buildPrompt).toHaveBeenCalledOnce();
    expect(result.resolvedPrompt).toContain('COACH_CONTEXT');
    expect(result.resolvedPrompt).toContain('what should I focus on next?');
    expect(result.resolvedPrompt).toContain('The user has sent the following message');
    expect(result.sessionContext).toEqual({
      attentionFetchedAt: '2026-04-26T01:00:00.000Z',
    });
  });
});

// ---------------------------------------------------------------------------
// Branch 3 — Follow-up with handler swap
// ---------------------------------------------------------------------------

describe('resolvePrompt — follow-up with handler swap', () => {
  it('rebuilds the new handler system prompt and prepends it to the userMessage', async () => {
    const previous = 'resolve_prompt_test_swap_prev';
    const next = 'resolve_prompt_test_swap_next';
    registerHandler(previous, { buildPrompt: () => 'PREV_SYSTEM' });
    // Real handlers spread the wire payload through `prepare`, so `userMessage`
    // survives onto the prepared payload the resolver reads for injection.
    const prepare = vi.fn().mockResolvedValue({
      payload: { ok: true, userMessage: 'reply after swap' },
      sessionContext: { swapped: true },
    });
    registerHandler(next, {
      buildPrompt: () => 'NEXT_SYSTEM',
      prepare,
      buildStartingMessage: () => 'starting swap',
      addUserMessage: defaultAddUserMessage,
    });

    const result = await callResolve({
      run: makeSession({ serviceId: 'svc-1' }),
      runState: makeRunState({
        isFirstTurn: false,
        currentPromptType: previous,
      }),
      input: makeInput({
        promptType: next,
        payload: { userMessage: 'reply after swap' },
      }),
    });

    expect(prepare).toHaveBeenCalledOnce();
    expect(result.promptTypeChanged).toBe(true);
    expect(result.resolvedPrompt).toContain('NEXT_SYSTEM');
    expect(result.resolvedPrompt).toContain('reply after swap');
    expect(result.resolvedPrompt).toContain('The user has sent the following message');
    expect(result.sessionContext).toEqual({ swapped: true });
    expect(result.startingMessage).toBe('starting swap');
  });

  it('returns the new system prompt alone when no userMessage is supplied', async () => {
    const previous = 'resolve_prompt_test_swap_no_user_prev';
    const next = 'resolve_prompt_test_swap_no_user_next';
    registerHandler(previous, { buildPrompt: () => 'PREV' });
    registerHandler(next, { buildPrompt: () => 'NEXT_SYSTEM' });

    const result = await callResolve({
      run: makeSession({ serviceId: 'svc-1' }),
      runState: makeRunState({
        isFirstTurn: false,
        currentPromptType: previous,
      }),
      input: makeInput({
        promptType: next,
        payload: {},
      }),
    });

    expect(result.promptTypeChanged).toBe(true);
    expectResolvedPromptBody(result, 'NEXT_SYSTEM');
  });
});

// ---------------------------------------------------------------------------
// Branch 5 — Subagent-owned promptType
// ---------------------------------------------------------------------------

describe('resolvePrompt — subagent-owned promptType', () => {
  it('returns resolvedPrompt=null for a handler.runnerKind="subagent" first turn but still calls prepare and collects startingMessage', async () => {
    const prepare = vi.fn().mockResolvedValue({
      payload: { prepared: true },
      sessionContext: { sub: true },
    });
    const buildPrompt = vi.fn(() => 'SHOULD_NOT_APPEAR');
    registerHandler('commit', {
      runnerKind: 'subagent',
      buildPrompt,
      prepare,
      buildStartingMessage: () => 'committing',
    });

    const result = await callResolve({
      runState: makeRunState({ isFirstTurn: true }),
      input: makeInput({
        promptType: 'commit',
        payload: { anything: true },
      }),
    });

    expect(result.isSubagentOwned).toBe(true);
    expect(result.resolvedPrompt).toBeNull();
    expect(prepare).toHaveBeenCalledOnce();
    expect(buildPrompt).not.toHaveBeenCalled();
    expect(result.preparedPayload).toEqual({ prepared: true });
    expect(result.sessionContext).toEqual({ sub: true });
    expect(result.startingMessage).toBe('committing');
  });

  it('returns resolvedPrompt=null when a follow-up handler swap lands on a subagent handler', async () => {
    registerHandler('resolve_prompt_test_sub_prev', {
      buildPrompt: () => 'PREV',
    });
    registerHandler('code_review', {
      runnerKind: 'subagent',
      buildPrompt: () => 'SHOULD_NOT_APPEAR',
      buildStartingMessage: () => 'reviewing',
    });

    const result = await callResolve({
      runState: makeRunState({
        isFirstTurn: false,
        currentPromptType: 'resolve_prompt_test_sub_prev',
      }),
      input: makeInput({
        promptType: 'code_review',
        payload: { userMessage: 'please review' },
      }),
    });

    expect(result.isSubagentOwned).toBe(true);
    expect(result.resolvedPrompt).toBeNull();
    expect(result.promptTypeChanged).toBe(true);
    expect(result.startingMessage).toBe('reviewing');
  });
});

// ---------------------------------------------------------------------------
// transformInput × userMessage interaction matrix
// ---------------------------------------------------------------------------

describe('resolvePrompt — transformInput × userMessage matrix', () => {
  const PROMPT_TYPE = 'resolve_prompt_test_transform';

  it('applies transformInput to the resolved prompt on follow-ups', async () => {
    registerHandler(PROMPT_TYPE, {
      buildPrompt: () => 'SYSTEM',
      transformInput: (raw) => `transformed:${raw}`,
    });

    const result = await callResolve({
      runState: makeRunState({
        isFirstTurn: false,
        currentPromptType: PROMPT_TYPE,
      }),
      input: makeInput({
        promptType: PROMPT_TYPE,
        userMessage: '{"content": "the human-readable copy"}',
      }),
    });

    expectResolvedPromptBody(result, 'transformed:{"content": "the human-readable copy"}');
  });

  it('falls back to the resolved prompt when transformInput fires but the input is not JSON', async () => {
    const type = `${PROMPT_TYPE}_nonjson`;
    registerHandler(type, {
      buildPrompt: () => 'SYSTEM',
      transformInput: () => 'TRANSFORMED',
    });

    const result = await callResolve({
      runState: makeRunState({ isFirstTurn: false, currentPromptType: type }),
      input: makeInput({ promptType: type, userMessage: 'not json' }),
    });

    expectResolvedPromptBody(result, 'TRANSFORMED');
  });
});

// `workflow-defined` is resolved at the message-service edge now — the
// resolver never sees the sentinel. Edge-resolution coverage lives in the
// message-service test suite instead.

// ---------------------------------------------------------------------------
// Coding-freeform handler swap closes the empty-prompt re-grounding hole
// ---------------------------------------------------------------------------

describe('resolvePrompt — coding_freeform follow-up after startup_session', () => {
  it('rebuilds a non-empty system prompt with the USER_MESSAGE_PREAMBLE and reports promptTypeChanged when a coding-session follow-up swaps in', async () => {
    const { codingFreeformHandler } = await import('../agents/coding-conversation');
    registerHandler(
      'coding_freeform',
      codingFreeformHandler as unknown as PromptTypeHandler<unknown>,
    );
    const result = await callResolve({
      run: makeSession({ serviceId: 'svc-1', promptType: 'startup_session' }),
      runState: makeRunState({
        isFirstTurn: false,
        currentPromptType: 'startup_session',
      }),
      input: makeInput({
        promptType: 'coding_freeform',
        payload: { userMessage: 'one more thing — what changed in the dispatcher?' },
      }),
    });

    expect(result.promptTypeChanged).toBe(true);
    expect(result.isSubagentOwned).toBe(false);
    expect(typeof result.resolvedPrompt).toBe('string');
    const resolvedPrompt = result.resolvedPrompt ?? '';
    expect(resolvedPrompt.length).toBeGreaterThan(0);
    expect(resolvedPrompt).toContain('coding session');
    expect(resolvedPrompt).toContain('The user has sent the following message');
    expect(resolvedPrompt).toContain('one more thing — what changed in the dispatcher?');
  });
});

// ---------------------------------------------------------------------------
// previousProviderSession prepend — provider_session vs subagent vs absent
// ---------------------------------------------------------------------------

describe('resolvePrompt — previousProviderSession prepend', () => {
  const PROMPT_TYPE = 'resolve_prompt_test_prior_turn';

  it('prepends prior turn output for a provider_session follow-up and reports consumedPreviousProviderSession=true', async () => {
    registerHandler(PROMPT_TYPE, {
      buildPrompt: () => 'SYSTEM',
    });

    const result = await callResolve({
      runState: makeRunState({
        isFirstTurn: false,
        currentPromptType: PROMPT_TYPE,
        previousProviderSession: {
          promptType: 'startup_session',
          lastMessage: '## Prior Plan\n\n- Step 1',
          completedAt: '2026-04-26T01:00:00.000Z',
        },
      }),
      input: makeInput({
        promptType: PROMPT_TYPE,
        userMessage: 'follow-up message',
      }),
    });

    expect(result.consumedPreviousProviderSession).toBe(true);
    const resolved = result.resolvedPrompt ?? '';
    expect(resolved).toContain('## Previous phase (startup_session)');
    expect(resolved).toContain('## Prior Plan');
    expect(resolved).toContain('---');
    expect(stripMentionReminder(resolved)?.endsWith('follow-up message')).toBe(true);
  });

  it('returns consumedPreviousProviderSession=false for subagent-owned promptTypes even when a summary is recorded', async () => {
    registerHandler('commit', {
      runnerKind: 'subagent',
      buildPrompt: () => 'SHOULD_NOT_APPEAR',
    });

    const result = await callResolve({
      runState: makeRunState({
        isFirstTurn: true,
        previousProviderSession: {
          promptType: 'startup_session',
          lastMessage: '## Prior Plan',
          completedAt: '2026-04-26T01:00:00.000Z',
        },
      }),
      input: makeInput({
        promptType: 'commit',
        payload: { userMessage: 'commit it' },
      }),
    });

    expect(result.isSubagentOwned).toBe(true);
    expect(result.consumedPreviousProviderSession).toBe(false);
    expect(result.resolvedPrompt).toBeNull();
  });

  it('does nothing when runState.previousProviderSession is null', async () => {
    registerHandler(`${PROMPT_TYPE}_no_prior`, {
      buildPrompt: () => 'SYSTEM',
    });

    const result = await callResolve({
      runState: makeRunState({
        isFirstTurn: false,
        currentPromptType: `${PROMPT_TYPE}_no_prior`,
        previousProviderSession: null,
      }),
      input: makeInput({
        promptType: `${PROMPT_TYPE}_no_prior`,
        userMessage: 'follow-up',
      }),
    });

    expect(result.consumedPreviousProviderSession).toBe(false);
    expectResolvedPromptBody(result, 'follow-up');
  });
});

// ---------------------------------------------------------------------------
// recentUserReplies threading
// ---------------------------------------------------------------------------

describe('resolvePrompt — recentUserReplies threading', () => {
  it('forwards recentUserReplies to handler.buildPrompt and handler.prepare', async () => {
    const buildPrompt = vi.fn().mockReturnValue('SYSTEM');
    const prepare = vi.fn().mockResolvedValue({ payload: { userMessage: 'hi' } });
    const promptType = 'resolve_prompt_test_recent_replies';
    registerHandler(promptType, {
      buildPrompt,
      prepare,
    });

    const replies = [
      { messageId: 'u1', text: 'looks good', createdAt: '2026-04-21T10:00:00Z' },
      { messageId: 'u2', text: 'go ahead', createdAt: '2026-04-21T10:01:00Z' },
    ];

    await callResolve({
      input: makeInput({
        promptType,
        payload: { userMessage: 'hi' },
      }),
      recentUserReplies: replies,
    });

    expect(prepare).toHaveBeenCalledTimes(1);
    const prepareCtx = prepare.mock.calls[0]?.[3] as { recentUserReplies: unknown };
    expect(prepareCtx?.recentUserReplies).toEqual(replies);

    expect(buildPrompt).toHaveBeenCalledTimes(1);
    const buildPromptCtx = buildPrompt.mock.calls[0]?.[1] as { recentUserReplies: unknown };
    expect(buildPromptCtx?.recentUserReplies).toEqual(replies);
  });

  it('passes an empty recentUserReplies array when none are supplied', async () => {
    const buildPrompt = vi.fn().mockReturnValue('SYSTEM');
    const promptType = 'resolve_prompt_test_recent_replies_default';
    registerHandler(promptType, { buildPrompt });

    await callResolve({
      input: makeInput({ promptType, payload: { userMessage: 'hi' } }),
    });

    const buildPromptCtx = buildPrompt.mock.calls[0]?.[1] as { recentUserReplies: unknown[] };
    expect(buildPromptCtx?.recentUserReplies).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// reportChain prepend — empty / single / multi / subagent / + previousProviderSession
// ---------------------------------------------------------------------------

describe('resolvePrompt — reportChain prepend', () => {
  const PROMPT_TYPE = 'resolve_prompt_test_report_chain';

  it('does not inject a chain block when the chain is empty', async () => {
    registerHandler(`${PROMPT_TYPE}_empty`, { buildPrompt: () => 'SYSTEM' });

    const result = await callResolve({
      runState: makeRunState({
        isFirstTurn: false,
        currentPromptType: `${PROMPT_TYPE}_empty`,
        reportChain: [],
      }),
      input: makeInput({
        promptType: `${PROMPT_TYPE}_empty`,
        userMessage: 'follow-up',
      }),
    });

    expectResolvedPromptBody(result, 'follow-up');
    expect(result.resolvedPrompt).not.toContain('## Prior reports on this task');
  });

  it('renders a single chain entry with createdAt, phase, reportId, reportType, summary, and audience', async () => {
    registerHandler(`${PROMPT_TYPE}_single`, { buildPrompt: () => 'SYSTEM' });

    const entry = makeChainEntry({
      createdAt: '2026-04-26T01:00:00.000Z',
      phase: 'startup_session' as ReportChainEntry['phase'],
      reportId: 'rep-single',
      reportType: 'SESSION_SUMMARY' as ReportChainEntry['reportType'],
      summary: 'startup summary body',
      audience: 'EXTERNAL',
    });

    const result = await callResolve({
      runState: makeRunState({
        isFirstTurn: false,
        currentPromptType: `${PROMPT_TYPE}_single`,
        reportChain: [entry],
      }),
      input: makeInput({
        promptType: `${PROMPT_TYPE}_single`,
        userMessage: 'follow-up',
      }),
    });

    const resolved = result.resolvedPrompt ?? '';
    expect(resolved).toContain('## Prior reports on this task');
    expect(resolved).toContain('2026-04-26T01:00:00.000Z');
    expect(resolved).toContain('startup_session');
    expect(resolved).toContain('rep-single');
    expect(resolved).toContain('SESSION_SUMMARY');
    expect(resolved).toContain('startup summary body');
    expect(resolved).toContain('- audience: EXTERNAL');
    expect(stripMentionReminder(resolved)?.endsWith('follow-up')).toBe(true);
  });

  it('preserves insertion order for two entries from the same phase (A→A re-entry)', async () => {
    registerHandler(`${PROMPT_TYPE}_same_phase`, { buildPrompt: () => 'SYSTEM' });

    const first = makeChainEntry({
      reportId: 'rep-first',
      summary: 'first pass body',
      phase: 'startup_session' as ReportChainEntry['phase'],
      createdAt: '2026-04-26T01:00:00.000Z',
    });
    const second = makeChainEntry({
      reportId: 'rep-second',
      summary: 'second pass body',
      phase: 'startup_session' as ReportChainEntry['phase'],
      createdAt: '2026-04-26T03:00:00.000Z',
    });

    const result = await callResolve({
      runState: makeRunState({
        isFirstTurn: false,
        currentPromptType: `${PROMPT_TYPE}_same_phase`,
        reportChain: [first, second],
      }),
      input: makeInput({
        promptType: `${PROMPT_TYPE}_same_phase`,
        userMessage: 'next',
      }),
    });

    const resolved = result.resolvedPrompt ?? '';
    const firstIdx = resolved.indexOf('rep-first');
    const secondIdx = resolved.indexOf('rep-second');
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(secondIdx).toBeGreaterThan(firstIdx);
    expect(resolved).toContain('first pass body');
    expect(resolved).toContain('second pass body');
  });

  it('does not inject the chain block for subagent-owned promptTypes even when the chain is non-empty', async () => {
    registerHandler('commit', {
      runnerKind: 'subagent',
      buildPrompt: () => 'SHOULD_NOT_APPEAR',
    });

    const result = await callResolve({
      runState: makeRunState({
        isFirstTurn: true,
        reportChain: [makeChainEntry({ reportId: 'rep-sub', summary: 'leaked?' })],
      }),
      input: makeInput({
        promptType: 'commit',
        payload: { userMessage: 'commit it' },
      }),
    });

    expect(result.isSubagentOwned).toBe(true);
    expect(result.resolvedPrompt).toBeNull();
  });

  it('renders the chain block above the previousProviderSession so the summary stays nearest the user message', async () => {
    registerHandler(`${PROMPT_TYPE}_with_summary`, { buildPrompt: () => 'SYSTEM' });

    const result = await callResolve({
      runState: makeRunState({
        isFirstTurn: false,
        currentPromptType: `${PROMPT_TYPE}_with_summary`,
        previousProviderSession: {
          promptType: 'startup_session',
          lastMessage: '## Prior Plan\n\n- Step 1',
          completedAt: '2026-04-26T05:00:00.000Z',
        },
        reportChain: [
          makeChainEntry({
            reportId: 'rep-chain',
            summary: 'chain entry body',
            createdAt: '2026-04-26T04:00:00.000Z',
          }),
        ],
      }),
      input: makeInput({
        promptType: `${PROMPT_TYPE}_with_summary`,
        userMessage: 'follow-up message',
      }),
    });

    const resolved = result.resolvedPrompt ?? '';
    const chainIdx = resolved.indexOf('## Prior reports on this task');
    const summaryIdx = resolved.indexOf('## Previous phase (startup_session)');
    const userIdx = resolved.indexOf('follow-up message');

    expect(chainIdx).toBeGreaterThanOrEqual(0);
    expect(summaryIdx).toBeGreaterThan(chainIdx);
    expect(userIdx).toBeGreaterThan(summaryIdx);
    expect(result.consumedPreviousProviderSession).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// memo block prepend — empty / single / multi / ordering / subagent / never-consumed
// ---------------------------------------------------------------------------

describe('resolvePrompt — memo block prepend', () => {
  const PROMPT_TYPE = 'resolve_prompt_test_memos';

  it('does not inject a memo block when there are no memos', async () => {
    registerHandler(`${PROMPT_TYPE}_empty`, { buildPrompt: () => 'SYSTEM' });

    const result = await callResolve({
      runState: makeRunState({
        isFirstTurn: false,
        currentPromptType: `${PROMPT_TYPE}_empty`,
        memos: [],
      }),
      input: makeInput({ promptType: `${PROMPT_TYPE}_empty`, userMessage: 'follow-up' }),
      providerSessionDecision: 'resume',
    });

    expect(result.resolvedPrompt).toContain('follow-up');
    expect(result.resolvedPrompt).not.toContain('## Context from prior phases');
  });

  it('renders one sub-section per memo labelled by source, in order', async () => {
    registerHandler(`${PROMPT_TYPE}_multi`, {
      buildPrompt: () => 'SYSTEM',
      buildPromptSegments: () => ({
        stableInstructions: 'STABLE',
        dynamicContext: 'DYNAMIC',
      }),
      addUserMessage: defaultAddUserMessage,
    });

    const result = await callResolve({
      runState: makeRunState({
        isFirstTurn: true,
        memos: [
          {
            source: 'project_assistant',
            content: 'frame body one',
            writtenAt: '2026-04-26T01:00:00.000Z',
          },
          {
            source: 'coding_freeform',
            content: 'frame body two',
            writtenAt: '2026-04-26T02:00:00.000Z',
          },
        ],
      }),
      input: makeInput({ promptType: `${PROMPT_TYPE}_multi`, userMessage: 'follow-up' }),
      providerSessionDecision: 'first-turn-mint',
    });

    const resolved = result.resolvedPrompt ?? '';
    expect(resolved).toContain('## Context from prior phases');
    const firstIdx = resolved.indexOf('### project_assistant');
    const secondIdx = resolved.indexOf('### coding_freeform');
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(secondIdx).toBeGreaterThan(firstIdx);
    expect(resolved).toContain('frame body one');
    expect(resolved).toContain('frame body two');
    // The memo block prepends above the user prompt (a trailing mention
    // reminder may follow the prompt, so assert position, not suffix).
    expect(resolved.indexOf('## Context from prior phases')).toBeLessThan(
      resolved.indexOf('follow-up'),
    );
    expect(result.providerSessionStartupSegments?.dynamicContext).toContain(
      '## Context from prior phases',
    );
    expect(result.providerSessionStartupSegments?.dynamicContext).toContain('DYNAMIC');
  });

  it('renders memos after previousProviderSession and before the report chain', async () => {
    registerHandler(`${PROMPT_TYPE}_order`, {
      buildPrompt: () => 'SYSTEM',
      addUserMessage: defaultAddUserMessage,
    });

    const result = await callResolve({
      runState: makeRunState({
        isFirstTurn: false,
        currentPromptType: `${PROMPT_TYPE}_order`,
        previousProviderSession: {
          promptType: 'startup_session',
          lastMessage: '## Prior Plan',
          completedAt: '2026-04-26T05:00:00.000Z',
        },
        reportChain: [makeChainEntry({ reportId: 'rep-order', summary: 'chain body' })],
        memos: [
          {
            source: 'project_assistant',
            content: 'memo body',
            writtenAt: '2026-04-26T01:00:00.000Z',
          },
        ],
      }),
      input: makeInput({ promptType: `${PROMPT_TYPE}_order`, userMessage: 'follow-up message' }),
      providerSessionDecision: 'agent-transition-mint',
    });

    const resolved = result.resolvedPrompt ?? '';
    const chainIdx = resolved.indexOf('## Prior reports on this task');
    const memoIdx = resolved.indexOf('## Context from prior phases');
    const summaryIdx = resolved.indexOf('## Previous phase (startup_session)');
    const userIdx = resolved.indexOf('follow-up message');

    // Prepend order is report chain (outermost) → memos → previousProviderSession → prompt.
    expect(chainIdx).toBeGreaterThanOrEqual(0);
    expect(memoIdx).toBeGreaterThan(chainIdx);
    expect(summaryIdx).toBeGreaterThan(memoIdx);
    expect(userIdx).toBeGreaterThan(summaryIdx);
  });

  it('does not inject the memo block for subagent-owned promptTypes', async () => {
    registerHandler('commit', {
      runnerKind: 'subagent',
      buildPrompt: () => 'SHOULD_NOT_APPEAR',
    });

    const result = await callResolve({
      runState: makeRunState({
        isFirstTurn: true,
        memos: [
          {
            source: 'project_assistant',
            content: 'leaked?',
            writtenAt: '2026-04-26T01:00:00.000Z',
          },
        ],
      }),
      input: makeInput({ promptType: 'commit', payload: { userMessage: 'commit it' } }),
      providerSessionDecision: 'first-turn-mint',
    });

    expect(result.isSubagentOwned).toBe(true);
    expect(result.resolvedPrompt).toBeNull();
  });

  it('never reports memos as consumed — the result carries no consume signal for them', async () => {
    registerHandler(`${PROMPT_TYPE}_never_consumed`, { buildPrompt: () => 'SYSTEM' });

    const result = await callResolve({
      runState: makeRunState({
        isFirstTurn: false,
        currentPromptType: `${PROMPT_TYPE}_never_consumed`,
        memos: [
          {
            source: 'project_assistant',
            content: 'memo body',
            writtenAt: '2026-04-26T01:00:00.000Z',
          },
        ],
      }),
      input: makeInput({ promptType: `${PROMPT_TYPE}_never_consumed`, userMessage: 'follow-up' }),
      providerSessionDecision: 'agent-transition-mint',
    });

    // The ResolvePromptResult has no consumedMemos field — memos are read
    // without being cleared. Assert the block rendered and the only consume
    // signal (previousProviderSession) is false.
    expect(result.resolvedPrompt).toContain('## Context from prior phases');
    expect(result.consumedPreviousProviderSession).toBe(false);
  });

  it('omits retained memos when resuming the same provider context', async () => {
    registerHandler(`${PROMPT_TYPE}_resume`, { buildPrompt: () => 'SYSTEM' });

    const result = await callResolve({
      runState: makeRunState({
        isFirstTurn: false,
        currentPromptType: `${PROMPT_TYPE}_resume`,
        memos: [
          {
            source: 'project_assistant',
            content: 'already delivered memo',
            writtenAt: '2026-04-26T01:00:00.000Z',
          },
        ],
      }),
      input: makeInput({ promptType: `${PROMPT_TYPE}_resume`, userMessage: 'follow-up' }),
      providerSessionDecision: 'resume',
    });

    expect(result.resolvedPrompt).toContain('follow-up');
    expect(result.resolvedPrompt).not.toContain('## Context from prior phases');
    expect(result.resolvedPrompt).not.toContain('already delivered memo');
  });
});

describe('passive screen annotations on ordinary session comments', () => {
  it('restores all reviewers annotations from persisted history when the user continues, without requesting another run', async () => {
    const handler = registerHandler('annotation-follow-up', {
      buildPrompt: () => 'Respond to the user.',
      addUserMessage: defaultAddUserMessage,
    });
    const deps = makeHandlerDeps();
    const fetchHistory = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({
          data: {
            messages: [
              {
                type: 'USER',
                userId: 'reviewer-2',
                data: {
                  comment: 'Screen annotation: Increase contrast',
                  proposalReviewNote: {
                    proposalId: 'screen-proposal',
                    review: {
                      noteId: 'note-1',
                      frozenRevision: 4,
                      sectionKey: 'mockup',
                      sizeKey: 'desktop',
                      target: { type: 'component', componentId: 'pay-button' },
                      note: 'Increase contrast',
                    },
                  },
                },
              },
            ],
            nextCursor: 'older',
          },
        }),
      )
      .mockResolvedValueOnce(Response.json({ data: { messages: [], nextCursor: 'older' } }))
      .mockResolvedValueOnce(
        Response.json({
          data: {
            messages: [
              {
                type: 'USER',
                userId: 'reviewer-2',
                data: {
                  proposalReviewNote: {
                    proposalId: 'screen-proposal',
                    review: {
                      noteId: 'note-1',
                      frozenRevision: 4,
                      sectionKey: 'mockup',
                      sizeKey: 'desktop',
                      target: { type: 'component', componentId: 'pay-button' },
                      note: 'Increase contrast',
                    },
                  },
                },
              },
            ],
          },
        }),
      );
    deps.fetchImpl = fetchHistory;
    const result = await callResolve({
      handler,
      handlerDeps: deps,
      input: makeInput({
        promptType: 'annotation-follow-up',
        userMessage: 'Please revise the journey using my annotations.',
      }),
    });
    expect(result.resolvedPrompt).toContain('Please revise the journey using my annotations.');
    expect(result.resolvedPrompt).toContain('"authorId":"reviewer-2"');
    expect(result.resolvedPrompt).toContain('"componentId":"pay-button"');
    expect(result.resolvedPrompt).toContain('"frozenRevision":4');
    expect(fetchHistory).toHaveBeenCalledTimes(2);
    expect(String(fetchHistory.mock.calls[1]?.[0])).toContain('historyCursor=older');
    expect(
      fetchHistory.mock.calls.every(([, init]) => !init?.method || init.method === 'GET'),
    ).toBe(true);
  });
});
