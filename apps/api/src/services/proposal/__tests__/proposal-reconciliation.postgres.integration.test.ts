import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProposalReconciliationAdapterService } from '../proposal-reconciliation-adapter.service';
import { ProposalReconciliationService } from '../proposal-reconciliation.service';
import type { OrganizationId, ProjectId } from 'src/types';

const databaseTests =
  process.env.RUN_RECONCILIATION_DB_TESTS === '1' ? describe : describe.skip;

databaseTests('reconciliation guarded PostgreSQL writes', () => {
  const prisma = new PrismaService();
  const organizationId = randomUUID() as OrganizationId;
  const projectId = randomUUID() as ProjectId;
  const adapter = new ProposalReconciliationAdapterService(
    { getSectionDefinition: () => undefined } as never,
    {} as never,
  );
  const owner = new ProposalReconciliationService(
    adapter,
    {} as never,
    () => 'unused',
  );

  beforeAll(async () => {
    await prisma.$connect();
    const database = await prisma.$queryRaw<
      Array<{ name: string }>
    >`SELECT current_database() AS name`;
    expect(database[0]?.name).toMatch(/^hey_hey_wt_/);
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: 'Reconciliation test',
        slug: `reconciliation-${organizationId}`,
      },
    });
    await prisma.project.create({
      data: { id: projectId, organizationId, name: 'Reconciliation test' },
    });
  });
  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  async function authored() {
    const task = await prisma.task.create({
      data: { organizationId, projectId, name: 'Original', type: 'STANDARD' },
    });
    const section = await prisma.taskSection.create({
      data: {
        taskId: task.id,
        key: 'description',
        order: 0,
        materializedMarkdown: 'Original body',
      },
    });
    const proposal = await prisma.proposal.create({
      data: {
        organizationId,
        projectId,
        action: 'UPDATE',
        targetEntityType: 'TASK',
        targetEntityId: task.id,
        requestorId: randomUUID(),
        updates: { name: 'Reviewed name' },
      },
    });
    await prisma.db.$transaction((tx) => owner.captureAuthoring(tx, proposal));
    return { task, section, proposal };
  }

  it('detects direct section edits and CRDT appends without relying on the parent timestamp', async () => {
    const { task, section, proposal } = await authored();
    await prisma.taskSection.update({
      where: { id: section.id },
      data: { materializedMarkdown: 'Intervening body' },
    });
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: task.id } }))
        .updatedAt,
    ).toEqual(task.updatedAt);
    await expect(
      prisma.db.$transaction((tx) => owner.assertApplicable(tx, proposal)),
    ).rejects.toThrow(ConflictException);
    const second = await authored();
    await prisma.taskSectionUpdate.create({
      data: {
        sectionId: second.section.id,
        seq: 1,
        updateBytes: Buffer.from([1, 2, 3]),
        updateHash: 'reconciliation-test-update',
      },
    });
    await expect(
      prisma.db.$transaction((tx) =>
        owner.assertApplicable(tx, second.proposal),
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('blocks concurrent section writers until the reviewed application commits', async () => {
    const { section, proposal } = await authored();
    let acquired!: () => void;
    let release!: () => void;
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const application = prisma.db.$transaction(
      async (tx) => {
        await owner.assertApplicable(tx, proposal);
        acquired();
        await released;
        await tx.task.update({
          where: { id: proposal.targetEntityId },
          data: { name: 'Reviewed name' },
        });
      },
      { timeout: 10000 },
    );
    await locked;
    try {
      await expect(
        prisma.db.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '150ms'`;
          await tx.taskSection.update({
            where: { id: section.id },
            data: { materializedMarkdown: 'Concurrent body' },
          });
        }),
      ).rejects.toThrow();
    } finally {
      release();
      await application;
    }
    expect(
      (
        await prisma.taskSection.findUniqueOrThrow({
          where: { id: section.id },
        })
      ).materializedMarkdown,
    ).toBe('Original body');
  });

  it('retains completed effects across retry and refuses subsequent external drift', async () => {
    const { task, proposal } = await authored();
    const intent = await prisma.workItemChangeSetMaterialization.create({
      data: {
        proposalId: proposal.id,
        organizationId,
        projectId,
        validationRevision: 'test',
        priorProjectionRevision: 'test',
        operationSet: {},
        workItemIdMappings: {},
        relationshipIdMappings: {},
        priorProjection: {},
      },
    });
    let writes = 0;
    const apply = () =>
      prisma.db.$transaction((tx) =>
        owner.guardTaskEffect(
          tx,
          proposal,
          intent.id,
          task.id,
          0,
          false,
          async () => {
            writes++;
            await tx.task.update({
              where: { id: task.id },
              data: { name: 'Reviewed name' },
            });
          },
        ),
      );
    await apply();
    await apply();
    expect(writes).toBe(1);
    await prisma.task.update({
      where: { id: task.id },
      data: { name: 'Intervening name' },
    });
    await expect(apply()).rejects.toThrow(ConflictException);
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).name,
    ).toBe('Intervening name');
  });
});
