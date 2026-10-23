import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { isEqual } from 'lodash';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { Prisma, Proposal } from '@prisma/client';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import type {
  CreateProposalDto,
  FutureRevisionMutation,
  FutureRevisionResponse,
  FutureRevisionBaseline,
  FutureRevisionContent,
  FutureCompletionEligibility,
  FutureCompletionDependency,
  FutureCompletionBlocker,
} from 'src/generated';
import { futureRevisionMutationSchema } from 'src/generated/future-revision.schema';
import { ORDINARY_PROPOSAL_VISIBILITY_WHERE } from './proposal-visibility';
import type { WorkItemTypeRegistryService } from '../tasks/work-item-type-registry.service';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile<FutureRevisionMutation>(
  futureRevisionMutationSchema,
);

export function parseFutureRevisionMutation(
  value: unknown,
): FutureRevisionMutation {
  if (!validate(value)) {
    throw new BadRequestException({
      message: 'Future revision violates the OpenAPI contract',
      errors: validate.errors,
    });
  }
  return value;
}

type FutureProposal = Pick<
  CreateProposalDto,
  'targetEntityId' | 'targetEntityType' | 'updates' | 'edges' | 'tracks'
>;

/** Serialize refinement admission/approval with explicit application of its future. */
export async function lockFutureForMutation(
  tx: AnyTransactionClient,
  mutation: FutureRevisionMutation,
  organizationId: string,
  projectId: string,
): Promise<void> {
  if (mutation.expectedRevision === 0) return;
  await tx.$queryRaw`SELECT id FROM proposal_futures WHERE id = ${mutation.futureId} AND organization_id = ${organizationId} AND project_id = ${projectId} FOR UPDATE`;
  const future = await (
    tx as Prisma.TransactionClient
  ).proposalFuture.findFirst({
    where: { id: mutation.futureId, organizationId, projectId },
    select: { outcome: true, revision: true },
  });
  if (
    !future ||
    future.outcome !== 'STAGED' ||
    future.revision !== mutation.expectedRevision
  ) {
    throw new ConflictException(
      'Future target, reviewed revision or outcome changed; submit a newly reviewed refinement.',
    );
  }
}

