import { FlowExecutionStatus } from '@prisma/client';
import { FlowExecutionService } from '../flow-execution.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ConversationId,
  FlowExecutionId,
  MessageId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
  WorkflowAboutType,
} from '../../../types';
import {
  FlowContext,
  FlowTemplate,
  NodeType,
} from '../../../types/flow-internal.types';
import { TEMPORAL_CLIENT } from '../../../prisma/temporal.module';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';
import {
  flowContextToSerializableState,
  SerializableWorkflowState,
} from '../../../workflows/conversation-workflow-state';
import * as TestUtils from '../../../utils/testUtils';
import { ConversationService } from '../../conversation.service';
import { ConversationWorkflowService } from '../conversation-workflow.service';
import { NodeExecutionService } from '../node-execution.service';
import { PendingTriggerService } from '../pending-trigger.service';
import { WorkflowTypeRegistryService } from '../workflow-type-registry.service';
import {
  PromptTypeResponseDto,
  WorkflowName,
  SystemMessageResponseType,
} from '../../../generated';
import { LocalPromptType } from '../../../generated/local';

const WorkflowState = PromptTypeResponseDto.WorkflowStateEnum;
import { createMutableContextHandle } from '../../../utils/mutable-context';
import { WorkflowSignals } from '../../../utils/workflow-signals.util';
import { ConfigService } from '@nestjs/config';

