import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { EntityType, Prisma } from '@prisma/client';
import { MentionProcessingService } from '../mention-processing.service';
import {
  EntityRegistryLookupError,
  EntityRegistryService,
} from '../../entity-registry/entity-registry.service';
import * as TestUtils from '../../../utils/testUtils';

const { testIds } = TestUtils;

describe('MentionProcessingService', () => {
  let service: MentionProcessingService;
  let mockRegistry: { lookupEntityTypes: jest.Mock };
  const tx = {} as Prisma.TransactionClient;

  beforeEach(async () => {
    mockRegistry = {
      lookupEntityTypes: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MentionProcessingService,
        { provide: EntityRegistryService, useValue: mockRegistry },
      ],
    }).compile();
    service = module.get<MentionProcessingService>(MentionProcessingService);
  });

  describe('extractMentionTokens', () => {
    it('returns [] for null/empty content', () => {
      expect(service.extractMentionTokens(null)).toEqual([]);
      expect(service.extractMentionTokens('')).toEqual([]);
    });

    it('parses well-formed @[type:id|title] tokens', () => {
      const tokens = service.extractMentionTokens(
        `Refers to @[task:${testIds.task}|Task A] and @[design-doc:${testIds.designDoc}|Doc B]`,
      );
      expect(tokens).toEqual([
        { entityId: testIds.task, entityType: 'task' },
        { entityId: testIds.designDoc, entityType: 'design-doc' },
      ]);
    });
  });

  describe('mapMentionEntityType', () => {
    it('maps canonical type strings to EntityType', () => {
      expect(service.mapMentionEntityType('task')).toBe(EntityType.TASK);
      expect(service.mapMentionEntityType('design-doc')).toBe(
        EntityType.DESIGN_DOC,
      );
      expect(service.mapMentionEntityType('design_doc')).toBe(
        EntityType.DESIGN_DOC,
      );
      expect(service.mapMentionEntityType('artifact')).toBe(
        EntityType.ARTIFACT,
      );
    });

    it('resolves feature/goal/bug aliases to EntityType.TASK', () => {
      expect(service.mapMentionEntityType('feature')).toBe(EntityType.TASK);
      expect(service.mapMentionEntityType('goal')).toBe(EntityType.TASK);
      expect(service.mapMentionEntityType('bug')).toBe(EntityType.TASK);
    });

    it('returns null for genuinely unsupported types', () => {
      expect(service.mapMentionEntityType('widget')).toBeNull();
      expect(service.mapMentionEntityType('')).toBeNull();
    });
  });

  describe('validateMentions', () => {
    it('does not reinterpret retired Plan Step identities', () => {
      expect(service.mapMentionEntityType('plan_step')).toBeNull();
    });

    it('returns [] for empty token input without touching the registry', async () => {
      const result = await service.validateMentions(
        [],
        testIds.organization,
        tx,
      );
      expect(result).toEqual([]);
      expect(mockRegistry.lookupEntityTypes).not.toHaveBeenCalled();
    });

    it('skips unresolvable ids and returns the rest', async () => {
      const realId = testIds.task;
      const missingId = '00000000-0000-0000-0000-000000000999';
      // First call throws missing; service then re-queries with the filtered set.
      mockRegistry.lookupEntityTypes
        .mockImplementationOnce(() => {
          throw new EntityRegistryLookupError('missing', {
            missingIds: [missingId],
          });
        })
        .mockResolvedValueOnce({ [realId]: EntityType.TASK });

      const result = await service.validateMentions(
        [
          { entityId: realId, entityType: 'task' },
          { entityId: missingId, entityType: 'task' },
        ],
        testIds.organization,
        tx,
      );

      expect(result).toEqual([
        { entityId: realId, entityType: EntityType.TASK },
      ]);
    });

    it('throws BadRequest on ambiguous ids — the registry cannot disambiguate so we refuse', async () => {
      mockRegistry.lookupEntityTypes.mockImplementation(() => {
        throw new EntityRegistryLookupError('ambiguous', {
          ambiguousIds: [testIds.task],
        });
      });

      await expect(
        service.validateMentions(
          [{ entityId: testIds.task, entityType: 'task' }],
          testIds.organization,
          tx,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('skips type-mismatched mentions (e.g. @[task:<doc-id>])', async () => {
      mockRegistry.lookupEntityTypes.mockResolvedValue({
        [testIds.designDoc]: EntityType.DESIGN_DOC,
      });

      const result = await service.validateMentions(
        [{ entityId: testIds.designDoc, entityType: 'task' }],
        testIds.organization,
        tx,
      );
      expect(result).toEqual([]);
    });

    it('dedups duplicate mentions of the same entity', async () => {
      mockRegistry.lookupEntityTypes.mockResolvedValue({
        [testIds.task]: EntityType.TASK,
      });

      const result = await service.validateMentions(
        [
          { entityId: testIds.task, entityType: 'task' },
          { entityId: testIds.task, entityType: 'task' },
        ],
        testIds.organization,
        tx,
      );
      expect(result).toEqual([
        { entityId: testIds.task, entityType: EntityType.TASK },
      ]);
    });
  });

  describe('extractAndValidate', () => {
    it('returns [] for empty content (skips the registry)', async () => {
      const result = await service.extractAndValidate(
        '',
        testIds.organization,
        tx,
      );
      expect(result).toEqual([]);
      expect(mockRegistry.lookupEntityTypes).not.toHaveBeenCalled();
    });

    it('extracts then validates in one call', async () => {
      mockRegistry.lookupEntityTypes.mockResolvedValue({
        [testIds.task]: EntityType.TASK,
      });

      const result = await service.extractAndValidate(
        `Mention @[task:${testIds.task}|Title]`,
        testIds.organization,
        tx,
      );
      expect(result).toEqual([
        { entityId: testIds.task, entityType: EntityType.TASK },
      ]);
    });
  });
});
