/** @vitest-environment node */

import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { TEST_ADMITTED_HOST_ACTION } from '../controller-authorization/admitted-host-action.test-support';
import { AdmittedHostAction } from '../controller-authorization/types';
import { LocalAgentService } from '../local-agent-service';
import {
  createTestRunRegistryWiring,
  LOCAL_AGENT_SERVICE_TEST_DEPENDENCIES,
} from './helpers/test-run-registry';
import { StructuredServerLogger, type ServerLogEntry } from '../logger';
import { LocalAgentApiError } from '../../shared/agent-bridge-contract/errors';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import { TriggerPayloadValidationError } from '../conversation-dispatch/trigger-payload-schemas';
import type {
  MessagesGetMessageApiClient,
  WorkflowsPromptTypeApiClient,
} from '../services/message.service';
import type { ServerLogger } from '../logger';
import type {
  AgenticSession,
  AgenticSessionEvent,
  CreateAgenticSessionInput,
  AgenticSessionContextMetadata,
} from '../../session/index';
import type { RunStore } from '../../run-store/run-store';
import type { AgentSessionRunner } from '../../agents/providers/session-runner';
import type { WorkflowDispatchVerdictReader } from '../services/workflow-dispatch-verdict';
import {
  createTestRepoMappingStore,
  createTestRunStore,
  createTestWorkflowDispatchVerdictReader,
} from '../../run/run.test-support';
import { createTestOAuthClient } from './helpers/test-oauth-client';
import { SETTLED_CATALOG_AVAILABILITY } from '../../test-support/capability-catalog';

type ReadWorkflowDispatchVerdict = WorkflowDispatchVerdictReader['read'];

const createSessionContextMetadata = (): AgenticSessionContextMetadata =>
  ({
    capturedAt: new Date('2026-04-18T00:00:00.000Z').toISOString(),
    organizationId: 'org-1',
    projectId: 'project-1',
    agentSessionId: 'agent-session-1',
    launchPlanId: 'plan-1',
    launchStepId: 'step-1',
    task: {
      id: 'task-1',
      name: 'Implement something',
      type: 'STANDARD' as const,
      organizationId: 'org-1',
      initiativeId: 'initiative-1',
      status: 'ACTIVE' as const,
      source: 'user' as const,
    },
    userComments: [],
    fileReferences: { resolved: [], unresolved: [] },
  }) as unknown as AgenticSessionContextMetadata;

