/** @vitest-environment node */

import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TEST_ADMITTED_HOST_ACTION } from '../controller-authorization/admitted-host-action.test-support';

vi.mock('../../agents/providers/session-runner-config', () => ({
  loadAgentSessionRunnerConfig: vi.fn(),
  resolveAgentInvocationConfigPath: vi.fn(() => '/tmp/agent-invocation.json'),
}));

import { LocalAgentService } from '../local-agent-service';
import {
  createTestRunRegistryWiring,
  LOCAL_AGENT_SERVICE_TEST_DEPENDENCIES,
} from './helpers/test-run-registry';
import { loadAgentSessionRunnerConfig } from '../../agents/providers/session-runner-config';
import { buildMcpServerConfig } from '../../agents/mcp-server-config';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type { RunCreatePayloadRunEval } from '../../shared/agent-bridge-contract/generated/api';
import type { AgentSessionConfig } from '../../shared/agent-bridge-contract/generated/api';
import type {
  AgenticSession,
  AgenticSessionContextMetadata,
  AgenticSessionEvent,
  CreateAgenticSessionInput,
} from '../../session/index';
import type { AgentSessionRunner } from '../../agents/providers/session-runner';
import type { LocalCreateRunRequest } from '../../shared/agent-bridge-contract/contract';
import type { PromptTypeHandlerDeps } from '../../agents/prompt-type-handler';
import { createPromptTypeHandlerTestDeps } from '../../agents/prompt-type-handler.test-support';
import { createTestRepoMappingStore, createTestRunStore } from '../../run/run.test-support';
import { createTestOAuthClient } from './helpers/test-oauth-client';
import { ProjectModeBundleMaterializer } from '../../agents/project-mode';
import { SETTLED_CATALOG_AVAILABILITY } from '../../test-support/capability-catalog';

const createSessionContextMetadata = (): AgenticSessionContextMetadata =>
  ({
    capturedAt: new Date('2026-04-18T00:00:00.000Z').toISOString(),
    organizationId: 'org-1',
    projectId: 'project-1',
    agentSessionId: 'agent-session-1',
    userComments: [],
    fileReferences: { resolved: [], unresolved: [] },
  }) as unknown as AgenticSessionContextMetadata;

const buildCreateRunInput = (
  overrides: Partial<LocalCreateRunRequest> = {},
): LocalCreateRunRequest =>
  ({
    attachments: [],
    context: { projectId: 'project-1' },
    contextMetadata: createSessionContextMetadata(),
    conversationId: 'conv-1',
    ...overrides,
  }) as LocalCreateRunRequest;

const EVAL_ENTITY = {
  entityType: 'TASK' as const,
  entityId: '11111111-1111-4111-8111-111111111111',
};

const PROJECT_ASSISTANT_DISABLED_CONFIG = {
  type: 'CODING_SESSION' as const,
  version: 'v2' as const,
  model: 'test-model',
  projectAssistant: { enabled: false },
};

const PROJECT_MODE_ID = '33333333-3333-4333-8333-333333333333';
const PROJECT_MODE_CONFIG: AgentSessionConfig = {
  type: 'CODING_SESSION',
  version: 'v2',
  model: 'test-model',
  projectAssistant: { enabled: false },
  projectModeSelection: {
    schemaVersion: 'project-mode-selection.v1',
    modeId: PROJECT_MODE_ID,
  },
  projectModeSnapshot: {
    schemaVersion: 'project-mode-snapshot.v2',
    modeId: PROJECT_MODE_ID,
    catalogDescription: 'A captured project mode.',
    applicableWorkItemTypeKeys: ['STANDARD'],
    files: {
      schemaVersion: 'project-mode-files.v1',
      files: {
        'MODE.md': 'Use the captured instructions.',
        'references/checklist.md': 'Read supporting evidence on demand.',
      },
    },
    projectAssistant: { enabled: true },
    snapshotHash: 'b'.repeat(64),
  },
};

const buildProjectModePayload = (): NonNullable<LocalCreateRunRequest['payload']> => ({
  promptType: LocalPromptType.ProjectMode,
  entity: EVAL_ENTITY,
  userMessage: 'Run the selected project mode.',
});

const buildRunEvalPayload = (
  deprecatedTaskType?: string,
): NonNullable<LocalCreateRunRequest['payload']> =>
  ({
    entity: EVAL_ENTITY,
    promptType: LocalPromptType.RunEval,
    ...(deprecatedTaskType
      ? {
          startupInput: {
            task: {
              title: 'Deprecated copied context',
              taskType: deprecatedTaskType,
              description: 'This value must not control admission.',
            },
            adjacentScopeTasks: [],
            evidenceItems: [],
          },
        }
      : {}),
    userMessage: 'Run the evaluation.',
  }) as unknown as RunCreatePayloadRunEval;

