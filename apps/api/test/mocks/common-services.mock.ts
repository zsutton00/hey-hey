import { QUEUE_SERVICE_TOKEN } from '../../src/core/queue/queue.module';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../src/core/events/tokens';
import { JOB_ENQUEUER_TOKEN } from '../../src/services/job.tokens';
import { MessageService } from '../../src/services/message.service';
import { ConversationService } from '../../src/services/conversation.service';
import { FlowEngineService } from '../../src/services/workflows/flow-engine.service';
import { InitiativeService } from '../../src/services/initiatives/initiative.service';
import { LLMClientService } from '../../src/services/llm/llm-client.service';

export function createCommonServiceMocks() {
  return [
    {
      provide: QUEUE_SERVICE_TOKEN,
      useValue: {
        getJob: jest.fn().mockResolvedValue({
          id: 'job-123',
          queueName: 'test',
        }),
        addProcessor: jest.fn(),
        processJob: jest.fn(),
      },
    },
    {
      provide: DOMAIN_EVENT_PUBLISHER_TOKEN,
      useValue: {
        publish: jest.fn().mockResolvedValue(undefined),
        publishInTransaction: jest.fn().mockResolvedValue(undefined),
      },
    },
    {
      provide: JOB_ENQUEUER_TOKEN,
      useValue: {
        queueLLMWorkflow: jest.fn().mockResolvedValue({
          id: 'llm-job-123',
          queueName: 'llm',
          data: {},
          createdAt: new Date(),
        }),
        queueFlowNodeExecution: jest.fn(),
        queueNonInteractiveFlowNodeExecution: jest.fn(),
        queueArtifactGeneration: jest.fn(),
        getJob: jest.fn(),
        getQueueStats: jest.fn(),
        retryJob: jest.fn(),
      },
    },
    {
      provide: MessageService,
      useValue: {
        updateMessage: jest.fn().mockResolvedValue({}),
        getMessage: jest.fn().mockResolvedValue({
          id: 'msg-123',
          data: {
            type: 'Questions',
            response: 'Test response',
            data: {},
            uiElements: [],
          },
        }),
        createMessage: jest.fn(),
        deleteMessage: jest.fn(),
      },
    },
    {
      provide: ConversationService,
      useValue: {
        getConversation: jest.fn().mockResolvedValue({
          id: 'conv-123',
          title: 'Test Conversation',
        }),
        createConversation: jest.fn(),
        updateConversation: jest.fn(),
        deleteConversation: jest.fn(),
      },
    },
    {
      provide: FlowEngineService,
      useValue: {
        getFlow: jest.fn().mockReturnValue({
          nodes: {
            'test-node': {
              id: 'test-node',
              type: 'gather',
              action: jest.fn().mockResolvedValue({
                message: 'Test prompt',
                data: {},
                uiElements: [],
              }),
            },
          },
        }),
        executeNode: jest.fn().mockResolvedValue({
          result: { message: 'Test prompt' },
          nextNodeId: null,
        }),
        validateFlow: jest.fn().mockReturnValue(true),
      },
    },
    {
      provide: InitiativeService,
      useValue: {
        getInitiative: jest.fn().mockResolvedValue({
          id: 'init-123',
          title: 'Test Initiative',
        }),
        createInitiative: jest.fn(),
        updateInitiative: jest.fn(),
        deleteInitiative: jest.fn(),
      },
    },
    {
      provide: LLMClientService,
      useValue: {
        generateCompletion: jest.fn().mockResolvedValue({
          content: 'Mock completion',
          usage: { tokens: 100 },
        }),
        generateStream: jest.fn(),
        validateConnection: jest.fn().mockResolvedValue(true),
      },
    },
    {
      provide: 'TEMPORAL_CLIENT',
      useValue: {
        workflow: {
          getHandle: jest.fn(() => ({
            signal: jest.fn(),
          })),
        },
      },
    },
  ];
}
