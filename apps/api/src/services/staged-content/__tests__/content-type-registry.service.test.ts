/**
 * Content Type Registry Service Tests
 *
 * Tests the registry service that manages all content type definitions.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ContentTypeRegistryService } from '../content-type-registry.service';
import { ContentTypeDefinition } from '../../../types/staged-content.types';
import * as TestUtils from '../../../utils/testUtils';

describe('ContentTypeRegistryService', () => {
  let service: ContentTypeRegistryService;
  const { testIds } = TestUtils;

  const mockWorkItemContentType: ContentTypeDefinition = {
    id: 'work-item',
    type: 'initiative',
    displayName: 'Work Item',
    implementationType: 'simple',
    refinementLevels: [],
    statusMappings: {},
    signalDefinitions: [],
    fieldMappings: {},
    stages: [
      {
        id: 'description',
        name: 'Description',
        displayName: 'Description',
        order: 1,
        contentFields: ['description'],
        nextStages: ['details'],
        validationRules: [
          { type: 'field_required', field: 'description' },
          { type: 'min_length', field: 'description', minLength: 10 },
        ],
        interactionType: 'user_input',
        isTerminal: false,
      },
      {
        id: 'details',
        name: 'Details',
        displayName: 'Details',
        order: 2,
        contentFields: ['details'],
        nextStages: ['acceptance_criteria'],
        validationRules: [{ type: 'field_required', field: 'details' }],
        interactionType: 'user_input',
        isTerminal: false,
      },
      {
        id: 'acceptance_criteria',
        name: 'Acceptance Criteria',
        displayName: 'Acceptance Criteria',
        order: 3,
        contentFields: ['acceptanceCriteria'],
        nextStages: [],
        validationRules: [
          { type: 'field_required', field: 'acceptanceCriteria' },
        ],
        interactionType: 'user_input',
        isTerminal: true,
      },
    ],
    entitySchema: {
      entityType: 'work-item',
      statusMapping: {
        description: 'REFINING_DESCRIPTION',
        details: 'REFINING_DETAILS',
        acceptance_criteria: 'REFINING_ACCEPTANCE_CRITERIA',
      },
      progressCalculation: 'linear',
    },
  };

  const mockDesignDocContentType: ContentTypeDefinition = {
    id: 'adr',
    type: 'initiative',
    displayName: 'Design Document',
    implementationType: 'simple',
    refinementLevels: [],
    statusMappings: {},
    signalDefinitions: [],
    fieldMappings: {},
    stages: [
      {
        id: 'context',
        name: 'Context',
        displayName: 'Context',
        order: 1,
        contentFields: ['context'],
        nextStages: ['decision'],
        validationRules: [],
        interactionType: 'user_input',
        isTerminal: false,
      },
      {
        id: 'decision',
        name: 'Decision',
        displayName: 'Decision',
        order: 2,
        contentFields: ['decision'],
        nextStages: ['consequences'],
        validationRules: [],
        interactionType: 'user_input',
        isTerminal: false,
      },
      {
        id: 'consequences',
        name: 'Consequences',
        displayName: 'Consequences',
        order: 3,
        contentFields: ['consequences'],
        nextStages: ['status'],
        validationRules: [],
        interactionType: 'user_input',
        isTerminal: false,
      },
      {
        id: 'status',
        name: 'Status',
        displayName: 'Status & Review',
        order: 4,
        contentFields: ['statusNotes'],
        nextStages: [],
        validationRules: [],
        interactionType: 'user_input',
        isTerminal: true,
      },
    ],
    entitySchema: {
      entityType: 'design-doc',
      statusMapping: {
        context: 'ADR_CONTEXT',
        decision: 'ADR_DECISION',
        consequences: 'ADR_CONSEQUENCES',
        status: 'ADR_REVIEW',
      },
      progressCalculation: 'linear',
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ContentTypeRegistryService],
    }).compile();

    service = module.get<ContentTypeRegistryService>(
      ContentTypeRegistryService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should successfully register a new content type - happy path', () => {
      // Act
      service.register(mockWorkItemContentType);

      // Assert
      const registered = service.get('work-item');
      expect(registered).toEqual(mockWorkItemContentType);
    });

    it('should allow duplicate registration with warning', () => {
      // Arrange
      service.register(mockWorkItemContentType);
      const loggerSpy = jest.spyOn((service as any).logger, 'warn');

      // Act - should not throw, just warn
      service.register(mockWorkItemContentType);

      // Assert
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('work-item'),
      );
    });

    it('should allow registration of multiple different content types', () => {
      // Act
      service.register(mockWorkItemContentType);
      service.register(mockDesignDocContentType);

      // Assert
      expect(service.get('work-item')).toEqual(mockWorkItemContentType);
      expect(service.get('adr')).toEqual(mockDesignDocContentType);
    });

    it('should validate content type has required fields', () => {
      // Arrange
      const invalidContentType = {
        id: 'invalid',
        // Missing required fields
      } as any;

      // Act & Assert
      expect(() => service.register(invalidContentType)).toThrow();
    });
  });

  describe('get', () => {
    it('should retrieve registered content type by id - happy path', () => {
      // Arrange
      service.register(mockWorkItemContentType);

      // Act
      const result = service.get('work-item');

      // Assert
      expect(result).toEqual(mockWorkItemContentType);
    });

    it('should throw error for non-existent content type', () => {
      // Act & Assert
      expect(() => service.get('non-existent' as any)).toThrow(
        'Invalid content type ID: non-existent',
      );
    });

    it('should be case-sensitive for content type ids', () => {
      // Arrange
      service.register(mockWorkItemContentType);

      // Act & Assert
      expect(() => service.get('Work-Item' as any)).toThrow(
        'Invalid content type ID: Work-Item',
      );
    });
  });

  describe('getAll', () => {
    it('should return all registered content types - happy path', () => {
      // Arrange
      service.register(mockWorkItemContentType);
      service.register(mockDesignDocContentType);

      // Act
      const result = service.getAll();

      // Assert
      expect(result).toHaveLength(2);
      expect(result).toContainEqual(mockWorkItemContentType);
      expect(result).toContainEqual(mockDesignDocContentType);
    });

    it('should return empty array when no content types registered', () => {
      // Act
      const result = service.getAll();

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('getAvailableTypeIds', () => {
    it('should return all registered content type ids', () => {
      // Arrange
      service.register(mockWorkItemContentType);
      service.register(mockDesignDocContentType);

      // Act
      const result = service.getAvailableTypeIds();

      // Assert
      expect(result).toEqual(['work-item', 'adr']);
    });

    it('should return empty array when no content types registered', () => {
      // Act
      const result = service.getAvailableTypeIds();

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('has', () => {
    it('should return true for registered content type', () => {
      // Arrange
      service.register(mockWorkItemContentType);

      // Act & Assert
      expect(service.has('work-item')).toBe(true);
    });

    it('should return false for non-registered content type', () => {
      // Act & Assert
      expect(service.has('non-existent' as any)).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all registered content types', () => {
      // Arrange
      service.register(mockWorkItemContentType);
      service.register(mockDesignDocContentType);

      // Act
      service.clear();

      // Assert
      expect(service.getAll()).toEqual([]);
      expect(() => service.get('work-item' as any)).toThrow();
      expect(() => service.get('adr' as any)).toThrow();
    });
  });
});
