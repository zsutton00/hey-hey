import { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { EventContextManager } from 'src/core/events/observable-event.context';
import { FlowContext } from 'src/types/flow-internal.types';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from '../app.module';
import { MessageStatus } from '../constants/message-status.constants';
import { WorkflowAboutType } from '../types';
import { ContextResolutionService } from '../context/services/context-resolution.service';
import { EventRouter } from '../core/events/event-router';
import { InMemoryMessageBus } from '../core/events/in-memory-message-bus.service';
import { OutboxPublisher } from '../core/events/outbox-publisher.service';
import { RedisMessageBus } from '../core/events/redis-message-bus.service';
import { MESSAGE_BUS_TOKEN, OUTBOX_STORE_TOKEN } from '../core/events/tokens';
import { EventEnvelope } from '../core/events/types/event-envelope';
import { EVENT_TYPES } from '../core/events/types/event.types';
import {
  IQueueService,
  QueueJob,
  QueueJobOptions,
} from '../core/queue/interfaces/queue.interface';
import { QUEUE_SERVICE_TOKEN } from '../core/queue/queue.module';
import { RedisService } from '../core/redis/redis.service';
import { ContextPerformanceService } from '../core/performance/context-performance.service';
import { WebsocketGateway } from '../core/websockets/websocket.gateway';
import { AgentOperationDispatchService } from '../core/websockets/agent-operation-dispatch.service';
import { AgentOperationWorkflowInputDeliveryService } from '../services/agent-operation/agent-operation-workflow-input-delivery.service';
import { CreateUserMessage } from '../generated';
import { PrismaService } from '../prisma/prisma.service';
import { TEMPORAL_CLIENT } from '../prisma/temporal.module';
import { HelpContentBootstrapService } from '../services/help-content-bootstrap.service';
import { IJobEnqueuer } from '../services/interfaces/job-enqueuer.interface';
import { JOB_ENQUEUER_TOKEN } from '../services/job.tokens';
import { JiraIntegrationHandler } from '../integration/handlers/jira.integration.handler';
import { MessageClassificationService } from '../services/message-classification/message-classification.service';
import { MessageService } from '../services/message.service';
import { ProposalGroupCoordinatorService } from '../services/proposal/proposal-group-coordinator.service';
import { TemporalWorkerService } from '../services/temporal-worker.service';
import { JobId, OrganizationId } from '../types';
import { ConversationNode, NodeType } from '../types/flow-internal.types';
import * as TestUtils from '../utils/testUtils';

const { testIds } = TestUtils;

jest.setTimeout(60000);

// Set up test environment variables
process.env.INTEGRATION_ENCRYPTION_KEY = 'test-master-key-32-chars-long123';
process.env.CLAUDE_API_KEY = 'test-claude-api-key';
process.env.BROWSER_ACCESS_TOKEN_TTL_SECONDS = '900';
process.env.BROWSER_SESSION_INACTIVITY_TTL_SECONDS = '604800';
process.env.BROWSER_SESSION_ABSOLUTE_TTL_SECONDS = '2592000';
process.env.PASSWORD_CHANGE_TOKEN_TTL_SECONDS = '900';
process.env.MACHINE_ENROLLMENT_WEBAUTHN_RP_ID = 'localhost.test';
process.env.MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN = 'https://localhost.test';

// ---------------------------------------------------------------------------
// Enhanced PrismaService using TestUtils patterns with proper db property
// ---------------------------------------------------------------------------
class FakePrismaService {
  public db: any;
  // WorkItemTypeRegistryService reads project, effective definition, and
  // template rows off the base (non-extended) client at startup.
  public project = {
    findMany: async (): Promise<unknown[]> => [],
  };
  public workItemType = {
    findMany: async (): Promise<unknown[]> => [],
  };
  public workItemTypeTemplate = {
    findMany: async (): Promise<unknown[]> => [],
  };
  private messages: any[] = [];
  private conversations: any[] = [];
  private outboxEvents: any[] = [];

  constructor() {
    // Create the db property that the actual PrismaService uses
    this.db = {
      message: {
        create: async ({ data }: any) => {
          const msg = {
            ...data,
            id: uuidv4(),
            createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
            responses: [],
            parentMessage: null,
            organizationId: data.organizationId || testIds.organization,
          };
          this.messages.push(msg);
          return msg;
        },
        findFirst: async ({ where }: any) => {
          return (
            this.messages.find((m) => {
              // Handle nested where conditions like conversation.organizationId
              if (where.id && m.id !== where.id) return false;
              if (where.conversation?.organizationId) {
                // For test purposes, assume message belongs to the test organization
                return m.organizationId === where.conversation.organizationId;
              }
              return true;
            }) || null
          );
        },
        findMany: async ({ where }: any) => {
          if (!where) return this.messages;
          return this.messages.filter((m) => {
            for (const k of Object.keys(where)) {
              if (m[k] !== where[k]) return false;
            }
            return true;
          });
        },
      },
      conversation: {
        update: async ({ where, data }: any) => {
          let conv = this.conversations.find((c) => c.id === where.id);
          if (!conv) {
            conv = {
              id: where.id,
              version: 1,
              lastModifiedBy: 'system',
              organizationId: testIds.organization,
              ...data,
            };
            this.conversations.push(conv);
          } else {
            Object.assign(conv, data);
            conv.version = (conv.version || 1) + 1;
          }
          return conv;
        },
        findFirst: async ({ where }: any) => {
          return (
            this.conversations.find((c) => {
              if (where.id && c.id !== where.id) return false;
              if (
                where.organizationId &&
                c.organizationId !== where.organizationId
              )
                return false;
              return true;
            }) || null
          );
        },
        findUnique: async ({ where }: any) => {
          let conv = this.conversations.find((c) => c.id === where.id);
          if (!conv) {
            conv = {
              id: where.id,
              version: 1,
              workflowId: testIds.workflow,
              workflowAboutId: testIds.project,
              workflowAboutType: 'project',
              organizationId: testIds.organization,
              projectId: testIds.project,
            };
            this.conversations.push(conv);
          }
          return conv;
        },
      },
      messageMention: {
        findMany: async () => [],
        deleteMany: async () => ({ count: 0 }),
        createMany: async () => ({ count: 0 }),
      },
      workItemChangeSetMaterialization: {
        findMany: async (): Promise<unknown[]> => [],
      },
      outbox: {
        findMany: async (): Promise<unknown[]> => this.outboxEvents,
        create: async ({ data }: any) => {
          const event = {
            ...data,
            id: uuidv4(),
            createdAt: new Date(),
          };
          this.outboxEvents.push(event);
          return event;
        },
      },
    };
  }

  async $queryRaw<T = unknown>(..._args: unknown[]): Promise<T> {
    return [] as T;
  }

  // Simplistic transaction – just run the callback with this db instance
  async $transaction(fn: any) {
    return fn(this.db);
  }
}

// ---------------------------------------------------------------------------
// Enhanced Outbox Service with proper correlation context handling
// ---------------------------------------------------------------------------
class FakeOutboxService {
  constructor(private bus: InMemoryMessageBus) {}

  async storeEvent(eventData: any): Promise<string> {
    const eventId = uuidv4();
    const currentContext =
      EventContextManager.getInstance().getCurrentContext();

    const env: EventEnvelope = {
      event: {
        id: eventId, // Fix: Set the event.id field that EventRouter expects
        type: eventData.eventType,
        aggregateId: eventData.aggregateId,
        payload: eventData.payload,
      },
      timestamp: new Date().toISOString(),
      correlationId: currentContext?.correlationId || undefined,
      causationId: currentContext?.correlationId || undefined, // Fix: Use correlationId as causationId for child events
      headers: { eventId },
    };
    await this.bus.publish(env);
    return eventId;
  }

  async storeEventInTransaction(_tx: any, eventData: any): Promise<string> {
    return this.storeEvent(eventData);
  }
}

// ---------------------------------------------------------------------------
// Enhanced MessageClassificationService using TestUtils patterns
// ---------------------------------------------------------------------------
class FakeMessageClassificationService {
  async classifyMessage(_message: any, _context: any): Promise<any> {
    // Return minimal classification for testing with proper typing
    return {
      intent: 'GENERAL' as const,
      confidence: 0.5,
      reasoning: 'Test classification',
      category: 'general',
      isWorkflowTrigger: false,
    };
  }

  shouldRouteMessage(_classification: any): boolean {
    return false; // Don't route messages in integration tests
  }

  async classifyUserMessage(_message: any, _organizationId: any): Promise<any> {
    return this.classifyMessage(_message, null);
  }
}

// ---------------------------------------------------------------------------
// Enhanced ContextResolutionService using TestUtils patterns
// ---------------------------------------------------------------------------
class FakeContextResolutionService {
  async resolveContext(_query: any, _organizationId: any): Promise<any> {
    // Return minimal context for testing with proper structure
    return {
      initiatives: [],
      projects: [],
      conversations: [],
      artifacts: [],
      relevantContext: [],
    };
  }

  registerProvider(_provider: any): void {
    // No-op for testing
  }

  async getRelevantContext(
    _query: string,
    _organizationId: OrganizationId,
  ): Promise<any> {
    return this.resolveContext(_query, _organizationId);
  }
}

// ---------------------------------------------------------------------------
// Fake QueueService – immediately returns job, no background processing
// ---------------------------------------------------------------------------
class FakeQueueService implements IQueueService {
  private id = 0;
  async addJob(
    queueName: string,
    _jobType: string,
    data: any,
    options: QueueJobOptions,
  ): Promise<QueueJob> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return {
      id: String(++this.id) as JobId,
      data,
      queueName,
      ...options, // Spread all ExecutionContext properties from options
      createdAt: new Date(),
    } as any;
  }
  // unused methods for this test – stub minimal
  addProcessor(): void {}
  getStats(): Promise<any> {
    return Promise.resolve({ waiting: 0, active: 0, completed: 0, failed: 0 });
  }
  getJob(): Promise<any> {
    return Promise.resolve(undefined);
  }
  getJobs(): Promise<any[]> {
    return Promise.resolve([]);
  }
  retryJob(): Promise<void> {
    return Promise.resolve();
  }
  removeJob(): Promise<void> {
    return Promise.resolve();
  }
  cleanup(): Promise<number> {
    return Promise.resolve(0);
  }
}

