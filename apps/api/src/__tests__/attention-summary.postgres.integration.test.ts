import { randomUUID } from 'node:crypto';
import { EntityType } from '@prisma/client';
import { ProjectAccessService } from '../auth/services/project-access.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import {
  ReadPolicyContext,
  UNRESTRICTED_READ_POLICY,
} from '../read-restriction/read-policy';
import { AttentionSummaryService } from '../services/analytics/attention-summary.service';
import {
  InMemoryPostgres,
  startInMemoryPostgres,
} from './helpers/in-memory-postgres';

// The counting is SQL, so it runs against the shipped migrations and real PostgreSQL.
jest.setTimeout(180_000);

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

describe('Attention summary', () => {
  const previousDatabaseUrl = process.env.PROJECT_DATABASE_URL;
  const organizationId = randomUUID();
  const userId = randomUUID();
  const user = { userId, currentOrgId: organizationId } as AuthenticatedUser;
  let database: InMemoryPostgres | undefined;
  let prisma: PrismaService;
  let service: AttentionSummaryService;

  beforeAll(async () => {
    database = await startInMemoryPostgres();
    process.env.PROJECT_DATABASE_URL = database.url;
    prisma = new PrismaService();
    await prisma.$connect();
    // Stored instants are UTC; counting must not depend on the session's time zone.
    await prisma.db.$executeRawUnsafe("SET TIME ZONE 'America/Los_Angeles'");
    service = new AttentionSummaryService(
      new ProjectAccessService(prisma),
      prisma,
    );

    await prisma.db.organization.create({
      data: {
        id: organizationId,
        name: 'Attention',
        slug: `a-${organizationId}`,
      },
    });
    await prisma.db.user.create({
      data: {
        id: userId,
        email: `${userId}@example.test`,
        name: 'Viewer',
        passwordHash: 'unused',
        memberships: { create: { organizationId, role: 'MEMBER' } },
      },
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.close();
    process.env.PROJECT_DATABASE_URL = previousDatabaseUrl;
  });

  async function createProject(): Promise<string> {
    const id = randomUUID();
    await prisma.db.project.create({
      data: {
        id,
        organizationId,
        name: `Project ${id}`,
        members: { create: { userId, role: 'MEMBER' } },
      },
    });
    return id;
  }

  /** A focus record that started `agoMs` before now. */
  function record(
    projectId: string,
    entityId: string,
    agoMs: number,
    overrides: {
      entityType?: string;
      lengthMs?: number;
      durationMs?: number;
      userId?: string;
    } = {},
  ) {
    const focusStart = new Date(Date.now() - agoMs);
    const lengthMs = overrides.lengthMs ?? MINUTE_MS;
    return {
      organizationId,
      userId: overrides.userId ?? userId,
      projectId,
      entityType: overrides.entityType ?? EntityType.TASK,
      entityId,
      focusStart,
      focusEnd: new Date(focusStart.getTime() + lengthMs),
      durationMs: overrides.durationMs ?? lengthMs,
    };
  }

  const name = (entityId: string, entityName: string) =>
    prisma.db.entityRegistry.create({
      data: {
        organizationId,
        entityId,
        entityType: EntityType.TASK,
        entityName,
      },
    });

  it('counts every record in the window exactly once, however many there are', async () => {
    const projectId = await createProject();
    const otherProjectId = await createProject();
    const busy = randomUUID();
    const quiet = randomUUID();
    await name(busy, 'Busy task');
    // Far more records than the old paged read could return.
    const busyRecords = Array.from({ length: 6_000 }, (_, index) =>
      record(projectId, busy, MINUTE_MS + index * MINUTE_MS, {
        lengthMs: 1_000,
      }),
    );
    await prisma.db.attentionEvent.createMany({
      data: [
        ...busyRecords,
        record(projectId, quiet, 6 * DAY_MS),
        record(projectId, quiet, 8 * DAY_MS),
        record(otherProjectId, quiet, HOUR_MS),
        record(projectId, quiet, 2 * HOUR_MS + 1, { userId: randomUUID() }),
      ],
    });

    const summary = await service.summarize(user, { projectId });

    const todayStartsAt = new Date(summary.todayStartsAt);
    expect(summary.items).toMatchObject([
      {
        entity: { entityId: busy, entityName: 'Busy task' },
        viewsToday: busyRecords.filter(
          ({ focusStart }) => focusStart >= todayStartsAt,
        ).length,
        viewsSevenDays: 6_000,
        focusMsSevenDays: 6_000_000,
      },
      {
        entity: { entityId: quiet, entityName: 'Unknown' },
        viewsSevenDays: 1,
        focusMsSevenDays: MINUTE_MS,
        viewsToday: 0,
      },
    ]);
    expect(summary.unreadableRecords).toBe(0);
  });

  it('clips focus that began before the window and counts it as no view', async () => {
    const projectId = await createProject();
    const entityId = randomUUID();
    await prisma.db.attentionEvent.create({
      data: record(projectId, entityId, 7 * DAY_MS + HOUR_MS, {
        lengthMs: 2 * HOUR_MS,
      }),
    });

    const summary = await service.summarize(user, { projectId });
    const focusMs = summary.items[0]?.focusMsSevenDays;

    expect(summary.items).toMatchObject([{ viewsSevenDays: 0 }]);
    expect(focusMs).toBeGreaterThan(HOUR_MS - MINUTE_MS);
    expect(focusMs).toBeLessThanOrEqual(HOUR_MS);
  });

  it('builds spans and switching pairs from views in the order they happened', async () => {
    const projectId = await createProject();
    const [a, b, c, service1] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];
    await prisma.db.attentionEvent.createMany({
      data: [
        // a, a (one span) then b, a, b: three a/b switches. c follows after a long gap.
        record(projectId, a, 120 * MINUTE_MS),
        record(projectId, a, 115 * MINUTE_MS),
        // An ignored type between views neither splits a span nor breaks a switch.
        record(projectId, service1, 112 * MINUTE_MS, {
          entityType: EntityType.SERVICE,
        }),
        record(projectId, b, 110 * MINUTE_MS),
        record(projectId, a, 105 * MINUTE_MS),
        record(projectId, b, 100 * MINUTE_MS),
        record(projectId, c, 60 * MINUTE_MS),
        record(projectId, c, 30 * MINUTE_MS),
        // Older than the timeline's 48 hours.
        record(projectId, c, 3 * DAY_MS),
      ],
    });

    const summary = await service.summarize(user, {
      projectId,
      entityTypes: [EntityType.TASK],
    });

    expect(summary.items.map((item) => item.entity.entityId).sort()).toEqual(
      [a, b, c].sort(),
    );
    expect(
      summary.timeline.map((span) => [
        span.entity.entityId,
        span.views,
        span.focusMs,
      ]),
    ).toEqual([
      [a, 2, 2 * MINUTE_MS],
      [b, 1, MINUTE_MS],
      [a, 1, MINUTE_MS],
      [b, 1, MINUTE_MS],
      [c, 1, MINUTE_MS],
      [c, 1, MINUTE_MS],
    ]);
    expect(
      summary.switches.map((pair) => [
        pair.entities.map((entity) => entity.entityId).sort(),
        pair.occurrences,
      ]),
    ).toEqual([[[a, b].sort(), 3]]);
    expect(summary.truncated).toEqual({ switches: false, timeline: false });
  });

  it('keeps the latest spans and says when the timeline was cut', async () => {
    const projectId = await createProject();
    const ids = Array.from({ length: 101 }, () => randomUUID());
    await prisma.db.attentionEvent.createMany({
      data: ids.map((id, index) =>
        record(projectId, id, (ids.length - index) * MINUTE_MS, {
          lengthMs: 1_000,
        }),
      ),
    });

    const summary = await service.summarize(user, { projectId });

    expect(summary.items).toHaveLength(101);
    expect(summary.timeline.map((span) => span.entity.entityId)).toEqual(
      ids.slice(1),
    );
    expect(summary.truncated.timeline).toBe(true);
  });

  it('leaves out and counts records it cannot read, keeping the rest', async () => {
    const projectId = await createProject();
    const healthy = randomUUID();
    const legacy = randomUUID();
    await prisma.db.attentionEvent.createMany({
      data: [
        record(projectId, healthy, HOUR_MS),
        record(projectId, legacy, 2 * HOUR_MS, {
          entityType: 'coding-session',
        }),
        record(projectId, randomUUID(), 3 * HOUR_MS, { entityType: 'WIDGET' }),
        record(projectId, randomUUID(), 4 * HOUR_MS, {
          durationMs: 2 * MINUTE_MS,
        }),
      ],
    });

    const summary = await service.summarize(user, { projectId });

    expect(summary.items.map((item) => item.entity)).toMatchObject([
      { entityId: healthy, entityType: 'TASK' },
      { entityId: legacy, entityType: 'AGENT_SESSION' },
    ]);
    expect(summary.unreadableRecords).toBe(2);
  });

  it('leaves items the request may not read out of every list', async () => {
    const projectId = await createProject();
    const [a, b, hidden] = [randomUUID(), randomUUID(), randomUUID()];
    await prisma.db.task.create({
      data: {
        id: hidden,
        organizationId,
        projectId,
        name: 'Restricted',
        type: 'EVAL',
      },
    });
    await prisma.db.attentionEvent.createMany({
      data: [a, hidden, b, a, hidden, b].map((id, index) =>
        record(projectId, id, (10 - index) * MINUTE_MS, { lengthMs: 1_000 }),
      ),
    });

    const summary = await ReadPolicyContext.run(
      { ...UNRESTRICTED_READ_POLICY, excludedTaskTypes: ['EVAL'] },
      () => service.summarize(user, { projectId }),
    );

    expect(JSON.stringify(summary)).not.toContain(hidden);
    expect(summary.items).toHaveLength(2);
    expect(summary.timeline).toHaveLength(4);
    expect(summary.switches).toMatchObject([{ occurrences: 3 }]);
  });

  it('returns an empty summary for a project with no attention', async () => {
    const projectId = await createProject();

    await expect(service.summarize(user, { projectId })).resolves.toMatchObject(
      { items: [], switches: [], timeline: [], unreadableRecords: 0 },
    );
  });
});
