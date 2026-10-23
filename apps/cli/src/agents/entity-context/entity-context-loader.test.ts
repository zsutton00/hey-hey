import { describe, expect, it, vi } from 'vitest';
import {
  AgentSessionCurrentState,
  AgentSessionStatus,
  AgentSessionType,
  DesignDocTemplate,
  EntityType as CanonicalEntityType,
  ProjectStatus,
  TaskSource,
  type AgentSessionDto,
  type ConversationResponseDto,
  type FeatureRequirementsSection,
  type FullEntityContextDto,
  WorkStatus,
} from '../../shared/api/generated/api';
import { EntityType } from '../../shared/agent-bridge-contract/generated/api';
import { RunEntityReferenceEntityTypeEnum as RunEntityType } from '../../shared/agent-bridge-contract/generated/api';
import { NOOP_LOGGER } from '../../server/logger';
import { SubmissionToolAuth } from '../submission-tools/submission-tool-auth';
import { createTestOAuthClient } from '../../auth/oauth-client.test-support';
import type { EntityContextApiClient } from '../submission-tools/search-messages-proxy';
import { EntityContextLoader } from './entity-context-loader';

const AGENT_SESSION_ID = '11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const ORGANIZATION_ID = 'organization-1';
const PROJECT_ID = 'project-1';

const sourceAgentSession = (): AgentSessionDto => ({
  id: AGENT_SESSION_ID,
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  userId: 'user-1',
  status: AgentSessionStatus.InProgress,
  currentState: AgentSessionCurrentState.Idle,
  conversationId: CONVERSATION_ID,
  sessionDate: '2026-08-17T10:00:00.000Z',
  title: 'Source session',
  hasUnsyncedChanges: false,
  monitoringEnabled: false,
  autoDecide: false,
  type: AgentSessionType.EntityConversation,
});

const sourceConversation = (): ConversationResponseDto =>
  ({
    id: CONVERSATION_ID,
    projectId: PROJECT_ID,
    organizationId: ORGANIZATION_ID,
    initiatedBy: 'USER',
    status: 'COMPLETED',
    version: 1,
    workflowName: 'agent-entity-conversation',
    workflowAboutId: AGENT_SESSION_ID,
    workflowAboutType: 'agent-session',
    createdAt: '2026-08-17T10:00:00.000Z',
    updatedAt: '2026-08-17T10:00:03.000Z',
  }) as unknown as ConversationResponseDto;

const sourceMessages = () => [
  {
    id: 'user-1',
    projectId: PROJECT_ID,
    type: 'USER',
    status: 'COMPLETED',
    conversationId: CONVERSATION_ID,
    createdAt: '2026-08-17T10:00:01.000Z',
    data: { comment: 'What changed?' },
  },
  {
    id: 'assistant-1',
    projectId: PROJECT_ID,
    type: 'SYSTEM',
    status: 'COMPLETED',
    conversationId: CONVERSATION_ID,
    createdAt: '2026-08-17T10:00:02.000Z',
    awaitingResponse: false,
    data: { type: 'AGENT', response: 'The product changed.' },
  },
];

const successfulResponse = <T>(data: T) => ({ data: { success: true, data } });

const projectEntity = () => ({
  id: PROJECT_ID,
  name: 'Current Project',
  organizationId: ORGANIZATION_ID,
  status: ProjectStatus.Active,
  createdAt: '2026-08-17T10:00:00.000Z',
  updatedAt: '2026-08-17T10:00:00.000Z',
});

const designDocEntity = () => ({
  id: 'design-doc-1',
  name: 'Current Design Doc',
  template: DesignDocTemplate.Classic,
  status: 'DRAFT',
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  tags: [],
  createdAt: '2026-08-17T10:00:00.000Z',
  updatedAt: '2026-08-17T10:00:00.000Z',
});

const workItemEntity = (type: string, id = 'work-item-1') => ({
  id,
  name: `Current ${type}`,
  type,
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  status: WorkStatus.Backlog,
  source: TaskSource.User,
});

const canonicalContext = (
  entityId: string,
  entityType: CanonicalEntityType,
  displayName = 'Current Entity',
): FullEntityContextDto => ({
  entityId,
  entityType,
  displayName,
  createdAt: '2026-08-17T10:00:00.000Z',
});

