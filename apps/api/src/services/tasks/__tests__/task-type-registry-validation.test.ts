import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
/**
 * Registry-gated type validation: snapshot seam, TaskService paths, and
 * ProposalValidationEngine path.
 *
 * Focus: scenarios not covered by the existing registry unit tests
 * (work-item-type-registry.service.test.ts) or the service unit tests
 * (task.service.test.ts):
 *
 *  1. Snapshot seam — a system type whose row carries lifecycleStatus:'archived'
 *     is excluded from systemActiveKeys; assertTypeActive rejects it with a
 *     valid-types message that names only the remaining active types.
 *
 *  2. TaskService — create path: archived type → same error as absent type.
 *
 *  3. TaskService — re-parent path: both the MOVING item's type and the
 *     PARENT's type are asserted active. The moving-item branch (line 1660 in
 *     task.service.ts) has no coverage in the existing service tests (which
 *     only cover the parent-type branch).
 *
 *  4. ProposalValidationEngine — type gate: archived type in a CREATE TASK
 *     proposal yields an unrecognized_type issue whose reason names only the
 *     remaining active types.
 */

import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';

import { WorkStatus } from '../../../generated/model/workStatus';
import { TaskService } from '../task.service';
import { WorkItemTypeRegistryService } from '../work-item-type-registry.service';
import { WorkItemParentageValidator } from '../work-item-parentage-validator.service';
import { ProposalValidationEngine } from '../../proposal/proposal-validation.engine';
import {
  BUILT_IN_WORK_ITEM_TYPE_KEYS,
  createWarmWorkItemTypeRegistry,
  createWarmWorkItemTypeRegistryWithCustomTypes,
  createRegistryWithArchivedSystemType,
} from '../../../../test/setup/work-item-type-registry.fixture';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';
import * as TestUtils from '../../../utils/testUtils';
import { TaskArtifactService } from '../task-artifact.service';
import { RedisService } from '../../../core/redis/redis.service';
import { createRedisServiceMock } from '../../../../test/mocks/redis-service.mock';
import { GraphsClientService } from '../../graphs-client.service';
import type { CreateProposalDto } from '../../../generated';

const { testIds } = TestUtils;

// ── Registry snapshot seam ────────────────────────────────────────────────────

