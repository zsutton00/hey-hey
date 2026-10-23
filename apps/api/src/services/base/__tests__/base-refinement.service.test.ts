import { Logger } from '@nestjs/common';
import {
  BaseRefinementService,
  WorkItemRefinementService,
} from '../base-refinement.service';
import { ConversationResponseDto } from '../../../generated';
import {
  RefinableEntity,
  EntityType,
  RefinementLevel,
  RefinementSession,
  ContentUpdates,
  RefinementContext,
} from '../../../types/refinable-entity.types';
import {
  OrganizationId,
  ConversationId,
  ProjectId,
  WorkflowId,
} from '../../../types';
import * as TestUtils from '../../../utils/testUtils';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';
const { testIds } = TestUtils;

// Test entity for our tests
interface TestRefinableEntity extends RefinableEntity {
  id: string;
  name: string;
  description: string;
  details: string;
  acceptanceCriteria: string;
  status: string;
  priority?: string | null;
  assigneeId?: string | null;
  organizationId: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

// Mock work item service
class MockWorkItemService
  implements WorkItemRefinementService<TestRefinableEntity>
{
  private entities = new Map<string, TestRefinableEntity>();
  private conversations = new Map<string, ConversationResponseDto>();
  private activeConversations = new Map<string, string>();

  async findOneForAdapter(
    id: string,
    organizationId: OrganizationId,
  ): Promise<TestRefinableEntity | null> {
    return this.entities.get(`${id}-${organizationId}`) || null;
  }

  async updateForAdapter(
    id: string,
    updates: Partial<TestRefinableEntity>,
    organizationId: OrganizationId,
  ): Promise<TestRefinableEntity> {
    const existing = this.entities.get(`${id}-${organizationId}`);
    if (!existing) {
      throw new Error(`Entity ${id} not found`);
    }

    const updated = { ...existing, ...updates };
    this.entities.set(`${id}-${organizationId}`, updated);
    return updated;
  }

  async createRefinementConversation(
    entityId: string,
    organizationId: OrganizationId,
    projectId?: string,
  ): Promise<{
    conversation: ConversationResponseDto;
    entities: TestRefinableEntity[];
  }> {
    const conversationIdString = `conv-${entityId}-${Date.now()}`;
    const conversationId = conversationIdString as ConversationId;
    const workflowIdString = `workflow-${conversationIdString}`;
    const workflowId = workflowIdString as WorkflowId;

    const conversation: ConversationResponseDto = {
      id: conversationId,
      createdBy: null,
      projectId: (projectId as ProjectId) || testIds.project,
      organizationId,
      workflowId,
      status: 'STARTED',
      title: `Refinement for ${entityId}`,
      workflowName: 'initiative-refinement',
      initiatedBy: 'SYSTEM',
      triggerEvent: 'refinement_started',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };

    this.conversations.set(conversationId, conversation);
    this.activeConversations.set(
      `${entityId}-${organizationId}`,
      conversationId,
    );

    const entity = this.entities.get(`${entityId}-${organizationId}`);
    return {
      conversation,
      entities: entity ? [entity] : [],
    };
  }

  async getActiveRefinementConversation(
    entityId: string,
    organizationId: OrganizationId,
  ): Promise<string | null> {
    return (
      this.activeConversations.get(`${entityId}-${organizationId}`) || null
    );
  }

  // Test helper methods
  setEntity(entity: TestRefinableEntity, organizationId: OrganizationId) {
    this.entities.set(`${entity.id}-${organizationId}`, entity);
  }

  clear() {
    this.entities.clear();
    this.conversations.clear();
    this.activeConversations.clear();
  }
}

// Concrete test implementation
class TestRefinementService extends BaseRefinementService<TestRefinableEntity> {
  private mockWorkItemService = new MockWorkItemService();

  constructor() {
    super('TestRefinementService');
  }

  protected getEntityType(): EntityType {
    return 'initiative';
  }

  protected getWorkItemService(): WorkItemRefinementService<TestRefinableEntity> {
    return this.mockWorkItemService;
  }

