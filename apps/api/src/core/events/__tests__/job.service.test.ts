import { Test, TestingModule } from '@nestjs/testing';
import { CoreProcessor } from '../../processing/core-processor.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { QUEUE_SERVICE_TOKEN } from '../../queue/queue.module';
import { MessageService } from '../../../services/message.service';
import { WorkflowRouterService } from '../../../services/workflows/workflow-router.service';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../tokens';
import { EVENT_TYPES } from '../types/event.types';
import { ArtifactService } from '../../../services/artifacts/artifact.service';
import { EventRouter } from '../event-router';
import { InitiativeService } from '../../../services/initiatives/initiative.service';
import { ConversationService } from '../../../services/conversation.service';
import { createRedisServiceMock } from '../../../../test/mocks/redis-service.mock';
import { createFlowNodeProcessorMock } from '../../../../test/mocks/flow-node-processor.mock';
import { createNonInteractiveFlowNodeProcessorMock } from '../../../../test/mocks/non-interactive-flow-node-processor.mock';
import { createLlmProcessorMock } from '../../../../test/mocks/llm-processor.mock';
import { createArtifactProcessorMock } from '../../../../test/mocks/artifact-processor.mock';
import { createMessageProcessorMock } from '../../../../test/mocks/message-processor.mock';
import { AgentProcessor } from '../../processing/agent-processor.service';
import { EntityLifecycleProcessor } from '../../processing/entity-lifecycle-processor.service';
import { MentionRelationService } from '../../../services/mentions/mention-relation.service';
import { NotificationGenerationProcessor } from '../../processing/notification-generation-processor.service';
import { AgentSessionService } from '../../../services/agent-session.service';
import { ReportService } from '../../../services/reports/report.service';

