import { EntityType, SummaryCategory, WorkStatus } from '@prisma/client';
import { EntityLifecycleProcessor } from '../../../core/processing/entity-lifecycle-processor.service';

describe('EntityLifecycleProcessor', () => {
  let entitySummaryService: any;
  let initiativeService: any;
  let entityRegistryService: any;
  let prismaService: any;
  let temporalClient: any;
  let taskDependencyInferenceService: any;
  let processor: EntityLifecycleProcessor;

  beforeEach(() => {
    entitySummaryService = {
      createSummaryWithSubfacets: jest.fn().mockResolvedValue({}),
      deactivateCurrentSummaries: jest.fn(),
    };
    initiativeService = {
      findOne: jest.fn().mockResolvedValue({ sourceType: 'TASK' }),
    };
    entityRegistryService = {
      registerEntity: jest.fn().mockResolvedValue(undefined),
      markEntityDeleted: jest.fn(),
      recordEntityDeletion: jest.fn().mockResolvedValue(undefined),
    };
    prismaService = {
      db: {
        task: {
          findFirst: jest.fn().mockResolvedValue({ name: 'My Task' }),
        },
        initiative: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ name: 'Renamed Initiative' }),
        },
        designDoc: {
          findFirst: jest.fn().mockResolvedValue({ name: 'My Design Doc' }),
        },
        conversation: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ title: 'Conversation title' }),
        },
        project: {
          findFirst: jest.fn().mockResolvedValue({ name: 'Project Alpha' }),
        },
        message: {
          findFirst: jest.fn().mockResolvedValue({ type: 'SYSTEM' }),
        },
      },
    };
    temporalClient = {
      workflow: {
        start: jest.fn().mockResolvedValue('workflow-id'),
      },
    };
    taskDependencyInferenceService = {
      queueInference: jest.fn(),
    };

    processor = new EntityLifecycleProcessor(
      entitySummaryService,
      initiativeService,
      entityRegistryService,
      prismaService,
      taskDependencyInferenceService,
    );
  });

  it('handles task creation by registering entity and creating summary', async () => {
    await processor.handleTaskCreated({
      organizationId: 'org-1' as any,
      taskId: 'task-1' as any,
      name: 'My Task',
      initiativeId: 'initiative-1' as any,
      projectId: 'proj-1' as any,
    });

    expect(entityRegistryService.registerEntity).toHaveBeenCalledWith({
      organizationId: 'org-1',
      entityId: 'task-1',
      entityType: EntityType.TASK,
      name: 'My Task',
    });
    expect(
      taskDependencyInferenceService.queueInference,
    ).not.toHaveBeenCalled();
    // subfacet/summary creation removed from processor
  });

  it('updates registry on task rename', async () => {
    await processor.handleTaskUpdated({
      organizationId: 'org-1' as any,
      taskId: 'task-1' as any,
      name: 'Renamed task',
      update: {
        name: 'Renamed task',
      },
      initiativeId: 'initiative-1' as any,
      projectId: 'proj-1' as any,
    });

    expect(entityRegistryService.registerEntity).toHaveBeenCalledWith({
      organizationId: 'org-1',
      entityId: 'task-1',
      entityType: EntityType.TASK,
      name: 'Renamed task',
    });
    expect(
      taskDependencyInferenceService.queueInference,
    ).not.toHaveBeenCalled();
  });

  it('archives registry and summaries on task archive', async () => {
    entityRegistryService.recordEntityDeletion.mockResolvedValue(undefined);
    entitySummaryService.deactivateCurrentSummaries.mockResolvedValue(
      undefined,
    );

    await processor.handleTaskArchived({
      organizationId: 'org-1' as any,
      taskId: 'task-1',
      archivedAt: '2024-01-01T00:00:00Z',
      projectId: 'proj-1' as any,
    });

    expect(entityRegistryService.recordEntityDeletion).toHaveBeenCalledWith({
      organizationId: 'org-1',
      entityId: 'task-1',
      entityType: EntityType.TASK,
      name: 'My Task',
      deletedAt: new Date('2024-01-01T00:00:00Z'),
    });
    expect(
      entitySummaryService.deactivateCurrentSummaries,
    ).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'proj-1',
      entityType: EntityType.TASK,
      entityId: 'task-1',
    });
  });

  it('queues dependency inference when task leaves acceptance criteria refinement', async () => {
    await processor.handleTaskUpdated({
      organizationId: 'org-1' as any,
      taskId: 'task-1' as any,
      update: {
        status: WorkStatus.BACKLOG,
      },
      previousData: {
        status: WorkStatus.REFINING_ACCEPTANCE_CRITERIA,
      },
      initiativeId: 'initiative-1' as any,
      projectId: 'proj-1' as any,
    });

    expect(taskDependencyInferenceService.queueInference).toHaveBeenCalledWith({
      organizationId: 'org-1',
      initiativeId: 'initiative-1',
      projectId: 'proj-1',
      taskId: 'task-1',
    });
  });

  it('handles initiative lifecycle (create/update/archive)', async () => {
    entityRegistryService.registerEntity.mockResolvedValue(undefined);
    entityRegistryService.recordEntityDeletion.mockResolvedValue(undefined);
    entitySummaryService.deactivateCurrentSummaries.mockResolvedValue(
      undefined,
    );

    await processor.handleInitiativeCreated({
      organizationId: 'org-1' as any,
      initiativeId: 'init-1',
      name: 'My Initiative',
    });
    await processor.handleInitiativeUpdated({
      organizationId: 'org-1' as any,
      initiativeId: 'init-1',
      name: 'Renamed Initiative',
    });
    await processor.handleInitiativeArchived({
      organizationId: 'org-1' as any,
      initiativeId: 'init-1',
      archivedAt: '2024-01-02T00:00:00Z',
      projectId: 'proj-1' as any,
    });

    expect(entityRegistryService.registerEntity).toHaveBeenCalledWith({
      organizationId: 'org-1',
      entityId: 'init-1',
      entityType: EntityType.INITIATIVE,
      name: 'My Initiative',
    });
    expect(entityRegistryService.registerEntity).toHaveBeenCalledWith({
      organizationId: 'org-1',
      entityId: 'init-1',
      entityType: EntityType.INITIATIVE,
      name: 'Renamed Initiative',
    });
    expect(entityRegistryService.recordEntityDeletion).toHaveBeenCalledWith({
      organizationId: 'org-1',
      entityId: 'init-1',
      entityType: EntityType.INITIATIVE,
      name: 'Renamed Initiative',
      deletedAt: new Date('2024-01-02T00:00:00Z'),
    });
    expect(
      entitySummaryService.deactivateCurrentSummaries,
    ).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'proj-1',
      entityType: EntityType.INITIATIVE,
      entityId: 'init-1',
    });
  });

  it('archives design docs through the shared deletion cleanup path', async () => {
    entityRegistryService.registerEntity.mockResolvedValue(undefined);
    entityRegistryService.recordEntityDeletion.mockResolvedValue(undefined);
    entitySummaryService.deactivateCurrentSummaries.mockResolvedValue(
      undefined,
    );

    await processor.handleDesignDocCreated({
      organizationId: 'org-1' as any,
      designDocId: 'doc-1',
      name: 'My Design Doc',
    });
    await processor.handleDesignDocArchived({
      organizationId: 'org-1' as any,
      designDocId: 'doc-1',
      archivedAt: '2024-02-01T00:00:00Z',
      projectId: 'proj-1' as any,
    });

    expect(entityRegistryService.registerEntity).toHaveBeenCalledWith({
      organizationId: 'org-1',
      entityId: 'doc-1',
      entityType: EntityType.DESIGN_DOC,
      name: 'My Design Doc',
    });
    expect(entityRegistryService.recordEntityDeletion).toHaveBeenCalledWith({
      organizationId: 'org-1',
      entityId: 'doc-1',
      entityType: EntityType.DESIGN_DOC,
      name: 'My Design Doc',
      deletedAt: new Date('2024-02-01T00:00:00Z'),
    });
    expect(
      entitySummaryService.deactivateCurrentSummaries,
    ).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'proj-1',
      entityType: EntityType.DESIGN_DOC,
      entityId: 'doc-1',
    });
  });

  it('handles conversation lifecycle (create/update/delete)', async () => {
    entityRegistryService.registerEntity.mockResolvedValue(undefined);
    entityRegistryService.recordEntityDeletion.mockResolvedValue(undefined);
    entitySummaryService.deactivateCurrentSummaries.mockResolvedValue(
      undefined,
    );

    await processor.handleConversationCreated({
      organizationId: 'org-1' as any,
      conversationId: 'conv-1',
      name: 'Conversation title',
    });
    await processor.handleConversationUpdated({
      organizationId: 'org-1' as any,
      conversationId: 'conv-1',
      name: 'Updated title',
    });
    await processor.handleConversationDeleted({
      organizationId: 'org-1' as any,
      conversationId: 'conv-1',
      deletedAt: '2024-03-01T00:00:00Z',
      projectId: 'proj-1' as any,
    });

    expect(entityRegistryService.registerEntity).toHaveBeenCalledWith({
      organizationId: 'org-1',
      entityId: 'conv-1',
      entityType: EntityType.CONVERSATION,
      name: 'Conversation title',
    });
    expect(entityRegistryService.registerEntity).toHaveBeenCalledWith({
      organizationId: 'org-1',
      entityId: 'conv-1',
      entityType: EntityType.CONVERSATION,
      name: 'Updated title',
    });
    expect(entityRegistryService.recordEntityDeletion).toHaveBeenCalledWith({
      organizationId: 'org-1',
      entityId: 'conv-1',
      entityType: EntityType.CONVERSATION,
      name: 'Conversation title',
      deletedAt: new Date('2024-03-01T00:00:00Z'),
    });
    expect(
      entitySummaryService.deactivateCurrentSummaries,
    ).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'proj-1',
      entityType: EntityType.CONVERSATION,
      entityId: 'conv-1',
    });
  });

  it('handles message lifecycle (create/delete)', async () => {
    entityRegistryService.registerEntity.mockResolvedValue(undefined);
    entityRegistryService.recordEntityDeletion.mockResolvedValue(undefined);
    entitySummaryService.deactivateCurrentSummaries.mockResolvedValue(
      undefined,
    );

    await processor.handleMessageCreated({
      organizationId: 'org-1' as any,
      messageId: 'msg-1',
      type: 'SYSTEM',
      projectId: 'proj-1' as any,
      shouldProcess: true,
    });
    await processor.handleMessageDeleted({
      organizationId: 'org-1' as any,
      messageId: 'msg-1',
      deletedAt: '2024-04-01T00:00:00Z',
      projectId: 'proj-1' as any,
    });

    expect(entityRegistryService.registerEntity).toHaveBeenCalledWith({
      organizationId: 'org-1',
      entityId: 'msg-1',
      entityType: EntityType.MESSAGE,
      name: 'SYSTEM message',
    });
    expect(entityRegistryService.recordEntityDeletion).toHaveBeenCalledWith({
      organizationId: 'org-1',
      entityId: 'msg-1',
      entityType: EntityType.MESSAGE,
      name: 'SYSTEM message',
      deletedAt: new Date('2024-04-01T00:00:00Z'),
    });
    expect(
      entitySummaryService.deactivateCurrentSummaries,
    ).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'proj-1',
      entityType: EntityType.MESSAGE,
      entityId: 'msg-1',
    });
  });

  it('handles service lifecycle (create/update/archive)', async () => {
    entityRegistryService.registerEntity.mockResolvedValue(undefined);
    entityRegistryService.recordEntityDeletion.mockResolvedValue(undefined);
    entitySummaryService.deactivateCurrentSummaries.mockResolvedValue(
      undefined,
    );

    await processor.handleServiceCreated({
      organizationId: 'org-1' as any,
      serviceId: 'svc-1' as any,
      name: 'Catalog API',
    });
    await processor.handleServiceUpdated({
      organizationId: 'org-1' as any,
      serviceId: 'svc-1' as any,
      name: 'Catalog Backend',
    });
    await processor.handleServiceArchived({
      organizationId: 'org-1' as any,
      serviceId: 'svc-1' as any,
      archivedAt: '2024-05-01T00:00:00Z',
      name: 'Catalog Backend',
      projectId: 'proj-1' as any,
    });

    expect(entityRegistryService.registerEntity).toHaveBeenCalledWith({
      organizationId: 'org-1',
      entityId: 'svc-1',
      entityType: EntityType.SERVICE,
      name: 'Catalog API',
    });
    expect(entityRegistryService.registerEntity).toHaveBeenCalledWith({
      organizationId: 'org-1',
      entityId: 'svc-1',
      entityType: EntityType.SERVICE,
      name: 'Catalog Backend',
    });
    expect(entityRegistryService.recordEntityDeletion).toHaveBeenCalledWith({
      organizationId: 'org-1',
      entityId: 'svc-1',
      entityType: EntityType.SERVICE,
      name: 'Catalog Backend',
      deletedAt: new Date('2024-05-01T00:00:00Z'),
    });
    expect(
      entitySummaryService.deactivateCurrentSummaries,
    ).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'proj-1',
      entityType: EntityType.SERVICE,
      entityId: 'svc-1',
    });
  });

  it('handles project deletion by cleaning registry, summaries, and attention events', async () => {
    entityRegistryService.recordEntityDeletion.mockResolvedValue(undefined);
    entitySummaryService.deactivateCurrentSummaries.mockResolvedValue(
      undefined,
    );

    await processor.handleProjectDeleted({
      organizationId: 'org-1' as any,
      projectId: 'proj-1' as any,
      deletedAt: '2024-07-01T00:00:00Z',
    });

    expect(entityRegistryService.recordEntityDeletion).toHaveBeenCalledWith({
      organizationId: 'org-1',
      entityId: 'proj-1',
      entityType: EntityType.PROJECT,
      name: 'Project Alpha',
      deletedAt: new Date('2024-07-01T00:00:00Z'),
    });
    expect(
      entitySummaryService.deactivateCurrentSummaries,
    ).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'proj-1',
      entityType: EntityType.PROJECT,
      entityId: 'proj-1',
    });
  });

  it('registers agent session in registry on create event', async () => {
    await processor.handleAgentSessionCreated({
      type: 'agent_session.created',
      payload: {
        organizationId: 'org-1',
        agentSession: {
          id: 'cs-1',
          title: 'Session One',
        },
      },
    } as any);

    expect(entityRegistryService.registerEntity).toHaveBeenCalledWith({
      organizationId: 'org-1',
      entityId: 'cs-1',
      entityType: EntityType.AGENT_SESSION,
      name: 'Session One',
    });
  });

  it('keeps registry name in sync when agent session is renamed', async () => {
    await processor.handleAgentSessionRenamed({
      organizationId: 'org-1' as any,
      agentSessionId: 'cs-1',
      title: 'Renamed Session',
    });

    expect(entityRegistryService.registerEntity).toHaveBeenCalledWith({
      organizationId: 'org-1',
      entityId: 'cs-1',
      entityType: EntityType.AGENT_SESSION,
      name: 'Renamed Session',
    });
  });

  it('skips registry sync when rename event carries no title', async () => {
    await processor.handleAgentSessionRenamed({
      organizationId: 'org-1' as any,
      agentSessionId: 'cs-1',
      title: null,
    });

    expect(entityRegistryService.registerEntity).not.toHaveBeenCalled();
  });

  it('handles agent session deletion by cleaning registry and attention events', async () => {
    entityRegistryService.recordEntityDeletion.mockResolvedValue(undefined);
    entitySummaryService.deactivateCurrentSummaries.mockResolvedValue(
      undefined,
    );

    await processor.handleAgentSessionDeleted({
      organizationId: 'org-1' as any,
      agentSessionId: 'cs-1',
      deletedAt: '2024-08-01T00:00:00Z',
      projectId: 'proj-1' as any,
      title: 'Session One',
    });

    expect(entityRegistryService.recordEntityDeletion).toHaveBeenCalledWith({
      organizationId: 'org-1',
      entityId: 'cs-1',
      entityType: EntityType.AGENT_SESSION,
      name: 'Session One',
      deletedAt: new Date('2024-08-01T00:00:00Z'),
    });
    expect(
      entitySummaryService.deactivateCurrentSummaries,
    ).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'proj-1',
      entityType: EntityType.AGENT_SESSION,
      entityId: 'cs-1',
    });
  });

  it('registers user message but does NOT trigger summarization workflow (currently disabled)', async () => {
    await processor.handleMessageCreated({
      organizationId: 'org-1' as any,
      messageId: 'msg-2',
      type: 'USER',
      projectId: 'proj-1' as any,
      shouldProcess: true,
    });

    expect(entityRegistryService.registerEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        entityId: 'msg-2',
        entityType: EntityType.MESSAGE,
      }),
    );
    expect(temporalClient.workflow.start).not.toHaveBeenCalled();
  });

  it('does not trigger entity summarization when a task is completed', async () => {
    await processor.handleTaskStatusChanged({
      organizationId: 'org-1' as any,
      taskId: 'task-1',
      previousStatus: WorkStatus.REFINING_DESCRIPTION,
      newStatus: WorkStatus.BACKLOG,
      projectId: 'proj-1' as any,
    });

    expect(temporalClient.workflow.start).not.toHaveBeenCalled();
  });

  it('does NOT trigger summarization workflow when task is completed WITHOUT projectId', async () => {
    await processor.handleTaskStatusChanged({
      organizationId: 'org-1' as any,
      taskId: 'task-1',
      previousStatus: WorkStatus.REFINING_DESCRIPTION,
      newStatus: WorkStatus.BACKLOG,
      projectId: null,
    });

    expect(temporalClient.workflow.start).not.toHaveBeenCalled();
  });

  it('does NOT trigger summarization workflow when task status is NOT completed', async () => {
    await processor.handleTaskStatusChanged({
      organizationId: 'org-1' as any,
      taskId: 'task-1',
      previousStatus: WorkStatus.ACTIVE,
      newStatus: WorkStatus.ACTIVE,
      projectId: 'proj-1' as any,
    });

    expect(temporalClient.workflow.start).not.toHaveBeenCalled();
  });

  it('does not trigger entity summarization when an initiative is completed', async () => {
    await processor.handleInitiativeStatusChanged({
      organizationId: 'org-1' as any,
      initiativeId: 'init-1',
      previousStatus: WorkStatus.REFINING_DESCRIPTION,
      newStatus: WorkStatus.BACKLOG,
      originatingProjectId: 'proj-1' as any,
    });

    expect(temporalClient.workflow.start).not.toHaveBeenCalled();
  });

  it('does NOT trigger summarization workflow when initiative is completed WITHOUT originatingProjectId', async () => {
    await processor.handleInitiativeStatusChanged({
      organizationId: 'org-1' as any,
      initiativeId: 'init-1',
      previousStatus: WorkStatus.REFINING_DESCRIPTION,
      newStatus: WorkStatus.BACKLOG,
      originatingProjectId: null,
    });

    expect(temporalClient.workflow.start).not.toHaveBeenCalled();
  });

  it('does NOT trigger summarization workflow when initiative status is NOT completed', async () => {
    await processor.handleInitiativeStatusChanged({
      organizationId: 'org-1' as any,
      initiativeId: 'init-1',
      previousStatus: WorkStatus.ACTIVE,
      newStatus: WorkStatus.ACTIVE,
      originatingProjectId: 'proj-1' as any,
    });

    expect(temporalClient.workflow.start).not.toHaveBeenCalled();
  });
});
