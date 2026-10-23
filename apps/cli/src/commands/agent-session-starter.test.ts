import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgenticSession } from '../session/index';
import { NOOP_LOGGER } from '../server/logger';
import type { LocalPendingRunContext } from '../shared/agent-bridge-contract/contract';
import type { ConversationStartRunRequestDto } from '../shared/api/generated/api';
import {
  AgentSessionConfigV2TypeEnum,
  AgentSessionConfigV2VersionEnum,
  LocalPromptType,
  SessionMethod,
} from '../shared/agent-bridge-contract/generated/api';
import { startAgenticSession } from './agent-session-starter';
import { RepoMappingStore, toRepositoryPath, toServiceId, type ServiceRepoBinding } from '../repo';
import { RunStore } from '../run-store';

const context: LocalPendingRunContext = {
  projectId: 'project-1',
  serviceIds: ['svc-1'],
  launchServiceId: 'svc-1',
  planId: 'plan-1',
  stepId: 'step-1',
};

const mappedRepo = (): ServiceRepoBinding => ({
  serviceId: toServiceId('svc-1'),
  repositoryPath: toRepositoryPath('/tmp/repo'),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const createRepoStore = (binding: ServiceRepoBinding | null): RepoMappingStore => {
  const store = new RepoMappingStore();
  vi.spyOn(store, 'getBinding').mockResolvedValue(binding);
  return store;
};

const createRunStore = (created?: AgenticSession): RunStore => {
  const store = new RunStore();
  const createRun = vi.spyOn(store, 'createRun');
  if (created) {
    createRun.mockResolvedValue(created);
  } else {
    createRun.mockRejectedValue(new Error('Unexpected createRun call.'));
  }
  return store;
};

const createContextMetadata = (taskId = 'task-1') => ({
  capturedAt: new Date().toISOString(),
  organizationId: 'org-1',
  projectId: 'project-1',
  agentSessionId: 'agent-session-1',
  launchPlanId: 'plan-1',
  launchStepId: 'step-1',
  task: {
    id: taskId,
    name: 'Add guided launch',
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

const evaluateWithApiTaskMonitorAdmission = (params: {
  contextTaskMonitorId: string;
  requestedConfig: object;
  persistedConfig: object;
  persistedAutoDecide: boolean;
}): { status: string } => {
  const adjacentApiRoot = resolve(process.cwd(), '../api');
  const apiRoot = existsSync(adjacentApiRoot)
    ? adjacentApiRoot
    : resolve(process.cwd(), '../../../api');
  const registerPath = resolve(apiRoot, 'node_modules/ts-node/register/transpile-only');
  const evaluatorPath = resolve(apiRoot, 'src/services/task-monitor-start-run-configuration.ts');
  const script = [
    `require(${JSON.stringify(registerPath)});`,
    `const { evaluateTaskMonitorStartRunConfiguration } = require(${JSON.stringify(evaluatorPath)});`,
    `process.stdout.write(JSON.stringify(evaluateTaskMonitorStartRunConfiguration(${JSON.stringify(params)})));`,
  ].join('');
  return JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' })) as {
    status: string;
  };
};

describe('startAgenticSession', () => {
  it('returns repo-required when selected service has no mapped repo', async () => {
    const repoStore = createRepoStore(null);
    const runStore = createRunStore();

    const result = await startAgenticSession({
      entity: null,
      context,
      contextMetadata: createContextMetadata(),
      conversationId: 'conv-1',
      repoStore,
      runStore,
    });

    expect(result).toEqual({
      status: 'repo-required',
      serviceIds: ['svc-1'],
      launchServiceId: 'svc-1',
    });
    expect(runStore.createRun).not.toHaveBeenCalled();
  });

  it('creates an agentic session when selected service has mapped repo', async () => {
    const created: AgenticSession = {
      entity: null,
      agentic_session_id: 'agentic-1',
      services: [{ id: 'svc-1', path: '/tmp/repo' }],
      launchServiceId: 'svc-1',
      provider: 'claude',
      provider_session_id: 'provider_1',
      provider_conversation_id: null,
      status: 'idle',
      conversationId: 'conv-1',
      contextMetadata: createContextMetadata(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      events: [],
    };

    const repoStore = createRepoStore(mappedRepo());
    const runStore = createRunStore(created);

    const result = await startAgenticSession({
      entity: null,
      context,
      contextMetadata: createContextMetadata(),
      conversationId: 'conv-1',
      repoStore,
      runStore,
      createProviderSessionId: () => 'provider_1',
    });

    expect(result).toEqual({
      status: 'started',
      session: created,
    });
    expect(runStore.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: null,
        agentic_session_id: 'agent-session-1',
        services: [{ id: 'svc-1', path: '/tmp/repo' }],
        launchServiceId: 'svc-1',
        provider: 'claude',
        provider_session_id: 'provider_1',
        provider_conversation_id: null,
        conversationId: 'conv-1',
        contextMetadata: expect.objectContaining({
          organizationId: 'org-1',
          projectId: 'project-1',
          agentSessionId: 'agent-session-1',
          task: expect.objectContaining({
            id: 'task-1',
          }),
        }),
      }),
    );
  });

  it.each([
    [LocalPromptType.EntityConversation, { entityType: 'TASK', entityId: 'task-graph-1' }],
    [LocalPromptType.FeatureTreeConversation, null],
    [LocalPromptType.AgentSearch, null],
  ] as const)(
    'creates Service-free %s sessions without consulting repository mappings',
    async (promptType, entity) => {
      const contextMetadata = createContextMetadata('task-graph-1');
      const created = {
        entity,
        agentic_session_id: 'agentic-graph-1',
        services: [],
        provider: 'codex',
        provider_session_id: 'provider_graph_1',
        provider_conversation_id: null,
        status: 'idle',
        conversationId: 'conv-graph-1',
        promptType,
        contextMetadata,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        events: [],
      } as AgenticSession;
      const repoStore = createRepoStore(null);
      const runStore = createRunStore(created);

      await expect(
        startAgenticSession({
          entity,
          context: {
            projectId: 'project-1',
            provider: 'codex',
          },
          contextMetadata,
          conversationId: 'conv-graph-1',
          promptType,
          repoStore,
          runStore,
          createProviderSessionId: () => 'provider_graph_1',
        }),
      ).resolves.toEqual({ status: 'started', session: created });

      expect(repoStore.getBinding).not.toHaveBeenCalled();
      expect(runStore.createRun).toHaveBeenCalledWith(
        expect.objectContaining({
          entity,
          services: [],
          provider: 'codex',
          promptType,
        }),
      );
      const createInput = vi.mocked(runStore.createRun).mock.calls[0]?.[0];
      expect(createInput).not.toHaveProperty('launchServiceId');
    },
  );

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['whitespace-only', '   '],
  ])('throws when contextMetadata.agentSessionId is %s', async (_label, rawAgentSessionId) => {
    const repoStore = createRepoStore(mappedRepo());
    const runStore = createRunStore();

    const baseMetadata = createContextMetadata();
    const { agentSessionId: _omitted, ...rest } = baseMetadata;
    const contextMetadata = (
      rawAgentSessionId === undefined ? rest : { ...rest, agentSessionId: rawAgentSessionId }
    ) as typeof baseMetadata;

    await expect(
      startAgenticSession({
        entity: null,
        context,
        contextMetadata,
        conversationId: 'conv-1',
        repoStore,
        runStore,
      }),
    ).rejects.toThrow(/agentSessionId is required/i);

    expect(runStore.createRun).not.toHaveBeenCalled();
  });

  it('creates task-origin sessions without plan-step metadata', async () => {
    const created: AgenticSession = {
      entity: null,
      agentic_session_id: 'agentic-2',
      services: [{ id: 'svc-1', path: '/tmp/repo' }],
      launchServiceId: 'svc-1',
      provider: 'claude',
      provider_session_id: 'provider_2',
      provider_conversation_id: null,
      status: 'idle',
      conversationId: 'conv-1',
      contextMetadata: createContextMetadata('task-2'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      events: [],
    };

    const repoStore = createRepoStore(mappedRepo());
    const runStore = createRunStore(created);

    const result = await startAgenticSession({
      entity: { entityType: 'TASK', entityId: 'task-2' },
      context: {
        projectId: 'project-1',
        serviceIds: ['svc-1'],
        launchServiceId: 'svc-1',
      },
      contextMetadata: createContextMetadata('task-2'),
      conversationId: 'conv-1',
      repoStore,
      runStore,
      createProviderSessionId: () => 'provider_2',
    });

    expect(result).toEqual({
      status: 'started',
      session: created,
    });
    expect(runStore.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        services: [{ id: 'svc-1', path: '/tmp/repo' }],
        launchServiceId: 'svc-1',
        provider: 'claude',
        provider_session_id: 'provider_2',
        provider_conversation_id: null,
        conversationId: 'conv-1',
        contextMetadata: expect.objectContaining({
          organizationId: 'org-1',
          projectId: 'project-1',
          task: expect.objectContaining({
            id: 'task-2',
          }),
        }),
      }),
    );
  });

  it('forwards model, reasoningEffort, and explicit false Fast mode to createRun', async () => {
    const created: AgenticSession = {
      entity: null,
      agentic_session_id: 'agentic-3',
      services: [{ id: 'svc-1', path: '/tmp/repo' }],
      launchServiceId: 'svc-1',
      provider: 'claude',
      provider_session_id: 'provider_3',
      provider_conversation_id: null,
      status: 'idle',
      conversationId: 'conv-1',
      model: 'claude-opus-4-6',
      reasoningEffort: 'high',
      fastMode: false,
      contextMetadata: createContextMetadata(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      events: [],
    };

    const repoStore = createRepoStore(mappedRepo());
    const runStore = createRunStore(created);

    const result = await startAgenticSession({
      entity: null,
      context,
      contextMetadata: createContextMetadata(),
      conversationId: 'conv-1',
      model: 'claude-opus-4-6',
      reasoningEffort: 'high',
      fastMode: false,
      repoStore,
      runStore,
      createProviderSessionId: () => 'provider_3',
    });

    expect(result).toEqual({ status: 'started', session: created });
    expect(runStore.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-opus-4-6',
        reasoningEffort: 'high',
        fastMode: false,
      }),
    );
  });

  it('forwards promptType to createRun', async () => {
    const created: AgenticSession = {
      entity: null,
      agentic_session_id: 'agentic-4',
      services: [{ id: 'svc-1', path: '/tmp/repo' }],
      launchServiceId: 'svc-1',
      provider: 'claude',
      provider_session_id: 'provider_4',
      provider_conversation_id: null,
      status: 'idle',
      conversationId: 'conv-1',
      promptType: 'daily_session',
      contextMetadata: createContextMetadata(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      events: [],
    };

    const repoStore = createRepoStore(mappedRepo());
    const runStore = createRunStore(created);

    const result = await startAgenticSession({
      entity: null,
      context,
      contextMetadata: createContextMetadata(),
      conversationId: 'conv-1',
      promptType: 'daily_session',
      repoStore,
      runStore,
      createProviderSessionId: () => 'provider_4',
    });

    expect(result).toEqual({ status: 'started', session: created });
    expect(runStore.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        promptType: 'daily_session',
      }),
    );
  });

  it('forwards typed AgentSession config to createRun', async () => {
    const config = {
      type: AgentSessionConfigV2TypeEnum.CodingSession,
      version: AgentSessionConfigV2VersionEnum.V2,
      model: 'claude-opus-4-7',
      projectAssistant: {
        enabled: false,
        allowEdgeUpdates: true,
        notifyDiscrepancies: true,
        allowUpdateProposals: false,
      },
    };
    const created: AgenticSession = {
      entity: null,
      agentic_session_id: 'agentic-5',
      services: [{ id: 'svc-1', path: '/tmp/repo' }],
      launchServiceId: 'svc-1',
      provider: 'claude',
      provider_session_id: 'provider_5',
      provider_conversation_id: null,
      status: 'idle',
      conversationId: 'conv-1',
      config,
      contextMetadata: createContextMetadata(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      events: [],
    };

    const repoStore = createRepoStore(mappedRepo());
    const runStore = createRunStore(created);

    const result = await startAgenticSession({
      entity: null,
      context,
      contextMetadata: createContextMetadata(),
      conversationId: 'conv-1',
      config,
      repoStore,
      runStore,
      createProviderSessionId: () => 'provider_5',
    });

    expect(result).toEqual({ status: 'started', session: created });
    expect(runStore.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        config,
      }),
    );
  });
});
