/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { CreateSuggestedDesignDocNode } from '../create-suggested-design-doc.node';
import { DesignDocService } from '../../../../services/design-doc/design-doc.service';
import { ConversationService } from '../../../../services/conversation.service';
import { MessageService } from '../../../../services/message.service';
import * as TestUtils from '../../../../utils/testUtils';
import { MutableContext } from '../../../../utils/mutable-context';
import {
  IntermediateSystemMessageData,
  SuggestedDesignDocFlowContext,
} from '../../../../types/flow-internal.types';
import { DesignDocResponseDto, DesignDocTemplate } from '../../../../generated';

describe('CreateSuggestedDesignDocNode', () => {
  let node: CreateSuggestedDesignDocNode;
  let designDocService: jest.Mocked<DesignDocService>;
  let conversationService: jest.Mocked<ConversationService>;
  let messageService: jest.Mocked<MessageService>;

  const buildDesignDocResponse = (
    overrides: Partial<DesignDocResponseDto> = {},
  ): DesignDocResponseDto => ({
    id: 'new-doc-id',
    name: 'Test Design Doc',
    template: 'ADR',
    status: 'DRAFT',
    organizationId: TestUtils.testIds.organization,
    projectId: TestUtils.testIds.project,
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sections: [
      {
        key: 'context',
        materializedMarkdown: 'Context content',
        id: 'id',
        order: 1,
      },
    ],
    ...overrides,
  });

  const buildContext = (
    template: DesignDocTemplate = 'ADR',
  ): SuggestedDesignDocFlowContext => {
    const baseContext = TestUtils.createMockFlowContext();
    return {
      ...baseContext,
      core: {
        ...baseContext.core,
        organizationId: TestUtils.testIds.organization,
        projectId: TestUtils.testIds.project,
        conversationId: TestUtils.testIds.conversation,
        workflowAboutType: 'design-doc',
        workflowAboutId: 'temp-id',
      },
      designDocName: 'Test Design Doc',
      template,
      sourceConversationId: TestUtils.testIds.conversation,
      sourceMessageId: TestUtils.testIds.message,
    };
  };

  beforeEach(async () => {
    const mockDesignDocService = TestUtils.createMockDesignDocService();
    mockDesignDocService.createLinksForAdapter = jest.fn();

    const mockMessageService = TestUtils.createMockMessageService();
    mockMessageService.getContextWindowForMessage = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateSuggestedDesignDocNode,
        {
          provide: DesignDocService,
          useValue: mockDesignDocService,
        },
        {
          provide: ConversationService,
          useValue: TestUtils.createMockConversationService(),
        },
        {
          provide: MessageService,
          useValue: mockMessageService,
        },
      ],
    }).compile();

    node = module.get<CreateSuggestedDesignDocNode>(
      CreateSuggestedDesignDocNode,
    );
    designDocService = module.get(DesignDocService);
    conversationService = module.get(ConversationService);
    messageService = module.get(MessageService);
  });

  describe('beforeGeneration', () => {
    it('should gather conversation context and populate metadata', async () => {
      // Arrange
      const context = buildContext();
      const tracker = new MutableContext<SuggestedDesignDocFlowContext>(
        context,
      );

      // Mock dependencies
      (conversationService.getConversation as jest.Mock).mockResolvedValue({
        id: context.sourceConversationId,
        projectId: context.core.projectId,
      });

      const mockMessage = {
        id: context.sourceMessageId,
        conversationId: context.sourceConversationId,
        type: 'USER',
        data: { content: 'Make a design doc about this' },
      };
      (messageService.getMessageForAdapter as jest.Mock).mockResolvedValue(
        mockMessage,
      );

      const mockContextWindow = [
        {
          type: 'USER',
          data: { content: 'Previous message' },
        },
        mockMessage,
      ];
      (
        messageService.getContextWindowForMessage as jest.Mock
      ).mockResolvedValue(mockContextWindow);

      // Act
      await node.beforeGeneration(tracker, undefined);

      // Assert
      const updatedContext = tracker.getContext();
      expect(updatedContext.metadata).toBeDefined();
      expect(updatedContext.metadata?.selectedMessageContent).toBe(
        'Make a design doc about this',
      );
      expect(updatedContext.metadata?.conversationContext).toContain(
        'USER: Previous message',
      );
      expect(updatedContext.metadata?.conversationContext).toContain(
        'USER: Make a design doc about this',
      );
    });
  });

  describe('processLlmResponse', () => {
    it('should create design doc from LLM response', async () => {
      // Arrange
      const mockDesignDoc = buildDesignDocResponse();

      (designDocService.createForAdapter as jest.Mock).mockResolvedValue(
        mockDesignDoc,
      );

      const systemMessageData = {
        designDoc: {
          summary: 'A test doc',
          sections: [
            { key: 'context', content: 'Context content', order: 0 },
            { key: 'decision', content: 'Decision content', order: 1 },
          ],
        },
        response: 'Created doc successfully',
      };

      const context = buildContext();
      const tracker = new MutableContext<SuggestedDesignDocFlowContext>(
        context,
      );

      // Act
      const result = await node.processLlmResponse(
        systemMessageData as unknown as IntermediateSystemMessageData,
        undefined,
        tracker,
      );

      // Assert
      expect(designDocService.createForAdapter).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Design Doc',
          template: 'ADR',
          summary: 'A test doc',
          sections: [
            { key: 'context', content: 'Context content', order: 0 },
            { key: 'decision', content: 'Decision content', order: 1 },
          ],
        }),
        context.core.organizationId,
      );

      expect(result.modifiedResult).toBeDefined();
      expect(result.modifiedResult?.type).toBe('ANALYSIS');

      const modifiedData = result.modifiedResult as unknown as {
        generatedDesignDocId: string;
      };
      expect(modifiedData.generatedDesignDocId).toBe('new-doc-id');
    });
    it('passes the parent task into createForAdapter when context has a taskId', async () => {
      // Arrange
      const mockDesignDoc = buildDesignDocResponse({
        id: 'new-doc-id',
        template: 'ADR',
      });
      (designDocService.createForAdapter as jest.Mock).mockResolvedValue(
        mockDesignDoc,
      );

      const systemMessageData = {
        designDoc: {
          sections: [{ key: 'content', content: 'test', order: 0 }],
        },
        response: 'ok',
      };

      const context = buildContext();
      const tracker = new MutableContext<SuggestedDesignDocFlowContext>({
        ...context,
        taskId: TestUtils.testIds.task,
      });

      // Act
      await node.processLlmResponse(
        systemMessageData as unknown as IntermediateSystemMessageData,
        undefined,
        tracker,
      );

      // Assert
      expect(designDocService.createForAdapter).toHaveBeenCalledWith(
        expect.objectContaining({
          parentEntityId: TestUtils.testIds.task,
          parentEntityType: 'TASK',
        }),
        context.core.organizationId,
      );
    });
  });
});