export async function validateFutureRevision(
  tx: AnyTransactionClient,
  registry: WorkItemTypeRegistryService,
  proposal: FutureProposal,
  organizationId: string,
  projectId: string,
  reservedEntities: ReadonlyArray<{
    entityId: string;
    entityType: string;
    workItemType?: string;
  }> = [],
): Promise<FutureRevisionMutation> {
  const db = tx as Prisma.TransactionClient;
  const mutation = parseFutureRevisionMutation(proposal.updates);
  await lockFutureForMutation(tx, mutation, organizationId, projectId);
  if (
    (proposal.targetEntityType !== 'TASK' &&
      proposal.targetEntityType !== 'DESIGN_DOC') ||
    proposal.edges?.length ||
    proposal.tracks
  ) {
    throw new BadRequestException(
      'Future revisions target TASK or DESIGN_DOC; completion links belong in dependencies, not live-target edges or tracks.',
    );
  }
  const existing = await db.proposalFuture.findFirst({
    where: { id: mutation.futureId, organizationId, projectId },
  });
  if (mutation.expectedRevision === 0) {
    if (existing)
      throw new ConflictException('Future identity already exists.');
  } else if (!existing) {
    throw new NotFoundException('Future not found in this project.');
  }
  if (
    existing &&
    (existing.targetEntityId !== proposal.targetEntityId ||
      existing.targetEntityType !== proposal.targetEntityType ||
      existing.outcome !== 'STAGED' ||
      existing.revision !== mutation.expectedRevision)
  ) {
    throw new ConflictException(
      'Future target, reviewed revision or outcome changed; submit a newly reviewed refinement.',
    );
  }
  if (mutation.operation === 'CANCEL') return mutation;

  for (const content of [mutation.baseline.content, mutation.result]) {
    if (
      content.id !== proposal.targetEntityId ||
      content.organizationId !== organizationId ||
      content.projectId !== projectId ||
      (proposal.targetEntityType === 'TASK'
        ? !('type' in content)
        : !('template' in content))
    ) {
      throw new BadRequestException(
        'Complete future content must match the proposal target and project.',
      );
    }
  }
  const unsupportedChanges: string[] = [];
  if (proposal.targetEntityType === 'TASK') {
    const persistedTarget = await db.task.findFirst({
      where: { id: proposal.targetEntityId, organizationId, projectId },
      select: { type: true },
    });
    const reserved = reservedEntities.find(
      (entity) =>
        entity.entityType === 'TASK' &&
        entity.entityId === proposal.targetEntityId,
    );
    const target =
      persistedTarget ??
      (reserved?.workItemType ? { type: reserved.workItemType } : null);
    if (!target) throw new NotFoundException('Future target not found.');
    if (
      !('type' in mutation.result) ||
      mutation.result.type !== target.type ||
      !('type' in mutation.baseline.content) ||
      mutation.baseline.content.type !== target.type
    ) {
      throw new BadRequestException(
        'Future revisions cannot change a work-item type.',
      );
    }
    if (mutation.result.status !== mutation.baseline.content.status) {
      unsupportedChanges.push('status');
    }
    if (
      !isEqual(
        mutation.result.config ?? null,
        mutation.baseline.content.config ?? null,
      )
    ) {
      unsupportedChanges.push('config');
    }
    if (mutation.result.source !== mutation.baseline.content.source) {
      unsupportedChanges.push('source');
    }
  } else {
    const target = await db.designDoc.findFirst({
      where: { id: proposal.targetEntityId, organizationId, projectId },
      select: { id: true },
    });
    if (
      !target &&
      !reservedEntities.some(
        (entity) =>
          entity.entityType === 'DESIGN_DOC' &&
          entity.entityId === proposal.targetEntityId,
      )
    )
      throw new NotFoundException('Future target not found.');
    if (mutation.result.status !== mutation.baseline.content.status) {
      unsupportedChanges.push('status');
    }
  }
  if (unsupportedChanges.length > 0) {
    throw new BadRequestException(
      `Future revisions cannot change ${unsupportedChanges.join(', ')}.`,
    );
  }
  if (mutation.baseline.kind === 'FUTURE') {
    if (
      !mutation.baseline.futureId ||
      mutation.baseline.futureId === mutation.futureId
    ) {
      throw new BadRequestException(
        'Select a distinct reviewed parent future.',
      );
    }
    const parent = await db.proposalFuture.findFirst({
      where: {
        id: mutation.baseline.futureId,
        organizationId,
        projectId,
        targetEntityId: proposal.targetEntityId,
        targetEntityType: proposal.targetEntityType,
      },
      include: { history: true },
    });
    const selected = parent?.history.find(
      (entry) => String(entry.revision) === mutation.baseline.revision,
    );
    const selectedMutation = selected?.mutation as unknown as
      | FutureRevisionMutation
      | undefined;
    if (
      selectedMutation?.operation !== 'REVISE' ||
      !isEqual(selectedMutation.result, mutation.baseline.content)
    ) {
      throw new BadRequestException(
        'Selected parent revision must contain the exact reviewed baseline.',
      );
    }
  } else if (mutation.baseline.futureId !== undefined) {
    throw new BadRequestException(
      'A LIVE baseline cannot name a parent future.',
    );
  }
  const dependencies = await db.task.findMany({
    where: {
      id: {
        in: mutation.dependencies.map(
          (dependency) => dependency.targetEntityId,
        ),
      },
      organizationId,
      projectId,
    },
    select: { id: true, type: true },
  });
  for (const dependency of mutation.dependencies) {
    const reserved = reservedEntities.find(
      (entity) =>
        entity.entityType === 'TASK' &&
        entity.entityId === dependency.targetEntityId,
    );
    const target =
      dependencies.find((task) => task.id === dependency.targetEntityId) ??
      (reserved?.workItemType
        ? { id: reserved.entityId, type: reserved.workItemType }
        : undefined);
    const definition =
      target && registry.getDefinition(projectId, target.type)?.definition;
    if (
      !target ||
      (target.type !== 'PLAN' && definition?.role !== 'work-item')
    ) {
      throw new BadRequestException(
        'Future dependencies must reference work-item-role targets or Plans in this project.',
      );
    }
  }
  return mutation;
}