describe('FlowExecutionService', () => {
  let service: FlowExecutionService;
  let mockCreate: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockFindFirst: jest.Mock;
  let mockCount: jest.Mock;
  let mockPrismaService: jest.Mocked<PrismaService>;
  let temporalClientMock: { workflow: { getHandle: jest.Mock } };
  let conversationServiceMock: { getConversation: jest.Mock };
  let conversationWorkflowServiceMock: {
    startWorkflowForExistingConversation: jest.Mock;
  };
  let workflowTypeRegistryMock: { validateWorkflowName: jest.Mock };
  let configServiceMock: { get: jest.Mock };
  let nodeExecutionServiceMock: { getFlow: jest.Mock; getNode: jest.Mock };
  let pendingTriggerServiceMock: { resolvePendingTriggerForNode: jest.Mock };

  const mockOrganizationId = 'org-123' as OrganizationId;
  const mockProjectId = 'proj-123' as ProjectId;
  const mockUserId = 'user-123' as UserId;
  const mockConversationId = 'conv-123' as ConversationId;
  const mockExecutionId = 'exec-123' as FlowExecutionId;
  const mockWorkflowId = 'wf-123' as WorkflowId;
  const mockRestartedWorkflowId = 'wf-456' as WorkflowId;

  const baseFlowContext = TestUtils.createMockFlowContext();
  const mockFlowContext: FlowContext = {
    ...baseFlowContext,
    core: {
      ...baseFlowContext.core,
      workflowId: mockWorkflowId,
      projectId: mockProjectId,
      organizationId: mockOrganizationId,
      conversationId: mockConversationId,
      workflowAboutId: mockProjectId,
      workflowAboutType: 'project' as WorkflowAboutType,
      user: { id: mockUserId, role: 'member' },
      session: { startTime: new Date(), interactionCount: 0 },
    },
    flowId: 'test-flow',
    flowPath: {
      pathTaken: ['start'],
      previousNode: undefined,
      previousTransition: undefined,
    },
  };

  const mockSerializableState: SerializableWorkflowState =
    flowContextToSerializableState(mockFlowContext, 'start', undefined);

  const mockFlowExecution = {
    id: mockExecutionId,
    userId: mockUserId,
    flowId: 'test-flow',
    organizationId: mockOrganizationId,
    projectId: mockProjectId,
    conversationId: mockConversationId,
    entityType: 'initiative',
    entityId: 'init-123',
    status: FlowExecutionStatus.STARTED,
    startedAt: new Date(),
    completedAt: null as Date | null,
    currentNode: 'start',
    totalNodes: 3,
    flowState: mockSerializableState,
    resumable: true,
    errorMessage: null as string | null,
    errorCode: null as string | null,
  };

  beforeEach(async () => {
    mockCreate = jest.fn();
    mockUpdate = jest.fn();
    mockFindFirst = jest.fn();
    mockCount = jest.fn();

    temporalClientMock = {
      workflow: {
        getHandle: jest.fn().mockReturnValue({
          signal: jest.fn(),
          query: jest.fn(),
        }),
      },
    };

    nodeExecutionServiceMock = {
      getFlow: jest.fn(),
      getNode: jest.fn(),
    };

    pendingTriggerServiceMock = {
      resolvePendingTriggerForNode: jest.fn(),
    };

    conversationServiceMock = {
      getConversation: jest.fn(),
    };

    conversationWorkflowServiceMock = {
      startWorkflowForExistingConversation: jest.fn(),
    };

    workflowTypeRegistryMock = {
      validateWorkflowName: jest.fn(),
    };

    configServiceMock = {
      get: jest.fn().mockReturnValue(undefined),
    };

    mockPrismaService =
      TestUtils.createMockPrismaService() as unknown as jest.Mocked<PrismaService>;

    mockPrismaService.db.flowExecution = {
      create: mockCreate,
      update: mockUpdate,
      findFirst: mockFindFirst,
      findMany: jest.fn().mockResolvedValue([]),
      count: mockCount,
    } as any;

    (
      mockPrismaService.db.conversation.findUnique as jest.Mock
    ).mockResolvedValue({ id: mockConversationId });
    (mockPrismaService.db.user.findUnique as jest.Mock).mockResolvedValue({
      id: mockUserId,
    });
    (
      mockPrismaService.db.organization.findUnique as jest.Mock
    ).mockResolvedValue({ id: mockOrganizationId });
    (mockPrismaService.db.project.findUnique as jest.Mock).mockResolvedValue({
      id: mockProjectId,
    });

    const setup = await createServiceTestingModule({
      providers: [
        FlowExecutionService,
        PrismaService,
        ConversationService,
        ConversationWorkflowService,
        WorkflowTypeRegistryService,
        ConfigService,
        NodeExecutionService,
        PendingTriggerService,
      ],
      overrides: [
        [PrismaService, mockPrismaService],
        [TEMPORAL_CLIENT, temporalClientMock],
        [ConversationService, conversationServiceMock],
        [ConversationWorkflowService, conversationWorkflowServiceMock],
        [WorkflowTypeRegistryService, workflowTypeRegistryMock],
        [ConfigService, configServiceMock],
        [NodeExecutionService, nodeExecutionServiceMock],
        [PendingTriggerService, pendingTriggerServiceMock],
      ],
    });

    service = setup.module.get<FlowExecutionService>(FlowExecutionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createFlowExecution', () => {
    it('should create a new flow execution successfully', async () => {
      const createData = {
        userId: mockUserId,
        flowId: 'test-flow',
        organizationId: mockOrganizationId,
        projectId: mockProjectId,
        conversationId: mockConversationId,
        entityType: 'initiative',
        entityId: 'init-123',
        currentNode: 'start',
        totalNodes: 3,
        flowState: mockSerializableState,
        resumable: true,
      };

      mockCreate.mockResolvedValue(mockFlowExecution);

      const result = await service.createFlowExecution(createData);

      expect(result).toEqual({ id: mockExecutionId });
      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          userId: mockUserId,
          flowId: 'test-flow',
          organizationId: mockOrganizationId,
          projectId: mockProjectId,
          conversationId: mockConversationId,
          entityType: 'initiative',
          entityId: 'init-123',
          currentNode: 'start',
          totalNodes: 3,
          flowState: mockSerializableState,
          resumable: true,
          status: FlowExecutionStatus.STARTED,
        },
      });
    });

    it('should handle missing optional fields', async () => {
      const createData = {
        userId: mockUserId,
        flowId: 'test-flow',
        organizationId: mockOrganizationId,
        projectId: mockProjectId,
      };

      mockCreate.mockResolvedValue({
        ...mockFlowExecution,
        conversationId: null,
        entityType: null,
        entityId: null,
      });

      const result = await service.createFlowExecution(createData);

      expect(result).toEqual({ id: mockExecutionId });
      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          userId: mockUserId,
          flowId: 'test-flow',
          organizationId: mockOrganizationId,
          projectId: mockProjectId,
          conversationId: null,
          entityType: null,
          entityId: null,
          currentNode: undefined,
          totalNodes: undefined,
          flowState: null,
          resumable: true,
          status: FlowExecutionStatus.STARTED,
        },
      });
    });
  });

  describe('sendNodeResponseToWorkflow', () => {
    const createNotFoundHandle = () => ({
      signal: jest.fn().mockRejectedValue(
        Object.assign(new Error('workflow not found'), {
          name: 'WorkflowNotFoundError',
        }),
      ),
    });

    const systemMessageData = {
      type: SystemMessageResponseType.Questions,
      response: 'Test response',
      uiElements: [{ id: 'field-1', type: 'textarea', label: 'Test' }],
      nodeId: 'adr-refinement-welcome',
    };

    it('restarts workflow and sends skip signal on WorkflowNotFoundError', async () => {
      const missingWorkflowHandle = createNotFoundHandle();
      const restartedWorkflowHandle = {
        signal: jest.fn().mockResolvedValue(undefined),
      };

      temporalClientMock.workflow.getHandle = jest
        .fn()
        .mockImplementation((workflowId: WorkflowId) => {
          if (workflowId === mockWorkflowId) {
            return missingWorkflowHandle;
          }
          return restartedWorkflowHandle;
        });

      conversationServiceMock.getConversation.mockResolvedValue({
        id: mockConversationId,
        workflowId: mockWorkflowId,
        workflowName: WorkflowName.Adr,
      });

      workflowTypeRegistryMock.validateWorkflowName.mockReturnValue(
        WorkflowName.Adr,
      );

      conversationWorkflowServiceMock.startWorkflowForExistingConversation.mockResolvedValue(
        {
          workflowId: mockRestartedWorkflowId,
          success: true,
        },
      );

      const baseContext = TestUtils.createMockFlowContext();
      const tracker = createMutableContextHandle({
        ...baseContext,
        core: {
          ...baseContext.core,
          organizationId: mockOrganizationId,
          conversationId: mockConversationId,
        },
      });

      await service.sendNodeResponseToWorkflow(
        'request-123' as any,
        mockWorkflowId,
        systemMessageData as any,
        'next-node',
        undefined,
        tracker,
      );

      expect(conversationServiceMock.getConversation).toHaveBeenCalledWith(
        mockConversationId,
        mockOrganizationId,
      );
      expect(
        workflowTypeRegistryMock.validateWorkflowName,
      ).toHaveBeenCalledWith(WorkflowName.Adr);
      expect(
        conversationWorkflowServiceMock.startWorkflowForExistingConversation,
      ).toHaveBeenCalledWith(
        mockConversationId,
        WorkflowName.Adr,
        mockOrganizationId,
      );
      expect(restartedWorkflowHandle.signal).toHaveBeenCalledWith(
        WorkflowSignals.getSkipToNodeSignalName(mockRestartedWorkflowId),
        {
          nodeId: 'adr-refinement-welcome',
          systemMessageComplete: true,
        },
      );
    });

    it('returns without throwing when restart context is missing', async () => {
      const missingWorkflowHandle = createNotFoundHandle();

      temporalClientMock.workflow.getHandle = jest
        .fn()
        .mockReturnValue(missingWorkflowHandle);

      const baseContext = TestUtils.createMockFlowContext();
      const tracker = createMutableContextHandle({
        ...baseContext,
        core: {
          ...baseContext.core,
          organizationId: mockOrganizationId,
          conversationId: undefined,
        },
      } as unknown as FlowContext);

      await expect(
        service.sendNodeResponseToWorkflow(
          'request-123' as any,
          mockWorkflowId,
          systemMessageData as any,
          'next-node',
          undefined,
          tracker,
        ),
      ).resolves.toBeUndefined();

      expect(conversationServiceMock.getConversation).not.toHaveBeenCalled();
      expect(
        conversationWorkflowServiceMock.startWorkflowForExistingConversation,
      ).not.toHaveBeenCalled();
    });

    it('returns without throwing when conversation is missing', async () => {
      const missingWorkflowHandle = createNotFoundHandle();

      temporalClientMock.workflow.getHandle = jest
        .fn()
        .mockReturnValue(missingWorkflowHandle);
      conversationServiceMock.getConversation.mockResolvedValue(null);

      const baseContext = TestUtils.createMockFlowContext();
      const tracker = createMutableContextHandle({
        ...baseContext,
        core: {
          ...baseContext.core,
          organizationId: mockOrganizationId,
          conversationId: mockConversationId,
        },
      });

      await expect(
        service.sendNodeResponseToWorkflow(
          'request-123' as any,
          mockWorkflowId,
          systemMessageData as any,
          'next-node',
          undefined,
          tracker,
        ),
      ).resolves.toBeUndefined();

      expect(conversationServiceMock.getConversation).toHaveBeenCalledWith(
        mockConversationId,
        mockOrganizationId,
      );
      expect(
        conversationWorkflowServiceMock.startWorkflowForExistingConversation,
      ).not.toHaveBeenCalled();
    });

    it('returns without throwing when conversation workflowName is missing', async () => {
      const missingWorkflowHandle = createNotFoundHandle();

      temporalClientMock.workflow.getHandle = jest
        .fn()
        .mockReturnValue(missingWorkflowHandle);
      conversationServiceMock.getConversation.mockResolvedValue({
        id: mockConversationId,
        workflowId: mockWorkflowId,
        workflowName: null,
      });

      const baseContext = TestUtils.createMockFlowContext();
      const tracker = createMutableContextHandle({
        ...baseContext,
        core: {
          ...baseContext.core,
          organizationId: mockOrganizationId,
          conversationId: mockConversationId,
        },
      });

      await expect(
        service.sendNodeResponseToWorkflow(
          'request-123' as any,
          mockWorkflowId,
          systemMessageData as any,
          'next-node',
          undefined,
          tracker,
        ),
      ).resolves.toBeUndefined();

      expect(
        conversationWorkflowServiceMock.startWorkflowForExistingConversation,
      ).not.toHaveBeenCalled();
    });
  });

  describe('updateFlowState', () => {
    it('should update flow execution state successfully', async () => {
      const updateData = {
        currentNode: 'gather-feedback',
        completedNodes: 1,
        flowState: mockSerializableState,
        status: FlowExecutionStatus.IN_PROGRESS,
      };

      mockUpdate.mockResolvedValue({
        ...mockFlowExecution,
        ...updateData,
      });

      await service.updateFlowState(
        mockExecutionId,
        mockOrganizationId,
        updateData,
      );

      expect(mockUpdate).toHaveBeenCalledWith({
        where: {
          id: mockExecutionId,
          organizationId: mockOrganizationId,
        },
        data: {
          version: { increment: 1 },
          currentNode: 'gather-feedback',
          completedNodes: 1,
          flowState: mockSerializableState,
          status: FlowExecutionStatus.IN_PROGRESS,
        },
      });
    });

    it('should handle completion status and set completedAt', async () => {
      const updateData = {
        status: FlowExecutionStatus.COMPLETED,
        flowState: mockSerializableState,
      };

      mockUpdate.mockResolvedValue({
        ...mockFlowExecution,
        status: FlowExecutionStatus.COMPLETED,
        completedAt: new Date(),
      });

      await service.updateFlowState(
        mockExecutionId,
        mockOrganizationId,
        updateData,
      );

      expect(mockUpdate).toHaveBeenCalledWith({
        where: {
          id: mockExecutionId,
          organizationId: mockOrganizationId,
        },
        data: {
          version: { increment: 1 },
          status: FlowExecutionStatus.COMPLETED,
          flowState: mockSerializableState,
          completedAt: expect.any(Date),
        },
      });
    });
  });

  describe('findByConversation', () => {
    it('should find flow execution by conversation ID', async () => {
      mockFindFirst.mockResolvedValue(mockFlowExecution);

      const result = await service.findByConversation(
        mockConversationId,
        mockOrganizationId,
      );

      expect(result).toEqual({
        id: mockExecutionId,
        flowId: 'test-flow',
        status: FlowExecutionStatus.STARTED,
        currentNode: 'start',
        flowState: mockSerializableState,
        resumable: true,
        startedAt: mockFlowExecution.startedAt,
        completedAt: null as Date | null,
      });

      expect(mockFindFirst).toHaveBeenCalledWith({
        where: {
          conversationId: mockConversationId,
          organizationId: mockOrganizationId,
        },
        orderBy: {
          startedAt: 'desc',
        },
      });
    });

    it('should return null when no execution found', async () => {
      mockFindFirst.mockResolvedValue(null);

      const result = await service.findByConversation(
        mockConversationId,
        mockOrganizationId,
      );

      expect(result).toBeNull();
    });
  });

  describe('findLatestResumableByEntity', () => {
    it('should find latest resumable execution by entity', async () => {
      mockFindFirst.mockResolvedValue(mockFlowExecution);

      const result = await service.findLatestResumableByEntity(
        'initiative',
        'init-123',
        mockOrganizationId,
      );

      expect(result).toEqual({
        id: mockExecutionId,
        flowId: 'test-flow',
        conversationId: mockConversationId,
        status: FlowExecutionStatus.STARTED,
        currentNode: 'start',
        flowState: mockSerializableState,
        startedAt: mockFlowExecution.startedAt,
      });

      expect(mockFindFirst).toHaveBeenCalledWith({
        where: {
          entityType: 'initiative',
          entityId: 'init-123',
          organizationId: mockOrganizationId,
          resumable: true,
          status: {
            in: [FlowExecutionStatus.STARTED, FlowExecutionStatus.IN_PROGRESS],
          },
        },
        orderBy: {
          startedAt: 'desc',
        },
      });
    });

    it('should return null when no resumable execution found', async () => {
      mockFindFirst.mockResolvedValue(null);

      const result = await service.findLatestResumableByEntity(
        'initiative',
        'init-123',
        mockOrganizationId,
      );

      expect(result).toBeNull();
    });
  });

  describe('markCompleted', () => {
    it('should mark execution as completed', async () => {
      const finalState = { ...mockFlowContext, custom: { completed: true } };

      mockUpdate.mockResolvedValue({
        ...mockFlowExecution,
        status: FlowExecutionStatus.COMPLETED,
        completedAt: new Date(),
        flowState: finalState,
      });

      await service.markCompleted(
        mockExecutionId,
        mockOrganizationId,
        finalState,
      );

      expect(mockUpdate).toHaveBeenCalledWith({
        where: {
          id: mockExecutionId,
          organizationId: mockOrganizationId,
        },
        data: {
          version: { increment: 1 },
          status: FlowExecutionStatus.COMPLETED,
          completedAt: expect.any(Date),
          flowState: finalState,
        },
      });
    });

    it('should mark as completed without final state', async () => {
      mockUpdate.mockResolvedValue({
        ...mockFlowExecution,
        status: FlowExecutionStatus.COMPLETED,
        completedAt: new Date(),
      });

      await service.markCompleted(mockExecutionId, mockOrganizationId);

      expect(mockUpdate).toHaveBeenCalledWith({
        where: {
          id: mockExecutionId,
          organizationId: mockOrganizationId,
        },
        data: {
          version: { increment: 1 },
          status: FlowExecutionStatus.COMPLETED,
          completedAt: expect.any(Date),
        },
      });
    });
  });

  describe('markFailed', () => {
    it('should mark execution as failed', async () => {
      const errorMessage = 'Test error';
      const errorCode = 'TEST_ERROR';

      mockUpdate.mockResolvedValue({
        ...mockFlowExecution,
        status: FlowExecutionStatus.FAILED,
        errorMessage,
        errorCode,
        resumable: false,
      });

      await service.markFailed(
        mockExecutionId,
        mockOrganizationId,
        errorMessage,
        errorCode,
      );

      expect(mockUpdate).toHaveBeenCalledWith({
        where: {
          id: mockExecutionId,
          organizationId: mockOrganizationId,
        },
        data: {
          version: { increment: 1 },
          status: FlowExecutionStatus.FAILED,
          errorMessage,
          errorCode,
          resumable: false,
        },
      });
    });
  });

  describe('resolveConversationPromptType', () => {
    const mockFlowId = 'test-flow-id';
    const mockTerminalPromptType = LocalPromptType.implement;
    const mockAgentPromptType = LocalPromptType.feature_sync_analyze;
    const mockExternalAgentNodeId = 'agent-node-1';
    const mockTriggerMessageId = 'trigger-msg-1' as MessageId;

    const mockFlowTemplate = {
      id: mockFlowId,
      name: 'Test Flow',
      description: 'Test',
      version: 1,
      nodes: {},
      startNode: 'start',
      terminalPromptType: mockTerminalPromptType,
      defaultAdvanceOnUserMessage: false,
    } as unknown as FlowTemplate;

    const mockExternalAgentNode = {
      id: mockExternalAgentNodeId,
      type: NodeType.EXTERNAL_AGENT,
      promptType: mockAgentPromptType,
    };

    beforeEach(() => {
      nodeExecutionServiceMock.getFlow.mockReturnValue(mockFlowTemplate);
      nodeExecutionServiceMock.getNode.mockReturnValue(undefined);
      pendingTriggerServiceMock.resolvePendingTriggerForNode.mockResolvedValue({
        triggerMessageId: null,
      });
    });

    const mockNonAgentNodeId = 'questions-gate';
    const mockNonAgentNode = {
      id: mockNonAgentNodeId,
      type: NodeType.QUESTIONS,
    };

    const workflowGoneError = () =>
      Object.assign(new Error('workflow not found'), {
        name: 'WorkflowNotFoundError',
      });

    it('returns workflowState=terminal with null promptType when conversation has no workflow', async () => {
      const result = await service.resolveConversationPromptType({
        conversationId: mockConversationId,
        workflowId: null,
        workflowName: null,
        organizationId: mockOrganizationId,
      });

      expect(result).toEqual({
        workflowState: WorkflowState.Terminal,
        promptType: null,
        nodeId: null,
        triggerMessageId: null,
      });
      expect(nodeExecutionServiceMock.getFlow).not.toHaveBeenCalled();
    });

    it('returns workflowState=terminal with null promptType when workflowName has no registered flow template', async () => {
      nodeExecutionServiceMock.getFlow.mockReturnValue(undefined);

      const result = await service.resolveConversationPromptType({
        conversationId: mockConversationId,
        workflowId: mockWorkflowId,
        workflowName: WorkflowName.Adr,
        organizationId: mockOrganizationId,
      });

      expect(result).toEqual({
        workflowState: WorkflowState.Terminal,
        promptType: null,
        nodeId: null,
        triggerMessageId: null,
      });
    });

    it('returns workflowState=terminal with terminalPromptType when workflowName is set but workflowId is absent', async () => {
      const result = await service.resolveConversationPromptType({
        conversationId: mockConversationId,
        workflowId: null,
        workflowName: WorkflowName.Adr,
        organizationId: mockOrganizationId,
      });

      expect(result).toEqual({
        workflowState: WorkflowState.Terminal,
        promptType: mockTerminalPromptType,
        nodeId: null,
        triggerMessageId: null,
      });
      expect(nodeExecutionServiceMock.getFlow).toHaveBeenCalledWith(
        WorkflowName.Adr,
      );
    });

    it('returns workflowState=terminal with terminalPromptType when workflow status reports isComplete=true', async () => {
      const queryMock = jest.fn().mockResolvedValue({
        isComplete: true,
        currentNodeId: 'some-node',
        step: 0,
        phase: 'done',
        iterations: 1,
        hasOpener: false,
        lastActivity: new Date().toISOString(),
        pathTaken: [],
      });
      temporalClientMock.workflow.getHandle = jest
        .fn()
        .mockReturnValue({ signal: jest.fn(), query: queryMock });

      const result = await service.resolveConversationPromptType({
        conversationId: mockConversationId,
        workflowId: mockWorkflowId,
        workflowName: WorkflowName.Adr,
        organizationId: mockOrganizationId,
      });

      expect(result).toEqual({
        workflowState: WorkflowState.Terminal,
        promptType: mockTerminalPromptType,
        nodeId: null,
        triggerMessageId: null,
      });
    });

    it('returns workflowState=live-non-agent when workflow is alive on a non-EXTERNAL_AGENT node (e.g. plan-from-design-doc QUESTIONS gate)', async () => {
      const queryMock = jest.fn().mockResolvedValue({
        isComplete: false,
        currentNodeId: mockNonAgentNodeId,
        step: 2,
        phase: 'awaiting-user',
        iterations: 1,
        hasOpener: false,
        lastActivity: new Date().toISOString(),
        pathTaken: ['start', mockNonAgentNodeId],
      });
      temporalClientMock.workflow.getHandle = jest
        .fn()
        .mockReturnValue({ signal: jest.fn(), query: queryMock });
      nodeExecutionServiceMock.getNode.mockReturnValue({
        node: mockNonAgentNode,
        routing: {},
      });

      const result = await service.resolveConversationPromptType({
        conversationId: mockConversationId,
        workflowId: mockWorkflowId,
        workflowName: WorkflowName.Adr,
        organizationId: mockOrganizationId,
      });

      expect(result).toEqual({
        workflowState: WorkflowState.LiveNonAgent,
        promptType: mockTerminalPromptType,
        nodeId: null,
        triggerMessageId: null,
      });
      expect(
        pendingTriggerServiceMock.resolvePendingTriggerForNode,
      ).not.toHaveBeenCalled();
    });

    it('returns workflowState=agent-pending with promptType and triggerMessageId when workflow is on an EXTERNAL_AGENT node', async () => {
      const queryMock = jest.fn().mockResolvedValue({
        isComplete: false,
        currentNodeId: mockExternalAgentNodeId,
        step: 1,
        phase: 'running',
        iterations: 1,
        hasOpener: false,
        lastActivity: new Date().toISOString(),
        pathTaken: ['start', mockExternalAgentNodeId],
      });
      temporalClientMock.workflow.getHandle = jest
        .fn()
        .mockReturnValue({ signal: jest.fn(), query: queryMock });

      nodeExecutionServiceMock.getNode.mockReturnValue({
        node: mockExternalAgentNode,
        routing: {},
      });
      pendingTriggerServiceMock.resolvePendingTriggerForNode.mockResolvedValue({
        triggerMessageId: mockTriggerMessageId,
      });

      const result = await service.resolveConversationPromptType({
        conversationId: mockConversationId,
        workflowId: mockWorkflowId,
        workflowName: WorkflowName.Adr,
        organizationId: mockOrganizationId,
      });

      expect(result).toEqual({
        workflowState: WorkflowState.AgentPending,
        promptType: mockAgentPromptType,
        nodeId: mockExternalAgentNodeId,
        triggerMessageId: mockTriggerMessageId,
      });
      expect(
        pendingTriggerServiceMock.resolvePendingTriggerForNode,
      ).toHaveBeenCalledWith(mockConversationId, mockExternalAgentNodeId);
    });

    it('returns workflowState=agent-pending when workflow is gone but paused execution resolves to an EXTERNAL_AGENT node', async () => {
      const queryMock = jest.fn().mockRejectedValue(workflowGoneError());
      temporalClientMock.workflow.getHandle = jest
        .fn()
        .mockReturnValue({ signal: jest.fn(), query: queryMock });

      mockFindFirst.mockResolvedValue({
        ...mockFlowExecution,
        status: FlowExecutionStatus.PAUSED,
        currentNode: mockExternalAgentNodeId,
        flowState: {
          ...mockFlowExecution.flowState,
          context: { pendingTransition: null },
        },
      });

      nodeExecutionServiceMock.getNode.mockReturnValue({
        node: mockExternalAgentNode,
        routing: {},
      });
      pendingTriggerServiceMock.resolvePendingTriggerForNode.mockResolvedValue({
        triggerMessageId: mockTriggerMessageId,
      });

      const result = await service.resolveConversationPromptType({
        conversationId: mockConversationId,
        workflowId: mockWorkflowId,
        workflowName: WorkflowName.Adr,
        organizationId: mockOrganizationId,
      });

      expect(result).toEqual({
        workflowState: WorkflowState.AgentPending,
        promptType: mockAgentPromptType,
        nodeId: mockExternalAgentNodeId,
        triggerMessageId: mockTriggerMessageId,
      });
      expect(mockFindFirst).toHaveBeenCalled();
      expect(nodeExecutionServiceMock.getNode).toHaveBeenCalledWith(
        mockFlowId,
        mockExternalAgentNodeId,
      );
    });

    it('returns workflowState=live-non-agent when workflow is gone but paused execution resolves to a non-EXTERNAL_AGENT node', async () => {
      const queryMock = jest.fn().mockRejectedValue(workflowGoneError());
      temporalClientMock.workflow.getHandle = jest
        .fn()
        .mockReturnValue({ signal: jest.fn(), query: queryMock });

      mockFindFirst.mockResolvedValue({
        ...mockFlowExecution,
        status: FlowExecutionStatus.PAUSED,
        currentNode: mockNonAgentNodeId,
        flowState: {
          ...mockFlowExecution.flowState,
          context: { pendingTransition: null },
        },
      });

      nodeExecutionServiceMock.getNode.mockReturnValue({
        node: mockNonAgentNode,
        routing: {},
      });

      const result = await service.resolveConversationPromptType({
        conversationId: mockConversationId,
        workflowId: mockWorkflowId,
        workflowName: WorkflowName.Adr,
        organizationId: mockOrganizationId,
      });

      expect(result).toEqual({
        workflowState: WorkflowState.LiveNonAgent,
        promptType: mockTerminalPromptType,
        nodeId: null,
        triggerMessageId: null,
      });
      expect(
        pendingTriggerServiceMock.resolvePendingTriggerForNode,
      ).not.toHaveBeenCalled();
    });

    it('returns workflowState=terminal when workflow is gone and no paused execution exists', async () => {
      const queryMock = jest.fn().mockRejectedValue(workflowGoneError());
      temporalClientMock.workflow.getHandle = jest
        .fn()
        .mockReturnValue({ signal: jest.fn(), query: queryMock });

      mockFindFirst.mockResolvedValue(null);

      const result = await service.resolveConversationPromptType({
        conversationId: mockConversationId,
        workflowId: mockWorkflowId,
        workflowName: WorkflowName.Adr,
        organizationId: mockOrganizationId,
      });

      expect(result).toEqual({
        workflowState: WorkflowState.Terminal,
        promptType: mockTerminalPromptType,
        nodeId: null,
        triggerMessageId: null,
      });
      expect(nodeExecutionServiceMock.getNode).not.toHaveBeenCalled();
    });
  });

  describe('getExecutionStats', () => {
    it('should return execution statistics', async () => {
      mockCount
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(6) // completed
        .mockResolvedValueOnce(2) // failed
        .mockResolvedValueOnce(2) // in progress
        .mockResolvedValueOnce(8) // paused
        .mockResolvedValueOnce(8); // resumable

      const result = await service.getExecutionStats(
        mockOrganizationId,
        'test-flow',
        'initiative',
      );

      expect(result).toEqual({
        total: 10,
        completed: 6,
        failed: 2,
        inProgress: 2,
        paused: 8,
        resumable: 8,
      });

      // Verify all count calls were made with correct parameters
      expect(mockCount).toHaveBeenCalledTimes(6);
    });

    it('should handle stats without filters', async () => {
      mockCount
        .mockResolvedValueOnce(5) // total
        .mockResolvedValueOnce(3) // completed
        .mockResolvedValueOnce(1) // failed
        .mockResolvedValueOnce(1) // in progress
        .mockResolvedValueOnce(4) // paused
        .mockResolvedValueOnce(4); // resumable

      const result = await service.getExecutionStats(mockOrganizationId);

      expect(result).toEqual({
        total: 5,
        completed: 3,
        failed: 1,
        inProgress: 1,
        paused: 4,
        resumable: 4,
      });
    });
  });
});