const createEvalHandlerDeps = (): PromptTypeHandlerDeps => {
  const handlerDeps = createPromptTypeHandlerTestDeps();
  vi.spyOn(handlerDeps.startupPromptInput, 'resolve').mockResolvedValue({
    startupInput: {
      task: {
        id: EVAL_ENTITY.entityId,
        taskType: 'EVAL',
        description: '',
      },
      focalEntity: EVAL_ENTITY,
      adjacentScopeTasks: [],
      evidenceItems: [],
    },
    renderedInput: 'Canonical EVAL context',
    loadedEntityContext: {
      kind: 'entity',
      focalEntity: EVAL_ENTITY,
      entity: { type: 'EVAL' } as never,
      context: { displayName: 'Canonical EVAL context' } as never,
    },
    provenance: {
      templateKey: 'task',
      ownershipSource: { scope: 'CANONICAL' },
      revisionId: 'revision-1',
      revisionNumber: 1,
    },
  });
  return handlerDeps;
};

const buildHarness = (handlerDeps?: PromptTypeHandlerDeps) => {
  const capturedCreateRunInputs: CreateAgenticSessionInput[] = [];
  const runs: AgenticSession[] = [];

  const runStore = createTestRunStore();
  const latestRun = (): AgenticSession => {
    const run = runs[runs.length - 1];
    if (!run) throw new Error('Expected a persisted test run.');
    return run;
  };
  vi.spyOn(runStore, 'initialize').mockResolvedValue({ migrated: false });
  vi.spyOn(runStore, 'createRun').mockImplementation(
    async (input: CreateAgenticSessionInput): Promise<AgenticSession> => {
      capturedCreateRunInputs.push(input);
      const launchServiceId = input.launchServiceId ?? input.services?.[0]?.id ?? 'svc-1';
      const created: AgenticSession = {
        entity: input.entity,
        agentic_session_id: input.agentic_session_id ?? `run-${String(runs.length + 1)}`,
        services:
          input.services && input.services.length > 0
            ? input.services
            : [{ id: launchServiceId, path: '/tmp/repo' }],
        launchServiceId,
        provider: input.provider,
        provider_session_id: input.provider_session_id,
        provider_conversation_id: input.provider_conversation_id ?? null,
        conversationId: input.conversationId,
        status: input.status ?? 'idle',
        projectAssistantDone: true,
        contextMetadata: input.contextMetadata,
        ...(input.config !== undefined ? { config: input.config } : {}),
        ...(input.fastMode !== undefined ? { fastMode: input.fastMode } : {}),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        events: [],
      };
      runs.push(created);
      return created;
    },
  );
  vi.spyOn(runStore, 'reindexRun').mockImplementation(async () => {});
  vi.spyOn(runStore, 'getRun').mockImplementation(
    async (runId: string) => runs.find((r) => r.agentic_session_id === runId) ?? null,
  );
  vi.spyOn(runStore, 'getRunWithEvents').mockImplementation(
    async (runId: string) => runs.find((r) => r.agentic_session_id === runId) ?? null,
  );
  vi.spyOn(runStore, 'listRuns').mockImplementation(async () => runs);
  vi.spyOn(runStore, 'addTouchedFiles').mockImplementation(async () => {});
  vi.spyOn(runStore, 'addToolUsage').mockImplementation(async () => {});
  vi.spyOn(runStore, 'updateRunSessionContext').mockImplementation(async () => latestRun());
  vi.spyOn(runStore, 'updateRunStatus').mockImplementation(async () => latestRun());
  vi.spyOn(runStore, 'updateRunProviderIdentity').mockImplementation(async () => latestRun());
  vi.spyOn(runStore, 'updateRunPromptType').mockImplementation(async () => latestRun());
  vi.spyOn(runStore, 'appendEvent').mockImplementation(
    async (_id, input) =>
      ({
        seq: 1,
        ts: new Date().toISOString(),
        app_session_id: 'cli-run-1',
        run_id: input.run_id,
        actor: input.actor,
        event_type: input.event_type,
        state_version: input.state_version,
        ...(input.payload !== undefined ? { payload: input.payload } : {}),
      }) satisfies AgenticSessionEvent,
  );
  vi.spyOn(runStore, 'getProviderPreference').mockResolvedValue(null);
  vi.spyOn(runStore, 'setProviderPreference').mockImplementation(async () => {});
  vi.spyOn(runStore, 'hasIdempotencyToken').mockResolvedValue(false);
  vi.spyOn(runStore, 'persistIdempotencyToken').mockImplementation(async () => {});
  vi.spyOn(runStore, 'lookupByAgentSessionId').mockReturnValue(null);
  vi.spyOn(runStore, 'lookupByProviderSessionId').mockReturnValue(null);
  vi.spyOn(runStore, 'lookupByCanonicalRunId').mockReturnValue(null);

  const runPromptMock = vi.fn<AgentSessionRunner['runPrompt']>(async () => ({
    providerSessionId: null,
    providerConversationId: null,
    errorCount: 0,
  }));
  const resumeSessionMock = vi.fn<AgentSessionRunner['resumeSession']>(async () => ({
    providerSessionId: null,
    providerConversationId: null,
    errorCount: 0,
  }));

  const oauthClient = createTestOAuthClient({
    getAccessToken: vi.fn(async () => ({ success: true as const, data: 'test-token' })),
  });
  const projectModeBundleMaterializer = new ProjectModeBundleMaterializer();

  const wiring = createTestRunRegistryWiring({
    runStore,
    sessionRunner: { runPrompt: runPromptMock, resumeSession: resumeSessionMock },
    oauthClient,
    projectModeBundleMaterializer,
    ...(handlerDeps ? { handlerDeps } : {}),
  });

  const localAgentService = new LocalAgentService({
    capabilityCatalog: SETTLED_CATALOG_AVAILABILITY,
    ...LOCAL_AGENT_SERVICE_TEST_DEPENDENCIES,
    runStore,
    repoStore: createTestRepoMappingStore(),
    runRegistry: wiring.runRegistry,
    promptTypeRegistry: wiring.promptTypeRegistry,
    workflowsApi: wiring.workflowsApi,
    messagesApi: wiring.messagesApi,
    projectModeBundleMaterializer,
  });

  return {
    localAgentService,
    runStore,
    capturedCreateRunInputs,
    poster: wiring.poster,
    runPromptMock,
    getActiveRun: (runId: string) => wiring.runRegistry.get(runId),
    runs,
    projectModeBundleMaterializer,
  };
};