describe('JobService', () => {
  let service: CoreProcessor;
  let prismaService: PrismaService;
  let mockEventRouter: { on: jest.Mock };
  let mockEntityLifecycleProcessor: {
    handleTaskCreated: jest.Mock;
    handleTaskUpdated: jest.Mock;
    handleTaskArchived: jest.Mock;
    handleInitiativeArchived: jest.Mock;
    handleDesignDocArchived: jest.Mock;
    handleServiceArchived: jest.Mock;
    handleConversationDeleted: jest.Mock;
    handlePlanDeleted: jest.Mock;
    handleProjectDeleted: jest.Mock;
    handleAgentSessionDeleted: jest.Mock;
  };

  beforeEach(async () => {
    const mockPrismaService = {
      job: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const mockQueueService = {
      add: jest.fn(),
      getJob: jest.fn(),
      getJobs: jest.fn(),
      retry: jest.fn(),
      getStats: jest.fn(),
      process: jest.fn(),
    };

    const mockEventPublisher = { publish: jest.fn() };
    const mockMessageService = {
      createMessage: jest.fn(),
      updateMessage: jest.fn(),
    };
    const mockWorkflowRouterService = {
      routeToWorkflow: jest.fn(),
    };
    const mockArtifactService = {
      createMany: jest.fn(),
      create: jest.fn(),
    };
    mockEventRouter = {
      on: jest.fn(() => Promise.resolve()),
    };
    mockEntityLifecycleProcessor = {
      handleTaskCreated: jest.fn(),
      handleTaskUpdated: jest.fn(),
      handleTaskArchived: jest.fn(),
      handleInitiativeArchived: jest.fn(),
      handleDesignDocArchived: jest.fn(),
      handleServiceArchived: jest.fn(),
      handleConversationDeleted: jest.fn(),
      handlePlanDeleted: jest.fn(),
      handleProjectDeleted: jest.fn(),
      handleAgentSessionDeleted: jest.fn(),
    };

    const mockTemporalClient = {
      workflow: {
        signalWithStart: jest.fn(),
      },
    };
    const mockAgentProcessor = {
      processAgentRequest: jest.fn(),
      processAgentProgress: jest.fn(),
      processAgentComplete: jest.fn(),
      processAgentError: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [CoreProcessor,
createMessageProcessorMock(),
createArtifactProcessorMock(),
createLlmProcessorMock(),
{
          provide: QUEUE_SERVICE_TOKEN,
          useValue: mockQueueService,
        },
{
          provide: DOMAIN_EVENT_PUBLISHER_TOKEN,
          useValue: mockEventPublisher,
        },
{
          provide: PrismaService,
          useValue: mockPrismaService,
        },
{
          provide: MessageService,
          useValue: mockMessageService,
        },
{
          provide: WorkflowRouterService,
          useValue: mockWorkflowRouterService,
        },
{
          provide: ArtifactService,
          useValue: mockArtifactService,
        },
{
          provide: EventRouter,
          useValue: mockEventRouter,
        },
{
          provide: 'TEMPORAL_CLIENT',
          useValue: mockTemporalClient,
        },
{
          provide: AgentProcessor,
          useValue: mockAgentProcessor,
        },
{
          provide: EntityLifecycleProcessor,
          useValue: mockEntityLifecycleProcessor,
        },
{
          provide: NotificationGenerationProcessor,
          useValue: {
            handleReportCreatedEvent: jest.fn(),
            handleTaskStatusChangedEvent: jest.fn(),
            handleAgentSessionStatusChangedEvent: jest.fn(),
          },
        },
{
          provide: MentionRelationService,
          useValue: {
            createRelationsForMessage: jest.fn(),
          },
        },
{
          provide: InitiativeService,
          useValue: {
            createMany: jest.fn(),
            create: jest.fn(),
            findMany: jest.fn(),
            update: jest.fn(),
          },
        },
{
          provide: ConversationService,
          useValue: {
            getConversation: jest.fn(),
          },
        },
{
          provide: AgentSessionService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
            markSynced: jest.fn(),
            markUnsyncedChanges: jest.fn(),
            findIdByConversationId: jest.fn(),
            createConversationForSession: jest.fn(),
          },
        },
{
          provide: ReportService,
          useValue: {},
        },
createRedisServiceMock(),
createFlowNodeProcessorMock(),
createNonInteractiveFlowNodeProcessorMock()],
    }).compile();

    service = module.get<CoreProcessor>(CoreProcessor);
    prismaService = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('basic functionality', () => {
    it('should have access to prisma service', () => {
      expect(prismaService).toBeDefined();
    });

    it('should be properly instantiated', () => {
      expect(service).toBeInstanceOf(CoreProcessor);
      expect(typeof service).toBe('object');
    });

    it('should have required dependencies', () => {
      expect(prismaService).toBeDefined();
      expect(service).toBeTruthy();
    });
  });

  describe('event routing', () => {
    const getHandlerFor = (eventType: string) => {
      const call = mockEventRouter.on.mock.calls.find(
        ([type]) => type === eventType,
      );
      if (!call) {
        throw new Error(`No handler registered for ${eventType}`);
      }
      return call[1] as (env: {
        event: Record<string, unknown>;
      }) => Promise<void>;
    };

    it('routes project.deleted to entity lifecycle processor', async () => {
      await (service as any).setupEventListeners();
      const handler = getHandlerFor(EVENT_TYPES.PROJECT.DELETED);

      await handler({
        event: {
          id: 'evt-project-delete',
          type: EVENT_TYPES.PROJECT.DELETED,
          aggregateId: 'project-1',
          payload: {
            payloadType: EVENT_TYPES.PROJECT.DELETED,
            organizationId: 'org-1',
            projectId: 'project-1',
            deletedAt: '2026-03-01T00:00:00.000Z',
          },
        },
      });

      expect(
        mockEntityLifecycleProcessor.handleProjectDeleted,
      ).toHaveBeenCalledWith({
        organizationId: 'org-1',
        projectId: 'project-1',
        deletedAt: '2026-03-01T00:00:00.000Z',
      });
    });

    it('routes task.archived to entity lifecycle processor', async () => {
      await (service as any).setupEventListeners();
      const handler = getHandlerFor(EVENT_TYPES.TASK.ARCHIVED);

      await handler({
        event: {
          id: 'evt-task-archive',
          type: EVENT_TYPES.TASK.ARCHIVED,
          aggregateId: 'task-1',
          payload: {
            payloadType: EVENT_TYPES.TASK.ARCHIVED,
            organizationId: 'org-1',
            projectId: 'project-1',
            initiativeId: 'initiative-1',
            archivedAt: '2026-03-01T00:00:00.000Z',
          },
        },
      });

      expect(
        mockEntityLifecycleProcessor.handleTaskArchived,
      ).toHaveBeenCalledWith({
        organizationId: 'org-1',
        taskId: 'task-1',
        archivedAt: '2026-03-01T00:00:00.000Z',
        projectId: 'project-1',
      });
    });

    it('routes initiative.archived to entity lifecycle processor', async () => {
      await (service as any).setupEventListeners();
      const handler = getHandlerFor(EVENT_TYPES.INITIATIVE.ARCHIVED);

      await handler({
        event: {
          id: 'evt-initiative-archive',
          type: EVENT_TYPES.INITIATIVE.ARCHIVED,
          aggregateId: 'init-1',
          payload: {
            payloadType: EVENT_TYPES.INITIATIVE.ARCHIVED,
            organizationId: 'org-1',
            projectId: 'project-1',
            archivedAt: '2026-03-01T00:00:00.000Z',
          },
        },
      });

      expect(
        mockEntityLifecycleProcessor.handleInitiativeArchived,
      ).toHaveBeenCalledWith({
        organizationId: 'org-1',
        initiativeId: 'init-1',
        archivedAt: '2026-03-01T00:00:00.000Z',
        projectId: 'project-1',
      });
    });

    it('routes design_doc.archived to entity lifecycle processor', async () => {
      await (service as any).setupEventListeners();
      const handler = getHandlerFor(EVENT_TYPES.DESIGN_DOC.ARCHIVED);

      await handler({
        event: {
          id: 'evt-design-doc-archive',
          type: EVENT_TYPES.DESIGN_DOC.ARCHIVED,
          aggregateId: 'doc-1',
          payload: {
            payloadType: EVENT_TYPES.DESIGN_DOC.ARCHIVED,
            organizationId: 'org-1',
            projectId: 'project-1',
            timestamp: '2026-03-01T00:00:00.000Z',
            designDoc: {
              id: 'doc-1',
              name: 'Design Doc',
            },
          },
        },
      });

      expect(
        mockEntityLifecycleProcessor.handleDesignDocArchived,
      ).toHaveBeenCalledWith({
        organizationId: 'org-1',
        designDocId: 'doc-1',
        archivedAt: '2026-03-01T00:00:00.000Z',
        projectId: 'project-1',
      });
    });

    it('routes service.archived to entity lifecycle processor', async () => {
      await (service as any).setupEventListeners();
      const handler = getHandlerFor(EVENT_TYPES.SERVICE.ARCHIVED);

      await handler({
        event: {
          id: 'evt-service-archive',
          type: EVENT_TYPES.SERVICE.ARCHIVED,
          aggregateId: 'svc-1',
          payload: {
            payloadType: EVENT_TYPES.SERVICE.ARCHIVED,
            organizationId: 'org-1',
            projectId: 'project-1',
            service: {
              id: 'svc-1',
              name: 'Catalog API',
              projectId: 'project-1',
              archivedAt: '2026-03-01T00:00:00.000Z',
            },
          },
        },
      });

      expect(
        mockEntityLifecycleProcessor.handleServiceArchived,
      ).toHaveBeenCalledWith({
        organizationId: 'org-1',
        serviceId: 'svc-1',
        name: 'Catalog API',
        archivedAt: '2026-03-01T00:00:00.000Z',
        projectId: 'project-1',
      });
    });

    it('routes conversation.deleted to entity lifecycle processor', async () => {
      await (service as any).setupEventListeners();
      const handler = getHandlerFor(EVENT_TYPES.CONVERSATION.DELETED);

      await handler({
        event: {
          id: 'evt-conversation-delete',
          type: EVENT_TYPES.CONVERSATION.DELETED,
          aggregateId: 'conv-1',
          payload: {
            payloadType: EVENT_TYPES.CONVERSATION.DELETED,
            organizationId: 'org-1',
            projectId: 'project-1',
            timestamp: '2026-03-01T00:00:00.000Z',
          },
        },
      });

      expect(
        mockEntityLifecycleProcessor.handleConversationDeleted,
      ).toHaveBeenCalledWith({
        organizationId: 'org-1',
        conversationId: 'conv-1',
        deletedAt: '2026-03-01T00:00:00.000Z',
        projectId: 'project-1',
      });
    });

    it('routes agent_session.deleted to entity lifecycle processor', async () => {
      await (service as any).setupEventListeners();
      const handler = getHandlerFor(EVENT_TYPES.AGENT_SESSION.DELETED);

      await handler({
        event: {
          id: 'evt-agent-session-delete',
          type: EVENT_TYPES.AGENT_SESSION.DELETED,
          aggregateId: 'cs-1',
          payload: {
            payloadType: EVENT_TYPES.AGENT_SESSION.DELETED,
            organizationId: 'org-1',
            projectId: 'project-1',
            timestamp: '2026-03-01T00:00:00.000Z',
            agentSession: {
              id: 'cs-1',
              title: 'Session One',
            },
          },
        },
      });

      expect(
        mockEntityLifecycleProcessor.handleAgentSessionDeleted,
      ).toHaveBeenCalledWith({
        organizationId: 'org-1',
        agentSessionId: 'cs-1',
        deletedAt: '2026-03-01T00:00:00.000Z',
        projectId: 'project-1',
        title: 'Session One',
      });
    });
  });
});
