import { OrganizationGuard } from '../../auth/guards/organization.guard';
import { ProjectAccessGuard } from '../../auth/guards/project-access.guard';
/* eslint-disable @typescript-eslint/unbound-method */
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Client } from '@temporalio/client';
import { MessageController } from '../message.controller';
import { MessageService } from '../../services/message.service';
import { ConversationService } from '../../services/conversation.service';
import { FlowExecutionService } from '../../services/workflows/flow-execution.service';
import { WorkflowTypeRegistryService } from '../../services/workflows/workflow-type-registry.service';
import { WorkflowSignalHelper } from '../../utils/workflow-signals.helper';
import { TEMPORAL_CLIENT } from '../../prisma/temporal.module';
import { ExecutionGrantService } from '../../services/controller-authorization/execution-grant.service';
import {
  MessageResponseDto,
  ConversationResponseDto,
  MessageRetryResponse,
  WorkflowName,
} from '../../generated';
import {
  ConversationId,
  OrganizationId,
  ProjectId,
  WorkflowId,
} from '../../types';
import * as TestUtils from '../../utils/testUtils';

// Mock WorkflowSignalHelper
jest.mock('../../utils/workflow-signals.helper');
const MockedWorkflowSignalHelper = WorkflowSignalHelper as jest.Mocked<
  typeof WorkflowSignalHelper
>;

