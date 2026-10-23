import { OrganizationGuard } from '../../auth/guards/organization.guard';
import { ProjectAccessGuard } from '../../auth/guards/project-access.guard';
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConversationController } from '../conversation.controller';
import { AgentSessionService } from '../../services/agent-session.service';
import { EvalRunService } from '../../services/eval-runs/eval-run.service';
import { ProjectReportLaunchService } from '../../services/project-reports/project-report-launch.service';
import { ConversationService } from '../../services/conversation.service';
import { MessageService } from '../../services/message.service';
import { ConversationWorkflowService } from '../../services/workflows/conversation-workflow.service';
import { WorkflowExecutionService } from '../../services/workflows/workflow-execution.service';
import { NodeExecutionService } from '../../services/workflows/node-execution.service';
import { WorkflowRouterService } from '../../services/workflows/workflow-router.service';
import { FlowExecutionService } from '../../services/workflows/flow-execution.service';
import { WebsocketConnectionManager } from '../../core/websockets/websocket-connection-manager.service';
import { TriggerEmitter } from '../../core/websockets/trigger-emitter.service';
import { PendingTriggerService } from '../../services/workflows/pending-trigger.service';
import { MachineExecutionReadinessService } from '../../services/machine-pairing/machine-execution-readiness.service';
import { ExecutionGrantService } from '../../services/controller-authorization/execution-grant.service';
import { AgentOperationRegistryService } from '../../services/agent-operation/agent-operation-registry.service';
import { AgentOperationSubmissionService } from '../../services/agent-operation/agent-operation-submission.service';
import { AgentSessionId, MachineId, MessageId, UserId } from '../../types';
import { createHash } from 'node:crypto';
import { canonicalizeJcs } from '../../core/websockets/trigger-canonicalization';
import {
  AgentOperationKind,
  AgentTriggerStartRun,
  ConversationStartRunRequestDto,
  ConversationStatus,
  HostActionCategory,
  HostAffectingActionType,
  InitiationType,
  MessageStatus,
  MessageType,
  RunCreatePayloadWorkflowKickoff,
  RunEntityReference,
  SystemMessageData,
  UserMessageData,
  WorkflowName,
} from '../../generated';
import { FlowExecutionStatus } from '@prisma/client';
import { flowContextToSerializableState } from '../../workflows/conversation-workflow-state';
import * as TestUtils from '../../utils/testUtils';
const { testIds } = TestUtils;
const statusMachineId = '11111111-1111-4111-8111-111111111111' as MachineId;