const canonicalRequirementsSection = (): FeatureRequirementsSection => ({
  records: [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      statement: 'Users can review the durable requirement records.',
      group: 'Review',
      designedBy: [
        {
          entityType: 'DESIGN_DOC',
          entityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          entityTitle: 'Review design',
        },
      ],
      fulfilledBy: [
        {
          entityType: 'TASK',
          entityId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          entityTitle: 'Review task',
        },
        {
          entityType: 'PLAN',
          entityId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          entityTitle: 'Review plan',
        },
      ],
      contracts: [
        {
          entityType: 'CONTRACT',
          entityId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          entityTitle: 'Review contract',
        },
      ],
    },
    {
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      statement: 'Editors can preserve record identity through targeted changes.',
      designedBy: [],
      fulfilledBy: [],
      contracts: [],
    },
  ],
});

const canonicalFeatureContext = (
  entityId: string,
  displayName = 'Current Feature',
): FullEntityContextDto => {
  const requirementsSection = canonicalRequirementsSection();
  return {
    ...canonicalContext(entityId, CanonicalEntityType.Task, displayName),
    taskType: 'FEATURE',
    content: {
      sections: {
        description: 'A feature with canonical requirements.',
        requirements: JSON.stringify(requirementsSection),
        acceptanceCriteria: 'Every field remains available to the agent.',
      },
      status: 'ACTIVE',
      priority: 'HIGH',
      assigneeId: '99999999-9999-4999-8999-999999999999',
      dueDate: '2026-08-31T10:00:00.000Z',
      requirementsSection,
    },
  };
};

const buildLoader = (client: Partial<EntityContextApiClient>) =>
  new EntityContextLoader({
    auth: new SubmissionToolAuth(createTestOAuthClient({ success: true, data: 'access-token' })),
    apiBaseUrl: 'https://api.test/v1',
    logger: NOOP_LOGGER,
    createClient: () =>
      ({
        getMessages: vi.fn().mockResolvedValue({ data: { data: sourceMessages() } }),
        ...client,
        getEntityContext:
          client.getEntityContext ??
          vi
            .fn()
            .mockResolvedValue(
              successfulResponse(
                canonicalContext(
                  AGENT_SESSION_ID,
                  CanonicalEntityType.AgentSession,
                  'Source session',
                ),
              ),
            ),
      }) as EntityContextApiClient,
  });

const runEntity = { entityType: EntityType.AgentSession, entityId: AGENT_SESSION_ID } as const;

