/* eslint-disable @typescript-eslint/unbound-method */
import { INestApplicationContext } from '@nestjs/common';
import { log } from '@temporalio/activity';
import { z } from 'zod';
import { MessageStatus } from '../../constants/message-status.constants';
import { IQueueService } from '../../core/queue/interfaces/queue.interface';
import { QUEUE_SERVICE_TOKEN } from '../../core/queue/queue.module';
import {
  ConversationResponseDto,
  ConversationStatus,
  FeatureTag,
  RepositoryGroundingSuccess,
  RepositoryGroundingWorkflowContext,
  SecondaryActionHandler,
  SystemMessageResponseType,
  WorkflowName,
} from '../../generated';
import {
  ONBOARDING_NODES,
  SHARED_NODES,
  REPOSITORY_IMPORT_NODES,
} from '../../flows/constants';
import { OnboardingGenerateFeaturesNode } from '../../flows/nodes/onboarding/onboarding-generate-features.node';
import { OnboardingWelcomeNode } from '../../flows/nodes/onboarding/onboarding-welcome.node';
import type { FeatureFlagService } from '../../services/feature-flag/feature-flag.service';
import type { ContextResolutionService } from '../../context/services/context-resolution.service';
import { OnboardingRepositoryGroundingAnalysisNode } from '../../flows/nodes/onboarding/repository-grounding-analysis.node';

import {
  RepositoryImportEnrichmentChoiceNode,
  ENRICHMENT_CHOICE_FIELD,
} from '../../flows/nodes/repository-import/repository-import-enrichment-choice.node';
import { RepositoryFeatureEnrichmentNode } from '../../flows/nodes/onboarding/repository-feature-enrichment.node';
import { REPOSITORY_GROUNDING_DETERMINISTIC_BOUNDS } from '../../flows/nodes/onboarding/repository-grounding.contract';
import { onboardingFlow } from '../../flows/templates/onboarding.flow';
import { repositoryImportFlow } from '../../flows/templates/repository-import.flow';
import {
  WorkflowPhase,
  WorkflowStep,
  WriteableFlowContext,
} from '../conversation-workflow-state';
import { PrismaService } from '../../prisma/prisma.service';
import { ConversationService } from '../../services/conversation.service';
import type { FeatureListLifecycleService } from '../../services/feature-list/feature-list-lifecycle.service';
import { IJobEnqueuer } from '../../services/interfaces/job-enqueuer.interface';
import { JOB_ENQUEUER_TOKEN } from '../../services/job.tokens';
import { MessageService } from '../../services/message.service';
import { NodeExecutionService } from '../../services/workflows/node-execution.service';
import { FlowExecutionService } from '../../services/workflows/flow-execution.service';
import {
  ConversationId,
  FlowExecutionId,
  JobId,
  MessageId,
  OrganizationId,
  ProjectId,
  WorkflowId,
} from '../../types';
import {
  FlowContext,
  FlowUserMessage,
  INode,
  NodeResult,
  NodeType,
  RepositoryImportFlowContext as OnboardingFlowContext,
} from '../../types/flow-internal.types';
import { getAppContextForWorker } from '../../utils';
import { createMutableContextHandle } from '../../utils/mutable-context';
import * as TestUtils from '../../utils/testUtils';
import * as activities from '../activities';
const { testIds } = TestUtils;

const baseInitializeParams = {
  workflowAboutId: 'entity-123',
  workflowAboutType: 'project',
} as const;

// Mock the utils module
jest.mock('../../utils', () => ({
  ...jest.requireActual('../../utils'),
  getAppContextForWorker: jest.fn(),
}));

