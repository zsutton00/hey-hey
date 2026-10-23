import type { Prisma } from '@prisma/client';
import { EntityType, type ActivityCorrelationRecordDto } from 'src/generated';
import type { PrismaService } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId, UserId } from 'src/types';

interface HistoryEntity {
  entityId: string;
  entityType: EntityType;
  projectId?: string;
}
type HistoryMetadata = Pick<
  ActivityCorrelationRecordDto,
  'responsibleUser' | 'projectName' | 'entityCreatedAt' | 'status'
>;
const userSelect = {
  id: true,
  name: true,
  email: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;
type HistoryUser = Prisma.UserGetPayload<{ select: typeof userSelect }>;

function entityMetadata(
  createdAt: Date,
  status: string,
  user: HistoryUser | null,
): HistoryMetadata {
  return {
    entityCreatedAt: createdAt.toISOString(),
    status,
    responsibleUser: user
      ? {
          ...user,
          id: user.id as UserId,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
        }
      : null,
  };
}

function entityIds(
  records: readonly HistoryEntity[],
  type: EntityType,
): string[] {
  return [
    ...new Set(
      records
        .filter((record) => record.entityType === type)
        .map((record) => record.entityId),
    ),
  ];
}

async function loadEntityMetadata(
  prisma: PrismaService,
  organizationId: OrganizationId,
  records: readonly HistoryEntity[],
) {
  const taskIds = entityIds(records, EntityType.Task);
  const sessionIds = entityIds(records, EntityType.AgentSession);
  const [tasks, sessions] = await Promise.all([
    taskIds.length
      ? prisma.db.task.findMany({
          where: { organizationId, id: { in: taskIds } },
          select: {
            id: true,
            createdAt: true,
            status: true,
            assignee: { select: userSelect },
          },
        })
      : [],
    sessionIds.length
      ? prisma.db.agentSession.findMany({
          where: { organizationId, id: { in: sessionIds } },
          select: {
            id: true,
            createdAt: true,
            status: true,
            user: { select: userSelect },
          },
        })
      : [],
  ]);
  return new Map<string, HistoryMetadata>([
    ...tasks.map(
      (task) =>
        [
          `${EntityType.Task}:${task.id}`,
          entityMetadata(task.createdAt, task.status, task.assignee),
        ] as const,
    ),
    ...sessions.map(
      (session) =>
        [
          `${EntityType.AgentSession}:${session.id}`,
          entityMetadata(session.createdAt, session.status, session.user),
        ] as const,
    ),
  ]);
}

async function loadProjectNames(
  prisma: PrismaService,
  organizationId: OrganizationId,
  records: readonly HistoryEntity[],
  sourceProjectId?: ProjectId,
) {
  const projectIds = [
    ...new Set(
      records.flatMap((record) => record.projectId ?? sourceProjectId ?? []),
    ),
  ];
  const projects = projectIds.length
    ? await prisma.db.project.findMany({
        where: { organizationId, id: { in: projectIds } },
        select: { id: true, name: true },
      })
    : [];
  return new Map<string, string>(
    projects.map((project) => [project.id, project.name]),
  );
}

export async function hydrateActivityHistoryMetadata<T extends HistoryEntity>(
  prisma: PrismaService,
  organizationId: OrganizationId,
  records: T[],
  sourceProjectId?: ProjectId,
): Promise<Array<T & HistoryMetadata>> {
  if (!records.length) return [];
  const [metadata, projectNames] = await Promise.all([
    loadEntityMetadata(prisma, organizationId, records),
    loadProjectNames(prisma, organizationId, records, sourceProjectId),
  ]);
  return records.map((record) => ({
    ...record,
    ...(metadata.get(`${record.entityType}:${record.entityId}`) ?? {
      responsibleUser: null,
      entityCreatedAt: null,
    }),
    projectName:
      projectNames.get(record.projectId ?? sourceProjectId ?? '') ?? null,
  }));
}
