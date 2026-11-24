import { randomUUID } from 'node:crypto';
import { AgentSessionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { OrganizationId, ProjectId } from '../../types';
import { AgentSessionService } from '../agent-session.service';

const describeDatabase =
  process.env.RUN_SERVICE_PLACES_RECENT_DB_TESTS === '1' &&
  process.env.PROJECT_DATABASE_URL
    ? describe
    : describe.skip;

const BASE = Date.parse('2026-01-01T00:00:00.000Z');
const at = (minutes: number): Date => new Date(BASE + minutes * 60_000);

describeDatabase('listRecentServicePlaces against PostgreSQL', () => {
  let prisma: PrismaService;
  let agentSessions: AgentSessionService;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    agentSessions = new AgentSessionService(
      prisma,
      { publishInTransaction: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  afterEach(async () => {
    for (const organizationId of organizationIds.splice(0)) {
      await prisma.db.organization.deleteMany({ where: { id: organizationId } });
    }
    for (const userId of userIds.splice(0)) {
      await prisma.db.user.deleteMany({ where: { id: userId } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('returns distinct non-null branches per Service from this project only, newest record first, at most ten', async () => {
    const userId = randomUUID();
    const organizationId = randomUUID();
    const projectId = randomUUID();
    const otherProjectId = randomUUID();
    const apiServiceId = randomUUID();
    const webServiceId = randomUUID();
    userIds.push(userId);
    organizationIds.push(organizationId);

    await prisma.db.user.create({
      data: {
        id: userId,
        email: `recent-places-${randomUUID()}@example.com`,
        name: 'Recent places integration user',
        passwordHash: 'integration-test-password-hash',
      },
    });
    await prisma.db.organization.create({
      data: {
        id: organizationId,
        name: `Recent places ${randomUUID()}`,
        slug: `recent-places-${randomUUID()}`,
      },
    });
    await prisma.db.project.createMany({
      data: [projectId, otherProjectId].map((id) => ({
        id,
        name: 'Recent places project',
        organizationId,
        status: 'ACTIVE',
      })),
    });
    await prisma.db.service.createMany({
      data: [
        { id: apiServiceId, name: 'api', organizationId, projectId },
        { id: webServiceId, name: 'web', organizationId, projectId },
      ],
    });

    const record = async (input: {
      projectId: string;
      serviceId: string;
      kind: 'MAIN_FOLDER' | 'WORKTREE';
      branch: string | null;
      minutes: number;
    }) => {
      const session = await prisma.db.agentSession.create({
        data: {
          organizationId,
          userId,
          projectId: input.projectId,
          sessionDate: at(input.minutes),
          title: 'Recent places session',
          type: AgentSessionType.CODING,
          status: 'IN_PROGRESS',
        },
      });
      await prisma.db.serviceAgentSession.create({
        data: {
          serviceId: input.serviceId,
          agentSessionId: session.id,
          placeKind: input.kind,
          placeBranch: input.branch,
          placeWorktreePath:
            input.kind === 'WORKTREE' ? `/wt/${input.branch}` : null,
          placeRecordedAt: at(input.minutes),
        },
      });
    };

    // api: twelve distinct branches, b0 oldest .. b11 newest.
    for (let i = 0; i < 12; i += 1) {
      await record({
        projectId,
        serviceId: apiServiceId,
        kind: 'WORKTREE',
        branch: `b${i}`,
        minutes: i,
      });
    }
    // b5 is recorded again later, from the main folder: its newest record wins.
    await record({
      projectId,
      serviceId: apiServiceId,
      kind: 'MAIN_FOLDER',
      branch: 'b5',
      minutes: 100,
    });
    // A detached main folder has no branch to offer.
    await record({
      projectId,
      serviceId: apiServiceId,
      kind: 'MAIN_FOLDER',
      branch: null,
      minutes: 200,
    });
    // Another project's records on the same Service must not leak in or move a timestamp.
    await record({
      projectId: otherProjectId,
      serviceId: apiServiceId,
      kind: 'WORKTREE',
      branch: 'only-in-other-project',
      minutes: 300,
    });
    await record({
      projectId: otherProjectId,
      serviceId: apiServiceId,
      kind: 'WORKTREE',
      branch: 'b3',
      minutes: 400,
    });
    await record({
      projectId,
      serviceId: webServiceId,
      kind: 'MAIN_FOLDER',
      branch: 'main',
      minutes: 50,
    });

    const result = await agentSessions.listRecentServicePlaces({
      organizationId: organizationId as OrganizationId,
      projectId: projectId as ProjectId,
      serviceIds: [webServiceId, apiServiceId],
    });

    expect(result.services.map((entry) => entry.serviceId)).toEqual([
      webServiceId,
      apiServiceId,
    ]);
    expect(result.services[0]?.branches).toEqual([
      { branch: 'main', kind: 'MAIN_FOLDER', lastRecordedAt: at(50).toISOString() },
    ]);
    expect(result.services[1]?.branches).toEqual([
      { branch: 'b5', kind: 'MAIN_FOLDER', lastRecordedAt: at(100).toISOString() },
      ...[11, 10, 9, 8, 7, 6, 4, 3, 2].map((i) => ({
        branch: `b${i}`,
        kind: 'WORKTREE',
        lastRecordedAt: at(i).toISOString(),
      })),
    ]);
  });
});
