/* eslint-disable @typescript-eslint/unbound-method */
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { QAPairData } from '../../../generated/model/qAPairData';
import { RequirementData } from '../../../generated/model/requirementData';
import { PrismaService } from '../../../prisma/prisma.service';
import { ArtifactDataValidators } from '../artifact-data.validators';
import {
  ArtifactGraphService,
  QuestionContext,
  ResolvedArtifact,
  ResolvedMessage,
} from '../artifact-graph.service';

import * as TestUtils from '../../../utils/testUtils';
const { testIds } = TestUtils;
const RelationshipType = {
  StatedRequirement: 'stated_requirement',
  ProvidedBackground: 'provided_background',
  AnsweredQuestion: 'answered_question',
  BuildsUpon: 'builds_upon',
  Clarifies: 'clarifies',
  ProvidesEvidence: 'provides_evidence',
  ChallengesAssumption: 'challenges_assumption',
} as const;

// Mock services using TestUtils
const mockPrismaService = TestUtils.createMockPrismaService();
const mockValidators = {
  extractReferenceIds: jest.fn(),
};

describe('ArtifactGraphService', () => {
  let service: ArtifactGraphService;
  let loggerDebugSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArtifactGraphService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ArtifactDataValidators, useValue: mockValidators },
      ],
    }).compile();

    service = module.get<ArtifactGraphService>(ArtifactGraphService);

    // Spy on logger methods
    loggerDebugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('resolveAllReferences', () => {
    const organizationId = testIds.organization;

    it('should resolve all references in QA_PAIR data', async () => {
      // Tests bulk reference resolution for QA_PAIR with multiple reference types
      // Expects: all reference types resolved and returned in structured format
      const qaPairData: QAPairData = {
        type: 'QA_PAIR',
        question: 'Bulk resolution test',
        answer: 'All references resolved',
        systemMessageId: 'msg-sys-bulk',
        userMessageId: 'msg-user-bulk',
      };

      mockValidators.extractReferenceIds.mockReturnValue([
        'msg-sys-bulk',
        'msg-user-bulk',
      ]);

      const mockSystemMessage: ResolvedMessage = {
        id: 'msg-sys-bulk',
        content: 'System message',
        type: 'SYSTEM',
        timestamp: new Date(),
        conversationId: 'conv-bulk',
        data: {},
      };

      const mockQuestionContext: QuestionContext = {
        question: 'Bulk resolution test',
        answer: 'All references resolved',
        systemMessage: mockSystemMessage,
        userMessage: undefined,
      };

      jest
        .spyOn(service, 'resolveSystemMessage')
        .mockResolvedValue(mockSystemMessage);
      jest.spyOn(service, 'resolveUserMessage').mockResolvedValue(null);
      jest
        .spyOn(service, 'resolveQuestionContext')
        .mockResolvedValue(mockQuestionContext);
      jest.spyOn(service, 'resolveRelatedArtifacts').mockResolvedValue([]);

      const result = await service.resolveAllReferences(
        qaPairData,
        organizationId,
      );

      expect(result).toEqual({
        messages: [mockSystemMessage],
        conversations: [],
        artifacts: [],
        questionContext: mockQuestionContext,
      });

      expect(mockValidators.extractReferenceIds).toHaveBeenCalledWith(
        qaPairData,
      );
    });

    it('should resolve related artifacts from reference IDs', async () => {
      // Tests that related artifacts are resolved from extracted reference IDs
      // Expects: artifact references filtered and resolved correctly
      const requirementData: RequirementData = {
        type: 'REQUIREMENT',
        title: 'Authentication requirement',
        description: 'Users must authenticate',
        priority: 'HIGH',
        status: 'APPROVED',
        relatedRequirements: ['req-1', 'req-2'],
        sourceMessageId: 'msg-source-123',
      };

      mockValidators.extractReferenceIds.mockReturnValue([
        'msg-source-123',
        'req-1',
        'req-2',
      ]);

      const mockArtifacts: ResolvedArtifact[] = [
        {
          id: 'req-1',
          type: 'REQUIREMENT',
          title: 'Related requirement 1',
          data: {
            type: 'REQUIREMENT',
            title: 'Related requirement 1',
            description: 'First related requirement',
            priority: 'MEDIUM',
            status: 'DRAFT',
          } as RequirementData,
          projectId: 'proj-8',
          organizationId,
          createdAt: new Date(),
        },
      ];

      jest.spyOn(service, 'resolveQuestionContext').mockResolvedValue(null);
      jest
        .spyOn(service, 'resolveRelatedArtifacts')
        .mockResolvedValue(mockArtifacts);

      const result = await service.resolveAllReferences(
        requirementData,
        organizationId,
      );

      expect(result.artifacts).toEqual(mockArtifacts);
      // Service filters out short IDs (< 10 chars) assuming they're not artifact IDs
      expect(service.resolveRelatedArtifacts).toHaveBeenCalledWith(
        ['msg-source-123'], // Only longer IDs are passed as potential artifact references
        organizationId,
        undefined,
      );
    });

    it('should handle bulk resolution errors gracefully', async () => {
      // Tests that bulk resolution handles errors without crashing
      // Expects: empty result structure returned when errors occur
      const invalidData: QAPairData = {
        type: 'QA_PAIR',
        question: 'Error test',
        answer: 'Should handle errors',
        systemMessageId: 'msg-sys-error',
        userMessageId: 'msg-user-error',
      };

      mockValidators.extractReferenceIds.mockImplementation(() => {
        throw new Error('Reference extraction failed');
      });

      const result = await service.resolveAllReferences(
        invalidData,
        organizationId,
      );

      expect(result).toEqual({
        messages: [],
        conversations: [],
        artifacts: [],
      });

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        '[resolveAllReferences] Bulk reference resolution failed',
        expect.objectContaining({
          artifactType: 'QA_PAIR',
          organizationId,
          error: 'Reference extraction failed',
        }),
      );
    });
  });
});
