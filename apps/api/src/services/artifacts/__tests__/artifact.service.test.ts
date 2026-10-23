import { EventContextManager } from '../../../core/events/observable-event.context';
import { PrismaService } from '../../../prisma/prisma.service';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../../core/events/tokens';
import { EVENT_TYPES } from '../../../core/events/types/event.types';
import { ArtifactStatus as PrismaArtifactStatus } from '@prisma/client';
import { TagService } from '../../tag.service';
import {
  ArtifactSourceType,
  ArtifactStatus,
  ArtifactType,
  Priority,
} from '../../../generated';
import { QAPairData, CreateArtifactDto, InsightData } from '../../../generated';
import { ArtifactDataService } from '../artifact-data.service';
import { ArtifactDataValidators } from '../artifact-data.validators';
import { ArtifactGraphService } from '../artifact-graph.service';
import { ArtifactService } from '../artifact.service';
import * as TestUtils from '../../../utils/testUtils';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';
import { InfluenceService } from '../../influence/influence.service';
import { EntityRegistryService } from '../../entity-registry/entity-registry.service';
const { testIds } = TestUtils;

const getFirstCall = <T>(calls: T[][]): T[] => {
  const first = calls[0];
  if (!first) {
    throw new Error('Expected at least one call');
  }
  return first;
};

// Mock services
type MockPrismaService = ReturnType<
  typeof TestUtils.createMockPrismaService
> & {
  db: {
    artifact: ReturnType<
      typeof TestUtils.createMockPrismaService
    >['db']['artifact'] & {
      updateMany: jest.Mock;
    };
  };
};

let mockPrismaService: MockPrismaService;
const mockEntityRegistryService = {
  registerEntity: jest.fn(),
  lookupEntityTypes: jest.fn(),
  getEntitiesByIds: jest.fn(),
  registerEntities: jest.fn(),
} as unknown as jest.Mocked<EntityRegistryService>;

// Mock transaction context
const mockTxContext = {
  artifact: {
    create: jest.fn(),
  },
};

const mockTagService = {
  ...TestUtils.createMockTagService(),
  addTagsToArtifact: jest.fn(),
  syncArtifactTags: jest.fn(),
};

const mockDataService = {
  sanitizeArtifactData: jest.fn(),
  generateContentFromData: jest.fn(),
};

const mockValidators = {
  validateArtifactData: jest.fn(),
  hasReferentialData: jest.fn(),
  extractReferenceIds: jest.fn(),
};

const mockReferenceService = {
  resolveAllReferences: jest.fn(),
};

// Mock EventContextManager and WithEventContext decorator
jest.mock('../../../core/events/observable-event.context', () => ({
  EventContextManager: {
    getInstance: jest.fn(() => ({
      getCurrentContext: jest.fn(() => ({
        correlationId: 'test-correlation-123',
        organizationId: 'test-org-id',
        metadata: {},
      })),
    })),
  },
  WithEventContext: () => () => {},
  WithWorkflowContext:
    () =>
    (_target: unknown, _propertyName: string, descriptor: PropertyDescriptor) =>
      descriptor,
}));
const mockEventContextManager = {
  getInstance: jest.fn(),
  getCurrentContext: jest.fn(),
};

