import { Logger } from '@nestjs/common';
import {
  BaseOptimizationService,
  WorkItemArtifactService,
} from '../base-optimization.service';
import {
  RefinableEntity,
  EntityType,
  ChangeDetectionResult,
  OptimizationContext,
  RefinementLevel,
} from '../../../types/refinable-entity.types';
import { OrganizationId } from '../../../types';
import * as TestUtils from '../../../utils/testUtils';
const { testIds } = TestUtils;

// Test entity for our tests
interface TestRefinableEntity extends RefinableEntity {
  id: string;
  name: string;
  description: string;
  details: string; // Required by RefinableEntity
  acceptanceCriteria: string; // Required by RefinableEntity
  status: string;
  priority?: string | null;
  assigneeId?: string | null;
  organizationId: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

// Mock artifact service
class MockArtifactService
  implements WorkItemArtifactService<TestRefinableEntity>
{
  private artifacts = new Map<string, TestRefinableEntity>();

  async getOriginalArtifact(
    entityId: string,
    organizationId: OrganizationId,
  ): Promise<TestRefinableEntity | null> {
    return this.artifacts.get(`${entityId}-${organizationId}`) || null;
  }

  async saveArtifactSnapshot(
    entity: TestRefinableEntity,
    organizationId: OrganizationId,
  ): Promise<void> {
    this.artifacts.set(`${entity.id}-${organizationId}`, { ...entity });
  }

  // Test helper methods
  setOriginalArtifact(
    entity: TestRefinableEntity,
    organizationId: OrganizationId,
  ) {
    this.artifacts.set(`${entity.id}-${organizationId}`, entity);
  }

  clear() {
    this.artifacts.clear();
  }
}

// Concrete test implementation
class TestOptimizationService extends BaseOptimizationService<TestRefinableEntity> {
  private entities = new Map<string, TestRefinableEntity>();
  private mockArtifactService = new MockArtifactService();

  constructor() {
    super('TestOptimizationService');
  }

  protected getEntityType(): EntityType {
    return 'initiative';
  }

  protected async findOne(
    id: string,
    organizationId: OrganizationId,
  ): Promise<TestRefinableEntity | null> {
    return this.entities.get(`${id}-${organizationId}`) || null;
  }

  protected getArtifactService(): WorkItemArtifactService<TestRefinableEntity> {
    return this.mockArtifactService;
  }

  // Test helper methods
  setEntity(entity: TestRefinableEntity, organizationId: OrganizationId) {
    this.entities.set(`${entity.id}-${organizationId}`, entity);
  }

  setOriginalArtifact(
    entity: TestRefinableEntity,
    organizationId: OrganizationId,
  ) {
    this.mockArtifactService.setOriginalArtifact(entity, organizationId);
  }