/** Runs inside the ordinary approval transaction; never calls a live entity mutator. */
export async function stageFutureRevision(
  tx: AnyTransactionClient,
  registry: WorkItemTypeRegistryService,
  proposal: Proposal,
): Promise<void> {
  const db = tx as Prisma.TransactionClient;
  const replay = await db.proposalFutureRevision.findUnique({
    where: { proposalId: proposal.id },
  });
  if (replay) return;
  const mutation = await validateFutureRevision(
    tx,
    registry,
    {
      ...proposal,
      edges: proposal.edges as unknown as CreateProposalDto['edges'],
      updates: proposal.updates as CreateProposalDto['updates'],
    },
    proposal.organizationId,
    proposal.projectId,
  );
  const revision = mutation.expectedRevision + 1;
  const reviewedAt = new Date();
  if (mutation.operation === 'REVISE' && mutation.expectedRevision === 0) {
    await db.proposalFuture.create({
      data: {
        id: mutation.futureId,
        organizationId: proposal.organizationId,
        projectId: proposal.projectId,
        targetEntityId: proposal.targetEntityId,
        targetEntityType: proposal.targetEntityType,
        revision,
        outcome: 'STAGED',
        originatingProposalId: proposal.id,
        latestProposalId: proposal.id,
        baseline: mutation.baseline as unknown as Prisma.InputJsonValue,
        result: mutation.result as unknown as Prisma.InputJsonValue,
      },
    });
  } else {
    const changed = await db.proposalFuture.updateMany({
      where: {
        id: mutation.futureId,
        organizationId: proposal.organizationId,
        projectId: proposal.projectId,
        revision: mutation.expectedRevision,
        outcome: 'STAGED',
      },
      data: {
        revision,
        latestProposalId: proposal.id,
        ...(mutation.operation === 'CANCEL'
          ? { outcome: 'CANCELLED', cancelledAt: reviewedAt }
          : {
              baseline: mutation.baseline as unknown as Prisma.InputJsonValue,
              result: mutation.result as unknown as Prisma.InputJsonValue,
            }),
      },
    });
    if (changed.count !== 1)
      throw new ConflictException(
        'Future changed during review; submit a newly reviewed refinement.',
      );
  }
  await db.proposalFutureRevision.create({
    data: {
      futureId: mutation.futureId,
      revision,
      proposalId: proposal.id,
      reviewedAt,
      mutation: mutation as unknown as Prisma.InputJsonValue,
    },
  });
  if (mutation.operation === 'REVISE') {
    await db.proposalFutureDependency.deleteMany({
      where: { futureId: mutation.futureId },
    });
    await db.proposalFutureDependency.createMany({
      data: mutation.dependencies.map((dependency) => ({
        futureId: mutation.futureId,
        targetEntityId: dependency.targetEntityId,
      })),
    });
  }
}

export type FutureRevisionReference = {
  id: string;
  organizationId: string;
  projectId: string;
};

export function futureRevisionReferenceKey(
  reference: FutureRevisionReference,
): string {
  return JSON.stringify([
    reference.organizationId,
    reference.projectId,
    reference.id,
  ]);
}