const createSession = (input: {
  agenticSessionId: string;
  providerSessionId: string;
}): AgenticSession => ({
  entity: { entityType: 'TASK', entityId: 'task-1' },
  agentic_session_id: input.agenticSessionId,
  services: [{ id: 'svc-1', path: '/tmp/repo' }],
  launchServiceId: 'svc-1',
  provider: 'claude',
  provider_session_id: input.providerSessionId,
  provider_conversation_id: null,
  conversationId: 'conv-1',
  status: 'idle',
  contextMetadata: createSessionContextMetadata(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  events: [],
});

const createMockRunStore = (runs: AgenticSession[]): RunStore => {
  const store = createTestRunStore();
  vi.spyOn(store, 'initialize').mockResolvedValue({ migrated: false });
  vi.spyOn(store, 'createRun').mockImplementation(
    async (input: CreateAgenticSessionInput): Promise<AgenticSession> => {
      const created = createSession({
        agenticSessionId: input.agentic_session_id ?? `run-${String(runs.length + 1)}`,
        providerSessionId: input.provider_session_id,
      });
      runs.push(created);
      return created;
    },
  );
  vi.spyOn(store, 'getRun').mockImplementation(
    async (runId: string) => runs.find((r) => r.agentic_session_id === runId) ?? null,
  );
  vi.spyOn(store, 'getRunWithEvents').mockImplementation(
    async (runId: string) => runs.find((r) => r.agentic_session_id === runId) ?? null,
  );
  vi.spyOn(store, 'listRuns').mockImplementation(async () => runs);
  vi.spyOn(store, 'addTouchedFiles').mockImplementation(async () => {});
  vi.spyOn(store, 'addToolUsage').mockImplementation(async () => {});
  vi.spyOn(store, 'updateRunSessionContext').mockImplementation(async (runId, context) => {
    const run = runs.find((r) => r.agentic_session_id === runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    run.sessionContext = context;
    return run;
  });
  vi.spyOn(store, 'updateRunStatus').mockImplementation(async (runId, status) => {
    const run = runs.find((r) => r.agentic_session_id === runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    run.status = status;
    return run;
  });
  vi.spyOn(store, 'updateRunProviderIdentity').mockImplementation(async (runId, input) => {
    const run = runs.find((r) => r.agentic_session_id === runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    run.provider_session_id = input.providerSessionId as unknown as string;
    run.provider_conversation_id = input.providerConversationId ?? null;
    return run;
  });
  vi.spyOn(store, 'updateRunPromptType').mockImplementation(async (runId, promptType) => {
    const run = runs.find((r) => r.agentic_session_id === runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    run.promptType = promptType;
    return run;
  });
  vi.spyOn(store, 'updateRunProjectAssistantDone').mockImplementation(async (runId, done) => {
    const run = runs.find((r) => r.agentic_session_id === runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    run.projectAssistantDone = done;
    return run;
  });
  vi.spyOn(store, 'updateRunTriggerContext').mockImplementation(async (runId, context) => {
    const run = runs.find((r) => r.agentic_session_id === runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    run.triggerExternalAgentNodeId = context.externalAgentNodeId;
    run.triggerMessageId = context.triggerMessageId;
    return run;
  });
  vi.spyOn(store, 'appendEvent').mockImplementation(async (agenticSessionId, input) => {
    const run = runs.find((r) => r.agentic_session_id === agenticSessionId);
    if (!run) throw new Error(`Unknown run: ${agenticSessionId}`);
    const nextSeq = (run.events[run.events.length - 1]?.seq ?? 0) + 1;
    const event: AgenticSessionEvent = {
      seq: nextSeq,
      ts: new Date().toISOString(),
      app_session_id: 'cli-run-1',
      run_id: input.run_id,
      actor: input.actor,
      event_type: input.event_type,
      state_version: input.state_version,
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
    };
    run.events.push(event);
    return event;
  });
  vi.spyOn(store, 'getProviderPreference').mockResolvedValue(null);
  vi.spyOn(store, 'setProviderPreference').mockImplementation(async () => {});
  vi.spyOn(store, 'hasIdempotencyToken').mockResolvedValue(false);
  vi.spyOn(store, 'persistIdempotencyToken').mockImplementation(async () => {});
  vi.spyOn(store, 'lookupByAgentSessionId').mockReturnValue(null);
  vi.spyOn(store, 'lookupByProviderSessionId').mockImplementation(
    (providerSessionId) =>
      runs.find((r) => r.provider_session_id === providerSessionId)?.agentic_session_id ?? null,
  );
  vi.spyOn(store, 'lookupByCanonicalRunId').mockReturnValue(null);
  return store;
};

interface HarnessOverrides {
  workflowsApi?: WorkflowsPromptTypeApiClient;
  messagesApi?: MessagesGetMessageApiClient;
  logger?: ServerLogger;
  /**
   * Drain-time freshness probe. In production this and dispatch-time
   * resolution read the same `getConversationPromptType`; the test harness
   * injects them separately so a test can make the workflow "advance"
   * between a dispatch's arrival and the moment its queued turn drains.
   */
  getWorkflowDispatchVerdict?: ReadWorkflowDispatchVerdict;
}

const buildHarness = (overrides: HarnessOverrides = {}) => {
  const providerSessionId = 'provider-run-1';
  const runs: AgenticSession[] = [createSession({ agenticSessionId: 'run-1', providerSessionId })];
  // These tests isolate workflow dispatch. The one-shot Project Assistant
  // handoff has already completed on the persisted Run.
  runs[0]!.projectAssistantDone = true;
  const runStore = createMockRunStore(runs);

  const runPromptMock = vi.fn<AgentSessionRunner['runPrompt']>(async () => ({
    providerSessionId,
    providerConversationId: null,
    errorCount: 0,
  }));
  const resumeSessionMock = vi.fn<AgentSessionRunner['resumeSession']>(async () => ({
    providerSessionId,
    providerConversationId: null,
    errorCount: 0,
  }));

  const oauthClient = createTestOAuthClient({
    getAccessToken: vi.fn(async () => ({ success: true as const, data: 'test-token' })),
  });

  const wiring = createTestRunRegistryWiring({
    runStore,
    sessionRunner: { runPrompt: runPromptMock, resumeSession: resumeSessionMock },
    oauthClient,
    ...(overrides.logger ? { logger: overrides.logger } : {}),
    ...(overrides.getWorkflowDispatchVerdict
      ? {
          workflowDispatchVerdictReader: createTestWorkflowDispatchVerdictReader(
            overrides.getWorkflowDispatchVerdict,
          ),
        }
      : {}),
  });

  const localAgentService = new LocalAgentService({
    capabilityCatalog: SETTLED_CATALOG_AVAILABILITY,
    ...LOCAL_AGENT_SERVICE_TEST_DEPENDENCIES,
    runStore,
    repoStore: createTestRepoMappingStore(),
    runRegistry: wiring.runRegistry,
    promptTypeRegistry: wiring.promptTypeRegistry,
    workflowsApi: overrides.workflowsApi ?? wiring.workflowsApi,
    messagesApi: overrides.messagesApi ?? wiring.messagesApi,
    ...(overrides.logger ? { logger: overrides.logger } : {}),
  });

  return {
    localAgentService,
    runPromptMock,
    resumeSessionMock,
    posterMock: wiring.poster,
    runRegistry: wiring.runRegistry,
    getActiveRun: (runId: string) => wiring.runRegistry.get(runId),
    runs,
  };
};

describe('local-agent-service — promptType dispatch guard', () => {
  it('requires HostActionAdmission proof before browser message dispatch', () => {
    expectTypeOf<
      Parameters<LocalAgentService['sendMessage']>[0]
    >().toEqualTypeOf<AdmittedHostAction>();

    class WrongActionCapability extends AdmittedHostAction {
      public constructor() {
        super('CONVERSATION_CONTROL_COMPACT_RUN', 'authorization-1', 'nonce-1');
      }
    }
    const { localAgentService } = buildHarness();

    expect(() =>
      localAgentService.sendMessage(new WrongActionCapability(), 'run-1', {
        promptType: LocalPromptType.Quick,
        payload: { userMessage: 'must not dispatch' },
        references: { resolved: [], unresolved: [] },
      }),
    ).toThrow('Host action capability does not admit CONVERSATION_TRIGGER.');
  });

  it('sendMessage rejects an unregistered promptType with a structured 400 error', async () => {
    const { localAgentService, runPromptMock, resumeSessionMock } = buildHarness();

    await expect(
      localAgentService.sendMessage(TEST_ADMITTED_HOST_ACTION, 'run-1', {
        promptType: 'definitely_not_a_real_prompt_type',
        references: { resolved: [], unresolved: [] },
      } as unknown as Parameters<typeof localAgentService.sendMessage>[2]),
    ).rejects.toBeInstanceOf(LocalAgentApiError);

    expect(runPromptMock).not.toHaveBeenCalled();
    expect(resumeSessionMock).not.toHaveBeenCalled();
  });

  it('routes a signed USER follow-up directly to coding_freeform without workflow resolution', async () => {
    const getConversationPromptType = vi.fn<
      WorkflowsPromptTypeApiClient['getConversationPromptType']
    >(async () => {
      throw new Error('workflow dispatch must not run for coding_freeform guidance');
    });
    const { localAgentService, getActiveRun, runPromptMock, resumeSessionMock } = buildHarness({
      workflowsApi: { getConversationPromptType },
    });

    await localAgentService.sendMessage(TEST_ADMITTED_HOST_ACTION, 'run-1', {
      promptType: LocalPromptType.CodingFreeform,
      payload: {
        promptType: LocalPromptType.CodingFreeform,
        userMessage: 'Address the remaining acceptance evidence.',
      },
      references: { resolved: [], unresolved: [] },
    });
    await getActiveRun('run-1')?.awaitIdle();

    expect(getConversationPromptType).not.toHaveBeenCalled();
    expect(runPromptMock).toHaveBeenCalledOnce();
    expect(resumeSessionMock).not.toHaveBeenCalled();
  });
});

describe('local-agent-service — workflow-defined edge resolution', () => {
  it('queries the platform with the session triple when the sentinel arrives', async () => {
    const getConversationPromptType = vi.fn<
      WorkflowsPromptTypeApiClient['getConversationPromptType']
    >(async () => ({
      data: { data: { workflowState: 'terminal', promptType: null } },
    }));
    const { localAgentService } = buildHarness({
      workflowsApi: { getConversationPromptType },
    });

    try {
      await localAgentService.sendMessage(TEST_ADMITTED_HOST_ACTION, 'run-1', {
        promptType: LocalPromptType.WorkflowDefined,
        references: { resolved: [], unresolved: [] },
      });
    } catch {
      // Expected — null resolution is a 400; asserted separately.
    }

    expect(getConversationPromptType).toHaveBeenCalledTimes(1);
    expect(getConversationPromptType).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'project-1',
      conversationId: 'conv-1',
    });
  });

  it('rejects with a 400 LocalAgentApiError when the API returns null', async () => {
    const getConversationPromptType = vi.fn<
      WorkflowsPromptTypeApiClient['getConversationPromptType']
    >(async () => ({
      data: { data: { workflowState: 'terminal', promptType: null } },
    }));
    const { localAgentService, runPromptMock, resumeSessionMock, posterMock } = buildHarness({
      workflowsApi: { getConversationPromptType },
    });

    let thrown: unknown;
    try {
      await localAgentService.sendMessage(TEST_ADMITTED_HOST_ACTION, 'run-1', {
        promptType: LocalPromptType.WorkflowDefined,
        references: { resolved: [], unresolved: [] },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(LocalAgentApiError);
    expect((thrown as LocalAgentApiError).statusCode).toBe(400);

    expect(runPromptMock).not.toHaveBeenCalled();
    expect(resumeSessionMock).not.toHaveBeenCalled();
    expect(posterMock.createOutOfBand).not.toHaveBeenCalled();
  });

  it('rejects when the API returns an unregistered promptType', async () => {
    const getConversationPromptType = vi.fn<
      WorkflowsPromptTypeApiClient['getConversationPromptType']
    >(async () => ({
      data: {
        data: {
          workflowState: 'terminal',
          promptType: 'nonsense_prompt_type_that_will_never_exist',
        },
      },
    }));
    const { localAgentService, runPromptMock } = buildHarness({
      workflowsApi: { getConversationPromptType },
    });

    let thrown: unknown;
    try {
      await localAgentService.sendMessage(TEST_ADMITTED_HOST_ACTION, 'run-1', {
        promptType: LocalPromptType.WorkflowDefined,
        references: { resolved: [], unresolved: [] },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(LocalAgentApiError);
    expect((thrown as LocalAgentApiError).statusCode).toBe(400);
    expect(runPromptMock).not.toHaveBeenCalled();
  });
});

describe('local-agent-service — workflow-defined trigger-payload fetch', () => {
  const DESIGN_DOC_ID = '11111111-1111-4111-8111-111111111111';
  const PLAN_ID = '22222222-2222-4222-8222-222222222222';
  const TRIGGER_MESSAGE_ID = 'trigger-msg-1';
  const NODE_ID = 'node-1';
  const PLAN_SHAPING_PROMPT_TYPE: string = LocalPromptType.PlanShapingProposedStages;
  const FEATURE_SYNC_PROMPT_TYPE: string = LocalPromptType.FeatureSyncAnalyze;

  const captureLogger = () => {
    const lines: string[] = [];
    const logger = new StructuredServerLogger({
      minLevel: 'trace',
      writeLine: (line) => {
        lines.push(line);
      },
    });
    const entries = (): ServerLogEntry[] => lines.map((line) => JSON.parse(line) as ServerLogEntry);
    const find = (eventName: string): ServerLogEntry | undefined =>
      entries().find((entry) => entry.event === eventName);
    return { logger, entries, find };
  };

  const buildTriggerMessage = (
    overrides: {
      promptType?: string;
      nodeId?: string;
      payload?: Record<string, unknown> | undefined;
      omitTriggersAgent?: boolean;
      nonSystem?: boolean;
    } = {},
  ) => {
    if (overrides.nonSystem) {
      return {
        type: 'USER',
        id: TRIGGER_MESSAGE_ID,
        projectId: 'project-1',
        conversationId: 'conv-1',
        status: 'COMPLETED',
        data: {},
        createdAt: '2026-04-18T00:00:00.000Z',
        awaitingResponse: false,
      };
    }
    const triggersAgent = overrides.omitTriggersAgent
      ? undefined
      : {
          promptType: overrides.promptType ?? PLAN_SHAPING_PROMPT_TYPE,
          nodeId: overrides.nodeId ?? NODE_ID,
          ...(overrides.payload !== undefined ? { payload: overrides.payload } : {}),
        };
    return {
      type: 'SYSTEM',
      id: TRIGGER_MESSAGE_ID,
      projectId: 'project-1',
      conversationId: 'conv-1',
      status: 'COMPLETED',
      data: {
        type: 'system_message',
        ...(triggersAgent ? { triggersAgent } : {}),
      },
      createdAt: '2026-04-18T00:00:00.000Z',
      awaitingResponse: false,
    };
  };

  const buildWorkflowsApi = (input: {
    workflowState?: 'agent-pending' | 'live-non-agent' | 'terminal';
    promptType: string;
    nodeId: string | null;
    triggerMessageId: string | null;
  }): WorkflowsPromptTypeApiClient => {
    const workflowState =
      input.workflowState ?? (input.triggerMessageId !== null ? 'agent-pending' : 'terminal');
    return {
      getConversationPromptType: vi.fn(async () => ({
        data: { data: { ...input, workflowState } },
      })),
    };
  };

  it('forwards the trigger payload on a payload-bearing promptType', async () => {
    const payload = {
      designDocId: DESIGN_DOC_ID,
      planId: PLAN_ID,
    };
    const getMessage = vi.fn(async () => ({
      data: { data: buildTriggerMessage({ payload }) },
    }));
    const { logger, find } = captureLogger();
    const { localAgentService } = buildHarness({
      workflowsApi: buildWorkflowsApi({
        promptType: PLAN_SHAPING_PROMPT_TYPE,
        nodeId: NODE_ID,
        triggerMessageId: TRIGGER_MESSAGE_ID,
      }),
      messagesApi: { getMessage: getMessage },
      logger,
    });

    await localAgentService.sendMessage(TEST_ADMITTED_HOST_ACTION, 'run-1', {
      promptType: LocalPromptType.WorkflowDefined,
      references: { resolved: [], unresolved: [] },
    });

    expect(getMessage).toHaveBeenCalledTimes(1);
    expect(getMessage).toHaveBeenCalledWith({
      id: TRIGGER_MESSAGE_ID,
      projectId: 'project-1',
      organizationId: 'org-1',
    });

    const fetchedLog = find(
      'local.service.send_message.workflow_defined_trigger_payload.payload_fetched',
    );
    expect(fetchedLog).toBeDefined();
    expect(fetchedLog?.level).toBe('info');
    expect(fetchedLog?.['promptType']).toBe(PLAN_SHAPING_PROMPT_TYPE);
    expect(fetchedLog?.['nodeId']).toBe(NODE_ID);

    const resolvedLog = find('local.service.send_message.workflow_defined_resolved');
    expect(resolvedLog).toBeDefined();
    expect(resolvedLog?.['resolved']).toBe(PLAN_SHAPING_PROMPT_TYPE);
    expect(resolvedLog?.['triggerMessageId']).toBe(TRIGGER_MESSAGE_ID);
    expect(resolvedLog?.['nodeId']).toBe(NODE_ID);
    expect(resolvedLog).toHaveProperty('priorPersistedPromptType');
  });

  it('skips the trigger-payload fetch when the workflow returns triggerMessageId === null', async () => {
    const getMessage = vi.fn(async () => {
      throw new Error('getMessage should not be invoked when triggerMessageId is null.');
    });
    const { localAgentService } = buildHarness({
      workflowsApi: buildWorkflowsApi({
        promptType: FEATURE_SYNC_PROMPT_TYPE,
        nodeId: null,
        triggerMessageId: null,
      }),
      messagesApi: { getMessage: getMessage },
    });

    await localAgentService.sendMessage(TEST_ADMITTED_HOST_ACTION, 'run-1', {
      promptType: LocalPromptType.WorkflowDefined,
      references: { resolved: [], unresolved: [] },
    });

    expect(getMessage).not.toHaveBeenCalled();
  });

  it('rejects with 400 on promptType drift between the workflow and the trigger', async () => {
    const getMessage = vi.fn(async () => ({
      data: { data: buildTriggerMessage({ promptType: FEATURE_SYNC_PROMPT_TYPE }) },
    }));
    const { logger, find } = captureLogger();
    const { localAgentService } = buildHarness({
      workflowsApi: buildWorkflowsApi({
        promptType: PLAN_SHAPING_PROMPT_TYPE,
        nodeId: NODE_ID,
        triggerMessageId: TRIGGER_MESSAGE_ID,
      }),
      messagesApi: { getMessage: getMessage },
      logger,
    });

    let thrown: unknown;
    try {
      await localAgentService.sendMessage(TEST_ADMITTED_HOST_ACTION, 'run-1', {
        promptType: LocalPromptType.WorkflowDefined,
        references: { resolved: [], unresolved: [] },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LocalAgentApiError);
    expect((thrown as LocalAgentApiError).statusCode).toBe(400);
    const driftLog = find(
      'local.service.send_message.workflow_defined_trigger_payload.prompt_type_drift',
    );
    expect(driftLog).toBeDefined();
    expect(driftLog?.level).toBe('error');
    expect(driftLog?.['expectedPromptType']).toBe(PLAN_SHAPING_PROMPT_TYPE);
    expect(driftLog?.['triggerPromptType']).toBe(FEATURE_SYNC_PROMPT_TYPE);
  });

  it('rejects with 400 on nodeId drift between the workflow and the trigger', async () => {
    const getMessage = vi.fn(async () => ({
      data: {
        data: buildTriggerMessage({
          nodeId: 'node-from-trigger',
          payload: { designDocId: DESIGN_DOC_ID, planId: PLAN_ID },
        }),
      },
    }));
    const { logger, find } = captureLogger();
    const { localAgentService } = buildHarness({
      workflowsApi: buildWorkflowsApi({
        promptType: PLAN_SHAPING_PROMPT_TYPE,
        nodeId: 'node-from-workflow',
        triggerMessageId: TRIGGER_MESSAGE_ID,
      }),
      messagesApi: { getMessage: getMessage },
      logger,
    });

    let thrown: unknown;
    try {
      await localAgentService.sendMessage(TEST_ADMITTED_HOST_ACTION, 'run-1', {
        promptType: LocalPromptType.WorkflowDefined,
        references: { resolved: [], unresolved: [] },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LocalAgentApiError);
    expect((thrown as LocalAgentApiError).statusCode).toBe(400);
    const driftLog = find(
      'local.service.send_message.workflow_defined_trigger_payload.node_id_drift',
    );
    expect(driftLog).toBeDefined();
    expect(driftLog?.level).toBe('error');
    expect(driftLog?.['expectedNodeId']).toBe('node-from-workflow');
    expect(driftLog?.['triggerNodeId']).toBe('node-from-trigger');
  });

  it('proceeds when the trigger has no payload and the promptType has no schema', async () => {
    const getMessage = vi.fn(async () => ({
      data: {
        data: buildTriggerMessage({
          promptType: FEATURE_SYNC_PROMPT_TYPE,
          payload: undefined,
        }),
      },
    }));
    const { logger, find } = captureLogger();
    const { localAgentService } = buildHarness({
      workflowsApi: buildWorkflowsApi({
        promptType: FEATURE_SYNC_PROMPT_TYPE,
        nodeId: NODE_ID,
        triggerMessageId: TRIGGER_MESSAGE_ID,
      }),
      messagesApi: { getMessage: getMessage },
      logger,
    });

    await localAgentService.sendMessage(TEST_ADMITTED_HOST_ACTION, 'run-1', {
      promptType: LocalPromptType.WorkflowDefined,
      references: { resolved: [], unresolved: [] },
    });

    expect(getMessage).toHaveBeenCalledTimes(1);
    const fetchedLog = find(
      'local.service.send_message.workflow_defined_trigger_payload.payload_fetched',
    );
    expect(fetchedLog).toBeDefined();
    expect(fetchedLog?.['hasPayload']).toBe(false);
  });

  it('rejects with 400 when getMessage 404s', async () => {
    const axios404 = Object.assign(new Error('Not found'), {
      response: { status: 404 },
    });
    const getMessage = vi.fn(async () => {
      throw axios404;
    });
    const { logger, find } = captureLogger();
    const { localAgentService } = buildHarness({
      workflowsApi: buildWorkflowsApi({
        promptType: PLAN_SHAPING_PROMPT_TYPE,
        nodeId: NODE_ID,
        triggerMessageId: TRIGGER_MESSAGE_ID,
      }),
      messagesApi: { getMessage: getMessage },
      logger,
    });

    let thrown: unknown;
    try {
      await localAgentService.sendMessage(TEST_ADMITTED_HOST_ACTION, 'run-1', {
        promptType: LocalPromptType.WorkflowDefined,
        references: { resolved: [], unresolved: [] },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LocalAgentApiError);
    expect((thrown as LocalAgentApiError).statusCode).toBe(400);
    expect((thrown as LocalAgentApiError).message).toBe('Workflow trigger no longer pending');
    const notFoundLog = find(
      'local.service.send_message.workflow_defined_trigger_payload.fetch_not_found',
    );
    expect(notFoundLog).toBeDefined();
    expect(notFoundLog?.level).toBe('warn');
  });

  it('rejects with 400 when the trigger message has no triggersAgent shape', async () => {
    const getMessage = vi.fn(async () => ({
      data: { data: buildTriggerMessage({ omitTriggersAgent: true }) },
    }));
    const { logger, find } = captureLogger();
    const { localAgentService } = buildHarness({
      workflowsApi: buildWorkflowsApi({
        promptType: PLAN_SHAPING_PROMPT_TYPE,
        nodeId: NODE_ID,
        triggerMessageId: TRIGGER_MESSAGE_ID,
      }),
      messagesApi: { getMessage: getMessage },
      logger,
    });

    let thrown: unknown;
    try {
      await localAgentService.sendMessage(TEST_ADMITTED_HOST_ACTION, 'run-1', {
        promptType: LocalPromptType.WorkflowDefined,
        references: { resolved: [], unresolved: [] },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LocalAgentApiError);
    expect((thrown as LocalAgentApiError).statusCode).toBe(400);
    expect((thrown as LocalAgentApiError).message).toBe('Workflow trigger no longer pending');
    const invalidShapeLog = find(
      'local.service.send_message.workflow_defined_trigger_payload.fetch_invalid_shape',
    );
    expect(invalidShapeLog).toBeDefined();
    expect(invalidShapeLog?.level).toBe('warn');
  });

  it('rejects with 400 carrying TriggerPayloadValidationError as cause on schema failure', async () => {
    const getMessage = vi.fn(async () => ({
      data: {
        data: buildTriggerMessage({
          payload: { designDocId: 'not-a-uuid', planId: 'not-a-uuid' },
        }),
      },
    }));
    const { logger, find } = captureLogger();
    const { localAgentService } = buildHarness({
      workflowsApi: buildWorkflowsApi({
        promptType: PLAN_SHAPING_PROMPT_TYPE,
        nodeId: NODE_ID,
        triggerMessageId: TRIGGER_MESSAGE_ID,
      }),
      messagesApi: { getMessage: getMessage },
      logger,
    });

    let thrown: unknown;
    try {
      await localAgentService.sendMessage(TEST_ADMITTED_HOST_ACTION, 'run-1', {
        promptType: LocalPromptType.WorkflowDefined,
        references: { resolved: [], unresolved: [] },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LocalAgentApiError);
    expect((thrown as LocalAgentApiError).statusCode).toBe(400);
    expect((thrown as LocalAgentApiError & { cause?: unknown }).cause).toBeInstanceOf(
      TriggerPayloadValidationError,
    );
    const invalidLog = find(
      'local.service.send_message.workflow_defined_trigger_payload.payload_invalid',
    );
    expect(invalidLog).toBeDefined();
    expect(invalidLog?.level).toBe('error');
    expect(invalidLog?.['promptType']).toBe(PLAN_SHAPING_PROMPT_TYPE);
  });

  it('logs payload_overridden at info when the wire and trigger payloads both exist', async () => {
    const getMessage = vi.fn(async () => ({
      data: {
        data: buildTriggerMessage({
          promptType: LocalPromptType.PlanShapingProposedStages,
          payload: {
            designDocId: DESIGN_DOC_ID,
            planId: PLAN_ID,
          },
        }),
      },
    }));
    const { logger, find } = captureLogger();
    const { localAgentService } = buildHarness({
      workflowsApi: buildWorkflowsApi({
        promptType: LocalPromptType.PlanShapingProposedStages,
        nodeId: NODE_ID,
        triggerMessageId: TRIGGER_MESSAGE_ID,
      }),
      messagesApi: { getMessage: getMessage },
      logger,
    });

    await localAgentService.sendMessage(TEST_ADMITTED_HOST_ACTION, 'run-1', {
      promptType: LocalPromptType.WorkflowDefined,
      references: { resolved: [], unresolved: [] },
      payload: {
        designDocId: DESIGN_DOC_ID,
        planId: PLAN_ID,
        userMessage: 'wire payload',
      } as never,
    });

    const overriddenLog = find('local.service.send_message.workflow_defined_payload_merged');
    expect(overriddenLog).toBeDefined();
    expect(overriddenLog?.level).toBe('info');
    expect(overriddenLog?.['triggerMessageId']).toBe(TRIGGER_MESSAGE_ID);
  });
});

describe('local-agent-service — workflow-defined three-state verdict dispatch', () => {
  const TRIGGER_MESSAGE_ID = 'trigger-msg-1';
  const NODE_ID = 'node-1';
  const TERMINAL_PROMPT_TYPE: string = LocalPromptType.PlanShapingFinalize;
  const AGENT_PROMPT_TYPE: string = LocalPromptType.FeatureSyncAnalyze;

  const captureLogger = () => {
    const lines: string[] = [];
    const logger = new StructuredServerLogger({
      minLevel: 'trace',
      writeLine: (line) => {
        lines.push(line);
      },
    });
    const find = (eventName: string): ServerLogEntry | undefined =>
      lines
        .map((line) => JSON.parse(line) as ServerLogEntry)
        .find((entry) => entry.event === eventName);
    return { logger, find };
  };

  it('agent-pending: fetches and validates the pending trigger, dispatches at the agent promptType', async () => {
    const getConversationPromptType = vi.fn<
      WorkflowsPromptTypeApiClient['getConversationPromptType']
    >(async () => ({
      data: {
        data: {
          workflowState: 'agent-pending',
          promptType: AGENT_PROMPT_TYPE,
          nodeId: NODE_ID,
          triggerMessageId: TRIGGER_MESSAGE_ID,
        },
      },
    }));
    const getMessage = vi.fn(async () => ({
      data: {
        data: {
          type: 'SYSTEM',
          id: TRIGGER_MESSAGE_ID,
          projectId: 'project-1',
          conversationId: 'conv-1',
          status: 'COMPLETED',
          data: {
            type: 'system_message',
            triggersAgent: { promptType: AGENT_PROMPT_TYPE, nodeId: NODE_ID },
          },
          createdAt: '2026-04-18T00:00:00.000Z',
          awaitingResponse: false,
        },
      },
    }));
    const { logger, find } = captureLogger();
    const { localAgentService, getActiveRun, runs } = buildHarness({
      workflowsApi: { getConversationPromptType },
      messagesApi: { getMessage: getMessage },
      logger,
    });
    runs[0]!.provider_session_agent_id = 'feature_sync_analyze';

    await localAgentService.sendMessage(TEST_ADMITTED_HOST_ACTION, 'run-1', {
      promptType: LocalPromptType.WorkflowDefined,
      references: { resolved: [], unresolved: [] },
    });

    expect(getMessage).toHaveBeenCalledTimes(1);
    expect(
      find('local.service.send_message.workflow_defined_awaiting_user_review'),
    ).toBeUndefined();

    const resolvedLog = find('local.service.send_message.workflow_defined_resolved');
    expect(resolvedLog?.['resolved']).toBe(AGENT_PROMPT_TYPE);

    const activeRun = getActiveRun('run-1');
    await activeRun?.awaitIdle();
    expect(activeRun?.getTriggerContext()).toEqual({
      externalAgentNodeId: NODE_ID,
      triggerMessageId: TRIGGER_MESSAGE_ID,
    });
  });

  it('live-non-agent: dispatches a conversational turn with explicitly-null completion identity, not the flow terminal promptType', async () => {
    const getConversationPromptType = vi.fn<
      WorkflowsPromptTypeApiClient['getConversationPromptType']
    >(async () => ({
      data: {
        data: {
          workflowState: 'live-non-agent',
          promptType: TERMINAL_PROMPT_TYPE,
          nodeId: null,
          triggerMessageId: null,
        },
      },
    }));
    const getMessage = vi.fn(async () => {
      throw new Error('getMessage must not be invoked when triggerMessageId is null.');
    });
    const { logger, find } = captureLogger();
    const { localAgentService, getActiveRun } = buildHarness({
      workflowsApi: { getConversationPromptType },
      messagesApi: { getMessage: getMessage },
      logger,
    });

    await localAgentService.sendMessage(TEST_ADMITTED_HOST_ACTION, 'run-1', {
      promptType: LocalPromptType.WorkflowDefined,
      references: { resolved: [], unresolved: [] },
      payload: {
        promptType: LocalPromptType.CodingFreeform,
        userMessage: 'why are we waiting?',
      },
    });

    expect(getMessage).not.toHaveBeenCalled();

    const awaitingReviewLog = find(
      'local.service.send_message.workflow_defined_awaiting_user_review',
    );
    expect(awaitingReviewLog).toBeDefined();
    expect(awaitingReviewLog?.level).toBe('info');
    expect(awaitingReviewLog?.['resolvedTerminalPromptType']).toBe(TERMINAL_PROMPT_TYPE);

    // The Run's stamped (externalAgentNodeId, triggerMessageId) pair is
    // null — `triggerContext: null` on the resolved input routes through
    // `setTriggerContext(null)` in `resolveTurnInputs`. A subsequent
    // agent-pending dispatch can still atomically restore the pair.
    expect(getActiveRun('run-1')?.getTriggerContext()).toBeNull();

    const resolvedLog = find('local.run.scheduler.resolved');
    expect(resolvedLog?.['promptType']).toBe(LocalPromptType.CodingFreeform);
    expect(resolvedLog?.['promptType']).not.toBe(TERMINAL_PROMPT_TYPE);
  });

  it('live-non-agent + FEATURE_SYNC_REVIEW gate: routes to the review persona with the gate payload synthesized from the wire contract', async () => {
    const DESIGN_DOC_ID = 'design-doc-9';
    const PLAN_ID = 'plan-9';
    const getConversationPromptType = vi.fn<
      WorkflowsPromptTypeApiClient['getConversationPromptType']
    >(async () => ({
      data: {
        data: {
          workflowState: 'live-non-agent',
          promptType: TERMINAL_PROMPT_TYPE,
          nodeId: null,
          triggerMessageId: null,
          gate: {
            type: 'FEATURE_SYNC_REVIEW',
            designDocId: DESIGN_DOC_ID,
            planId: PLAN_ID,
            discrepancies: [
              { summary: 'Plans feature omits the review gate', rationale: 'design doc adds it' },
            ],
          },
        },
      },
    }));
    const getMessage = vi.fn(async () => {
      throw new Error('getMessage must not be invoked when triggerMessageId is null.');
    });
    const { logger, find } = captureLogger();
    const { localAgentService, getActiveRun } = buildHarness({
      workflowsApi: { getConversationPromptType },
      messagesApi: { getMessage: getMessage },
      logger,
    });
    await localAgentService.sendMessage(TEST_ADMITTED_HOST_ACTION, 'run-1', {
      promptType: LocalPromptType.WorkflowDefined,
      references: { resolved: [], unresolved: [] },
      payload: {
        promptType: LocalPromptType.CodingFreeform,
        userMessage: 'accept the first one',
      },
    });

    expect(getMessage).not.toHaveBeenCalled();

    const reviewLog = find('local.service.send_message.workflow_defined_feature_sync_review');
    expect(reviewLog).toBeDefined();
    expect(reviewLog?.level).toBe('info');
    expect(reviewLog?.['planId']).toBe(PLAN_ID);
    expect(reviewLog?.['designDocId']).toBe(DESIGN_DOC_ID);
    expect(reviewLog?.['discrepancyCount']).toBe(1);

    // The generic fallback log must NOT fire — the gate took the dedicated route.
    expect(
      find('local.service.send_message.workflow_defined_awaiting_user_review'),
    ).toBeUndefined();

    // Completion identity is cleared like every live-non-agent turn.
    expect(getActiveRun('run-1')?.getTriggerContext()).toBeNull();

    const resolvedLog = find('local.run.scheduler.resolved');
    expect(resolvedLog?.['promptType']).toBe(LocalPromptType.PlanShapingFeatureSyncDiscuss);
    expect(resolvedLog?.['promptType']).not.toBe(TERMINAL_PROMPT_TYPE);
  });

  it('terminal: dispatches the flow terminal promptType unchanged, no gate-parked marker', async () => {
    const getConversationPromptType = vi.fn<
      WorkflowsPromptTypeApiClient['getConversationPromptType']
    >(async () => ({
      data: {
        data: {
          workflowState: 'terminal',
          promptType: TERMINAL_PROMPT_TYPE,
          nodeId: null,
          triggerMessageId: null,
        },
      },
    }));
    const getMessage = vi.fn(async () => {
      throw new Error('getMessage must not be invoked when triggerMessageId is null.');
    });
    const { logger, find } = captureLogger();
    const { localAgentService } = buildHarness({
      workflowsApi: { getConversationPromptType },
      messagesApi: { getMessage: getMessage },
      logger,
    });

    await localAgentService.sendMessage(TEST_ADMITTED_HOST_ACTION, 'run-1', {
      promptType: LocalPromptType.WorkflowDefined,
      references: { resolved: [], unresolved: [] },
    });

    expect(getMessage).not.toHaveBeenCalled();
    expect(
      find('local.service.send_message.workflow_defined_awaiting_user_review'),
    ).toBeUndefined();

    const resolvedLog = find('local.run.scheduler.resolved');
    expect(resolvedLog?.['promptType']).toBe(TERMINAL_PROMPT_TYPE);
  });
});
