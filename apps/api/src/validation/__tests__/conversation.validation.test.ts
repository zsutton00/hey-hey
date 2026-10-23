import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ConversationValidation } from '../conversation.validation';
import { ConversationService } from '../../services/conversation.service';
import { ConversationId, ProjectId } from '../../types';
import { ConversationResponseDto } from 'src/generated';

describe('ConversationValidation', () => {
  let validation: ConversationValidation;

  const mockProjectId = 'proj-123' as ProjectId;
  const mockConversationId = 'conv-123' as ConversationId;
  const mockOtherProjectId = 'proj-456' as ProjectId;

  const mockConversation = {
    id: mockConversationId,
    projectId: mockProjectId,
    workflowId: 'wf-123',
    interactionTypeId: 'int-123',
    initiatedBy: 'USER',
    triggerEvent: 'test_event',
    status: 'Started',
    title: 'Test Conversation',
    category: 'test',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    messages: [],
  } as unknown as ConversationResponseDto;

  beforeEach(async () => {
    const mockConversationService = {
      getConversation: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationValidation,
        {
          provide: ConversationService,
          useValue: mockConversationService,
        },
      ],
    }).compile();

    validation = module.get<ConversationValidation>(ConversationValidation);
  });

  describe('validateConversationBelongsToProject', () => {
    it('should pass validation when conversation belongs to project', () => {
      expect(() =>
        validation.validateConversationBelongsToProject(
          mockConversation,
          mockProjectId,
        ),
      ).not.toThrow();

      // The validation method doesn't call getConversation, it just validates the passed conversation
    });

    it('should throw NotFoundException when conversation does not exist', () => {
      expect(() =>
        validation.validateConversationBelongsToProject(null, mockProjectId),
      ).toThrow(NotFoundException);

      expect(() =>
        validation.validateConversationBelongsToProject(null, mockProjectId),
      ).toThrow('Conversation not found');
    });

    it('should throw BadRequestException when conversation belongs to different project', () => {
      const conversationFromDifferentProject = {
        ...mockConversation,
        projectId: mockOtherProjectId,
      } as unknown as ConversationResponseDto;

      expect(() =>
        validation.validateConversationBelongsToProject(
          conversationFromDifferentProject,
          mockProjectId,
        ),
      ).toThrow(BadRequestException);

      expect(() =>
        validation.validateConversationBelongsToProject(
          conversationFromDifferentProject,
          mockProjectId,
        ),
      ).toThrow('Conversation does not belong to the specified project');
    });
  });

  describe('validateProjectIdConsistency', () => {
    it('should pass validation when DTO projectId is undefined', () => {
      expect(() =>
        validation.validateProjectIdConsistency(undefined, mockProjectId),
      ).not.toThrow();
    });

    it('should pass validation when DTO projectId matches route projectId', () => {
      expect(() =>
        validation.validateProjectIdConsistency(mockProjectId, mockProjectId),
      ).not.toThrow();
    });

    it('should throw BadRequestException when DTO projectId differs from route projectId', () => {
      expect(() =>
        validation.validateProjectIdConsistency(
          mockOtherProjectId,
          mockProjectId,
        ),
      ).toThrow(BadRequestException);

      expect(() =>
        validation.validateProjectIdConsistency(
          mockOtherProjectId,
          mockProjectId,
        ),
      ).toThrow('Project ID in request body must match the route parameter');
    });
  });
});
