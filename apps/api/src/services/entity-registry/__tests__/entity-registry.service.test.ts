import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  EntityRegistryService,
  EntityTitleMatchTier,
  hasBoundedTypoTokenMatch,
  hasOrderedTokenPrefixMatch,
  hasTokenSubsetMatch,
  normalizeEntityNameForSearch,
  rankEntityTitleMatch,
} from '../entity-registry.service';
import { OrganizationId } from '../../../types';
import { EntitySearchResult } from 'src/generated';
import { EntityType, Prisma } from '@prisma/client';
import { NON_ARTIFACT_ENTITY_TYPES } from '../entity-registry.constants';

describe('EntityRegistryService', () => {
  let service: EntityRegistryService;
  let prisma: PrismaService;

  const organizationId = 'org-123' as OrganizationId;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntityRegistryService,
        {
          provide: PrismaService,
          useValue: {
            db: {
              $queryRaw: jest.fn(),
              entityRegistry: {
                upsert: jest.fn(),
                updateMany: jest.fn(),
              },
              attentionEvent: {
                deleteMany: jest.fn(),
              },
            },
          },
        },
      ],
    }).compile();

    service = module.get<EntityRegistryService>(EntityRegistryService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('title matching helpers', () => {
    it('normalizes case, whitespace, and punctuation separators', () => {
      expect(normalizeEntityNameForSearch('  Search--Agent\tUI  ')).toBe(
        'search agent ui',
      );
    });

    it('detects ordered token-prefix matches', () => {
      expect(hasOrderedTokenPrefixMatch('Search Ag', 'Search Agent')).toBe(
        true,
      );
      expect(hasOrderedTokenPrefixMatch('features pag', 'Features Page')).toBe(
        true,
      );
      expect(
        hasOrderedTokenPrefixMatch(
          'server text paged',
          'Server-side text search for paged task lists',
        ),
      ).toBe(false);
    });

    it('detects token-subset matches across non-contiguous title tokens', () => {
      expect(
        hasTokenSubsetMatch(
          'server text paged',
          'Server-side text search for paged task lists',
        ),
      ).toBe(true);
    });

    it('detects bounded per-token typo and transposition matches', () => {
      expect(hasBoundedTypoTokenMatch('aegnt', 'Search Agent')).toBe(true);
      expect(hasBoundedTypoTokenMatch('zzzzz', 'Search Agent')).toBe(false);
    });

    it('orders deterministic title match tiers before trigram fallback', () => {
      expect(rankEntityTitleMatch('Search', 'Search')).toBe(
        EntityTitleMatchTier.ExactTitle,
      );
      expect(rankEntityTitleMatch('Search', 'Search Agent')).toBe(
        EntityTitleMatchTier.ExactPrefix,
      );
      expect(
        rankEntityTitleMatch('Open Widge', 'Open Widget Deletion to Everyone'),
      ).toBe(EntityTitleMatchTier.ExactPrefix);
      expect(rankEntityTitleMatch('sea ag', 'Search Agent')).toBe(
        EntityTitleMatchTier.OrderedTokenPrefix,
      );
      expect(
        rankEntityTitleMatch(
          'server text paged',
          'Server-side text search for paged task lists',
        ),
      ).toBe(EntityTitleMatchTier.TokenSubset);
      expect(rankEntityTitleMatch('aegnt', 'Search Agent')).toBe(
        EntityTitleMatchTier.TypoTolerant,
      );
      expect(rankEntityTitleMatch('unrelated', 'Search Agent')).toBe(
        EntityTitleMatchTier.TrigramFallback,
      );
    });
  });

  describe('searchEntities', () => {
    it('should call prisma.$queryRaw', async () => {
      const query = 'test';
      const limit = 20;
      const offset = 5;
      const entityTypes: EntityType[] = [EntityType.ARTIFACT];

      const expectedResults: EntitySearchResult[] = [
        {
          entityId: 'entity-1',
          entityType: 'INITIATIVE',
          entityName: 'Test Initiative',
          similarity: 0.9,
        },
      ];

      (prisma.db.$queryRaw as jest.Mock).mockResolvedValue(expectedResults);

      await service.searchEntities(
        organizationId,
        query,
        limit,
        offset,
        entityTypes,
      );

      expect(prisma.db.$queryRaw).toHaveBeenCalled();
      const sql = (prisma.db.$queryRaw as jest.Mock).mock
        .calls[0][0] as Prisma.Sql;
      const values = sql.values;
      expect(values).toContain(entityTypes[0]);
    });

    it('should return the results from prisma.$queryRaw', async () => {
      const query = 'test';
      const expectedResults: EntitySearchResult[] = [
        {
          entityId: 'entity-1',
          entityType: 'INITIATIVE',
          entityName: 'Test Initiative',
          similarity: 0.9,
        },
      ];

      (prisma.db.$queryRaw as jest.Mock).mockResolvedValue(expectedResults);

      const results = await service.searchEntities(organizationId, query);

      expect(results).toEqual(expectedResults);
    });

    it('should use default limit, offset, and entityTypes if not provided', async () => {
      const query = 'test';
      await service.searchEntities(organizationId, query);

      expect(prisma.db.$queryRaw).toHaveBeenCalled();
      const sql = (prisma.db.$queryRaw as jest.Mock).mock
        .calls[0][0] as Prisma.Sql;
      const values = sql.values;
      NON_ARTIFACT_ENTITY_TYPES.forEach((type) =>
        expect(values).toContain(type),
      );
    });

    it('normalizes query text and sends deterministic ranking inputs to SQL', async () => {
      await service.searchEntities(
        organizationId,
        '  Features--Pag  ',
        250,
        0,
        [EntityType.TASK],
      );

      expect(prisma.db.$queryRaw).toHaveBeenCalled();
      const sql = (prisma.db.$queryRaw as jest.Mock).mock
        .calls[0][0] as Prisma.Sql;
      const sqlText = (sql as unknown as { sql: string }).sql;

      expect(sql.values).toContain('features pag');
      expect(sql.values).toContain(EntityType.TASK);
      expect(sql.values).toContain(EntityTitleMatchTier.ExactTitle);
      expect(sql.values).toContain(EntityTitleMatchTier.TrigramFallback);
      expect(sql.values).toContain(100);
      expect(sqlText).toContain('match_tier');
      expect(sqlText).toContain('starts_with');
      expect(sqlText).toContain('ORDER BY');
    });

    it('excludes archived PLAN work items before title ranking and pagination', async () => {
      await service.searchEntities(organizationId, 'Archived plan', 10, 0, [
        EntityType.TASK,
      ]);

      const sql = (prisma.db.$queryRaw as jest.Mock).mock
        .calls[0][0] as Prisma.Sql;
      const sqlText = (sql as unknown as { sql: string }).sql;

      expect(sqlText).toContain(
        `WHEN entity_registry.entity_type = 'TASK'::"EntityType" THEN tasks.status::text`,
      );
      expect(sqlText).toContain('LEFT JOIN tasks');
      expect(sqlText).not.toContain('LEFT JOIN plans');
      expect(sqlText).toContain(
        `WHERE base.status IS DISTINCT FROM 'ARCHIVED'`,
      );
      expect(
        sqlText.indexOf('WHERE base.status IS DISTINCT FROM'),
      ).toBeLessThan(sqlText.indexOf('ranked AS'));
      expect(
        sqlText.indexOf('WHERE base.status IS DISTINCT FROM'),
      ).toBeLessThan(sqlText.indexOf('LIMIT'));
    });
  });

  describe('registerEntity', () => {
    it('stores normalized search text with punctuation treated as separators', async () => {
      await service.registerEntity({
        organizationId,
        entityId: 'feature-1',
        entityType: EntityType.TASK,
        name: '  Search--Agent  ',
      });

      expect(prisma.db.entityRegistry.upsert).toHaveBeenCalledWith({
        where: {
          organizationId_entityId_entityType: {
            organizationId,
            entityId: 'feature-1',
            entityType: EntityType.TASK,
          },
        },
        create: {
          organizationId,
          entityId: 'feature-1',
          entityType: EntityType.TASK,
          entityName: '  Search--Agent  ',
          nameSearchText: 'search agent',
          deletedAt: null,
        },
        update: {
          entityName: '  Search--Agent  ',
          nameSearchText: 'search agent',
          deletedAt: null,
        },
      });
    });
  });

  describe('recordEntityDeletion', () => {
    it('upserts the deleted registry row when a name is available', async () => {
      const deletedAt = new Date('2026-03-06T12:00:00.000Z');

      await service.recordEntityDeletion({
        organizationId,
        entityId: 'task-1',
        entityType: EntityType.TASK,
        name: 'Task One',
        deletedAt,
      });

      expect(prisma.db.entityRegistry.upsert).toHaveBeenCalledWith({
        where: {
          organizationId_entityId_entityType: {
            organizationId,
            entityId: 'task-1',
            entityType: EntityType.TASK,
          },
        },
        create: {
          organizationId,
          entityId: 'task-1',
          entityType: EntityType.TASK,
          entityName: 'Task One',
          nameSearchText: 'task one',
          deletedAt,
        },
        update: {
          entityName: 'Task One',
          nameSearchText: 'task one',
          deletedAt,
        },
      });
      expect(prisma.db.attentionEvent.deleteMany).toHaveBeenCalledWith({
        where: {
          organizationId,
          entityId: 'task-1',
          entityType: EntityType.TASK,
        },
      });
    });

    it('marks the entity deleted and clears attention when no name is available', async () => {
      const deletedAt = new Date('2026-03-06T13:00:00.000Z');

      await service.recordEntityDeletion({
        organizationId,
        entityId: 'plan-1',
        entityType: EntityType.TASK,
        deletedAt,
      });

      expect(prisma.db.entityRegistry.updateMany).toHaveBeenCalledWith({
        where: {
          organizationId,
          entityId: 'plan-1',
          entityType: EntityType.TASK,
        },
        data: {
          deletedAt,
        },
      });
      expect(prisma.db.attentionEvent.deleteMany).toHaveBeenCalledWith({
        where: {
          organizationId,
          entityId: 'plan-1',
          entityType: EntityType.TASK,
        },
      });
    });
  });
});
