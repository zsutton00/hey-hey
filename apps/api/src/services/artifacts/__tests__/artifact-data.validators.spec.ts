import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BugData,
  CommentData,
  DecisionData,
  DocumentData,
  NoteData,
  QAPairData,
  RequirementData,
  TaskOriginalArtifactData,
} from '../../../generated';
import {
  ArtifactDataValidationError,
  ArtifactDataValidators,
} from '../artifact-data.validators';

describe('ArtifactDataValidators', () => {
  let validators: ArtifactDataValidators;
  let loggerDebugSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ArtifactDataValidators],
    }).compile();

    validators = module.get<ArtifactDataValidators>(ArtifactDataValidators);

    // Spy on logger methods
    loggerDebugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateArtifactData', () => {
    it('should validate QA_PAIR data successfully', () => {
      // Tests that valid QA_PAIR data passes validation without errors
      // Expects: no exceptions thrown, debug logs show successful validation
      const qaPairData: QAPairData = {
        type: 'QA_PAIR',
        question: 'What is TypeScript?',
        answer: 'TypeScript is a typed superset of JavaScript',
        confidence: 0.9,
        systemMessageId: 'msg-123',
        userMessageId: 'msg-124',
        questionField: 'tech-question',
      };

      expect(() => {
        validators.validateArtifactData(qaPairData);
      }).not.toThrow();
      expect(loggerDebugSpy).toHaveBeenCalledWith(
        '[validateArtifactData] Validation completed',
        expect.objectContaining({
          artifactType: 'QA_PAIR',
          valid: true,
        }),
      );
    });

    it('should validate DECISION data successfully', () => {
      // Tests that valid DECISION data passes validation without errors
      // Expects: no exceptions thrown for properly structured decision data
      const decisionData: DecisionData = {
        type: 'DECISION',
        title: 'Use TypeScript for new project',
        rationale: 'Better type safety and developer experience',
        alternatives: ['JavaScript', 'Flow'],
        outcome: 'TypeScript selected',
        stakeholders: ['dev-team', 'product-manager'],
      };

      expect(() => validators.validateArtifactData(decisionData)).not.toThrow();
    });

    it('should validate REQUIREMENT data successfully', () => {
      // Tests that valid REQUIREMENT data passes validation without errors
      // Expects: no exceptions thrown for requirement with valid priority and status
      const requirementData: RequirementData = {
        type: 'REQUIREMENT',
        title: 'User authentication',
        description: 'Users should be able to log in securely',
        priority: 'HIGH',
        status: 'APPROVED',
        acceptanceCriteria: ['Login form works', 'Passwords are hashed'],
      };

      expect(() => {
        validators.validateArtifactData(requirementData);
      }).not.toThrow();
    });

    it('should throw error for invalid QA_PAIR data', () => {
      // Tests that invalid QA_PAIR data (missing required fields) throws validation error
      // Expects: ArtifactDataValidationError with descriptive message about missing question
      const invalidData = {
        type: 'QA_PAIR',
        answer: 'This is an answer without a question',
        systemMessageId: 'msg-sys-1',
        userMessageId: 'msg-user-1',
      } as QAPairData;

      expect(() => validators.validateArtifactData(invalidData)).toThrow(
        ArtifactDataValidationError,
      );
      expect(() => validators.validateArtifactData(invalidData)).toThrow(
        /Question is required/,
      );
    });

    it('should throw error for invalid confidence value', () => {
      // Tests that QA_PAIR with confidence outside valid range throws error
      // Expects: ArtifactDataValidationError about confidence range (0-1)
      const invalidData: QAPairData = {
        type: 'QA_PAIR',
        question: 'What is this?',
        answer: 'This is that',
        confidence: 1.5, // Invalid: > 1
        systemMessageId: 'msg-sys-2',
        userMessageId: 'msg-user-2',
      };

      expect(() => validators.validateArtifactData(invalidData)).toThrow(
        /Confidence must be between 0 and 1/,
      );
    });

    it('should throw error for invalid REQUIREMENT priority', () => {
      // Tests that REQUIREMENT with invalid priority value throws validation error
      // Expects: ArtifactDataValidationError listing valid priority options
      const invalidData = {
        type: 'REQUIREMENT',
        title: 'Test requirement',
        description: 'Test description',
        priority: 'INVALID_PRIORITY',
        status: 'DRAFT',
      } as unknown as RequirementData;

      expect(() => validators.validateArtifactData(invalidData)).toThrow(
        /Priority must be one of: LOW, MEDIUM, HIGH, CRITICAL/,
      );
    });

    it('should validate DOCUMENT data with sections', () => {
      // Tests that DOCUMENT data with properly structured sections passes validation
      // Expects: no exceptions thrown, section validation works correctly
      const documentData: DocumentData = {
        type: 'DOCUMENT',
        title: 'API Documentation',
        content: 'This document describes our API',
        sections: [
          {
            title: 'Introduction',
            content: 'Welcome to our API',
            order: 1,
          },
          {
            title: 'Authentication',
            content: 'How to authenticate',
            order: 2,
          },
        ],
      };

      expect(() => validators.validateArtifactData(documentData)).not.toThrow();
    });

    it('should throw error for invalid DOCUMENT sections', () => {
      // Tests that DOCUMENT with malformed sections throws validation error
      // Expects: specific error about missing section title at index position
      const invalidData: DocumentData = {
        type: 'DOCUMENT',
        title: 'Test Document',
        content: 'Test content',
        sections: [
          {
            title: 'Valid section',
            content: 'Valid content',
            order: 1,
          },
          {
            title: '', // Invalid: empty title
            content: 'Invalid section',
            order: 2,
          },
        ],
      };

      expect(() => validators.validateArtifactData(invalidData)).toThrow(
        /sections\[1\]\.title/,
      );
    });

    it('should validate BUG data successfully', () => {
      // Tests that valid BUG data with all required fields passes validation
      // Expects: no exceptions thrown for properly structured bug report
      const bugData: BugData = {
        type: 'BUG',
        title: 'Login button not working',
        description: 'Button does not respond to clicks',
        reproductionSteps: [
          'Go to login page',
          'Click login button',
          'Nothing happens',
        ],
        expectedBehavior: 'Should open login modal',
        actualBehavior: 'Nothing happens',
        status: 'OPEN',
        severity: 'HIGH',
      };

      expect(() => validators.validateArtifactData(bugData)).not.toThrow();
    });

    it('should validate TASK_ORIGINAL STANDARD data with empty acceptanceCriteria', () => {
      const taskOriginalData: TaskOriginalArtifactData = {
        type: 'TASK_ORIGINAL',
        taskType: 'STANDARD',
        name: 'Create project dashboard',
        description: 'Build a dashboard view for project metrics',
        acceptanceCriteria: '',
        priority: 'medium',
      };

      expect(() =>
        validators.validateArtifactData(taskOriginalData),
      ).not.toThrow();
    });

    it('should reject TASK_ORIGINAL STANDARD data without acceptanceCriteria', () => {
      const taskOriginalData = {
        type: 'TASK_ORIGINAL',
        taskType: 'STANDARD',
        name: 'Create project dashboard',
        description: 'Build a dashboard view for project metrics',
        priority: 'medium',
      } as unknown as TaskOriginalArtifactData;

      expect(() => validators.validateArtifactData(taskOriginalData)).toThrow(
        /STANDARD task acceptance criteria are required and must be a string/,
      );
    });

    it('should reject TASK_ORIGINAL BUG data with non-empty acceptanceCriteria', () => {
      const taskOriginalData: TaskOriginalArtifactData = {
        type: 'TASK_ORIGINAL',
        taskType: 'BUG',
        name: 'Fix OAuth callback loop',
        description: 'Resolve redirect loop after provider callback',
        acceptanceCriteria: 'Callback resolves to settings page',
        priority: 'high',
      };

      expect(() => validators.validateArtifactData(taskOriginalData)).toThrow(
        /BUG task artifacts must not include acceptance criteria/,
      );
    });

    it('should log validation errors', () => {
      // Tests that validation failures are properly logged with error details
      // Expects: error logs contain artifact type and error message for debugging
      const invalidData = {
        type: 'QA_PAIR',
        question: '', // Invalid: empty question
        answer: 'Valid answer',
      } as QAPairData;

      expect(() => {
        validators.validateArtifactData(invalidData);
      }).toThrow();
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        '[validateArtifactData] Validation failed',
        expect.objectContaining({
          artifactType: 'QA_PAIR',
          error: expect.stringContaining('Question is required'),
        }),
      );
    });
  });

  describe('hasReferentialData', () => {
    it('should return true for data with references', () => {
      // Tests that hasReferentialData detects artifacts containing reference fields
      // Expects: returns true when systemMessageId or other reference fields present
      const dataWithReferences: QAPairData = {
        type: 'QA_PAIR',
        question: 'Test question',
        answer: 'Test answer',
        systemMessageId: 'msg-123',
        userMessageId: 'msg-124',
      };

      const result = validators.hasReferentialData(dataWithReferences);
      expect(result).toBe(true);
    });

    it('should return false for data without references', () => {
      // Tests that hasReferentialData returns false for self-contained artifacts
      // Expects: returns false when no reference fields are present
      const dataWithoutReferences: NoteData = {
        type: 'NOTE',
        title: 'Simple note',
        content: 'This is a standalone note',
      };

      const result = validators.hasReferentialData(dataWithoutReferences);
      expect(result).toBe(false);
    });
  });

  describe('extractReferenceIds', () => {
    it('should extract all reference IDs from artifact data', () => {
      // Tests that extractReferenceIds finds all reference fields in artifact data
      // Expects: returns array containing all reference IDs from various fields
      const dataWithMultipleReferences: DecisionData = {
        type: 'DECISION',
        title: 'Test decision',
        rationale: 'Test rationale',
        alternatives: ['option1', 'option2'],
        outcome: 'Test outcome',
        relatedArtifactIds: ['artifact-1', 'artifact-2'],
        sourceConversationId: 'conv-123',
      };

      const referenceIds = validators.extractReferenceIds(
        dataWithMultipleReferences,
      );
      expect(referenceIds).toContain('conv-123');
      expect(referenceIds).toContain('artifact-1');
      expect(referenceIds).toContain('artifact-2');
      expect(referenceIds).toHaveLength(3);
    });

    it('should return empty array for data without references', () => {
      // Tests that extractReferenceIds returns empty array for self-contained data
      // Expects: empty array when no reference fields contain values
      const dataWithoutReferences: CommentData = {
        type: 'COMMENT',
        content: 'This is a simple comment',
      };

      const referenceIds = validators.extractReferenceIds(
        dataWithoutReferences,
      );
      expect(referenceIds).toEqual([]);
    });

    it('should handle mixed reference types correctly', () => {
      // Tests that extractReferenceIds properly handles both single and array references
      // Expects: flattens array references and includes single references in result
      const mixedReferences: RequirementData = {
        type: 'REQUIREMENT',
        title: 'Test requirement',
        description: 'Test description',
        priority: 'MEDIUM',
        status: 'DRAFT',
        sourceMessageId: 'msg-456',
        relatedRequirements: ['req-1', 'req-2', 'req-3'],
      };

      const referenceIds = validators.extractReferenceIds(mixedReferences);
      expect(referenceIds).toContain('msg-456');
      expect(referenceIds).toContain('req-1');
      expect(referenceIds).toContain('req-2');
      expect(referenceIds).toContain('req-3');
      expect(referenceIds).toHaveLength(4);
    });
  });
});
