import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  CommentData,
  DecisionData,
  DocumentData,
  QAPairData,
} from '../../../generated';
import { ArtifactDataService } from '../artifact-data.service';

describe('ArtifactDataService', () => {
  let service: ArtifactDataService;
  let loggerDebugSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ArtifactDataService],
    }).compile();

    service = module.get<ArtifactDataService>(ArtifactDataService);

    // Spy on logger methods
    loggerDebugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sanitizeArtifactData', () => {
    it('should sanitize QA_PAIR data by trimming strings', () => {
      // Tests that string fields are properly trimmed and sanitized
      // Expects: leading/trailing whitespace removed from question and answer
      const dirtyData: QAPairData = {
        type: 'QA_PAIR',
        question: '  What is sanitization?  ',
        answer: '  It removes unwanted characters  ',
        confidence: 0.88,
        systemMessageId: 'msg-sys-1',
        userMessageId: 'msg-user-1',
      };

      const sanitized = service.sanitizeArtifactData(dirtyData);

      expect(sanitized.type).toBe('QA_PAIR');
      const sanitizedQA = sanitized as QAPairData;
      expect(sanitizedQA.question).toBe('What is sanitization?');
      expect(sanitizedQA.answer).toBe('It removes unwanted characters');
      expect(sanitizedQA.confidence).toBe(0.88);
    });

    it('should sanitize DECISION data arrays', () => {
      // Tests that array fields are properly cleaned and deduplicated
      // Expects: array items trimmed and duplicates removed
      const dirtyData: DecisionData = {
        type: 'DECISION',
        title: '  Choose framework  ',
        rationale: '  Better performance  ',
        alternatives: ['  React  ', 'Vue', '  React  ', '  Angular  '],
        outcome: '  React chosen  ',
        stakeholders: ['  team-lead  ', 'developer', '  team-lead  '],
      };

      const sanitized = service.sanitizeArtifactData(dirtyData);

      expect(sanitized.type).toBe('DECISION');
      const sanitizedDecision = sanitized as DecisionData;
      expect(sanitizedDecision.title).toBe('Choose framework');
      expect(sanitizedDecision.rationale).toBe('Better performance');
      expect(sanitizedDecision.alternatives).toEqual([
        'React',
        'Vue',
        'Angular',
      ]);
      expect(sanitizedDecision.stakeholders).toEqual([
        'team-lead',
        'developer',
      ]);
    });

    it('should handle document sections sanitization', () => {
      // Tests that nested document sections are properly sanitized
      // Expects: section titles and content trimmed, orders preserved
      const dirtyData: DocumentData = {
        type: 'DOCUMENT',
        title: '  API Guide  ',
        content: '  Comprehensive API documentation  ',
        sections: [
          {
            title: '  Introduction  ',
            content: '  Getting started  ',
            order: 1,
          },
          { title: '  Examples  ', content: '  Code samples  ', order: 2 },
        ],
      };

      const sanitized = service.sanitizeArtifactData(dirtyData);

      expect(sanitized.type).toBe('DOCUMENT');
      const sanitizedDoc = sanitized as DocumentData;
      expect(sanitizedDoc.title).toBe('API Guide');
      expect(sanitizedDoc.content).toBe('Comprehensive API documentation');
      expect(sanitizedDoc.sections?.[0]?.title).toBe('Introduction');
      expect(sanitizedDoc.sections?.[0]?.content).toBe('Getting started');
      expect(sanitizedDoc.sections?.[1]?.title).toBe('Examples');
    });

    it('should preserve reference IDs during sanitization', () => {
      // Tests that reference fields are preserved without modification during sanitization
      // Expects: systemMessageId, userMessageId, and other references unchanged
      const dataWithReferences: QAPairData = {
        type: 'QA_PAIR',
        question: '  Test question  ',
        answer: '  Test answer  ',
        systemMessageId: 'msg-system-123',
        userMessageId: 'msg-user-456',
        questionField: 'technical-question',
      };

      const sanitized = service.sanitizeArtifactData(dataWithReferences);

      const sanitizedQA = sanitized as QAPairData;
      expect(sanitizedQA.systemMessageId).toBe('msg-system-123');
      expect(sanitizedQA.userMessageId).toBe('msg-user-456');
      expect(sanitizedQA.questionField).toBe('technical-question');
    });

    it('should log sanitization warnings for problematic data', () => {
      // Tests that sanitization process logs warnings when cleaning problematic data
      // Expects: warn logs when significant cleaning is performed
      const problematicData: CommentData = {
        type: 'COMMENT',
        content: '   ', // Empty/whitespace content
      };
      const correlationId = 'sanitize-test-789';

      service.sanitizeArtifactData(problematicData, correlationId);

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        '[sanitizeArtifactData] Empty content after sanitization',
        expect.objectContaining({
          artifactType: 'COMMENT',
          correlationId,
        }),
      );
    });
  });
});