describe('registry snapshot seam', () => {
  const PROJECT_ID = testIds.project;

  describe('all built-in types are active by default (regression net)', () => {
    it.each(BUILT_IN_WORK_ITEM_TYPE_KEYS)(
      'assertTypeActive does not throw for %s',
      async (taskType) => {
        const registry = await createWarmWorkItemTypeRegistry();
        expect(() =>
          registry.assertTypeActive(taskType, PROJECT_ID),
        ).not.toThrow();
      },
    );
  });

  describe('absent type: throws BadRequestException naming all active types', () => {
    it('absent type → BadRequestException whose message contains every active type key', async () => {
      const registry = await createWarmWorkItemTypeRegistry();
      let thrown: unknown;
      try {
        registry.assertTypeActive('EPIC', PROJECT_ID);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(BadRequestException);
      const msg = (thrown as BadRequestException).message;
      expect(msg).toContain('EPIC');
      for (const t of BUILT_IN_WORK_ITEM_TYPE_KEYS) {
        expect(msg).toContain(t);
      }
    });
  });

  describe('archived system type via snapshot seam', () => {
    // STANDARD is the archived type throughout this block.
    const ARCHIVED = WORK_ITEM_TYPE_KEYS.Standard;
    const ACTIVE_REMAINING = BUILT_IN_WORK_ITEM_TYPE_KEYS.filter(
      (t) => t !== ARCHIVED,
    );

    it('assertTypeActive rejects the archived type with BadRequestException', async () => {
      const registry = await createRegistryWithArchivedSystemType(ARCHIVED);
      expect(() => registry.assertTypeActive(ARCHIVED, PROJECT_ID)).toThrow(
        BadRequestException,
      );
    });

    it('valid-types message contains each remaining active type', async () => {
      const registry = await createRegistryWithArchivedSystemType(ARCHIVED);
      let thrown: unknown;
      try {
        registry.assertTypeActive(ARCHIVED, PROJECT_ID);
      } catch (e) {
        thrown = e;
      }
      const msg = (thrown as BadRequestException).message;
      for (const t of ACTIVE_REMAINING) {
        expect(msg).toContain(t);
      }
    });

    it('valid-types message does NOT contain the archived type', async () => {
      const registry = await createRegistryWithArchivedSystemType(ARCHIVED);
      let thrown: unknown;
      try {
        registry.assertTypeActive(ARCHIVED, PROJECT_ID);
      } catch (e) {
        thrown = e;
      }
      // The archived type must not appear in the "Valid types:" list.
      const msg = (thrown as BadRequestException).message;
      const validTypesSegment = msg.slice(msg.indexOf('Valid types:'));
      expect(validTypesSegment).not.toContain(ARCHIVED);
    });

    it('the remaining three types are still accepted', async () => {
      const registry = await createRegistryWithArchivedSystemType(ARCHIVED);
      for (const t of ACTIVE_REMAINING) {
        expect(() => registry.assertTypeActive(t, PROJECT_ID)).not.toThrow();
      }
    });
  });
});

// ── TaskService: create path ──────────────────────────────────────────────────

describe('TaskService create path — archived type gate', () => {
  const ARCHIVED = WORK_ITEM_TYPE_KEYS.Standard;

  async function buildService(registry: WorkItemTypeRegistryService) {
    const mockPrisma =
      TestUtils.createMockPrismaService() as unknown as jest.Mocked<PrismaService>;
    mockPrisma.$transaction = jest
      .fn()
      .mockImplementation(async (cb: unknown) =>
        (cb as (tx: unknown) => Promise<unknown>)({
          initiative: { findFirst: jest.fn() },
          task: {
            create: jest.fn(),
            findFirst: jest.fn(),
            findUniqueOrThrow: jest.fn(),
          },
          taskSection: {
            createMany: jest.fn(),
            findMany: jest.fn().mockResolvedValue([]),
          },
          taskSectionUpdate: { findMany: jest.fn().mockResolvedValue([]) },
        }),
      );

    const redisProvider = createRedisServiceMock();
    const { module } = await createServiceTestingModule({
      providers: [
        TaskService,
        PrismaService,
        TaskArtifactService,
        RedisService,
        GraphsClientService,
        WorkItemParentageValidator,
      ],
      overrides: [[PrismaService, mockPrisma],
[WorkItemTypeRegistryService, registry],
[RedisService, redisProvider.useValue],
[
          TaskArtifactService,
          {
            storeOriginalGeneration: jest.fn().mockResolvedValue([]),
            updateOriginalArtifactFields: jest.fn(),
          },
        ],
[
          GraphsClientService,
          {
            searchGraph: jest
              .fn()
              .mockResolvedValue({ seedResults: [], totalElements: 0 }),
          },
        ]],
    });

    return module.get<TaskService>(TaskService);
  }

  it('rejects create when the task type is archived in the registry snapshot', async () => {
    const registry = await createRegistryWithArchivedSystemType(ARCHIVED);
    const service = await buildService(registry);

    await expect(
      service.create(
        testIds.organization,
        undefined,
        // STANDARD is the archived type in this registry.
        { name: 'Test task', type: 'STANDARD' },
        testIds.project,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects create with archived type message that omits the archived type from valid-types', async () => {
    const registry = await createRegistryWithArchivedSystemType(ARCHIVED);
    const service = await buildService(registry);

    let thrown: unknown;
    try {
      await service.create(
        testIds.organization,
        undefined,
        { name: 'Test task', type: 'STANDARD' },
        testIds.project,
      );
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(BadRequestException);
    const msg = (thrown as BadRequestException).message;
    const validTypesSegment = msg.slice(msg.indexOf('Valid types:'));
    expect(validTypesSegment).not.toContain('STANDARD');
    // The remaining three active types must appear in the message.
    expect(msg).toContain('BUG');
    expect(msg).toContain('FEATURE');
    expect(msg).toContain('GOAL');
  });
});

// ── TaskService: re-parent path ───────────────────────────────────────────────

describe('TaskService re-parent path — archived type gate', () => {
  const ARCHIVED = WORK_ITEM_TYPE_KEYS.Standard;

  // Shared mock task used as the "existing task" (the item being updated).
  const existingTaskBug = {
    id: testIds.task,
    name: 'Existing bug',
    type: 'BUG',
    status: 'BACKLOG',
    projectId: testIds.project,
    organizationId: testIds.organization,
    initiativeId: testIds.initiative,
    parentTaskId: null,
    dueDate: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  async function buildServiceWithMocks(registry: WorkItemTypeRegistryService) {
    const mockPrisma =
      TestUtils.createMockPrismaService() as unknown as jest.Mocked<PrismaService>;

    // The default tx mock proxies through mockPrisma.db so findFirst
    // mock sequences set on mockPrisma.db.task.findFirst apply inside tx.
    mockPrisma.$transaction = jest
      .fn()
      .mockImplementation(async (cb: unknown) =>
        (cb as (tx: unknown) => Promise<unknown>)(mockPrisma.db),
      );

    const redisProvider = createRedisServiceMock();
    const { module } = await createServiceTestingModule({
      providers: [
        TaskService,
        PrismaService,
        TaskArtifactService,
        RedisService,
        GraphsClientService,
        WorkItemParentageValidator,
      ],
      overrides: [[PrismaService, mockPrisma],
[WorkItemTypeRegistryService, registry],
[RedisService, redisProvider.useValue],
[
          TaskArtifactService,
          {
            storeOriginalGeneration: jest.fn().mockResolvedValue([]),
            updateOriginalArtifactFields: jest.fn(),
          },
        ],
[
          GraphsClientService,
          {
            searchGraph: jest
              .fn()
              .mockResolvedValue({ seedResults: [], totalElements: 0 }),
          },
        ]],
    });

    const service = module.get<TaskService>(TaskService);
    return { service, mockPrisma };
  }

  it('rejects re-parent when the MOVING item type is archived in the registry snapshot', async () => {
    const registry = await createRegistryWithArchivedSystemType(ARCHIVED);
    const { service, mockPrisma } = await buildServiceWithMocks(registry);

    // Existing task has type STANDARD — which is archived.
    (mockPrisma.db.task.findFirst as jest.Mock)
      .mockResolvedValueOnce({
        ...existingTaskBug,
        type: 'STANDARD',
      })
      // Parent task found (BUG, which is active) — the error fires before
      // the pair decision because assertTypeActive for the moving item runs first.
      .mockResolvedValueOnce({ id: 'parent-id', type: 'BUG' });

    await expect(
      service.update(testIds.organization, testIds.initiative, testIds.task, {
        parentTaskId: 'parent-id',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects re-parent when the PARENT task type is archived in the registry snapshot', async () => {
    const registry = await createRegistryWithArchivedSystemType(ARCHIVED);
    const { service, mockPrisma } = await buildServiceWithMocks(registry);

    // Existing task has type BUG (active). Parent has type STANDARD (archived).
    (mockPrisma.db.task.findFirst as jest.Mock)
      .mockResolvedValueOnce(existingTaskBug)
      .mockResolvedValueOnce({ id: 'parent-id', type: 'STANDARD' });

    await expect(
      service.update(testIds.organization, testIds.initiative, testIds.task, {
        parentTaskId: 'parent-id',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('re-parent error for archived parent type names only the remaining active types', async () => {
    const registry = await createRegistryWithArchivedSystemType(ARCHIVED);
    const { service, mockPrisma } = await buildServiceWithMocks(registry);

    (mockPrisma.db.task.findFirst as jest.Mock)
      .mockResolvedValueOnce(existingTaskBug)
      .mockResolvedValueOnce({ id: 'parent-id', type: 'STANDARD' });

    let thrown: unknown;
    try {
      await service.update(
        testIds.organization,
        testIds.initiative,
        testIds.task,
        { parentTaskId: 'parent-id' },
      );
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(BadRequestException);
    const msg = (thrown as BadRequestException).message;
    expect(msg).toContain('BUG');
    expect(msg).toContain('FEATURE');
    expect(msg).toContain('GOAL');
    const validTypesSegment = msg.slice(msg.indexOf('Valid types:'));
    expect(validTypesSegment).not.toContain('STANDARD');
  });
});

// ── TaskService: update path — allowedStatuses gate ───────────────────────────

describe('TaskService update path — allowedStatuses gate', () => {
  // A custom type that admits only BACKLOG and ACTIVE — the per-type status
  // contract the edit path must enforce, mirroring the create-path constraint.
  const LIMITED_TYPE = 'LIMITED';
  const limitedSpec = {
    typeKey: LIMITED_TYPE,
    projectId: testIds.project,
    initialStatus: WorkStatus.Backlog,
    allowedStatuses: [WorkStatus.Backlog, WorkStatus.Active],
  };

  const existingLimitedTask = {
    id: testIds.task,
    name: 'Existing limited item',
    type: LIMITED_TYPE,
    status: 'BACKLOG',
    projectId: testIds.project,
    organizationId: testIds.organization,
    initiativeId: testIds.initiative,
    parentTaskId: null,
    dueDate: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  async function buildServiceWithMocks(registry: WorkItemTypeRegistryService) {
    const mockPrisma =
      TestUtils.createMockPrismaService() as unknown as jest.Mocked<PrismaService>;

    mockPrisma.$transaction = jest
      .fn()
      .mockImplementation(async (cb: unknown) =>
        (cb as (tx: unknown) => Promise<unknown>)(mockPrisma.db),
      );

    const redisProvider = createRedisServiceMock();
    const { module } = await createServiceTestingModule({
      providers: [
        TaskService,
        PrismaService,
        TaskArtifactService,
        RedisService,
        GraphsClientService,
        WorkItemParentageValidator,
      ],
      overrides: [[PrismaService, mockPrisma],
[WorkItemTypeRegistryService, registry],
[RedisService, redisProvider.useValue],
[
          TaskArtifactService,
          {
            storeOriginalGeneration: jest.fn().mockResolvedValue([]),
            updateOriginalArtifactFields: jest.fn(),
          },
        ],
[
          GraphsClientService,
          {
            searchGraph: jest
              .fn()
              .mockResolvedValue({ seedResults: [], totalElements: 0 }),
          },
        ]],
    });

    const service = module.get<TaskService>(TaskService);
    return { service, mockPrisma };
  }

  it('rejects an update whose status falls outside the type allowed set', async () => {
    const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
      limitedSpec,
    ]);
    const { service, mockPrisma } = await buildServiceWithMocks(registry);
    (mockPrisma.db.task.findFirst as jest.Mock).mockResolvedValueOnce(
      existingLimitedTask,
    );

    await expect(
      service.update(testIds.organization, testIds.initiative, testIds.task, {
        status: WorkStatus.Completed,
      }),
    ).rejects.toThrow(BadRequestException);

    // The disallowed status must never reach the database.
    expect(mockPrisma.db.task.update).not.toHaveBeenCalled();
  });

  it('names the type and its allowed set in the rejection message', async () => {
    const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
      limitedSpec,
    ]);
    const { service, mockPrisma } = await buildServiceWithMocks(registry);
    (mockPrisma.db.task.findFirst as jest.Mock).mockResolvedValueOnce(
      existingLimitedTask,
    );

    let thrown: unknown;
    try {
      await service.update(
        testIds.organization,
        testIds.initiative,
        testIds.task,
        { status: WorkStatus.Completed },
      );
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(BadRequestException);
    const msg = (thrown as BadRequestException).message;
    expect(msg).toContain(WorkStatus.Completed);
    expect(msg).toContain(LIMITED_TYPE);
    expect(msg).toContain(WorkStatus.Backlog);
    expect(msg).toContain(WorkStatus.Active);
  });
});

// ── ProposalValidationEngine: archived type gate ──────────────────────────────

describe('ProposalValidationEngine — archived type via snapshot seam', () => {
  const ARCHIVED = WORK_ITEM_TYPE_KEYS.Standard;

  function mockPrismaForEngine() {
    const base = TestUtils.createMockPrismaService();
    // Required by the engine's structural validation.
    (base.db as Record<string, unknown>).validationSession = {
      findFirst: jest.fn(),
    };
    return base;
  }

  function makeCreateTaskProposal(
    overrides: Partial<CreateProposalDto> = {},
  ): CreateProposalDto {
    return {
      type: 'SINGLE',
      action: 'CREATE',
      targetEntityId: '',
      targetEntityType: 'TASK',
      updates: { name: 'New task', initiativeId: testIds.initiative },
      ...overrides,
    };
  }

  async function buildEngine(registry: WorkItemTypeRegistryService) {
    const mockPrisma = mockPrismaForEngine();
    const module = await Test.createTestingModule({
      providers: [
        ProposalValidationEngine,
        WorkItemParentageValidator,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WorkItemTypeRegistryService, useValue: registry },
      ],
    }).compile();

    const engine = module.get<ProposalValidationEngine>(
      ProposalValidationEngine,
    );
    // Satisfy the project-existence check so the type gate is reached.
    mockPrisma.db.project.findFirst.mockResolvedValue({ id: testIds.project });
    mockPrisma.db.initiative.findFirst.mockResolvedValue({
      id: testIds.initiative,
    });

    return engine;
  }

  it('rejects a CREATE TASK proposal naming the archived type with an unrecognized_type error', async () => {
    const registry = await createRegistryWithArchivedSystemType(ARCHIVED);
    const engine = await buildEngine(registry);

    const result = await engine.validate({
      proposals: [
        makeCreateTaskProposal({
          updates: {
            name: 'Task with archived type',
            initiativeId: testIds.initiative,
            type: 'STANDARD',
          },
        }),
      ],
      context: {
        organizationId: testIds.organization,
        projectId: testIds.project,
        requestor: TestUtils.createMockAuthenticatedUser(),
      },
    });

    expect(result.valid).toBe(false);
    const issue = result.proposals[0]!.errors.find(
      (e) => e.code === 'unrecognized_type',
    );
    expect(issue).toBeDefined();
    expect(issue!.reason).toContain('STANDARD');
    // Valid-types segment must NOT include the archived type.
    const validSegment = issue!.reason.slice(
      issue!.reason.indexOf('Valid types:'),
    );
    expect(validSegment).not.toContain('STANDARD');
    expect(issue!.reason).toContain('BUG');
    expect(issue!.reason).toContain('FEATURE');
    expect(issue!.reason).toContain('GOAL');
  });

  it('does not flag an active built-in type as unrecognized', async () => {
    const registry = await createRegistryWithArchivedSystemType(ARCHIVED);
    const engine = await buildEngine(registry);

    // BUG is still active even though STANDARD is archived.
    const result = await engine.validate({
      proposals: [
        makeCreateTaskProposal({
          updates: {
            name: 'A bug',
            initiativeId: testIds.initiative,
            type: 'BUG',
          },
        }),
      ],
      context: {
        organizationId: testIds.organization,
        projectId: testIds.project,
        requestor: TestUtils.createMockAuthenticatedUser(),
      },
    });

    expect(
      result.proposals[0]!.errors.some((e) => e.code === 'unrecognized_type'),
    ).toBe(false);
  });
});
