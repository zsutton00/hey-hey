/** @vitest-environment node */

import { describe, expect, it, vi } from 'vitest';
import { TEST_ADMITTED_HOST_ACTION } from '../controller-authorization/admitted-host-action.test-support';

const subagentHarness = vi.hoisted(() => ({
  constructedWith: vi.fn(),
  execute: vi.fn(async () => ({ assistantCompleted: true })),
}));
vi.mock('../../run/subagent', () => ({
  SubAgent: class {
    public constructor(args: unknown) {
      subagentHarness.constructedWith(args);
    }
    public execute() {
      return subagentHarness.execute();
    }
  },
}));

import { LocalAgentService } from '../local-agent-service';
import {
  createTestRunRegistryWiring,
  LOCAL_AGENT_SERVICE_TEST_DEPENDENCIES,
} from './helpers/test-run-registry';
import type {
  AgenticSession,
  AgenticSessionEvent,
  CreateAgenticSessionInput,
  AgenticSessionContextMetadata,
} from '../../session/index';
import type { RunStore } from '../../run-store/run-store';
import type { AgentSessionRunner } from '../../agents/providers/session-runner';
import type { SubAgentArgs } from '../../run/subagent';
import { toRepositoryPath, toServiceId } from '../../repo/index';
import { createTestOAuthClient } from './helpers/test-oauth-client';
import {
  createTestRepoMappingStore,
  createTestRunStore,
  createTestRunChangedFilesReader,
} from '../../run/run.test-support';
import { SETTLED_CATALOG_AVAILABILITY } from '../../test-support/capability-catalog';

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
  entity: null,
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

const waitForMock = async (mock: ReturnType<typeof vi.fn>): Promise<void> => {
  for (let i = 0; i < 50; i += 1) {
    if (mock.mock.calls.length > 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('mock was never called');
};

describe('local-agent-service.sendMessage — commit subagent routing', () => {
  it('uses the live session-owned files instead of the Run-lifetime touched files', async () => {
    const providerSessionId = 'provider-run-1';
    const runs: AgenticSession[] = [
      createSession({ agenticSessionId: 'run-1', providerSessionId }),
    ];
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

    subagentHarness.constructedWith.mockClear();
    subagentHarness.execute.mockClear();
    const subagentMock = subagentHarness.constructedWith;

    const oauthClient = createTestOAuthClient({
      getAccessToken: vi.fn(async () => ({ success: true as const, data: 'test-token' })),
    });

    const repoStore = createTestRepoMappingStore(async () => ({
      serviceId: toServiceId('svc-1'),
      repositoryPath: toRepositoryPath(process.cwd()),
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
    }));

    const getLiveRunChangedFiles = vi.fn().mockResolvedValue([
      {
        serviceId: 'svc-1',
        repoPath: '/abs/path/to',
        filePath: 'src/foo.ts',
        diff: '',
        preContent: null,
        postContent: null,
      },
    ]);
    const wiring = createTestRunRegistryWiring({
      runStore,
      repoStore,
      sessionRunner: { runPrompt: runPromptMock, resumeSession: resumeSessionMock },
      oauthClient,
      runChangedFilesReader: createTestRunChangedFilesReader(getLiveRunChangedFiles),
    });

    // Pre-create the Run so we can seed touchedFiles before sendMessage
    // fires the commit subagent.
    const activeRun = wiring.runRegistry.create({
      runId: 'run-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      conversationId: 'conv-1',
      provider: 'claude',
      session: runs[0]!,
      hasProviderSession: true,
    });
    activeRun.touchedFiles.add('/abs/path/to/src/foo.ts');
    activeRun.touchedFiles.add('/abs/path/to/src/bar.ts');

    const localAgentService = new LocalAgentService({
      capabilityCatalog: SETTLED_CATALOG_AVAILABILITY,
      ...LOCAL_AGENT_SERVICE_TEST_DEPENDENCIES,
      runStore,
      repoStore,
      runRegistry: wiring.runRegistry,
      promptTypeRegistry: wiring.promptTypeRegistry,
      workflowsApi: wiring.workflowsApi,
      messagesApi: wiring.messagesApi,
    });

    await localAgentService.sendMessage(TEST_ADMITTED_HOST_ACTION, 'run-1', {
      promptType: 'commit',
      payload: {
        promptType: 'commit',
        changedFiles: [],
        userMessage: 'focus on the CLI cleanup',
      } as never,
      references: { resolved: [], unresolved: [] },
    });

    await waitForMock(subagentMock);

    expect(subagentMock).toHaveBeenCalledTimes(1);
    const subagentArgs = subagentMock.mock.calls[0]![0] as SubAgentArgs;
    expect(subagentArgs.session.agentic_session_id).toBe('run-1');
    expect(getLiveRunChangedFiles).toHaveBeenCalledWith(
      activeRun.session,
      activeRun.getFileChangeProjection(),
    );
    expect(subagentArgs.touchedFiles).toEqual(['/abs/path/to/src/foo.ts']);
    expect(subagentArgs.prompt).toContain('/abs/path/to/src/foo.ts');
    expect(subagentArgs.prompt).toContain('focus on the CLI cleanup');
    expect(subagentArgs.oauthClient).toBe(oauthClient);
    expect(subagentArgs.onAgentOutput).not.toBe(activeRun.onAgentOutput);

    expect(runPromptMock).not.toHaveBeenCalled();
    expect(resumeSessionMock).not.toHaveBeenCalled();
  });
});

vi.mock('../../agents/prompts/session-start-context', () => ({
  readSessionStartContext: async () => ({
    workItemTypeDefinitions: [],
    intentFirst: false,
    maturity: 'ESTABLISHED',
  }),
}));
