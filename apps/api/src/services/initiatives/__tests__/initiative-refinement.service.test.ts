/* eslint-disable @typescript-eslint/unbound-method */
import { InitiativeRefinementService } from '../initiative-refinement.service';
import { InitiativeService } from '../initiative.service';
import { InitiativeLifecycleService } from '../initiative-lifecycle.service';
import {
  ConversationResponseDto,
  InitiativeSectionUpdateSource,
  InitiativeResponseDto,
} from '../../../generated';
import {
  OrganizationId,
  InitiativeId,
  ProjectId,
  UserId,
  ConversationId,
  WorkflowId,
} from '../../../types';
import { RefinementLevel } from '../../../types/refinable-entity.types';
import {
  InitiativeRefinableEntity,
  toInitiativeRefinableEntity,
} from '../../../types/initiative-refinement-adapter.types';
import * as workItemUtils from '../../../utils/work-item.util';
import * as TestUtils from '../../../utils/testUtils';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';

const { testIds } = TestUtils;

// Mock the utility functions
jest.mock('../../../utils/work-item.util', () => ({
  getCurrentSectionFromStatus: jest.fn(),
  getNextSection: jest.fn(),
}));

describe('InitiativeRefinementService', () => {
  let service: InitiativeRefinementService;
  let mockInitiativeService: jest.Mocked<InitiativeService>;
  let mockInitiativeLifecycleService: jest.Mocked<InitiativeLifecycleService>;

  const testOrgId = testIds.organization;
  const testInitiativeId = testIds.initiative;
  const testProjectId = testIds.project;

  const mockInitiative: InitiativeResponseDto = TestUtils.createMockInitiative({
    id: testInitiativeId,
    name: 'Test Initiative',
    sections: TestUtils.createMockMaterializedWorkItemSections({
      description: 'Test description',
      details: 'Test details',
      acceptanceCriteria: 'Test criteria',
    }),
    status: 'REFINING_DESCRIPTION',
    priority: 'HIGH',
    assigneeId: testIds.user,
    organizationId: testOrgId,
    sourceConversationId: testIds.conversation,
    creatorType: 'USER',
    reasoning: 'Test reasoning',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dueDate: '',
    tags: ['test'],
    originatingProjectId: testProjectId,
    linkedProjectIds: [testProjectId],
  });

  const mockConversation: ConversationResponseDto =
    TestUtils.createMockConversation({
      id: 'conv-456' as ConversationId,
      projectId: testProjectId,
      workflowId: testIds.workflow,
      status: 'STARTED',
      title: 'Initiative Refinement',
      workflowName: 'initiative-refinement',
      initiatedBy: 'SYSTEM',
      triggerEvent: 'refinement_started',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    });

  beforeEach(async () => {
    jest.clearAllMocks();

    mockInitiativeService =
      TestUtils.createMockInitiativeService() as unknown as jest.Mocked<InitiativeService>;

    mockInitiativeLifecycleService =
      TestUtils.createMockInitiativeLifecycleService() as unknown as jest.Mocked<InitiativeLifecycleService>;

    const setup = await createServiceTestingModule({
      providers: [
        InitiativeRefinementService,
        InitiativeService,
        InitiativeLifecycleService,
      ],
      overrides: [
        [InitiativeService, mockInitiativeService],
        [InitiativeLifecycleService, mockInitiativeLifecycleService],
      ],
    });

    service = setup.module.get<InitiativeRefinementService>(
      InitiativeRefinementService,
    );

    mockInitiativeService.findOneForAdapter.mockResolvedValue(mockInitiative);
  });

  describe('getEntityType', () => {
    it('should return initiative entity type', () => {
      // Act
      const entityType = (service as any).getEntityType();

      // Assert
      expect(entityType).toBe('initiative');
    });
  });

  describe('getCurrentLevelFromStatus', () => {
    it('should delegate to utility function', () => {
      // Arrange
      const status = 'REFINING_DETAILS';
      const expectedLevel: RefinementLevel = 'details';
      (workItemUtils.getCurrentSectionFromStatus as jest.Mock).mockReturnValue(
        expectedLevel,
      );

      // Act
      const result = (service as any).getCurrentLevelFromStatus(status);

      // Assert
      expect(result).toBe(expectedLevel);
      expect(workItemUtils.getCurrentSectionFromStatus).toHaveBeenCalledWith(
        status,
      );
    });
  });

  describe('getNextLevel', () => {
    it('should delegate to utility function', () => {
      // Arrange
      const currentLevel: RefinementLevel = 'description';
      const expectedNextLevel: RefinementLevel = 'details';
      (workItemUtils.getNextSection as jest.Mock).mockReturnValue(
        expectedNextLevel,
      );

      // Act
      const result = (service as any).getNextLevel(currentLevel);

      // Assert
      expect(result).toBe(expectedNextLevel);
      expect(workItemUtils.getNextSection).toHaveBeenCalledWith(currentLevel);
    });

    it('should return null for final level', () => {
      // Arrange
      const currentLevel: RefinementLevel = 'acceptanceCriteria';
      (workItemUtils.getNextSection as jest.Mock).mockReturnValue(null);

      // Act
      const result = (service as any).getNextLevel(currentLevel);

      // Assert
      expect(result).toBeNull();
      expect(workItemUtils.getNextSection).toHaveBeenCalledWith(currentLevel);
    });
  });

  describe('findOneForAdapter', () => {
    it('should delegate to InitiativeService', async () => {
      // Arrange
      mockInitiativeService.findOneForAdapter.mockResolvedValue(mockInitiative);

      // Act
      const result = await service.findOneForAdapter(
        testInitiativeId,
        testOrgId,
      );

      // Assert
      expect(result).toMatchObject({
        id: testInitiativeId,
        organizationId: testOrgId,
      });
      expect(mockInitiativeService.findOneForAdapter).toHaveBeenCalledWith(
        testInitiativeId,
        testOrgId,
      );
    });

    it('should return null when initiative not found', async () => {
      // Arrange
      mockInitiativeService.findOneForAdapter.mockResolvedValue(null);

      // Act
      const result = await service.findOneForAdapter('non-existent', testOrgId);

      // Assert
      expect(result).toBeNull();
      expect(mockInitiativeService.findOneForAdapter).toHaveBeenCalledWith(
        'non-existent',
        testOrgId,
      );
    });
  });

  describe('updateForAdapter', () => {
    it('should delegate to InitiativeService with updates', async () => {
      // Arrange
      const updates: Partial<InitiativeRefinableEntity> = {
        description: 'Updated description',
        priority: 'CRITICAL',
      };

      const updatedInitiative = {
        ...mockInitiative,
        sections: TestUtils.createMockMaterializedWorkItemSections({
          description: 'Updated description',
        }),
        priority: updates.priority as any,
      };
      mockInitiativeService.updateForAdapter.mockResolvedValue(
        updatedInitiative,
      );

      // Act
      const result = await service.updateForAdapter(
        testInitiativeId,
        updates,
        testOrgId,
      );

      // Assert
      expect(result).toMatchObject({
        id: testInitiativeId,
        description: updates.description,
        priority: updates.priority,
      });
      expect(mockInitiativeService.updateForAdapter).toHaveBeenCalledWith(
        testInitiativeId,
        {
          priority: updates.priority,
          sectionUpdateSource: InitiativeSectionUpdateSource.AgentSuggested,
          sections: [
            {
              key: 'description',
              content: updates.description,
            },
          ],
        },
        testOrgId,
      );
    });

    it('should throw error when update fails', async () => {
      // Arrange
      const updates = { description: 'Updated description' };
      mockInitiativeService.updateForAdapter.mockRejectedValue(
        new Error('Update failed'),
      );

      // Act & Assert
      await expect(
        service.updateForAdapter(testInitiativeId, updates, testOrgId),
      ).rejects.toThrow('Update failed');
    });
  });

  describe('createRefinementConversation', () => {
    it('should create conversation successfully with existing initiative', async () => {
      // Arrange
      mockInitiativeService.findOneForAdapter.mockResolvedValue(mockInitiative);
      mockInitiativeLifecycleService.createRefinementConversation.mockResolvedValue(
        {
          conversation: mockConversation,
          initiatives: [],
        },
      );

      // Act
      const result = await service.createRefinementConversation(
        testInitiativeId,
        'initiative',
        testOrgId,
        testProjectId,
      );

      // Assert
      expect(result.conversation).toEqual(mockConversation);
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0]).toMatchObject({
        id: testInitiativeId,
        organizationId: testOrgId,
      });
      expect(mockInitiativeService.findOneForAdapter).toHaveBeenCalledWith(
        testInitiativeId,
        testOrgId,
      );
      expect(
        mockInitiativeLifecycleService.createRefinementConversation,
      ).toHaveBeenCalledWith(
        testInitiativeId,
        testOrgId,
        testProjectId,
        undefined,
      );
    });

    it('should return initiative even when lifecycle service returns no initiatives', async () => {
      // Arrange
      mockInitiativeService.findOneForAdapter.mockResolvedValue(mockInitiative);
      mockInitiativeLifecycleService.createRefinementConversation.mockResolvedValue(
        {
          conversation: mockConversation,
          initiatives: [], // Lifecycle service might return null
        },
      );

      // Act
      const result = await service.createRefinementConversation(
        testInitiativeId,
        'initiative',
        testOrgId,
        testProjectId,
      );

      // Assert
      expect(result.conversation).toEqual(mockConversation);
      expect(result.entities).toHaveLength(1);
      expect(result.entities?.[0]).toMatchObject({
        id: testInitiativeId,
      });
    });

    it('should throw error when initiative not found', async () => {
      // Arrange
      mockInitiativeService.findOneForAdapter.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.createRefinementConversation(
          'non-existent',
          'initiative',
          testOrgId,
          testProjectId,
        ),
      ).rejects.toThrow(
        `Initiative non-existent not found in organization ${testOrgId}`,
      );

      expect(
        mockInitiativeLifecycleService.createRefinementConversation,
      ).not.toHaveBeenCalled();
    });

    it('should throw error when project ID is not provided', async () => {
      // Arrange
      mockInitiativeService.findOneForAdapter.mockResolvedValue(mockInitiative);

      // Act & Assert
      await expect(
        service.createRefinementConversation(
          testInitiativeId,
          'initiative',
          testOrgId,
        ),
      ).rejects.toThrow(
        'Project ID is required for initiative refinement conversations',
      );

      expect(
        mockInitiativeLifecycleService.createRefinementConversation,
      ).not.toHaveBeenCalled();
    });

    it('should throw error when lifecycle service fails', async () => {
      // Arrange
      mockInitiativeService.findOneForAdapter.mockResolvedValue(mockInitiative);
      mockInitiativeLifecycleService.createRefinementConversation.mockRejectedValue(
        new Error('Conversation creation failed'),
      );

      // Act & Assert
      await expect(
        service.createRefinementConversation(
          testInitiativeId,
          'initiative',
          testOrgId,
          testProjectId,
        ),
      ).rejects.toThrow('Conversation creation failed');
    });
  });

  describe('getActiveRefinementConversation', () => {
    it('should delegate to InitiativeService', async () => {
      // Arrange
      const conversationId = 'active-conv-123';
      mockInitiativeService.getActiveRefinementConversation.mockResolvedValue(
        conversationId,
      );

      // Act
      const result = await service.getActiveRefinementConversation(
        testInitiativeId,
        testOrgId,
      );

      // Assert
      expect(result).toBe(conversationId);
      expect(
        mockInitiativeService.getActiveRefinementConversation,
      ).toHaveBeenCalledWith(testInitiativeId, testOrgId);
    });

    it('should return null when no active conversation exists', async () => {
      // Arrange
      mockInitiativeService.getActiveRefinementConversation.mockResolvedValue(
        null,
      );

      // Act
      const result = await service.getActiveRefinementConversation(
        testInitiativeId,
        testOrgId,
      );

      // Assert
      expect(result).toBeNull();
    });

    it('should handle errors from InitiativeService', async () => {
      // Arrange
      mockInitiativeService.getActiveRefinementConversation.mockRejectedValue(
        new Error('Database error'),
      );

      // Act & Assert
      await expect(
        service.getActiveRefinementConversation(testInitiativeId, testOrgId),
      ).rejects.toThrow('Database error');
    });
  });

  describe('integration with base class methods', () => {
    beforeEach(() => {
      // Setup common mocks for base class functionality
      mockInitiativeService.findOneForAdapter.mockResolvedValue(mockInitiative);
      (workItemUtils.getCurrentSectionFromStatus as jest.Mock).mockReturnValue(
        'description',
      );
    });

    it('should work with base class findOne method', async () => {
      // Act
      const result = await service.findOne(testInitiativeId, testOrgId);

      // Assert
      expect(result).toMatchObject({
        id: testInitiativeId,
        organizationId: testOrgId,
      });
      expect(mockInitiativeService.findOneForAdapter).toHaveBeenCalledWith(
        testInitiativeId,
        testOrgId,
      );
    });

    it('should work with base class update method', async () => {
      // Arrange
      const updates = { description: 'New description' };
      const updatedInitiative = {
        ...mockInitiative,
        sections: TestUtils.createMockMaterializedWorkItemSections({
          description: updates.description,
        }),
      };
      mockInitiativeService.updateForAdapter.mockResolvedValue(
        updatedInitiative,
      );

      // Act
      const result = await service.update(testInitiativeId, updates, testOrgId);

      // Assert
      expect(result).toMatchObject({
        id: testInitiativeId,
        description: updates.description,
      });
      expect(mockInitiativeService.updateForAdapter).toHaveBeenCalledWith(
        testInitiativeId,
        {
          sectionUpdateSource: InitiativeSectionUpdateSource.AgentSuggested,
          sections: [
            {
              key: 'description',
              content: updates.description,
            },
          ],
        },
        testOrgId,
      );
    });

    it('should work with base class getCurrentRefinementLevel method', () => {
      // Arrange
      (workItemUtils.getCurrentSectionFromStatus as jest.Mock).mockReturnValue(
        'details',
      );

      // Act
      const level = service.getCurrentRefinementLevel(
        toInitiativeRefinableEntity(mockInitiative),
      );

      // Assert
      expect(level).toBe('details');
      expect(workItemUtils.getCurrentSectionFromStatus).toHaveBeenCalledWith(
        mockInitiative.status,
      );
    });

    it('should work with base class getNextRefinementLevel method', () => {
      // Arrange
      (workItemUtils.getCurrentSectionFromStatus as jest.Mock).mockReturnValue(
        'description',
      );
      (workItemUtils.getNextSection as jest.Mock).mockReturnValue('details');

      // Act
      const nextLevel = service.getNextRefinementLevel(
        toInitiativeRefinableEntity(mockInitiative),
      );

      // Assert
      expect(nextLevel).toBe('details');
      expect(workItemUtils.getCurrentSectionFromStatus).toHaveBeenCalledWith(
        mockInitiative.status,
      );
      expect(workItemUtils.getNextSection).toHaveBeenCalledWith('description');
    });

    it('should work with base class canAdvanceToNextLevel method', () => {
      // Arrange - entity with valid description
      const entityWithContent = {
        ...toInitiativeRefinableEntity(mockInitiative),
        description: 'Valid description content',
      };

      // Act
      const canAdvance = service.canAdvanceToNextLevel(
        entityWithContent,
        'description',
      );

      // Assert
      expect(canAdvance).toBe(true);
    });

    it('should work with base class createRefinementSession method', async () => {
      // Arrange
      mockInitiativeLifecycleService.createRefinementConversation.mockResolvedValue(
        {
          conversation: mockConversation,
          initiatives: [],
        },
      );

      // Act
      const session = await service.createRefinementSession(
        testInitiativeId,
        'initiative',
        testOrgId,
        testProjectId,
      );

      // Assert
      expect(session.conversationId).toBe(mockConversation.id);
      expect(session.workflowId).toBe(mockConversation.workflowId);
      expect(session.entitySnapshot).toMatchObject({
        id: testInitiativeId,
      });
      expect(session.sessionMetadata.entityType).toBe('initiative');
      expect(session.sessionMetadata.entityId).toBe(testInitiativeId);
      expect(session.sessionMetadata.organizationId).toBe(testOrgId);
      expect(session.sessionMetadata.projectId).toBe(testProjectId);
    });
  });

  describe('error handling and logging', () => {
    it('should handle service errors gracefully', async () => {
      // Arrange
      mockInitiativeService.findOneForAdapter.mockRejectedValue(
        new Error('Database connection lost'),
      );

      // Act & Assert
      await expect(
        service.findOne(testInitiativeId, testOrgId),
      ).rejects.toThrow(
        `Failed to find initiative ${testInitiativeId}: Database connection lost`,
      );
    });

    it('should log refinement conversation creation', async () => {
      // Arrange
      mockInitiativeService.findOneForAdapter.mockResolvedValue(mockInitiative);
      mockInitiativeLifecycleService.createRefinementConversation.mockResolvedValue(
        {
          conversation: mockConversation,
          initiatives: [],
        },
      );

      // Spy on logger
      const loggerSpy = jest.spyOn((service as any).logger, 'log');

      // Act
      await service.createRefinementConversation(
        testInitiativeId,
        'initiative',
        testOrgId,
        testProjectId,
      );

      // Assert
      expect(loggerSpy).toHaveBeenCalledWith(
        `Creating refinement conversation for initiative ${testInitiativeId}`,
        {
          entityId: testInitiativeId,
          organizationId: testOrgId,
          projectId: testProjectId,
        },
      );
    });
  });
});