describe('ArtifactService', () => {
  let service: ArtifactService;
  let loggerLogSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;
  let mockEventPublisher: ReturnType<
    typeof TestUtils.createMockDomainEventPublisher
  >;
  let entityRegistryServiceMock: jest.Mocked<EntityRegistryService>;

  beforeEach(async () => {
    mockPrismaService =
      TestUtils.createMockPrismaService() as MockPrismaService;
    mockEventPublisher = TestUtils.createMockDomainEventPublisher();

    const setup = await createServiceTestingModule({
      providers: [
        ArtifactService,
        PrismaService,
        TagService,
        ArtifactDataService,
        ArtifactDataValidators,
        ArtifactGraphService,
        InfluenceService,
        EntityRegistryService,
      ],
      overrides: [
        [PrismaService, mockPrismaService],
        [DOMAIN_EVENT_PUBLISHER_TOKEN, mockEventPublisher],
        [TagService, mockTagService],
        [ArtifactDataService, mockDataService],
        [ArtifactDataValidators, mockValidators],
        [ArtifactGraphService, mockReferenceService],
        [EntityRegistryService, mockEntityRegistryService],
      ],
    });

    service = setup.module.get<ArtifactService>(ArtifactService);
    entityRegistryServiceMock = setup.module.get(EntityRegistryService);

    Object.assign(mockPrismaService.db, {
      influence: { findMany: jest.fn() },
    });

    // Setup EventContextManager mock
    (EventContextManager.getInstance as jest.Mock).mockReturnValue(
      mockEventContextManager,
    );
    mockEventContextManager.getCurrentContext.mockReturnValue({
      correlationId: 'test-correlation-123',
    });

    mockPrismaService.$transaction.mockImplementation(
      async (callback: (tx: typeof mockPrismaService.db) => Promise<unknown>) =>
        callback(mockPrismaService.db),
    );
    mockPrismaService.db.artifact.updateMany = jest
      .fn()
      .mockResolvedValue({ count: 0 });
    mockPrismaService.db.artifact.findMany?.mockReset?.();
    mockPrismaService.db.artifact.updateMany?.mockReset?.();
    mockEventPublisher.publishInTransaction?.mockReset?.();
    entityRegistryServiceMock.registerEntity.mockReset();

    // Mock logger methods directly on the service instance
    loggerLogSpy = jest.spyOn(service['logger'], 'log').mockImplementation();
    loggerErrorSpy = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    const baseDto = {
      projectId: testIds.project,
      organizationId: testIds.organization,
      type: ArtifactType.QaPair,
      title: 'Test Artifact',
      priority: Priority.Medium,
      status: ArtifactStatus.Active,
      generateEmbedding: true,
      sourceType: ArtifactSourceType.Conversation,
      sourceId: testIds.conversation,
    };

    // Mock Prisma artifact data structure (Phase 3: typed data only)
    const mockArtifactData: QAPairData = {
      type: 'QA_PAIR',
      question: 'Is Claude terrible at following directions?',
      answer: "yes, I hear Dario will delete it soon if it doesn't do better",
      confidence: 0.9,
      systemMessageId: 'msg-sys-123',
      userMessageId: 'msg-user-123',
    };

    const mockPrismaArtifact = {
      id: 'artifact-789',
      projectId: testIds.project,
      organizationId: testIds.organization,
      type: ArtifactType.QaPair,
      title: 'Test Artifact',
      data: mockArtifactData,
      embeddingModel: undefined as string | undefined,
      hasEmbedding: false,
      parentId: undefined as string | undefined,
      rootId: undefined as string | undefined,
      sourceType: ArtifactSourceType.Conversation,
      sourceId: testIds.conversation,
      contentHash: 'hash123',
      language: undefined as string | undefined,
      tags: [] as string[],
      category: undefined as string | undefined,
      priority: Priority.Medium,
      status: ArtifactStatus.Active,
      isPublic: false,
      createdAt: new Date('2024-01-01T10:00:00Z'),
      updatedAt: new Date('2024-01-01T10:00:00Z'),
      archivedAt: new Date('2024-01-01T12:00:00Z'),
    };

    const mockArtifactResponse = TestUtils.createMockArtifact({
      id: 'artifact-789',
      projectId: testIds.project,
      type: ArtifactType.QaPair,
      title: 'Test Artifact',
      data: {
        question: 'Is Claude terrible at following directions?',
        answer: "yes, I hear Dario will delete it soon if it doesn't do better",
        type: 'QA_PAIR',
        confidence: 0.9,
        systemMessageId: 'msg-sys-123',
        userMessageId: 'msg-user-123',
      } as QAPairData,
      embeddingModel: undefined as string | undefined,
      hasEmbedding: false,
      parentId: undefined as string | undefined,
      rootId: undefined as string | undefined,
      sourceType: ArtifactSourceType.Conversation,
      sourceId: testIds.conversation,
      contentHash: 'hash123',
      language: undefined as string | undefined,
      tags: [] as string[],
      tagRelations: [],
      category: undefined as string | undefined,
      priority: Priority.Medium,
      status: ArtifactStatus.Active,
      isPublic: false,
      createdAt: '2024-01-01T10:00:00.000Z',
      updatedAt: '2024-01-01T10:00:00.000Z',
      archivedAt: '2024-01-01T12:00:00.000Z',
    });

    it('should create artifact with typed data format', async () => {
      // Tests that new typed data format is processed correctly
      // Expects: validation, sanitization, content generation, and artifact creation
      const typedData: QAPairData = {
        type: 'QA_PAIR',
        question: 'What is NestJS?',
        answer: 'NestJS is a Node.js framework',
        confidence: 0.9,
        systemMessageId: 'msg-sys-123',
        userMessageId: 'msg-user-123',
      };

      const typedDto: CreateArtifactDto = {
        ...baseDto,
        data: typedData,
      };

      const sanitizedData: QAPairData = {
        ...typedData,
        question: 'What is NestJS?', // Already clean
        answer: 'NestJS is a Node.js framework',
      };

      // Setup mocks
      mockValidators.validateArtifactData.mockReturnValue(undefined);
      mockDataService.sanitizeArtifactData.mockReturnValue(sanitizedData);
      mockValidators.hasReferentialData.mockReturnValue(true);
      mockTxContext.artifact.create.mockResolvedValue(mockPrismaArtifact);
      mockPrismaService.$transaction.mockImplementation((callback) =>
        callback(mockTxContext),
      );

      const result = await service.create(typedDto);

      // Verify validation was called
      expect(mockValidators.validateArtifactData).toHaveBeenCalledWith(
        typedData,
        'test-correlation-123',
      );

      // Verify sanitization was called
      expect(mockDataService.sanitizeArtifactData).toHaveBeenCalledWith(
        typedData,
        'test-correlation-123',
      );

      // Phase 3: No content generation needed - data stored directly

      // Verify database was called with typed data (Phase 3: no content/metadata)
      expect(mockTxContext.artifact.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectId: baseDto.projectId,
            organizationId: baseDto.organizationId,
            type: baseDto.type,
            title: baseDto.title,
            data: sanitizedData, // Phase 3: stores typed data directly
          }),
        }),
      );

      expect(result).toEqual(mockArtifactResponse);

      // Verify logging
      expect(loggerLogSpy).toHaveBeenCalledWith(
        '[createTyped] Creating typed artifact',
        expect.objectContaining({
          artifactType: 'QA_PAIR',
          projectId: baseDto.projectId,
          organizationId: baseDto.organizationId,
          hasData: true,
          correlationId: 'test-correlation-123',
        }),
      );
    });

    it('should throw error when data field is missing', async () => {
      // Tests that DTO validation catches missing required data field
      // Expects: descriptive error thrown for invalid DTO structure
      const invalidDto: CreateArtifactDto = {
        ...baseDto,
        // Missing required 'data' field
      };

      await expect(service.create(invalidDto)).rejects.toThrow(
        'Typed data is required',
      );

      expect(mockTxContext.artifact.create).not.toHaveBeenCalled();
    });

    it('should handle validation errors appropriately', async () => {
      // Tests that validation errors are propagated correctly
      // Expects: validation error logged and re-thrown for handling
      const invalidData: QAPairData = {
        type: 'QA_PAIR',
        question: '', // Invalid: empty question
        answer: 'Valid answer',
        systemMessageId: 'msg-sys-123',
        userMessageId: 'msg-user-123',
      };

      const typedDto: CreateArtifactDto = {
        ...baseDto,
        data: invalidData,
      };

      const validationError = new Error(
        'Question is required and cannot be empty',
      );
      mockValidators.validateArtifactData.mockImplementation(() => {
        throw validationError;
      });

      await expect(service.create(typedDto)).rejects.toThrow(validationError);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        '[createTyped] Failed to create typed artifact',
        expect.objectContaining({
          artifactType: 'QA_PAIR',
          error: 'Question is required and cannot be empty',
        }),
      );
    });
  });

  describe('resolveReferences', () => {
    const organizationId = testIds.organization;

    it('should resolve all references in artifact data', async () => {
      // Tests that references in artifact data are properly resolved
      const artifactData: QAPairData = {
        type: 'QA_PAIR',
        question: 'Question with references',
        answer: 'Answer with references',
        systemMessageId: 'msg-sys-789',
        userMessageId: 'msg-user-101',
      };

      const mockResolvedReferences = {
        messages: [
          {
            id: 'msg-sys-789',
            content: 'System response',
            type: 'SYSTEM' as const,
            timestamp: new Date(),
            conversationId: 'conv-456',
            data: {},
          },
          {
            id: 'msg-user-101',
            content: 'User question',
            type: 'USER' as const,
            timestamp: new Date(),
            conversationId: 'conv-456',
            data: {},
          },
        ],
        conversations: [] as Array<unknown>,
        artifacts: [] as Array<unknown>,
        questionContext: {
          question: 'Question with references',
          answer: 'Answer with references',
          systemMessage: {
            id: 'msg-sys-789',
            content: 'System response',
            type: 'SYSTEM' as const,
            timestamp: new Date(),
            conversationId: 'conv-456',
            data: {},
          },
          userMessage: {
            id: 'msg-user-101',
            content: 'User question',
            type: 'USER' as const,
            timestamp: new Date(),
            conversationId: 'conv-456',
            data: {},
          },
        },
      };

      // Setup mocks
      mockReferenceService.resolveAllReferences.mockResolvedValue(
        mockResolvedReferences,
      );

      const result = await service.resolveReferences(
        artifactData,
        organizationId,
      );

      expect(mockReferenceService.resolveAllReferences).toHaveBeenCalledWith(
        artifactData,
        organizationId,
        'test-correlation-123',
      );

      expect(result).toEqual({
        data: artifactData,
        resolvedReferences: mockResolvedReferences,
      });
    });
  });

  describe('findInfluences', () => {
    const organizationId = testIds.organization;
    const sourceId = 'source-record-123';
    let influenceFindMany: jest.Mock;

    beforeEach(() => {
      influenceFindMany = jest.fn();
      Object.assign(mockPrismaService.db, {
        influence: {
          findMany: influenceFindMany,
        },
      });
    });

    it('returns unique influencing artifacts for a source record', async () => {
      const sharedTimestamp = new Date('2024-01-01T00:00:00Z');

      const influencingArtifactA = TestUtils.createMockArtifact({
        id: 'artifact-source-1',
        projectId: testIds.project,
        type: ArtifactType.Insight,
        title: 'Insight A',
        data: {
          type: 'INSIGHT',
          confidence: 0.9,
          reasoning: 'Insight A rationale',
          content: 'Details A',
        } as InsightData,
        hasEmbedding: false,
        parentId: undefined,
        rootId: undefined,
        sourceType: ArtifactSourceType.Initiative,
        sourceId,
        tags: [],
        status: ArtifactStatus.Active,
        createdAt: sharedTimestamp.toISOString(),
        updatedAt: sharedTimestamp.toISOString(),
        archivedAt: undefined,
      });

      const influencingArtifactB = TestUtils.createMockArtifact({
        ...influencingArtifactA,
        id: 'artifact-source-2',
        title: 'Insight B',
        data: {
          type: 'INSIGHT',
          confidence: 0.8,
          reasoning: 'Insight B rationale',
          content: 'Details B',
        } as InsightData,
      });

      const influenceRecords = [
        {
          id: 'influence-1',
          influencedId: 'artifact-target-1',
          influencingId: 'artifact-source-1',
          reasoning: 'First dependency',
          reasonType: 'CONTEXT',
          confidence: 0.9,
          organizationId,
          createdAt: sharedTimestamp,
        },
        {
          id: 'influence-2',
          influencedId: 'artifact-target-2',
          influencingId: 'artifact-source-1',
          reasoning: 'Duplicate source reference',
          reasonType: 'CONTEXT',
          confidence: 0.8,
          organizationId,
          createdAt: sharedTimestamp,
        },
        {
          id: 'influence-3',
          influencedId: 'artifact-target-3',
          influencingId: 'artifact-source-2',
          reasoning: 'Second dependency',
          reasonType: 'CONTEXT',
          confidence: 0.95,
          organizationId,
          createdAt: sharedTimestamp,
        },
        {
          id: 'influence-4',
          influencedId: 'artifact-target-4',
          influencingId: 'artifact-missing',
          reasoning: 'Missing artifact',
          reasonType: 'CONTEXT',
          confidence: 0.3,
          organizationId,
          createdAt: sharedTimestamp,
        },
      ];

      mockPrismaService.db.artifact.findMany
        .mockResolvedValueOnce([
          {
            id: 'artifact-1',
            organizationId,
            projectId: testIds.project,
            sourceId,
            sourceType: 'INITIATIVE',
          },
        ])
        .mockResolvedValueOnce([influencingArtifactA, influencingArtifactB]);
      influenceFindMany.mockResolvedValue(influenceRecords);

      const result = await service.findInfluences(
        { sourceId, sourceType: 'INITIATIVE' as ArtifactSourceType },
        organizationId,
      );

      expect(result).toHaveLength(2);
      expect(result).toEqual([
        expect.objectContaining({ id: 'artifact-source-1', sourceId }),
        expect.objectContaining({ id: 'artifact-source-2', sourceId }),
      ]);

      expect(influenceFindMany).toHaveBeenCalledWith({
        where: {
          organizationId,
          influencedId: { in: ['artifact-1'] },
          influencedType: 'artifact',
          influencingType: 'artifact',
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('passes along reasonType when provided', async () => {
      mockPrismaService.db.artifact.findMany
        .mockResolvedValueOnce([
          {
            id: 'artifact-1',
            organizationId,
            projectId: testIds.project,
            sourceId,
            sourceType: 'CONVERSATION',
          },
        ])
        .mockResolvedValueOnce([]);
      influenceFindMany.mockResolvedValue([]);

      await service.findInfluences(
        { sourceId, reasonType: 'REQUIREMENT' },
        organizationId,
      );

      expect(influenceFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId,
            reasonType: 'REQUIREMENT',
          }),
        }),
      );
    });

    it('returns an empty array when no influences are found', async () => {
      mockPrismaService.db.artifact.findMany
        .mockResolvedValueOnce([
          {
            id: 'artifact-1',
            organizationId,
            projectId: testIds.project,
            sourceId,
            sourceType: 'CONVERSATION',
          },
        ])
        .mockResolvedValueOnce([]);
      influenceFindMany.mockResolvedValue([]);

      const result = await service.findInfluences({ sourceId }, organizationId);

      expect(result).toEqual([]);
    });
  });

  describe('archiveBySource', () => {
    const organizationId = testIds.organization;
    const projectId = testIds.project;
    const sourceType = ArtifactSourceType.Conversation;
    const sourceIds = [testIds.conversation];

    it('archives active artifacts and emits events', async () => {
      mockPrismaService.db.artifact.findMany.mockResolvedValue([
        {
          id: 'artifact-1',
          projectId,
          sourceId: testIds.conversation,
        },
      ]);
      mockPrismaService.db.artifact.updateMany.mockResolvedValue({ count: 1 });

      const updatedCount = await service.archiveBySource({
        organizationId,
        sourceType,
        sourceIds,
      });

      expect(updatedCount).toBe(1);
      expect(mockPrismaService.db.artifact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId,
            sourceType,
            sourceId: { in: sourceIds },
            status: { not: PrismaArtifactStatus.ARCHIVED },
          }),
        }),
      );
      expect(mockPrismaService.db.artifact.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId,
            sourceType,
            sourceId: { in: sourceIds },
            status: { not: PrismaArtifactStatus.ARCHIVED },
            id: { in: ['artifact-1'] },
          }),
        }),
      );
      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledTimes(1);

      const [firstCall] = mockEventPublisher.publishInTransaction.mock.calls;
      if (!firstCall) {
        throw new Error('Expected publishInTransaction call');
      }
      const [tx, event] = firstCall;
      expect(tx).toBe(mockPrismaService.db);
      expect(event).toMatchObject({
        type: EVENT_TYPES.ARTIFACT.ARCHIVED,
        aggregateId: 'artifact-1',
        payload: expect.objectContaining({
          organizationId,
          projectId,
          artifactId: 'artifact-1',
          sourceType,
          sourceId: testIds.conversation,
        }),
      });
      const archivedPayload = event.payload as {
        archivedAt?: string;
        timestamp?: string;
      };
      expect(archivedPayload.archivedAt).toEqual(archivedPayload.timestamp);
      expect(typeof archivedPayload.archivedAt).toBe('string');
    });

    it('returns 0 when there are no artifacts to archive', async () => {
      mockPrismaService.db.artifact.findMany.mockResolvedValue([]);

      const updatedCount = await service.archiveBySource({
        organizationId,
        sourceType,
        sourceIds,
      });

      expect(updatedCount).toBe(0);
      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      expect(mockEventPublisher.publishInTransaction).not.toHaveBeenCalled();
    });
  });

  describe('restoreArchivedBySource', () => {
    const organizationId = testIds.organization;
    const projectId = testIds.project;
    const sourceType = ArtifactSourceType.Conversation;
    const sourceIds = [testIds.conversation];

    it('restores archived artifacts and emits events', async () => {
      mockPrismaService.db.artifact.findMany.mockResolvedValue([
        {
          id: 'artifact-1',
          projectId,
          sourceId: testIds.conversation,
        },
      ]);
      mockPrismaService.db.artifact.updateMany.mockResolvedValue({ count: 1 });

      const restoredCount = await service.restoreArchivedBySource({
        organizationId,
        sourceType,
        sourceIds,
      });

      expect(restoredCount).toBe(1);
      expect(mockPrismaService.db.artifact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId,
            sourceType,
            sourceId: { in: sourceIds },
            status: PrismaArtifactStatus.ARCHIVED,
          }),
        }),
      );
      expect(mockPrismaService.db.artifact.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId,
            sourceType,
            sourceId: { in: sourceIds },
            status: PrismaArtifactStatus.ARCHIVED,
            id: { in: ['artifact-1'] },
          }),
        }),
      );
      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledTimes(1);

      const [tx, event] = getFirstCall(
        mockEventPublisher.publishInTransaction.mock.calls,
      );
      expect(tx).toBe(mockPrismaService.db);
      expect(event).toMatchObject({
        type: EVENT_TYPES.ARTIFACT.RESTORED,
        aggregateId: 'artifact-1',
        payload: expect.objectContaining({
          organizationId,
          projectId,
          artifactId: 'artifact-1',
          sourceType,
          sourceId: testIds.conversation,
        }),
      });
      const restoredPayload = event.payload as {
        restoredAt?: string;
        timestamp?: string;
      };
      expect(restoredPayload.restoredAt).toEqual(restoredPayload.timestamp);
      expect(typeof restoredPayload.restoredAt).toBe('string');
    });

    it('returns 0 when there are no archived artifacts to restore', async () => {
      mockPrismaService.db.artifact.findMany.mockResolvedValue([]);

      const restoredCount = await service.restoreArchivedBySource({
        organizationId,
        sourceType,
        sourceIds,
      });

      expect(restoredCount).toBe(0);
      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      expect(mockEventPublisher.publishInTransaction).not.toHaveBeenCalled();
    });
  });

  describe('EntityRegistry Integration', () => {
    const organizationId = testIds.organization;
    const projectId = testIds.project;

    it('should register artifact with title in EntityRegistry when creating', async () => {
      const typedData: QAPairData = {
        type: 'QA_PAIR',
        question: 'What is NestJS?',
        answer: 'NestJS is a Node.js framework',
        confidence: 0.9,
        systemMessageId: 'msg-sys-123',
        userMessageId: 'msg-user-123',
      };

      const createDto: CreateArtifactDto = {
        projectId,
        organizationId,
        type: ArtifactType.QaPair,
        title: 'NestJS Overview',
        priority: Priority.Medium,
        status: ArtifactStatus.Active,
        generateEmbedding: true,
        sourceType: ArtifactSourceType.Conversation,
        sourceId: testIds.conversation,
        data: typedData,
      };

      const mockCreatedArtifact = TestUtils.createMockArtifact({
        id: 'artifact-123',
        projectId,
        title: 'NestJS Overview',
        type: ArtifactType.QaPair,
      });

      mockValidators.validateArtifactData.mockReturnValue(undefined);
      mockDataService.sanitizeArtifactData.mockReturnValue(typedData);
      mockValidators.hasReferentialData.mockReturnValue(false);
      mockTxContext.artifact.create.mockResolvedValue(mockCreatedArtifact);
      mockPrismaService.$transaction.mockImplementation((callback) =>
        callback(mockTxContext),
      );

      await service.create(createDto);

      // Verify EntityRegistry was called with the artifact title
      expect(entityRegistryServiceMock.registerEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          entityId: mockCreatedArtifact.id,
          entityType: expect.any(String),
          name: 'NestJS Overview',
        }),
        expect.anything(),
      );
    });

    it('should register artifacts with names in EntityRegistry for batch operations', async () => {
      const organizationId = testIds.organization;
      const projectId = testIds.project;

      const typedData: QAPairData = {
        type: 'QA_PAIR',
        question: 'Q1',
        answer: 'A1',
        systemMessageId: 'msg-sys-123',
        userMessageId: 'msg-user-123',
      };

      const mockCreatedArtifact = TestUtils.createMockArtifact({
        id: 'artifact-batch',
        title: 'Batch Artifact',
      });

      const mockTx = {
        artifact: {
          create: jest.fn().mockResolvedValue(mockCreatedArtifact),
          createMany: jest.fn().mockResolvedValue({ count: 2 }),
        },
      };

      mockValidators.validateArtifactData.mockReturnValue(undefined);
      mockDataService.sanitizeArtifactData.mockReturnValue(typedData);
      mockValidators.hasReferentialData.mockReturnValue(false);
      mockPrismaService.$transaction.mockImplementation((callback) =>
        callback(mockTx),
      );

      await service.create({
        projectId,
        organizationId,
        type: ArtifactType.QaPair,
        title: 'Batch Artifact',
        data: typedData,
        sourceType: ArtifactSourceType.Conversation,
        sourceId: testIds.conversation,
      });

      // Verify registerEntity was called with the correct name
      expect(entityRegistryServiceMock.registerEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          entityId: 'artifact-batch',
          name: 'Batch Artifact',
        }),
        expect.anything(),
      );
    });

    it('should reject artifacts when title is not provided', async () => {
      const typedData: QAPairData = {
        type: 'QA_PAIR',
        question: 'Question',
        answer: 'Answer',
        systemMessageId: 'msg-sys-123',
        userMessageId: 'msg-user-123',
      };

      const createDto: CreateArtifactDto = {
        projectId: testIds.project,
        organizationId: testIds.organization,
        type: ArtifactType.QaPair,
        priority: Priority.Low,
        status: ArtifactStatus.Active,
        sourceType: ArtifactSourceType.Conversation,
        sourceId: testIds.conversation,
        data: typedData,
        // No title provided
      };

      mockValidators.validateArtifactData.mockReturnValue(undefined);
      mockDataService.sanitizeArtifactData.mockReturnValue(typedData);
      mockValidators.hasReferentialData.mockReturnValue(false);
      mockTxContext.artifact.create.mockResolvedValue(
        TestUtils.createMockArtifact({
          id: 'artifact-no-title',
          title: undefined,
        }),
      );
      mockPrismaService.$transaction.mockImplementation((callback) =>
        callback(mockTxContext),
      );

      await expect(service.create(createDto)).rejects.toThrow(
        'missing a title',
      );
      expect(entityRegistryServiceMock.registerEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          entityId: 'artifact-no-title',
          name: 'Untitled Artifact',
        }),
        expect.anything(),
      );
    });
  });
});
