import { NotFoundException } from '@nestjs/common';
import { EVENT_TYPES } from '../../../core/events/types/event.types';
import { VersionConflictException } from '../../../core/exceptions/version-conflict.exception';
import { ImplementationHintService } from '../implementation-hint.service';
import {
  createMockDomainEventPublisher,
  createMockPrismaService,
  testIds,
} from '../../../utils/testUtils';

describe('ImplementationHintService', () => {
  const now = new Date('2024-01-01T00:00:00Z');
  const organizationId = testIds.organization;
  const serviceId = 'service-1';
  let prisma: ReturnType<typeof createMockPrismaService>;
  let eventPublisher: ReturnType<typeof createMockDomainEventPublisher>;
  let service: ImplementationHintService;

  const buildHint = (overrides: Record<string, unknown> = {}) => ({
    id: 'hint-1',
    serviceId,
    agentSessionId: 'cs-1',
    featureName: 'Auth',
    description: 'Use JWT guard',
    sourceType: 'USER',
    hint: 'Use middleware guard',
    context: { source: 'cli' },
    extractedFrom: 'AGENT',
    confidence: 0.9,
    version: 2,
    createdAt: now,
    updatedAt: now,
    versions: [
      {
        id: 'ver-2',
        hintId: 'hint-1',
        version: 2,
        hint: 'Use middleware guard',
        context: { source: 'cli' },
        extractedFrom: 'AGENT',
        confidence: 0.9,
        createdAt: now,
      },
      {
        id: 'ver-1',
        hintId: 'hint-1',
        version: 1,
        hint: 'Legacy hint',
        context: null,
        extractedFrom: 'USER',
        confidence: null,
        createdAt: now,
      },
    ],
    fileReferences: [
      {
        id: 'ref-1',
        hintId: 'hint-1',
        filePath: 'src/auth.ts',
        startLine: 1,
        endLine: 12,
        createdAt: now,
      },
    ],
    ...overrides,
  });

  beforeEach(() => {
    prisma = createMockPrismaService();
    eventPublisher = createMockDomainEventPublisher();
    prisma.$transaction.mockImplementation(async (callback) =>
      callback(prisma.db),
    );
    service = new ImplementationHintService(
      prisma as any,
      eventPublisher as any,
    );
    prisma.db.service.findFirst.mockResolvedValue({
      id: serviceId,
      organizationId,
      projectId: testIds.project,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('creates an implementation hint with seed version and file references', async () => {
    prisma.db.agentSession.findFirst.mockResolvedValue({ id: 'cs-1' });
    prisma.db.implementationHint.create.mockResolvedValue({ id: 'hint-1' });
    prisma.db.implementationHintVersion.create.mockResolvedValue({
      id: 'ver-1',
    });
    prisma.db.implementationHintFileReference.findMany.mockResolvedValue([]);
    prisma.db.implementationHint.findUnique.mockResolvedValue(buildHint());

    const result = await service.create(organizationId, {
      serviceId,
      featureName: 'Auth',
      description: 'Use JWT guard',
      sourceType: 'USER',
      agentSessionId: 'cs-1',
      hint: 'Use middleware guard',
      extractedFrom: 'AGENT',
      confidence: 0.9,
      fileReferences: [
        { filePath: 'src/auth.ts', startLine: 1, endLine: 12 },
        { filePath: 'src/auth.ts', startLine: 1, endLine: 12 },
      ],
    } as any);

    expect(prisma.db.implementationHint.create).toHaveBeenCalled();
    expect(prisma.db.implementationHintVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          hintId: 'hint-1',
          version: 1,
          hint: 'Use middleware guard',
          extractedFrom: 'AGENT',
        }),
      }),
    );
    expect(
      prisma.db.implementationHintFileReference.createMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          {
            hintId: 'hint-1',
            filePath: 'src/auth.ts',
            startLine: 1,
            endLine: 12,
          },
        ],
      }),
    );
    expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
      prisma.db,
      expect.objectContaining({
        type: EVENT_TYPES.IMPLEMENTATION_HINT.CREATED,
        aggregateId: 'hint-1',
        payload: expect.objectContaining({
          payloadType: EVENT_TYPES.IMPLEMENTATION_HINT.CREATED,
          organizationId,
          projectId: testIds.project,
          implementationHint: expect.objectContaining({ id: 'hint-1' }),
        }),
      }),
    );
    expect(result.latestVersion?.version).toBe(2);
  });

  it('filters implementation hints by file path prefix with pagination', async () => {
    prisma.db.implementationHint.findMany.mockResolvedValue([buildHint()]);

    const result = await service.findAll(organizationId, serviceId, {
      filePath: 'src/',
      filePathMatch: 'prefix',
      page: 2,
      size: 10,
      latest: true,
    });

    expect(prisma.db.implementationHint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          serviceId,
          fileReferences: {
            some: {
              filePath: { startsWith: 'src/' },
            },
          },
        }),
        skip: 10,
        take: 10,
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.versions).toHaveLength(1);
  });

  it('lists an archived Service without dropping organization or project scope', async () => {
    prisma.db.service.findFirst.mockResolvedValue({
      id: serviceId,
      archivedAt: now,
    });
    prisma.db.implementationHint.findMany.mockResolvedValue([buildHint()]);
    const hints = await service.findAll(organizationId, serviceId, {
      accessibleProjectIds: [testIds.project],
    });
    expect(prisma.db.service.findFirst).toHaveBeenCalledWith({
      where: { id: serviceId, organizationId },
      select: { id: true },
    });
    expect(prisma.db.implementationHint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          serviceId,
          AND: [{ service: { projectId: { in: [testIds.project] } } }],
        },
      }),
    );
    expect(hints[0]?.hint).toBe('Use middleware guard');
  });

  it('retains inaccessible-project filtering even for an explicitly selected Service', async () => {
    prisma.db.implementationHint.findMany.mockResolvedValue([]);
    await expect(
      service.findAll(organizationId, serviceId, { accessibleProjectIds: [] }),
    ).resolves.toEqual([]);
    expect(prisma.db.implementationHint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { serviceId, AND: [{ service: { projectId: { in: [] } } }] },
      }),
    );
  });

  it('rejects administrative listing outside the organization before reading hints', async () => {
    prisma.db.service.findFirst.mockResolvedValue(null);
    await expect(
      service.findAll(organizationId, serviceId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.db.implementationHint.findMany).not.toHaveBeenCalled();
  });

  it('keeps mutations restricted to active Services', async () => {
    prisma.db.service.findFirst.mockResolvedValue(null);
    await expect(
      service.create(organizationId, {
        serviceId,
        featureName: 'Auth',
        description: 'Guard',
        sourceType: 'USER',
        agentSessionId: 'cs-1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.db.service.findFirst).toHaveBeenCalledWith({
      where: { id: serviceId, organizationId, archivedAt: null },
      select: { id: true },
    });
  });

  it('throws version conflict when appending a stale version', async () => {
    prisma.db.implementationHint.findFirst.mockResolvedValue(
      buildHint({ version: 3 }),
    );

    await expect(
      service.appendVersion(
        organizationId,
        'hint-1',
        {
          expectedVersion: 2,
          hint: 'Updated hint',
          extractedFrom: 'AGENT',
        },
        serviceId,
      ),
    ).rejects.toBeInstanceOf(VersionConflictException);
  });

  it('appends a version and updates hint snapshot', async () => {
    prisma.db.implementationHint.findFirst.mockResolvedValue(
      buildHint({ version: 2 }),
    );
    prisma.db.implementationHint.updateMany.mockResolvedValue({ count: 1 });
    prisma.db.implementationHintVersion.create.mockResolvedValue({
      id: 'ver-3',
    });
    prisma.db.implementationHintFileReference.findMany.mockResolvedValue([
      {
        filePath: 'src/auth.ts',
        startLine: 1,
        endLine: 12,
      },
    ]);
    prisma.db.implementationHint.findUnique.mockResolvedValue(
      buildHint({
        version: 3,
        fileReferences: [
          {
            id: 'ref-2',
            hintId: 'hint-1',
            filePath: 'src/app.ts',
            startLine: null,
            endLine: null,
            createdAt: now,
          },
          {
            id: 'ref-1',
            hintId: 'hint-1',
            filePath: 'src/auth.ts',
            startLine: 1,
            endLine: 12,
            createdAt: now,
          },
        ],
        versions: [
          {
            id: 'ver-3',
            hintId: 'hint-1',
            version: 3,
            hint: 'Updated hint',
            context: null,
            extractedFrom: 'AGENT',
            confidence: 0.7,
            createdAt: now,
          },
        ],
      }),
    );

    const result = await service.appendVersion(
      organizationId,
      'hint-1',
      {
        expectedVersion: 2,
        hint: 'Updated hint',
        extractedFrom: 'AGENT',
        confidence: 0.7,
        fileReferences: [
          { filePath: 'src/auth.ts', startLine: 1, endLine: 12 },
          { filePath: 'src/app.ts' },
        ],
      },
      serviceId,
    );

    expect(prisma.db.implementationHint.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'hint-1', version: 2 },
        data: expect.objectContaining({ version: 3, hint: 'Updated hint' }),
      }),
    );
    expect(prisma.db.implementationHintVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ hintId: 'hint-1', version: 3 }),
      }),
    );
    expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
      prisma.db,
      expect.objectContaining({
        type: EVENT_TYPES.IMPLEMENTATION_HINT.UPDATED,
        aggregateId: 'hint-1',
        payload: expect.objectContaining({
          payloadType: EVENT_TYPES.IMPLEMENTATION_HINT.UPDATED,
          organizationId,
          projectId: testIds.project,
          changes: expect.objectContaining({
            hint: 'Updated hint',
            extractedFrom: 'AGENT',
            confidence: 0.7,
            fileReferences: [{ filePath: 'src/app.ts' }],
          }),
        }),
      }),
    );
    expect(result.version).toBe(3);
  });

  it('lists file references with prefix filters', async () => {
    prisma.db.implementationHint.findFirst.mockResolvedValue(buildHint());
    prisma.db.implementationHintFileReference.findMany.mockResolvedValue([
      {
        id: 'ref-1',
        hintId: 'hint-1',
        filePath: 'src/auth.ts',
        startLine: 1,
        endLine: 12,
        createdAt: now,
      },
    ]);

    const refs = await service.listFileReferences(
      organizationId,
      'hint-1',
      {
        filePath: 'src/',
        filePathMatch: 'prefix',
        page: 1,
        size: 5,
      },
      serviceId,
    );

    expect(
      prisma.db.implementationHintFileReference.findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          hintId: 'hint-1',
          filePath: { startsWith: 'src/' },
        },
        skip: 0,
        take: 5,
      }),
    );
    expect(refs).toHaveLength(1);
  });

  it('updates implementation hint snapshot fields from normalized update payload', async () => {
    prisma.db.implementationHint.findFirst.mockResolvedValue(buildHint());
    prisma.db.implementationHint.update.mockResolvedValue({ id: 'hint-1' });
    prisma.db.implementationHint.findUnique.mockResolvedValue(
      buildHint({
        hint: 'Updated snapshot',
        extractedFrom: 'USER',
        confidence: 0.6,
      }),
    );

    const result = await service.update(organizationId, 'hint-1', {
      serviceId,
      hint: '  Updated snapshot  ',
      extractedFrom: 'USER',
      confidence: 0.6,
    } as any);

    expect(prisma.db.implementationHint.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'hint-1' },
        data: expect.objectContaining({
          hint: 'Updated snapshot',
          extractedFrom: 'USER',
          confidence: 0.6,
        }),
      }),
    );
    expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
      prisma.db,
      expect.objectContaining({
        type: EVENT_TYPES.IMPLEMENTATION_HINT.UPDATED,
        aggregateId: 'hint-1',
        payload: expect.objectContaining({
          payloadType: EVENT_TYPES.IMPLEMENTATION_HINT.UPDATED,
          organizationId,
          projectId: testIds.project,
          changes: expect.objectContaining({
            hint: 'Updated snapshot',
            extractedFrom: 'USER',
            confidence: 0.6,
          }),
        }),
      }),
    );
    expect(result.hint).toBe('Updated snapshot');
  });

  it('lists organization-scoped versions using latest distinct query', async () => {
    prisma.db.implementationHintVersion.findMany.mockResolvedValue([
      {
        id: 'ver-2',
        hintId: 'hint-1',
        version: 2,
        hint: 'Use middleware guard',
        context: null,
        extractedFrom: 'AGENT',
        confidence: 0.9,
        createdAt: now,
      },
    ]);

    const versions = await service.listOrganizationVersions(organizationId, {
      serviceId,
      filePath: 'src/',
      filePathMatch: 'prefix',
      latest: true,
      page: 1,
      size: 20,
      extractedFrom: 'AGENT',
    });

    expect(prisma.db.implementationHintVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          extractedFrom: 'AGENT',
          hintRecord: expect.objectContaining({
            serviceId,
            fileReferences: {
              some: {
                filePath: { startsWith: 'src/' },
              },
            },
          }),
        }),
        distinct: ['hintId'],
      }),
    );
    expect(versions).toHaveLength(1);
  });

  it('updates and queries file references', async () => {
    prisma.db.implementationHint.findFirst.mockResolvedValue(buildHint());
    prisma.db.implementationHintFileReference.findFirst
      .mockResolvedValueOnce({
        id: 'ref-1',
        hintId: 'hint-1',
        filePath: 'src/auth.ts',
        startLine: 1,
        endLine: 10,
        createdAt: now,
      })
      .mockResolvedValueOnce({
        id: 'ref-1',
        hintId: 'hint-1',
        filePath: 'src/auth.ts',
        startLine: 2,
        endLine: 12,
        createdAt: now,
      });
    prisma.db.implementationHintFileReference.update.mockResolvedValue({
      id: 'ref-1',
      hintId: 'hint-1',
      filePath: 'src/auth.ts',
      startLine: 2,
      endLine: 12,
      createdAt: now,
    });
    prisma.db.implementationHintFileReference.findMany.mockResolvedValue([
      {
        id: 'ref-1',
        hintId: 'hint-1',
        filePath: 'src/auth.ts',
        startLine: 2,
        endLine: 12,
        createdAt: now,
      },
    ]);

    const updated = await service.updateFileReference(
      organizationId,
      'hint-1',
      'ref-1',
      { startLine: 2, endLine: 12 },
      serviceId,
    );

    const queried = await service.queryFileReferences(organizationId, {
      serviceId,
      filePath: 'src/',
      filePathMatch: 'prefix',
      extractedFrom: 'AGENT',
      page: 1,
      size: 10,
    });

    expect(
      prisma.db.implementationHintFileReference.update,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ref-1' },
        data: expect.objectContaining({
          startLine: 2,
          endLine: 12,
        }),
      }),
    );
    expect(
      prisma.db.implementationHintFileReference.findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          filePath: { startsWith: 'src/' },
          hint: expect.objectContaining({
            serviceId,
            extractedFrom: 'AGENT',
          }),
        }),
      }),
    );
    expect(updated.startLine).toBe(2);
    expect(queried).toHaveLength(1);
  });

  it('queries file references using latest hint version scope when requested', async () => {
    prisma.db.implementationHintVersion.findMany.mockResolvedValue([
      { hintId: 'hint-1' },
    ]);
    prisma.db.implementationHintFileReference.findMany.mockResolvedValue([
      {
        id: 'ref-1',
        hintId: 'hint-1',
        filePath: 'src/auth.ts',
        startLine: 2,
        endLine: 12,
        createdAt: now,
      },
    ]);

    const queried = await service.queryFileReferences(organizationId, {
      serviceId,
      latest: true,
      page: 1,
      size: 10,
    });

    expect(prisma.db.implementationHintVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        distinct: ['hintId'],
        orderBy: [{ hintId: 'asc' }, { version: 'desc' }],
        select: { hintId: true },
        where: {
          hintRecord: {
            serviceId,
          },
        },
      }),
    );
    expect(
      prisma.db.implementationHintFileReference.findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          hint: expect.objectContaining({
            id: { in: ['hint-1'] },
            serviceId,
          }),
        }),
      }),
    );
    expect(queried).toHaveLength(1);
  });

  it('throws when hint does not exist on remove', async () => {
    prisma.db.implementationHint.findFirst.mockResolvedValue(null);

    await expect(
      service.remove(organizationId, 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('publishes implementation_hint.deleted on remove', async () => {
    prisma.db.implementationHint.findFirst.mockResolvedValue(buildHint());

    await service.remove(organizationId, 'hint-1');

    expect(prisma.db.implementationHint.delete).toHaveBeenCalledWith({
      where: { id: 'hint-1' },
    });
    expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
      prisma.db,
      expect.objectContaining({
        type: EVENT_TYPES.IMPLEMENTATION_HINT.DELETED,
        aggregateId: 'hint-1',
        payload: expect.objectContaining({
          payloadType: EVENT_TYPES.IMPLEMENTATION_HINT.DELETED,
          organizationId,
          projectId: testIds.project,
          implementationHintId: 'hint-1',
        }),
      }),
    );
  });

  it('fails lifecycle mutations when the owning service has no projectId', async () => {
    prisma.db.service.findFirst.mockResolvedValue({
      id: serviceId,
      organizationId,
      projectId: null,
    });

    await expect(
      service.create(organizationId, {
        serviceId,
        agentSessionId: 'cs-1',
        featureName: 'Auth',
        description: 'Use JWT guard',
        sourceType: 'USER',
      } as any),
    ).rejects.toThrow(
      `Implementation hint events require service ${serviceId} to have a projectId`,
    );
    expect(eventPublisher.publishInTransaction).not.toHaveBeenCalled();
  });
});