  clearAll() {
    this.entities.clear();
    this.mockArtifactService.clear();
  }
}

describe('BaseOptimizationService', () => {
  let service: TestOptimizationService;
  const testOrgId = testIds.organization;
  const testEntityId = testIds.initiative;

  beforeEach(() => {
    service = new TestOptimizationService();
    service.clearAll();
  });

  describe('detectChanges', () => {
    it('should detect no changes when entity matches original artifact', async () => {
      // Arrange
      const originalEntity: TestRefinableEntity = {
        id: testEntityId,
        name: 'Test Entity',
        description: 'Original description',
        details: 'Original details',
        acceptanceCriteria: 'Original criteria',
        status: 'active',
        priority: 'high',
        assigneeId: testIds.user,
        organizationId: testOrgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const currentEntity = { ...originalEntity };

      service.setEntity(currentEntity, testOrgId);
      service.setOriginalArtifact(originalEntity, testOrgId);

      // Act
      const result = await service.detectChanges(testEntityId, testOrgId);

      // Assert
      expect(result.hasChanges).toBe(false);
      expect(result.changesSummary).toBe('No changes detected');
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.9);
      expect(result.affectedFields).toHaveLength(0);
    });

    it('should detect minor changes in description', async () => {
      // Arrange
      const originalEntity: TestRefinableEntity = {
        id: testEntityId,
        name: 'Test Entity',
        description: 'Original description',
        details: 'Original details',
        acceptanceCriteria: 'Original criteria',
        status: 'active',
        priority: 'high',
        assigneeId: testIds.user,
        organizationId: testOrgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const currentEntity = {
        ...originalEntity,
        description: 'Updated description with small change',
      };

      service.setEntity(currentEntity, testOrgId);
      service.setOriginalArtifact(originalEntity, testOrgId);

      // Act
      const result = await service.detectChanges(testEntityId, testOrgId);

      // Assert
      expect(result.hasChanges).toBe(true);
      expect(result.affectedFields).toContain('description');
      expect(result.changeType).toBe('major'); // description has high weight
      expect(result.confidenceScore).toBeGreaterThan(0.7);
    });

    it('should detect structural changes when content is heavily modified', async () => {
      // Arrange
      const originalEntity: TestRefinableEntity = {
        id: testEntityId,
        name: 'Original Name',
        description: 'Same description',
        details: 'Same details',
        acceptanceCriteria: 'Same criteria',
        status: 'active',
        priority: 'high',
        assigneeId: testIds.user,
        organizationId: testOrgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const currentEntity = {
        ...originalEntity,
        description: 'Completely different description with lots of changes',
        details: 'Completely different details',
        acceptanceCriteria: 'Completely different criteria',
      };

      service.setEntity(currentEntity, testOrgId);
      service.setOriginalArtifact(originalEntity, testOrgId);

      // Act
      const result = await service.detectChanges(testEntityId, testOrgId);

      // Assert
      expect(result.hasChanges).toBe(true);
      expect(result.affectedFields).toContain('description');
      expect(result.affectedFields).toContain('details');
      expect(result.affectedFields).toContain('acceptanceCriteria');
      expect(result.changeType).toBe('structural');
      expect(result.confidenceScore).toBeGreaterThan(0.9);
    });

    it('should treat missing original artifact as changed', async () => {
      // Arrange
      const currentEntity: TestRefinableEntity = {
        id: testEntityId,
        name: 'Test Entity',
        description: 'Current description',
        details: 'Current details',
        acceptanceCriteria: 'Current criteria',
        status: 'active',
        priority: 'high',
        assigneeId: testIds.user,
        organizationId: testOrgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      service.setEntity(currentEntity, testOrgId);
      // Don't set original artifact

      // Act
      const result = await service.detectChanges(testEntityId, testOrgId);

      // Assert
      expect(result.hasChanges).toBe(true);
      expect(result.changesSummary).toContain('No original artifact found');
      expect(result.confidenceScore).toBe(1.0);
      expect(result.changeType).toBe('structural');
    });

    it('should handle entity not found gracefully', async () => {
      // Act
      const result = await service.detectChanges('nonexistent-id', testOrgId);

      // Assert - should return error result instead of throwing
      expect(result.hasChanges).toBe(true);
      expect(result.changesSummary).toContain('Error during change detection');
      expect(result.changeType).toBe('major');
      expect(result.confidenceScore).toBe(0.5);
    });

    it('should return safe defaults on error', async () => {
      // Arrange - setup entity but mock findOne to throw
      const testService = new (class extends TestOptimizationService {
        protected async findOne(): Promise<TestRefinableEntity | null> {
          throw new Error('Database connection failed');
        }
      })();

      // Act
      const result = await testService.detectChanges(testEntityId, testOrgId);

      // Assert
      expect(result.hasChanges).toBe(true);
      expect(result.changesSummary).toContain('Error during change detection');
      expect(result.confidenceScore).toBe(0.5);
      expect(result.changeType).toBe('major');
    });
  });

  describe('generateOptimizationContext', () => {
    it('should recommend skipping LLM for no changes with high confidence', async () => {
      // Arrange
      const changeDetection: ChangeDetectionResult = {
        hasChanges: false,
        changesSummary: 'No changes detected',
        confidenceScore: 0.9,
        affectedFields: [],
        changeType: 'minor',
      };

      // Act
      const context =
        await service.generateOptimizationContext(changeDetection);

      // Assert
      expect(context.shouldSkipLlm).toBe(true);
      expect(context.processingRecommendation).toBe('skip');
      expect(context.optimizationHints).toContain(
        'No significant changes detected',
      );
      expect(context.estimatedProcessingTime).toBe(2);
    });

    it('should recommend review for minor changes with medium confidence', async () => {
      // Arrange
      const changeDetection: ChangeDetectionResult = {
        hasChanges: true,
        changesSummary: 'Minor description update',
        confidenceScore: 0.7,
        affectedFields: ['description'],
        changeType: 'minor',
      };

      // Act
      const context =
        await service.generateOptimizationContext(changeDetection);

      // Assert
      expect(context.shouldSkipLlm).toBe(false);
      expect(context.processingRecommendation).toBe('review');
      expect(context.optimizationHints).toContain('Minor changes detected');
      expect(context.optimizationHints).toContain(
        'Focus on changed fields: description',
      );
      expect(context.estimatedProcessingTime).toBe(10);
    });

    it('should recommend full processing for major changes', async () => {
      // Arrange
      const changeDetection: ChangeDetectionResult = {
        hasChanges: true,
        changesSummary: 'Significant structural modifications',
        confidenceScore: 0.5,
        affectedFields: ['description', 'details', 'acceptanceCriteria'],
        changeType: 'major',
      };

      // Act
      const context =
        await service.generateOptimizationContext(changeDetection);

      // Assert
      expect(context.shouldSkipLlm).toBe(false);
      expect(context.processingRecommendation).toBe('generate');
      expect(context.optimizationHints).toContain('Major changes detected');
      expect(context.optimizationHints).toContain(
        'Full LLM processing recommended',
      );
      expect(context.estimatedProcessingTime).toBe(20);
    });

    it('should recommend full processing for structural changes', async () => {
      // Arrange
      const changeDetection: ChangeDetectionResult = {
        hasChanges: true,
        changesSummary: 'Structural changes detected',
        confidenceScore: 0.95,
        affectedFields: ['description', 'acceptanceCriteria'],
        changeType: 'structural',
      };

      // Act
      const context =
        await service.generateOptimizationContext(changeDetection);

      // Assert
      expect(context.shouldSkipLlm).toBe(false);
      expect(context.processingRecommendation).toBe('generate');
      expect(context.optimizationHints).toContain(
        'Structural changes detected',
      );
      expect(context.estimatedProcessingTime).toBe(30);
    });
  });

  describe('saveEntitySnapshot', () => {
    it('should save entity snapshot successfully', async () => {
      // Arrange
      const entity: TestRefinableEntity = {
        id: testEntityId,
        name: 'Test Entity',
        description: 'Test description',
        details: 'Test details',
        acceptanceCriteria: 'Test criteria',
        status: 'active',
        priority: 'high',
        assigneeId: testIds.user,
        organizationId: testOrgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Act
      await service.saveEntitySnapshot(entity, testOrgId);

      // Assert - verify it was saved by trying to retrieve it
      const artifactService = (service as any).getArtifactService();
      const savedArtifact = await artifactService.getOriginalArtifact(
        testEntityId,
        testOrgId,
      );
      expect(savedArtifact).toEqual(entity);
    });

    it('should not throw on artifact service errors', async () => {
      // Arrange
      const entity: TestRefinableEntity = {
        id: testEntityId,
        name: 'Test Entity',
        description: 'Test description',
        details: 'Test details',
        acceptanceCriteria: 'Test criteria',
        status: 'active',
        priority: null,
        assigneeId: null,
        organizationId: testOrgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const testService = new (class extends TestOptimizationService {
        protected getArtifactService(): WorkItemArtifactService<TestRefinableEntity> {
          return {
            async getOriginalArtifact(): Promise<TestRefinableEntity | null> {
              return null;
            },
            async saveArtifactSnapshot(): Promise<void> {
              throw new Error('Storage failed');
            },
          };
        }
      })();

      // Act & Assert - should not throw
      await expect(
        testService.saveEntitySnapshot(entity, testOrgId),
      ).resolves.not.toThrow();
    });
  });

  describe('isFieldEmpty', () => {
    it('should correctly identify empty description field', () => {
      // Arrange
      const entity: TestRefinableEntity = {
        id: testEntityId,
        name: 'Test Entity',
        description: '',
        details: 'Has details',
        acceptanceCriteria: 'Has criteria',
        status: 'active',
        priority: 'high',
        assigneeId: testIds.user,
        organizationId: testOrgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Act & Assert
      expect(service.isFieldEmpty(entity, 'description')).toBe(true);
      expect(service.isFieldEmpty(entity, 'details')).toBe(false);
      expect(service.isFieldEmpty(entity, 'acceptanceCriteria')).toBe(false);
    });

    it('should treat null and undefined as empty', () => {
      // Arrange
      const entity: TestRefinableEntity = {
        id: testEntityId,
        name: 'Test Entity',
        description: 'Has description',
        details: '',
        acceptanceCriteria: '',
        status: 'active',
        priority: 'high',
        assigneeId: testIds.user,
        organizationId: testOrgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Act & Assert
      expect(service.isFieldEmpty(entity, 'description')).toBe(false);
      expect(service.isFieldEmpty(entity, 'details')).toBe(true);
      expect(service.isFieldEmpty(entity, 'acceptanceCriteria')).toBe(true);
    });

    it('should treat whitespace-only strings as empty', () => {
      // Arrange
      const entity: TestRefinableEntity = {
        id: testEntityId,
        name: 'Test Entity',
        description: '   \n\t  ',
        details: 'Real content',
        acceptanceCriteria: 'Has criteria',
        status: 'active',
        priority: 'high',
        assigneeId: testIds.user,
        organizationId: testOrgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Act & Assert
      expect(service.isFieldEmpty(entity, 'description')).toBe(true);
      expect(service.isFieldEmpty(entity, 'details')).toBe(false);
    });
  });

  describe('change calculation methods', () => {
    it('should calculate similarity correctly', () => {
      // Access protected method via type assertion for testing
      const serviceAny = service as any;

      // Test identical strings
      expect(serviceAny.calculateSimilarity('hello world', 'hello world')).toBe(
        1,
      );

      // Test completely different strings
      expect(serviceAny.calculateSimilarity('hello', 'goodbye')).toBe(0);

      // Test partial similarity
      const similarity = serviceAny.calculateSimilarity(
        'hello world test',
        'hello universe test',
      );
      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThan(1);
    });

    it('should calculate change magnitude correctly', () => {
      const serviceAny = service as any;

      // Test identical strings
      expect(serviceAny.calculateChangeMagnitude('test', 'test')).toBe(0);

      // Test complete replacement
      expect(serviceAny.calculateChangeMagnitude('test', '')).toBe(1);
      expect(serviceAny.calculateChangeMagnitude('', 'test')).toBe(1);

      // Test partial changes
      const magnitude = serviceAny.calculateChangeMagnitude(
        'original text',
        'modified text',
      );
      expect(magnitude).toBeGreaterThan(0);
      expect(magnitude).toBeLessThan(1);
    });
  });
});
