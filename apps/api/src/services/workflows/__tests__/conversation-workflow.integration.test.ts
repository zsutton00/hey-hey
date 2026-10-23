/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { ConversationWorkflowService } from '../conversation-workflow.service';
import { WorkflowTypeRegistryService } from '../workflow-type-registry.service';
import { WorkflowRouterService } from '../workflow-router.service';
import { ConversationService } from '../../conversation.service';
import { FlowExecutionService } from '../flow-execution.service';
import { NodeExecutionService } from '../node-execution.service';
import { MessageService } from '../../message.service';
import {
  ConversationStatus,
  CreateConversationDto,
  InitiationType,
  WorkflowName,
} from '../../../generated';
import * as TestUtils from '../../../utils/testUtils';
import { NodeType } from '../../../types/flow-internal.types';
import { ConversationWorkflowError } from '../../../core/exceptions/workflow.exceptions';
import { ConversationId } from '../../../types';

describe('ConversationWorkflowService Integration', () => {
  let conversationWorkflowService: ConversationWorkflowService;
  let workflowTypeRegistry: WorkflowTypeRegistryService;
  let workflowRouterService: WorkflowRouterService;
  let conversationService: ConversationService;
  let flowExecutionService: FlowExecutionService;
  let nodeExecutionService: NodeExecutionService;
  let messageService: MessageService;

  beforeEach(async () => {
    const mockConversationService = TestUtils.createMockConversationService();
    const mockWorkflowTypeRegistry =
      TestUtils.createMockWorkflowTypeRegistryService();
    const mockFlowExecutionService = TestUtils.createMockFlowExecutionService();
    const mockNodeExecutionService = TestUtils.createMockFlowEngineService();
    const mockMessageService = TestUtils.createMockMessageService();
    const mockWorkflowRouterService = {
      routeUserMessage: jest.fn(),
      sendUserMessage: jest.fn(),
      restartWorkflow: jest.fn(),
      sendSkipToNode: jest.fn(),
      isWorkflowRunning: jest.fn(),
      getWorkflowInfo: jest.fn(),
      sendStructuredMessage: jest.fn(),
      registerWorkflowType: jest.fn(),
    } as jest.Mocked<
      Pick<
        WorkflowRouterService,
        | 'routeUserMessage'
        | 'sendUserMessage'
        | 'restartWorkflow'
        | 'sendSkipToNode'
        | 'isWorkflowRunning'
        | 'getWorkflowInfo'
        | 'sendStructuredMessage'
        | 'registerWorkflowType'
      >
    >;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationWorkflowService,
        {
          provide: ConversationService,
          useValue: mockConversationService,
        },
        {
          provide: WorkflowTypeRegistryService,
          useValue: mockWorkflowTypeRegistry,
        },
        {
          provide: WorkflowRouterService,
          useValue: mockWorkflowRouterService,
        },
        {
          provide: FlowExecutionService,
          useValue: mockFlowExecutionService,
        },
        {
          provide: NodeExecutionService,
          useValue: mockNodeExecutionService,
        },
        {
          provide: MessageService,
          useValue: mockMessageService,
        },
        {
          provide: 'APP_CONTEXT',
          useValue: {},
        },
      ],
    }).compile();

    conversationWorkflowService = module.get<ConversationWorkflowService>(
      ConversationWorkflowService,
    );
    workflowTypeRegistry = module.get<WorkflowTypeRegistryService>(
      WorkflowTypeRegistryService,
    );
    workflowRouterService = module.get<WorkflowRouterService>(
      WorkflowRouterService,
    );
    conversationService = module.get<ConversationService>(ConversationService);
    flowExecutionService =
      module.get<FlowExecutionService>(FlowExecutionService);
    nodeExecutionService =
      module.get<NodeExecutionService>(NodeExecutionService);
    messageService = module.get<MessageService>(MessageService);

    (nodeExecutionService.getFlow as jest.Mock).mockReturnValue({
      id: WorkflowName.TaskGeneration,
      startNode: 'start-node',
      nodes: {},
    });
    (nodeExecutionService.getNode as jest.Mock).mockReturnValue({
      node: { id: 'start-node', type: NodeType.QUESTIONS },
      routing: {},
    });
  });

  describe('createConversation', () => {
    const agentSessionId = 'agent-session-123';

    it('should create conversation and start workflow when workflowType is provided', async () => {
      // Arrange
      const createDto: CreateConversationDto = {
        projectId: TestUtils.testIds.project,
        organizationId: TestUtils.testIds.organization,
        workflowAboutType: 'initiative',
        workflowAboutId: TestUtils.testIds.initiative,
        initiatedBy: InitiationType.User,
        workflowName: 'task-generation',
        workflowId: TestUtils.testIds.workflow,
        context: {
          aboutId: TestUtils.testIds.initiative,
          aboutType: 'initiative',
        },
      };
      const mockConversation = TestUtils.createMockConversation({
        workflowAboutType: 'initiative',
        workflowAboutId: TestUtils.testIds.initiative,
        workflowName: WorkflowName.TaskGeneration,
        workflowId: TestUtils.testIds.workflow,
      });
      const organizationId = TestUtils.testIds.organization;

      (conversationService.createConversation as jest.Mock).mockResolvedValue(
        mockConversation,
      );
      (conversationService.findOne as jest.Mock).mockResolvedValue(
        mockConversation,
      );
      (workflowTypeRegistry.validateWorkflowName as jest.Mock).mockReturnValue(
        WorkflowName.TaskGeneration,
      );
      (workflowTypeRegistry.startWorkflowByType as jest.Mock).mockResolvedValue(
        {
          workflowId: TestUtils.testIds.workflow,
          conversationId: mockConversation.id,
          success: true,
        },
      );
      (
        conversationService.updateConversationWorkflowId as jest.Mock
      ).mockResolvedValue({
        ...mockConversation,
        workflowId: TestUtils.testIds.workflow,
      });

      // Act
      const result = await conversationWorkflowService.createConversation(
        createDto,
        organizationId,
      );

      // Assert
      expect(result.conversation).toBeDefined();
      expect(result.workflowStarted).toBe(true);
      expect(result.workflowId).toBe(TestUtils.testIds.workflow);

      expect(conversationService.createConversation).toHaveBeenCalledWith(
        createDto,
        organizationId,
        { createdBy: undefined },
      );
      expect(workflowTypeRegistry.validateWorkflowName).toHaveBeenCalledWith(
        WorkflowName.TaskGeneration,
      );
      expect(workflowTypeRegistry.startWorkflowByType).toHaveBeenCalledWith(
        WorkflowName.TaskGeneration,
        mockConversation.id,
        mockConversation.projectId,
        organizationId,
        undefined, // userId
        mockConversation.title, // conversation title
        mockConversation.workflowAboutType,
        mockConversation.workflowAboutId,
        createDto.workflowId,
        createDto.context,
      );
      expect(
        conversationService.updateConversationWorkflowId,
      ).toHaveBeenCalledWith(
        mockConversation.id,
        TestUtils.testIds.workflow,
        organizationId,
      );
    });

    it('should create conversation without workflow when workflowType is not provided', async () => {
      // Arrange
      const createDto = {
        projectId: TestUtils.testIds.project,
        organizationId: TestUtils.testIds.organization,
        workflowAboutType: 'initiative',
        workflowAboutId: TestUtils.testIds.initiative,
        initiatedBy: InitiationType.User,
      } as unknown as CreateConversationDto;
      const mockConversation = TestUtils.createMockConversation({
        workflowAboutType: 'initiative',
        workflowAboutId: TestUtils.testIds.initiative,
      });
      const organizationId = TestUtils.testIds.organization;

      (conversationService.createConversation as jest.Mock).mockResolvedValue(
        mockConversation,
      );

      // Act
      const result = await conversationWorkflowService.createConversation(
        createDto,
        organizationId,
      );

      // Assert
      expect(result.conversation).toBeDefined();
      expect(result.workflowStarted).toBe(false);
      expect(result.workflowId).toBeUndefined();

      expect(conversationService.createConversation).toHaveBeenCalledWith(
        createDto,
        organizationId,
        { createdBy: undefined },
      );
      expect(workflowTypeRegistry.validateWorkflowName).not.toHaveBeenCalled();
      expect(workflowTypeRegistry.startWorkflowByType).not.toHaveBeenCalled();
    });

    it('should pre-execute opener with system user for workflow conversations', async () => {
      const createDto: CreateConversationDto = {
        projectId: TestUtils.testIds.project,
        organizationId: TestUtils.testIds.organization,
        workflowAboutType: 'project',
        workflowAboutId: TestUtils.testIds.project,
        initiatedBy: InitiationType.User,
        workflowName: 'project-conversation',
        workflowId: TestUtils.testIds.workflow,
        context: {},
      };
      const mockConversation = TestUtils.createMockConversation({
        workflowAboutType: 'project',
        workflowAboutId: TestUtils.testIds.project,
        workflowName: WorkflowName.ProjectConversation,
        workflowId: TestUtils.testIds.workflow,
      });
      const organizationId = TestUtils.testIds.organization;

      (conversationService.createConversation as jest.Mock).mockResolvedValue(
        mockConversation,
      );
      (conversationService.findOne as jest.Mock).mockResolvedValue(
        mockConversation,
      );
      (workflowTypeRegistry.validateWorkflowName as jest.Mock).mockReturnValue(
        WorkflowName.ProjectConversation,
      );
      (workflowTypeRegistry.startWorkflowByType as jest.Mock).mockResolvedValue(
        {
          workflowId: TestUtils.testIds.workflow,
          conversationId: mockConversation.id,
          success: true,
        },
      );
      (
        conversationService.updateConversationWorkflowId as jest.Mock
      ).mockResolvedValue({
        ...mockConversation,
        workflowId: TestUtils.testIds.workflow,
      });

      (nodeExecutionService.getFlow as jest.Mock).mockReturnValue({
        id: WorkflowName.ProjectConversation,
        startNode: 'project-conversation-welcome',
        nodes: {
          'project-conversation-welcome': { nextNode: 'next-node' },
        },
      });
      (nodeExecutionService.getNode as jest.Mock).mockReturnValue({
        node: { id: 'project-conversation-welcome', type: NodeType.OPENER },
        routing: { nextNode: 'next-node' },
      });
      (nodeExecutionService.executeNode as jest.Mock).mockResolvedValue({
        result: {
          type: NodeType.QUESTIONS,
          message: 'Welcome',
          uiElements: [{ type: 'textarea', id: 'prompt' }],
        },
        nextNodeId: 'next-node',
      });
      (messageService.addMessage as jest.Mock).mockResolvedValue({
        id: TestUtils.testIds.message,
      });
      (flowExecutionService.createFlowExecution as jest.Mock).mockResolvedValue(
        {
          id: TestUtils.testIds.flowExecution,
        },
      );

      await conversationWorkflowService.createConversation(
        createDto,
        organizationId,
      );

      expect(flowExecutionService.createFlowExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'system',
        }),
      );
    });

    it('should create agent-session conversations without starting Temporal workflows', async () => {
      const createDto = {
        projectId: TestUtils.testIds.project,
        organizationId: TestUtils.testIds.organization,
        workflowAboutType: 'agent-session',
        workflowAboutId: agentSessionId,
        initiatedBy: InitiationType.User,
        workflowName: 'agent-session',
        workflowId: TestUtils.testIds.workflow,
        context: {},
      };
      const mockConversation = TestUtils.createMockConversation({
        workflowName: WorkflowName.AgentSession,
        workflowAboutType: 'agent-session',
        workflowAboutId: agentSessionId,
        workflowId: TestUtils.testIds.workflow,
      });

      (conversationService.createConversation as jest.Mock).mockResolvedValue(
        mockConversation,
      );
      (workflowTypeRegistry.validateWorkflowName as jest.Mock).mockReturnValue(
        WorkflowName.AgentSession,
      );
      (
        workflowTypeRegistry.isNonTemporalBackedWorkflow as jest.Mock
      ).mockReturnValue(true);

      const result = await conversationWorkflowService.createConversation(
        createDto as unknown as CreateConversationDto,
        TestUtils.testIds.organization,
      );

      expect(result.workflowStarted).toBe(false);
      expect(result.workflowId).toBe(TestUtils.testIds.workflow);
      expect(workflowTypeRegistry.startWorkflowByType).not.toHaveBeenCalled();
      expect(
        conversationService.updateConversationWorkflowId,
      ).not.toHaveBeenCalled();
      expect(nodeExecutionService.executeNode).not.toHaveBeenCalled();
    });

    it('should fail fast when agent-session workflowAboutId is missing', async () => {
      const createDto = {
        projectId: TestUtils.testIds.project,
        organizationId: TestUtils.testIds.organization,
        workflowAboutType: 'agent-session',
        initiatedBy: InitiationType.User,
        workflowName: 'agent-session',
        workflowId: TestUtils.testIds.workflow,
        context: {},
      } as unknown as CreateConversationDto;

      (workflowTypeRegistry.validateWorkflowName as jest.Mock).mockReturnValue(
        WorkflowName.AgentSession,
      );

      await expect(
        conversationWorkflowService.createConversation(
          createDto,
          TestUtils.testIds.organization,
        ),
      ).rejects.toThrow(ConversationWorkflowError);
      expect(conversationService.createConversation).not.toHaveBeenCalled();
    });

    it('should defer autostart for plan-from-design-doc and persist NOT_STARTED', async () => {
      const planId = 'plan-789';
      const createDto = {
        projectId: TestUtils.testIds.project,
        organizationId: TestUtils.testIds.organization,
        workflowAboutType: 'plan',
        workflowAboutId: planId,
        initiatedBy: InitiationType.System,
        workflowName: 'plan-from-design-doc',
        workflowId: TestUtils.testIds.workflow,
        context: { designDocId: 'doc-1' },
      } as unknown as CreateConversationDto;
      const mockConversation = TestUtils.createMockConversation({
        workflowName: WorkflowName.PlanFromDesignDoc,
        workflowAboutType: 'plan',
        workflowAboutId: planId,
        workflowId: TestUtils.testIds.workflow,
        status: ConversationStatus.NotStarted,
      });

      (workflowTypeRegistry.validateWorkflowName as jest.Mock).mockReturnValue(
        WorkflowName.PlanFromDesignDoc,
      );
      (
        workflowTypeRegistry.shouldDeferAutostart as jest.Mock
      ).mockImplementation(
        (name?: string | null) => name === WorkflowName.PlanFromDesignDoc,
      );
      (conversationService.createConversation as jest.Mock).mockResolvedValue(
        mockConversation,
      );

      const result = await conversationWorkflowService.createConversation(
        createDto,
        TestUtils.testIds.organization,
      );

      expect(result.workflowStarted).toBe(false);
      expect(result.workflowId).toBe(TestUtils.testIds.workflow);
      expect(result.conversation.status).toBe(ConversationStatus.NotStarted);

      // Conversation is inserted with status NOT_STARTED so the row is born
      // parked, not auto-flipped to InProgress by the opener pre-execution.
      const createCallArgs = (
        conversationService.createConversation as jest.Mock
      ).mock.calls[0];
      expect(createCallArgs[0]).toEqual(
        expect.objectContaining({
          workflowName: 'plan-from-design-doc',
          status: ConversationStatus.NotStarted,
        }),
      );

      // The deferred branch must NOT run any of the startup-sequence
      // side effects: no Temporal start, no opener execution, no SYSTEM
      // seed message persisted, no workflowId write-back.
      expect(workflowTypeRegistry.startWorkflowByType).not.toHaveBeenCalled();
      expect(nodeExecutionService.executeNode).not.toHaveBeenCalled();
      expect(messageService.addMessage).not.toHaveBeenCalled();
      expect(
        conversationService.updateConversationWorkflowId,
      ).not.toHaveBeenCalled();
    });

    it('should fail fast when agent-session workflowAboutType is invalid', async () => {
      const createDto = {
        projectId: TestUtils.testIds.project,
        organizationId: TestUtils.testIds.organization,
        workflowAboutType: 'initiative',
        workflowAboutId: agentSessionId,
        initiatedBy: InitiationType.User,
        workflowName: 'agent-session',
        workflowId: TestUtils.testIds.workflow,
        context: {},
      } as unknown as CreateConversationDto;

      (workflowTypeRegistry.validateWorkflowName as jest.Mock).mockReturnValue(
        WorkflowName.AgentSession,
      );

      await expect(
        conversationWorkflowService.createConversation(
          createDto,
          TestUtils.testIds.organization,
        ),
      ).rejects.toThrow(ConversationWorkflowError);
      expect(conversationService.createConversation).not.toHaveBeenCalled();
    });
  });

  describe('startConversationWorkflow', () => {
    it('should run the full startup sequence for a deferred plan-from-design-doc conversation', async () => {
      const planId = 'plan-789';
      const conversationId = TestUtils.testIds.conversation as ConversationId;
      const parkedConversation = TestUtils.createMockConversation({
        id: conversationId,
        workflowName: WorkflowName.PlanFromDesignDoc,
        workflowAboutType: 'plan',
        workflowAboutId: planId,
        workflowId: TestUtils.testIds.workflow,
        status: ConversationStatus.NotStarted,
      });
      const startedConversation = {
        ...parkedConversation,
        workflowId: TestUtils.testIds.workflow,
      };

      (conversationService.findOne as jest.Mock).mockResolvedValue(
        parkedConversation,
      );
      (workflowTypeRegistry.validateWorkflowName as jest.Mock).mockReturnValue(
        WorkflowName.PlanFromDesignDoc,
      );
      (
        workflowTypeRegistry.isNonTemporalBackedWorkflow as jest.Mock
      ).mockReturnValue(false);

      (nodeExecutionService.getFlow as jest.Mock).mockReturnValue({
        id: WorkflowName.PlanFromDesignDoc,
        startNode: 'plan-from-design-doc-opener',
        nodes: { 'plan-from-design-doc-opener': { nextNode: 'next-node' } },
      });
      (nodeExecutionService.getNode as jest.Mock).mockReturnValue({
        node: { id: 'plan-from-design-doc-opener', type: NodeType.OPENER },
        routing: { nextNode: 'next-node' },
      });
      (nodeExecutionService.executeNode as jest.Mock).mockResolvedValue({
        result: {
          type: NodeType.QUESTIONS,
          message: 'Welcome',
          uiElements: [{ type: 'textarea', id: 'prompt' }],
        },
        nextNodeId: 'next-node',
      });
      (messageService.addMessage as jest.Mock).mockResolvedValue({
        id: TestUtils.testIds.message,
      });
      (flowExecutionService.createFlowExecution as jest.Mock).mockResolvedValue(
        { id: TestUtils.testIds.flowExecution },
      );
      (workflowTypeRegistry.startWorkflowByType as jest.Mock).mockResolvedValue(
        {
          workflowId: TestUtils.testIds.workflow,
          conversationId,
          success: true,
        },
      );
      (
        conversationService.updateConversationWorkflowId as jest.Mock
      ).mockResolvedValue(startedConversation);

      const result =
        await conversationWorkflowService.startConversationWorkflow(
          conversationId,
          TestUtils.testIds.organization,
        );

      expect(result.workflowStarted).toBe(true);
      expect(result.workflowId).toBe(TestUtils.testIds.workflow);
      expect(conversationService.findOne).toHaveBeenCalledWith(
        conversationId,
        TestUtils.testIds.organization,
      );
      // Opener pre-execution ran: SYSTEM seed posted and status flipped to InProgress.
      expect(messageService.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SYSTEM' }),
        TestUtils.testIds.organization,
        'preExecuteOpener',
      );
      expect(
        conversationService.updateConversationInternal,
      ).toHaveBeenCalledWith(
        conversationId,
        TestUtils.testIds.organization,
        expect.objectContaining({ status: ConversationStatus.InProgress }),
        expect.anything(),
      );
      expect(workflowTypeRegistry.startWorkflowByType).toHaveBeenCalledWith(
        WorkflowName.PlanFromDesignDoc,
        conversationId,
        parkedConversation.projectId,
        TestUtils.testIds.organization,
        undefined,
        parkedConversation.title,
        'plan',
        planId,
        TestUtils.testIds.workflow,
        undefined,
      );
      expect(
        conversationService.updateConversationWorkflowId,
      ).toHaveBeenCalledWith(
        conversationId,
        TestUtils.testIds.workflow,
        TestUtils.testIds.organization,
      );
    });

    it('should throw when the conversation cannot be found', async () => {
      (conversationService.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        conversationWorkflowService.startConversationWorkflow(
          'missing-conv' as ConversationId,
          TestUtils.testIds.organization,
        ),
      ).rejects.toThrow(ConversationWorkflowError);
      expect(workflowTypeRegistry.startWorkflowByType).not.toHaveBeenCalled();
    });

    it('should no-op when another caller already claimed the conversation', async () => {
      // Simulates two near-simultaneous /start callers: this one loses the
      // atomic NOT_STARTED -> IN_PROGRESS claim. It must NOT call Temporal
      // (which would throw "Workflow execution already started") and must
      // return workflowStarted: false so the controller responds idempotently.
      const planId = 'plan-race';
      const conversationId = TestUtils.testIds.conversation as ConversationId;
      const parkedConversation = TestUtils.createMockConversation({
        id: conversationId,
        workflowName: WorkflowName.PlanFromDesignDoc,
        workflowAboutType: 'plan',
        workflowAboutId: planId,
        workflowId: TestUtils.testIds.workflow,
        status: ConversationStatus.NotStarted,
      });
      const inProgressConversation = {
        ...parkedConversation,
        status: ConversationStatus.InProgress,
      };

      (conversationService.findOne as jest.Mock).mockResolvedValue(
        parkedConversation,
      );
      (workflowTypeRegistry.validateWorkflowName as jest.Mock).mockReturnValue(
        WorkflowName.PlanFromDesignDoc,
      );
      (
        workflowTypeRegistry.isNonTemporalBackedWorkflow as jest.Mock
      ).mockReturnValue(false);
      (
        conversationService.claimConversationForStart as jest.Mock
      ).mockResolvedValue({
        claimed: false,
        conversation: inProgressConversation,
      });

      const result =
        await conversationWorkflowService.startConversationWorkflow(
          conversationId,
          TestUtils.testIds.organization,
        );

      expect(result.workflowStarted).toBe(false);
      expect(result.conversation.status).toBe(ConversationStatus.InProgress);
      expect(result.workflowId).toBe(TestUtils.testIds.workflow);
      expect(workflowTypeRegistry.startWorkflowByType).not.toHaveBeenCalled();
      expect(messageService.addMessage).not.toHaveBeenCalled();
      expect(
        conversationService.updateConversationWorkflowId,
      ).not.toHaveBeenCalled();
    });
  });
});