// Mock Temporal log functions
jest.mock('@temporalio/activity', () => ({
  log: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('Flow Activities - Queue-based Execution', () => {
  let mockAppContext: INestApplicationContext;
  let mockConversationService: jest.Mocked<ConversationService>;
  let mockMessageService: jest.Mocked<MessageService>;
  let mockFlowEngine: jest.Mocked<NodeExecutionService>;
  let mockFlowExecutionService: jest.Mocked<FlowExecutionService>;
  let mockQueueService: jest.Mocked<IQueueService>;
  let mockJobEnqueuer: jest.Mocked<IJobEnqueuer>;
  let mockPrismaService: jest.Mocked<PrismaService>;

  const mockExecutionId = 'exec-123' as FlowExecutionId;

  const createMockContext = (): WriteableFlowContext =>
    TestUtils.createMockFlowContext({
      core: {
        workflowId: testIds.workflow,
        projectId: testIds.project,
        organizationId: testIds.organization,
        conversationId: testIds.conversation,
        workflowAboutId: 'entity-123',
        workflowAboutType: 'project',
        user: { id: testIds.user, role: 'member' },
        session: { startTime: new Date(), interactionCount: 1 },
      },
      flowId: testIds.flowId,
    }) as WriteableFlowContext;

  beforeEach(() => {
    mockConversationService = TestUtils.createMockConversationService();
    mockMessageService = TestUtils.createMockMessageService();

    mockFlowEngine = TestUtils.createMockFlowEngineService();
    (mockFlowEngine.getFlow as jest.Mock).mockReturnValue({
      id: 'onboarding',
      name: 'Project Onboarding',
      description: 'Test flow',
      version: 1,
      startNode: 'welcome',
      nodes: {
        welcome: TestUtils.createMockConversationNode({
          id: 'welcome',
          type: NodeType.OPENER,
          title: 'Welcome',
        }),
        end: TestUtils.createMockConversationNode({
          id: 'end',
          type: NodeType.OPENER,
          title: 'End',
        }),
      },
    });
    (mockFlowEngine.startFlowNode as jest.Mock).mockResolvedValue({
      job: TestUtils.createMockJob({
        id: 'job-123' as JobId,
        queueName: 'flow_node',
        data: {},
      }),
      message: TestUtils.createMockMessage({
        id: 'msg-123' as MessageId,
      }),
    });

    mockQueueService = TestUtils.createMockQueueService();
    mockQueueService.addJob.mockResolvedValue(
      TestUtils.createMockJob({
        id: 'job-123' as JobId,
        queueName: 'flow_node',
        data: {},
      }),
    );

    mockJobEnqueuer = TestUtils.createMockJobEnqueuer();
    mockJobEnqueuer.queueFlowNodeExecution.mockResolvedValue(
      TestUtils.createMockJob({
        id: 'job-123' as JobId,
        queueName: 'flow_node',
        data: {},
      }),
    );

    mockPrismaService = TestUtils.createMockPrismaServiceWithTypes();
    mockFlowExecutionService = TestUtils.createMockFlowExecutionService();
    mockFlowExecutionService.createFlowExecution.mockResolvedValue({
      id: 'exec-123' as FlowExecutionId,
    });

    // Default: getLastSystemMessage returns null (no prior messages)
    mockMessageService.getLastSystemMessage = jest.fn().mockResolvedValue(null);

    mockAppContext = {
      get: jest.fn((service) => {
        if (service === ConversationService) return mockConversationService;
        if (service === MessageService) return mockMessageService;
        if (service === NodeExecutionService) return mockFlowEngine;
        if (service === FlowExecutionService) return mockFlowExecutionService;
        if (service === QUEUE_SERVICE_TOKEN) return mockQueueService;
        if (service === JOB_ENQUEUER_TOKEN) return mockJobEnqueuer;
        if (service === PrismaService) return mockPrismaService;
        throw new Error(`Unknown service: ${String(service)}`);
      }),
      select: jest.fn(),
      resolve: jest.fn(),
      registerRequestByContextId: jest.fn(),
      close: jest.fn(),
      init: jest.fn(),
      enableShutdownHooks: jest.fn(),
      useGlobalPrefix: jest.fn(),
    } as unknown as INestApplicationContext;

    (getAppContextForWorker as jest.Mock).mockResolvedValue(mockAppContext);

    // Clear the mocked log functions
    (log.info as jest.Mock).mockClear();
    (log.debug as jest.Mock).mockClear();
    (log.error as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initializeConversationFlow', () => {
    it('should initialize flow context successfully', async () => {
      const mockConversation = TestUtils.createMockConversation({
        id: testIds.conversation,
        workflowId: testIds.workflow,
        projectId: testIds.project,
      });

      mockConversationService.createConversation.mockResolvedValue(
        mockConversation,
      );

      const result = await activities.initializeConversationFlow({
        projectId: testIds.project,
        organizationId: testIds.organization,
        workflowId: testIds.workflow,
        flowId: WorkflowName.Onboarding,
        userId: testIds.user,
        ...baseInitializeParams,
      });

      expect(mockConversationService.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: testIds.project,
          workflowName: WorkflowName.Onboarding,
          status: ConversationStatus.Started,
          workflowAboutId: baseInitializeParams.workflowAboutId,
          workflowAboutType: baseInitializeParams.workflowAboutType,
        }),
        testIds.organization,
      );

      expect(result.context.core.projectId).toBe(testIds.project);
      expect(result.context.core.organizationId).toBe(testIds.organization);
      expect(result.context.core.conversationId).toBe(testIds.conversation);
      expect(result.context.core.user.id).toBe(testIds.user);
      expect(result.startNode).toBeDefined();
      expect(result.hasOpener).toBeDefined();
      expect(result.executionId).toBeDefined();
    });

    it('creates the conversation DTO for goal-pm', async () => {
      mockConversationService.createConversation.mockResolvedValue(
        TestUtils.createMockConversation({
          id: testIds.conversation,
          workflowId: testIds.workflow,
          projectId: testIds.project,
        }),
      );

      await activities.initializeConversationFlow({
        projectId: testIds.project,
        organizationId: testIds.organization,
        workflowId: testIds.workflow,
        flowId: WorkflowName.GoalPm,
        userId: testIds.user,
        ...baseInitializeParams,
      });

      expect(mockConversationService.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowName: WorkflowName.GoalPm,
          workflowAboutId: baseInitializeParams.workflowAboutId,
          workflowAboutType: baseInitializeParams.workflowAboutType,
        }),
        testIds.organization,
      );
    });

    it('should handle conversation creation failure', async () => {
      mockConversationService.createConversation.mockResolvedValue(null);

      await expect(
        activities.initializeConversationFlow({
          projectId: testIds.project,
          organizationId: testIds.organization,
          workflowId: testIds.workflow,
          flowId: WorkflowName.Onboarding,
          ...baseInitializeParams,
        }),
      ).rejects.toThrow('Failed to create conversation for flow: onboarding');
    });

    it('should resume existing conversation when conversationId is provided', async () => {
      const existingConversation = TestUtils.createMockConversation({
        id: testIds.conversation,
        workflowId: testIds.workflow,
        projectId: testIds.project,
        status: ConversationStatus.InProgress,
      });

      mockConversationService.getConversation.mockResolvedValue(
        existingConversation,
      );
      mockFlowExecutionService.findByConversation.mockResolvedValue(null);

      const result = await activities.initializeConversationFlow({
        projectId: testIds.project,
        organizationId: testIds.organization,
        workflowId: testIds.workflow,
        flowId: WorkflowName.Onboarding,
        conversationId: testIds.conversation,
        ...baseInitializeParams,
      });

      expect(mockConversationService.getConversation).toHaveBeenCalledWith(
        testIds.conversation,
        testIds.organization,
      );
      expect(result.context.core.conversationId).toBe(testIds.conversation);
    });

    it('should handle system-initiated workflows without userId', async () => {
      const mockConversation = TestUtils.createMockConversation({
        id: testIds.conversation,
        workflowId: testIds.workflow,
        projectId: testIds.project,
      });

      mockConversationService.createConversation.mockResolvedValue(
        mockConversation,
      );

      const result = await activities.initializeConversationFlow({
        projectId: testIds.project,
        organizationId: testIds.organization,
        workflowId: testIds.workflow,
        flowId: WorkflowName.Onboarding,
        initiatedBy: 'SYSTEM',
        ...baseInitializeParams,
      });

      expect(result.context.core.user.id).toBe('SYSTEM');
    });

    it('should require userId for user-initiated workflows', async () => {
      await expect(
        activities.initializeConversationFlow({
          projectId: testIds.project,
          organizationId: testIds.organization,
          workflowId: testIds.workflow,
          flowId: WorkflowName.Onboarding,
          initiatedBy: 'USER',
          ...baseInitializeParams,
        }),
      ).rejects.toThrow('userId is required for user-initiated workflows');
    });

    it('should handle missing conversation ID', async () => {
      const mockConversation = {
        workflowId: testIds.workflow,
        projectId: testIds.project,
        // Missing id
      };

      mockConversationService.createConversation.mockResolvedValue(
        mockConversation as unknown as ConversationResponseDto,
      );

      await expect(
        activities.initializeConversationFlow({
          projectId: testIds.project,
          organizationId: testIds.organization,
          workflowId: testIds.workflow,
          flowId: WorkflowName.Onboarding,
          ...baseInitializeParams,
        }),
      ).rejects.toThrow('Failed to create conversation for flow: onboarding');
    });

    describe('resuming a completed conversation', () => {
      // Production code MUTATES the context (clears pendingTransition,
      // overwrites workflowId, etc.) so each test must get a fresh fixture —
      // otherwise the second test sees the new workflowId already on the
      // saved context and the resume branch gets skipped via isOwnExecution.
      const buildCompletedContext = (): WriteableFlowContext => ({
        core: {
          // OLD workflow id — must differ from the new workflowId, otherwise
          // production treats it as a pre-created execution and skips resume.
          workflowId: 'previous-completed-workflow-id' as WorkflowId,
          projectId: testIds.project,
          organizationId: testIds.organization,
          conversationId: testIds.conversation,
          workflowAboutId: 'entity-123',
          workflowAboutType: 'project',
          user: { id: testIds.user, role: 'member' },
          session: { startTime: new Date(), interactionCount: 5 },
        },
        flowId: 'onboarding',
        lastSystemMessageId: 'old-system-msg-999' as MessageId,
        pendingTransition: {
          nextNodeId: 'some-old-next-node',
          reason: 'opener_complete',
        },
        flowPath: {
          pathTaken: ['welcome', 'step-1', 'step-2'],
          previousNode: 'step-1',
          previousTransition: 'user_response',
        },
      });

      let completedContext: WriteableFlowContext;
      let completedExecution: ReturnType<typeof buildCompletedExecution>;

      function buildCompletedExecution(context: WriteableFlowContext) {
        return {
          id: 'old-exec-456',
          flowId: 'onboarding',
          status: 'COMPLETED' as const,
          currentNode: 'welcome',
          flowState: {
            step: WorkflowStep.COMPLETING_FLOW,
            phase: WorkflowPhase.COMPLETING,
            nodeConfig: {
              id: 'welcome',
              type: 'OPENER',
              supportsPhases: false,
            },
            iterations: 5,
            lastSystemMessageId: 'old-system-msg-999' as MessageId,
            lastUserMessageId: 'old-user-msg-888' as MessageId,
            context,
            currentNodeId: 'welcome',
            currentNodeExecutionId: undefined,
            timestamp: new Date().toISOString(),
            version: 1,
          },
          resumable: true,
          startedAt: new Date(),
          completedAt: new Date(),
        };
      }

      beforeEach(() => {
        completedContext = buildCompletedContext();
        completedExecution = buildCompletedExecution(completedContext);

        const existingConversation = TestUtils.createMockConversation({
          id: testIds.conversation,
          workflowId: testIds.workflow,
          projectId: testIds.project,
          status: ConversationStatus.Completed,
          workflowAboutType: 'project',
          workflowAboutId: 'entity-123',
        });

        mockConversationService.getConversation.mockResolvedValue(
          existingConversation,
        );
        mockFlowExecutionService.findByConversation.mockResolvedValue(
          completedExecution,
        );
        mockFlowExecutionService.createFlowExecution.mockResolvedValue({
          id: 'new-exec-789' as FlowExecutionId,
        });
      });

      it('should clear pendingTransition from old execution context', async () => {
        const result = await activities.initializeConversationFlow({
          projectId: testIds.project,
          organizationId: testIds.organization,
          workflowId: testIds.workflow,
          flowId: WorkflowName.Onboarding,
          conversationId: testIds.conversation,
          ...baseInitializeParams,
        });

        expect(result.context.pendingTransition).toBeUndefined();
      });

      it('should refresh lastSystemMessageId from database instead of keeping stale value', async () => {
        const latestMsg = TestUtils.createMockMessage({
          id: 'latest-db-msg-42' as MessageId,
        });
        mockMessageService.getLastSystemMessage.mockResolvedValue(latestMsg);

        const result = await activities.initializeConversationFlow({
          projectId: testIds.project,
          organizationId: testIds.organization,
          workflowId: testIds.workflow,
          flowId: WorkflowName.Onboarding,
          conversationId: testIds.conversation,
          ...baseInitializeParams,
        });

        // Should have looked up the actual latest message, not kept the old value
        expect(mockMessageService.getLastSystemMessage).toHaveBeenCalledWith(
          testIds.conversation,
          testIds.organization,
        );
        expect(result.context.lastSystemMessageId).toBe('latest-db-msg-42');
        // Verify it's NOT the stale value from the old execution
        expect(result.context.lastSystemMessageId).not.toBe(
          'old-system-msg-999',
        );
      });

      it('should set lastSystemMessageId to undefined when no messages exist', async () => {
        mockMessageService.getLastSystemMessage.mockResolvedValue(null);

        const result = await activities.initializeConversationFlow({
          projectId: testIds.project,
          organizationId: testIds.organization,
          workflowId: testIds.workflow,
          flowId: WorkflowName.Onboarding,
          conversationId: testIds.conversation,
          ...baseInitializeParams,
        });

        expect(result.context.lastSystemMessageId).toBeUndefined();
      });

      it('should reset flowPath for fresh start', async () => {
        const result = await activities.initializeConversationFlow({
          projectId: testIds.project,
          organizationId: testIds.organization,
          workflowId: testIds.workflow,
          flowId: WorkflowName.Onboarding,
          conversationId: testIds.conversation,
          ...baseInitializeParams,
        });

        expect(result.context.flowPath?.pathTaken).toEqual([]);
        expect(result.context.flowPath?.previousNode).toBeUndefined();
        expect(result.context.flowPath?.previousTransition).toBeUndefined();
      });

      it('should reset conversation status to IN_PROGRESS', async () => {
        await activities.initializeConversationFlow({
          projectId: testIds.project,
          organizationId: testIds.organization,
          workflowId: testIds.workflow,
          flowId: WorkflowName.Onboarding,
          conversationId: testIds.conversation,
          ...baseInitializeParams,
        });

        expect(
          mockConversationService.updateConversationInternal,
        ).toHaveBeenCalledWith(testIds.conversation, testIds.organization, {
          status: ConversationStatus.InProgress,
        });
      });

      it('should create a new execution (not reuse the completed one)', async () => {
        const result = await activities.initializeConversationFlow({
          projectId: testIds.project,
          organizationId: testIds.organization,
          workflowId: testIds.workflow,
          flowId: WorkflowName.Onboarding,
          conversationId: testIds.conversation,
          ...baseInitializeParams,
        });

        expect(
          mockFlowExecutionService.createFlowExecution,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            flowId: WorkflowName.Onboarding,
            currentNode: 'welcome', // flow.startNode
          }),
        );
        expect(result.executionId).toBe('new-exec-789');
      });

      it('should start from beginning (startNode) not the old currentNode', async () => {
        const result = await activities.initializeConversationFlow({
          projectId: testIds.project,
          organizationId: testIds.organization,
          workflowId: testIds.workflow,
          flowId: WorkflowName.Onboarding,
          conversationId: testIds.conversation,
          ...baseInitializeParams,
        });

        expect(result.startNode).toBe('welcome');
      });

      it('should not set isResuming (this is a fresh restart, not a resume)', async () => {
        const result = await activities.initializeConversationFlow({
          projectId: testIds.project,
          organizationId: testIds.organization,
          workflowId: testIds.workflow,
          flowId: WorkflowName.Onboarding,
          conversationId: testIds.conversation,
          ...baseInitializeParams,
        });

        expect(result.isResuming).toBeFalsy();
      });

      it('should preserve core context fields from old execution', async () => {
        const result = await activities.initializeConversationFlow({
          projectId: testIds.project,
          organizationId: testIds.organization,
          workflowId: testIds.workflow,
          flowId: WorkflowName.Onboarding,
          conversationId: testIds.conversation,
          ...baseInitializeParams,
        });

        // Core identity should be preserved from the completed execution
        expect(result.context.core.projectId).toBe(testIds.project);
        expect(result.context.core.organizationId).toBe(testIds.organization);
        expect(result.context.core.conversationId).toBe(testIds.conversation);
      });

      it('should update workflowId to the new workflow when restarting a completed conversation', async () => {
        const oldWorkflowId = 'old-dead-workflow-id' as WorkflowId;

        // Override the completed execution to have a DIFFERENT workflowId
        // (simulating the previous workflow that is now gone)
        const staleContext: WriteableFlowContext = {
          ...completedContext,
          core: { ...completedContext.core, workflowId: oldWorkflowId },
        };
        mockFlowExecutionService.findByConversation.mockResolvedValue({
          ...completedExecution,
          flowState: {
            ...completedExecution.flowState,
            context: staleContext,
          },
        });

        const newWorkflowId = testIds.workflow; // the "current" workflow
        const result = await activities.initializeConversationFlow({
          projectId: testIds.project,
          organizationId: testIds.organization,
          workflowId: newWorkflowId,
          flowId: WorkflowName.Onboarding,
          conversationId: testIds.conversation,
          ...baseInitializeParams,
        });

        // The returned context must carry the NEW workflowId, not the old one
        expect(result.context.core.workflowId).toBe(newWorkflowId);
        expect(result.context.core.workflowId).not.toBe(oldWorkflowId);
      });

      it('should persist cleaned context in the new execution flowState', async () => {
        const latestMsg = TestUtils.createMockMessage({
          id: 'latest-db-msg-42' as MessageId,
        });
        mockMessageService.getLastSystemMessage.mockResolvedValue(latestMsg);

        await activities.initializeConversationFlow({
          projectId: testIds.project,
          organizationId: testIds.organization,
          workflowId: testIds.workflow,
          flowId: WorkflowName.Onboarding,
          conversationId: testIds.conversation,
          ...baseInitializeParams,
        });

        const createCall =
          mockFlowExecutionService.createFlowExecution.mock.calls[0]![0];
        const savedFlowState = createCall!.flowState;

        // The persisted flowState.context should have cleaned stale routing
        // but preserved the refreshed lastSystemMessageId
        expect(savedFlowState!.context.pendingTransition).toBeUndefined();
        expect(savedFlowState!.context.lastSystemMessageId).toBe(
          'latest-db-msg-42',
        );
        expect(savedFlowState!.context.flowPath?.pathTaken).toEqual([]);
      });
    });

    describe('resuming an incomplete conversation', () => {
      const oldWorkflowId = 'old-incomplete-workflow-id' as WorkflowId;

      const incompleteContext: WriteableFlowContext = {
        core: {
          workflowId: oldWorkflowId,
          projectId: testIds.project,
          organizationId: testIds.organization,
          conversationId: testIds.conversation,
          workflowAboutId: 'entity-123',
          workflowAboutType: 'project',
          user: { id: testIds.user, role: 'member' },
          session: { startTime: new Date(), interactionCount: 3 },
        },
        flowId: 'onboarding',
        lastSystemMessageId: 'sys-msg-456' as MessageId,
        flowPath: {
          pathTaken: ['welcome'],
          previousNode: undefined,
          previousTransition: undefined,
        },
      };

      const incompleteExecution = {
        id: 'exec-incomplete-789',
        flowId: 'onboarding',
        status: 'IN_PROGRESS' as const,
        currentNode: 'welcome',
        flowState: {
          step: WorkflowStep.EXECUTING_OPENER,
          phase: WorkflowPhase.OPENER,
          nodeConfig: {
            id: 'welcome',
            type: 'OPENER',
            supportsPhases: false,
          },
          iterations: 1,
          lastSystemMessageId: 'sys-msg-456' as MessageId,
          lastUserMessageId: undefined,
          context: incompleteContext,
          currentNodeId: 'welcome',
          currentNodeExecutionId: undefined,
          timestamp: new Date().toISOString(),
          version: 1,
        },
        resumable: true,
        startedAt: new Date(),
        completedAt: null,
      };

      beforeEach(() => {
        const existingConversation = TestUtils.createMockConversation({
          id: testIds.conversation,
          workflowId: oldWorkflowId,
          projectId: testIds.project,
          status: ConversationStatus.InProgress,
          workflowAboutType: 'project',
          workflowAboutId: 'entity-123',
        });

        mockConversationService.getConversation.mockResolvedValue(
          existingConversation,
        );
        mockFlowExecutionService.findByConversation.mockResolvedValue(
          incompleteExecution,
        );
      });

      it('should update workflowId to the new workflow when resuming', async () => {
        const newWorkflowId = testIds.workflow;

        const result = await activities.initializeConversationFlow({
          projectId: testIds.project,
          organizationId: testIds.organization,
          workflowId: newWorkflowId,
          flowId: WorkflowName.Onboarding,
          conversationId: testIds.conversation,
          ...baseInitializeParams,
        });

        expect(result.context.core.workflowId).toBe(newWorkflowId);
        expect(result.context.core.workflowId).not.toBe(oldWorkflowId);
        expect(result.isResuming).toBe(true);
      });
    });
  });

  describe('executeFlowNode', () => {
    const mockFlow = TestUtils.createMockFlow({
      id: 'test-flow',
      startNode: 'test-node',
    });
    let currentFlow = mockFlow;

    const mockJob = TestUtils.createMockJob({
      id: 'job-123' as JobId,
      queueName: 'flow_node',
      data: {},
    });

    beforeEach(() => {
      currentFlow = mockFlow;
      (mockFlowEngine.getFlow as jest.Mock).mockImplementation(
        () => currentFlow,
      );
      (mockFlowEngine.getNode as jest.Mock).mockImplementation(
        (_flowId: string, requestedNodeId: string) => {
          const node = currentFlow?.nodes?.[requestedNodeId];
          return node ? { node } : null;
        },
      );
      mockQueueService.addJob.mockResolvedValue(mockJob);
      mockMessageService.addMessage.mockResolvedValue(
        TestUtils.createMockMessage({ id: testIds.message }),
      );
      mockMessageService.appendMessageToConversation.mockResolvedValue(
        TestUtils.createMockMessage({ id: testIds.message }),
      );
      mockConversationService.getConversation.mockResolvedValue({
        id: 'conv-123',
        workflowId: 'wf-123',
        projectId: 'proj-123',
      } as ConversationResponseDto);
    });

    it('should enqueue flow node execution and return requestId', async () => {
      const testContext = createMockContext();
      const userMessage: FlowUserMessage = {
        data: { message: 'test' },
        timestamp: new Date(),
        id: 'msg-123' as MessageId,
      } as unknown as FlowUserMessage;

      const result = await activities.executeFlowNode({
        flowId: 'test-flow',
        nodeId: 'test-node',
        context: testContext,
        userMessage,
        lastUserMessageId: userMessage.id,
      });

      expect(mockFlowEngine.getFlow).toHaveBeenCalledWith('test-flow');
      expect(mockFlowEngine.startFlowNode).toHaveBeenCalledWith(
        expect.objectContaining({
          node: mockFlow.nodes['test-node'],
          context: testContext,
          conversationId: testContext.core.conversationId,
          workflowId: testContext.core.workflowId,
          projectId: testContext.core.projectId,
          organizationId: testContext.core.organizationId,
          requestId: expect.any(String),
          userMessageId: userMessage.id,
          parentMessageId: userMessage.id,
          options: {
            appendMessage: false,
          },
        }),
      );

      expect(result).toEqual(
        expect.objectContaining({
          requestId: expect.any(String),
        }),
      );
    });

    it('should handle generate nodes', async () => {
      const testContext = createMockContext();
      currentFlow = TestUtils.createMockFlow({
        id: 'test-flow',
        startNode: 'generate-node',
      });
      currentFlow.nodes['generate-node'] = {
        id: 'generate-node',
        type: NodeType.GENERATE,
        title: 'Generate Node',
      } as any;

      await activities.executeFlowNode({
        flowId: 'test-flow',
        nodeId: 'generate-node',
        context: testContext,
        userMessage: undefined,
        lastUserMessageId: 'msg-123' as MessageId,
      });

      expect(mockFlowEngine.startFlowNode).toHaveBeenCalledWith(
        expect.objectContaining({
          node: currentFlow.nodes['generate-node'],
          context: testContext,
          conversationId: testContext.core.conversationId,
          workflowId: testContext.core.workflowId,
          projectId: testContext.core.projectId,
          organizationId: testContext.core.organizationId,
          requestId: expect.any(String),
          userMessageId: 'msg-123',
          parentMessageId: undefined,
          options: {
            appendMessage: true,
          },
        }),
      );
    });

    it('should handle flow not found', async () => {
      (mockFlowEngine.getFlow as jest.Mock).mockReturnValue(undefined);

      await expect(
        activities.executeFlowNode({
          flowId: 'non-existent',
          nodeId: 'test-node',
          context: createMockContext(),
          userMessage: undefined,
          lastUserMessageId: 'msg-123' as MessageId,
        }),
      ).rejects.toThrow('Flow non-existent not found');
    });

    it('should handle node not found', async () => {
      await expect(
        activities.executeFlowNode({
          flowId: 'test-flow' as WorkflowName,
          nodeId: 'non-existent-node',
          context: createMockContext(),
          userMessage: undefined,
          lastUserMessageId: 'msg-123' as MessageId,
        }),
      ).rejects.toThrow(/Node non-existent-node not found in flow test-flow/);
    });

    it('should work without user message', async () => {
      const testContext = createMockContext();
      const result = await activities.executeFlowNode({
        flowId: 'test-flow',
        nodeId: 'test-node',
        context: testContext,
        userMessage: undefined,
        lastUserMessageId: 'msg-123' as MessageId,
      });

      expect(mockFlowEngine.startFlowNode).toHaveBeenCalledWith(
        expect.objectContaining({
          node: mockFlow.nodes['test-node'],
          context: testContext,
          conversationId: testContext.core.conversationId,
          workflowId: testContext.core.workflowId,
          projectId: testContext.core.projectId,
          organizationId: testContext.core.organizationId,
          requestId: expect.any(String),
          userMessageId: 'msg-123',
          parentMessageId: undefined,
          options: {
            appendMessage: true,
          },
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          requestId: expect.any(String),
        }),
      );
    });

    it('should use FlowEngineService to orchestrate message and job creation', async () => {
      const testContext = createMockContext();
      await activities.executeFlowNode({
        flowId: 'test-flow',
        nodeId: 'test-node',
        context: testContext,
        userMessage: undefined,
        lastUserMessageId: 'msg-123' as MessageId,
      });

      // Verify FlowEngineService.startFlowNode was called to orchestrate both message creation and job queuing
      expect(mockFlowEngine.startFlowNode).toHaveBeenCalledWith(
        expect.objectContaining({
          node: mockFlow.nodes['test-node'],
          context: testContext,
          conversationId: testContext.core.conversationId,
          workflowId: testContext.core.workflowId,
          projectId: testContext.core.projectId,
          organizationId: testContext.core.organizationId,
          requestId: expect.any(String),
          userMessageId: 'msg-123',
          parentMessageId: undefined,
          options: {
            appendMessage: true,
          },
        }),
      );
    });

    it('should extract parent message ID from user message metadata', async () => {
      const testContext = createMockContext();
      const userMessage: FlowUserMessage = TestUtils.createMockFlowUserMessage({
        id: 'parent-msg-123' as MessageId,
      });

      await activities.executeFlowNode({
        flowId: 'test-flow',
        nodeId: 'test-node',
        context: testContext,
        userMessage,
        lastUserMessageId: userMessage.id,
      });

      expect(mockFlowEngine.startFlowNode).toHaveBeenCalledWith(
        expect.objectContaining({
          node: mockFlow.nodes['test-node'],
          context: testContext,
          conversationId: testContext.core.conversationId,
          workflowId: testContext.core.workflowId,
          projectId: testContext.core.projectId,
          organizationId: testContext.core.organizationId,
          requestId: expect.any(String),
          userMessageId: userMessage.id,
          parentMessageId: 'parent-msg-123',
          options: {
            appendMessage: false,
          },
        }),
      );
    });
  });

  describe('createSystemMessage', () => {
    const mockNodeResult: NodeResult = TestUtils.createMockNodeResult({
      type: NodeType.ACTION,
      message: 'Test system message',
      data: {
        type: 'action',
        detectedIntent: 'test_intent',
        intentConfidence: 0.9,
      },
      uiElements: [
        {
          type: 'text_input',
          id: 'input1',
          label: 'Test Input',
          influences: [],
        },
      ],
      actions: [{ type: 'test_action' }],
    });

    const mockConversation = TestUtils.createMockConversation({}, [
      'workflowId',
      'projectId',
    ]);

    const mockFlow = TestUtils.createMockFlow();

    beforeEach(() => {
      mockConversationService.getConversation.mockResolvedValue(
        mockConversation as ConversationResponseDto,
      );
      mockMessageService.addMessage.mockResolvedValue(
        TestUtils.createMockMessage(),
      );
      mockMessageService.appendMessageToConversation.mockResolvedValue(
        TestUtils.createMockMessage(),
      );
      (mockFlowEngine.getFlow as jest.Mock).mockReturnValue(mockFlow);
      (mockFlowEngine.getNode as jest.Mock).mockReturnValue({
        node: {
          id: 'test-node',
          type: NodeType.LLM_QUESTIONS,
          title: 'Test Node',
        },
      });
    });

    it('should create system message successfully', async () => {
      const testContext = createMockContext();
      await activities.createSystemMessage({
        conversationId: 'conv-123' as ConversationId,
        organizationId: 'org-123' as OrganizationId,
        nodeResult: mockNodeResult,
        nodeId: 'test-node',
        flowId: 'test-flow',
        context: testContext,
      });

      expect(mockConversationService.getConversation).toHaveBeenCalledWith(
        'conv-123',
        'org-123',
      );
      expect(mockFlowEngine.getNode).toHaveBeenCalledWith(
        'test-flow',
        'test-node',
      );
      expect(
        mockMessageService.appendMessageToConversation,
      ).toHaveBeenCalledWith(
        'conv-123',
        expect.objectContaining({
          workflowId: testIds.workflow,
          projectId: testIds.project,
          type: 'SYSTEM',
          data: expect.objectContaining({
            detectedIntent: '',
            intentConfidence: 0,
            type: 'QUESTIONS',
            response: 'Test system message',
            nodeId: 'test-node',
            flowId: 'test-flow',
            title: 'Test Node',
            uiElements: mockNodeResult.uiElements,
            actions: mockNodeResult.actions,
          }),
          status: MessageStatus.Open,
        }),
        testContext.core.organizationId,
        'createSystemMessage-test-node',
      );
    });

    it('propagates NodeResult.triggersAgent onto data.triggersAgent and stamps triggerMessageId equal to the persisted message id', async () => {
      const testContext = createMockContext();
      const triggeringResult: NodeResult = TestUtils.createMockNodeResult({
        type: NodeType.EXTERNAL_AGENT,
        message: 'Getting started...',
        data: {
          detectedIntent: 'feature_sync_analyze_started',
          intentConfidence: 1,
          ragEnabled: false,
        },
        uiElements: [],
        triggersAgent: {
          promptType: 'feature_sync_analyze',
          nodeId: 'feature-sync-analyze',
          payload: { taskId: 'feature-sync-task-id' },
        },
      });

      await activities.createSystemMessage({
        conversationId: 'conv-123' as ConversationId,
        organizationId: 'org-123' as OrganizationId,
        nodeResult: triggeringResult,
        nodeId: 'feature-sync-analyze',
        flowId: 'feature-sync',
        context: testContext,
      });

      expect(mockMessageService.appendMessageToConversation).toHaveBeenCalled();
      const call =
        mockMessageService.appendMessageToConversation.mock.calls.at(-1);
      expect(call).toBeDefined();
      const [calledConversationId, messageArg, calledOrgId, calledSource] =
        call as [
          string,
          { id: string; data: { triggersAgent: Record<string, unknown> } },
          string,
          string,
        ];
      expect(calledConversationId).toBe('conv-123');
      expect(calledOrgId).toBe(testContext.core.organizationId);
      expect(calledSource).toBe('createSystemMessage-feature-sync-analyze');
      expect(typeof messageArg.id).toBe('string');
      expect(messageArg.id.length).toBeGreaterThan(0);
      expect(messageArg.data.triggersAgent).toEqual({
        promptType: 'feature_sync_analyze',
        nodeId: 'feature-sync-analyze',
        payload: { taskId: 'feature-sync-task-id' },
        triggerMessageId: messageArg.id,
      });
    });

    it('should handle conversation not found', async () => {
      mockConversationService.getConversation.mockResolvedValue(null);

      await expect(
        activities.createSystemMessage({
          conversationId: 'conv-123' as ConversationId,
          organizationId: 'org-123' as OrganizationId,
          nodeResult: mockNodeResult,
          nodeId: 'test-node',
          flowId: 'test-flow' as WorkflowName,
          context: createMockContext(),
        }),
      ).rejects.toThrow('Conversation conv-123 not found');
    });

    it('should handle message creation failure', async () => {
      mockMessageService.appendMessageToConversation.mockRejectedValue(
        new Error('Message creation failed'),
      );

      await expect(
        activities.createSystemMessage({
          conversationId: 'conv-123' as ConversationId,
          organizationId: 'org-123' as OrganizationId,
          nodeResult: mockNodeResult,
          nodeId: 'test-node',
          flowId: 'test-flow' as WorkflowName,
          context: createMockContext(),
        }),
      ).rejects.toThrow('Message creation failed');
    });
  });

  describe('saveFlowState', () => {
    beforeEach(() => {
      mockConversationService.updateConversationInternal.mockResolvedValue(
        {} as ConversationResponseDto,
      );
    });

    it('should save flow state successfully with generating status', async () => {
      const testContext = createMockContext();
      const workflowState = TestUtils.createMockWorkflowState({
        context: testContext,
        currentNodeId: 'current-node',
        flowId: 'onboarding' as WorkflowName,
        executionId: mockExecutionId,
        conversationId: testContext.core.conversationId,
        organizationId: testContext.core.organizationId,
      });

      await activities.saveFlowState({
        workflowState,
        executionId: mockExecutionId,
      });

      expect(
        mockConversationService.updateConversationInternal,
      ).toHaveBeenCalledWith(
        testContext.core.conversationId,
        testContext.core.organizationId,
        expect.objectContaining({
          status: ConversationStatus.GeneratingResponse,
          title: expect.stringMatching(/^onboarding - \w+ \w+ \w+$/),
        }),
      );
    });

    it('should save flow state with in-progress status when waiting for user', async () => {
      const testContext = createMockContext();
      const workflowState = TestUtils.createMockWorkflowState({
        context: testContext,
        currentNodeId: 'current-node',
        flowId: 'onboarding' as WorkflowName,
        executionId: mockExecutionId,
        conversationId: testContext.core.conversationId,
        organizationId: testContext.core.organizationId,
        step: WorkflowStep.WAITING_FOR_USER_INPUT,
      });

      await activities.saveFlowState({
        workflowState,
        executionId: mockExecutionId,
      });

      expect(
        mockConversationService.updateConversationInternal,
      ).toHaveBeenCalledWith(
        testContext.core.conversationId,
        testContext.core.organizationId,
        expect.objectContaining({
          status: ConversationStatus.InProgress,
          title: expect.stringMatching(/^onboarding - \w+ \w+ \w+$/),
        }),
      );
    });

    it('should treat waiting state as in-progress even with pending responses', async () => {
      const testContext = createMockContext();
      const workflowState = TestUtils.createMockWorkflowState({
        context: testContext,
        currentNodeId: 'current-node',
        flowId: 'onboarding' as WorkflowName,
        executionId: mockExecutionId,
        conversationId: testContext.core.conversationId,
        organizationId: testContext.core.organizationId,
        step: WorkflowStep.WAITING_FOR_USER_INPUT,
        pendingLLMResponse: TestUtils.createMockLLMResponsePayload(),
      });

      await activities.saveFlowState({
        workflowState,
        executionId: mockExecutionId,
      });

      expect(
        mockConversationService.updateConversationInternal,
      ).toHaveBeenCalledWith(
        testContext.core.conversationId,
        testContext.core.organizationId,
        expect.objectContaining({
          status: ConversationStatus.InProgress,
          title: expect.stringMatching(/^onboarding - \w+ \w+ \w+$/),
        }),
      );
    });

    it('should keep custom conversation titles when saving flow state', async () => {
      const testContext = createMockContext();
      mockConversationService.findOne.mockResolvedValue({
        title: 'Custom Conversation Title',
      } as ConversationResponseDto);
      const workflowState = TestUtils.createMockWorkflowState({
        context: testContext,
        currentNodeId: 'current-node',
        flowId: 'onboarding' as WorkflowName,
        executionId: mockExecutionId,
        conversationId: testContext.core.conversationId,
        organizationId: testContext.core.organizationId,
      });

      await activities.saveFlowState({
        workflowState,
        executionId: mockExecutionId,
      });

      expect(
        mockConversationService.updateConversationInternal,
      ).toHaveBeenCalledWith(
        testContext.core.conversationId,
        testContext.core.organizationId,
        {
          status: ConversationStatus.GeneratingResponse,
        },
      );
    });

    it('should handle update failure', async () => {
      mockConversationService.updateConversationInternal.mockRejectedValue(
        new Error('Update failed'),
      );

      const testContext = createMockContext();
      const workflowState = TestUtils.createMockWorkflowState({
        context: testContext,
        currentNodeId: 'current-node',
        flowId: 'onboarding' as WorkflowName,
        executionId: mockExecutionId,
        conversationId: testContext.core.conversationId,
        organizationId: testContext.core.organizationId,
      });

      await expect(
        activities.saveFlowState({
          workflowState,
          executionId: mockExecutionId,
        }),
      ).rejects.toThrow('Update failed');
    });
  });

  describe('completeFlow', () => {
    beforeEach(() => {
      mockConversationService.updateConversationInternal.mockResolvedValue(
        {} as ConversationResponseDto,
      );
      mockFlowExecutionService.findById = jest.fn().mockResolvedValue({
        id: mockExecutionId,
        status: 'IN_PROGRESS',
      });
    });

    it('should complete flow successfully', async () => {
      const testContext = createMockContext();
      const contextWithInitiatives = {
        ...testContext,
      };

      await activities.completeFlow({
        context: contextWithInitiatives,
        finalNodeId: 'final-node',
        flowId: 'test-flow',
        totalIterations: 5,
        executionId: mockExecutionId,
      });

      expect(
        mockConversationService.updateConversationInternal,
      ).toHaveBeenCalledWith(
        testContext.core.conversationId,
        testContext.core.organizationId,
        expect.objectContaining({
          status: ConversationStatus.Completed,
        }),
      );

      const updateArgs =
        mockConversationService.updateConversationInternal.mock.calls[0]?.[2];
      expect(updateArgs?.title).toBeUndefined();

      // Note: The completion message is logged via console.log in activities
      // We can see from console output that it's working correctly
    });

    it('should handle flow without initiatives', async () => {
      await activities.completeFlow({
        context: createMockContext(),
        finalNodeId: 'final-node',
        flowId: 'test-flow',
        totalIterations: 3,
        executionId: mockExecutionId,
      });

      expect(
        mockConversationService.updateConversationInternal,
      ).toHaveBeenCalled();
      expect(log.info).not.toHaveBeenCalled();
    });

    it('should handle completion failure', async () => {
      mockConversationService.updateConversationInternal.mockRejectedValue(
        new Error('Completion failed'),
      );

      await expect(
        activities.completeFlow({
          context: createMockContext(),
          finalNodeId: 'final-node',
          flowId: 'test-flow' as WorkflowName,
          totalIterations: 1,
          executionId: mockExecutionId,
        }),
      ).rejects.toThrow('Completion failed');
    });
  });

  describe('error handling in queue-based execution', () => {
    it('should handle startFlowNode service errors', async () => {
      const queueError = new Error('Queue service unavailable');
      (mockFlowEngine.startFlowNode as jest.Mock).mockRejectedValue(queueError);

      const mockFlow = TestUtils.createMockFlow({
        id: 'test-flow',
      });
      mockFlow.nodes['test-node'] = TestUtils.createMockConversationNode({
        id: 'test-node',
        type: NodeType.ACTION,
      });
      (mockFlowEngine.getFlow as jest.Mock).mockReturnValue(mockFlow);
      (mockFlowEngine.getNode as jest.Mock).mockReturnValue({
        node: mockFlow.nodes['test-node'],
      });

      await expect(
        activities.executeFlowNode({
          flowId: 'test-flow' as WorkflowName,
          nodeId: 'test-node',
          context: createMockContext(),
          userMessage: undefined,
          lastUserMessageId: 'msg-123' as MessageId,
        }),
      ).rejects.toThrow('Queue service unavailable');
    });

    it('should handle missing app context', async () => {
      (getAppContextForWorker as jest.Mock).mockRejectedValue(
        new Error('Context unavailable'),
      );

      await expect(
        activities.initializeConversationFlow({
          projectId: 'proj-123' as ProjectId,
          organizationId: 'org-123' as OrganizationId,
          workflowId: 'wf-123' as WorkflowId,
          flowId: 'test-flow' as WorkflowName,
          ...baseInitializeParams,
        }),
      ).rejects.toThrow('Context unavailable');
    });

    it('should handle service unavailable', async () => {
      (mockAppContext.get as jest.Mock).mockImplementation(() => {
        throw new Error('Service not found');
      });

      await expect(
        activities.initializeConversationFlow({
          projectId: 'proj-123' as ProjectId,
          organizationId: 'org-123' as OrganizationId,
          workflowId: 'wf-123' as WorkflowId,
          flowId: 'test-flow' as WorkflowName,
          ...baseInitializeParams,
        }),
      ).rejects.toThrow('Service not found');
    });
  });

  describe('integration with existing conversation patterns', () => {
    it('should use placeholder interaction type for migration compatibility', async () => {
      const mockConversation = {
        id: 'conv-123',
        workflowId: 'wf-123',
        projectId: 'proj-123',
      };

      mockConversationService.createConversation.mockResolvedValue(
        mockConversation as unknown as ConversationResponseDto,
      );

      await activities.initializeConversationFlow({
        projectId: 'proj-123' as ProjectId,
        organizationId: 'org-123' as OrganizationId,
        workflowId: 'wf-123' as WorkflowId,
        flowId: WorkflowName.Onboarding,
        ...baseInitializeParams,
      });

      expect(mockConversationService.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowName: WorkflowName.Onboarding,
          workflowAboutId: baseInitializeParams.workflowAboutId,
          workflowAboutType: baseInitializeParams.workflowAboutType,
        }),
        'org-123',
      );
    });
  });

  describe('generateNodeContent', () => {
    const mockFlow = TestUtils.createMockFlow({
      id: 'test-flow',
      startNode: 'gather-node',
    });

    beforeEach(() => {
      (mockFlowEngine.getNode as jest.Mock).mockReturnValue({
        node: {
          id: 'gather-node',
          type: NodeType.LLM_QUESTIONS,
          title: 'Gather Information',
        },
      });
      (mockFlowEngine.getFlow as jest.Mock).mockReturnValue(mockFlow);
      (mockFlowEngine.startFlowNode as jest.Mock).mockResolvedValue({
        job: TestUtils.createMockJob({ id: testIds.job }),
        message: TestUtils.createMockMessage({ id: testIds.message }),
      });
    });

    it('should generate content for LLM_QUESTIONS nodes', async () => {
      const testContext = createMockContext();
      const userMessage = TestUtils.createMockFlowUserMessage({
        id: testIds.parentMessage,
      });

      const result = await activities.generateNodeContent({
        flowId: 'test-flow',
        nodeId: 'gather-node',
        context: testContext,
        userMessage,
      });

      expect(mockFlowEngine.getNode).toHaveBeenCalledWith(
        'test-flow',
        'gather-node',
      );
      expect(mockFlowEngine.startFlowNode).toHaveBeenCalledWith(
        expect.objectContaining({
          node: expect.objectContaining({
            id: 'gather-node',
            type: NodeType.LLM_QUESTIONS,
          }),
          context: testContext,
          conversationId: testContext.core.conversationId,
          workflowId: testContext.core.workflowId,
          projectId: testContext.core.projectId,
          organizationId: testContext.core.organizationId,
          requestId: expect.any(String),
          userMessageId: undefined,
          parentMessageId: testIds.parentMessage,
        }),
      );

      expect(result.requestId).toBeDefined();
      expect(result.updatedContext.lastSystemMessageId).toBe(testIds.message);
    });

    it('should generate content for GENERATE nodes', async () => {
      (mockFlowEngine.getNode as jest.Mock).mockReturnValue({
        node: {
          id: 'generate-node',
          type: NodeType.GENERATE,
          title: 'Generate Content',
        },
      });

      const testContext = createMockContext();

      const result = await activities.generateNodeContent({
        flowId: 'test-flow',
        nodeId: 'generate-node',
        context: testContext,
      });

      expect(mockFlowEngine.getNode).toHaveBeenCalledWith(
        'test-flow',
        'generate-node',
      );
      expect(result.requestId).toBeDefined();
    });

    it('should fall back to executeFlowNode for non-two-phase nodes', async () => {
      (mockFlowEngine.getNode as jest.Mock).mockReturnValue({
        node: {
          id: 'action-node',
          type: NodeType.ACTION,
          title: 'Action Node',
        },
      });

      const mockFlowWithActionNode = TestUtils.createMockFlow({
        id: 'test-flow',
      });
      mockFlowWithActionNode.nodes['action-node'] = {
        id: 'action-node',
        type: NodeType.ACTION,
        title: 'Action Node',
      } as any;
      (mockFlowEngine.getFlow as jest.Mock).mockReturnValue(
        mockFlowWithActionNode,
      );

      const testContext = createMockContext();

      const result = await activities.generateNodeContent({
        flowId: 'test-flow',
        nodeId: 'action-node',
        context: testContext,
      });

      expect(result.requestId).toBeDefined();
    });

    it('should resolve parent message ID correctly', async () => {
      const baseContext = createMockContext();
      const testContext = {
        ...baseContext,
        lastSystemMessageId: 'previous-system-msg' as MessageId,
      };

      await activities.generateNodeContent({
        flowId: 'test-flow',
        nodeId: 'gather-node',
        context: testContext,
        lastUserMessageId: 'msg-123' as MessageId,
      });

      expect(mockFlowEngine.startFlowNode).toHaveBeenCalledWith(
        expect.objectContaining({
          parentMessageId: 'previous-system-msg',
        }),
      );
    });
  });

  describe('nodeNeedsTwoPhaseExecution', () => {
    beforeEach(() => {
      (mockFlowEngine.getNode as jest.Mock).mockClear();
    });

    it('should return true for LLM_QUESTIONS nodes', async () => {
      (mockFlowEngine.getNode as jest.Mock).mockReturnValue({
        node: {
          id: 'gather-node',
          type: NodeType.LLM_QUESTIONS,
          twoPhase: true,
        },
      });

      const result = await activities.nodeNeedsTwoPhaseExecution({
        flowId: 'test-flow',
        nodeId: 'gather-node',
      });

      expect(result).toBe(true);
    });

    it('should return true for GENERATE nodes', async () => {
      (mockFlowEngine.getNode as jest.Mock).mockReturnValue({
        node: {
          id: 'generate-node',
          type: NodeType.GENERATE,
          twoPhase: true,
        },
      });

      const result = await activities.nodeNeedsTwoPhaseExecution({
        flowId: 'test-flow',
        nodeId: 'generate-node',
      });

      expect(result).toBe(true);
    });

    it('should return false for FINALIZE nodes', async () => {
      (mockFlowEngine.getNode as jest.Mock).mockReturnValue({
        node: {
          id: 'finalize-node',
          type: NodeType.FINALIZE,
          twoPhase: false,
        },
      });

      const result = await activities.nodeNeedsTwoPhaseExecution({
        flowId: 'test-flow',
        nodeId: 'finalize-node',
      });

      expect(result).toBe(false);
    });

    it('should return true for CLASSIFICATION nodes', async () => {
      (mockFlowEngine.getNode as jest.Mock).mockReturnValue({
        node: {
          id: 'classify-node',
          type: NodeType.CLASSIFICATION,
          twoPhase: true,
        },
      });

      const result = await activities.nodeNeedsTwoPhaseExecution({
        flowId: 'test-flow',
        nodeId: 'classify-node',
      });

      expect(result).toBe(true);
    });

    it('should return false for ACTION nodes', async () => {
      (mockFlowEngine.getNode as jest.Mock).mockReturnValue({
        node: {
          id: 'action-node',
          type: NodeType.ACTION,
          twoPhase: false,
        },
      });

      const result = await activities.nodeNeedsTwoPhaseExecution({
        flowId: 'test-flow',
        nodeId: 'action-node',
      });

      expect(result).toBe(false);
    });

    it('should throw error for non-existent nodes', async () => {
      (mockFlowEngine.getNode as jest.Mock).mockReturnValue(null);

      await expect(
        activities.nodeNeedsTwoPhaseExecution({
          flowId: 'test-flow',
          nodeId: 'non-existent',
        }),
      ).rejects.toThrow(/Node non-existent not found in flow test-flow/);
    });
  });

  describe('processNodeResponse', () => {
    it.each([
      [true, ONBOARDING_NODES.REPOSITORY_GROUNDING_INTENT],
      [false, ONBOARDING_NODES.REPOSITORY_GROUNDING_INTENT],
      [undefined, ONBOARDING_NODES.REPOSITORY_GROUNDING_INTENT],
    ])(
      'routes onboarding intake with intentRequired=%s to %s',
      async (repositoryGroundingIntentRequired, expectedNodeId) => {
        const context = {
          ...createMockContext(),
          repositoryGroundingIntentRequired,
        } as OnboardingFlowContext;
        const node = new OnboardingWelcomeNode(
          {} as FeatureFlagService,
          {} as ContextResolutionService,
        );
        (mockFlowEngine.getNode as jest.Mock).mockReturnValue({
          node,
          routing: onboardingFlow.nodes[ONBOARDING_NODES.WELCOME],
        });

        const result = await activities.processNodeResponse({
          flowId: 'onboarding',
          nodeId: ONBOARDING_NODES.WELCOME,
          context,
          userMessage: TestUtils.createMockFlowUserMessage({
            id: testIds.message,
            handler: SecondaryActionHandler.ContinueConversation,
          }),
        });

        expect(result.nextNodeId).toBe(expectedNodeId);
        expect(result.updatedContext).toMatchObject({
          repositoryGroundingIntentRequired,
        });
      },
    );

    it('applies processUserResponse before routing and returns updated context', async () => {
      const context = createMockContext() as FlowContext;
      const userMessage = TestUtils.createMockFlowUserMessage({
        id: testIds.message,
      });
      const node = TestUtils.createMockConversationNode({
        id: 'route-node',
        determineRoutingFromUserMessage: jest
          .fn()
          .mockImplementation((updatedContext: FlowContext) =>
            (updatedContext as Record<string, unknown>).stageApproved
              ? 'next-node'
              : 'fallback-node',
          ),
        processUserResponse: jest.fn(async (tracker, _userMessage) => {
          tracker.mutate((draft) => {
            (draft as Record<string, unknown>).stageApproved = true;
          });
        }),
      });

      (mockFlowEngine.getNode as jest.Mock).mockReturnValue({
        node,
        routing: { nextNode: 'fallback-node' },
      });

      const result = await activities.processNodeResponse({
        flowId: 'test-flow',
        nodeId: 'route-node',
        context,
        userMessage,
      });

      expect(node.processUserResponse).toHaveBeenCalledWith(
        expect.anything(),
        userMessage,
      );
      expect(node.determineRoutingFromUserMessage).toHaveBeenCalledWith(
        expect.objectContaining({ stageApproved: true }),
        userMessage,
      );
      expect(result.nextNodeId).toBe('next-node');
      expect(
        (result.updatedContext as Record<string, unknown>).stageApproved,
      ).toBe(true);
    });

    it('uses determineRoutingFromUserMessage for OPENER nodes', async () => {
      const context = createMockContext() as FlowContext;
      const userMessage = TestUtils.createMockFlowUserMessage({
        id: testIds.message,
        handler: SecondaryActionHandler.ContinueConversation,
      });
      const node = TestUtils.createMockConversationNode({
        id: 'opener-node',
        type: NodeType.OPENER,
        determineRoutingFromUserMessage: jest
          .fn()
          .mockResolvedValue('conversation-node'),
      });

      (mockFlowEngine.getNode as jest.Mock).mockReturnValue({
        node,
        routing: { nextNode: 'default-node' },
      });

      const result = await activities.processNodeResponse({
        flowId: 'test-flow',
        nodeId: 'opener-node',
        context,
        userMessage,
      });

      expect(node.determineRoutingFromUserMessage).toHaveBeenCalledWith(
        context,
        userMessage,
      );
      expect(result.nextNodeId).toBe('conversation-node');
    });
  });

  describe('processNodeResponse - EXTERNAL_AGENT action routing', () => {
    const externalAgentActions = {
      NO_DISCREPANCY: {
        schema: z.object({}).optional(),
        waitForUser: false,
      },
      DISCREPANCY: {
        schema: z.object({
          items: z.array(z.string()).min(1),
        }),
        waitForUser: false,
      },
    } as const;

    const agentMessage = (data: Record<string, unknown>): FlowUserMessage =>
      TestUtils.createMockFlowUserMessage({
        userId: 'system',
        data,
      });

    const buildExternalAgentNode = () =>
      TestUtils.createMockConversationNode({
        id: 'ext-node',
        type: NodeType.EXTERNAL_AGENT,
        actions: externalAgentActions,
      } as unknown as Partial<
        ReturnType<typeof TestUtils.createMockConversationNode>
      >);

    it('routes analysis to outline review and hands created Features to a conversation', async () => {
      const analysisNode = new OnboardingRepositoryGroundingAnalysisNode();
      const enrichmentNode = new RepositoryFeatureEnrichmentNode();
      const choiceNode = new RepositoryImportEnrichmentChoiceNode();
      const nodes = new Map<string, INode>([
        [analysisNode.id, analysisNode],
        [choiceNode.id, choiceNode],
        [enrichmentNode.id, enrichmentNode],
      ]);
      (mockFlowEngine.getNode as jest.Mock).mockImplementation(
        (flowId: string, nodeId: string) => {
          const node = nodes.get(nodeId);
          const routing = repositoryImportFlow.nodes[nodeId];
          return flowId === repositoryImportFlow.id && node && routing
            ? { node, routing }
            : undefined;
        },
      );

      const accepted: RepositoryGroundingWorkflowContext = {
        prerequisites: {
          entryMode: 'new_project' as const,
          serviceId: '44444444-4444-4444-8444-444444444444',
          confirmedServiceBrief: 'Owns repository-backed onboarding.',
          machineId: '55555555-5555-4555-8555-555555555555',
        },
        analysisConfiguration: {
          scope: { scope: 'comprehensive' as const },
          provider: 'codex',
          resolvedFrontierModel: 'gpt-6-astra',
          reasoningEffort: 'high',
          fastMode: false,
          bounds: REPOSITORY_GROUNDING_DETERMINISTIC_BOUNDS,
        },
      };
      const baseline = {
        outcome: 'success' as const,
        serviceId: accepted.prerequisites.serviceId,
        provider: accepted.analysisConfiguration.provider,
        resolvedFrontierModel:
          accepted.analysisConfiguration.resolvedFrontierModel,
        narrative: 'Repository-backed product capabilities.',
        hierarchy: {
          topLevels: [
            {
              id: 'imports',
              name: 'Repository imports',
              description: 'Imports repository-backed product context.',
              tag: FeatureTag.Product,
              children: [
                {
                  id: 'analysis',
                  name: 'Repository analysis',
                  description: 'Analyzes bounded repository evidence.',
                  tag: FeatureTag.Backend,
                },
                {
                  id: 'review',
                  name: 'Feature review',
                  description: 'Reviews proposed Features before placement.',
                  tag: FeatureTag.Frontend,
                },
              ],
            },
          ],
        },
        evidence: [{ path: 'src/import.ts', summary: 'Import workflow.' }],
        briefDiscrepancies: [],
      } satisfies RepositoryGroundingSuccess;
      const initialContext = {
        ...TestUtils.createMockFlowContext({ flowId: repositoryImportFlow.id }),
        repositoryGrounding: accepted,
      } as OnboardingFlowContext;

      const analysis = await activities.processNodeResponse({
        flowId: repositoryImportFlow.id,
        nodeId: analysisNode.id,
        context: initialContext,
        userMessage: agentMessage({ action: 'success', payload: baseline }),
      });

      expect(analysis.nextNodeId).toBe(
        REPOSITORY_IMPORT_NODES.GENERATE_FEATURES,
      );
      expect(analysis.updatedContext).toMatchObject({
        repositoryGroundingBaseline: baseline,
      });
      const outlineReview = new OnboardingGenerateFeaturesNode(
        {} as FeatureListLifecycleService,
      );
      expect(
        await outlineReview.getPrecomputedResponse(
          createMutableContextHandle(
            analysis.updatedContext as OnboardingFlowContext,
          ),
        ),
      ).toMatchObject({
        narrative: baseline.narrative,
        topLevels: [{ candidateId: 'imports' }],
      });
      const reviewedContext: OnboardingFlowContext = {
        ...(analysis.updatedContext as OnboardingFlowContext),
        repositoryImportMaterializedFeatureIds: [
          '66666666-6666-4666-8666-666666666666',
        ],
      };
      const chosen = await activities.processNodeResponse({
        flowId: repositoryImportFlow.id,
        nodeId: choiceNode.id,
        context: reviewedContext,
        userMessage: TestUtils.createMockFlowUserMessage({
          data: { [ENRICHMENT_CHOICE_FIELD]: 'ENRICH' } as never,
        }),
      });
      expect(chosen.nextNodeId).toBe(REPOSITORY_IMPORT_NODES.ENRICHMENT);
      expect(chosen.updatedContext).toMatchObject({
        repositoryFeatureEnrichmentChoice: 'ENRICH',
      });
      const handoffContext = {
        ...chosen.updatedContext,
        repositoryImportMaterializedFeatureIds: [
          '66666666-6666-4666-8666-666666666666',
        ],
      } as OnboardingFlowContext;
      const result = await enrichmentNode.execute(
        createMutableContextHandle(handoffContext),
      );
      expect(result).toMatchObject({
        type: NodeType.FINALIZE,
        triggersAgent: {
          promptType: 'repository_feature_enrichment',
          payload: {
            analysis: baseline,
            materializedFeatureIds:
              handoffContext.repositoryImportMaterializedFeatureIds,
          },
        },
      });
    });

    it('routes to the per-action transition on a valid action + payload', async () => {
      const context = createMockContext() as FlowContext;
      const node = buildExternalAgentNode();

      (mockFlowEngine.getNode as jest.Mock).mockReturnValue({
        node,
        routing: {
          transitions: {
            NO_DISCREPANCY: {
              description: 'no drift',
              nextNodeId: 'no-diff-node',
            },
            DISCREPANCY: {
              description: 'drift found',
              nextNodeId: 'diff-node',
            },
            default: {
              description: 'fallback',
              nextNodeId: 'fallback-node',
            },
          },
        },
      });

      const result = await activities.processNodeResponse({
        flowId: 'test-flow',
        nodeId: 'ext-node',
        context,
        userMessage: agentMessage({
          action: 'DISCREPANCY',
          payload: { items: ['X'] },
        }),
      });

      expect(result.nextNodeId).toBe('diff-node');
    });

    it('falls through to transitions.default for valid actions without a dedicated branch', async () => {
      const context = createMockContext() as FlowContext;
      const node = buildExternalAgentNode();

      (mockFlowEngine.getNode as jest.Mock).mockReturnValue({
        node,
        routing: {
          transitions: {
            DISCREPANCY: {
              description: 'drift found',
              nextNodeId: 'diff-node',
            },
            default: {
              description: 'everything else',
              nextNodeId: 'fallback-node',
            },
          },
        },
      });

      const result = await activities.processNodeResponse({
        flowId: 'test-flow',
        nodeId: 'ext-node',
        context,
        userMessage: agentMessage({ action: 'NO_DISCREPANCY' }),
      });

      expect(result.nextNodeId).toBe('fallback-node');
    });

    it('throws ExternalAgentValidationError for an unknown action (engine stays paused)', async () => {
      const context = createMockContext() as FlowContext;
      const node = buildExternalAgentNode();

      (mockFlowEngine.getNode as jest.Mock).mockReturnValue({
        node,
        routing: {
          transitions: {
            NO_DISCREPANCY: {
              description: 'ok',
              nextNodeId: 'no-diff-node',
            },
            default: { description: 'fallback', nextNodeId: 'fallback-node' },
          },
        },
      });

      await expect(
        activities.processNodeResponse({
          flowId: 'test-flow',
          nodeId: 'ext-node',
          context,
          userMessage: agentMessage({ action: 'NEVER_DECLARED', payload: {} }),
        }),
      ).rejects.toMatchObject({
        name: 'ExternalAgentValidationError',
        reason: 'unknown_action',
      });
    });

    it('throws ExternalAgentValidationError for an invalid payload (engine stays paused)', async () => {
      const context = createMockContext() as FlowContext;
      const node = buildExternalAgentNode();

      (mockFlowEngine.getNode as jest.Mock).mockReturnValue({
        node,
        routing: {
          transitions: {
            DISCREPANCY: {
              description: 'drift',
              nextNodeId: 'diff-node',
            },
            default: { description: 'fallback', nextNodeId: 'fallback-node' },
          },
        },
      });

      await expect(
        activities.processNodeResponse({
          flowId: 'test-flow',
          nodeId: 'ext-node',
          context,
          userMessage: agentMessage({
            action: 'DISCREPANCY',
            payload: { items: [] },
          }),
        }),
      ).rejects.toMatchObject({
        name: 'ExternalAgentValidationError',
        reason: 'invalid_payload',
      });
    });

    it('throws ExternalAgentValidationError with reason=missing_action when action is absent', async () => {
      const context = createMockContext() as FlowContext;
      const node = buildExternalAgentNode();

      (mockFlowEngine.getNode as jest.Mock).mockReturnValue({
        node,
        routing: {
          transitions: {
            default: { description: 'fallback', nextNodeId: 'fallback-node' },
          },
        },
      });

      await expect(
        activities.processNodeResponse({
          flowId: 'test-flow',
          nodeId: 'ext-node',
          context,
          userMessage: agentMessage({ payload: { items: ['x'] } }),
        }),
      ).rejects.toMatchObject({
        name: 'ExternalAgentValidationError',
        reason: 'missing_action',
      });
    });

    it('does not engage action validation for synthetic CONTROL messages authored by system', async () => {
      const context = createMockContext() as FlowContext;
      const node = buildExternalAgentNode();

      (mockFlowEngine.getNode as jest.Mock).mockReturnValue({
        node,
        routing: {
          transitions: {
            default: { description: 'fallback', nextNodeId: 'fallback-node' },
          },
        },
      });

      const controlMessage = TestUtils.createMockFlowUserMessage({
        userId: 'system',
        data: { type: 'CONTROL', action: 'NEVER_DECLARED' },
      });

      const result = await activities.processNodeResponse({
        flowId: 'test-flow',
        nodeId: 'ext-node',
        context,
        userMessage: controlMessage,
      });

      // CONTROL messages are excluded from `isCompletionCandidateMessage`, so
      // action validation does not engage; the message falls through to
      // default routing as any other message would.
      expect(result.nextNodeId).toBe('fallback-node');
    });

    it('routes a user-authored (button click) action through the action map', async () => {
      // The loosening: a USER message carrying a declared action now resolves
      // through validateExternalAgentCompletion + the action map, exactly as an
      // agent-authored completion does. Authorship is no longer the
      // discriminator — the action map enforces the real contract.
      const context = createMockContext() as FlowContext;
      const node = buildExternalAgentNode();

      (mockFlowEngine.getNode as jest.Mock).mockReturnValue({
        node,
        routing: {
          transitions: {
            DISCREPANCY: {
              description: 'drift found',
              nextNodeId: 'diff-node',
            },
            default: { description: 'fallback', nextNodeId: 'fallback-node' },
          },
        },
      });

      const userAuthoredMessage = TestUtils.createMockFlowUserMessage({
        userId: 'real-user',
        data: { action: 'DISCREPANCY', payload: { items: ['x'] } },
      });

      const result = await activities.processNodeResponse({
        flowId: 'test-flow',
        nodeId: 'ext-node',
        context,
        userMessage: userAuthoredMessage,
      });

      expect(result.nextNodeId).toBe('diff-node');
    });

    it('throws ExternalAgentValidationError for a user-authored message with an unknown action', async () => {
      // The contract is enforced for user-authored messages too: a malformed
      // submission leaves the node paused rather than silently advancing.
      const context = createMockContext() as FlowContext;
      const node = buildExternalAgentNode();

      (mockFlowEngine.getNode as jest.Mock).mockReturnValue({
        node,
        routing: {
          transitions: {
            default: { description: 'fallback', nextNodeId: 'fallback-node' },
          },
        },
      });

      const userAuthoredMessage = TestUtils.createMockFlowUserMessage({
        userId: 'real-user',
        data: { action: 'NOT_A_REAL_ACTION' },
      });

      await expect(
        activities.processNodeResponse({
          flowId: 'test-flow',
          nodeId: 'ext-node',
          context,
          userMessage: userAuthoredMessage,
        }),
      ).rejects.toMatchObject({
        name: 'ExternalAgentValidationError',
        reason: 'unknown_action',
      });
    });
  });

  describe('createErrorSystemMessage', () => {
    const testContext = TestUtils.createMockFlowContext();

    beforeEach(() => {
      mockConversationService.getConversation.mockResolvedValue(
        TestUtils.createMockConversation(),
      );
      mockMessageService.appendMessageToConversation.mockResolvedValue(
        TestUtils.createMockMessage(),
      );
      (mockFlowEngine.getFlow as jest.Mock).mockReturnValue(
        TestUtils.createMockFlow(),
      );
    });

    it('should create opener error message', async () => {
      await activities.createErrorSystemMessage({
        conversationId: testIds.conversation,
        organizationId: testIds.organization,
        flowId: 'test-flow',
        context: testContext,
        errorType: 'opener_error',
        errorMessage: 'Test opener error',
        nodeId: 'test-node',
      });

      expect(
        mockMessageService.appendMessageToConversation,
      ).toHaveBeenCalledWith(
        testIds.conversation,
        expect.objectContaining({
          type: 'SYSTEM',
          data: expect.objectContaining({
            type: 'ERROR',
            response:
              'I encountered an issue starting our conversation. Please try again later.',
          }),
        }),
        testIds.organization,
        'createSystemMessage-test-node',
      );
    });

    it('should create timeout error message', async () => {
      await activities.createErrorSystemMessage({
        conversationId: testIds.conversation,
        organizationId: testIds.organization,
        flowId: 'test-flow',
        context: testContext,
        errorType: 'timeout',
        errorMessage: 'Test timeout',
        nodeId: 'test-node',
      });

      expect(
        mockMessageService.appendMessageToConversation,
      ).toHaveBeenCalledWith(
        testIds.conversation,
        expect.objectContaining({
          data: expect.objectContaining({
            response: expect.stringContaining(
              "I haven't heard from you in a while",
            ),
          }),
        }),
        testIds.organization,
        'createSystemMessage-test-node',
      );
    });

    it('should create processing error message', async () => {
      await activities.createErrorSystemMessage({
        conversationId: testIds.conversation,
        organizationId: testIds.organization,
        flowId: 'test-flow',
        context: testContext,
        errorType: 'processing_error',
        errorMessage: 'Test processing error',
        nodeId: 'test-node',
      });

      expect(
        mockMessageService.appendMessageToConversation,
      ).toHaveBeenCalledWith(
        testIds.conversation,
        expect.objectContaining({
          data: expect.objectContaining({
            response:
              'I encountered an issue processing your request. Let me try to help you in a different way.',
          }),
        }),
        testIds.organization,
        'createSystemMessage-test-node',
      );
    });

    it('should handle custom error messages', async () => {
      await activities.createErrorSystemMessage({
        conversationId: testIds.conversation,
        organizationId: testIds.organization,
        flowId: 'test-flow',
        context: testContext,
        errorType: 'processing_error',
        errorMessage: 'Custom error message',
        nodeId: 'test-node',
        temporary: false,
      });

      expect(
        mockMessageService.appendMessageToConversation,
      ).toHaveBeenCalledWith(
        testIds.conversation,
        expect.objectContaining({
          type: 'SYSTEM',
          data: expect.objectContaining({
            type: 'ERROR',
            response:
              'I encountered an issue processing your request. Let me try to help you in a different way.',
            nodeId: 'test-node',
            flowId: 'test-flow',
          }),
        }),
        testIds.organization,
        'createSystemMessage-test-node',
      );
    });
  });

  describe('getNodeInfo', () => {
    beforeEach(() => {
      const mockFlow = TestUtils.createMockFlow();
      mockFlow.nodes['action-node'] = {
        id: 'action-node',
        type: NodeType.ACTION,
        title: 'Action Node',
      } as any;
      mockFlow.nodes['gather-node'] = {
        id: 'gather-node',
        type: NodeType.LLM_QUESTIONS,
        title: 'Gather Node',
      } as any;
      mockFlow.nodes['custom-node'] = {
        id: 'custom-node',
        type: NodeType.OPENER,
        title: 'Custom Node',
      } as any;

      (mockFlowEngine.getFlow as jest.Mock).mockReturnValue(mockFlow);
      (mockFlowEngine.getNode as jest.Mock).mockImplementation(
        (_flowId: string, requestedNodeId: string) => {
          const node = mockFlow.nodes[requestedNodeId];
          return node ? { node } : null;
        },
      );
    });

    it('should return info for ACTION nodes with default continue behavior', async () => {
      const result = await activities.getNodeInfo({
        flowId: 'test-flow',
        nodeId: 'action-node',
      });

      expect(result.nodeType).toBe(NodeType.ACTION);
    });

    it('should return info for LLM_QUESTIONS nodes with explicit continue behavior', async () => {
      const result = await activities.getNodeInfo({
        flowId: 'test-flow',
        nodeId: 'gather-node',
      });

      expect(result.nodeType).toBe(NodeType.LLM_QUESTIONS);
    });

    it('should return info for custom nodes', async () => {
      const result = await activities.getNodeInfo({
        flowId: 'test-flow',
        nodeId: 'custom-node',
      });

      expect(result.nodeType).toBe(NodeType.OPENER);
    });

    it('should throw error for non-existent flow', async () => {
      (mockFlowEngine.getFlow as jest.Mock).mockReturnValue(null);

      await expect(
        activities.getNodeInfo({
          flowId: 'non-existent-flow',
          nodeId: 'test-node',
        }),
      ).rejects.toThrow('Flow non-existent-flow not found');
    });

    it('should throw error for non-existent node', async () => {
      await expect(
        activities.getNodeInfo({
          flowId: 'test-flow',
          nodeId: 'non-existent-node',
        }),
      ).rejects.toThrow(/Node non-existent-node not found in flow test-flow/);
    });
  });
});
