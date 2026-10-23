/**
 * Stage Management Service Tests
 *
 * Tests stage transitions, validation, and progress calculation.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { StageManagementService } from '../stage-management.service';
import {
  ContentTypeDefinition,
  StagedContentEntity,
  ValidationError,
} from '../../../types/staged-content.types';
import * as TestUtils from '../../../utils/testUtils';

const assertDefined = <T>(value: T | undefined, label: string): T => {
  if (value === undefined) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
};

describe('StageManagementService', () => {
  let service: StageManagementService;
  const { testIds } = TestUtils;

  const mockContentType: ContentTypeDefinition = {
    id: 'work-item',
    type: 'initiative',
    displayName: 'Test Content',
    implementationType: 'simple',
    refinementLevels: [],
    statusMappings: {},
    signalDefinitions: [],
    fieldMappings: {},
    stages: [
      {
        id: 'stage1',
        name: 'Stage 1',
        displayName: 'Stage 1',
        order: 1,
        contentFields: ['field1'],
        nextStages: ['stage2'],
        validationRules: [
          { type: 'field_required', field: 'field1' },
          { type: 'min_length', field: 'field1', minLength: 10 },
        ],
        interactionType: 'user_input',
        isTerminal: false,
      },
      {
        id: 'stage2',
        name: 'Stage 2',
        displayName: 'Stage 2',
        order: 2,
        contentFields: ['field2'],
        nextStages: ['stage3'],
        validationRules: [{ type: 'field_required', field: 'field2' }],
        interactionType: 'user_input',
        isTerminal: false,
      },
      {
        id: 'stage3',
        name: 'Stage 3',
        displayName: 'Stage 3',
        order: 3,
        contentFields: ['field3'],
        nextStages: [],
        validationRules: [],
        interactionType: 'user_input',
        isTerminal: true,
      },
    ],
    entitySchema: {
      entityType: 'test-entity',
      statusMapping: {
        stage1: 'STATUS_1',
        stage2: 'STATUS_2',
        stage3: 'STATUS_3',
      },
      progressCalculation: 'linear',
    },
  };

  const mockEntity: StagedContentEntity = {
    id: testIds.initiative,
    entityType: 'test-entity',
    name: 'Test Entity',
    description: 'Test description that is long enough',
    details: 'Test details',
    acceptanceCriteria: 'Test criteria',
    field1: 'Field one has enough content',
    field2: 'Field two has enough content',
    field3: 'Field three has enough content',
    status: 'STATUS_1',
    currentStage: 'stage1',
    priority: 'HIGH',
    assigneeId: testIds.user,
    organizationId: testIds.organization,
    tags: [] as string[],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const getStage = (index: number) => {
    const stage = mockContentType.stages[index];
    if (!stage) {
      throw new Error(`Expected stage at index ${index}`);
    }
    return stage;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StageManagementService],
    }).compile();

    service = module.get<StageManagementService>(StageManagementService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getCurrentStage', () => {
    it('should get current stage from entity - happy path', () => {
      // Act
      const result = service.getCurrentStage(mockEntity, mockContentType);

      // Assert
      expect(result).toEqual(getStage(0));
    });

    it('should throw error if currentStage not set', () => {
      // Arrange
      const entityWithoutStage: any = {
        ...mockEntity,
        currentStage: undefined,
      };

      // Act & Assert
      expect(() =>
        service.getCurrentStage(entityWithoutStage, mockContentType),
      ).toThrow();
    });

    it('should throw for invalid stage id', () => {
      // Arrange
      const entityWithInvalidStage = {
        ...mockEntity,
        currentStage: 'invalid-stage',
      };

      // Act & Assert
      expect(() =>
        service.getCurrentStage(entityWithInvalidStage, mockContentType),
      ).toThrow();
    });
  });

  describe('validateStageTransition', () => {
    it('should validate valid transition - happy path', async () => {
      // Act
      const errors = await service.validateStageTransition(
        mockEntity,
        getStage(0),
        getStage(1),
      );

      // Assert
      expect(errors).toEqual([]);
    });

    it('should return error for invalid transition', async () => {
      // Act
      const errors = await service.validateStageTransition(
        mockEntity,
        getStage(0),
        getStage(2), // Cannot skip stage2
      );

      // Assert
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({
        field: 'stage',
        rule: 'custom_function',
        message: expect.stringContaining('Cannot transition'),
        severity: 'error',
      });
    });

    it('should validate required fields before transition', async () => {
      // Arrange
      const entityMissingField: any = { ...mockEntity, field1: undefined };

      // Act
      const errors = await service.validateStageTransition(
        entityMissingField,
        getStage(0),
        getStage(1),
      );

      // Assert
      expect(errors).toContainEqual(
        expect.objectContaining({
          field: 'field1',
          rule: 'field_required',
          severity: 'error',
        }),
      );
    });

    it('should validate minimum length requirements', async () => {
      // Arrange
      const entityShortField = { ...mockEntity, field1: 'short' };

      // Act
      const errors = await service.validateStageTransition(
        entityShortField,
        getStage(0),
        getStage(1),
      );

      // Assert
      expect(errors).toContainEqual(
        expect.objectContaining({
          field: 'field1',
          rule: 'min_length',
          message: expect.stringContaining('at least 10 characters'),
          severity: 'error',
        }),
      );
    });

    it('should allow transition from terminal stage', async () => {
      // Arrange
      const entityAtLastStage = { ...mockEntity, currentStage: 'stage3' };

      // Act
      const errors = await service.validateStageTransition(
        entityAtLastStage,
        getStage(2),
        getStage(2), // Terminal stage stays at same stage
      );

      // Assert
      expect(errors).toHaveLength(2);
      expect(errors[0]).toMatchObject({
        field: 'stage',
        code: 'INVALID_STAGE_TRANSITION',
      });
      expect(errors[1]).toMatchObject({
        field: 'stage',
        code: 'BACKWARD_TRANSITION_NOT_ALLOWED',
      });
    });
  });

  describe('calculateProgress', () => {
    it('should calculate linear progress correctly', () => {
      // Arrange
      const contentTypeLinear = {
        ...mockContentType,
        entitySchema: {
          ...mockContentType.entitySchema,
          progressCalculation: 'linear' as const,
        },
      };

      // Act
      const progressStage1 = service.calculateProgress(
        { ...mockEntity, currentStage: 'stage1' },
        contentTypeLinear,
      );
      const progressStage2 = service.calculateProgress(
        { ...mockEntity, currentStage: 'stage2' },
        contentTypeLinear,
      );
      const progressStage3 = service.calculateProgress(
        { ...mockEntity, currentStage: 'stage3' },
        contentTypeLinear,
      );

      // Assert
      expect(progressStage1).toBe(33); // 1/3
      expect(progressStage2).toBe(67); // 2/3
      expect(progressStage3).toBe(100); // 3/3
    });

    it('should handle weighted progress calculation', () => {
      // Arrange
      const contentTypeWeighted = {
        ...mockContentType,
        entitySchema: {
          ...mockContentType.entitySchema,
          progressCalculation: 'weighted' as const,
          weightings: {
            stage1: 0.2,
            stage2: 0.5,
            stage3: 0.3,
          },
        },
      };

      // Act
      const progressStage1 = service.calculateProgress(
        { ...mockEntity, currentStage: 'stage1' },
        contentTypeWeighted,
      );
      const progressStage2 = service.calculateProgress(
        { ...mockEntity, currentStage: 'stage2' },
        contentTypeWeighted,
      );
      const progressStage3 = service.calculateProgress(
        { ...mockEntity, currentStage: 'stage3' },
        contentTypeWeighted,
      );

      // Assert
      expect(progressStage1).toBe(20);
      expect(progressStage2).toBe(70); // 20 + 50
      expect(progressStage3).toBe(100); // 20 + 50 + 30
    });

    it('should throw for invalid entity', () => {
      // Act & Assert
      expect(() =>
        service.calculateProgress(
          { ...mockEntity, currentStage: 'invalid' },
          mockContentType,
        ),
      ).toThrow();
    });

    it('should return 100 for terminal stage', () => {
      // Act
      const progress = service.calculateProgress(
        { ...mockEntity, currentStage: 'stage3' }, // Last stage
        mockContentType,
      );

      // Assert
      expect(progress).toBe(100);
    });
  });

  describe('getNextStages', () => {
    it('should return next stages for non-terminal stage', () => {
      // Act
      const nextStages = service.getNextStages(getStage(0), mockContentType);

      // Assert
      expect(nextStages).toHaveLength(1);
      const nextStage = assertDefined(nextStages[0], 'next stage');
      expect(nextStage.id).toEqual('stage2');
    });

    it('should return empty array for terminal stage', () => {
      // Act
      const nextStages = service.getNextStages(getStage(2), mockContentType);

      // Assert
      expect(nextStages).toEqual([]);
    });
  });

  describe('isTerminalStage', () => {
    it('should return true for terminal stage', () => {
      // Act & Assert
      expect(service.isTerminalStage(getStage(2))).toBe(true);
    });

    it('should return false for non-terminal stage', () => {
      // Act & Assert
      expect(service.isTerminalStage(getStage(0))).toBe(false);
      expect(service.isTerminalStage(getStage(1))).toBe(false);
    });
  });

  describe('validateStageCompletion', () => {
    it('should pass validation with valid data', async () => {
      // Arrange
      const validEntity = {
        ...mockEntity,
        field1: 'This is a valid long field',
        field2: 'Valid field 2',
      };

      // Act
      const errors = await service.validateStageCompletion(
        validEntity,
        getStage(0),
      );

      // Assert
      expect(errors).toEqual([]);
    });

    it('should detect missing required fields', async () => {
      // Arrange
      const entityMissingField = { ...mockEntity };
      delete (entityMissingField as any).field1;

      // Act
      const errors = await service.validateStageCompletion(
        entityMissingField,
        getStage(0),
      );

      // Assert
      expect(errors).toContainEqual(
        expect.objectContaining({
          field: 'field1',
          rule: 'field_required',
          severity: 'error',
        }),
      );
    });

    it('should detect fields below minimum length', async () => {
      // Arrange
      const entityShortField = {
        ...mockEntity,
        field1: 'short',
      };

      // Act
      const errors = await service.validateStageCompletion(
        entityShortField,
        getStage(0),
      );

      // Assert
      expect(errors).toContainEqual(
        expect.objectContaining({
          field: 'field1',
          rule: 'min_length',
          message: expect.stringContaining('at least 10 characters'),
          severity: 'error',
        }),
      );
    });
  });
});
