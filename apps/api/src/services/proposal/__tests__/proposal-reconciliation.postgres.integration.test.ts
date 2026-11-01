import { WorkItemTypeRegistryService } from '../../tasks/work-item-type-registry.service';
import { ProposalApprovalService } from '../proposal-approval.service';
import { WorkItemTypeLifecycleService } from '../../tasks/work-item-type-lifecycle.service';
import { Logger } from '@nestjs/common';
import { ProposalService } from '../proposal.service';
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
  const registry = new WorkItemTypeRegistryService(prisma, {} as never);
  // Task fixtures use ordinary Markdown sections and need no warmed catalog.
  jest.spyOn(registry, 'getSectionDefinition').mockReturnValue(undefined);
  const adapter = new ProposalReconciliationAdapterService(
    registry,
    {} as never,
  );
  const owner = new ProposalReconciliationService(
    adapter,
    {} as never,
    () => 'unused',
  );

  // Keep actual reconciliation, type classification, registry persistence and
  // immediate approval; replace only unrelated event and graph integrations.
  const approval = Object.create(
    ProposalApprovalService.prototype,
  ) as ProposalApprovalService;
  Object.assign(approval, {
    reconciliation: owner,
    workItemTypeRegistry: registry,
    workItemTypeLifecycle: new WorkItemTypeLifecycleService(registry),
    logger: new Logger('TypeSavePersistenceTest'),
    pendingEdgeService: { processDeclaredEdges: async () => [] },
    workItemChangeSetMaterializer: {
      isWorkItemChangeSetValidationRequest: () => false,
      taskProposalChangeSet: () => null,
    },
    publishApprovedEvent: async () => undefined,
  });
  const creation = Object.create(ProposalService.prototype) as ProposalService;
  Object.assign(creation, {
    approvalService: approval,
    logger: new Logger('TypeSaveCreationTest'),
    evaluateApplyOnCreate: async () => ({
      source: 'user',
      config: { threshold: 0, allowsProposerApproval: false },
      meetsThreshold: true,
    }),
  });
  const immediateCreation = creation as unknown as {
    maybeApplyOnCreate: (
      ...args: unknown[]
    ) => Promise<{ proposal: { status: string } }>;
  };

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

  const typeData = (typeKey: string) => ({
    typeKey,
    name: 'Original type',
    role: 'project-info',
    sectionDefinitions: [],
    allowedParentTypes: [],
    edgeTargets: [],
    allowedStatuses: [],
    requiredScalars: [],
    forbiddenScalars: [],
    parentage: { allowedParentEntityTypes: [] },
    tracking: {},
    agentSettableStatuses: [],
    anchorableReportTypes: [],
    writingStandards: {},
    acceptedConfigKinds: [],
    capabilities: {},
  });

  it.each(['custom', 'canonical'] as const)(
    'captures and immediately applies a %s effective type through persisted JSON with unset presentation',
    async (source) => {
      const typeKey = `type-save-${randomUUID()}`;
      const data = typeData(typeKey);
      if (source === 'custom')
        await prisma.workItemType.create({ data: { ...data, projectId } });
      else await prisma.workItemTypeTemplate.create({ data });
      try {
        await prisma.db.$transaction(async (tx) => {
          const proposal = await tx.proposal.create({
            data: {
              organizationId,
              projectId,
              requestorId: randomUUID(),
              action: 'UPDATE',
              targetEntityType: 'WORK_ITEM_TYPE',
              targetEntityId: typeKey,
              updates: {
                definition: {
                  ...registry.materializeDefinition(
                    source === 'custom'
                      ? await tx.workItemType.findUniqueOrThrow({
                          where: { projectId_typeKey: { projectId, typeKey } },
                        })
                      : await tx.workItemTypeTemplate.findUniqueOrThrow({
                          where: { typeKey },
                        }),
                  ),
                  name: 'Saved type',
                },
                acknowledgeCanonicalCustomization: source === 'canonical',
              },
            },
          });
          const live = await adapter.workItemType(tx, proposal, false);
          expect(live.content.definition).toHaveProperty('iconKey', undefined);
          expect(live.content.definition).toHaveProperty('colorKey', undefined);
          await owner.captureAuthoring(tx, proposal);
          const persisted =
            await tx.proposalReconciliationRevision.findFirstOrThrow({
              where: { proposalId: proposal.id },
            });
          const stored = persisted.bases as unknown as (typeof live)[];
          expect(stored[0]!.content.definition).not.toHaveProperty('iconKey');
          expect(stored[0]!.content.definition).not.toHaveProperty('colorKey');
          const result = await immediateCreation.maybeApplyOnCreate(
            tx,
            proposal,
            organizationId,
            projectId,
            {
              action: proposal.action,
              targetEntityType: proposal.targetEntityType,
              updates: proposal.updates,
            },
            {},
            { generic: null },
            () => undefined,
          );
          expect(result.proposal.status).toBe('APPROVED');
        });
        expect(
          (
            await prisma.workItemType.findUniqueOrThrow({
              where: { projectId_typeKey: { projectId, typeKey } },
            })
          ).name,
        ).toBe('Saved type');
      } finally {
        await prisma.workItemType.deleteMany({ where: { projectId, typeKey } });
        if (source === 'canonical')
          await prisma.workItemTypeTemplate.delete({ where: { typeKey } });
      }
    },
  );

  it('blocks genuinely changed and unavailable persisted type bases without replacing current content', async () => {
    const typeKey = `type-drift-${randomUUID()}`;
    await prisma.workItemType.create({
      data: { ...typeData(typeKey), projectId },
    });
    const proposal = await prisma.proposal.create({
      data: {
        organizationId,
        projectId,
        requestorId: randomUUID(),
        action: 'UPDATE',
        targetEntityType: 'WORK_ITEM_TYPE',
        targetEntityId: typeKey,
        updates: { definition: { name: 'Stale edit' } },
      },
    });
    await prisma.db.$transaction((tx) => owner.captureAuthoring(tx, proposal));
    await prisma.workItemType.update({
      where: { projectId_typeKey: { projectId, typeKey } },
      data: { name: 'Intervening edit' },
    });
    await expect(
      prisma.db.$transaction((tx) => owner.assertApplicable(tx, proposal)),
    ).rejects.toThrow(ConflictException);
    expect(
      (
        await prisma.workItemType.findUniqueOrThrow({
          where: { projectId_typeKey: { projectId, typeKey } },
        })
      ).name,
    ).toBe('Intervening edit');
    await prisma.proposalReconciliationRevision.deleteMany({
      where: { proposalId: proposal.id },
    });
    await expect(
      prisma.db.$transaction((tx) => owner.assertApplicable(tx, proposal)),
    ).rejects.toThrow('Original proposal content is unavailable');
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
  it('serializes concurrent standalone review loads and rejects a previously reviewed candidate after drift', async () => {
    const { task, proposal } = await authored();
    await prisma.task.update({
      where: { id: task.id },
      data: { priority: 'HIGH' },
    });
    const service = Object.create(ProposalService.prototype) as ProposalService;
    Object.assign(service, { prisma, reconciliation: owner });
    const load = () =>
      service.reconciliationReviewState(proposal.id, organizationId, projectId);
    const [first, concurrent] = await Promise.all([load(), load()]);
    expect(first.status).toBe('READY_FOR_REVIEW');
    expect(concurrent.candidateRevisionId).toBe(first.candidateRevisionId);
    expect(
      await prisma.proposalReconciliationRevision.count({
        where: { proposalId: proposal.id },
      }),
    ).toBe(2);
    const candidate = first.revisions.find(
      (revision) => revision.id === first.candidateRevisionId,
    )!;
    expect(candidate.proposedResult).toMatchObject({
      name: 'Reviewed name',
      priority: 'HIGH',
    });
    const prepared = await prisma.proposal.findUniqueOrThrow({
      where: { id: proposal.id },
    });
    await prisma.db.$transaction((tx) =>
      owner.assertApplicable(tx, prepared, first.candidateRevisionId, true),
    );
    await prisma.task.update({
      where: { id: task.id },
      data: { priority: 'LOW' },
    });
    await expect(
      prisma.db.$transaction((tx) =>
        owner.assertApplicable(tx, prepared, first.candidateRevisionId, true),
      ),
    ).rejects.toThrow(ConflictException);
    const next = await load();
    expect(next.candidateRevisionId).not.toBe(first.candidateRevisionId);
    await expect(
      prisma.db.$transaction((tx) =>
        owner.assertApplicable(tx, prepared, first.candidateRevisionId, true),
      ),
    ).rejects.toThrow(ConflictException);
  });
});
