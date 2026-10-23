import { InitiativeService } from '../initiative.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { DomainEventPublisher } from '../../../core/events/domain-event-publisher';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../../core/events/tokens';
import { TagService } from '../../tag.service';
import { InitiativeArtifactService } from '../initiative-artifact.service';
import { ArtifactService } from '../../artifacts/artifact.service';
import { EntityRegistryService } from '../../entity-registry/entity-registry.service';
import {
  UpdateInitiativeDto,
  WorkStatus,
  Priority,
  InitiativeCreatorType,
} from '../../../generated';
import { UserId } from '../../../types';
import { Initiative } from '@prisma/client';
import * as TestUtils from '../../../utils/testUtils';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';
import { RedisService } from '../../../core/redis/redis.service';
import { createRedisServiceMock } from '../../../../test/mocks/redis-service.mock';

const { testIds } = TestUtils;

interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  dataType: string;
}

interface ServiceWithPrivateMethods {
  detectFieldChanges: (
    original: Initiative,
    update: UpdateInitiativeDto,
  ) => FieldChange[];
  isEqual: (a: unknown, b: unknown) => boolean;
}

const createMockInitiative = (
  overrides: Partial<Initiative> = {},
): Initiative => ({
  id: testIds.initiative,
  name: 'Original Initiative',
  assigneeId: testIds.user,
  priority: 'MEDIUM',
  status: WorkStatus.RefiningDescription,
  tags: ['tag1', 'tag2'],
  dueDate: new Date('2024-12-31'),
  reasoning: 'Original reasoning',
  organizationId: testIds.organization,
  creatorType: InitiativeCreatorType.User,
  originatingProjectId: testIds.project,
  sourceConversationId: null,
  archivedAt: null,
  sourceType: null,
  sourceId: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  lastModifiedBy: null,
  lastModifiedAt: new Date('2024-01-01'),
  ...overrides,
});