describe('MessageController - Retry Endpoint', () => {
  let controller: MessageController;
  let messageService: jest.Mocked<MessageService>;
  let conversationService: jest.Mocked<ConversationService>;
  let temporalClient: jest.Mocked<Client>;
  let mockWorkflowHandle: any;

  const { testIds } = TestUtils;

  beforeEach(async () => {
    // Create mock workflow handle
    mockWorkflowHandle = {
      describe: jest.fn(),
      signal: jest.fn(),
      query: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MessageController],
      providers: [
        {
          provide: MessageService,
          useValue: TestUtils.createMockMessageService(),
        },
        {
          provide: ConversationService,
          useValue: TestUtils.createMockConversationService(),
        },
        {
          provide: FlowExecutionService,
          useValue: {
            findPausedByConversation: jest.fn().mockResolvedValue(null),
            resolveConversationPromptType: jest.fn().mockResolvedValue({
              promptType: null,
              nodeId: null,
              triggerMessageId: null,
            }),
          },
        },
        {
          provide: WorkflowTypeRegistryService,
          useValue: {
            isNonTemporalBackedWorkflow: jest.fn().mockReturnValue(false),
          },
        },
        {
          provide: TEMPORAL_CLIENT,
          useValue: {
            workflow: {
              getHandle: jest.fn().mockReturnValue(mockWorkflowHandle),
            },
          },
        },
        {
          provide: ExecutionGrantService,
          useValue: {
            assertInteractiveAuthorized: jest.fn(),
            deriveInteractiveGrant: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(OrganizationGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ProjectAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<MessageController>(MessageController);
    messageService = module.get<MessageService>(
      MessageService,
    ) as jest.Mocked<MessageService>;
    conversationService = module.get<ConversationService>(
      ConversationService,
    ) as jest.Mocked<ConversationService>;
    temporalClient = module.get<Client>(TEMPORAL_CLIENT) as jest.Mocked<Client>;

    // Reset all mocks
    jest.clearAllMocks();
    MockedWorkflowSignalHelper.sendReplayNode.mockClear();
  });

  describe('Happy Path Tests', () => {
    it('should successfully retry a message workflow', async () => {
      // Arrange
      const messageId = testIds.message;
      const organizationId = testIds.organization;
      const conversationId = testIds.conversation;
      const projectId = testIds.project;
      const workflowId = testIds.workflow;

      const mockMessage: MessageResponseDto = TestUtils.createMockMessage({
        conversationId: conversationId as string,
      });

      const mockConversation: ConversationResponseDto =
        TestUtils.createMockConversation({
          id: conversationId,
          projectId: projectId,
          workflowId: workflowId,
        });

      const mockWorkflowDescription = {
        status: { name: 'RUNNING' },
        workflowId,
      };

      // Setup mocks
      messageService.getMessageForAdapter.mockResolvedValue(mockMessage);
      conversationService.findOne.mockResolvedValue(mockConversation);
      mockWorkflowHandle.describe.mockResolvedValue(mockWorkflowDescription);
      mockWorkflowHandle.query.mockResolvedValue({
        currentNodeId: 'test-node',
      });
      MockedWorkflowSignalHelper.sendReplayNode.mockResolvedValue(undefined);

      // Act
      const result = await controller.retryMessage(organizationId, messageId);

      // Assert
      expect(result).toMatchObject({
        success: true,
        message: 'Message deleted and node replayed',
        data: {
          status: MessageRetryResponse.StatusEnum.RetryInitiated,
          message:
            'The failed message was deleted and node replay initiated for: test-node',
        },
        timestamp: expect.any(String),
        statusCode: 200,
        path: `/organizations/${organizationId}/projects/${projectId}/messages/${messageId}/retry`,
      });

      // Verify service calls
      expect(messageService.getMessageForAdapter).toHaveBeenCalledWith(
        messageId,
        organizationId,
        false,
      );
      expect(conversationService.findOne).toHaveBeenCalledWith(
        conversationId,
        organizationId,
      );
      expect(temporalClient.workflow.getHandle).toHaveBeenCalledWith(
        workflowId,
      );
      expect(mockWorkflowHandle.describe).toHaveBeenCalled();
      expect(MockedWorkflowSignalHelper.sendReplayNode).toHaveBeenCalledWith(
        mockWorkflowHandle,
        workflowId,
      );
    });

    it('should handle workflow in different valid statuses', async () => {
      // Test that other valid workflow states work too
      const messageId = testIds.message;
      const organizationId = testIds.organization;
      const workflowId = testIds.workflow;

      const mockMessage = TestUtils.createMockMessage();
      const mockConversation = TestUtils.createMockConversation({
        workflowId: workflowId,
      });

      const mockWorkflowDescription = {
        status: { name: 'RUNNING' },
        workflowId,
      };

      messageService.getMessageForAdapter.mockResolvedValue(mockMessage);
      conversationService.findOne.mockResolvedValue(mockConversation);
      mockWorkflowHandle.describe.mockResolvedValue(mockWorkflowDescription);
      mockWorkflowHandle.query.mockResolvedValue({
        currentNodeId: 'test-node',
      });
      MockedWorkflowSignalHelper.sendReplayNode.mockResolvedValue(undefined);

      const result = await controller.retryMessage(organizationId, messageId);

      expect(result.success).toBe(true);
      expect(MockedWorkflowSignalHelper.sendReplayNode).toHaveBeenCalledWith(
        mockWorkflowHandle,
        workflowId,
      );
    });
  });

  describe('Failing Path Tests', () => {
    describe('Message Not Found', () => {
      it('should throw NotFoundException when message does not exist', async () => {
        // Arrange
        const messageId = testIds.message;
        const organizationId = testIds.organization;

        messageService.getMessageForAdapter.mockResolvedValue(null);

        // Act & Assert
        await expect(
          controller.retryMessage(organizationId, messageId),
        ).rejects.toThrow(NotFoundException);
        await expect(
          controller.retryMessage(organizationId, messageId),
        ).rejects.toThrow('Message not found');

        expect(messageService.getMessageForAdapter).toHaveBeenCalledWith(
          messageId,
          organizationId,
          false,
        );
        expect(conversationService.findOne).not.toHaveBeenCalled();
      });
    });

    describe('Conversation Issues', () => {
      it('should throw BadRequestException when conversation does not exist', async () => {
        // Arrange
        const messageId = testIds.message;
        const organizationId = testIds.organization;
        const conversationId = testIds.conversation;

        const mockMessage = TestUtils.createMockMessage({
          conversationId: conversationId as string,
        });

        messageService.getMessageForAdapter.mockResolvedValue(mockMessage);
        conversationService.findOne.mockResolvedValue(null);

        // Act & Assert
        await expect(
          controller.retryMessage(organizationId, messageId),
        ).rejects.toThrow(BadRequestException);
        await expect(
          controller.retryMessage(organizationId, messageId),
        ).rejects.toThrow('Conversation not found for this message');

        expect(conversationService.findOne).toHaveBeenCalledWith(
          conversationId,
          organizationId,
        );
        expect(temporalClient.workflow.getHandle).not.toHaveBeenCalled();
      });

      it('should throw BadRequestException when conversation has no workflowId', async () => {
        // Arrange
        const messageId = testIds.message;
        const organizationId = testIds.organization;
        const conversationId = testIds.conversation;

        const mockMessage = TestUtils.createMockMessage({
          conversationId: conversationId as string,
        });
        const mockConversation = TestUtils.createMockConversation({
          workflowId: undefined, // No workflow ID
        });

        messageService.getMessageForAdapter.mockResolvedValue(mockMessage);
        conversationService.findOne.mockResolvedValue(mockConversation);

        // Act & Assert
        await expect(
          controller.retryMessage(organizationId, messageId),
        ).rejects.toThrow(BadRequestException);
        await expect(
          controller.retryMessage(organizationId, messageId),
        ).rejects.toThrow('No workflow associated with this conversation');

        expect(temporalClient.workflow.getHandle).not.toHaveBeenCalled();
      });

      it('should throw BadRequestException for non-Temporal conversations', async () => {
        const messageId = testIds.message;
        const organizationId = testIds.organization;
        const conversationId = testIds.conversation;

        const mockMessage = TestUtils.createMockMessage({
          conversationId: conversationId as string,
        });
        const mockConversation = TestUtils.createMockConversation({
          workflowName: WorkflowName.AgentSession,
          workflowId: testIds.workflow,
        });

        messageService.getMessageForAdapter.mockResolvedValue(mockMessage);
        conversationService.findOne.mockResolvedValue(mockConversation);

        await expect(
          controller.retryMessage(organizationId, messageId),
        ).rejects.toThrow(BadRequestException);
        await expect(
          controller.retryMessage(organizationId, messageId),
        ).rejects.toThrow(
          'Retry is not supported for non-Temporal conversations',
        );

        expect(temporalClient.workflow.getHandle).not.toHaveBeenCalled();
      });
    });

    describe('Workflow Issues', () => {
      it('should throw BadRequestException when workflow is not running', async () => {
        // Arrange
        const messageId = testIds.message;
        const organizationId = testIds.organization;
        const workflowId = testIds.workflow;

        const mockMessage = TestUtils.createMockMessage();
        const mockConversation = TestUtils.createMockConversation({
          workflowId: workflowId,
        });

        const mockWorkflowDescription = {
          status: { name: 'COMPLETED' }, // Not running
          workflowId,
        };

        messageService.getMessageForAdapter.mockResolvedValue(mockMessage);
        conversationService.findOne.mockResolvedValue(mockConversation);
        mockWorkflowHandle.describe.mockResolvedValue(mockWorkflowDescription);

        // Act & Assert
        await expect(
          controller.retryMessage(organizationId, messageId),
        ).rejects.toThrow(BadRequestException);
        await expect(
          controller.retryMessage(organizationId, messageId),
        ).rejects.toThrow('Workflow is not running (status: COMPLETED)');

        expect(
          MockedWorkflowSignalHelper.sendReplayNode,
        ).not.toHaveBeenCalled();
      });

      it('should throw InternalServerErrorException when workflow describe fails', async () => {
        // Arrange
        const messageId = testIds.message;
        const organizationId = testIds.organization;
        const workflowId = testIds.workflow;

        const mockMessage = TestUtils.createMockMessage();
        const mockConversation = TestUtils.createMockConversation({
          workflowId: workflowId,
        });

        messageService.getMessageForAdapter.mockResolvedValue(mockMessage);
        conversationService.findOne.mockResolvedValue(mockConversation);
        mockWorkflowHandle.describe.mockRejectedValue(
          new Error('Workflow not found'),
        );

        // Act & Assert
        await expect(
          controller.retryMessage(organizationId, messageId),
        ).rejects.toThrow(InternalServerErrorException);
        await expect(
          controller.retryMessage(organizationId, messageId),
        ).rejects.toThrow('Failed to retry workflow: Workflow not found');

        expect(
          MockedWorkflowSignalHelper.sendReplayNode,
        ).not.toHaveBeenCalled();
      });

      it('should throw InternalServerErrorException when signal sending fails', async () => {
        // Arrange
        const messageId = testIds.message;
        const organizationId = testIds.organization;
        const workflowId = testIds.workflow;

        const mockMessage = TestUtils.createMockMessage();
        const mockConversation = TestUtils.createMockConversation({
          workflowId: workflowId,
        });

        const mockWorkflowDescription = {
          status: { name: 'RUNNING' },
          workflowId,
        };

        messageService.getMessageForAdapter.mockResolvedValue(mockMessage);
        conversationService.findOne.mockResolvedValue(mockConversation);
        mockWorkflowHandle.describe.mockResolvedValue(mockWorkflowDescription);
        mockWorkflowHandle.query.mockResolvedValue({
          currentNodeId: 'test-node',
        });
        MockedWorkflowSignalHelper.sendReplayNode.mockRejectedValue(
          new Error('Signal delivery failed'),
        );

        // Act & Assert
        await expect(
          controller.retryMessage(organizationId, messageId),
        ).rejects.toThrow(InternalServerErrorException);
        await expect(
          controller.retryMessage(organizationId, messageId),
        ).rejects.toThrow('Failed to retry workflow: Signal delivery failed');

        expect(MockedWorkflowSignalHelper.sendReplayNode).toHaveBeenCalledWith(
          mockWorkflowHandle,
          workflowId,
        );
      });
    });

    describe('Edge Cases', () => {
      it('should preserve BadRequestException when thrown from signal helper', async () => {
        // Arrange
        const messageId = testIds.message;
        const organizationId = testIds.organization;
        const workflowId = testIds.workflow;

        const mockMessage = TestUtils.createMockMessage();
        const mockConversation = TestUtils.createMockConversation({
          workflowId: workflowId,
        });

        const mockWorkflowDescription = {
          status: { name: 'RUNNING' },
          workflowId,
        };

        messageService.getMessageForAdapter.mockResolvedValue(mockMessage);
        conversationService.findOne.mockResolvedValue(mockConversation);
        mockWorkflowHandle.describe.mockResolvedValue(mockWorkflowDescription);
        mockWorkflowHandle.query.mockResolvedValue({
          currentNodeId: 'test-node',
        });
        MockedWorkflowSignalHelper.sendReplayNode.mockRejectedValue(
          new BadRequestException('Invalid recovery node'),
        );

        // Act & Assert
        await expect(
          controller.retryMessage(organizationId, messageId),
        ).rejects.toThrow(BadRequestException);
        await expect(
          controller.retryMessage(organizationId, messageId),
        ).rejects.toThrow('Invalid recovery node');
      });

      it('should handle unknown error types gracefully', async () => {
        // Arrange
        const messageId = testIds.message;
        const organizationId = testIds.organization;
        const workflowId = testIds.workflow;

        const mockMessage = TestUtils.createMockMessage();
        const mockConversation = TestUtils.createMockConversation({
          workflowId: workflowId,
        });

        const mockWorkflowDescription = {
          status: { name: 'RUNNING' },
          workflowId,
        };

        messageService.getMessageForAdapter.mockResolvedValue(mockMessage);
        conversationService.findOne.mockResolvedValue(mockConversation);
        mockWorkflowHandle.describe.mockResolvedValue(mockWorkflowDescription);
        mockWorkflowHandle.query.mockResolvedValue({
          currentNodeId: 'test-node',
        });
        MockedWorkflowSignalHelper.sendReplayNode.mockRejectedValue(
          'Unknown error',
        );

        // Act & Assert
        await expect(
          controller.retryMessage(organizationId, messageId),
        ).rejects.toThrow(InternalServerErrorException);
        await expect(
          controller.retryMessage(organizationId, messageId),
        ).rejects.toThrow('Failed to retry workflow: Unknown error');
      });
    });
  });

  describe('Integration Tests', () => {
    it('should properly format response path with all IDs', async () => {
      // Arrange
      const messageId = 'msg-123';
      const organizationId = 'org-456' as OrganizationId;
      const conversationId = 'conv-789' as ConversationId;
      const projectId = 'proj-101' as ProjectId;
      const workflowId = 'wf-202' as WorkflowId;

      const mockMessage = TestUtils.createMockMessage({
        conversationId: conversationId as string,
      });
      const mockConversation = TestUtils.createMockConversation({
        id: conversationId,
        projectId: projectId,
        workflowId: workflowId,
      });

      messageService.getMessageForAdapter.mockResolvedValue(mockMessage);
      conversationService.findOne.mockResolvedValue(mockConversation);
      mockWorkflowHandle.describe.mockResolvedValue({
        status: { name: 'RUNNING' },
        workflowId,
      });
      mockWorkflowHandle.query.mockResolvedValue({
        currentNodeId: 'test-node',
      });
      MockedWorkflowSignalHelper.sendReplayNode.mockResolvedValue(undefined);

      // Act
      const result = await controller.retryMessage(organizationId, messageId);

      // Assert
      expect(result.path).toBe(
        `/organizations/${organizationId}/projects/${projectId}/messages/${messageId}/retry`,
      );
      expect(result.data?.status).toBe(
        MessageRetryResponse.StatusEnum.RetryInitiated,
      );
      expect(result.statusCode).toBe(200);
      expect(result.success).toBe(true);
      expect(new Date(result.timestamp)).toBeInstanceOf(Date);
    });
  });
});
