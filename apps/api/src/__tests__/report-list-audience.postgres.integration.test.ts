import { randomUUID } from 'node:crypto';
import {
  type ImplementReportPayload,
  type PhaseGroundingReportPayload,
  ReportAudience,
  ReportRelatedEntityType,
} from '@hey-hey/contracts/api/models';
import { ProjectAccessService } from '../auth/services/project-access.service';
import {
  ProjectReportsController,
  ReportController,
} from '../controllers/report.controller';
import { PrismaService } from '../prisma/prisma.service';
import { EntityRegistryService } from '../services/entity-registry/entity-registry.service';
import { ReportService } from '../services/reports/report.service';
import { OrganizationId } from '../types';
import { createMockDomainEventPublisher } from '../utils/testUtils';
import {
  InMemoryPostgres,
  startInMemoryPostgres,
} from './helpers/in-memory-postgres';

// Exercise the controllers, report queries and DTO mapping against the shipped
// migrations and real PostgreSQL. Only event publication is stubbed.
jest.setTimeout(180_000);

describe('User-facing session report audiences', () => {
  const previousDatabaseUrl = process.env.PROJECT_DATABASE_URL;
  const organizationId = randomUUID() as OrganizationId;
  const userId = randomUUID();
  const sessionId = randomUUID();
  const projectId = randomUUID();
  let database: InMemoryPostgres | undefined;
  let prisma: PrismaService;
  let controller: ReportController;
  let projectController: ProjectReportsController;

  beforeAll(async () => {
    database = await startInMemoryPostgres();
    process.env.PROJECT_DATABASE_URL = database.url;
    prisma = new PrismaService();
    await prisma.$connect();
    const service = new ReportService(
      prisma,
      createMockDomainEventPublisher(),
      new EntityRegistryService(prisma),
    );
    controller = new ReportController(
      new ProjectAccessService(prisma),
      service,
    );
    projectController = new ProjectReportsController(service);

    await prisma.db.organization.create({
      data: {
        id: organizationId,
        name: 'Reports',
        slug: `r-${organizationId}`,
      },
    });
    await prisma.db.user.create({
      data: {
        id: userId,
        email: `${userId}@example.test`,
        name: 'Report viewer',
        passwordHash: 'unused',
        memberships: { create: { organizationId, role: 'MEMBER' } },
      },
    });
    await prisma.db.project.create({
      data: {
        id: projectId,
        organizationId,
        name: 'Private session reports',
        members: { create: { userId, role: 'MEMBER' } },
      },
    });
    await prisma.db.agentSession.create({
      data: {
        id: sessionId,
        organizationId,
        projectId,
        userId,
        title: 'Session with published output and internal grounding',
        sessionDate: new Date(),
      },
    });

    for (const [index, audience] of [
      ReportAudience.ProjectVisible,
      ReportAudience.OrganizationVisible,
      ReportAudience.WorkflowOnly,
    ].entries()) {
      await prisma.db.report.create({
        data: {
          organizationId,
          projectId,
          audience,
          reportType:
            audience === 'WORKFLOW_ONLY' ? 'PHASE_GROUNDING' : 'IMPLEMENT',
          payload:
            audience === 'WORKFLOW_ONLY'
              ? ({
                  reportType: 'PHASE_GROUNDING',
                  summary: 'Internal grounding',
                  touchPoints: [
                    {
                      file: 'src/private.ts',
                      expectedOutcome: 'Internal work',
                    },
                  ],
                } satisfies PhaseGroundingReportPayload)
              : ({
                  reportType: 'IMPLEMENT',
                  summary: 'Published implementation result',
                  filesChanged: ['src/private.ts'],
                } satisfies ImplementReportPayload),
          createdAt: new Date(Date.UTC(2026, 10, 13, 0, index)),
          reportEntities: {
            create: {
              entityType: 'AGENT_SESSION',
              entityId: sessionId,
              relation: 'CONTEXT',
            },
          },
        },
      });
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.close();
    if (previousDatabaseUrl === undefined) {
      delete process.env.PROJECT_DATABASE_URL;
    } else {
      process.env.PROJECT_DATABASE_URL = previousDatabaseUrl;
    }
  });

  const readSessionReports = (audience?: ReportAudience, limit?: string) =>
    controller.findAll(
      userId,
      organizationId,
      projectId,
      undefined,
      audience,
      undefined,
      ReportRelatedEntityType.AgentSession,
      sessionId,
      undefined,
      undefined,
      undefined,
      limit,
    );

  it('returns both visible audiences without internal reports, filtering before pagination', async () => {
    const reports = await readSessionReports();
    expect(reports.map((report) => report.audience)).toEqual([
      'ORGANIZATION_VISIBLE',
      'PROJECT_VISIBLE',
    ]);
    expect(await readSessionReports(undefined, '1')).toEqual([reports[0]]);
    expect(
      await projectController.listProjectReports(organizationId, projectId),
    ).toEqual(reports);
  });

  it('preserves visible audience selection and cannot opt into workflow-only reports', async () => {
    expect(await readSessionReports(ReportAudience.WorkflowOnly)).toEqual([]);
    const reports = await readSessionReports(ReportAudience.ProjectVisible);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.audience).toBe('PROJECT_VISIBLE');
  });
});