describe('EntityContextLoader', () => {
  it.each([
    ['unreadable', () => Promise.reject(new Error('offline'))],
    ['malformed', () => Promise.resolve({ data: { data: [{ id: '' }] } })],
    [
      'mismatched',
      () =>
        Promise.resolve({
          data: {
            data: sourceMessages().map((message) => ({ ...message, conversationId: 'other' })),
          },
        }),
    ],
  ])('rejects %s Message reads', async (_name, read) => {
    const loader = buildLoader({
      getAgentSession: vi.fn().mockResolvedValue({ data: { data: sourceAgentSession() } }),
      getConversation: vi.fn().mockResolvedValue({ data: { data: sourceConversation() } }),
      getMessages: vi.fn().mockImplementation(read),
    });
    await expect(
      loader.load({ runEntity, organizationId: ORGANIZATION_ID, projectId: PROJECT_ID }),
    ).rejects.toThrow(/Messages/);
  });

  it.each([false, true])(
    'reads the persisted Agent Session and attached canonical conversation (paged: %s)',
    async (paged) => {
      const readAgentSession = vi.fn().mockResolvedValue({
        data: { data: sourceAgentSession() },
      });
      const getConversation = vi.fn().mockResolvedValue({
        data: { data: sourceConversation() },
      });
      const getMessages = vi
        .fn()
        .mockResolvedValue({
          data: { data: paged ? { messages: sourceMessages() } : sourceMessages() },
        });
      const getEntityContext = vi
        .fn()
        .mockResolvedValue(
          successfulResponse(
            canonicalContext(AGENT_SESSION_ID, CanonicalEntityType.AgentSession, 'Source session'),
          ),
        );
      const loader = buildLoader({
        getAgentSession: readAgentSession,
        getConversation,
        getMessages,
        getEntityContext,
      } as unknown as EntityContextApiClient);

      const context = await loader.load({
        runEntity,
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
      });

      expect(readAgentSession).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        agentSessionId: AGENT_SESSION_ID,
      });
      expect(getConversation).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
      });
      expect(getMessages).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        includeProposals: false,
        includeReports: false,
      });
      expect(getEntityContext).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        entityType: CanonicalEntityType.AgentSession,
        entityId: AGENT_SESSION_ID,
      });
      expect(context).toMatchObject({
        kind: 'agent_session',
        focalEntity: runEntity,
        entity: { id: AGENT_SESSION_ID, title: 'Source session' },
        context: {
          entityId: AGENT_SESSION_ID,
          entityType: CanonicalEntityType.AgentSession,
        },
        agentSession: { id: AGENT_SESSION_ID, title: 'Source session' },
        conversationId: CONVERSATION_ID,
        transcript: [
          { role: 'user', turn: 1, content: 'What changed?' },
          { role: 'assistant', turn: 1, content: 'The product changed.' },
        ],
      });
    },
  );

  it('reads an attached conversation whose durable subject is a Plan', async () => {
    const conversation = sourceConversation();
    conversation.workflowAboutId = '33333333-3333-4333-8333-333333333333';
    conversation.workflowAboutType = 'plan';
    const loader = buildLoader({
      getAgentSession: vi.fn().mockResolvedValue({ data: { data: sourceAgentSession() } }),
      getConversation: vi.fn().mockResolvedValue({ data: { data: conversation } }),
    } as unknown as EntityContextApiClient);

    await expect(
      loader.load({ runEntity, organizationId: ORGANIZATION_ID, projectId: PROJECT_ID }),
    ).resolves.toMatchObject({
      kind: 'agent_session',
      focalEntity: runEntity,
      agentSession: { id: AGENT_SESSION_ID },
      conversationId: CONVERSATION_ID,
    });
  });

  it('rejects a source Agent Session whose organization or project differs', async () => {
    const agentSession = sourceAgentSession();
    agentSession.projectId = 'other-project';
    const loader = buildLoader({
      getAgentSession: vi.fn().mockResolvedValue({ data: { data: agentSession } }),
      getConversation: vi.fn(),
    } as unknown as EntityContextApiClient);

    await expect(
      loader.load({ runEntity, organizationId: ORGANIZATION_ID, projectId: PROJECT_ID }),
    ).rejects.toThrow(/persisted Run identity/);
  });

  it('rejects a missing or mismatched attached conversation', async () => {
    const agentSession = sourceAgentSession();
    agentSession.conversationId = null;
    const loader = buildLoader({
      getAgentSession: vi.fn().mockResolvedValue({ data: { data: agentSession } }),
      getConversation: vi.fn(),
    } as unknown as EntityContextApiClient);

    await expect(
      loader.load({ runEntity, organizationId: ORGANIZATION_ID, projectId: PROJECT_ID }),
    ).rejects.toThrow(/attached source conversation/);

    const mismatchedConversation = sourceConversation();
    mismatchedConversation.id = 'other-conversation';
    const mismatchedLoader = buildLoader({
      getAgentSession: vi.fn().mockResolvedValue({ data: { data: sourceAgentSession() } }),
      getConversation: vi.fn().mockResolvedValue({
        data: { data: mismatchedConversation },
      }),
    } as unknown as EntityContextApiClient);

    await expect(
      mismatchedLoader.load({
        runEntity,
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow(/attached conversation identity/);
  });

  it('keeps non-Agent Session entity context on the generic typed branch', async () => {
    const readAgentSession = vi.fn();
    const readWorkItem = vi
      .fn()
      .mockResolvedValue(successfulResponse(workItemEntity('STANDARD', AGENT_SESSION_ID)));
    const getEntityContext = vi
      .fn()
      .mockResolvedValue(
        successfulResponse(canonicalContext(AGENT_SESSION_ID, CanonicalEntityType.Task)),
      );
    const loader = buildLoader({
      getAgentSession: readAgentSession,
      getConversation: vi.fn(),
      organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet: readWorkItem,
      getEntityContext,
    } as unknown as EntityContextApiClient);

    await expect(
      loader.load({
        runEntity: { entityType: EntityType.Task, entityId: AGENT_SESSION_ID },
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toMatchObject({
      kind: 'entity',
      focalEntity: { entityType: EntityType.Task, entityId: AGENT_SESSION_ID },
      entity: { id: AGENT_SESSION_ID, type: 'STANDARD' },
      context: { entityId: AGENT_SESSION_ID, entityType: CanonicalEntityType.Task },
    });
    expect(readWorkItem).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      taskId: AGENT_SESSION_ID,
    });
    expect(getEntityContext).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      entityType: CanonicalEntityType.Task,
      entityId: AGENT_SESSION_ID,
    });
    expect(readAgentSession).not.toHaveBeenCalled();
  });

  it.each([
    [RunEntityType.Project, projectEntity(), PROJECT_ID, CanonicalEntityType.Project],
    [RunEntityType.DesignDoc, designDocEntity(), 'design-doc-1', CanonicalEntityType.DesignDoc],
  ] as const)(
    'loads the current %s and canonical Context independently',
    async (entityType, entity, entityId, canonicalEntityType) => {
      const findOneProject = vi.fn().mockResolvedValue(successfulResponse(projectEntity()));
      const readDesignDoc = vi.fn().mockResolvedValue(successfulResponse(designDocEntity()));
      const getEntityContext = vi
        .fn()
        .mockResolvedValue(successfulResponse(canonicalContext(entityId, canonicalEntityType)));
      const loader = buildLoader({
        organizationsOrganizationIdProjectsProjectIdAgentSessionsAgentSessionIdGet: vi.fn(),
        getConversation: vi.fn(),
        findOneProject,
        organizationsOrganizationIdDesignDocsDesignDocIdGet: readDesignDoc,
        getEntityContext,
      } as unknown as EntityContextApiClient);

      const context = await loader.load({
        runEntity: { entityType, entityId },
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
      });

      expect(context).toMatchObject({
        kind: 'entity',
        focalEntity: { entityType, entityId },
        entity: { id: entityId },
        context: { entityId, entityType: canonicalEntityType },
      });
      expect(getEntityContext).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        entityType: canonicalEntityType,
        entityId,
      });
      if (entityType === RunEntityType.Project) {
        expect(findOneProject).toHaveBeenCalledWith({
          organizationId: ORGANIZATION_ID,
          projectId: entityId,
        });
        expect(readDesignDoc).not.toHaveBeenCalled();
      }
      if (entityType === RunEntityType.DesignDoc) {
        expect(readDesignDoc).toHaveBeenCalledWith({
          organizationId: ORGANIZATION_ID,
          designDocId: entityId,
        });
        expect(findOneProject).not.toHaveBeenCalled();
      }
      expect(entity).toBeDefined();
    },
  );

  it.each([
    [RunEntityType.Task, 'PLAN'],
    [RunEntityType.Task, 'PLAN_STAGE'],
    [RunEntityType.Task, 'FEATURE'],
    [RunEntityType.Task, 'BUG'],
    [RunEntityType.Task, 'GOAL'],
    [RunEntityType.Task, 'CONTRACT'],
  ] as const)('loads %s through the generic Work Item read', async (entityType, workItemType) => {
    const entityId = `work-item-${workItemType.toLowerCase()}`;
    const readWorkItem = vi
      .fn()
      .mockResolvedValue(successfulResponse(workItemEntity(workItemType, entityId)));
    const getEntityContext = vi
      .fn()
      .mockResolvedValue(successfulResponse(canonicalContext(entityId, CanonicalEntityType.Task)));
    const loader = buildLoader({
      organizationsOrganizationIdProjectsProjectIdAgentSessionsAgentSessionIdGet: vi.fn(),
      getConversation: vi.fn(),
      organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet: readWorkItem,
      getEntityContext,
    } as unknown as EntityContextApiClient);

    await expect(
      loader.load({
        runEntity: { entityType, entityId },
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toMatchObject({
      kind: 'entity',
      focalEntity: { entityType, entityId },
      entity: { id: entityId, type: workItemType },
      context: { entityId, entityType: CanonicalEntityType.Task },
    });
    expect(readWorkItem).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      taskId: entityId,
    });
  });

  it('passes the canonical requirements collection through without parsing or projection', async () => {
    const entityId = 'work-item-feature-canonical';
    const canonical = canonicalFeatureContext(entityId);
    const readWorkItem = vi
      .fn()
      .mockResolvedValue(successfulResponse(workItemEntity('FEATURE', entityId)));
    const getEntityContext = vi.fn().mockResolvedValue(successfulResponse(canonical));
    const loader = buildLoader({
      organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet: readWorkItem,
      getEntityContext,
    } as unknown as EntityContextApiClient);

    const loaded = await loader.load({
      runEntity: { entityType: RunEntityType.Task, entityId },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
    });

    expect(loaded.context).toEqual(canonical);
    expect(loaded.context.content).toEqual(canonical.content);
    expect(loaded.context.content?.sections['requirements']).toBe(
      canonical.content?.sections['requirements'],
    );
    expect(loaded.context.content?.requirementsSection).toEqual(
      canonical.content?.requirementsSection,
    );
  });

  it('retains a project-defined Work Item type exactly as returned by the authoritative read', async () => {
    const entityId = 'work-item-custom';
    const readWorkItem = vi
      .fn()
      .mockResolvedValue(successfulResponse(workItemEntity('Release-Review', entityId)));
    const loader = buildLoader({
      organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet: readWorkItem,
      getEntityContext: vi
        .fn()
        .mockResolvedValue(
          successfulResponse(canonicalContext(entityId, CanonicalEntityType.Task)),
        ),
    } as unknown as EntityContextApiClient);

    await expect(
      loader.load({
        runEntity: { entityType: RunEntityType.Task, entityId },
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toMatchObject({
      entity: { id: entityId, type: 'Release-Review' },
    });
  });

  it('rejects unsupported focal types without falling back to copied prompt content', async () => {
    const oauthClient = createTestOAuthClient();
    const authSpy = vi.spyOn(oauthClient, 'getAccessToken');
    const loader = new EntityContextLoader({
      auth: new SubmissionToolAuth(oauthClient),
      apiBaseUrl: 'https://api.test/v1',
      logger: NOOP_LOGGER,
      createClient: () => ({}) as EntityContextApiClient,
    });

    await expect(
      loader.load({
        runEntity: { entityType: EntityType.Artifact, entityId: 'artifact-1' },
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow(/does not support focal entity type/);
    expect(authSpy).not.toHaveBeenCalled();
  });

  it('rejects malformed entity responses and does not read canonical Context', async () => {
    const getEntityContext = vi.fn();
    const loader = buildLoader({
      findOneProject: vi.fn().mockResolvedValue({ data: { success: true } }),
      getEntityContext,
    } as unknown as EntityContextApiClient);

    await expect(
      loader.load({
        runEntity: { entityType: EntityType.Project, entityId: PROJECT_ID },
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow(/malformed project data/);
    expect(getEntityContext).not.toHaveBeenCalled();
  });

  it('rejects entity identity or scope mismatches', async () => {
    const getEntityContext = vi.fn();
    const loader = buildLoader({
      findOneProject: vi
        .fn()
        .mockResolvedValue(successfulResponse({ ...projectEntity(), id: 'other-project' })),
      getEntityContext,
    } as unknown as EntityContextApiClient);

    await expect(
      loader.load({
        runEntity: { entityType: EntityType.Project, entityId: PROJECT_ID },
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow(/identity or scope mismatch/);
    expect(getEntityContext).not.toHaveBeenCalled();
  });

  it('rejects canonical Context read failures after the entity read succeeds', async () => {
    const getEntityContext = vi.fn().mockRejectedValue(new Error('context unavailable'));
    const loader = buildLoader({
      findOneProject: vi.fn().mockResolvedValue(successfulResponse(projectEntity())),
      getEntityContext,
    } as unknown as EntityContextApiClient);

    await expect(
      loader.load({
        runEntity: { entityType: EntityType.Project, entityId: PROJECT_ID },
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow(/canonical Context read failed/);
  });

  it('rejects entity-read failures before attempting canonical Context', async () => {
    const getEntityContext = vi.fn();
    const loader = buildLoader({
      findOneProject: vi.fn().mockRejectedValue(new Error('project unavailable')),
      getEntityContext,
    } as unknown as EntityContextApiClient);

    await expect(
      loader.load({
        runEntity: { entityType: EntityType.Project, entityId: PROJECT_ID },
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow(/project read failed/);
    expect(getEntityContext).not.toHaveBeenCalled();
  });

  it('rejects canonical Context identity mismatches', async () => {
    const loader = buildLoader({
      findOneProject: vi.fn().mockResolvedValue(successfulResponse(projectEntity())),
      getEntityContext: vi
        .fn()
        .mockResolvedValue(
          successfulResponse(canonicalContext('other-project', CanonicalEntityType.Project)),
        ),
    } as unknown as EntityContextApiClient);

    await expect(
      loader.load({
        runEntity: { entityType: EntityType.Project, entityId: PROJECT_ID },
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow(/canonical Context identity or scope mismatch/);
  });

  it('rejects authentication failures before either authoritative read', async () => {
    const oauthClient = createTestOAuthClient({ success: false, error: 'expired token' });
    const authSpy = vi.spyOn(oauthClient, 'getAccessToken');
    const findOneProject = vi.fn();
    const loader = new EntityContextLoader({
      auth: new SubmissionToolAuth(oauthClient),
      apiBaseUrl: 'https://api.test/v1',
      logger: NOOP_LOGGER,
      createClient: () => ({ findOneProject }) as unknown as EntityContextApiClient,
    });

    await expect(
      loader.load({
        runEntity: { entityType: EntityType.Project, entityId: PROJECT_ID },
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow(/could not authenticate/);
    expect(authSpy).toHaveBeenCalled();
    expect(findOneProject).not.toHaveBeenCalled();
  });
});
