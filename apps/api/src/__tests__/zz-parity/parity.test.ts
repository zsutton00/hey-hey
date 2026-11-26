import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectAccessService } from '../../auth/services/project-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AttentionSummaryService } from '../../services/analytics/attention-summary.service';
import { startInMemoryPostgres } from '../helpers/in-memory-postgres';
import { reduceAttention, itemKey } from './old-attention';

jest.setTimeout(180_000);

it('matches the previous reducer on captured records, in a non-UTC database session', async () => {
  const logs = join(__dirname, '../../../../cli/logs');
  const byId = new Map<string, any>();
  for (const file of readdirSync(logs).filter((f) =>
    f.startsWith('open-items-triage-'),
  )) {
    for (const read of JSON.parse(readFileSync(join(logs, file), 'utf8'))
      .reads ?? []) {
      if (!read.path.endsWith('/analytics/attention')) continue;
      for (const e of read.data?.events ?? []) {
        const k = `${e.entityType}|${e.entityId}|${e.focusStart}`;
        if (!byId.has(k) || e.focusEnd > byId.get(k).focusEnd) byId.set(k, e);
      }
    }
  }
  const captured = [...byId.values()];
  const latest = Math.max(...captured.map((e) => Date.parse(e.focusEnd)));
  const shift = Date.now() - latest - 1000;
  const records = captured.map((e) => ({
    ...e,
    id: randomUUID(),
    focusStart: new Date(Date.parse(e.focusStart) + shift).toISOString(),
    focusEnd: new Date(Date.parse(e.focusEnd) + shift).toISOString(),
  }));

  const database = await startInMemoryPostgres();
  process.env.PROJECT_DATABASE_URL = database.url;
  const prisma = new PrismaService();
  await prisma.$connect();
  await prisma.db.$executeRawUnsafe("SET TIME ZONE 'America/Los_Angeles'");
  const organizationId = randomUUID(),
    userId = randomUUID(),
    projectId = randomUUID();
  await prisma.db.organization.create({
    data: { id: organizationId, name: 'p', slug: `p-${organizationId}` },
  });
  await prisma.db.user.create({
    data: {
      id: userId,
      email: `${userId}@x.test`,
      name: 'p',
      passwordHash: 'x',
      memberships: { create: { organizationId, role: 'MEMBER' } },
    },
  });
  await prisma.db.project.create({
    data: {
      id: projectId,
      organizationId,
      name: 'p',
      members: { create: { userId, role: 'MEMBER' } },
    },
  });
  await prisma.db.attentionEvent.createMany({
    data: records.map((e) => ({
      id: e.id,
      organizationId,
      userId,
      projectId,
      entityType: e.entityType,
      entityId: e.entityId,
      focusStart: new Date(e.focusStart),
      focusEnd: new Date(e.focusEnd),
      durationMs: e.durationMs,
    })),
  });
  const started = Date.now();
  const summary = await new AttentionSummaryService(
    new ProjectAccessService(prisma),
    prisma,
  ).summarize({ userId, currentOrgId: organizationId } as any, { projectId });
  const elapsed = Date.now() - started;

  const now = Date.parse(summary.asOf);
  const valid = records.filter(
    (e) =>
      Date.parse(e.focusEnd) >= Date.parse(e.focusStart) &&
      e.durationMs <= Date.parse(e.focusEnd) - Date.parse(e.focusStart),
  );
  const entities = [
    ...new Map(
      valid.map((e) => [
        `${e.entityType}:${e.entityId}`,
        { entityType: e.entityType, entityId: e.entityId, title: 't' },
      ]),
    ).values(),
  ];
  const old = reduceAttention(valid, entities, now, true);
  const oldCounters = [...old.openCounters]
    .filter(([, c]) => c.lastViewed !== null)
    .sort(([a], [b]) => a.localeCompare(b));
  const newCounters = summary.items
    .map(
      ({ entity, ...c }) =>
        [`${entity.entityType}:${entity.entityId}`, c] as const,
    )
    .sort(([a], [b]) => a.localeCompare(b));
  expect(newCounters).toEqual(oldCounters);
  expect(
    summary.timeline.map(({ entity, ...s }) => ({
      key: itemKey(entity as any),
      ...s,
    })),
  ).toEqual(
    old.timeline.map(({ item, ...s }) => ({ key: itemKey(item), ...s })),
  );
  expect(
    summary.switches.map((s) => [
      s.entities.map((e) => itemKey(e as any)).join('|'),
      s.occurrences,
    ]),
  ).toEqual(
    old.coAttention.map((p) => [p.items.map(itemKey).join('|'), p.occurrences]),
  );
  process.stdout.write(
    JSON.stringify({
      captured: records.length,
      invalid: records.length - valid.length,
      unreadable: summary.unreadableRecords,
      inWindow: summary.items.reduce((n, i) => n + i.viewsSevenDays, 0),
      items: summary.items.length,
      spans: summary.timeline.length,
      switches: summary.switches.length,
      truncated: summary.truncated,
      elapsedMs: elapsed,
      bytes: JSON.stringify(summary).length,
    }) + '\n',
  );
  await prisma.$disconnect();
  await database.close();
});