  protected getCurrentLevelFromStatus(status: string): RefinementLevel {
    const levelMap: Record<string, RefinementLevel> = {
      draft: 'description',
      refining_description: 'description',
      refining_details: 'details',
      refining_acceptance_criteria: 'acceptanceCriteria',
      active: 'acceptanceCriteria',
    };
    return levelMap[status.toLowerCase()] || 'description';
  }

  protected getNextLevel(
    currentLevel: RefinementLevel,
  ): RefinementLevel | null {
    const levelSequence: RefinementLevel[] = [
      'description',
      'details',
      'acceptanceCriteria',
    ];
    const currentIndex = levelSequence.indexOf(currentLevel);
    if (currentIndex < levelSequence.length - 1) {
      return levelSequence[currentIndex + 1] ?? null;
    }
    return null;
  }

  // Test helper methods
  setEntity(entity: TestRefinableEntity, organizationId: OrganizationId) {
    this.mockWorkItemService.setEntity(entity, organizationId);
  }

  clearAll() {
    this.mockWorkItemService.clear();
  }
}

describe('BaseRefinementService', () => {
  let service: TestRefinementService;
  const testOrgId = 'test-org-123' as OrganizationId;
  const testEntityId = 'test-entity-123';
  const testProjectId = 'test-project-456';

  beforeEach(async () => {
    const setup = await createServiceTestingModule({
      providers: [TestRefinementService],
    });

    service = setup.module.get(TestRefinementService);
    service.clearAll();
  });

  describe('findOne', () => {
    it('should find entity successfully', async () => {
      // Arrange
      const entity: TestRefinableEntity =
        TestUtils.createMockInitiativeRefinableEntity({
          id: testEntityId,
          name: 'Test Entity',
          description: 'Test description',
          details: 'Test details',
          acceptanceCriteria: 'Test criteria',
          status: 'active',
          priority: 'high',
          assigneeId: 'user-123',
          organizationId: testOrgId,
        });

      service.setEntity(entity, testOrgId);

      // Act
      const result = await service.findOne(testEntityId, testOrgId);

      // Assert
      expect(result).toEqual(entity);
    });

    it('should return null for non-existent entity', async () => {
      // Act
      const result = await service.findOne('non-existent', testOrgId);

      // Assert
      expect(result).toBeNull();
    });

    it('should throw descriptive error on service failure', async () => {
      // Arrange
      const testService = new (class extends TestRefinementService {
        protected getWorkItemService(): WorkItemRefinementService<TestRefinableEntity> {
          return {
            ...super.getWorkItemService(),
            async findOneForAdapter(): Promise<TestRefinableEntity | null> {
              throw new Error('Database connection failed');
            },
          };
        }
      })();

      // Act & Assert
      await expect(
        testService.findOne(testEntityId, testOrgId),
      ).rejects.toThrow(
        'Failed to find initiative test-entity-123: Database connection failed',
      );
    });
  });

  describe('update', () => {
    it('should update entity successfully', async () => {
      // Arrange
      const originalEntity: TestRefinableEntity =
        TestUtils.createMockInitiativeRefinableEntity({
          id: testEntityId,
          name: 'Original Name',
          description: 'Original description',
          details: 'Original details',
          acceptanceCriteria: 'Original criteria',
          status: 'draft',
          priority: 'medium',
          assigneeId: null,
          organizationId: testOrgId,
        });

      service.setEntity(originalEntity, testOrgId);

      const updates: Partial<TestRefinableEntity> = {
        description: 'Updated description',
        priority: 'high',
      };

      // Act
      const result = await service.update(testEntityId, updates, testOrgId);

      // Assert
      expect(result.description).toBe('Updated description');
      expect(result.priority).toBe('high');
      expect(result.name).toBe('Original Name'); // Unchanged
    });

    it('should throw descriptive error on update failure', async () => {
      // Arrange
      const testService = new (class extends TestRefinementService {
        protected getWorkItemService(): WorkItemRefinementService<TestRefinableEntity> {
          return {
            ...super.getWorkItemService(),
            async updateForAdapter(): Promise<TestRefinableEntity> {
              throw new Error('Validation failed');
            },
          } as unknown as WorkItemRefinementService<TestRefinableEntity>;
        }
      })();

      // Act & Assert
      await expect(
        testService.update(testEntityId, { description: 'new' }, testOrgId),
      ).rejects.toThrow(
        'Failed to update initiative test-entity-123: Validation failed',
      );
    });
  });

  describe('applyRefinementChanges', () => {
    it('should apply all content updates successfully', async () => {
      // Arrange
      const entity: TestRefinableEntity =
        TestUtils.createMockInitiativeRefinableEntity({
          id: testEntityId,
          name: 'Test Entity',
          description: 'Original description',
          details: 'Original details',
          acceptanceCriteria: 'Original criteria',
          status: 'active',
          priority: 'medium',
          assigneeId: 'user-123',
          organizationId: testOrgId,
        });

      service.setEntity(entity, testOrgId);

      const changes: ContentUpdates = {
        description: 'Updated description',
        details: 'Updated details',
        acceptanceCriteria: 'Updated acceptance criteria',
        priority: 'high',
        assigneeId: 'user-456',
      };

      // Act
      const result = await service.applyRefinementChanges(
        testEntityId,
        changes,
        testOrgId,
      );

      // Assert
      expect(result.description).toBe('Updated description');
      expect(result.details).toBe('Updated details');
      expect(result.acceptanceCriteria).toBe('Updated acceptance criteria');
      expect(result.priority).toBe('high');
      expect(result.assigneeId).toBe('user-456');
    });

    it('should filter out undefined values', async () => {
      // Arrange
      const entity: TestRefinableEntity =
        TestUtils.createMockInitiativeRefinableEntity({
          id: testEntityId,
          name: 'Test Entity',
          description: 'Original description',
          details: 'Original details',
          acceptanceCriteria: '',
          status: 'active',
          priority: 'medium',
          assigneeId: null,
          organizationId: testOrgId,
        });

      service.setEntity(entity, testOrgId);

      const changes: ContentUpdates = {
        description: 'Updated description',
        details: undefined, // Should be filtered out
        acceptanceCriteria: 'New criteria',
        priority: undefined, // Should be filtered out
      };

      // Act
      const result = await service.applyRefinementChanges(
        testEntityId,
        changes,
        testOrgId,
      );

      // Assert
      expect(result.description).toBe('Updated description');
      expect(result.details).toBe('Original details'); // Unchanged
      expect(result.acceptanceCriteria).toBe('New criteria');
      expect(result.priority).toBe('medium'); // Unchanged
    });

    it('should throw error for non-existent entity', async () => {
      // Arrange
      const changes: ContentUpdates = {
        description: 'New description',
      };

      // Act & Assert
      await expect(
        service.applyRefinementChanges('non-existent', changes, testOrgId),
      ).rejects.toThrow('initiative non-existent not found');
    });
  });

  describe('getCurrentRefinementLevel', () => {
    it('should return correct level from status', () => {
      // Arrange
      const entity: TestRefinableEntity =
        TestUtils.createMockInitiativeRefinableEntity({
          id: testEntityId,
          name: 'Test Entity',
          description: 'Test description',
          status: 'refining_details',
          organizationId: testOrgId,
        });

      // Act
      const level = service.getCurrentRefinementLevel(entity);

      // Assert
      expect(level).toBe('details');
    });

    it('should default to description for unknown status', () => {
      // Arrange
      const entity: TestRefinableEntity =
        TestUtils.createMockInitiativeRefinableEntity({
          id: testEntityId,
          name: 'Test Entity',
          description: 'Test description',
          status: 'unknown_status',
          organizationId: testOrgId,
        });

      // Act
      const level = service.getCurrentRefinementLevel(entity);

      // Assert
      expect(level).toBe('description');
    });
  });

  describe('getNextRefinementLevel', () => {
    it('should return next level in sequence', () => {
      // Arrange
      const entity: TestRefinableEntity =
        TestUtils.createMockInitiativeRefinableEntity({
          id: testEntityId,
          name: 'Test Entity',
          description: 'Test description',
          status: 'refining_description',
          organizationId: testOrgId,
        });

      // Act
      const nextLevel = service.getNextRefinementLevel(entity);

      // Assert
      expect(nextLevel).toBe('details');
    });

    it('should return null for final level', () => {
      // Arrange
      const entity: TestRefinableEntity =
        TestUtils.createMockInitiativeRefinableEntity({
          id: testEntityId,
          name: 'Test Entity',
          description: 'Test description',
          status: 'active', // Maps to acceptanceCriteria level
          organizationId: testOrgId,
        });

      // Act
      const nextLevel = service.getNextRefinementLevel(entity);

      // Assert
      expect(nextLevel).toBeNull();
    });
  });

  describe('canAdvanceToNextLevel', () => {
    it('should return true when description field has content', () => {
      // Arrange
      const entity: TestRefinableEntity =
        TestUtils.createMockInitiativeRefinableEntity({
          id: testEntityId,
          name: 'Test Entity',
          description: 'Valid description content',
          status: 'refining_description',
          organizationId: testOrgId,
        });

      // Act
      const canAdvance = service.canAdvanceToNextLevel(entity, 'description');

      // Assert
      expect(canAdvance).toBe(true);
    });

    it('should return false when description field is empty', () => {
      // Arrange
      const entity: TestRefinableEntity =
        TestUtils.createMockInitiativeRefinableEntity({
          id: testEntityId,
          name: 'Test Entity',
          description: '',
          status: 'refining_description',
          organizationId: testOrgId,
        });

      // Act
      const canAdvance = service.canAdvanceToNextLevel(entity, 'description');

      // Assert
      expect(canAdvance).toBe(false);
    });

    it('should return true when details field has content', () => {
      // Arrange
      const entity: TestRefinableEntity =
        TestUtils.createMockInitiativeRefinableEntity({
          id: testEntityId,
          name: 'Test Entity',
          description: 'Description',
          details: 'Detailed information here',
          status: 'refining_details',
          organizationId: testOrgId,
        });

      // Act
      const canAdvance = service.canAdvanceToNextLevel(entity, 'details');

      // Assert
      expect(canAdvance).toBe(true);
    });

    it('should return false when details field is null', () => {
      // Arrange
      const entity: TestRefinableEntity =
        TestUtils.createMockInitiativeRefinableEntity({
          id: testEntityId,
          name: 'Test Entity',
          description: 'Description',
          details: '',
          status: 'refining_details',
          organizationId: testOrgId,
        });

      // Act
      const canAdvance = service.canAdvanceToNextLevel(entity, 'details');

      // Assert
      expect(canAdvance).toBe(false);
    });

    it('should use current level from status when level not specified', () => {
      // Arrange
      const entity: TestRefinableEntity =
        TestUtils.createMockInitiativeRefinableEntity({
          id: testEntityId,
          name: 'Test Entity',
          description: 'Description',
          details: 'Details content',
          status: 'refining_details',
          organizationId: testOrgId,
        });

      // Act
      const canAdvance = service.canAdvanceToNextLevel(entity);

      // Assert
      expect(canAdvance).toBe(true);
    });
  });

  describe('createRefinementSession', () => {
    it('should create refinement session successfully', async () => {
      // Arrange
      const entity: TestRefinableEntity =
        TestUtils.createMockInitiativeRefinableEntity({
          id: testEntityId,
          name: 'Test Entity',
          description: 'Test description',
          details: 'Test details',
          acceptanceCriteria: 'Test criteria',
          status: 'refining_details',
          priority: 'high',
          assigneeId: 'user-123',
          organizationId: testOrgId,
        });

      service.setEntity(entity, testOrgId);

      // Act
      const session = await service.createRefinementSession(
        testEntityId,
        'initiative',
        testOrgId,
        testProjectId,
      );

      // Assert
      expect(session.conversationId).toBeDefined();
      expect(session.workflowId).toBeDefined();
      expect(session.currentLevel).toBe('details');
      expect(session.entitySnapshot).toEqual(entity);
      expect(session.sessionMetadata.entityType).toBe('initiative');
      expect(session.sessionMetadata.entityId).toBe(testEntityId);
      expect(session.sessionMetadata.organizationId).toBe(testOrgId);
      expect(session.sessionMetadata.projectId).toBe(testProjectId);
    });

    it('should throw error for non-existent entity', async () => {
      // Act & Assert
      await expect(
        service.createRefinementSession(
          'non-existent',
          'initiative',
          testOrgId,
          testProjectId,
        ),
      ).rejects.toThrow('initiative non-existent not found');
    });
  });

  describe('getActiveRefinementConversation', () => {
    it('should return active conversation ID', async () => {
      // Arrange
      const entity: TestRefinableEntity =
        TestUtils.createMockInitiativeRefinableEntity({
          id: testEntityId,
          name: 'Test Entity',
          description: 'Test description',
          status: 'active',
          organizationId: testOrgId,
        });

      service.setEntity(entity, testOrgId);
      await service.createRefinementSession(
        testEntityId,
        'initiative',
        testOrgId,
        testProjectId,
      );

      // Act
      const conversationId = await service.getActiveRefinementConversation(
        testEntityId,
        testOrgId,
      );

      // Assert
      expect(conversationId).toBeDefined();
      expect(String(conversationId).length).toBeGreaterThan(0);
    });

    it('should return null when no active conversation exists', async () => {
      // Act
      const conversationId = await service.getActiveRefinementConversation(
        'non-existent',
        testOrgId,
      );

      // Assert
      expect(conversationId).toBeNull();
    });
  });

  describe('validateRefinementLevel', () => {
    it('should validate correct refinement levels', () => {
      // Act & Assert
      expect(service.validateRefinementLevel('description')).toBe(
        'description',
      );
      expect(service.validateRefinementLevel('details')).toBe('details');
      expect(service.validateRefinementLevel('acceptanceCriteria')).toBe(
        'acceptanceCriteria',
      );
    });

    it('should throw error for invalid refinement level', () => {
      // Act & Assert
      expect(() => service.validateRefinementLevel('invalid_level')).toThrow(
        'Invalid refinement level: invalid_level',
      );
    });
  });

  describe('operation result helpers', () => {
    it('should create success operation result', () => {
      // Act
      const result = (
        service as unknown as {
          createOperationResult: (
            entityId: string,
            message: string,
            status: string,
            currentLevel: string,
            workflowId: string,
            metadata: Record<string, unknown>,
          ) => {
            success: boolean;
            message: string;
            status: string;
            entityId: string;
            currentLevel: string;
            workflowId: string;
            metadata: { entityType: string; extra: string };
            timestamp: Date;
          };
        }
      ).createOperationResult(
        testEntityId,
        'Operation successful',
        'completed',
        'description',
        'workflow-123',
        { extra: 'data' },
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toBe('Operation successful');
      expect(result.status).toBe('completed');
      expect(result.entityId).toBe(testEntityId);
      expect(result.currentLevel).toBe('description');
      expect(result.workflowId).toBe('workflow-123');
      expect(result.metadata.entityType).toBe('initiative');
      expect(result.metadata.extra).toBe('data');
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should create error operation result', () => {
      // Act
      const result = (
        service as unknown as {
          createErrorResult: (
            entityId: string,
            message: string,
            currentLevel: string,
          ) => {
            success: boolean;
            message: string;
            status: string;
            entityId: string;
            currentLevel: string;
            metadata: { entityType: string };
            timestamp: Date;
          };
        }
      ).createErrorResult(testEntityId, 'Operation failed', 'details');

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toBe('Operation failed');
      expect(result.status).toBe('error');
      expect(result.entityId).toBe(testEntityId);
      expect(result.currentLevel).toBe('details');
      expect(result.metadata.entityType).toBe('initiative');
      expect(result.timestamp).toBeInstanceOf(Date);
    });
  });
});