// ---------------------------------------------------------------------------

describe('Full onboarding flow correlation chain', () => {
  let app: INestApplication;
  let router: EventRouter;
  let messageSvc: MessageService;
  let jobEnqueuer: IJobEnqueuer;

  const received: Record<string, EventEnvelope[]> = {};
  const capture = (type: string) => (env: EventEnvelope) => {
    (received[type] ||= []).push(env);
  };

  beforeAll(async () => {
    const messageBus = new InMemoryMessageBus();
    const redisSubscriber = {
      on: jest.fn(),
      removeListener: jest.fn(),
      quit: jest.fn().mockResolvedValue('OK'),
      subscribe: jest.fn().mockResolvedValue(1),
    };
    const redisClient = {
      duplicate: jest.fn().mockReturnValue(redisSubscriber),
      del: jest.fn().mockResolvedValue(0),
      get: jest.fn().mockResolvedValue(null),
      on: jest.fn(),
      publish: jest.fn().mockResolvedValue(0),
      quit: jest.fn().mockResolvedValue('OK'),
      set: jest.fn().mockResolvedValue('OK'),
      setex: jest.fn().mockResolvedValue('OK'),
      subscribe: jest.fn().mockResolvedValue(0),
      unsubscribe: jest.fn().mockResolvedValue(0),
      scan: jest.fn().mockResolvedValue(['0', []]),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useClass(FakePrismaService as unknown as typeof PrismaService)
      .overrideProvider(HelpContentBootstrapService)
      .useValue({ onApplicationBootstrap: jest.fn() })
      .overrideProvider(MESSAGE_BUS_TOKEN)
      .useValue(messageBus)
      .overrideProvider(RedisMessageBus)
      .useValue(messageBus)
      .overrideProvider(OUTBOX_STORE_TOKEN)
      .useValue(new FakeOutboxService(messageBus))
      .overrideProvider(OutboxPublisher)
      .useValue({
        onModuleInit: jest.fn(),
        startPublisher: jest.fn(),
        stopPublisher: jest.fn(),
      })
      .overrideProvider(QUEUE_SERVICE_TOKEN)
      .useClass(FakeQueueService)
      .overrideProvider(RedisService)
      .useValue({
        getClient: () => redisClient,
        onModuleDestroy: jest.fn(),
      })
      .overrideProvider(ContextPerformanceService)
      .useValue({})
      .overrideProvider(JiraIntegrationHandler)
      .useValue({})
      .overrideProvider(WebsocketGateway)
      .useValue({
        emitConversationUpdated: jest.fn(),
        emitMessageCreated: jest.fn(),
      })
      .overrideProvider(AgentOperationDispatchService)
      .useValue({
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
        nudge: jest.fn(),
        nudgeForMachine: jest.fn(),
      })
      .overrideProvider(AgentOperationWorkflowInputDeliveryService)
      .useValue({
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
        nudge: jest.fn(),
      })
      .overrideProvider(TEMPORAL_CLIENT)
      .useValue({})
      .overrideProvider(TemporalWorkerService)
      .useValue({
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
      })
      .overrideProvider(ProposalGroupCoordinatorService)
      .useValue({
        onModuleInit: jest.fn(),
        processDueMembers: jest.fn(),
      })
      .overrideProvider(ContextResolutionService)
      .useClass(
        FakeContextResolutionService as unknown as typeof ContextResolutionService,
      )
      .overrideProvider(MessageClassificationService)
      .useClass(
        FakeMessageClassificationService as unknown as typeof MessageClassificationService,
      )
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    router = app.get(EventRouter);
    messageSvc = app.get(MessageService);
    jobEnqueuer = app.get(JOB_ENQUEUER_TOKEN);

    await router.on(EVENT_TYPES.MESSAGE.CREATED, capture('msg.created'));
    await router.on(EVENT_TYPES.QUEUE.JOB_CREATED, capture('job.created'));
  });

  afterAll(async () => {
    const schedulerRegistry = app?.get(SchedulerRegistry);
    schedulerRegistry?.getCronJobs().forEach((job) => job.stop());
    schedulerRegistry
      ?.getIntervals()
      .forEach((name) => schedulerRegistry.deleteInterval(name));
    schedulerRegistry
      ?.getTimeouts()
      .forEach((name) => schedulerRegistry.deleteTimeout(name));
    await app?.close();
  });

  it('keeps correlation and sets causation through message -> job creation', async () => {
    const ctxMgr = EventContextManager.getInstance();
    const rootCtx = ctxMgr.createInitialContext('Test', 'flow');

    await ctxMgr.runWithContext(rootCtx, async () => {
      const dto: any = {
        workflowId: testIds.workflow,
        projectId: testIds.project,
        conversationId: testIds.conversation,
        type: 'USER',
        userId: testIds.user,
        status: MessageStatus.Open,
        data: { text: 'hello' },
        parentMessageId: undefined,
        createdAt: new Date().toISOString(),
      };
      await messageSvc.addMessage(dto, testIds.organization, 'test');

      const mockFlowContext: FlowContext = TestUtils.createMockFlowContext({
        core: {
          workflowId: testIds.workflow,
          projectId: testIds.project,
          organizationId: testIds.organization,
          conversationId: testIds.conversation,
          workflowAboutId: testIds.project,
          workflowAboutType: 'project' as WorkflowAboutType,
          user: {
            id: testIds.user,
            role: 'user',
          },
          session: {
            startTime: new Date(),
            interactionCount: 1,
          },
        },
        flowId: 'test-flow',
        flowPath: {
          pathTaken: ['opener'],
          previousNode: undefined,
          previousTransition: undefined,
        },
      });

      await jobEnqueuer.queueFlowNodeExecution(
        {
          node: TestUtils.createMockConversationNode({
            id: 'test-node',
            type: 'opener' as NodeType,
            title: 'Test Node',
          }),
          context: mockFlowContext,
          messageId: testIds.message,
        },
        {
          requestId: testIds.request,
          organizationId: testIds.organization,
          projectId: testIds.project,
          conversationId: testIds.conversation,
        },
      );
    });

    // allow async handlers to run
    await new Promise((r) => setTimeout(r, 100));

    const msgCreated = received['msg.created'];
    const jobCreated = received['job.created'];
    if (!msgCreated || !jobCreated) {
      throw new Error('Expected message and job events');
    }
    expect(msgCreated).toHaveLength(1);
    expect(jobCreated).toHaveLength(1);

    const msgEnv = msgCreated[0];
    const jobEnv = jobCreated[0];
    if (!msgEnv || !jobEnv) {
      throw new Error('Expected message and job events');
    }

    expect(msgEnv.correlationId).toBeDefined();
    // same correlation
    expect(jobEnv.correlationId).toBe(msgEnv.correlationId);
    // causation id of job event should point to the root correlation id (child context logic)
    // Causation id of job event should point to the message event's correlation id
    expect(jobEnv.causationId).toBe(msgEnv.correlationId);
  });
});
