import { Injectable, Logger } from '@nestjs/common';
import { ProjectStatus } from '@prisma/client';
import { AnyTransactionClient, PrismaService } from '../prisma/prisma.service';
import { OrganizationId, ProjectId, UserId } from 'src/types';
import { ProjectService } from './project.service';

export const LOCAL_DEFAULT_PROJECT_NAME = 'My First Project';

/** The organization's first project, the context of the first local grant. */
export async function findLocalDefaultProjectId(
  db: Pick<AnyTransactionClient, 'project'>,
  organizationId: string,
): Promise<ProjectId | null> {
  const project = await db.project.findFirst({
    where: { organizationId, deletedAt: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  return (project?.id as ProjectId | undefined) ?? null;
}

/** Project creation includes onboarding startup, which can outlast Prisma's 5s default. */
const ENSURE_TIMEOUT_MS = 60_000;

/**
 * Owns the one project a first-time `heyhey local` installation starts with.
 * Saving the name creates it so pairing has a project for its first grant;
 * first-project setup then completes this same project.
 */
@Injectable()
export class LocalDefaultProjectService {
  private readonly logger = new Logger(LocalDefaultProjectService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectService: ProjectService,
  ) {}

  /** Creates the organization's first project once; repeated and concurrent saves reuse it. */
  async ensure(
    userId: UserId,
    organizationId: OrganizationId,
  ): Promise<ProjectId> {
    // The lock is held in this transaction while project creation commits in
    // its own, so a concurrent save waits and then sees the committed project.
    // Creation must commit independently: it starts onboarding, which reads it.
    return this.prisma.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 77))`;
        const existing = await findLocalDefaultProjectId(tx, organizationId);
        if (existing) {
          return existing;
        }

        const created = await this.projectService.create(
          {
            name: LOCAL_DEFAULT_PROJECT_NAME,
            description: null,
            organizationId,
          },
          userId,
        );
        this.logger.log('Local default project created', {
          projectId: created.id,
          organizationId,
        });
        return created.id as ProjectId;
      },
      { timeout: ENSURE_TIMEOUT_MS },
    );
  }

  findDefault(organizationId: OrganizationId): Promise<ProjectId | null> {
    return findLocalDefaultProjectId(this.prisma.db, organizationId);
  }

  /**
   * The project first-project setup should resume: the default project while
   * it is still onboarding and no project in the organization has left
   * onboarding. Null once the workspace has a project with setup complete.
   */
  async findUnfinished(
    organizationId: OrganizationId,
  ): Promise<ProjectId | null> {
    const projects = await this.prisma.db.project.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, status: true },
    });
    if (
      projects.some((project) => project.status !== ProjectStatus.ONBOARDING)
    ) {
      return null;
    }
    return (projects[0]?.id as ProjectId | undefined) ?? null;
  }
}
