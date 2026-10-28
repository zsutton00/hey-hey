import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { AuthenticatedUser } from '../../src/auth/strategies/jwt.strategy';
import type { WorkItemChangeSetValidationRequest } from '../../src/generated';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ProposalGroupAuthoringService } from '../../src/services/proposal/proposal-group-authoring.service';
import { ProposalGroupFinalizationService } from '../../src/services/proposal/proposal-group-finalization.service';
import { ProposalGroupDecisionService } from '../../src/services/proposal/proposal-group-decision.service';
import type { StampedCreateProposalDto } from '../../src/services/proposal/proposal.types';
import { WorkItemTypeRegistryService } from '../../src/services/tasks/work-item-type-registry.service';

// GitHub is outside the approval boundary and its ESM SDK cannot be loaded
// by the existing CommonJS integration runner.
jest.mock('@octokit/rest', () => ({
  Octokit: class {
    constructor() {
      throw new Error('Unexpected GitHub request in journey approval test');
    }
  },
}));

jest.mock('@octokit/graphql', () => ({
  graphql: () => {
    throw new Error('Unexpected GitHub request in journey approval test');
  },
}));

// Uses the integration stack (PostgreSQL, Graph, Redis and Temporal). No
// approval, coordinator, TaskService or materializer methods are replaced.
describe('UX journey grouped approval', () => {
  let app: INestApplication;
  let module: TestingModule;
  let prisma: PrismaService;
  let authoring: ProposalGroupAuthoringService;
  let finalization: ProposalGroupFinalizationService;
  let decisions: ProposalGroupDecisionService;
  let author: AuthenticatedUser;
  let approverId: AuthenticatedUser['userId'];
  let organizationId: AuthenticatedUser['currentOrgId'];
  let projectId: Awaited<
    ReturnType<PrismaService['db']['project']['create']>
  >['id'];
  let parentId: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    const { AppModule } = await import('../../src/app.module');
    const databaseUrl = process.env.DATABASE_URL;
    if (
      !databaseUrl ||
      !['localhost', '127.0.0.1', '[::1]'].includes(
        new URL(databaseUrl).hostname,
      )
    ) {
      throw new Error(
        'Journey approval integration tests require a local PostgreSQL DATABASE_URL',
      );
    }
    module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = module.get(PrismaService);
    authoring = module.get(ProposalGroupAuthoringService);
    finalization = module.get(ProposalGroupFinalizationService);
    decisions = module.get(ProposalGroupDecisionService);

    const organization = await prisma.db.organization.create({
      data: { name: 'Journey approval integration', slug: randomUUID() },
    });
    organizationId = organization.id;
    const project = await prisma.db.project.create({
      data: { organizationId, name: 'Journey approval integration' },
    });
    projectId = project.id;
    const users = await Promise.all(
      ['author', 'reviewer'].map((name) =>
        prisma.db.user.create({
          data: {
            email: `${randomUUID()}@example.test`,
            name,
            passwordHash: 'unused-integration-fixture',
            memberships: { create: { organizationId, role: 'ADMIN' } },
            projectMemberships: { create: { projectId, role: 'OWNER' } },
          },
        }),
      ),
    );
    userIds.push(...users.map((user) => user.id));
    const [writer, reviewer] = users;
    if (!writer || !reviewer) {
      throw new Error('Missing integration users');
    }
    approverId = reviewer.id;
    author = {
      userId: writer.id,
      email: writer.email,
      name: writer.name,
      currentOrgId: organizationId,
      orgMemberships: [{ orgId: organizationId, role: 'ADMIN' }],
      isDevAdmin: false,
      devAdminMode: false,
    };
    // A small project-owned Mockup definition is enough to test identity and
    // publication. Rendering is not part of this approval promise.
    const registry = module.get(WorkItemTypeRegistryService);
    await prisma.db.workItemType.create({
      data: {
        projectId,
        typeKey: 'mockup',
        name: 'Mockup',
        role: 'project-info',
        sectionDefinitions: [{ key: 'description', label: 'Screen' }],
        allowedParentTypes: ['FEATURE'],
        edgeTargets: [],
        allowedStatuses: ['BACKLOG', 'ACTIVE', 'ARCHIVED'],
        requiredScalars: [],
        forbiddenScalars: ['tag'],
        parentage: { allowedParentEntityTypes: ['TASK'] },
        tracking: { allowedSourceEntityTypes: [], allowedSourceTaskTypes: [] },
        agentSettableStatuses: ['BACKLOG', 'ACTIVE'],
        anchorableReportTypes: [],
        writingStandards: { create: '', edit: '' },
        acceptedConfigKinds: [],
        capabilities: { requiresParent: true },
      },
    });
    await registry.refresh();
    parentId = (
      await prisma.db.task.create({
        data: {
          organizationId,
          projectId,
          name: 'Onboarding',
          type: 'FEATURE',
          status: 'BACKLOG',
        },
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    if (prisma && organizationId) {
      await prisma.db.organization.delete({ where: { id: organizationId } });
      await prisma.db.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
    await module?.close();
  });

  async function buildJourney() {
    let snapshot = await authoring.start(organizationId, projectId, {});
    const proposal = (
      name: string,
      updates: StampedCreateProposalDto['updates'],
    ): StampedCreateProposalDto => ({
      type: 'SINGLE',
      targetEntityId: randomUUID(),
      action: 'CREATE',
      targetEntityType: 'TASK',
      title: name,
      eli5: name,
      updates,
      requestorContext: {
        userId: author.userId,
        organizationId,
        source: 'user',
        toolName: 'integration-test',
        timestamp: new Date().toISOString(),
      },
    });
    for (const name of ['Welcome', 'Profile']) {
      snapshot = await authoring.addMember(
        organizationId,
        projectId,
        snapshot.groupId,
        author.userId,
        {
          expectedRevision: snapshot.currentRevision,
          proposal: proposal(name, {
            name,
            type: 'mockup',
            parentTaskId: parentId,
            sections: [{ key: 'description', content: name }],
          }),
        },
      );
    }
    const screens = [...snapshot.members];
    const screenIds = screens.map((screen) => {
      if (!screen.reservedEntityId) {
        throw new Error('Mockup CREATE did not reserve an identity');
      }
      return screen.reservedEntityId;
    });
    const root = { refType: 'temporary', tempId: 'journey' } as const;
    const elements = screenIds.map(
      (_, index) =>
        ({ refType: 'temporary', tempId: `screen-${index}` }) as const,
    );
    const graph: WorkItemChangeSetValidationRequest = {
      root,
      operations: [
        {
          op: 'workItem.create',
          ref: root,
          type: 'DIAGRAM',
          name: 'Onboarding journey',
          parent: { refType: 'existing', id: parentId },
        },
        {
          op: 'section.replace',
          ref: root,
          key: 'diagramMetadata',
          content: { kind: 'UX_FLOW', level: 'OVERVIEW' },
        },
        ...screenIds.flatMap(
          (id, index): WorkItemChangeSetValidationRequest['operations'] => {
            const ref = elements[index]!;
            return [
              {
                op: 'workItem.create',
                ref,
                type: 'DIAGRAM_ELEMENT',
                name: `Screen ${index}`,
                parent: root,
              },
              {
                op: 'section.replace',
                ref,
                key: 'diagramElementMetadata',
                content: {
                  role: 'GENERIC',
                  canonicalReference: { entityType: 'TASK', entityId: id },
                },
              },
            ];
          },
        ),
        {
          op: 'relationship.create',
          ref: { refType: 'temporary', tempId: 'continue' },
          source: elements[0]!,
          target: elements[1]!,
          edgeType: 'STANDARD',
          category: 'flow',
          direction: 'forward',
          actionLabel: 'Continue',
          reasoning: 'Opens Profile',
        },
      ],
    };
    snapshot = await authoring.addMember(
      organizationId,
      projectId,
      snapshot.groupId,
      author.userId,
      {
        expectedRevision: snapshot.currentRevision,
        proposal: proposal('Onboarding journey', graph),
      },
    );
    const journey = snapshot.members.find(
      (member) =>
        !screens.some((screen) => screen.memberId === member.memberId),
    );
    if (!journey?.reservedEntityId) {
      throw new Error('Journey CREATE did not reserve an identity');
    }
    snapshot = await authoring.replacePrerequisites(
      organizationId,
      projectId,
      snapshot.groupId,
      journey.memberId,
      {
        expectedRevision: snapshot.currentRevision,
        prerequisiteMemberIds: new Set(
          screens.map((screen) => screen.memberId),
        ),
      },
    );
    const finalized = await finalization.finalize(
      organizationId,
      projectId,
      snapshot.groupId,
      author,
      {
        expectedRevision: snapshot.currentRevision,
      },
    );
    expect(finalized.outcome).toBe('FINALIZED');
    const members = await prisma.db.proposalGroupMember.findMany({
      where: { groupId: snapshot.groupId },
      orderBy: { memberOrder: 'asc' },
    });
    return {
      groupId: snapshot.groupId,
      screens: members.slice(0, 2),
      journey: members[2]!,
      screenIds,
      journeyId: journey.reservedEntityId,
    };
  }

  async function states(groupId: string) {
    return prisma.db.proposalGroupMember.findMany({
      where: { groupId },
      orderBy: { memberOrder: 'asc' },
    });
  }

  it('approve-all publishes both Mockups at their reserved IDs before publishing their journey', async () => {
    const group = await buildJourney();
    await decisions.approveAll({
      groupId: group.groupId,
      organizationId,
      projectId,
      userId: approverId,
    });
    expect(
      (await states(group.groupId)).map((member) => member.executionState),
    ).toEqual(['APPLIED', 'APPLIED', 'APPLIED']);
    const screens = await prisma.db.task.findMany({
      where: { id: { in: group.screenIds } },
    });
    expect(screens.map((screen) => screen.id).sort()).toEqual(
      [...group.screenIds].sort(),
    );
    const journey = await prisma.db.task.findUniqueOrThrow({
      where: { id: group.journeyId },
    });
    expect(
      screens.every((screen) => screen.createdAt <= journey.createdAt),
    ).toBe(true);
    const elements = await prisma.db.task.findMany({
      where: { parentTaskId: group.journeyId },
      include: { sections: true },
    });
    const references = elements.map((element) => {
      const section = element.sections.find(
        (section) => section.key === 'diagramElementMetadata',
      );
      expect(section?.materializedMarkdown).toBeTruthy();
      return JSON.parse(section!.materializedMarkdown!).canonicalReference
        .entityId;
    });
    expect(references.sort()).toEqual([...group.screenIds].sort());
  }, 60_000);

  it('keeps an accepted Mockup and invalidates an approved waiting journey when the other Mockup is rejected', async () => {
    const group = await buildJourney();
    const decide = (proposalId: string) => ({
      proposalId,
      organizationId,
      projectId,
      userId: approverId,
    });
    await decisions.approve(decide(group.journey.proposalId));
    expect((await states(group.groupId))[2]!.executionState).toBe(
      'WAITING_ON_DEPENDENCIES',
    );
    await decisions.approve(decide(group.screens[0]!.proposalId));
    expect(
      await prisma.db.task.findUnique({ where: { id: group.screenIds[0]! } }),
    ).not.toBeNull();
    expect(
      await prisma.db.task.findUnique({ where: { id: group.journeyId } }),
    ).toBeNull();
    await decisions.reject(decide(group.screens[1]!.proposalId));
    expect(
      (await states(group.groupId)).map((member) => member.executionState),
    ).toEqual(['APPLIED', 'REJECTED', 'INVALIDATED']);
    expect(
      await prisma.db.task.findUnique({ where: { id: group.screenIds[0]! } }),
    ).not.toBeNull();
    expect(
      await prisma.db.task.findUnique({ where: { id: group.screenIds[1]! } }),
    ).toBeNull();
    expect(
      await prisma.db.task.findUnique({ where: { id: group.journeyId } }),
    ).toBeNull();
  }, 60_000);
});
