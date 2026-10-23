import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ProposalGroupAuthoringService } from '../../src/services/proposal/proposal-group-authoring.service';
import { ProposalGroupService } from '../../src/services/proposal/proposal-group.service';
import type { OrganizationId, ProjectId } from '../../src/types';

describe('proposal group authoring storage', () => {
  const prisma = new PrismaService();
  const organizationId = randomUUID() as OrganizationId;
  const projectId = randomUUID() as ProjectId;
  const groupService = new ProposalGroupService(prisma);
  const authoringService = new ProposalGroupAuthoringService(
    prisma,
    {} as never,
    groupService,
  );

  beforeAll(async () => {
    await prisma.onModuleInit();
    await prisma.db.organization.create({
      data: {
        id: organizationId,
        name: `Proposal Group Authoring Test ${organizationId}`,
        slug: `proposal-group-authoring-${organizationId}`,
      },
    });
    await prisma.db.project.create({
      data: {
        id: projectId,
        organizationId,
        name: 'Proposal Group Authoring Test',
      },
    });
  });

  afterAll(async () => {
    await prisma.db.organization.deleteMany({
      where: { id: organizationId },
    });
    await prisma.onModuleDestroy();
  });

  it('persists revision one and returns the canonical empty BUILDING snapshot', async () => {
    const snapshot = await authoringService.start(
      organizationId,
      projectId,
      {},
    );
    const persisted = await prisma.db.proposalGroup.findUniqueOrThrow({
      where: { id: snapshot.groupId },
      select: {
        organizationId: true,
        projectId: true,
        status: true,
        revision: true,
        members: { select: { id: true } },
      },
    });

    expect(persisted).toEqual({
      organizationId,
      projectId,
      status: 'BUILDING',
      revision: 1,
      members: [],
    });
    expect(snapshot).toEqual(
      expect.objectContaining({
        groupId: snapshot.groupId,
        organizationId,
        projectId,
        lifecycle: 'BUILDING',
        currentRevision: persisted.revision,
        members: [],
      }),
    );
  });
});