describe('local-agent-service — createRun model/reasoningEffort resolution', () => {
  it('forwards caller-supplied model and reasoningEffort to the persisted session', async () => {
    vi.mocked(loadAgentSessionRunnerConfig).mockResolvedValue({
      sourcePath: '/tmp/cfg.json',
      model: 'runnerconfig-model',
      reasoningEffort: 'low',
      warnings: [],
    });

    const { localAgentService, capturedCreateRunInputs } = buildHarness();

    await localAgentService.createRun(
      buildCreateRunInput({
        model: 'claude-caller-override',
        reasoningEffort: 'medium',
      }),
    );

    expect(capturedCreateRunInputs).toHaveLength(1);
    expect(capturedCreateRunInputs[0]).toMatchObject({
      model: 'claude-caller-override',
      reasoningEffort: 'medium',
    });
  });

  it('falls back to runnerConfig — not the promptType handler — when caller omits model and reasoningEffort', async () => {
    vi.mocked(loadAgentSessionRunnerConfig).mockResolvedValue({
      sourcePath: '/tmp/cfg.json',
      model: 'runnerconfig-model',
      reasoningEffort: 'low',
      warnings: [],
    });

    const { localAgentService, capturedCreateRunInputs, runStore } = buildHarness();

    // task-refiner is registered with its own default model/reasoningEffort.
    // createRun must NOT consult those — the first turn is dispatched via the
    // conversation-event trigger, which arrives without a promptType, so any
    // handler-tuned defaults must come from the caller, not from createRun.
    await localAgentService.createRun(buildCreateRunInput({}));

    expect(capturedCreateRunInputs).toHaveLength(1);
    expect(capturedCreateRunInputs[0]).toMatchObject({
      model: 'runnerconfig-model',
      reasoningEffort: 'low',
    });
  });

  it('omits model and reasoningEffort entirely when neither caller nor runnerConfig supplies them', async () => {
    vi.mocked(loadAgentSessionRunnerConfig).mockResolvedValue({
      sourcePath: '/tmp/cfg.json',
      warnings: [],
    });

    const { localAgentService, capturedCreateRunInputs } = buildHarness();

    await localAgentService.createRun(buildCreateRunInput({}));

    expect(capturedCreateRunInputs).toHaveLength(1);
    const [persisted] = capturedCreateRunInputs;
    expect(persisted?.model).toBeUndefined();
    expect(persisted?.reasoningEffort).toBeUndefined();
  });

  it.each([
    ['codex', true],
    ['codex', false],
    ['claude', true],
    ['claude', false],
  ] as const)('persists %s fastMode=%s without defaulting', async (provider, fastMode) => {
    vi.mocked(loadAgentSessionRunnerConfig).mockResolvedValue({
      sourcePath: '/tmp/cfg.json',
      warnings: [],
    });
    const { localAgentService, capturedCreateRunInputs } = buildHarness();

    await localAgentService.createRun(
      buildCreateRunInput({
        context: { projectId: 'project-1', provider },
        fastMode,
      }),
    );

    expect(capturedCreateRunInputs[0]?.fastMode).toBe(fastMode);
  });

  it('rejects Fast mode for an OpenCode direct local create-run request', async () => {
    vi.mocked(loadAgentSessionRunnerConfig).mockResolvedValue({
      sourcePath: '/tmp/cfg.json',
      warnings: [],
    });
    const { localAgentService, capturedCreateRunInputs } = buildHarness();

    await expect(
      localAgentService.createRun(
        buildCreateRunInput({
          context: { projectId: 'project-1', provider: 'opencode' },
          fastMode: false,
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', statusCode: 400 });
    expect(capturedCreateRunInputs).toHaveLength(0);
  });

  it('rejects an invalid launch entity before loading runner configuration or creating a Run', async () => {
    vi.mocked(loadAgentSessionRunnerConfig).mockClear();
    const { localAgentService, capturedCreateRunInputs } = buildHarness();

    await expect(
      localAgentService.createRun(
        buildCreateRunInput({
          payload: {
            promptType: LocalPromptType.FreeForm,
          } as NonNullable<LocalCreateRunRequest['payload']>,
        }),
      ),
    ).rejects.toThrow(/requires payload\.entity/);

    expect(loadAgentSessionRunnerConfig).not.toHaveBeenCalled();
    expect(capturedCreateRunInputs).toHaveLength(0);
  });
});

describe('local-agent-service — createRun honors UI agentSessionId', () => {
  it('keys the local run on contextMetadata.agentSessionId and propagates it to the MCP header', async () => {
    vi.mocked(loadAgentSessionRunnerConfig).mockResolvedValue({
      sourcePath: '/tmp/cfg.json',
      warnings: [],
    });

    const uiAgentSessionId = 'ui-supplied-agent-session-7777';
    const { localAgentService, capturedCreateRunInputs, runStore } = buildHarness();

    const result = await localAgentService.createRun(
      buildCreateRunInput({
        contextMetadata: {
          capturedAt: new Date('2026-04-18T00:00:00.000Z').toISOString(),
          organizationId: 'org-1',
          projectId: 'project-1',
          agentSessionId: uiAgentSessionId,
          userComments: [],
          fileReferences: { resolved: [], unresolved: [] },
        } as unknown as AgenticSessionContextMetadata,
      }),
    );

    expect(result.status).toBe('started');
    if (result.status !== 'started') return;
    expect(result.run.agentic_session_id).toBe(uiAgentSessionId);

    expect(capturedCreateRunInputs).toHaveLength(1);
    expect(capturedCreateRunInputs[0]?.agentic_session_id).toBe(uiAgentSessionId);

    const lookup = await runStore.getRun(uiAgentSessionId);
    expect(lookup?.agentic_session_id).toBe(uiAgentSessionId);

    const mcpConfig = await buildMcpServerConfig(
      createTestOAuthClient({
        getAccessToken: async () => ({ success: true as const, data: 'test-token' }),
      }),
      {
        projectId: result.run.contextMetadata.projectId,
        conversationId: 'conv-1',
        serviceId: result.run.launchServiceId,
        agentSessionId: result.run.agentic_session_id,
      },
    );
    const headers = (mcpConfig.mcpServers['heyhey-platform'] as Record<string, unknown>)[
      'headers'
    ] as Record<string, string>;
    expect(headers['X-Agent-Session-ID']).toBe(uiAgentSessionId);
  });
});

describe('local-agent-service — createRun short-circuits on an existing run', () => {
  it('rejects an empty direct local monitor identity before a run is looked up or created', async () => {
    vi.mocked(loadAgentSessionRunnerConfig).mockResolvedValue({
      sourcePath: '/tmp/cfg.json',
      model: 'claude-sonnet-4-6',
      warnings: [],
    });

    const { localAgentService, capturedCreateRunInputs } = buildHarness();
    await expect(
      localAgentService.createRun(
        buildCreateRunInput({
          contextMetadata: {
            ...createSessionContextMetadata(),
            taskMonitorId: '',
          } as unknown as AgenticSessionContextMetadata,
        }),
      ),
    ).rejects.toThrow(/contextMetadata is malformed/i);

    expect(capturedCreateRunInputs).toHaveLength(0);
  });

  it('reuses the persisted run when createRun is called twice for the same agentSessionId', async () => {
    vi.mocked(loadAgentSessionRunnerConfig).mockResolvedValue({
      sourcePath: '/tmp/cfg.json',
      warnings: [],
    });

    const reusedAgentSessionId = 'agent-session-reused-4242';
    const { localAgentService, capturedCreateRunInputs, poster } = buildHarness();

    const buildReusedInput = (): LocalCreateRunRequest =>
      buildCreateRunInput({
        context: { projectId: 'project-1', provider: 'codex' },
        fastMode: false,
        contextMetadata: {
          capturedAt: new Date('2026-04-18T00:00:00.000Z').toISOString(),
          organizationId: 'org-1',
          projectId: 'project-1',
          agentSessionId: reusedAgentSessionId,
          userComments: [],
          fileReferences: { resolved: [], unresolved: [] },
        } as unknown as AgenticSessionContextMetadata,
        payload: {
          entity: {
            entityType: 'TASK',
            entityId: '11111111-1111-4111-8111-111111111111',
          },
          promptType: LocalPromptType.TaskRefiner,
          task: { title: 'My Task' },
        } as unknown as NonNullable<LocalCreateRunRequest['payload']>,
      });

    const first = await localAgentService.createRun(buildReusedInput());
    expect(first.status).toBe('started');
    if (first.status !== 'started') return;
    expect(first.run.agentic_session_id).toBe(reusedAgentSessionId);
    expect(capturedCreateRunInputs).toHaveLength(1);
    expect(capturedCreateRunInputs[0]?.fastMode).toBe(false);
    // First call posts no out-of-band message at turn-open: the SYSTEM
    // placeholder anchor is gone (every write now appends to the tail), and
    // refiners no longer self-greet at createRun — the conversation's greeting
    // comes from the API-seeded initialMessage.
    const postsAfterFirst = vi.mocked(poster.createOutOfBand).mock.calls.length;
    expect(postsAfterFirst).toBe(0);

    const second = await localAgentService.createRun(buildReusedInput());
    expect(second.status).toBe('started');
    if (second.status !== 'started') return;
    // The reused run is returned with the same canonical id...
    expect(second.run.agentic_session_id).toBe(reusedAgentSessionId);
    // ...startAgenticSession is not re-invoked...
    expect(capturedCreateRunInputs).toHaveLength(1);
    // ...and the short-circuit skips the first-turn dispatch, so no additional
    // out-of-band posts land.
    expect(vi.mocked(poster.createOutOfBand)).toHaveBeenCalledTimes(postsAfterFirst);

    const conflictingInput = buildReusedInput();
    conflictingInput.payload = {
      ...conflictingInput.payload!,
      entity: {
        entityType: 'TASK',
        entityId: '22222222-2222-4222-8222-222222222222',
      },
    } as NonNullable<LocalCreateRunRequest['payload']>;
    await expect(localAgentService.createRun(conflictingInput)).rejects.toThrow(/different entity/);
    expect(capturedCreateRunInputs).toHaveLength(1);
  });
});

describe('local-agent-service — createRun dispatches the handler first turn', () => {
  it('rejects absent or mismatched project-mode capture before Run persistence', async () => {
    const { localAgentService, capturedCreateRunInputs, runPromptMock } = buildHarness();

    await expect(
      localAgentService.createRun(
        buildCreateRunInput({
          payload: buildProjectModePayload(),
          config: null,
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', statusCode: 400 });

    await expect(
      localAgentService.createRun(
        buildCreateRunInput({
          payload: buildProjectModePayload(),
          config: {
            ...PROJECT_MODE_CONFIG,
            projectModeSelection: {
              schemaVersion: 'project-mode-selection.v1',
              modeId: '44444444-4444-4444-8444-444444444444',
            },
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', statusCode: 400 });

    await expect(
      localAgentService.createRun(
        buildCreateRunInput({
          payload: buildProjectModePayload(),
          config: {
            ...PROJECT_MODE_CONFIG,
            projectModeSnapshot: {
              ...PROJECT_MODE_CONFIG.projectModeSnapshot!,
              files: {
                schemaVersion: 'project-mode-files.v1',
                files: { 'MODE.md': 'safe', '../escape.md': 'unsafe' },
              },
            },
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', statusCode: 400 });

    expect(capturedCreateRunInputs).toHaveLength(0);
    expect(runPromptMock).not.toHaveBeenCalled();
  });

  it('admits matching captured project-mode data and persists the exact config', async () => {
    vi.mocked(loadAgentSessionRunnerConfig).mockResolvedValue({
      sourcePath: '/tmp/cfg.json',
      warnings: [],
    });
    const {
      localAgentService,
      capturedCreateRunInputs,
      runPromptMock,
      getActiveRun,
      projectModeBundleMaterializer,
    } = buildHarness();

    const result = await localAgentService.createRun(
      buildCreateRunInput({
        payload: buildProjectModePayload(),
        config: PROJECT_MODE_CONFIG,
      }),
    );

    expect(result.status).toBe('started');
    expect(capturedCreateRunInputs).toHaveLength(1);
    expect(capturedCreateRunInputs[0]?.config).toEqual(PROJECT_MODE_CONFIG);
    expect(runPromptMock).toHaveBeenCalledOnce();
    const providerInput = runPromptMock.mock.calls[0]?.[0];
    expect(providerInput?.prompt).toContain('Use the captured instructions.');
    const boundary = providerInput?.workspaceWriteBoundary;
    expect(boundary).toBeDefined();
    expect(boundary?.readOnlyDirectories).toHaveLength(1);
    const bundleDirectory = boundary!.readOnlyDirectories[0]!;
    expect(providerInput?.prompt).toContain(`Bundle location: ${bundleDirectory}`);
    expect(boundary?.allowedRepositoryRoots).not.toContain(bundleDirectory);
    await expect(
      fs.readFile(path.join(bundleDirectory, 'references/checklist.md'), 'utf8'),
    ).resolves.toBe('Read supporting evidence on demand.');
    getActiveRun('agent-session-1')?.cleanup();
    await projectModeBundleMaterializer.dispose();
  });

  it('persists a workflow kickoff focal entity without dispatching the kickoff as a Turn', async () => {
    vi.mocked(loadAgentSessionRunnerConfig).mockResolvedValue({
      sourcePath: '/tmp/cfg.json',
      warnings: [],
    });

    const focalEntity = {
      entityType: 'TASK' as const,
      entityId: '11111111-1111-4111-8111-111111111111',
    };
    const { localAgentService, runPromptMock, runs, capturedCreateRunInputs } = buildHarness();

    const result = await localAgentService.createRun(
      buildCreateRunInput({
        payload: {
          promptType: 'workflow_kickoff',
          entity: focalEntity,
          userMessage: 'Plan this task',
        },
      }),
    );

    expect(result.status).toBe('started');
    if (result.status !== 'started') return;
    expect(capturedCreateRunInputs[0]?.entity).toEqual(focalEntity);
    expect(runs[0]?.entity).toEqual(focalEntity);
    expect(runPromptMock).not.toHaveBeenCalled();
  });

  it('reuses the Agent Session Run when a later start-run selects another provider', async () => {
    vi.mocked(loadAgentSessionRunnerConfig).mockResolvedValue({
      sourcePath: '/tmp/cfg.json',
      warnings: [],
    });
    const { localAgentService, runPromptMock, capturedCreateRunInputs } = buildHarness();
    const first = await localAgentService.createRunFromTrigger(
      TEST_ADMITTED_HOST_ACTION,
      buildCreateRunInput({
        context: { projectId: 'project-1', provider: 'claude' },
        payload: { promptType: 'workflow_kickoff', entity: EVAL_ENTITY, userMessage: 'Research' },
      }),
    );
    const second = await localAgentService.createRunFromTrigger(
      TEST_ADMITTED_HOST_ACTION,
      buildCreateRunInput({
        context: { projectId: 'project-1', provider: 'codex' },
        model: 'gpt-6.1-sol',
        payload: { promptType: 'workflow_kickoff', entity: EVAL_ENTITY, userMessage: 'Implement' },
      }),
    );
    expect(capturedCreateRunInputs).toHaveLength(1);
    expect(capturedCreateRunInputs[0]?.agentic_session_id).toBe('agent-session-1');
    if (first.status !== 'started' || second.status !== 'started') throw new Error('not started');
    expect(second.run.agentic_session_id).toBe(first.run.agentic_session_id);
    expect(runPromptMock).not.toHaveBeenCalled();
  });

  it('keeps an explicitly unscoped workflow Run unscoped when a duplicate tries to add identity', async () => {
    vi.mocked(loadAgentSessionRunnerConfig).mockResolvedValue({
      sourcePath: '/tmp/cfg.json',
      warnings: [],
    });

    const { localAgentService, runs, capturedCreateRunInputs } = buildHarness();
    const unscoped = buildCreateRunInput({
      payload: {
        promptType: 'workflow_kickoff',
        userMessage: 'Plan generally',
      },
    });

    await localAgentService.createRun(unscoped);
    expect(runs[0]?.entity).toBeNull();

    await expect(
      localAgentService.createRun({
        ...unscoped,
        payload: {
          ...unscoped.payload,
          entity: {
            entityType: 'TASK',
            entityId: '11111111-1111-4111-8111-111111111111',
          },
        } as NonNullable<LocalCreateRunRequest['payload']>,
      }),
    ).rejects.toThrow(/different entity/);
    expect(capturedCreateRunInputs).toHaveLength(1);
    expect(runs[0]?.entity).toBeNull();
  });

  it('drives the handler first turn through sendMessage and awaits provider settlement before responding', async () => {
    vi.mocked(loadAgentSessionRunnerConfig).mockResolvedValue({
      sourcePath: '/tmp/cfg.json',
      warnings: [],
    });

    const canonicalProviderSessionId = 'provider-session-canonical-1';
    const dispatchedAgentSessionId = 'agent-session-dispatch-1';
    const { localAgentService, runPromptMock, getActiveRun, capturedCreateRunInputs } =
      buildHarness();

    runPromptMock.mockImplementation(async () => ({
      providerSessionId: canonicalProviderSessionId,
      providerConversationId: null,
      errorCount: 0,
    }));

    const result = await localAgentService.createRun(
      buildCreateRunInput({
        contextMetadata: {
          capturedAt: new Date('2026-04-18T00:00:00.000Z').toISOString(),
          organizationId: 'org-1',
          projectId: 'project-1',
          agentSessionId: dispatchedAgentSessionId,
          userComments: [],
          fileReferences: { resolved: [], unresolved: [] },
        } as unknown as AgenticSessionContextMetadata,
        config: PROJECT_ASSISTANT_DISABLED_CONFIG,
        payload: {
          entity: {
            entityType: 'TASK',
            entityId: '11111111-1111-4111-8111-111111111111',
          },
          promptType: LocalPromptType.TaskRefiner,
          task: { title: 'Refine this task' },
        } as unknown as NonNullable<LocalCreateRunRequest['payload']>,
      }),
    );

    expect(result.status).toBe('started');
    if (result.status !== 'started') return;

    expect(capturedCreateRunInputs[0]?.entity).toEqual({
      entityType: 'TASK',
      entityId: '11111111-1111-4111-8111-111111111111',
    });

    // The run service routed the handler's first turn through sendMessage,
    // which ultimately invoked runPrompt on the session runner.
    expect(runPromptMock).toHaveBeenCalledTimes(1);

    // After createRun returns, the registered Run is idle (no in-flight
    // turn) and its provider_session_id has been promoted from the
    // `pending_` seed to the canonical value the runner returned.
    const activeRun = getActiveRun(dispatchedAgentSessionId);
    expect(activeRun).not.toBeNull();
    expect(activeRun?.isProcessing).toBe(false);
    expect(activeRun?.session.provider_session_id).toBe(canonicalProviderSessionId);
    expect(activeRun?.session.provider_session_id?.startsWith('pending_')).toBe(false);
  });

  it('accepts a trigger-backed first turn before provider settlement', async () => {
    vi.mocked(loadAgentSessionRunnerConfig).mockResolvedValue({
      sourcePath: '/tmp/cfg.json',
      warnings: [],
    });

    let settleProvider: (() => void) | undefined;
    const providerSettlement = new Promise<{
      providerSessionId: string | null;
      providerConversationId: string | null;
      errorCount: number;
    }>((resolve) => {
      settleProvider = () =>
        resolve({
          providerSessionId: 'provider-session-trigger-1',
          providerConversationId: null,
          errorCount: 0,
        });
    });
    const dispatchedAgentSessionId = 'agent-session-trigger-dispatch-1';
    const emptyDailyResponseFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ data: [] }), { status: 200 });
    const { localAgentService, runPromptMock, getActiveRun } = buildHarness(
      createPromptTypeHandlerTestDeps({ fetchImpl: emptyDailyResponseFetch }),
    );
    runPromptMock.mockReturnValue(providerSettlement);

    let triggerAccepted = false;
    const acceptance = localAgentService
      .createRunFromTrigger(
        TEST_ADMITTED_HOST_ACTION,
        buildCreateRunInput({
          contextMetadata: {
            capturedAt: new Date('2026-04-18T00:00:00.000Z').toISOString(),
            organizationId: 'org-1',
            projectId: 'project-1',
            agentSessionId: dispatchedAgentSessionId,
            userComments: [],
            fileReferences: { resolved: [], unresolved: [] },
          } as unknown as AgenticSessionContextMetadata,
          config: PROJECT_ASSISTANT_DISABLED_CONFIG,
          payload: {
            promptType: LocalPromptType.DailySession,
            payloadVersion: 1,
            userMessage: 'Run the daily session.',
          },
        }),
      )
      .then((result) => {
        triggerAccepted = true;
        return result;
      });

    await vi.waitFor(() => expect(runPromptMock).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(triggerAccepted).toBe(true));
    await expect(acceptance).resolves.toMatchObject({ status: 'started' });

    settleProvider?.();
    await getActiveRun(dispatchedAgentSessionId)?.awaitIdle();
  });

  it('skips the first-turn dispatch when the request carries no payload', async () => {
    vi.mocked(loadAgentSessionRunnerConfig).mockResolvedValue({
      sourcePath: '/tmp/cfg.json',
      warnings: [],
    });

    const { localAgentService, runPromptMock } = buildHarness();

    const result = await localAgentService.createRun(buildCreateRunInput({}));
    expect(result.status).toBe('started');
    // No payload → no concrete promptType to drive the first turn against,
    // so the dispatch path is intentionally skipped and the runner is not
    // invoked. The run start itself still succeeds.
    expect(runPromptMock).not.toHaveBeenCalled();
  });

  it('accepts an EVAL work item and dispatches the registered Run Eval handler', async () => {
    vi.mocked(loadAgentSessionRunnerConfig).mockResolvedValue({
      sourcePath: '/tmp/cfg.json',
      warnings: [],
    });

    const { localAgentService, capturedCreateRunInputs, runPromptMock } =
      buildHarness(createEvalHandlerDeps());
    const result = await localAgentService.createRun(
      buildCreateRunInput({
        config: PROJECT_ASSISTANT_DISABLED_CONFIG,
        payload: buildRunEvalPayload(),
      }),
    );

    expect(result.status).toBe('started');
    expect(capturedCreateRunInputs).toHaveLength(1);
    // Run Eval is procedural: admitted, but it starts no provider session.
    expect(runPromptMock).not.toHaveBeenCalled();
  });

  it.each(['STANDARD', 'BUG', 'PROJECT_CUSTOM'])(
    'ignores deprecated copied work-item type during EVAL admission (%s)',
    async (taskType) => {
      vi.mocked(loadAgentSessionRunnerConfig).mockResolvedValue({
        sourcePath: '/tmp/cfg.json',
        warnings: [],
      });
      const { localAgentService, capturedCreateRunInputs, runPromptMock } =
        buildHarness(createEvalHandlerDeps());

      const result = await localAgentService.createRun(
        buildCreateRunInput({
          config: PROJECT_ASSISTANT_DISABLED_CONFIG,
          payload: buildRunEvalPayload(taskType),
        }),
      );

      expect(result.status).toBe('started');
      expect(capturedCreateRunInputs).toHaveLength(1);
      // Run Eval is procedural: admitted, but it starts no provider session.
    expect(runPromptMock).not.toHaveBeenCalled();
    },
  );

  it('rejects a Run Eval launch without a focal entity before materialization', async () => {
    vi.mocked(loadAgentSessionRunnerConfig).mockClear();
    const { localAgentService, capturedCreateRunInputs, runPromptMock } = buildHarness();

    await expect(
      localAgentService.createRun(
        buildCreateRunInput({
          payload: {
            promptType: LocalPromptType.RunEval,
          } as NonNullable<LocalCreateRunRequest['payload']>,
        }),
      ),
    ).rejects.toThrow(/requires payload\.entity/);

    expect(loadAgentSessionRunnerConfig).not.toHaveBeenCalled();
    expect(capturedCreateRunInputs).toHaveLength(0);
    expect(runPromptMock).not.toHaveBeenCalled();
  });
});

describe('Open Items triage PROJECT launch', () => {
  const projectId = '11111111-1111-4111-8111-111111111111';
  const payload = {
    promptType: 'open_items_triage',
    projectId,
    requestKind: 'freshPass',
    mode: 'tidyUp',
    userMessage: '',
    entity: { entityType: 'PROJECT', entityId: projectId },
  } satisfies NonNullable<LocalCreateRunRequest['payload']>;

  it.each([undefined, null, { entityType: 'PROJECT', entityId: 'invalid' }])(
    'rejects invalid identity %s before materialization',
    async (entity) => {
      vi.mocked(loadAgentSessionRunnerConfig).mockClear();
      const h = buildHarness();
      const { entity: _entity, ...fields } = payload;
      await expect(
        h.localAgentService.createRun(
          buildCreateRunInput({
            payload: { ...fields, ...(entity === undefined ? {} : { entity }) } as NonNullable<
              LocalCreateRunRequest['payload']
            >,
          }),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      expect(loadAgentSessionRunnerConfig).not.toHaveBeenCalled();
      expect(h.capturedCreateRunInputs).toHaveLength(0);
      expect(h.runPromptMock).not.toHaveBeenCalled();
    },
  );

  it('persists PROJECT before its direct first turn, reuses matching starts and rejects conflicts', async () => {
    vi.mocked(loadAgentSessionRunnerConfig).mockResolvedValue({
      sourcePath: '/tmp/cfg.json',
      warnings: [],
    });
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      const data = url.endsWith('/open-items')
        ? { state: 'PRESENT', revision: 1, items: [], groups: [] }
        : url.includes('/attention')
          ? { events: [], pagination: { limit: 50, offset: 0, total: 0 } }
          : { items: [], userId: projectId, windowDays: 30 };
      return new Response(JSON.stringify({ data }), { status: 200 });
    });
    const h = buildHarness(createPromptTypeHandlerTestDeps({ fetchImpl }));
    const input = buildCreateRunInput({
      context: { projectId, provider: 'codex' },
      payload,
      contextMetadata: { ...createSessionContextMetadata(), projectId },
    });
    h.runPromptMock.mockImplementation(async () => {
      expect(h.runs[0]?.entity).toEqual(payload.entity);
      expect(h.capturedCreateRunInputs[0]?.entity).toEqual(payload.entity);
      return { providerSessionId: null, providerConversationId: null, errorCount: 0 };
    });
    const first = await h.localAgentService.createRun(input);
    expect(first.status).toBe('started');
    await vi.waitFor(() => expect(h.runPromptMock).toHaveBeenCalledOnce());
    expect(h.runPromptMock.mock.calls[0]?.[0].session.promptType).toBe(
      LocalPromptType.OpenItemsTriage,
    );
    const second = await h.localAgentService.createRun(input);
    expect(second.status).toBe('started');
    expect(h.capturedCreateRunInputs).toHaveLength(1);
    expect(h.runPromptMock).toHaveBeenCalledOnce();
    await expect(
      h.localAgentService.createRun({
        ...input,
        payload: {
          ...payload,
          entity: { entityType: 'PROJECT', entityId: '22222222-2222-4222-8222-222222222222' },
        },
      }),
    ).rejects.toThrow(/different entity/);
    expect(h.runs[0]?.entity).toEqual(payload.entity);
    expect(fetchImpl.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });
});