/** Read a response-page's reviewed futures with one query per related projection. */
export async function readFutureRevisions(
  tx: AnyTransactionClient,
  registry: WorkItemTypeRegistryService,
  references: readonly FutureRevisionReference[],
): Promise<ReadonlyMap<string, FutureRevisionResponse>> {
  if (references.length === 0) return new Map();

  const uniqueReferences = new Map(
    references.map((reference) => [
      futureRevisionReferenceKey(reference),
      reference,
    ]),
  );
  const scopes = new Map<string, FutureRevisionReference[]>();
  for (const reference of uniqueReferences.values()) {
    const scopeKey = JSON.stringify([
      reference.organizationId,
      reference.projectId,
    ]);
    scopes.set(scopeKey, [...(scopes.get(scopeKey) ?? []), reference]);
  }

  const db = tx as Prisma.TransactionClient;
  const results = new Map<string, FutureRevisionResponse>();
  for (const scopedReferences of scopes.values()) {
    const first = scopedReferences[0];
    if (!first) continue;
    const { organizationId, projectId } = first;
    const futures = await db.proposalFuture.findMany({
      where: {
        organizationId,
        projectId,
        id: { in: scopedReferences.map((reference) => reference.id) },
      },
      include: {
        history: { orderBy: { revision: 'asc' } },
        dependencies: { orderBy: { targetEntityId: 'asc' } },
      },
    });
    if (futures.length === 0) continue;

    const futureIds = futures.map((future) => future.id);
    const dependenciesByTarget = new Map(
      futures.flatMap((future) =>
        future.dependencies.map(
          (dependency) =>
            [
              dependency.targetEntityId,
              {
                edgeType: 'DEPENDS_ON' as const,
                targetEntityType: 'TASK' as const,
                targetEntityId: dependency.targetEntityId,
              },
            ] as const,
        ),
      ),
    );
    const [outstandingRefinements, eligibility] = await Promise.all([
      db.proposal.findMany({
        where: {
          organizationId,
          projectId,
          action: 'VERSIONED_UPDATE',
          status: 'DRAFT',
          OR: futureIds.map((futureId) => ({
            updates: { path: ['futureId'], equals: futureId },
          })),
          ...ORDINARY_PROPOSAL_VISIBILITY_WHERE,
        },
        select: { id: true, updates: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      readFutureCompletionEligibility(tx, registry, organizationId, projectId, [
        ...dependenciesByTarget.values(),
      ]),
    ]);

    const futureIdsSet = new Set(futureIds);
    const refinementsByFutureId = new Map<string, string[]>();
    for (const proposal of outstandingRefinements) {
      const futureId = (proposal.updates as Record<string, unknown> | null)
        ?.futureId;
      if (typeof futureId !== 'string' || !futureIdsSet.has(futureId)) continue;
      refinementsByFutureId.set(futureId, [
        ...(refinementsByFutureId.get(futureId) ?? []),
        proposal.id,
      ]);
    }

    for (const future of futures) {
      const dependencies = future.dependencies.map((dependency) => ({
        edgeType: 'DEPENDS_ON' as const,
        targetEntityType: 'TASK' as const,
        targetEntityId: dependency.targetEntityId,
      }));
      const dependencyIds = new Set(
        dependencies.map((dependency) => dependency.targetEntityId),
      );
      const blockers = eligibility.blockers.filter((blocker) =>
        dependencyIds.has(blocker.dependency.targetEntityId),
      );
      const response = {
        id: future.id,
        organizationId,
        projectId,
        targetEntityType:
          future.targetEntityType as FutureRevisionResponse['targetEntityType'],
        targetEntityId: future.targetEntityId,
        revision: future.revision,
        outcome: future.outcome as FutureRevisionResponse['outcome'],
        completionEligibility: {
          eligible: blockers.length === 0,
          blockers,
        },
        originatingProposalId: future.originatingProposalId,
        latestProposalId: future.latestProposalId,
        outstandingRefinementProposalIds:
          refinementsByFutureId.get(future.id) ?? [],
        baseline: future.baseline as unknown as FutureRevisionBaseline,
        result: future.result as unknown as FutureRevisionContent,
        dependencies,
        history: future.history.map((entry) => ({
          revision: entry.revision,
          proposalId: entry.proposalId,
          reviewedAt: entry.reviewedAt.toISOString(),
          mutation: entry.mutation as unknown as FutureRevisionMutation,
        })),
        appliedAt: future.appliedAt?.toISOString() ?? null,
        appliedRevision: future.appliedRevision,
        cancelledAt: future.cancelledAt?.toISOString() ?? null,
      } satisfies FutureRevisionResponse;
      results.set(
        futureRevisionReferenceKey({
          id: future.id,
          organizationId,
          projectId,
        }),
        response,
      );
    }
  }
  return results;
}

export async function readFutureRevision(
  tx: AnyTransactionClient,
  registry: WorkItemTypeRegistryService,
  id: string,
  organizationId: string,
  projectId: string,
): Promise<FutureRevisionResponse> {
  const db = tx as Prisma.TransactionClient;
  const future = await db.proposalFuture.findFirst({
    where: { id, organizationId, projectId },
    include: {
      history: { orderBy: { revision: 'asc' } },
      dependencies: { orderBy: { targetEntityId: 'asc' } },
    },
  });
  if (!future) throw new NotFoundException('Future not found in this project.');
  const outstandingRefinements = await db.proposal.findMany({
    where: {
      organizationId,
      projectId,
      targetEntityId: future.targetEntityId,
      targetEntityType: future.targetEntityType,
      action: 'VERSIONED_UPDATE',
      status: 'DRAFT',
      updates: { path: ['futureId'], equals: future.id },
      ...ORDINARY_PROPOSAL_VISIBILITY_WHERE,
    },
    select: { id: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return {
    id: future.id,
    organizationId,
    projectId,
    targetEntityType:
      future.targetEntityType as FutureRevisionResponse['targetEntityType'],
    targetEntityId: future.targetEntityId,
    revision: future.revision,
    outcome: future.outcome as FutureRevisionResponse['outcome'],
    completionEligibility: await readFutureCompletionEligibility(
      tx,
      registry,
      organizationId,
      projectId,
      future.dependencies.map((dependency) => ({
        edgeType: 'DEPENDS_ON',
        targetEntityType: 'TASK',
        targetEntityId: dependency.targetEntityId,
      })),
    ),
    originatingProposalId: future.originatingProposalId,
    latestProposalId: future.latestProposalId,
    outstandingRefinementProposalIds: outstandingRefinements.map(
      (proposal) => proposal.id,
    ),
    baseline: future.baseline as unknown as FutureRevisionBaseline,
    result: future.result as unknown as FutureRevisionContent,
    dependencies: future.dependencies.map((dependency) => ({
      edgeType: 'DEPENDS_ON',
      targetEntityType: 'TASK',
      targetEntityId: dependency.targetEntityId,
    })),
    history: future.history.map((entry) => ({
      revision: entry.revision,
      proposalId: entry.proposalId,
      reviewedAt: entry.reviewedAt.toISOString(),
      mutation: entry.mutation as unknown as FutureRevisionMutation,
    })),
    appliedAt: future.appliedAt?.toISOString() ?? null,
    appliedRevision: future.appliedRevision,
    cancelledAt: future.cancelledAt?.toISOString() ?? null,
  } satisfies FutureRevisionResponse;
}

/** Read the owning work-item lifecycle; never infer completion from children. */
export async function readFutureCompletionEligibility(
  tx: AnyTransactionClient,
  registry: WorkItemTypeRegistryService,
  organizationId: string,
  projectId: string,
  dependencies: readonly FutureCompletionDependency[],
): Promise<FutureCompletionEligibility> {
  if (dependencies.length === 0) return { eligible: true, blockers: [] };
  const tasks = await (tx as Prisma.TransactionClient).task.findMany({
    where: {
      organizationId,
      projectId,
      id: { in: dependencies.map((dependency) => dependency.targetEntityId) },
    },
    select: { id: true, type: true, status: true, archivedAt: true },
  });
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const blockers: FutureCompletionBlocker[] = [];
  for (const dependency of dependencies) {
    const task = byId.get(dependency.targetEntityId);
    if (!task) {
      blockers.push({ dependency, reason: 'MISSING' });
      continue;
    }
    const definition = registry.getDefinition(projectId, task.type);
    let reason: FutureCompletionBlocker['reason'] | undefined;
    if (task.archivedAt || task.status === 'ARCHIVED') reason = 'ARCHIVED';
    else if (task.status === 'CANCELLED') reason = 'CANCELLED';
    else if (task.status === 'SUPERSEDED') reason = 'SUPERSEDED';
    else if (
      task.type !== 'PLAN' &&
      definition?.definition.role !== 'work-item'
    )
      reason = 'UNRESOLVABLE';
    // Plans keep explicit final acceptance; implementation work is ready once
    // it reaches verification so reviewed knowledge can land alongside it.
    else if (
      task.status !== 'COMPLETED' &&
      (task.type === 'PLAN' || task.status !== 'VERIFYING')
    )
      reason = 'INCOMPLETE';
    if (reason) blockers.push({ dependency, reason, status: task.status });
  }
  return { eligible: blockers.length === 0, blockers };
}
