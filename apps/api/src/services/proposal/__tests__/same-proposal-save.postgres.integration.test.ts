import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId } from 'src/types';
import { WorkItemTypeRegistryService } from '../../tasks/work-item-type-registry.service';
import { ProposalReconciliationAdapterService } from '../proposal-reconciliation-adapter.service';
import { ProposalReconciliationService } from '../proposal-reconciliation.service';
import { ProposalService } from '../proposal.service';
import { stageFutureRevision } from '../future-revision';

const databaseTests =
  process.env.RUN_RECONCILIATION_DB_TESTS === '1' ? describe : describe.skip;
databaseTests('same-proposal persisted reconciliation', () => {
  const prisma = new PrismaService();
  const organizationId = randomUUID() as OrganizationId;
  const projectId = randomUUID() as ProjectId;
  const users = [randomUUID(), randomUUID()];
  const registry = new WorkItemTypeRegistryService(prisma, {} as never);
  jest.spyOn(registry, 'getSectionDefinition').mockReturnValue(undefined);
  jest.spyOn(registry, 'getGraphCapability').mockReturnValue(null);
  const content = async (id: string) => {
    const task = await prisma.task.findUniqueOrThrow({
      where: { id },
      include: { sections: true },
    });
    return {
      id,
      organizationId,
      projectId,
      type: task.type,
      name: task.name,
      source: task.source,
      status: task.status,
      sections: task.sections.map((s) => ({
        id: s.id,
        key: s.key,
        order: s.order,
        materializedMarkdown: s.materializedMarkdown ?? '',
      })),
    };
  };
  const adapter = new ProposalReconciliationAdapterService(registry, {
    get: () => ({ findOne: (_org: string, id: string) => content(id) }),
  } as never);
  const reconciliation = new ProposalReconciliationService(
    adapter,
    { getEdges: async () => [] } as never,
    () => 'unused',
  );
  const service = Object.create(ProposalService.prototype) as ProposalService;
  Object.assign(service, {
    prisma,
    reconciliation,
    workItemTypeRegistry: registry,
    logger: new Logger('PersistedSameProposalTest'),
  });
  beforeAll(async () => {
    await prisma.$connect();
    const database = await prisma.$queryRaw<
      Array<{ name: string }>
    >`SELECT current_database() AS name`;
    expect(database[0]?.name).toMatch(/^hey_hey_wt_/);
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: 'Isolated save test',
        slug: organizationId,
      },
    });
    await prisma.project.create({
      data: { id: projectId, organizationId, name: 'Isolated save test' },
    });
    for (const id of users)
      await prisma.user.create({
        data: {
          id,
          email: `${id}@example.test`,
          name: 'Reviewer',
          passwordHash: 'not-an-authenticated-test-user',
        },
      });
  });
  afterAll(async () => {
    await prisma.proposalReconciliationSuggestion.deleteMany({
      where: {
        proposalId: {
          in: (
            await prisma.proposal.findMany({
              where: { projectId },
              select: { id: true },
            })
          ).map((p) => p.id),
        },
      },
    });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });
  it('persists the same identity, retires two votes with evidence, rejects stale saves and stages the fresh candidate once', async () => {
    const task = await prisma.task.create({
      data: {
        organizationId,
        projectId,
        name: 'Live content',
        type: 'FEATURE',
      },
    });
    const live = await content(task.id);
    const futureId = randomUUID();
    let proposal = await prisma.proposal.create({
      data: {
        organizationId,
        projectId,
        action: 'VERSIONED_UPDATE',
        targetEntityType: 'TASK',
        targetEntityId: task.id,
        requestorId: users[0]!,
        updates: {
          operation: 'REVISE',
          futureId,
          expectedRevision: 0,
          baseline: { kind: 'LIVE', revision: 'initial', content: live },
          result: { ...live, name: 'Original candidate' },
          dependencies: [],
        } as unknown as Prisma.InputJsonValue,
      },
    });
    await prisma.db.$transaction(async (tx) => {
      await reconciliation.captureAuthoring(tx, proposal);
      await stageFutureRevision(tx, registry, proposal);
      await tx.proposal.update({
        where: { id: proposal.id },
        data: { status: 'APPROVED' },
      });
      for (const userId of users)
        await tx.proposalApprovalRecord.create({
          data: { proposalId: proposal.id, userId, type: 'APPROVAL' },
        });
    });
    const state = await service.reconciliationState(
      proposal.id,
      organizationId,
      projectId,
    );
    const input = {
      method: 'MANUAL' as const,
      expectedFutureRevision: 1,
      expectedCandidateRevisionId: state.candidateRevisionId,
      expectedCurrentBases: state.currentBases,
      proposedResult: { ...live, name: 'Saved candidate' },
    };
    const save = () =>
      service.reconcile(
        proposal.id,
        organizationId,
        projectId,
        { userId: users[0] } as never,
        input,
        {} as never,
      );
    const results = await Promise.allSettled([save(), save()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    proposal = await prisma.proposal.findUniqueOrThrow({
      where: { id: proposal.id },
    });
    expect(proposal.status).toBe('DRAFT');
    expect(proposal.updates).toMatchObject({
      futureId,
      result: { name: 'Saved candidate' },
      dependencies: [],
    });
    expect(await prisma.proposal.count({ where: { projectId } })).toBe(1);
    expect(
      await prisma.proposalApprovalRecord.count({
        where: { proposalId: proposal.id },
      }),
    ).toBe(0);
    const audit = await prisma.$queryRaw<
      Array<{ candidate_revision_id: string }>
    >`SELECT candidate_revision_id FROM proposal_approval_audit WHERE proposal_id = ${proposal.id}`;
    expect(audit).toHaveLength(2);
    expect(
      audit.every((a) => a.candidate_revision_id === state.candidateRevisionId),
    ).toBe(true);
    expect((await content(task.id)).name).toBe('Live content');
    const reloaded = await service.reconciliationState(
      proposal.id,
      organizationId,
      projectId,
    );
    expect(reloaded.candidateRevisionId).not.toBe(state.candidateRevisionId);
    expect(reloaded.revisions.at(-1)?.proposedResult).toMatchObject({
      name: 'Saved candidate',
    });
    await expect(save()).rejects.toThrow('proposal changed');
    const suggest = () =>
      prisma.proposalReconciliationSuggestion.create({
        data: {
          proposalId: proposal.id,
          candidateRevisionId: reloaded.candidateRevisionId!,
          request: {
            ...input,
            method: 'AGENT_FIX',
            expectedCandidateRevisionId: reloaded.candidateRevisionId,
            expectedCurrentBases: reloaded.currentBases,
            proposedResult: { ...live, name: 'Accepted candidate' },
          } as unknown as Prisma.InputJsonValue,
        },
      });
    const rejected = await suggest();
    const decide = (
      suggestionId: string,
      method: 'ACCEPT_SUGGESTION' | 'REJECT_SUGGESTION',
    ) =>
      service.reconcile(
        proposal.id,
        organizationId,
        projectId,
        { userId: users[0] } as never,
        { method, suggestionId },
        {} as never,
      );
    await decide(rejected.id, 'REJECT_SUGGESTION');
    expect(
      (
        await service.reconciliationState(
          proposal.id,
          organizationId,
          projectId,
        )
      ).candidateRevisionId,
    ).toBe(reloaded.candidateRevisionId);
    const accepted = await suggest();
    const competing = await suggest();
    await decide(accepted.id, 'ACCEPT_SUGGESTION');
    expect(
      (
        await prisma.proposalReconciliationSuggestion.findUniqueOrThrow({
          where: { id: accepted.id },
        })
      ).status,
    ).toBe('ACCEPTED');
    expect(
      (
        await prisma.proposalReconciliationSuggestion.findUniqueOrThrow({
          where: { id: competing.id },
        })
      ).status,
    ).toBe('OUT_OF_DATE');
    await expect(decide(competing.id, 'ACCEPT_SUGGESTION')).rejects.toThrow();
    proposal = await prisma.proposal.findUniqueOrThrow({
      where: { id: proposal.id },
    });
    expect(proposal.status).toBe('DRAFT');
    expect(
      await prisma.proposalApprovalRecord.count({
        where: { proposalId: proposal.id },
      }),
    ).toBe(0);
    await prisma.db.$transaction(async (tx) => {
      await stageFutureRevision(tx, registry, proposal);
      await stageFutureRevision(tx, registry, proposal);
    });
    const future = await prisma.proposalFuture.findUniqueOrThrow({
      where: { id: futureId },
      include: { history: true },
    });
    expect(future.revision).toBe(2);
    expect(future.history).toHaveLength(2);
    expect(future.result).toMatchObject({ name: 'Accepted candidate' });
    expect((await content(task.id)).name).toBe('Live content');
  });
});