describe('InitiativeService Change Detection Tests', () => {
  let service: InitiativeService;
  let mockPrismaService: ReturnType<typeof TestUtils.createMockPrismaService>;

  beforeEach(async () => {
    const prismaMock = TestUtils.createMockPrismaService();
    const prismaDb = prismaMock.db as any;

    const setup = await createServiceTestingModule({
      providers: [
        InitiativeService,
        PrismaService,
        TagService,
        InitiativeArtifactService,
        ArtifactService,
        EntityRegistryService,
        RedisService,
      ],
      overrides: [
        [PrismaService, prismaMock],
        [
          DOMAIN_EVENT_PUBLISHER_TOKEN,
          TestUtils.createMockDomainEventPublisher(),
        ],
        [TagService, TestUtils.createMockTagService()],
        [
          InitiativeArtifactService,
          TestUtils.createMockInitiativeArtifactService(),
        ],
        [ArtifactService, TestUtils.createMockArtifactService()],
        [
          EntityRegistryService,
          {
            registerEntity: jest.fn(),
            registerEntities: jest.fn(),
          },
        ],
        [RedisService, createRedisServiceMock().useValue],
      ],
    });

    // Ensure projectInitiative table mock exists for listLinkedProjectIds
    if (!prismaDb.projectInitiative) {
      prismaDb.projectInitiative = {
        findMany: jest.fn().mockResolvedValue([]),
      };
    } else if (!prismaDb.projectInitiative.findMany) {
      prismaDb.projectInitiative.findMany = jest.fn().mockResolvedValue([]);
    }
    if (!prismaDb.initiativeSection) {
      prismaDb.initiativeSection = {
        findMany: jest.fn(),
      };
    } else if (!prismaDb.initiativeSection.findMany) {
      prismaDb.initiativeSection.findMany = jest.fn();
    }
    (prismaDb.initiativeSection.findMany as jest.Mock).mockResolvedValue(
      TestUtils.createMockMaterializedWorkItemSections({
        description: 'Original description',
        details: 'Original details',
        acceptanceCriteria: 'Original acceptance criteria',
      }).map((section) => ({
        ...section,
        initiativeId: testIds.initiative,
      })),
    );
    if (!prismaDb.initiativeSectionUpdate) {
      prismaDb.initiativeSectionUpdate = {
        findMany: jest.fn(),
      };
    } else if (!prismaDb.initiativeSectionUpdate.findMany) {
      prismaDb.initiativeSectionUpdate.findMany = jest.fn();
    }
    (prismaDb.initiativeSectionUpdate.findMany as jest.Mock).mockResolvedValue(
      [],
    );

    service = setup.module.get<InitiativeService>(InitiativeService);
    mockPrismaService = setup.module.get(PrismaService);
    (
      mockPrismaService.db.projectInitiative.findMany as jest.Mock
    ).mockResolvedValue([]);
  });

  describe('detectFieldChanges', () => {
    it('should detect string field changes', () => {
      const original = createMockInitiative();
      const update: UpdateInitiativeDto = {
        name: 'Updated Initiative',
        reasoning: 'Updated reasoning',
      };

      // Access private method for testing
      const changes = (
        service as unknown as ServiceWithPrivateMethods
      ).detectFieldChanges(original, update);

      expect(changes).toHaveLength(2);

      const nameChange = changes.find((c) => c.field === 'name');
      expect(nameChange).toEqual({
        field: 'name',
        oldValue: 'Original Initiative',
        newValue: 'Updated Initiative',
        dataType: 'string',
      });

      const reasoningChange = changes.find((c) => c.field === 'reasoning');
      expect(reasoningChange).toEqual({
        field: 'reasoning',
        oldValue: 'Original reasoning',
        newValue: 'Updated reasoning',
        dataType: 'string',
      });
    });

    it('should detect enum field changes', () => {
      const original = createMockInitiative();
      const update: UpdateInitiativeDto = {
        priority: Priority.High,
        status: WorkStatus.Active,
      };

      const changes = (
        service as unknown as ServiceWithPrivateMethods
      ).detectFieldChanges(original, update);

      expect(changes).toHaveLength(2);

      const priorityChange = changes.find((c) => c.field === 'priority');
      expect(priorityChange).toEqual({
        field: 'priority',
        oldValue: 'MEDIUM',
        newValue: Priority.High,
        dataType: 'string',
      });

      const statusChange = changes.find((c) => c.field === 'status');
      expect(statusChange).toEqual({
        field: 'status',
        oldValue: WorkStatus.RefiningDescription,
        newValue: WorkStatus.Active,
        dataType: 'string',
      });
    });

    it('should detect array field changes', () => {
      const original = createMockInitiative();
      const update: UpdateInitiativeDto = {
        tags: ['tag1', 'tag3', 'tag4'], // Changed from ['tag1', 'tag2']
      };

      const changes = (
        service as unknown as ServiceWithPrivateMethods
      ).detectFieldChanges(original, update);

      expect(changes).toHaveLength(1);

      const tagsChange = changes[0];
      expect(tagsChange).toEqual({
        field: 'tags',
        oldValue: ['tag1', 'tag2'],
        newValue: ['tag1', 'tag3', 'tag4'],
        dataType: 'array',
      });
    });

    it('should detect null/undefined changes', () => {
      const original = createMockInitiative({
        reasoning: null,
        assigneeId: testIds.user,
      });
      const update: UpdateInitiativeDto = {
        reasoning: 'New reasoning',
        assigneeId: null as unknown as UserId, // Removing assignee
      };

      const changes = (
        service as unknown as ServiceWithPrivateMethods
      ).detectFieldChanges(original, update);

      expect(changes).toHaveLength(2);

      const reasoningChange = changes.find((c) => c.field === 'reasoning');
      expect(reasoningChange).toEqual({
        field: 'reasoning',
        oldValue: null,
        newValue: 'New reasoning',
        dataType: 'string',
      });

      const assigneeChange = changes.find((c) => c.field === 'assigneeId');
      expect(assigneeChange).toEqual({
        field: 'assigneeId',
        oldValue: testIds.user,
        newValue: null,
        dataType: 'null',
      });
    });

    it('should detect date field changes', () => {
      const original = createMockInitiative({
        dueDate: new Date('2024-12-31'),
      });
      const update: UpdateInitiativeDto = {
        dueDate: '2025-06-30', // String format from API
      };

      const changes = (
        service as unknown as ServiceWithPrivateMethods
      ).detectFieldChanges(original, update);

      expect(changes).toHaveLength(1);

      const dueDateChange = changes[0];
      expect(dueDateChange).toEqual({
        field: 'dueDate',
        oldValue: '2024-12-31T00:00:00.000Z',
        newValue: '2025-06-30',
        dataType: 'string',
      });
    });

    it('should not detect changes when values are the same', () => {
      const original = createMockInitiative();
      const update: UpdateInitiativeDto = {
        name: 'Original Initiative', // Same as original
        reasoning: 'Original reasoning', // Same as original
      };

      const changes = (
        service as unknown as ServiceWithPrivateMethods
      ).detectFieldChanges(original, update);

      expect(changes).toHaveLength(0);
    });

    it('should not detect changes for undefined fields in update', () => {
      const original = createMockInitiative();
      const update: UpdateInitiativeDto = {
        name: 'Updated Initiative',
        // reasoning is undefined - should not be considered a change
      };

      const changes = (
        service as unknown as ServiceWithPrivateMethods
      ).detectFieldChanges(original, update);

      expect(changes).toHaveLength(1);
      const [change] = changes;
      if (!change) {
        throw new Error('Expected change');
      }
      expect(change.field).toBe('name');
    });

    it('should handle complex array comparisons', () => {
      const original = createMockInitiative({
        tags: ['tag1', 'tag2', 'tag3'],
      });

      // Same elements, different order - should not be a change
      const update1: UpdateInitiativeDto = {
        tags: ['tag3', 'tag1', 'tag2'],
      };

      const changes1 = (
        service as unknown as ServiceWithPrivateMethods
      ).detectFieldChanges(original, update1);
      expect(changes1).toHaveLength(1); // Arrays are order-sensitive in this implementation

      // Actually different array
      const update2: UpdateInitiativeDto = {
        tags: ['tag1', 'tag4'],
      };

      const changes2 = (
        service as unknown as ServiceWithPrivateMethods
      ).detectFieldChanges(original, update2);
      expect(changes2).toHaveLength(1);
      const [change] = changes2;
      if (!change) {
        throw new Error('Expected change');
      }
      expect(change.field).toBe('tags');
    });

    it('should handle empty string vs null differences', () => {
      const original = createMockInitiative({
        reasoning: null,
      });
      const update: UpdateInitiativeDto = {
        reasoning: '', // Empty string vs null
      };

      const changes = (
        service as unknown as ServiceWithPrivateMethods
      ).detectFieldChanges(original, update);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        field: 'reasoning',
        oldValue: null,
        newValue: '',
        dataType: 'string',
      });
    });

    it('should handle all trackable fields', () => {
      const original = createMockInitiative();
      const update: UpdateInitiativeDto = {
        name: 'New name',
        assigneeId: 'different-user-id' as UserId,
        priority: Priority.Critical,
        status: WorkStatus.Completed,
        tags: ['new-tag'],
        dueDate: '2025-01-01',
        reasoning: 'New reasoning',
      };

      const changes = (
        service as unknown as ServiceWithPrivateMethods
      ).detectFieldChanges(original, update);

      expect(changes).toHaveLength(7); // All trackable fields changed

      const fieldNames = changes.map((c) => c.field);
      expect(fieldNames).toContain('name');
      expect(fieldNames).toContain('assigneeId');
      expect(fieldNames).toContain('priority');
      expect(fieldNames).toContain('status');
      expect(fieldNames).toContain('tags');
      expect(fieldNames).toContain('dueDate');
      expect(fieldNames).toContain('reasoning');
    });
  });

  describe('isEqual helper method', () => {
    it('should correctly compare primitive values', () => {
      const isEqual = (
        service as unknown as ServiceWithPrivateMethods
      ).isEqual.bind(service);

      expect(isEqual('test', 'test')).toBe(true);
      expect(isEqual('test', 'different')).toBe(false);
      expect(isEqual(123, 123)).toBe(true);
      expect(isEqual(123, 456)).toBe(false);
      expect(isEqual(true, true)).toBe(true);
      expect(isEqual(true, false)).toBe(false);
      expect(isEqual(null, null)).toBe(true);
      expect(isEqual(undefined, undefined)).toBe(true);
      expect(isEqual(null, undefined)).toBe(false);
    });

    it('should correctly compare arrays', () => {
      const isEqual = (
        service as unknown as ServiceWithPrivateMethods
      ).isEqual.bind(service);

      expect(isEqual([1, 2, 3], [1, 2, 3])).toBe(true);
      expect(isEqual([1, 2, 3], [1, 2, 4])).toBe(false);
      expect(isEqual([1, 2, 3], [1, 2, 3, 4])).toBe(false);
      expect(isEqual([], [])).toBe(true);
      expect(isEqual(['a', 'b'], ['a', 'b'])).toBe(true);
      expect(isEqual(['a', 'b'], ['b', 'a'])).toBe(false); // Order matters
    });

    it('should correctly compare objects', () => {
      const isEqual = (
        service as unknown as ServiceWithPrivateMethods
      ).isEqual.bind(service);

      expect(isEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
      expect(isEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true); // Order doesn't matter for objects
      expect(isEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
      expect(isEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
      expect(isEqual({}, {})).toBe(true);
    });

    it('should correctly compare nested structures', () => {
      const isEqual = (
        service as unknown as ServiceWithPrivateMethods
      ).isEqual.bind(service);

      const obj1 = { arr: [1, 2, { nested: 'value' }] };
      const obj2 = { arr: [1, 2, { nested: 'value' }] };
      const obj3 = { arr: [1, 2, { nested: 'different' }] };

      expect(isEqual(obj1, obj2)).toBe(true);
      expect(isEqual(obj1, obj3)).toBe(false);
    });
  });

  describe('Integration with update method', () => {
    it('should skip update when no changes are detected', async () => {
      const mockInitiative = createMockInitiative();

      mockPrismaService.db.initiative.findFirst.mockResolvedValue(
        mockInitiative,
      );

      const update: UpdateInitiativeDto = {
        name: 'Original Initiative', // Same as original
        reasoning: 'Original reasoning', // Same as original
      };

      const result = await service.update(
        testIds.initiative,
        update,
        testIds.organization,
        testIds.user,
        'test@example.com',
        'Test User',
      );

      // Should return the existing initiative without updating
      expect(result).toBe(mockInitiative);

      // Should not call the database update
      expect(mockPrismaService.db.$transaction).not.toHaveBeenCalled();
    });

    it('should proceed with update when changes are detected', async () => {
      const mockInitiative = createMockInitiative();
      const updatedInitiative = {
        ...mockInitiative,
        name: 'Updated Initiative',
      };

      mockPrismaService.db.initiative.findFirst.mockResolvedValue(
        mockInitiative,
      );

      // Mock the transaction
      mockPrismaService.db.$transaction.mockImplementation(async (callback) => {
        return await callback({
          initiative: {
            update: jest.fn().mockResolvedValue(updatedInitiative),
          },
        } as unknown);
      });

      const update: UpdateInitiativeDto = {
        name: 'Updated Initiative', // Different from original
      };

      const result = await service.update(
        testIds.initiative,
        update,
        testIds.organization,
        testIds.user,
        'test@example.com',
        'Test User',
      );

      // Should proceed with the update
      expect(mockPrismaService.db.$transaction).toHaveBeenCalled();
      expect(result).toMatchObject({
        id: testIds.initiative,
        name: 'Updated Initiative',
      });
    });
  });
});