describe('ConversationController', () => {
  let controller: ConversationController;
  let conversationService: ConversationService;
  let messageService: jest.Mocked<MessageService>;
  let conversationWorkflowService: ConversationWorkflowService;
  let workflowExecutionService: WorkflowExecutionService;
  let flowEngineService: NodeExecutionService;
  let workflowRouterService: WorkflowRouterService;
  let flowExecutionService: FlowExecutionService;
  let connectionManager: jest.Mocked<WebsocketConnectionManager>;
  let machineExecutionReadinessService: jest.Mocked<
    Pick<MachineExecutionReadinessService, 'resolve'>
  >;
  let triggerEmitter: jest.Mocked<
    Pick<
      TriggerEmitter,
      'emitConversationTriggerWithAck' | 'emitConversationTriggerForMessage'
    >
  >;
  let executionGrantService: jest.Mocked<
    Pick<
      ExecutionGrantService,
      'assertInteractiveAuthorized' | 'deriveInteractiveGrant'
    >
  >;
  let agentSessionService: jest.Mocked<
    Pick<
      AgentSessionService,
      | 'resolveStartRunConfiguration'
      | 'resolveStartRunConversationBinding'
      | 'claimStartRunLaunch'
      | 'releaseStartRunLaunchClaim'
      | 'bindStartRunMachine'
    >
  >;
  let agentOperationRegistry: jest.Mocked<
    Pick<AgentOperationRegistryService, 'markReconciling'>
  >;
  let agentOperationSubmission: jest.Mocked<
    Pick<AgentOperationSubmissionService, 'submitPrepared'>
  >;

  const mockConversation = TestUtils.createMockConversation({
    title: 'Test Conversation',
    status: ConversationStatus.Started,
    workflowName: 'onboarding',
    initiatedBy: InitiationType.User,
    triggerEvent: 'test_event',
  });

  const mockPaginatedResponse = {
    data: [mockConversation],
    pagination: {
      page: 1,
      limit: 10,
      total: 1,
      pages: 1,
    },
  };

  beforeEach(async () => {
    // INTENT: Set up clean test environment for each test
    // This ensures no state pollution between controller tests
    const mockConversationService = TestUtils.createMockConversationService();
    const mockMessageService = TestUtils.createMockMessageService();
    const mockConversationWorkflowService =
      TestUtils.createMockConversationWorkflowService();
    const mockWorkflowExecutionService =
      TestUtils.createMockWorkflowExecutionService();
    const mockFlowEngineService = TestUtils.createMockFlowEngineService();
    const mockWorkflowRouterService =
      TestUtils.createMockWorkflowRouterService();
    const mockFlowExecutionService = TestUtils.createMockFlowExecutionService();
    const mockConnectionManager = {
      hasCliConnectionForUser: jest.fn().mockReturnValue(false),
    } as unknown as jest.Mocked<WebsocketConnectionManager>;
    const mockMachineExecutionReadinessService = {
      resolve: jest.fn().mockResolvedValue({
        machineId: statusMachineId,
        authorizationProtocolVersion: 2,
        executionReadiness: 'READY',
      }),
    };

    const mockTriggerEmitter = {
      emitConversationTriggerWithAck: jest
        .fn()
        .mockResolvedValue({ acknowledged: true, machineId: 'machine-1' }),
      emitConversationTriggerForMessage: jest.fn().mockResolvedValue(undefined),
    };
    const mockPendingTriggerService = {
      resolveLatestOpenTriggerForConversation: jest.fn(),
    };

    const mockAgentSessionService = {
      resolveStartRunConversationBinding: jest
        .fn()
        .mockResolvedValue({ kind: 'STANDARD_LAUNCH' }),
      resolveStartRunConfiguration: jest.fn().mockResolvedValue(undefined),
      claimStartRunLaunch: jest.fn().mockResolvedValue(true),
      releaseStartRunLaunchClaim: jest.fn().mockResolvedValue(undefined),
      bindStartRunMachine: jest.fn().mockResolvedValue(undefined),
    };
    const mockExecutionGrantService = {
      assertInteractiveAuthorized: jest.fn().mockImplementation((params) => ({
        authorizationId: '99999999-9999-4999-8999-999999999999',
        requestId: '88888888-8888-4888-8888-888888888888',
        machineId: params.machineId ?? statusMachineId,
        agentSessionId: '77777777-7777-4777-8777-777777777777',
        action: {},
        envelopeAuthorization: {
          kind: 'bounded_grant',
          grantId: '99999999-9999-4999-8999-999999999999',
        },
      })),
      deriveInteractiveGrant: jest.fn().mockResolvedValue({ id: 'grant-id' }),
    };
    const mockAgentOperationRegistry = {
      begin: jest.fn().mockResolvedValue({
        disposition: 'EXECUTE',
        operation: {
          result: {
            reservedMessageId: '55555555-5555-4555-8555-555555555556',
            reservedTriggerMessageId: '55555555-5555-4555-8555-555555555557',
          },
        },
        executionOwner: '55555555-5555-4555-8555-555555555558',
      }),
      reservedMessageIds: jest.fn().mockReturnValue({
        messageId: '55555555-5555-4555-8555-555555555556',
        triggerMessageId: '55555555-5555-4555-8555-555555555557' as MessageId,
      }),
      recordAuthorization: jest.fn(),
      markReconciling: jest.fn(),
      succeed: jest.fn(),
      fail: jest.fn(),
    };
    const mockAgentOperationSubmission = {
      submitPrepared: jest.fn().mockResolvedValue({
        operationId: '55555555-5555-4555-8555-555555555555',
        fingerprint: 'f'.repeat(64),
        state: 'DISPATCH_PENDING',
        triggerMessageId: '55555555-5555-4555-8555-555555555557',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConversationController],
      providers: [
        {
          provide: ConversationService,
          useValue: mockConversationService,
        },
        {
          provide: MessageService,
          useValue: mockMessageService,
        },
        {
          provide: ConversationWorkflowService,
          useValue: mockConversationWorkflowService,
        },
        {
          provide: WorkflowExecutionService,
          useValue: mockWorkflowExecutionService,
        },
        {
          provide: NodeExecutionService,
          useValue: mockFlowEngineService,
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
          provide: WebsocketConnectionManager,
          useValue: mockConnectionManager,
        },
        {
          provide: MachineExecutionReadinessService,
          useValue: mockMachineExecutionReadinessService,
        },
        {
          provide: TriggerEmitter,
          useValue: mockTriggerEmitter,
        },
        {
          provide: PendingTriggerService,
          useValue: mockPendingTriggerService,
        },
        {
          provide: AgentSessionService,
          useValue: mockAgentSessionService,
        },
        {
          provide: ProjectReportLaunchService,
          useValue: { assertStartRun: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: EvalRunService,
          useValue: { assertStartRun: jest.fn().mockResolvedValue(false) },
        },
        {
          provide: ExecutionGrantService,
          useValue: mockExecutionGrantService,
        },
        {
          provide: AgentOperationRegistryService,
          useValue: mockAgentOperationRegistry,
        },
        {
          provide: AgentOperationSubmissionService,
          useValue: mockAgentOperationSubmission,
        },
      ],
    })
      .overrideGuard(OrganizationGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ProjectAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ConversationController>(ConversationController);
    conversationService = module.get<ConversationService>(ConversationService);
    messageService = module.get<jest.Mocked<MessageService>>(MessageService);
    conversationWorkflowService = module.get<ConversationWorkflowService>(
      ConversationWorkflowService,
    );
    workflowExecutionService = module.get<WorkflowExecutionService>(
      WorkflowExecutionService,
    );
    flowEngineService = module.get<NodeExecutionService>(NodeExecutionService);
    workflowRouterService = module.get<WorkflowRouterService>(
      WorkflowRouterService,
    );
    flowExecutionService =
      module.get<FlowExecutionService>(FlowExecutionService);
    connectionManager = module.get<jest.Mocked<WebsocketConnectionManager>>(
      WebsocketConnectionManager,
    );
    machineExecutionReadinessService = module.get(
      MachineExecutionReadinessService,
    );
    triggerEmitter = module.get(TriggerEmitter);
    agentSessionService = module.get(AgentSessionService);
    executionGrantService = module.get(ExecutionGrantService);
    agentOperationRegistry = module.get(AgentOperationRegistryService);
    agentOperationSubmission = module.get(AgentOperationSubmissionService);
  });

  describe('createConversation endpoint', () => {
    it('should create a new conversation with valid data', async () => {
      // INTENT: Test conversation creation with proper authorization
      // This ensures users can create conversations within their projects
      const createConversationDto = {
        projectId: testIds.project,
        organizationId: testIds.organization,
        workflowId: testIds.workflow,
        interactionTypeId: 'interaction-123' as any,
        initiatedBy: InitiationType.User,
        title: 'New Conversation',
        workflowName: 'onboarding' as const,
        context: {},
      };

      jest
        .spyOn(conversationWorkflowService, 'createConversation')
        .mockResolvedValue({
          conversation: mockConversation,
          workflowStarted: true,
          workflowId: testIds.workflow,
        });

      const result = await controller.createConversation(
        testIds.project,
        testIds.organization,
        createConversationDto,
      );

      // INTENT: Verify service was called with correct parameters including auth context
      expect(
        conversationWorkflowService.createConversation,
      ).toHaveBeenCalledWith(createConversationDto, testIds.organization);

      // INTENT: Verify the response contains the created conversation data
      expect(result).toEqual(mockConversation);
    });

    it('passes the authenticated user into workflow creation', async () => {
      const createConversationDto = {
        projectId: testIds.project,
        organizationId: testIds.organization,
        workflowId: testIds.workflow,
        interactionTypeId: 'interaction-123' as any,
        initiatedBy: InitiationType.User,
        title: 'New Conversation',
        workflowName: 'onboarding' as const,
        context: {},
      };
      const callerUserId = '22222222-2222-4222-8222-222222222222' as UserId;

      jest
        .spyOn(conversationWorkflowService, 'createConversation')
        .mockResolvedValue({
          conversation: mockConversation,
          workflowStarted: true,
          workflowId: testIds.workflow,
        });

      await controller.createConversation(
        testIds.project,
        testIds.organization,
        createConversationDto,
        undefined,
        callerUserId,
      );

      expect(
        conversationWorkflowService.createConversation,
      ).toHaveBeenCalledWith(createConversationDto, testIds.organization, {
        userId: callerUserId,
      });
    });

    it('places an explicitly configured mock session in onboarding context', async () => {
      const originalEnvironment = { ...process.env };
      process.env.NODE_ENV = 'test';
      process.env.MOCK_LLM_SESSION_ROUTING_ENABLED = 'true';
      process.env.MOCK_LLM_SERVER_URL = 'http://127.0.0.1:3001';
      process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:3001';
      process.env.OPENAI_BASE_URL = 'http://127.0.0.1:3001/v1';
      const mockLlmSessionId = '9db93370-808f-4bba-a38c-84c72cd35937';
      const createConversationDto = {
        projectId: testIds.project,
        organizationId: testIds.organization,
        workflowId: testIds.workflow,
        initiatedBy: InitiationType.User,
        title: 'New Conversation',
        workflowName: 'onboarding' as const,
        context: {},
      };
      jest
        .spyOn(conversationWorkflowService, 'createConversation')
        .mockResolvedValue({
          conversation: mockConversation,
          workflowStarted: true,
          workflowId: testIds.workflow,
        });

      try {
        await controller.createConversation(
          testIds.project,
          testIds.organization,
          createConversationDto,
          mockLlmSessionId,
        );
      } finally {
        process.env = originalEnvironment;
      }

      expect(
        conversationWorkflowService.createConversation,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          context: { mockLlmSessionId },
        }),
        testIds.organization,
      );
    });

    it('should handle conversation creation errors', async () => {
      // INTENT: Test error handling for creation failures
      // This ensures appropriate error responses for invalid data or permissions
      const createConversationDto = {
        projectId: testIds.project,
        organizationId: testIds.organization,
        workflowId: 'workflow-123' as any,
        interactionTypeId: 'interaction-123' as any,
        initiatedBy: InitiationType.User,
        title: '',
        workflowName: 'onboarding' as const,
        context: {},
      };

      const creationError = new Error('Invalid conversation data');
      jest
        .spyOn(conversationWorkflowService, 'createConversation')
        .mockRejectedValue(creationError);

      await expect(
        controller.createConversation(
          testIds.project,
          testIds.organization,
          createConversationDto,
        ),
      ).rejects.toThrow('Invalid conversation data');
    });

    it('should validate project access during creation', async () => {
      // INTENT: Test authorization - users should only create conversations in accessible projects
      // This ensures proper security boundaries are enforced
      const createConversationDto = {
        projectId: testIds.project,
        organizationId: testIds.organization,
        workflowId: testIds.workflow,
        interactionTypeId: 'interaction-123' as any,
        initiatedBy: InitiationType.User,
        title: 'Test Conversation',
        workflowName: 'onboarding' as const,
        context: {},
      };

      const authError = new Error('Project not accessible');
      jest
        .spyOn(conversationWorkflowService, 'createConversation')
        .mockRejectedValue(authError);

      await expect(
        controller.createConversation(
          testIds.project,
          testIds.organization,
          createConversationDto,
        ),
      ).rejects.toThrow('Project not accessible');
    });

    it('should return workflowAboutId when provided in createConversationDto', async () => {
      // INTENT: Test that workflowAboutId is properly returned when present in the conversation
      // This ensures the API includes all necessary workflow context data
      const mockConversationWithWorkflowAboutId =
        TestUtils.createMockConversation({
          title: 'Test Conversation with Workflow About ID',
          workflowAboutId: 'workflow-about-123',
        });

      const createConversationDto = {
        projectId: testIds.project,
        organizationId: testIds.organization,
        workflowId: testIds.workflow,
        interactionTypeId: 'interaction-123' as any,
        initiatedBy: InitiationType.User,
        title: 'Test Conversation',
        workflowAboutId: 'workflow-about-123',
        workflowName: 'onboarding' as const,
        context: {},
      };

      jest
        .spyOn(conversationWorkflowService, 'createConversation')
        .mockResolvedValue({
          conversation: mockConversationWithWorkflowAboutId,
          workflowStarted: true,
          workflowId: testIds.workflow,
        });

      const result = await controller.createConversation(
        testIds.project,
        testIds.organization,
        createConversationDto,
      );

      expect(result.workflowAboutId).toBe('workflow-about-123');
      expect(
        conversationWorkflowService.createConversation,
      ).toHaveBeenCalledWith(createConversationDto, testIds.organization);
    });

    it('should return workflowAboutId when using ConversationWorkflowService', async () => {
      // INTENT: Test that workflowAboutId is returned when creating conversations through workflow service
      // This ensures consistency between both creation paths
      const mockConversationWithWorkflowAboutId =
        TestUtils.createMockConversation({
          title: 'Test Workflow Conversation',
          workflowAboutId: 'initiative-456',
        });

      const createConversationDto = {
        projectId: testIds.project,
        organizationId: testIds.organization,
        workflowId: testIds.workflow,
        workflowAboutType: 'initiative-refinement',
        interactionTypeId: 'interaction-123' as any,
        initiatedBy: InitiationType.User,
        title: 'Test Workflow Conversation',
        workflowName: 'onboarding' as const,
        workflowAboutId: 'initiative-456',
        context: {},
      };

      const workflowResult = {
        conversation: mockConversationWithWorkflowAboutId,
        workflowStarted: true,
        workflowId: 'workflow-789',
      };

      jest
        .spyOn(conversationWorkflowService, 'createConversation')
        .mockResolvedValue(workflowResult);

      const result = await controller.createConversation(
        testIds.project,
        testIds.organization,
        createConversationDto,
      );

      expect(result.workflowAboutId).toBe('initiative-456');
      expect(
        conversationWorkflowService.createConversation,
      ).toHaveBeenCalledWith(createConversationDto, testIds.organization);
    });
  });

  describe('getActiveConversations endpoint', () => {
    it('should retrieve active conversations with default pagination', async () => {
      // INTENT: Test retrieval of active conversations
      // This ensures users can see ongoing conversations in their projects
      jest
        .spyOn(conversationService, 'getActiveConversationsFromAdapter')
        .mockResolvedValue(mockPaginatedResponse as any);

      const result = await controller.getActiveConversations(
        testIds.project,
        testIds.organization,
      );

      // INTENT: Verify service was called with project ID, organization ID, and empty query params
      expect(
        conversationService.getActiveConversationsFromAdapter,
      ).toHaveBeenCalledWith(testIds.project, testIds.organization, {
        includeSuggestionDecisions: false,
      });

      // INTENT: Verify the response includes conversations and pagination metadata
      expect(result).toEqual(mockPaginatedResponse);
      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });

    it('should handle custom pagination and filtering parameters', async () => {
      // INTENT: Test query parameter handling for pagination and filtering
      // This allows users to navigate large conversation lists efficiently
      const queryParams = {
        page: 2,
        limit: 20,
        sortBy: 'updatedAt' as const,
        sortOrder: 'desc' as const,
        workflowName: 'onboarding',
        search: 'test query',
      };

      const customPaginatedResponse = {
        data: [] as any[],
        pagination: {
          page: 2,
          limit: 20,
          total: 0,
          pages: 0,
        },
      };

      jest
        .spyOn(conversationService, 'getActiveConversationsFromAdapter')
        .mockResolvedValue(customPaginatedResponse as any);

      const result = await controller.getActiveConversations(
        testIds.project,
        testIds.organization,
        queryParams,
      );

      // INTENT: Verify all query parameters are passed through correctly
      expect(
        conversationService.getActiveConversationsFromAdapter,
      ).toHaveBeenCalledWith(testIds.project, testIds.organization, {
        ...queryParams,
        includeSuggestionDecisions: false,
      });

      expect(result.pagination.page).toBe(2);
      expect(result.pagination.limit).toBe(20);
    });

    it('should handle empty results gracefully', async () => {
      // INTENT: Test behavior when no active conversations exist
      // This ensures the API provides useful feedback for empty states
      const emptyResponse = {
        data: [] as any[],
        pagination: {
          page: 1,
          limit: 10,
          total: 0,
          pages: 0,
        },
      };

      jest
        .spyOn(conversationService, 'getActiveConversationsFromAdapter')
        .mockResolvedValue(emptyResponse as any);

      const result = await controller.getActiveConversations(
        testIds.project,
        testIds.organization,
      );

      expect(result.data).toEqual([]);
      expect(result.pagination.total).toBe(0);
    });
  });

  describe('getVersion', () => {
    it('should return the conversation version from the service', async () => {
      const expectedVersion = 7;
      jest
        .spyOn(conversationService, 'getConversationVersion')
        .mockResolvedValue(expectedVersion);

      const response = await controller.getVersion(
        testIds.project,
        testIds.conversation,
        testIds.organization,
      );

      expect(conversationService.getConversationVersion).toHaveBeenCalledWith(
        testIds.project,
        testIds.conversation,
        testIds.organization,
      );
      expect(response).toEqual({ version: expectedVersion });
    });
  });

  describe('getCliStatus', () => {
    const callerUserId = testIds.user as UserId;
    const ownerUserId = 'owner-user-id' as UserId;

    it('returns connected=true when the owner has a CLI socket', async () => {
      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(mockConversation);
      jest
        .spyOn(conversationService, 'getOwnerMachineSelection')
        .mockResolvedValue({
          userId: ownerUserId,
          machineId: statusMachineId,
        });
      connectionManager.hasCliConnectionForUser.mockReturnValue(true);

      const response = await controller.getCliStatus(
        testIds.project,
        testIds.conversation,
        testIds.organization,
        callerUserId,
      );

      expect(connectionManager.hasCliConnectionForUser).toHaveBeenCalledWith(
        ownerUserId,
      );
      expect(response).toEqual({
        connected: true,
        selectedMachineId: statusMachineId,
        authorizationProtocolVersion: 2,
        executionReadiness: 'READY',
      });
    });

    it('returns connected=false when the conversation has no agent session owner', async () => {
      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(mockConversation);
      jest
        .spyOn(conversationService, 'getOwnerMachineSelection')
        .mockResolvedValue(null);

      const response = await controller.getCliStatus(
        testIds.project,
        testIds.conversation,
        testIds.organization,
        callerUserId,
      );

      expect(connectionManager.hasCliConnectionForUser).not.toHaveBeenCalled();
      expect(response).toEqual({
        connected: false,
        selectedMachineId: null,
        authorizationProtocolVersion: null,
        executionReadiness: 'NO_MACHINE_SELECTED',
      });
    });

    it('returns connected=false when the owner has only browser sockets', async () => {
      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(mockConversation);
      jest
        .spyOn(conversationService, 'getOwnerMachineSelection')
        .mockResolvedValue({ userId: ownerUserId, machineId: null });
      connectionManager.hasCliConnectionForUser.mockReturnValue(false);

      const response = await controller.getCliStatus(
        testIds.project,
        testIds.conversation,
        testIds.organization,
        callerUserId,
      );

      expect(response).toEqual({
        connected: false,
        selectedMachineId: null,
        authorizationProtocolVersion: null,
        executionReadiness: 'NO_MACHINE_SELECTED',
      });
      expect(machineExecutionReadinessService.resolve).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the conversation does not belong to the project', async () => {
      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(null);

      await expect(
        controller.getCliStatus(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          callerUserId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(
        conversationService.getOwnerMachineSelection,
      ).not.toHaveBeenCalled();
    });
  });

  describe('startConversationRun', () => {
    const callerUserId = testIds.user as UserId;
    const ownerUserId = callerUserId;
    const otherUserId = 'other-user-id' as UserId;

    const buildRequestDto = (): ConversationStartRunRequestDto => {
      const request = {
        attachments: [],
        operationId: '55555555-5555-4555-8555-555555555555',
        authorization: {
          kind: 'bounded_grant',
          grantId: '99999999-9999-4999-8999-999999999999',
        },
        handlerPromptType: 'startup_session',
        payload: {
          entity: {
            entityType: 'TASK',
            entityId: '11111111-1111-4111-8111-111111111111',
          },
          promptType: 'startup_session',
          startupInput: {
            task: {
              id: '11111111-1111-4111-8111-111111111111',
              taskType: 'STANDARD',
              description: 'noop',
            },
            adjacentScopeTasks: [],
            evidenceItems: [],
          },
        },
        model: 'gpt-5.6-luna',
        reasoningEffort:
          ConversationStartRunRequestDto.ReasoningEffortEnum.High,
        provider: ConversationStartRunRequestDto.ProviderEnum.Codex,
        contextMetadata: {
          agentSessionId: 'agent-session-uuid',
          capturedAt: '2026-05-27T00:00:00.000Z',
          organizationId: testIds.organization,
          projectId: testIds.project,
          userComments: [],
          fileReferences: { resolved: [], unresolved: [] },
        },
        serviceIds: ['service-uuid', 'service-secondary-uuid'],
        launchServiceId: 'service-uuid',
        worktree: { enabled: true, branch: 'feature/worktree-run' },
        agentSessionId: 'agent-session-uuid',
        machineId: statusMachineId,
      } satisfies Omit<ConversationStartRunRequestDto, 'operationFingerprint'>;
      return {
        ...request,
        operationFingerprint: createHash('sha256')
          .update(
            canonicalizeJcs({
              kind: 'START_RUN',
              organizationId: testIds.organization,
              projectId: testIds.project,
              conversationId: testIds.conversation,
              request: (({
                operationId: _operationId,
                authorization: _authorization,
                ...semantic
              }) => semantic)(request),
            }),
          )
          .digest('hex'),
      };
    };

    const buildWorkflowPayload = (
      userMessage = 'Start the workflow.',
      entity?: RunEntityReference,
    ): ConversationStartRunRequestDto['payload'] => ({
      promptType: 'workflow_kickoff',
      ...(entity ? { entity } : {}),
      userMessage,
    });

    const startConversationRun = (
      ...args: Parameters<ConversationController['startConversationRun']>
    ): ReturnType<ConversationController['startConversationRun']> => {
      const [projectId, conversationId, organizationId, userId, requestDto] =
        args;
      const {
        authorization: _authorization,
        operationId: _operationId,
        operationFingerprint: _operationFingerprint,
        ...request
      } = requestDto;
      return controller.startConversationRun(
        projectId,
        conversationId,
        organizationId,
        userId,
        {
          ...requestDto,
          operationFingerprint: createHash('sha256')
            .update(
              canonicalizeJcs({
                kind: 'START_RUN',
                organizationId,
                projectId,
                conversationId,
                request,
              }),
            )
            .digest('hex'),
        },
      );
    };

    it('rejects missing authorization before claiming an operation', async () => {
      const requestDto = buildRequestDto();
      const { authorization: _authorization, ...requestWithoutAuthorization } =
        requestDto;

      let caught: unknown;
      try {
        await controller.startConversationRun(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          callerUserId,
          requestWithoutAuthorization as ConversationStartRunRequestDto,
        );
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      expect((caught as BadRequestException).getResponse()).toMatchObject({
        code: 'INVALID_CONTROLLER_AUTHORIZATION',
      });
      expect(
        executionGrantService.assertInteractiveAuthorized,
      ).not.toHaveBeenCalled();
    });

    describe('project report launch', () => {
      const binding = {
        requestId: 'report-request-id',
        attemptId: 'report-attempt-id',
      };
      let projectReportLaunch: {
        assertStartRun: jest.Mock;
        failLaunch: jest.Mock;
        startAcceptedInTransaction: jest.Mock;
      };

      beforeEach(() => {
        projectReportLaunch = (
          controller as unknown as {
            projectReportLaunchService: typeof projectReportLaunch;
          }
        ).projectReportLaunchService;
        projectReportLaunch.assertStartRun.mockResolvedValue(binding);
        projectReportLaunch.failLaunch = jest.fn();
        projectReportLaunch.startAcceptedInTransaction = jest.fn();
        jest
          .spyOn(conversationService, 'getConversationFromAdapter')
          .mockResolvedValue(mockConversation);
        jest
          .spyOn(conversationService, 'getOwnerUserId')
          .mockResolvedValue(ownerUserId);
      });

      afterEach(() => {
        projectReportLaunch.assertStartRun.mockResolvedValue(undefined);
      });

      it('marks the attempt running inside the transaction that commits the operation', async () => {
        await startConversationRun(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          callerUserId,
          buildRequestDto(),
        );

        const [submission] =
          agentOperationSubmission.submitPrepared.mock.calls[0]!;
        expect(
          projectReportLaunch.startAcceptedInTransaction,
        ).not.toHaveBeenCalled();
        const tx = { tx: true };
        await submission.onSubmittedInTx!(tx);
        expect(
          projectReportLaunch.startAcceptedInTransaction,
        ).toHaveBeenCalledWith(tx, binding.requestId, binding.attemptId);
        expect(projectReportLaunch.failLaunch).not.toHaveBeenCalled();
      });

      it('surfaces an authorization error through the queued-only launch failure', async () => {
        const denied = new ForbiddenException('grant expired');
        executionGrantService.assertInteractiveAuthorized.mockRejectedValueOnce(
          denied,
        );

        await expect(
          startConversationRun(
            testIds.project,
            testIds.conversation,
            testIds.organization,
            callerUserId,
            buildRequestDto(),
          ),
        ).rejects.toBe(denied);
        expect(projectReportLaunch.failLaunch).toHaveBeenCalledWith(
          binding.requestId,
          binding.attemptId,
          'AUTHORIZATION_FAILED',
        );
        expect(
          (agentOperationRegistry as unknown as { begin: jest.Mock }).begin,
        ).not.toHaveBeenCalled();
      });

      it('does not fail the attempt when another start-run owns the launch claim', async () => {
        agentSessionService.claimStartRunLaunch.mockResolvedValueOnce(false);

        await expect(
          startConversationRun(
            testIds.project,
            testIds.conversation,
            testIds.organization,
            callerUserId,
            buildRequestDto(),
          ),
        ).rejects.toThrow(ConflictException);
        expect(projectReportLaunch.failLaunch).not.toHaveBeenCalled();
      });

      it('fails a queued attempt when its own launch cannot commit', async () => {
        agentOperationSubmission.submitPrepared.mockRejectedValueOnce(
          new ConflictException('binding conflict'),
        );

        await expect(
          startConversationRun(
            testIds.project,
            testIds.conversation,
            testIds.organization,
            callerUserId,
            buildRequestDto(),
          ),
        ).rejects.toThrow('binding conflict');
        expect(projectReportLaunch.failLaunch).toHaveBeenCalledWith(
          binding.requestId,
          binding.attemptId,
          'START_RUN_FAILED',
        );
      });
    });

    describe.skip('retired direct message and trigger-emitter assertions', () => {
      it('authors a SYSTEM triggersAgent message and acks dispatch on the happy path', async () => {
        jest
          .spyOn(conversationService, 'getConversationFromAdapter')
          .mockResolvedValue(mockConversation);
        jest
          .spyOn(conversationService, 'getOwnerUserId')
          .mockResolvedValue(ownerUserId);
        connectionManager.hasCliConnectionForUser.mockReturnValue(true);
        messageService.addMessage.mockResolvedValue({} as any);

        const requestDto = buildRequestDto();

        const response = await startConversationRun(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          callerUserId,
          requestDto,
        );

        expect(response.dispatched).toBe(true);
        expect(response.triggerMessageId).toBe(
          '55555555-5555-4555-8555-555555555557',
        );

        // Ack is awaited after addMessage
        expect(
          triggerEmitter.emitConversationTriggerWithAck,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            conversationId: testIds.conversation,
            messageId: response.triggerMessageId,
            organizationId: testIds.organization,
            timeoutMs: 4000,
          }),
        );

        expect(messageService.addMessage).toHaveBeenCalledTimes(1);
        const call = messageService.addMessage.mock.calls[0];
        if (!call) throw new Error('addMessage was not called');
        const [createDto, organizationIdArg, sourceLabel] = call;

        expect(organizationIdArg).toBe(testIds.organization);
        expect(sourceLabel).toBe('startConversationRun:triggersAgent');
        expect(createDto.type).toBe('SYSTEM');
        expect(createDto.id).toBe(response.triggerMessageId);
        expect(createDto.conversationId).toBe(testIds.conversation);
        expect(createDto.projectId).toBe(testIds.project);
        expect(createDto.status).toBe(MessageStatus.Completed);

        const systemData = createDto.data as SystemMessageData;
        expect(systemData.type).toBe(SystemMessageData.TypeEnum.Agent);
        expect(systemData.triggersAgent).toBeDefined();

        const trigger = systemData.triggersAgent as AgentTriggerStartRun;
        expect(trigger.promptType).toBe(
          AgentTriggerStartRun.PromptTypeEnum.StartRun,
        );
        // Trigger-emitter invariant: triggerMessageId === persisted row id.
        expect(trigger.triggerMessageId).toBe(response.triggerMessageId);
        expect(trigger.payload.handlerPromptType).toBe('startup_session');
        expect(trigger.payload.payload).toEqual(requestDto.payload);
        expect(trigger.payload.model).toBe(requestDto.model);
        expect(trigger.payload.reasoningEffort).toBe(
          requestDto.reasoningEffort,
        );
        expect(trigger.payload.provider).toBe(requestDto.provider);
        expect(trigger.payload).not.toHaveProperty('config');
        expect(trigger.payload.contextMetadata).toEqual(
          requestDto.contextMetadata,
        );
        expect(trigger.payload.serviceIds).toEqual(requestDto.serviceIds);
        expect(trigger.payload.launchServiceId).toBe(
          requestDto.launchServiceId,
        );
        expect(trigger.payload.worktree).toEqual(requestDto.worktree);
        expect(trigger.payload.agentSessionId).toBe(requestDto.agentSessionId);

        // The session is claimed before any rows are authored so duplicate
        // start-run requests cannot create a second trigger.
        expect(agentSessionService.claimStartRunLaunch).toHaveBeenCalledWith(
          testIds.organization,
          requestDto.agentSessionId,
        );
      });

      it('authors a new operation trigger when authorization reuses an active grant', async () => {
        jest
          .spyOn(conversationService, 'getConversationFromAdapter')
          .mockResolvedValue(mockConversation);
        jest
          .spyOn(conversationService, 'getOwnerUserId')
          .mockResolvedValue(ownerUserId);
        connectionManager.hasCliConnectionForUser.mockReturnValue(true);
        messageService.getMessage.mockResolvedValue(null);
        messageService.addMessage.mockResolvedValue({} as never);
        executionGrantService.assertInteractiveAuthorized.mockResolvedValueOnce(
          {
            authorizationId: '99999999-9999-4999-8999-999999999999',
            requestId: '88888888-8888-4888-8888-888888888888',
            controllerInstallationId: '44444444-4444-4444-8444-444444444444',
            machineId: statusMachineId,
            agentSessionId:
              '77777777-7777-4777-8777-777777777777' as AgentSessionId,
            action: {
              requestId: '88888888-8888-4888-8888-888888888888',
              actionCategory: HostActionCategory.Conversation,
              actionType: HostAffectingActionType.ConversationTrigger,
              targetKind: 'AGENT_SESSION',
              targetId: '77777777-7777-4777-8777-777777777777',
            },
            envelopeAuthorization: {
              kind: 'bounded_grant',
              grantId: '66666666-6666-4666-8666-666666666666',
            },
            existingGrantId: '66666666-6666-4666-8666-666666666666',
          } as never,
        );

        await startConversationRun(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          callerUserId,
          buildRequestDto(),
        );

        expect(messageService.addMessage).toHaveBeenCalledTimes(1);
        expect(messageService.addMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            id: '55555555-5555-4555-8555-555555555557',
            type: 'SYSTEM',
          }),
          testIds.organization,
          'startConversationRun:triggersAgent',
        );
        expect(
          triggerEmitter.emitConversationTriggerWithAck,
        ).toHaveBeenCalledTimes(1);
      });

      it.each(['turn-firing', 'workflow'] as const)(
        'validates and forwards the identical Task Monitor config on the %s arm',
        async (arm) => {
          jest
            .spyOn(conversationService, 'getConversationFromAdapter')
            .mockResolvedValue(mockConversation);
          jest
            .spyOn(conversationService, 'getOwnerUserId')
            .mockResolvedValue(ownerUserId);
          connectionManager.hasCliConnectionForUser.mockReturnValue(true);
          messageService.addMessage.mockResolvedValue({} as any);

          const config = {
            type: 'CODING_SESSION' as const,
            version: 'v2' as const,
            model: 'gpt-5.6-luna',
            worktree: 'plans/task-monitor-worktree',
            sessionMonitorTerminalPolicy: {
              implementationDone: {
                requestReview: true as const,
              },
              reviewDone: {
                completion: { action: 'DONE' },
              },
            },
          };
          let requestDto: ConversationStartRunRequestDto = {
            ...buildRequestDto(),
            config,
            contextMetadata: {
              ...buildRequestDto().contextMetadata,
              taskMonitorId: '22222222-2222-4222-8222-222222222222',
            },
          };
          if (arm === 'workflow') {
            const {
              handlerPromptType: _handlerPromptType,
              ...workflowRequest
            } = requestDto;
            requestDto = {
              ...workflowRequest,
              workflowName: WorkflowName.PlanFromDesignDoc,
              payload: buildWorkflowPayload(),
            };
          }
          agentSessionService.resolveStartRunConfiguration.mockResolvedValue(
            config,
          );

          await startConversationRun(
            testIds.project,
            testIds.conversation,
            testIds.organization,
            callerUserId,
            requestDto,
          );

          expect(
            agentSessionService.resolveStartRunConfiguration,
          ).toHaveBeenCalledWith({
            organizationId: testIds.organization,
            agentSessionId: requestDto.agentSessionId,
            taskMonitorId: requestDto.contextMetadata.taskMonitorId,
            config,
          });
          const triggerCall = messageService.addMessage.mock.calls.find(
            ([, , sourceLabel]) =>
              sourceLabel === 'startConversationRun:triggersAgent',
          );
          if (!triggerCall)
            throw new Error('start-run trigger was not authored');
          const trigger = (triggerCall[0].data as SystemMessageData)
            .triggersAgent as AgentTriggerStartRun;
          expect(trigger.payload.config).toBe(config);
          expect(trigger.payload.config).toEqual(
            expect.objectContaining({
              worktree: 'plans/task-monitor-worktree',
            }),
          );
        },
      );

      it.each([
        ['omitted', undefined],
        ['enabled', { enabled: true }],
        ['disabled', { enabled: false }],
      ] as const)(
        'forwards Entity Conversation config with Project Assistant %s unchanged',
        async (_state, projectAssistant) => {
          jest
            .spyOn(conversationService, 'getConversationFromAdapter')
            .mockResolvedValue(mockConversation);
          jest
            .spyOn(conversationService, 'getOwnerUserId')
            .mockResolvedValue(ownerUserId);
          connectionManager.hasCliConnectionForUser.mockReturnValue(true);
          messageService.addMessage.mockResolvedValue({} as any);

          const config = {
            type: 'ENTITY_CONVERSATION' as const,
            version: 'v1' as const,
            model: 'gpt-5.6-luna',
            ...(projectAssistant === undefined ? {} : { projectAssistant }),
          };
          const requestDto: ConversationStartRunRequestDto = {
            ...buildRequestDto(),
            config,
          };

          await startConversationRun(
            testIds.project,
            testIds.conversation,
            testIds.organization,
            callerUserId,
            requestDto,
          );

          const triggerCall = messageService.addMessage.mock.calls.find(
            ([, , sourceLabel]) =>
              sourceLabel === 'startConversationRun:triggersAgent',
          );
          if (!triggerCall)
            throw new Error('start-run trigger was not authored');
          const trigger = (triggerCall[0].data as SystemMessageData)
            .triggersAgent as AgentTriggerStartRun;
          expect(trigger.payload.config).toBe(config);
          expect(trigger.payload.config).toEqual(config);
        },
      );

      it('rejects invalid Task Monitor configuration before claiming launch or authoring rows', async () => {
        jest
          .spyOn(conversationService, 'getConversationFromAdapter')
          .mockResolvedValue(mockConversation);
        jest
          .spyOn(conversationService, 'getOwnerUserId')
          .mockResolvedValue(ownerUserId);
        connectionManager.hasCliConnectionForUser.mockReturnValue(true);
        agentSessionService.resolveStartRunConfiguration.mockRejectedValue(
          new BadRequestException('Task Monitor config mismatch'),
        );

        await expect(
          startConversationRun(
            testIds.project,
            testIds.conversation,
            testIds.organization,
            callerUserId,
            buildRequestDto(),
          ),
        ).rejects.toThrow('Task Monitor config mismatch');

        expect(agentSessionService.claimStartRunLaunch).not.toHaveBeenCalled();
        expect(messageService.addMessage).not.toHaveBeenCalled();
        expect(
          triggerEmitter.emitConversationTriggerWithAck,
        ).not.toHaveBeenCalled();
      });

      it.each([
        { arm: 'turn-firing', selection: 'enabled', fastMode: true },
        { arm: 'turn-firing', selection: 'disabled', fastMode: false },
        { arm: 'turn-firing', selection: 'omitted', fastMode: undefined },
        { arm: 'workflow', selection: 'enabled', fastMode: true },
        { arm: 'workflow', selection: 'disabled', fastMode: false },
        { arm: 'workflow', selection: 'omitted', fastMode: undefined },
      ])(
        'preserves Fast mode $selection on the $arm start-run arm',
        async ({ arm, fastMode }) => {
          jest
            .spyOn(conversationService, 'getConversationFromAdapter')
            .mockResolvedValue(mockConversation);
          jest
            .spyOn(conversationService, 'getOwnerUserId')
            .mockResolvedValue(ownerUserId);
          connectionManager.hasCliConnectionForUser.mockReturnValue(true);
          messageService.addMessage.mockResolvedValue({} as any);

          let requestDto: ConversationStartRunRequestDto = {
            ...buildRequestDto(),
            ...(fastMode !== undefined ? { fastMode } : {}),
          };
          if (arm === 'workflow') {
            const {
              handlerPromptType: _handlerPromptType,
              ...workflowRequest
            } = requestDto;
            requestDto = {
              ...workflowRequest,
              workflowName: WorkflowName.PlanFromDesignDoc,
              payload: buildWorkflowPayload(),
            };
          }

          await startConversationRun(
            testIds.project,
            testIds.conversation,
            testIds.organization,
            callerUserId,
            requestDto,
          );

          const triggerCall = messageService.addMessage.mock.calls.find(
            ([, , sourceLabel]) =>
              sourceLabel === 'startConversationRun:triggersAgent',
          );
          if (!triggerCall)
            throw new Error('start-run trigger was not authored');
          const [createDto] = triggerCall;
          const systemData = createDto.data as SystemMessageData;
          const trigger = systemData.triggersAgent as AgentTriggerStartRun;

          if (fastMode === undefined) {
            expect(trigger.payload).not.toHaveProperty('fastMode');
          } else {
            expect(trigger.payload.fastMode).toBe(fastMode);
          }
        },
      );

      it('claims the agent session before authoring workflow-arm start-run rows', async () => {
        jest
          .spyOn(conversationService, 'getConversationFromAdapter')
          .mockResolvedValue(mockConversation);
        jest
          .spyOn(conversationService, 'getOwnerUserId')
          .mockResolvedValue(ownerUserId);
        connectionManager.hasCliConnectionForUser.mockReturnValue(true);
        messageService.addMessage.mockResolvedValue({} as any);

        const { handlerPromptType: _h, ...rest } = buildRequestDto();
        const requestDto: ConversationStartRunRequestDto = {
          ...rest,
          payload: buildWorkflowPayload(),
          workflowName: WorkflowName.PlanFromDesignDoc,
        };

        await startConversationRun(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          callerUserId,
          requestDto,
        );

        expect(agentSessionService.claimStartRunLaunch).toHaveBeenCalledWith(
          testIds.organization,
          requestDto.agentSessionId,
        );
        expect(messageService.addMessage).toHaveBeenCalledTimes(1);
      });

      it('throws 409 and authors no rows when the agent session launch was already claimed', async () => {
        jest
          .spyOn(conversationService, 'getConversationFromAdapter')
          .mockResolvedValue(mockConversation);
        jest
          .spyOn(conversationService, 'getOwnerUserId')
          .mockResolvedValue(ownerUserId);
        connectionManager.hasCliConnectionForUser.mockReturnValue(true);
        agentSessionService.claimStartRunLaunch.mockResolvedValue(false);

        let caught: unknown;
        try {
          await startConversationRun(
            testIds.project,
            testIds.conversation,
            testIds.organization,
            callerUserId,
            buildRequestDto(),
          );
        } catch (error) {
          caught = error;
        }

        expect(caught).toBeInstanceOf(ConflictException);
        const response = (caught as ConflictException).getResponse() as {
          code?: string;
        };
        expect(response.code).toBe('START_RUN_ALREADY_LAUNCHED');
        expect(messageService.addMessage).not.toHaveBeenCalled();
        expect(
          triggerEmitter.emitConversationTriggerWithAck,
        ).not.toHaveBeenCalled();
        expect(
          conversationWorkflowService.startConversationWorkflow,
        ).not.toHaveBeenCalled();
      });

      it('accepts a bind-only workflow launch and signs no payload', async () => {
        jest
          .spyOn(conversationService, 'getConversationFromAdapter')
          .mockResolvedValue(mockConversation);
        jest
          .spyOn(conversationService, 'getOwnerUserId')
          .mockResolvedValue(ownerUserId);
        connectionManager.hasCliConnectionForUser.mockReturnValue(true);
        messageService.addMessage.mockResolvedValue({} as any);

        const {
          handlerPromptType: _handlerPromptType,
          payload: _payload,
          ...rest
        } = buildRequestDto();
        const requestDto: ConversationStartRunRequestDto = {
          ...rest,
          workflowName: WorkflowName.PlanFromDesignDoc,
        };

        const response = await startConversationRun(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          callerUserId,
          requestDto,
        );

        expect(response.dispatched).toBe(true);
        expect(agentSessionService.claimStartRunLaunch).toHaveBeenCalledWith(
          testIds.organization,
          requestDto.agentSessionId,
        );
        const triggerCall = messageService.addMessage.mock.calls[0];
        if (!triggerCall) throw new Error('start-run trigger was not authored');
        const [triggerDto] = triggerCall;
        const triggerData = triggerDto.data as SystemMessageData;
        const trigger = triggerData.triggersAgent as AgentTriggerStartRun;

        expect(trigger.payload.workflowName).toBe(
          WorkflowName.PlanFromDesignDoc,
        );
        expect(trigger.payload).not.toHaveProperty('handlerPromptType');
        expect(trigger.payload).not.toHaveProperty('payload');
        expect(trigger.payload.model).toBe(requestDto.model);
        expect(trigger.payload.contextMetadata).toEqual(
          requestDto.contextMetadata,
        );
      });

      it('forwards the explicit unscoped workflow kickoff payload into the materialize-only start_run trigger', async () => {
        jest
          .spyOn(conversationService, 'getConversationFromAdapter')
          .mockResolvedValue(mockConversation);
        jest
          .spyOn(conversationService, 'getOwnerUserId')
          .mockResolvedValue(ownerUserId);
        connectionManager.hasCliConnectionForUser.mockReturnValue(true);
        messageService.addMessage.mockResolvedValue({} as any);

        // Workflow arm: `workflowName` is set and the CLI materializes and binds
        // the Run without firing a first turn.
        const { handlerPromptType: _h, ...rest } = buildRequestDto();
        const requestDto: ConversationStartRunRequestDto = {
          ...rest,
          payload: buildWorkflowPayload(),
          workflowName: WorkflowName.PlanFromDesignDoc,
        };

        const response = await startConversationRun(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          callerUserId,
          requestDto,
        );

        expect(response.dispatched).toBe(true);
        expect(messageService.addMessage).toHaveBeenCalledTimes(1);
        const call = messageService.addMessage.mock.calls[0];
        if (!call) throw new Error('addMessage was not called');
        const [createDto, , sourceLabel] = call;
        expect(sourceLabel).toBe('startConversationRun:triggersAgent');

        const systemData = createDto.data as SystemMessageData;
        const trigger = systemData.triggersAgent as AgentTriggerStartRun;
        expect(trigger.promptType).toBe(
          AgentTriggerStartRun.PromptTypeEnum.StartRun,
        );
        // The workflow arm carries workflowName plus the typed materialization
        // payload and omits only the turn-firing handler discriminator.
        expect(trigger.payload.workflowName).toBe(
          WorkflowName.PlanFromDesignDoc,
        );
        expect(trigger.payload.payload).toBe(requestDto.payload);
        expect(trigger.payload.payload).not.toHaveProperty('entity');
        expect(trigger.payload).not.toHaveProperty('handlerPromptType');
        // Materialization context still rides so the CLI can create the Run.
        expect(trigger.payload.model).toBe(requestDto.model);
        expect(trigger.payload.worktree).toEqual(requestDto.worktree);
        expect(trigger.payload.agentSessionId).toBe(requestDto.agentSessionId);
      });

      it('rejects a non-workflow-kickoff payload on the workflow arm before claiming or dispatching', async () => {
        jest
          .spyOn(conversationService, 'getConversationFromAdapter')
          .mockResolvedValue(mockConversation);
        jest
          .spyOn(conversationService, 'getOwnerUserId')
          .mockResolvedValue(ownerUserId);
        connectionManager.hasCliConnectionForUser.mockReturnValue(true);

        const { handlerPromptType: _handlerPromptType, ...rest } =
          buildRequestDto();
        const requestDto: ConversationStartRunRequestDto = {
          ...rest,
          workflowName: WorkflowName.PlanFromDesignDoc,
        };

        let caught: unknown;
        try {
          await startConversationRun(
            testIds.project,
            testIds.conversation,
            testIds.organization,
            callerUserId,
            requestDto,
          );
        } catch (error) {
          caught = error;
        }

        expect(caught).toBeInstanceOf(BadRequestException);
        expect((caught as BadRequestException).getResponse()).toMatchObject({
          code: 'INVALID_START_RUN_FOCAL_ENTITY',
        });
        expect(agentSessionService.claimStartRunLaunch).not.toHaveBeenCalled();
        expect(messageService.addMessage).not.toHaveBeenCalled();
        expect(
          triggerEmitter.emitConversationTriggerWithAck,
        ).not.toHaveBeenCalled();
      });

      it('preserves the focal entity unchanged in the workflow start-run payload sent for signing', async () => {
        jest
          .spyOn(conversationService, 'getConversationFromAdapter')
          .mockResolvedValue(mockConversation);
        jest
          .spyOn(conversationService, 'getOwnerUserId')
          .mockResolvedValue(ownerUserId);
        connectionManager.hasCliConnectionForUser.mockReturnValue(true);
        messageService.addMessage.mockResolvedValue({} as any);

        const focalEntity: RunEntityReference = {
          entityType: RunEntityReference.EntityTypeEnum.Task,
          entityId: '11111111-1111-4111-8111-111111111111',
        };
        const { handlerPromptType: _handlerPromptType, ...rest } =
          buildRequestDto();
        const workflowPayload = buildWorkflowPayload(
          'Plan this task.',
          focalEntity,
        );
        const requestDto: ConversationStartRunRequestDto = {
          ...rest,
          workflowName: WorkflowName.PlanFromDesignDoc,
          payload: workflowPayload,
        };

        await startConversationRun(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          callerUserId,
          requestDto,
        );

        const triggerCall = messageService.addMessage.mock.calls[0];
        if (!triggerCall) throw new Error('start-run trigger was not authored');
        const [triggerDto] = triggerCall;
        const triggerData = triggerDto.data as SystemMessageData;
        const trigger = triggerData.triggersAgent as AgentTriggerStartRun;

        const signedWorkflowPayload = trigger.payload.payload;
        expect(signedWorkflowPayload).toBe(workflowPayload);
        if (
          signedWorkflowPayload?.promptType !==
          RunCreatePayloadWorkflowKickoff.PromptTypeEnum.WorkflowKickoff
        ) {
          throw new Error('workflow kickoff payload was not forwarded');
        }
        expect(signedWorkflowPayload.entity).toBe(focalEntity);
        expect(signedWorkflowPayload.entity).toEqual({
          entityType: 'TASK',
          entityId: '11111111-1111-4111-8111-111111111111',
        });
      });

      it.each([
        {
          name: 'null declaration',
          entity: null,
        },
        {
          name: 'missing entityType',
          entity: { entityId: '11111111-1111-4111-8111-111111111111' },
        },
        {
          name: 'unsupported entityType',
          entity: {
            entityType: 'NOT_AN_ENTITY',
            entityId: '11111111-1111-4111-8111-111111111111',
          },
        },
        {
          name: 'work-item subtype used as entityType',
          entity: {
            entityType: 'FEATURE',
            entityId: '11111111-1111-4111-8111-111111111111',
          },
        },
        {
          name: 'missing entityId',
          entity: { entityType: 'TASK' },
        },
        {
          name: 'non-UUID entityId',
          entity: { entityType: 'TASK', entityId: 'not-a-uuid' },
        },
      ])(
        'rejects a malformed workflow focal entity before claiming or dispatching: $name',
        async ({ entity }) => {
          jest
            .spyOn(conversationService, 'getConversationFromAdapter')
            .mockResolvedValue(mockConversation);
          jest
            .spyOn(conversationService, 'getOwnerUserId')
            .mockResolvedValue(ownerUserId);
          connectionManager.hasCliConnectionForUser.mockReturnValue(true);

          const { handlerPromptType: _handlerPromptType, ...rest } =
            buildRequestDto();
          const malformedRequest = {
            ...rest,
            workflowName: WorkflowName.PlanFromDesignDoc,
            payload: {
              promptType: 'workflow_kickoff',
              userMessage: 'Plan this task.',
              entity,
            },
          } as ConversationStartRunRequestDto;

          let caught: unknown;
          try {
            await startConversationRun(
              testIds.project,
              testIds.conversation,
              testIds.organization,
              callerUserId,
              malformedRequest,
            );
          } catch (error) {
            caught = error;
          }

          expect(caught).toBeInstanceOf(BadRequestException);
          expect((caught as BadRequestException).getResponse()).toMatchObject({
            code: 'INVALID_START_RUN_FOCAL_ENTITY',
          });
          expect(
            agentSessionService.claimStartRunLaunch,
          ).not.toHaveBeenCalled();
          expect(messageService.addMessage).not.toHaveBeenCalled();
          expect(
            triggerEmitter.emitConversationTriggerWithAck,
          ).not.toHaveBeenCalled();
        },
      );
    });

    it('does not start a bind-only NOT_STARTED workflow before CLI acknowledgement', async () => {
      const notStartedConv = TestUtils.createMockConversation({
        status: ConversationStatus.NotStarted,
        workflowName: WorkflowName.PlanFromDesignDoc,
      });
      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(notStartedConv);
      jest
        .spyOn(conversationService, 'getOwnerUserId')
        .mockResolvedValue(ownerUserId);
      connectionManager.hasCliConnectionForUser.mockReturnValue(true);
      messageService.addMessage.mockResolvedValue({} as any);
      const startWorkflowSpy = jest
        .spyOn(conversationWorkflowService, 'startConversationWorkflow')
        .mockResolvedValue({
          conversation: notStartedConv,
          workflowStarted: true,
          workflowId: testIds.workflow,
        });

      const { handlerPromptType: _h, ...rest } = buildRequestDto();
      const requestDto: ConversationStartRunRequestDto = {
        ...rest,
        payload: buildWorkflowPayload(),
        workflowName: WorkflowName.PlanFromDesignDoc,
      };

      const response = await startConversationRun(
        testIds.project,
        testIds.conversation,
        testIds.organization,
        callerUserId,
        requestDto,
      );

      expect(response.dispatched).toBe(true);
      expect(agentOperationSubmission.submitPrepared).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowKickoffDelivery: {
            workflowId: testIds.workflow,
            workflowName: WorkflowName.PlanFromDesignDoc,
          },
        }),
      );
      expect(startWorkflowSpy).not.toHaveBeenCalled();
    });

    it('commits the workflow kickoff with a dedicated post-ack delivery obligation', async () => {
      const notStartedConv = TestUtils.createMockConversation({
        status: ConversationStatus.NotStarted,
        workflowName: WorkflowName.PlanFromDesignDoc,
      });
      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(notStartedConv);
      jest
        .spyOn(conversationService, 'getOwnerUserId')
        .mockResolvedValue(ownerUserId);
      connectionManager.hasCliConnectionForUser.mockReturnValue(true);
      messageService.addMessage.mockResolvedValue({} as any);

      const startWorkflowSpy = jest
        .spyOn(conversationWorkflowService, 'startConversationWorkflow')
        .mockResolvedValue({
          conversation: notStartedConv,
          workflowStarted: true,
          workflowId: testIds.workflow,
        });
      const workflowReadySpy = jest
        .spyOn(workflowRouterService, 'isWorkflowUserMessageSignalReady')
        .mockResolvedValue(true);

      const kickoffText =
        'Plan the migration from feature flags to remote config.';
      const { handlerPromptType: _h, ...rest } = buildRequestDto();
      const requestDto: ConversationStartRunRequestDto = {
        ...rest,
        workflowName: WorkflowName.PlanFromDesignDoc,
        // workflow_kickoff payload variant: carries kickoff text alongside
        // workflowName; the API authors the USER row and forwards the same
        // payload for Run materialization.
        payload: buildWorkflowPayload(kickoffText),
        initialMessage: { role: MessageType.User },
      };

      const response = await startConversationRun(
        testIds.project,
        testIds.conversation,
        testIds.organization,
        callerUserId,
        requestDto,
      );

      expect(response.dispatched).toBe(true);
      expect(agentOperationSubmission.submitPrepared).toHaveBeenCalledWith(
        expect.objectContaining({
          userMessage: expect.objectContaining({
            id: '55555555-5555-4555-8555-555555555556',
            type: 'USER',
            userId: ownerUserId,
            data: { comment: kickoffText },
          }),
          workflowKickoffDelivery: {
            workflowId: testIds.workflow,
            workflowName: WorkflowName.PlanFromDesignDoc,
          },
          triggerMessage: expect.objectContaining({ type: 'SYSTEM' }),
        }),
      );
      expect(startWorkflowSpy).not.toHaveBeenCalled();
      expect(workflowReadySpy).not.toHaveBeenCalled();
    });

    it('commits an empty workflow kickoff as a durable CONTROL delivery', async () => {
      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(mockConversation);
      jest
        .spyOn(conversationService, 'getOwnerUserId')
        .mockResolvedValue(ownerUserId);
      connectionManager.hasCliConnectionForUser.mockReturnValue(true);

      const { handlerPromptType: _handlerPromptType, ...rest } =
        buildRequestDto();
      await startConversationRun(
        testIds.project,
        testIds.conversation,
        testIds.organization,
        callerUserId,
        {
          ...rest,
          workflowName: WorkflowName.PlanFromDesignDoc,
          payload: buildWorkflowPayload(''),
          initialMessage: { role: MessageType.User },
        },
      );

      expect(agentOperationSubmission.submitPrepared).toHaveBeenCalledWith(
        expect.objectContaining({
          userMessage: expect.objectContaining({
            type: 'USER',
            data: { type: 'CONTROL', comment: ' ' },
          }),
          workflowKickoffDelivery: {
            workflowId: testIds.workflow,
            workflowName: WorkflowName.PlanFromDesignDoc,
          },
        }),
      );
    });

    it('commits a CONTROL kickoff when a materialize-only workflow arm has no initial message', async () => {
      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(mockConversation);
      jest
        .spyOn(conversationService, 'getOwnerUserId')
        .mockResolvedValue(ownerUserId);
      connectionManager.hasCliConnectionForUser.mockReturnValue(true);

      const { handlerPromptType: _handlerPromptType, ...rest } =
        buildRequestDto();
      await startConversationRun(
        testIds.project,
        testIds.conversation,
        testIds.organization,
        callerUserId,
        {
          ...rest,
          workflowName: WorkflowName.PlanFromDesignDoc,
          payload: undefined,
        },
      );

      expect(agentOperationSubmission.submitPrepared).toHaveBeenCalledWith(
        expect.objectContaining({
          userMessage: expect.objectContaining({
            type: 'USER',
            data: { type: 'CONTROL', comment: ' ' },
          }),
          workflowKickoffDelivery: {
            workflowId: testIds.workflow,
            workflowName: WorkflowName.PlanFromDesignDoc,
          },
        }),
      );
    });

    it('commits only the signed start-run trigger for the bound onboarding Conversation', async () => {
      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(mockConversation);
      jest
        .spyOn(conversationService, 'getOwnerUserId')
        .mockResolvedValue(ownerUserId);
      agentSessionService.resolveStartRunConversationBinding.mockResolvedValue({
        kind: 'REPOSITORY_IMPORT_MATERIALIZATION',
      });
      const {
        handlerPromptType: _handlerPromptType,
        payload: _payload,
        ...rest
      } = buildRequestDto();

      const response = await startConversationRun(
        testIds.project,
        testIds.conversation,
        testIds.organization,
        callerUserId,
        {
          ...rest,
          workflowName: WorkflowName.Onboarding,
        },
      );

      expect(response.operationState).toBe('DISPATCH_PENDING');
      expect(agentOperationSubmission.submitPrepared).toHaveBeenCalledWith(
        expect.objectContaining({
          triggerMessage: expect.objectContaining({ type: 'SYSTEM' }),
        }),
      );
      const prepared =
        agentOperationSubmission.submitPrepared.mock.calls[0]?.[0];
      expect(prepared).not.toHaveProperty('userMessage');
      expect(prepared).not.toHaveProperty('workflowKickoffDelivery');
      expect(messageService.addMessage).not.toHaveBeenCalled();
    });

    it('returns terminal onboarding materialization acknowledgement without adding kickoff work', async () => {
      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(mockConversation);
      jest
        .spyOn(conversationService, 'getOwnerUserId')
        .mockResolvedValue(ownerUserId);
      agentSessionService.resolveStartRunConversationBinding.mockResolvedValue({
        kind: 'REPOSITORY_IMPORT_MATERIALIZATION',
      });
      agentOperationSubmission.submitPrepared.mockResolvedValue({
        operationId: '55555555-5555-4555-8555-555555555555',
        fingerprint: 'f'.repeat(64),
        kind: AgentOperationKind.StartRun,
        state: 'SUCCEEDED',
        triggerMessageId: '55555555-5555-4555-8555-555555555557' as MessageId,
      });
      const {
        handlerPromptType: _handlerPromptType,
        payload: _payload,
        ...rest
      } = buildRequestDto();

      const response = await startConversationRun(
        testIds.project,
        testIds.conversation,
        testIds.organization,
        callerUserId,
        { ...rest, workflowName: WorkflowName.Onboarding },
      );

      expect(response.operationState).toBe('SUCCEEDED');
      const prepared =
        agentOperationSubmission.submitPrepared.mock.calls[0]?.[0];
      expect(prepared).not.toHaveProperty('userMessage');
      expect(prepared).not.toHaveProperty('workflowKickoffDelivery');
    });

    it('does not start a workflow for a NOT_STARTED turn-firing (non-workflow) arm', async () => {
      // The turn-firing arm carries handlerPromptType/payload and fires its own
      // first turn; it must not also kick off a Temporal workflow.
      const notStartedConv = TestUtils.createMockConversation({
        status: ConversationStatus.NotStarted,
      });
      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(notStartedConv);
      jest
        .spyOn(conversationService, 'getOwnerUserId')
        .mockResolvedValue(ownerUserId);
      connectionManager.hasCliConnectionForUser.mockReturnValue(true);
      messageService.addMessage.mockResolvedValue({} as any);
      const startWorkflowSpy = jest.spyOn(
        conversationWorkflowService,
        'startConversationWorkflow',
      );

      await startConversationRun(
        testIds.project,
        testIds.conversation,
        testIds.organization,
        callerUserId,
        buildRequestDto(),
      );

      expect(startWorkflowSpy).not.toHaveBeenCalled();
    });

    it('leaves readiness checks to durable delivery for an already-started workflow conversation', async () => {
      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(mockConversation);
      jest
        .spyOn(conversationService, 'getOwnerUserId')
        .mockResolvedValue(ownerUserId);
      connectionManager.hasCliConnectionForUser.mockReturnValue(true);
      messageService.addMessage.mockResolvedValue({} as any);
      const startWorkflowSpy = jest.spyOn(
        conversationWorkflowService,
        'startConversationWorkflow',
      );
      const workflowReadySpy = jest
        .spyOn(workflowRouterService, 'isWorkflowUserMessageSignalReady')
        .mockResolvedValue(true);

      const { handlerPromptType: _h, ...rest } = buildRequestDto();
      await startConversationRun(
        testIds.project,
        testIds.conversation,
        testIds.organization,
        callerUserId,
        {
          ...rest,
          payload: buildWorkflowPayload('Continue the plan.'),
          workflowName: WorkflowName.PlanFromDesignDoc,
          initialMessage: { role: MessageType.User },
        },
      );

      expect(startWorkflowSpy).not.toHaveBeenCalled();
      expect(workflowReadySpy).not.toHaveBeenCalled();
      expect(agentOperationSubmission.submitPrepared).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowKickoffDelivery: {
            workflowId: testIds.workflow,
            workflowName: WorkflowName.PlanFromDesignDoc,
          },
        }),
      );
    });

    it('authors a USER kickoff row first, then the SYSTEM start-run trigger, when a USER initialMessage is present and payload carries userMessage', async () => {
      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(mockConversation);
      jest
        .spyOn(conversationService, 'getOwnerUserId')
        .mockResolvedValue(ownerUserId);
      connectionManager.hasCliConnectionForUser.mockReturnValue(true);
      messageService.addMessage.mockResolvedValue({} as any);

      const kickoffText = '  Help me refine this task.\n';
      const attachments = [
        {
          attachmentId: '11111111-1111-4111-8111-111111111111',
          fileName: 'notes.md',
        },
      ];
      const stagedBrowserTab = {
        stagedTabId: '22222222-2222-4222-8222-222222222222',
      };
      const requestDto: ConversationStartRunRequestDto = {
        ...buildRequestDto(),
        attachments,
        stagedBrowserTab,
        payload: {
          promptType: 'task_refiner',
          payloadVersion: 1,
          task: { taskType: 'STANDARD', description: 'noop' },
          userMessage: kickoffText,
        } as any,
        initialMessage: { role: MessageType.User },
      };

      const response = await startConversationRun(
        testIds.project,
        testIds.conversation,
        testIds.organization,
        callerUserId,
        requestDto,
      );

      expect(response.dispatched).toBe(true);

      const submission =
        agentOperationSubmission.submitPrepared.mock.calls[0]?.[0];
      expect(submission).toMatchObject({
        userMessage: {
          type: 'USER',
          userId: ownerUserId,
          conversationId: testIds.conversation,
          projectId: testIds.project,
          status: MessageStatus.Completed,
          data: { comment: kickoffText, attachments },
        },
        triggerMessage: { type: 'SYSTEM', id: response.triggerMessageId },
        additionalMessages: [],
      });
      expect(submission?.userMessage?.id).not.toBe(response.triggerMessageId);
      expect(submission?.workflowKickoffDelivery).toBeUndefined();
      const trigger = (submission?.triggerMessage.data as SystemMessageData)
        .triggersAgent as AgentTriggerStartRun;
      expect(trigger.payload.attachments).toEqual(attachments);
      expect(trigger.payload.stagedBrowserTab).toEqual(stagedBrowserTab);
      expect(JSON.stringify(submission?.userMessage)).not.toContain(
        'stagedBrowserTab',
      );
      expect(
        (trigger.payload.payload as { userMessage: string }).userMessage,
      ).toBe(kickoffText);
      expect(JSON.stringify(submission)).not.toContain('file content');
    });

    it.each(['work_tracker_connect', 'work_tracker_import'] as const)(
      'starts %s without authoring a USER kickoff when the payload has no userMessage',
      async (promptType) => {
        jest
          .spyOn(conversationService, 'getConversationFromAdapter')
          .mockResolvedValue(mockConversation);
        jest
          .spyOn(conversationService, 'getOwnerUserId')
          .mockResolvedValue(ownerUserId);
        connectionManager.hasCliConnectionForUser.mockReturnValue(true);

        const requestDto: ConversationStartRunRequestDto = {
          attachments: [],
          ...buildRequestDto(),
          handlerPromptType: promptType,
          payload: {
            promptType,
            projectId: testIds.project,
            conversationId: testIds.conversation,
            workflowId: testIds.workflow,
            workflowNodeId: 'work-tracker-node',
            machineId: statusMachineId,
            source: 'linear',
            provider: 'codex',
            resolvedFrontierModel: 'gpt-5.6-luna',
            reasoningEffort: 'high',
          } satisfies ConversationStartRunRequestDto['payload'],
          initialMessage: { role: MessageType.User },
        };

        const response = await startConversationRun(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          callerUserId,
          requestDto,
        );

        expect(response.dispatched).toBe(true);
        const submission =
          agentOperationSubmission.submitPrepared.mock.calls[0]?.[0];
        expect(submission?.userMessage).toBeUndefined();
        expect(submission?.triggerMessage).toMatchObject({ type: 'SYSTEM' });
      },
    );

    describe.skip('retired direct trigger-row assertions', () => {
      it('omits service fields from the trigger payload for non-coding sessions (no services)', async () => {
        jest
          .spyOn(conversationService, 'getConversationFromAdapter')
          .mockResolvedValue(mockConversation);
        jest
          .spyOn(conversationService, 'getOwnerUserId')
          .mockResolvedValue(ownerUserId);
        connectionManager.hasCliConnectionForUser.mockReturnValue(true);
        messageService.addMessage.mockResolvedValue({} as any);

        // Refiners / entity conversations carry no services — the fields are absent.
        const {
          serviceIds: _omittedIds,
          launchServiceId: _omittedLaunch,
          ...requestDto
        } = buildRequestDto();

        const response = await startConversationRun(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          callerUserId,
          requestDto as ConversationStartRunRequestDto,
        );

        expect(response.dispatched).toBe(true);

        const call = messageService.addMessage.mock.calls[0];
        if (!call) throw new Error('addMessage was not called');
        const [createDto] = call;
        const systemData = createDto.data as SystemMessageData;
        const trigger = systemData.triggersAgent as AgentTriggerStartRun;

        expect(trigger.payload).not.toHaveProperty('serviceIds');
        expect(trigger.payload).not.toHaveProperty('launchServiceId');
        expect(trigger.payload.agentSessionId).toBe(requestDto.agentSessionId);
      });

      it('authors a SYSTEM greeting row first, then the SYSTEM start-run trigger as the sole dispatching row, when a SYSTEM initialMessage is present', async () => {
        jest
          .spyOn(conversationService, 'getConversationFromAdapter')
          .mockResolvedValue(mockConversation);
        jest
          .spyOn(conversationService, 'getOwnerUserId')
          .mockResolvedValue(ownerUserId);
        connectionManager.hasCliConnectionForUser.mockReturnValue(true);
        messageService.addMessage.mockResolvedValue({} as any);

        const greetingText = 'Welcome! Let me help you refine this task.';
        const requestDto: ConversationStartRunRequestDto = {
          ...buildRequestDto(),
          initialMessage: { role: MessageType.System }, //text: greetingText },
        };

        const response = await startConversationRun(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          callerUserId,
          requestDto,
        );

        expect(response.dispatched).toBe(true);
        expect(response.triggerMessageId).toEqual(expect.any(String));

        // Two rows authored in order: the SYSTEM greeting first (renders ahead of
        // the agent's reply), then the SYSTEM start-run trigger that boots the run.
        expect(messageService.addMessage).toHaveBeenCalledTimes(2);
        const greetingCall = messageService.addMessage.mock.calls[0];
        const triggerCall = messageService.addMessage.mock.calls[1];
        if (!greetingCall || !triggerCall) {
          throw new Error('addMessage was not called twice');
        }

        // 1) SYSTEM greeting — renders first, carries text in `response`, and
        // opens NO trigger (no `triggersAgent`), so nothing double-fires.
        const [greetingDto, greetingOrgId, greetingSource] = greetingCall;
        expect(greetingOrgId).toBe(testIds.organization);
        expect(greetingSource).toBe('startConversationRun:initialMessage');
        expect(greetingDto.type).toBe('SYSTEM');
        expect(greetingDto.conversationId).toBe(testIds.conversation);
        expect(greetingDto.projectId).toBe(testIds.project);
        expect(greetingDto.status).toBe(MessageStatus.Completed);
        // The greeting must NOT be the dispatching trigger row.
        expect(greetingDto.id).not.toBe(response.triggerMessageId);

        const greetingData = greetingDto.data as SystemMessageData;
        expect(greetingData.type).toBe(SystemMessageData.TypeEnum.Questions);
        expect(greetingData.response).toBe(''); //greetingText);
        // No trigger rides the greeting — it mints no pending open trigger.
        expect(greetingData.triggersAgent).toBeUndefined();

        // 2) SYSTEM start-run trigger — the sole dispatching row.
        const [triggerDto, triggerOrgId, triggerSource] = triggerCall;
        expect(triggerOrgId).toBe(testIds.organization);
        expect(triggerSource).toBe('startConversationRun:triggersAgent');
        expect(triggerDto.type).toBe('SYSTEM');
        expect(triggerDto.id).toBe(response.triggerMessageId);

        const systemData = triggerDto.data as SystemMessageData;
        expect(systemData.type).toBe(SystemMessageData.TypeEnum.Agent);
        const trigger = systemData.triggersAgent as AgentTriggerStartRun;
        expect(trigger.promptType).toBe(
          AgentTriggerStartRun.PromptTypeEnum.StartRun,
        );
        // A greeting is NOT launch text — it must not leak into the payload's
        // `userMessage`.
        expect(
          (trigger.payload.payload as { userMessage?: string }).userMessage,
        ).toBeUndefined();
      });

      it('writes no USER kickoff row when USER initialMessage is present but payload carries no userMessage', async () => {
        jest
          .spyOn(conversationService, 'getConversationFromAdapter')
          .mockResolvedValue(mockConversation);
        jest
          .spyOn(conversationService, 'getOwnerUserId')
          .mockResolvedValue(ownerUserId);
        connectionManager.hasCliConnectionForUser.mockReturnValue(true);
        messageService.addMessage.mockResolvedValue({} as any);

        // buildRequestDto() uses a startup_session payload with no userMessage.
        const requestDto: ConversationStartRunRequestDto = {
          ...buildRequestDto(),
          initialMessage: { role: MessageType.User },
        };

        await startConversationRun(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          callerUserId,
          requestDto,
        );

        // Only the SYSTEM trigger row — no spurious USER row authored.
        expect(messageService.addMessage).toHaveBeenCalledTimes(1);
        const call = messageService.addMessage.mock.calls[0];
        if (!call) throw new Error('addMessage was not called');
        const [createDto, , sourceLabel] = call;
        expect(createDto.type).toBe('SYSTEM');
        expect(sourceLabel).toBe('startConversationRun:triggersAgent');
      });

      it('leaves the SYSTEM start-run trigger path unchanged and writes no extra row when initialMessage is absent', async () => {
        jest
          .spyOn(conversationService, 'getConversationFromAdapter')
          .mockResolvedValue(mockConversation);
        jest
          .spyOn(conversationService, 'getOwnerUserId')
          .mockResolvedValue(ownerUserId);
        connectionManager.hasCliConnectionForUser.mockReturnValue(true);
        messageService.addMessage.mockResolvedValue({} as any);

        const requestDto = buildRequestDto();
        expect(requestDto.initialMessage).toBeUndefined();

        await startConversationRun(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          callerUserId,
          requestDto,
        );

        expect(messageService.addMessage).toHaveBeenCalledTimes(1);
        const call = messageService.addMessage.mock.calls[0];
        if (!call) throw new Error('addMessage was not called');
        const [createDto, , sourceLabel] = call;

        // SYSTEM-trigger branch: a SYSTEM row, never a USER row.
        expect(createDto.type).toBe('SYSTEM');
        expect(sourceLabel).toBe('startConversationRun:triggersAgent');

        const systemData = createDto.data as SystemMessageData;
        expect(systemData.type).toBe(SystemMessageData.TypeEnum.Agent);
        const trigger = systemData.triggersAgent as AgentTriggerStartRun;
        expect(trigger.promptType).toBe(
          AgentTriggerStartRun.PromptTypeEnum.StartRun,
        );
      });

      it('authors a SYSTEM greeting row and a materialize-only start-run trigger (payload.triggersAgent === false) — no first turn fires — when a SYSTEM initialMessage sets triggersAgent: false', async () => {
        jest
          .spyOn(conversationService, 'getConversationFromAdapter')
          .mockResolvedValue(mockConversation);
        jest
          .spyOn(conversationService, 'getOwnerUserId')
          .mockResolvedValue(ownerUserId);
        connectionManager.hasCliConnectionForUser.mockReturnValue(true);
        messageService.addMessage.mockResolvedValue({} as any);

        // Non-dispatching SYSTEM seed: the greeting is the standing first row and
        // the Run is materialized, but the turn-firing arm is marked
        // materialize-only so the CLI fires no first turn. The agent wakes only on
        // the user's first USER message.
        const requestDto: ConversationStartRunRequestDto = {
          ...buildRequestDto(),
          initialMessage: { role: MessageType.System, triggersAgent: false },
        };

        const response = await startConversationRun(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          callerUserId,
          requestDto,
        );

        expect(response.dispatched).toBe(true);

        // Two rows authored in order: SYSTEM greeting first, then the start-run
        // trigger that carries the materialize-only signal.
        expect(messageService.addMessage).toHaveBeenCalledTimes(2);
        const greetingCall = messageService.addMessage.mock.calls[0];
        const triggerCall = messageService.addMessage.mock.calls[1];
        if (!greetingCall || !triggerCall) {
          throw new Error('addMessage was not called twice');
        }

        // 1) SYSTEM greeting — the standing first row, opens no trigger.
        const [greetingDto, , greetingSource] = greetingCall;
        expect(greetingSource).toBe('startConversationRun:initialMessage');
        expect(greetingDto.type).toBe('SYSTEM');
        const greetingData = greetingDto.data as SystemMessageData;
        expect(greetingData.type).toBe(SystemMessageData.TypeEnum.Questions);
        expect(greetingData.triggersAgent).toBeUndefined();

        // 2) start-run trigger — still authored (so conversationId → runId binds),
        // but marked materialize-only: payload.triggersAgent === false tells the
        // CLI to materialize the Run and fire no turn. The handler/payload stay
        // bound so the user's later first message is not dropped as no_active_run.
        const [triggerDto, , triggerSource] = triggerCall;
        expect(triggerSource).toBe('startConversationRun:triggersAgent');
        expect(triggerDto.type).toBe('SYSTEM');
        const triggerData = triggerDto.data as SystemMessageData;
        const trigger = triggerData.triggersAgent as AgentTriggerStartRun;
        expect(trigger.promptType).toBe(
          AgentTriggerStartRun.PromptTypeEnum.StartRun,
        );
        expect(trigger.payload.handlerPromptType).toBe('startup_session');
        expect(trigger.payload.triggersAgent).toBe(false);
      });

      it('leaves the turn-firing trigger payload free of any materialize-only signal for a default SYSTEM seed (triggersAgent omitted)', async () => {
        jest
          .spyOn(conversationService, 'getConversationFromAdapter')
          .mockResolvedValue(mockConversation);
        jest
          .spyOn(conversationService, 'getOwnerUserId')
          .mockResolvedValue(ownerUserId);
        connectionManager.hasCliConnectionForUser.mockReturnValue(true);
        messageService.addMessage.mockResolvedValue({} as any);

        // Default SYSTEM seed (triggersAgent omitted ⇒ true): dispatches exactly
        // as before, so the trigger payload must carry no materialize-only flag.
        const requestDto: ConversationStartRunRequestDto = {
          ...buildRequestDto(),
          initialMessage: { role: MessageType.System },
        };

        await startConversationRun(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          callerUserId,
          requestDto,
        );

        const triggerCall = messageService.addMessage.mock.calls[1];
        if (!triggerCall) throw new Error('trigger row was not authored');
        const [triggerDto] = triggerCall;
        const triggerData = triggerDto.data as SystemMessageData;
        const trigger = triggerData.triggersAgent as AgentTriggerStartRun;
        expect(trigger.payload.triggersAgent).toBeUndefined();
      });

      it('leaves the turn-firing trigger payload free of any materialize-only signal for a USER seed (dispatch unchanged)', async () => {
        jest
          .spyOn(conversationService, 'getConversationFromAdapter')
          .mockResolvedValue(mockConversation);
        jest
          .spyOn(conversationService, 'getOwnerUserId')
          .mockResolvedValue(ownerUserId);
        connectionManager.hasCliConnectionForUser.mockReturnValue(true);
        messageService.addMessage.mockResolvedValue({} as any);

        // A USER seed only suppresses dispatch when role is SYSTEM, so the
        // materialize-only signal must never ride a USER-seed envelope.
        const requestDto: ConversationStartRunRequestDto = {
          ...buildRequestDto(),
          initialMessage: { role: MessageType.User, triggersAgent: false },
        };

        await startConversationRun(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          callerUserId,
          requestDto,
        );

        const triggerCall = messageService.addMessage.mock.calls[0];
        if (!triggerCall) throw new Error('trigger row was not authored');
        const [triggerDto] = triggerCall;
        const triggerData = triggerDto.data as SystemMessageData;
        const trigger = triggerData.triggersAgent as AgentTriggerStartRun;
        expect(trigger.payload.triggersAgent).toBeUndefined();
      });
    });

    it('throws ForbiddenException when the caller is not the conversation owner', async () => {
      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(mockConversation);
      jest
        .spyOn(conversationService, 'getOwnerUserId')
        .mockResolvedValue(otherUserId);

      await expect(
        startConversationRun(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          callerUserId,
          buildRequestDto(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(messageService.addMessage).not.toHaveBeenCalled();
      expect(connectionManager.hasCliConnectionForUser).not.toHaveBeenCalled();
    });

    it('keeps the durable dispatch pending when the owner has no CLI socket', async () => {
      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(mockConversation);
      jest
        .spyOn(conversationService, 'getOwnerUserId')
        .mockResolvedValue(ownerUserId);
      connectionManager.hasCliConnectionForUser.mockReturnValue(false);

      await expect(
        startConversationRun(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          callerUserId,
          buildRequestDto(),
        ),
      ).resolves.toMatchObject({
        dispatched: true,
        operationState: 'DISPATCH_PENDING',
      });
      expect(agentOperationSubmission.submitPrepared).toHaveBeenCalled();
    });

    it('throws NotFoundException when the conversation does not belong to the project', async () => {
      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(null);

      await expect(
        startConversationRun(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          callerUserId,
          buildRequestDto(),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(conversationService.getOwnerUserId).not.toHaveBeenCalled();
      expect(messageService.addMessage).not.toHaveBeenCalled();
    });

    describe.skip('retired synchronous acknowledgement semantics', () => {
      it('keeps the operation reconciling without rollback when the ack times out', async () => {
        jest
          .spyOn(conversationService, 'getConversationFromAdapter')
          .mockResolvedValue(mockConversation);
        jest
          .spyOn(conversationService, 'getOwnerUserId')
          .mockResolvedValue(ownerUserId);
        connectionManager.hasCliConnectionForUser.mockReturnValue(true);
        messageService.addMessage.mockResolvedValue({} as any);
        triggerEmitter.emitConversationTriggerWithAck.mockResolvedValueOnce({
          acknowledged: false,
          reason: 'timeout',
        });

        await expect(
          startConversationRun(
            testIds.project,
            testIds.conversation,
            testIds.organization,
            callerUserId,
            buildRequestDto(),
          ),
        ).resolves.toMatchObject({
          dispatched: true,
          operationState: 'RECONCILING',
        });
        // addMessage is still called — message is persisted before the ack check
        expect(messageService.addMessage).toHaveBeenCalledTimes(1);
        expect(messageService.removePendingOpenTrigger).not.toHaveBeenCalled();
        // The launch is claimed before row authoring so a retry cannot duplicate
        // the persisted start_run trigger.
        expect(agentSessionService.claimStartRunLaunch).toHaveBeenCalledWith(
          testIds.organization,
          buildRequestDto().agentSessionId,
        );
        expect(
          agentSessionService.releaseStartRunLaunchClaim,
        ).not.toHaveBeenCalled();
        expect(agentOperationRegistry.markReconciling).toHaveBeenCalledWith(
          buildRequestDto().operationId,
          '55555555-5555-4555-8555-555555555558',
        );
      });

      it('authors the referenced trigger before deriving an exact-action grant', async () => {
        jest
          .spyOn(conversationService, 'getConversationFromAdapter')
          .mockResolvedValue(mockConversation);
        jest
          .spyOn(conversationService, 'getOwnerUserId')
          .mockResolvedValue(ownerUserId);
        connectionManager.hasCliConnectionForUser.mockReturnValue(true);
        messageService.addMessage.mockResolvedValue({} as never);
        executionGrantService.deriveInteractiveGrant.mockResolvedValueOnce({
          id: 'grant-id',
        } as never);

        const request = buildRequestDto();
        await expect(
          startConversationRun(
            testIds.project,
            testIds.conversation,
            testIds.organization,
            callerUserId,
            request,
          ),
        ).resolves.toMatchObject({ dispatched: true });

        expect(messageService.addMessage).toHaveBeenCalledTimes(1);
        expect(
          messageService.addMessage.mock.invocationCallOrder[0]!,
        ).toBeLessThan(
          executionGrantService.deriveInteractiveGrant.mock
            .invocationCallOrder[0]!,
        );
      });

      it('throws ServiceUnavailableException with MACHINE_ACK_TIMEOUT when no machine is in the room', async () => {
        jest
          .spyOn(conversationService, 'getConversationFromAdapter')
          .mockResolvedValue(mockConversation);
        jest
          .spyOn(conversationService, 'getOwnerUserId')
          .mockResolvedValue(ownerUserId);
        connectionManager.hasCliConnectionForUser.mockReturnValue(true);
        messageService.addMessage.mockResolvedValue({} as any);
        triggerEmitter.emitConversationTriggerWithAck.mockResolvedValueOnce({
          acknowledged: false,
          reason: 'no_recipient',
        });

        let caught: unknown;
        try {
          await startConversationRun(
            testIds.project,
            testIds.conversation,
            testIds.organization,
            callerUserId,
            buildRequestDto(),
          );
        } catch (error) {
          caught = error;
        }

        expect(caught).toBeInstanceOf(ServiceUnavailableException);
        const response = (
          caught as ServiceUnavailableException
        ).getResponse() as {
          code?: string;
          reason?: string;
        };
        expect(response.code).toBe('MACHINE_ACK_TIMEOUT');
        expect(response.reason).toBe('no_recipient');
        const triggerMessageId =
          messageService.addMessage.mock.calls[0]?.[0].id;
        expect(messageService.removePendingOpenTrigger).toHaveBeenCalledWith(
          triggerMessageId,
        );
        expect(
          agentSessionService.releaseStartRunLaunchClaim,
        ).toHaveBeenCalledWith(
          testIds.organization,
          buildRequestDto().agentSessionId,
        );
      });

      it('forwards caller-supplied machineId to emitConversationTriggerWithAck', async () => {
        jest
          .spyOn(conversationService, 'getConversationFromAdapter')
          .mockResolvedValue(mockConversation);
        jest
          .spyOn(conversationService, 'getOwnerUserId')
          .mockResolvedValue(ownerUserId);
        connectionManager.hasCliConnectionForUser.mockReturnValue(true);
        messageService.addMessage.mockResolvedValue({} as any);

        const machineId = 'machine-uuid' as MachineId;
        const response = await startConversationRun(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          callerUserId,
          { ...buildRequestDto(), machineId },
        );

        expect(response.dispatched).toBe(true);
        expect(
          triggerEmitter.emitConversationTriggerWithAck,
        ).toHaveBeenCalledWith(expect.objectContaining({ machineId }));
      });

      it('throws BadRequestException with INVALID_MACHINE_ID when the emitter returns invalid_machine', async () => {
        jest
          .spyOn(conversationService, 'getConversationFromAdapter')
          .mockResolvedValue(mockConversation);
        jest
          .spyOn(conversationService, 'getOwnerUserId')
          .mockResolvedValue(ownerUserId);
        connectionManager.hasCliConnectionForUser.mockReturnValue(true);
        messageService.addMessage.mockResolvedValue({} as any);
        triggerEmitter.emitConversationTriggerWithAck.mockResolvedValueOnce({
          acknowledged: false,
          reason: 'invalid_machine',
        });

        let caught: unknown;
        try {
          await startConversationRun(
            testIds.project,
            testIds.conversation,
            testIds.organization,
            callerUserId,
            { ...buildRequestDto(), machineId: 'bad-machine-id' as MachineId },
          );
        } catch (error) {
          caught = error;
        }

        expect(caught).toBeInstanceOf(BadRequestException);
        const response = (caught as BadRequestException).getResponse() as {
          code?: string;
        };
        expect(response.code).toBe('INVALID_MACHINE_ID');
        const triggerMessageId =
          messageService.addMessage.mock.calls[0]?.[0].id;
        expect(messageService.removePendingOpenTrigger).toHaveBeenCalledWith(
          triggerMessageId,
        );
      });
    });

    it('rejects a start-run request when machineId is omitted', async () => {
      const { machineId: _machineId, ...requestWithoutMachine } =
        buildRequestDto();

      await expect(
        startConversationRun(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          callerUserId,
          requestWithoutMachine as ConversationStartRunRequestDto,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'INVALID_MACHINE_ID' }),
      });
      expect(
        triggerEmitter.emitConversationTriggerWithAck,
      ).not.toHaveBeenCalled();
    });
  });

  describe('getAllConversations endpoint', () => {
    it('should retrieve all conversations including inactive ones', async () => {
      // INTENT: Test retrieval of all conversations regardless of status
      // This provides comprehensive conversation history access
      const allConversationsResponse = {
        data: [
          mockConversation,
          {
            ...mockConversation,
            id: 'conv-456',
            status: ConversationStatus.Completed,
            title: 'Completed Conversation',
          },
        ],
        pagination: {
          page: 1,
          limit: 10,
          total: 2,
          pages: 1,
        },
      };

      jest
        .spyOn(conversationService, 'getAllConversationsFromAdapter')
        .mockResolvedValue(allConversationsResponse as any);

      const result = await controller.getAllConversations(
        testIds.project,
        testIds.organization,
      );

      // INTENT: Verify service retrieves all conversations, not just active ones
      expect(
        conversationService.getAllConversationsFromAdapter,
      ).toHaveBeenCalledWith(testIds.project, testIds.organization, {
        includeSuggestionDecisions: false,
      });

      expect(result.data).toHaveLength(2);
      const [firstConversation, secondConversation] = result.data;
      if (!firstConversation || !secondConversation) {
        throw new Error('Expected two conversations in result');
      }
      expect(firstConversation.status).toBe(ConversationStatus.Started);
      expect(secondConversation.status).toBe(ConversationStatus.Completed);
    });

    it('should support status filtering for conversation management', async () => {
      // INTENT: Test filtering by conversation status
      // This allows users to find conversations in specific states
      const queryParams = {
        status: ConversationStatus.Completed,
        sortBy: 'createdAt' as const,
        sortOrder: 'desc' as const,
      };

      jest
        .spyOn(conversationService, 'getAllConversationsFromAdapter')
        .mockResolvedValue(mockPaginatedResponse as any);

      await controller.getAllConversations(
        testIds.project,
        testIds.organization,
        queryParams,
      );

      expect(
        conversationService.getAllConversationsFromAdapter,
      ).toHaveBeenCalledWith(testIds.project, testIds.organization, {
        ...queryParams,
        status: [ConversationStatus.Completed],
        includeSuggestionDecisions: false,
      });
    });

    it('should normalize comma-separated workflow names for filtering', async () => {
      const queryParams = {
        workflowName: 'onboarding,task-generation',
      };

      jest
        .spyOn(conversationService, 'getAllConversationsFromAdapter')
        .mockResolvedValue(mockPaginatedResponse as any);

      await controller.getAllConversations(
        testIds.project,
        testIds.organization,
        queryParams,
      );

      expect(
        conversationService.getAllConversationsFromAdapter,
      ).toHaveBeenCalledWith(testIds.project, testIds.organization, {
        ...queryParams,
        workflowName: [WorkflowName.Onboarding, WorkflowName.TaskGeneration],
        includeSuggestionDecisions: false,
      });
    });
  });

  describe('getConversation endpoint', () => {
    it('should retrieve a specific conversation by ID', async () => {
      // INTENT: Test individual conversation retrieval
      // This allows users to view conversation details and history
      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(mockConversation);

      const result = await controller.getConversation(
        testIds.project,
        testIds.conversation,
        testIds.organization,
      );

      // INTENT: Verify service is called with project, conversation, and organization IDs for authorization
      expect(
        conversationService.getConversationFromAdapter,
      ).toHaveBeenCalledWith(
        testIds.project,
        testIds.conversation,
        testIds.organization,
        {
          includeSuggestionDecisions: false,
        },
      );

      expect(result).toEqual(mockConversation);
    });

    it('should throw NotFoundException when conversation does not exist', async () => {
      // INTENT: Test error handling for non-existent conversations
      // This ensures proper 404 responses for invalid conversation IDs
      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(null);

      await expect(
        controller.getConversation(
          testIds.project,
          'non-existent-id' as any,
          testIds.organization,
        ),
      ).rejects.toThrow(NotFoundException);

      // INTENT: Verify the error message is user-friendly
      await expect(
        controller.getConversation(
          testIds.project,
          'non-existent-id' as any,
          testIds.organization,
        ),
      ).rejects.toThrow('Conversation not found');
    });

    it('should handle authorization errors for conversation access', async () => {
      // INTENT: Test security - users should only access conversations they own
      // This prevents unauthorized access to sensitive conversation data
      const authError = new Error('Conversation not accessible');
      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockRejectedValue(authError);

      await expect(
        controller.getConversation(
          testIds.project,
          testIds.conversation,
          testIds.organization,
        ),
      ).rejects.toThrow('Conversation not accessible');
    });
  });

  describe('updateConversation endpoint', () => {
    it('should update conversation with valid data', async () => {
      // INTENT: Test conversation updates with proper authorization
      // This allows users to modify conversation metadata
      const updateConversationDto = {
        expectedVersion: 1,
        title: 'Updated Conversation',
        status: ConversationStatus.Completed,
        workflowName: 'onboarding',
      };

      const updatedConversation = {
        ...mockConversation,
        ...updateConversationDto,
        updatedAt: '2023-01-02T00:00:00Z',
      };

      jest
        .spyOn(conversationService, 'updateConversationFromAdapter')
        .mockResolvedValue(updatedConversation as any);

      const result = await controller.updateConversation(
        testIds.project,
        testIds.conversation,
        testIds.organization,
        updateConversationDto,
      );

      // INTENT: Verify service is called with all required parameters including auth context
      expect(
        conversationService.updateConversationFromAdapter,
      ).toHaveBeenCalledWith(
        testIds.project,
        testIds.conversation,
        testIds.organization,
        updateConversationDto,
      );

      // INTENT: Verify the response reflects the updates
      expect(result.title).toBe('Updated Conversation');
      expect(result.status).toBe(ConversationStatus.Completed);
    });

    it('should validate update permissions', async () => {
      // INTENT: Test authorization for conversation updates
      // This ensures users can only modify conversations they have permission for
      const updateConversationDto = {
        expectedVersion: 1,
        title: 'Unauthorized Update',
      };

      const authError = new Error('Update not authorized');
      jest
        .spyOn(conversationService, 'updateConversationFromAdapter')
        .mockRejectedValue(authError);

      await expect(
        controller.updateConversation(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          updateConversationDto,
        ),
      ).rejects.toThrow('Update not authorized');
    });

    it('should handle partial updates correctly', async () => {
      // INTENT: Test partial updates to conversation properties
      // This allows users to update only specific fields without affecting others
      const partialUpdate = {
        expectedVersion: 1,
        status: ConversationStatus.InProgress,
      };

      const updatedConversation = {
        ...mockConversation,
        status: ConversationStatus.InProgress,
        updatedAt: '2023-01-02T00:00:00Z',
      };

      jest
        .spyOn(conversationService, 'updateConversationFromAdapter')
        .mockResolvedValue(updatedConversation as any);

      const result = await controller.updateConversation(
        testIds.project,
        testIds.conversation,
        testIds.organization,
        partialUpdate,
      );

      // INTENT: Verify only the specified field was updated
      expect(result.status).toBe(ConversationStatus.InProgress);
      expect(result.title).toBe(mockConversation.title); // Should remain unchanged
    });

    it('should validate update data before processing', async () => {
      // INTENT: Test input validation for update requests
      // This ensures data integrity and prevents invalid updates
      const invalidUpdate = {
        expectedVersion: 1,
        status: 'invalid-status' as any,
        title: '', // Empty title might be invalid
      };

      const validationError = new Error('Invalid update data');
      jest
        .spyOn(conversationService, 'updateConversationFromAdapter')
        .mockRejectedValue(validationError);

      await expect(
        controller.updateConversation(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          invalidUpdate,
        ),
      ).rejects.toThrow('Invalid update data');
    });
  });

  describe('getWorkflowConversations endpoint', () => {
    it('should return conversations for workflow entity', async () => {
      // INTENT: Test the getWorkflowConversations endpoint (workflow/:workflowType/:workflowAboutId/conversations)
      const mockWorkflowConversations = {
        data: [
          TestUtils.createMockConversation({
            id: 'workflow-conv-1' as any,
            workflowAboutType: 'task-generation',
            workflowAboutId: 'initiative-123',
            title: 'Task Generation Conversation',
          }),
        ],
        pagination: {
          page: 1,
          limit: 10,
          total: 1,
          pages: 1,
        },
      };

      jest
        .spyOn(
          conversationService,
          'getConversationsByWorkflowEntityFromAdapter',
        )
        .mockResolvedValue(mockWorkflowConversations as any);

      const result = await controller.getWorkflowConversations(
        testIds.organization,
        testIds.project,
        'task-generation',
        'initiative-123',
        { page: 1, limit: 10 },
      );

      // CRITICAL ASSERTIONS: Verify the service method is called with correct parameters
      expect(
        conversationService.getConversationsByWorkflowEntityFromAdapter,
      ).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        'initiative-123',
        'task-generation',
        {
          page: 1,
          limit: 10,
          status: undefined,
        },
      );

      expect(result.data).toHaveLength(1);
      const [workflowConversation] = result.data;
      if (!workflowConversation) {
        throw new Error('Expected workflow conversation result');
      }
      expect(workflowConversation.workflowAboutId).toBe('initiative-123');
      expect(workflowConversation.workflowAboutType).toBe('task-generation');
      expect(workflowConversation).not.toHaveProperty('messages');
    });

    it('should handle empty results for non-existent workflow entities', async () => {
      // INTENT: Test error handling when no conversations exist for workflow entity
      const emptyResult = {
        data: [] as any[],
        pagination: {
          page: 1,
          limit: 10,
          total: 0,
          pages: 0,
        },
      };

      jest
        .spyOn(
          conversationService,
          'getConversationsByWorkflowEntityFromAdapter',
        )
        .mockResolvedValue(emptyResult as any);

      const result = await controller.getWorkflowConversations(
        testIds.organization,
        testIds.project,
        'non-existent-workflow-type',
        'non-existent-workflow-about-id',
      );

      expect(result.data).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });

    it('should pass through query parameters correctly', async () => {
      // INTENT: Test that query parameters are properly forwarded to the service
      const mockResult = {
        data: [] as any[],
        pagination: { page: 2, limit: 5, total: 0, pages: 0 },
      };

      jest
        .spyOn(
          conversationService,
          'getConversationsByWorkflowEntityFromAdapter',
        )
        .mockResolvedValue(mockResult as any);

      const queryParams = {
        page: 2,
        limit: 5,
        sortBy: 'updatedAt' as const,
        sortOrder: 'asc' as const,
        status: ConversationStatus.Completed,
        workflowName: 'task-generation',
      };

      await controller.getWorkflowConversations(
        testIds.organization,
        testIds.project,
        'task-generation',
        'initiative-456',
        queryParams,
      );

      expect(
        conversationService.getConversationsByWorkflowEntityFromAdapter,
      ).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        'initiative-456',
        'task-generation',
        {
          ...queryParams,
          status: [ConversationStatus.Completed],
        },
      );
    });
  });

  describe('deleteConversation endpoint', () => {
    const mockDeletedConversation = TestUtils.createMockConversation({
      ...mockConversation,
      status: ConversationStatus.Deleted,
    });

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should successfully delete a conversation', async () => {
      // INTENT: Test successful deletion of conversation with proper authorization
      jest
        .spyOn(conversationService, 'deleteConversationFromAdapter')
        .mockResolvedValue(mockDeletedConversation);

      const result = await controller.deleteConversation(
        testIds.project,
        testIds.conversation,
        testIds.organization,
        testIds.user,
      );

      expect(
        conversationService.deleteConversationFromAdapter,
      ).toHaveBeenCalledWith(
        testIds.project,
        testIds.conversation,
        testIds.organization,
        testIds.user,
        undefined, // reason
        false,
      );
      expect(result).toBeUndefined();
    });

    it('should delete conversation with reason provided', async () => {
      // INTENT: Test deletion with optional reason parameter
      const deleteOptions = { reason: 'User requested deletion' };

      jest
        .spyOn(conversationService, 'deleteConversationFromAdapter')
        .mockResolvedValue(mockDeletedConversation);

      const result = await controller.deleteConversation(
        testIds.project,
        testIds.conversation,
        testIds.organization,
        testIds.user,
        deleteOptions,
      );

      expect(
        conversationService.deleteConversationFromAdapter,
      ).toHaveBeenCalledWith(
        testIds.project,
        testIds.conversation,
        testIds.organization,
        testIds.user,
        deleteOptions.reason,
        false,
      );
      expect(result).toBeUndefined();
    });

    it('should handle NotFoundException when conversation not found', async () => {
      // INTENT: Test proper error handling for non-existent conversations
      jest
        .spyOn(conversationService, 'deleteConversationFromAdapter')
        .mockRejectedValue(new NotFoundException('Conversation not found'));

      await expect(
        controller.deleteConversation(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          testIds.user,
        ),
      ).rejects.toThrow(NotFoundException);

      expect(
        conversationService.deleteConversationFromAdapter,
      ).toHaveBeenCalledWith(
        testIds.project,
        testIds.conversation,
        testIds.organization,
        testIds.user,
        undefined,
        false,
      );
    });

    it('should handle ConversationWorkflowError with proper HTTP response', async () => {
      // INTENT: Test handling of workflow-specific errors during deletion
      const {
        ConversationWorkflowError,
      } = require('../../core/exceptions/workflow.exceptions');
      const workflowError = new ConversationWorkflowError(
        'Failed to terminate workflow',
        { workflowId: testIds.workflow },
      );

      jest
        .spyOn(conversationService, 'deleteConversationFromAdapter')
        .mockRejectedValue(workflowError);

      await expect(
        controller.deleteConversation(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          testIds.user,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          success: false,
          message: 'Failed to terminate workflow',
          code: 'WORKFLOW_ERROR',
          context: { workflowId: testIds.workflow },
          statusCode: 400,
          path: `/organizations/${testIds.organization}/projects/${testIds.project}/conversations/${testIds.conversation}`,
        }),
        status: 400,
      });

      expect(
        conversationService.deleteConversationFromAdapter,
      ).toHaveBeenCalledWith(
        testIds.project,
        testIds.conversation,
        testIds.organization,
        testIds.user,
        undefined,
        false,
      );
    });

    it('should re-throw unexpected errors', async () => {
      // INTENT: Test that unexpected errors are not swallowed
      const unexpectedError = new Error('Database connection failed');

      jest
        .spyOn(conversationService, 'deleteConversationFromAdapter')
        .mockRejectedValue(unexpectedError);

      await expect(
        controller.deleteConversation(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          testIds.user,
        ),
      ).rejects.toThrow('Database connection failed');

      expect(
        conversationService.deleteConversationFromAdapter,
      ).toHaveBeenCalledWith(
        testIds.project,
        testIds.conversation,
        testIds.organization,
        testIds.user,
        undefined,
        false,
      );
    });

    it('should handle validation errors from cross-org access attempts', async () => {
      // INTENT: Test security by ensuring cross-organization access is blocked
      const differentOrgId = 'org-different' as any;
      const validationError = new Error(
        'Conversation does not belong to project',
      );

      jest
        .spyOn(conversationService, 'deleteConversationFromAdapter')
        .mockRejectedValue(validationError);

      await expect(
        controller.deleteConversation(
          testIds.project,
          testIds.conversation,
          differentOrgId,
          testIds.user,
        ),
      ).rejects.toThrow('Conversation does not belong to project');

      expect(
        conversationService.deleteConversationFromAdapter,
      ).toHaveBeenCalledWith(
        testIds.project,
        testIds.conversation,
        differentOrgId,
        testIds.user,
        undefined,
        false,
      );
    });
  });

  describe('skipToNode endpoint', () => {
    const mockFlowTemplate = {
      id: 'task-generation',
      name: 'Task Generation',
      nodes: {
        generate: {
          nextNode: 'end',
          skipToNode: {
            allowed: true,
            validPreviousNodes: ['conversation'],
          },
        },
      },
    };

    const mockFlowExecution = {
      id: 'exec-123',
      flowId: 'task-generation',
      status: FlowExecutionStatus.STARTED,
      currentNode: 'conversation',
      flowState: flowContextToSerializableState(
        TestUtils.createMockFlowContext(),
        'conversation',
        undefined,
      ),
      resumable: true,
      startedAt: new Date(),
      completedAt: null as Date | null,
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should successfully skip to node when validation passes', async () => {
      // INTENT: Test successful skip-to-node with proper validation
      const mockConv = TestUtils.createMockConversation({
        workflowName: 'task-generation',
        workflowId: testIds.workflow,
      });

      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(mockConv);

      jest
        .spyOn(flowEngineService, 'getFlow')
        .mockReturnValue(mockFlowTemplate as any);

      jest
        .spyOn(flowExecutionService, 'findByConversation')
        .mockResolvedValue(mockFlowExecution);

      jest
        .spyOn(workflowExecutionService, 'validateSkipToNode')
        .mockResolvedValue({ canSkip: true });

      jest.spyOn(workflowRouterService, 'sendSkipToNode').mockResolvedValue();

      const result = await controller.skipToNode(
        testIds.project,
        testIds.conversation,
        testIds.organization,
        { targetNode: 'generate' },
      );

      expect(result).toEqual({
        success: true,
        currentNode: 'generate',
        message: "Successfully skipped to node 'generate'",
      });

      expect(workflowRouterService.sendSkipToNode).toHaveBeenCalledWith(
        testIds.workflow,
        'generate',
      );
    });

    it('should return 400 when node validation fails', async () => {
      // INTENT: Test proper error handling for invalid node configuration
      const mockConv = TestUtils.createMockConversation({
        workflowName: 'task-generation',
        workflowId: testIds.workflow,
      });

      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(mockConv);

      jest
        .spyOn(flowEngineService, 'getFlow')
        .mockReturnValue(mockFlowTemplate as any);

      jest
        .spyOn(flowExecutionService, 'findByConversation')
        .mockResolvedValue(mockFlowExecution);

      jest
        .spyOn(workflowExecutionService, 'validateSkipToNode')
        .mockResolvedValue({
          canSkip: false,
          reason: 'Node not configured as skip-to-able',
        });

      await expect(
        controller.skipToNode(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          { targetNode: 'invalid' },
        ),
      ).rejects.toThrow();

      expect(workflowRouterService.sendSkipToNode).not.toHaveBeenCalled();
    });

    it('should return 409 when state validation fails', async () => {
      // INTENT: Test proper error handling for state conflicts
      const mockConv = TestUtils.createMockConversation({
        workflowName: 'task-generation',
        workflowId: testIds.workflow,
      });

      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(mockConv);

      jest
        .spyOn(flowEngineService, 'getFlow')
        .mockReturnValue(mockFlowTemplate as any);

      jest
        .spyOn(flowExecutionService, 'findByConversation')
        .mockResolvedValue(mockFlowExecution);

      jest
        .spyOn(workflowExecutionService, 'validateSkipToNode')
        .mockResolvedValue({
          canSkip: false,
          reason: 'Initiative must have a description before generating tasks',
        });

      await expect(
        controller.skipToNode(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          { targetNode: 'generate' },
        ),
      ).rejects.toThrow();

      expect(workflowRouterService.sendSkipToNode).not.toHaveBeenCalled();
    });

    it('should return 404 when conversation not found', async () => {
      // INTENT: Test proper error handling for non-existent conversations
      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(null);

      await expect(
        controller.skipToNode(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          { targetNode: 'generate' },
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return 400 when conversation has no workflow', async () => {
      // INTENT: Test proper error handling when conversation not associated with workflow
      const mockConv = TestUtils.createMockConversation({
        workflowName: undefined as any,
      });

      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(mockConv);

      await expect(
        controller.skipToNode(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          { targetNode: 'generate' },
        ),
      ).rejects.toThrow('Conversation is not associated with a workflow');
    });

    it('should return 409 for non-Temporal conversations', async () => {
      const mockConv = TestUtils.createMockConversation({
        workflowName: WorkflowName.AgentSession,
        workflowId: testIds.workflow,
      });

      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(mockConv);

      await expect(
        controller.skipToNode(
          testIds.project,
          testIds.conversation,
          testIds.organization,
          { targetNode: 'generate' },
        ),
      ).rejects.toMatchObject({
        status: 409,
      });

      expect(flowEngineService.getFlow).not.toHaveBeenCalled();
      expect(workflowRouterService.sendSkipToNode).not.toHaveBeenCalled();
    });
  });

  describe('getAvailableSkipNodes endpoint', () => {
    const mockFlowTemplate = {
      id: 'task-generation',
      name: 'Task Generation',
      nodes: {
        generate: {
          nextNode: 'end',
          skipToNode: {
            allowed: true,
            validPreviousNodes: ['conversation'],
          },
        },
      },
    };

    const mockFlowExecution = {
      id: 'exec-123',
      flowId: 'task-generation',
      status: FlowExecutionStatus.STARTED,
      currentNode: 'conversation',
      flowState: flowContextToSerializableState(
        TestUtils.createMockFlowContext(),
        'conversation',
        undefined,
      ),
      resumable: true,
      startedAt: new Date(),
      completedAt: null as Date | null,
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return available skip nodes', async () => {
      // INTENT: Test successful retrieval of available skip-to-able nodes
      const mockConv = TestUtils.createMockConversation({
        workflowName: 'task-generation',
      });

      const mockAvailableNodes = [
        {
          nodeId: 'generate',
          label: 'Generate',
          canSkip: true,
        },
      ];

      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(mockConv);

      jest
        .spyOn(flowEngineService, 'getFlow')
        .mockReturnValue(mockFlowTemplate as any);

      jest
        .spyOn(flowExecutionService, 'findByConversation')
        .mockResolvedValue(mockFlowExecution);

      jest
        .spyOn(workflowExecutionService, 'getAvailableSkipNodes')
        .mockResolvedValue(mockAvailableNodes);

      const result = await controller.getAvailableSkipNodes(
        testIds.project,
        testIds.conversation,
        testIds.organization,
      );

      expect(result).toEqual({ nodes: mockAvailableNodes });

      expect(
        workflowExecutionService.getAvailableSkipNodes,
      ).toHaveBeenCalledWith(
        mockFlowTemplate,
        'conversation',
        expect.any(Object),
        testIds.organization,
      );
    });

    it('should return 404 when conversation not found', async () => {
      // INTENT: Test proper error handling for non-existent conversations
      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(null);

      await expect(
        controller.getAvailableSkipNodes(
          testIds.project,
          testIds.conversation,
          testIds.organization,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return 400 when workflow execution not found', async () => {
      // INTENT: Test proper error handling when workflow state missing
      const mockConv = TestUtils.createMockConversation({
        workflowName: 'task-generation',
      });

      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(mockConv);

      jest
        .spyOn(flowEngineService, 'getFlow')
        .mockReturnValue(mockFlowTemplate as any);

      jest
        .spyOn(flowExecutionService, 'findByConversation')
        .mockResolvedValue(null);

      await expect(
        controller.getAvailableSkipNodes(
          testIds.project,
          testIds.conversation,
          testIds.organization,
        ),
      ).rejects.toThrow('Workflow execution not found');
    });

    it('should return 409 for non-Temporal conversations', async () => {
      const mockConv = TestUtils.createMockConversation({
        workflowName: WorkflowName.AgentSession,
      });

      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(mockConv);

      await expect(
        controller.getAvailableSkipNodes(
          testIds.project,
          testIds.conversation,
          testIds.organization,
        ),
      ).rejects.toMatchObject({
        status: 409,
      });

      expect(flowEngineService.getFlow).not.toHaveBeenCalled();
      expect(
        workflowExecutionService.getAvailableSkipNodes,
      ).not.toHaveBeenCalled();
    });
  });

  describe('startConversation endpoint', () => {
    it('triggers startConversationWorkflow exactly once for NOT_STARTED', async () => {
      const mockConv = TestUtils.createMockConversation({
        status: ConversationStatus.NotStarted,
      });

      const startedConv = TestUtils.createMockConversation({
        status: ConversationStatus.InProgress,
        workflowId: testIds.workflow,
      });

      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(mockConv);

      jest
        .spyOn(conversationWorkflowService, 'startConversationWorkflow')
        .mockResolvedValue({
          conversation: startedConv,
          workflowStarted: true,
          workflowId: testIds.workflow,
        });

      const result = await controller.startConversation(
        testIds.project,
        testIds.conversation,
        testIds.organization,
      );

      expect(
        conversationWorkflowService.startConversationWorkflow,
      ).toHaveBeenCalledTimes(1);
      expect(
        conversationWorkflowService.startConversationWorkflow,
      ).toHaveBeenCalledWith(testIds.conversation, testIds.organization);
      expect(result).toEqual({
        status: ConversationStatus.InProgress,
        started: true,
        workflowId: testIds.workflow,
      });
    });

    it.each([
      ConversationStatus.Started,
      ConversationStatus.InProgress,
      ConversationStatus.GeneratingResponse,
      ConversationStatus.Recoverable,
    ])(
      'returns started=false with no service call when status is %s',
      async (status) => {
        const mockConv = TestUtils.createMockConversation({
          status,
          workflowId: testIds.workflow,
        });

        jest
          .spyOn(conversationService, 'getConversationFromAdapter')
          .mockResolvedValue(mockConv);

        const result = await controller.startConversation(
          testIds.project,
          testIds.conversation,
          testIds.organization,
        );

        expect(
          conversationWorkflowService.startConversationWorkflow,
        ).not.toHaveBeenCalled();
        expect(result).toEqual({
          status,
          started: false,
          workflowId: testIds.workflow,
        });
      },
    );

    it.each([
      ConversationStatus.Completed,
      ConversationStatus.Failed,
      ConversationStatus.Deleted,
    ])('throws 409 HttpException when status is %s', async (status) => {
      const mockConv = TestUtils.createMockConversation({
        status,
      });

      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(mockConv);

      await expect(
        controller.startConversation(
          testIds.project,
          testIds.conversation,
          testIds.organization,
        ),
      ).rejects.toMatchObject({
        status: 409,
      });

      expect(
        conversationWorkflowService.startConversationWorkflow,
      ).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the conversation is missing', async () => {
      jest
        .spyOn(conversationService, 'getConversationFromAdapter')
        .mockResolvedValue(null);

      await expect(
        controller.startConversation(
          testIds.project,
          testIds.conversation,
          testIds.organization,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(
        conversationWorkflowService.startConversationWorkflow,
      ).not.toHaveBeenCalled();
    });
  });
});
