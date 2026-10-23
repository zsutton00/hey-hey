import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type {
  Prisma,
  Proposal,
  ProposalReconciliationEffect,
  ProposalReconciliationRevision as StoredRevision,
} from '@prisma/client';
import { isEqual } from 'lodash';
import type {
  FutureRevisionBaseline,
  FutureRevisionContent,
  ProposalReconciliationBasis,
  ProposalReconciliationRevision,
  ProposalReconciliationState,
  UpdateTaskDto,
  UpdateDesignDocDto,
  WorkItemChangeSetValidationRequest,
} from 'src/generated';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import { mergeProposalContent } from './proposal-reconciliation-merge';
import { ProposalReconciliationAdapterService } from './proposal-reconciliation-adapter.service';
import {
  projectReconciliationContent,
  projectReconciliationChangeSet,
  reconciliationPatch,
  remapReconciliationIdentity,
} from './proposal-reconciliation-content';
import { AgentEdgeClientService } from '../agent-edge-client.service';
import { parseFutureRevisionMutation } from './future-revision';
import type { FutureRevisionMaterializerPorts } from './future-revision-materializer';
import {
  SERVICE_TOKEN_FACTORY,
  type ServiceTokenFactory,
} from './pending-edge.service';
import type { OrganizationId, ProjectId } from 'src/types';
import { isAxiosError } from 'axios';
import type { AgentEdge } from 'src/generated/graphs';

export type ReconciliationProvenance = {
  source: ProposalReconciliationRevision['source'];
  previousRevisionId: string | null;
  expectedBases: ProposalReconciliationBasis[];
};

export type ReconciliationGroupMember = {
  proposalId: string;
  reservedEntityId: string | null;
  sourceProposalId: string;
  provenance?: ReconciliationProvenance;
  identityMappings?: Record<string, string>;
};

/**
 * Owns immutable reconciliation records. Entity adapters supply canonical content;
 * callers retain their transaction through the guarded entity write.
 */
@Injectable()
export class ProposalReconciliationService {
  constructor(
    private readonly adapter: ProposalReconciliationAdapterService,
    private readonly edges: AgentEdgeClientService,
    @Inject(SERVICE_TOKEN_FACTORY)
    private readonly tokenFactory: ServiceTokenFactory,
  ) {}

  async currentBases(
    tx: AnyTransactionClient,
    proposal: Proposal,
    lock = false,
  ): Promise<ProposalReconciliationBasis[]> {
    const updates = proposal.updates as Prisma.JsonObject;
    if ('operations' in updates) {
      const request =
        proposal.updates as unknown as WorkItemChangeSetValidationRequest;
      const identities = new Map<string, 'TASK' | 'EDGE'>();
      for (const operation of request.operations) {
        const ref = 'ref' in operation ? operation.ref : operation.root;
        if (ref.refType !== 'existing') continue;
        identities.set(
          ref.id,
          operation.op.startsWith('relationship.') ? 'EDGE' : 'TASK',
        );
      }
      const bases: ProposalReconciliationBasis[] = [];
      for (const [id, type] of [...identities].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        bases.push(
          type === 'TASK'
            ? await this.taskBasis(tx, proposal, id, lock)
            : await this.edgeBasis(proposal, id),
        );
      }
      return bases;
    }
    if (proposal.action === 'CREATE') return [];
    if (proposal.targetEntityType === 'TASK') {
      return [
        await this.taskBasis(tx, proposal, proposal.targetEntityId, lock),
      ];
    }
    if (proposal.targetEntityType === 'DESIGN_DOC') {
      return [
        await this.adapter.designDoc(
          tx,
          proposal,
          proposal.targetEntityId,
          lock,
        ),
      ];
    }
    if (proposal.targetEntityType === 'WORK_ITEM_TYPE')
      return [await this.adapter.workItemType(tx, proposal, lock)];
    if (proposal.targetEntityType === 'ENTITY_PROMPT_TEMPLATE')
      return [await this.adapter.template(tx, proposal, lock)];
    return [];
  }

  async futureBaselineChanged(
    tx: AnyTransactionClient,
    target: {
      organizationId: string;
      projectId: string;
      targetEntityType: 'TASK' | 'DESIGN_DOC';
      targetEntityId: string;
    },
    baseline: FutureRevisionBaseline,
  ): Promise<boolean> {
    const current =
      target.targetEntityType === 'TASK'
        ? await this.adapter.task(tx, target, target.targetEntityId, false)
        : await this.adapter.designDoc(
            tx,
            target,
            target.targetEntityId,
            false,
          );
    return !isEqual(
      this.adapter.futureContentBasis(
        target.targetEntityType,
        baseline.content,
        target.projectId,
      ),
      this.adapter.currentFutureBasisContent(target.targetEntityType, current),
    );
  }

  currentFutureContent(target: {
    organizationId: string;
    projectId: string;
    targetEntityType: 'TASK' | 'DESIGN_DOC';
    targetEntityId: string;
  }): Promise<FutureRevisionContent> {
    return this.adapter.currentFutureContent(
      target.organizationId,
      target.projectId,
      target.targetEntityType,
      target.targetEntityId,
    );
  }

  futureMaterializationPorts(): FutureRevisionMaterializerPorts {
    return {
      readLiveContent: (target) => this.currentFutureContent(target),
      readLiveRevision: (tx, target) =>
        this.adapter.liveFutureRevision(
          tx,
          target.organizationId,
          target.projectId,
          target.targetEntityType,
          target.targetEntityId,
        ),
      renderTaskSections: (projectId, taskType, sections) =>
        this.adapter.renderFutureTaskSections(projectId, taskType, sections),
      renderRequirementOps: (tx, target, requirementOps, baselineMarkdown) =>
        this.adapter.renderFutureRequirements(
          tx,
          target.organizationId,
          requirementOps,
          baselineMarkdown,
        ),
    };
  }

  async stateForFuture(
    tx: AnyTransactionClient,
    proposal: Proposal,
    baseline: FutureRevisionBaseline,
  ): Promise<ProposalReconciliationState> {
    const state = await this.state(tx, proposal);
    if (
      proposal.targetEntityType !== 'TASK' &&
      proposal.targetEntityType !== 'DESIGN_DOC'
    )
      return state;
    if (!state.revisions.length) return state;
    const changed = await this.futureBaselineChanged(
      tx,
      {
        organizationId: proposal.organizationId,
        projectId: proposal.projectId,
        targetEntityType: proposal.targetEntityType,
        targetEntityId: proposal.targetEntityId,
      },
      baseline,
    );
    return {
      ...state,
      status: changed
        ? 'RECONCILIATION_REQUIRED'
        : state.revisions.at(-1)?.source === 'AUTHORING'
          ? 'CURRENT'
          : 'READY_FOR_REVIEW',
    };
  }

  assertFutureReviewedBasisCurrent(
    reviewed: readonly ProposalReconciliationBasis[],
    current: readonly ProposalReconciliationBasis[],
    targetEntityType: 'TASK' | 'DESIGN_DOC',
  ): void {
    const expected = reviewed[0];
    const actual = current[0];
    if (
      reviewed.length !== 1 ||
      current.length !== 1 ||
      !expected ||
      !actual ||
      expected.entityType !== targetEntityType ||
      actual.entityType !== targetEntityType ||
      expected.entityId !== actual.entityId ||
      !isEqual(
        this.adapter.currentFutureBasisContent(targetEntityType, expected),
        this.adapter.currentFutureBasisContent(targetEntityType, actual),
      )
    ) {
      throw new ConflictException(
        'Future target content changed after reconciliation review.',
      );
    }
  }

  private async taskBasis(
    tx: AnyTransactionClient,
    proposal: Proposal,
    id: string,
    lock: boolean,
  ): Promise<ProposalReconciliationBasis> {
    const membership = await tx.proposalGroupMember.findUnique({
      where: { proposalId: proposal.id },
      select: { groupId: true },
    });
    if (membership) {
      const creator = await tx.proposalGroupMember.findFirst({
        where: {
          groupId: membership.groupId,
          reservedTargetEntityId: id,
          proposal: { action: 'CREATE' },
        },
        include: { proposal: true },
      });
      if (
        creator &&
        creator.executionState !== 'APPLIED' &&
        creator.proposalId !== proposal.id
      ) {
        return {
          entityType: 'TASK',
          entityId: id,
          version: `reserved:${creator.proposalId}:${creator.proposal.createdAt.toISOString()}`,
          content: projectReconciliationContent(
            { sections: {}, sectionOrder: {} },
            creator.proposal.updates as object,
          ),
        };
      }
    }
    return this.adapter.task(tx, proposal, id, lock);
  }

  private async resolveReservedBases(
    tx: AnyTransactionClient,
    bases: ProposalReconciliationBasis[],
  ): Promise<ProposalReconciliationBasis[]> {
    return Promise.all(
      bases.map(async (basis) => {
        if (!basis.version.startsWith('reserved:')) return basis;
        const creatorId = basis.version.split(':')[1]!;
        const member = await tx.proposalGroupMember.findUnique({
          where: { proposalId: creatorId },
        });
        if (!member || member.executionState !== 'APPLIED') return basis;
        const intent = await tx.workItemChangeSetMaterialization.findUnique({
          where: { proposalId: creatorId },
        });
        if (intent) {
          const receipt = await tx.proposalReconciliationEffect.findUnique({
            where: {
              materializationId_entityType_entityId: {
                materializationId: intent.id,
                entityType: basis.entityType,
                entityId: basis.entityId,
              },
            },
          });
          if (receipt)
            return receipt.basis as unknown as ProposalReconciliationBasis;
        }
        const delivery = await tx.proposalReconciliationRevision.findFirst({
          where: { proposalId: creatorId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        const actual = (
          delivery?.bases as unknown as
            | ProposalReconciliationBasis[]
            | undefined
        )?.find((value) => value.entityId === basis.entityId);
        if (!actual)
          throw new ConflictException(
            'The prerequisite has no immutable delivery basis. Reconcile its dependent proposal.',
          );
        return actual;
      }),
    );
  }

  async recordCreatedDelivery(
    tx: AnyTransactionClient,
    proposal: Proposal,
  ): Promise<void> {
    if (proposal.action !== 'CREATE' || proposal.targetEntityType !== 'TASK')
      return;
    const basis = await this.adapter.task(
      tx,
      proposal,
      proposal.targetEntityId,
      true,
    );
    const original = await tx.proposalReconciliationRevision.findFirst({
      where: { proposalId: proposal.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    await this.appendRevision(tx, {
      proposalId: proposal.id,
      previousRevisionId: original?.id ?? null,
      source: 'AUTHORING',
      bases: [basis],
      proposedResult: basis.content,
      intent: proposal.eli5 ?? proposal.title,
    });
  }

  async edgeBasis(
    proposal: Pick<Proposal, 'organizationId' | 'projectId'>,
    id: string,
  ): Promise<ProposalReconciliationBasis> {
    const organizationId = proposal.organizationId as OrganizationId;
    const projectId = proposal.projectId as ProjectId;
    const edge = await this.edges
      .get(
        organizationId,
        projectId,
        id,
        this.tokenFactory(organizationId, projectId),
      )
      .catch((error) => {
        if (isAxiosError(error) && error.response?.status === 404) return null;
        throw error;
      });
    if (!edge)
      return {
        entityType: 'EDGE',
        entityId: id,
        version: 'absent',
        content: { deleted: true },
      };
    return this.edgeContent(edge);
  }

  private edgeContent(edge: AgentEdge): ProposalReconciliationBasis {
    return {
      entityType: 'EDGE',
      entityId: edge.id,
      version: edge.updatedAt,
      content: {
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        sourceEntityType: edge.sourceEntityType,
        targetEntityType: edge.targetEntityType,
        type: edge.type,
        category: edge.category ?? 'meta',
        direction: edge.direction ?? null,
        predicate: edge.predicate ?? null,
        reasoning: edge.reasoning,
        metadata: edge.metadata ?? null,
      },
    };
  }

  async recordEdgeEffect(
    tx: AnyTransactionClient,
    materializationId: string,
    operationIndex: number,
    edge: AgentEdge,
  ): Promise<void> {
    const identity = {
      materializationId,
      entityType: 'EDGE',
      entityId: edge.id,
    };
    const basis = this.edgeContent(edge) as unknown as Prisma.InputJsonValue;
    await tx.proposalReconciliationEffect.upsert({
      where: { materializationId_entityType_entityId: identity },
      create: { ...identity, basis, operationIndexes: [operationIndex] },
      update: { basis, operationIndexes: { push: operationIndex } },
    });
  }

  async captureAuthoring(
    tx: AnyTransactionClient,
    proposal: Proposal,
    provenance?: ReconciliationProvenance,
    identityMappings: Record<string, string> = {},
  ): Promise<void> {
    const current = await this.currentBases(tx, proposal, true);
    if (!current.length && proposal.action !== 'CREATE') return;
    if (provenance) {
      const identities = new Set(
        current.map((basis) => `${basis.entityType}:${basis.entityId}`),
      );
      const mappings = new Map(Object.entries(identityMappings));
      const expected = provenance.expectedBases.map((source) => {
        const basis = {
          ...source,
          entityId: mappings.get(source.entityId) ?? source.entityId,
          content: remapReconciliationIdentity(
            source.content,
            mappings,
          ) as Prisma.JsonObject,
        };
        const reserved = current.find(
          (value) =>
            value.entityId === basis.entityId &&
            value.entityType === basis.entityType,
        );
        if (
          source.version.startsWith('reserved:') &&
          reserved?.version.startsWith('reserved:') &&
          isEqual(basis.content, reserved.content)
        ) {
          basis.version = reserved.version;
        }
        return basis;
      });
      const currentExpected = expected.filter((basis) =>
        identities.has(`${basis.entityType}:${basis.entityId}`),
      );
      if (
        proposal.action === 'VERSIONED_UPDATE' &&
        (proposal.targetEntityType === 'TASK' ||
          proposal.targetEntityType === 'DESIGN_DOC')
      ) {
        this.assertFutureReviewedBasisCurrent(
          currentExpected,
          current,
          proposal.targetEntityType,
        );
      } else {
        this.assertReviewedBasisCurrent(currentExpected, current);
      }
    }
    const previous = await tx.proposalReconciliationRevision.findFirst({
      where: { proposalId: proposal.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const bases =
      previous && !provenance
        ? (previous.bases as unknown as ProposalReconciliationBasis[])
        : current;
    if (previous)
      await tx.proposalApprovalRecord.deleteMany({
        where: { proposalId: proposal.id },
      });
    await this.appendRevision(tx, {
      proposalId: proposal.id,
      previousRevisionId:
        provenance?.previousRevisionId ?? previous?.id ?? null,
      source:
        provenance?.source ??
        (previous?.source as
          | ProposalReconciliationRevision['source']
          | undefined) ??
        'AUTHORING',
      bases,
      proposedResult:
        proposal.action === 'VERSIONED_UPDATE'
          ? this.futureProposalResult(proposal)
          : bases[0] &&
              (proposal.targetEntityType === 'ENTITY_PROMPT_TEMPLATE' ||
                proposal.targetEntityType === 'WORK_ITEM_TYPE')
            ? await this.adapter.proposedOwnedContent(tx, proposal, bases[0])
            : proposal.action === 'DELETE'
              ? { deleted: true }
              : 'operations' in (proposal.updates as Prisma.JsonObject)
                ? projectReconciliationChangeSet(
                    bases,
                    proposal.updates as unknown as WorkItemChangeSetValidationRequest,
                  )
                : proposal.targetEntityType === 'TASK' &&
                    'requirementOps' in (proposal.updates as Prisma.JsonObject)
                  ? await this.adapter.proposedTask(tx, proposal, bases[0]!)
                  : projectReconciliationContent(
                      bases[0]?.content ?? { sections: {}, sectionOrder: {} },
                      proposal.updates as object,
                    ),
      intent: proposal.eli5 ?? proposal.title,
    });
  }

  private futureProposalResult(proposal: Proposal): Prisma.JsonObject {
    const mutation = parseFutureRevisionMutation(proposal.updates);
    return mutation.operation === 'REVISE'
      ? (mutation.result as unknown as Prisma.JsonObject)
      : { operation: mutation.operation };
  }

  async copyOriginalBasis(
    tx: AnyTransactionClient,
    proposal: Proposal,
    sourceProposalId: string,
    identityMappings: Record<string, string> = {},
  ): Promise<void> {
    const original: StoredRevision | null =
      await tx.proposalReconciliationRevision.findFirst({
        where: { proposalId: sourceProposalId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
    // A replacement group never refreshes an unchanged member's historical basis.
    if (!original) return;
    const identities = new Map(Object.entries(identityMappings));
    const intent = await tx.workItemChangeSetMaterialization.findUnique({
      where: { proposalId: sourceProposalId },
    });
    const receipts: ProposalReconciliationEffect[] = intent
      ? await tx.proposalReconciliationEffect.findMany({
          where: { materializationId: intent.id },
        })
      : [];
    const current = await this.currentBases(tx, proposal);
    const originalBases =
      original.bases as unknown as ProposalReconciliationBasis[];
    const deliveredBases = receipts
      .filter(
        (receipt) =>
          !originalBases.some(
            (basis) =>
              basis.entityId === receipt.entityId &&
              basis.entityType === receipt.entityType,
          ),
      )
      .map(
        (receipt) => receipt.basis as unknown as ProposalReconciliationBasis,
      );
    const bases = [...originalBases, ...deliveredBases]
      .map((originalBasis) => {
        const receipt = receipts.find(
          (value) =>
            value.entityId === originalBasis.entityId &&
            value.entityType === originalBasis.entityType,
        );
        const source = receipt
          ? (receipt.basis as unknown as ProposalReconciliationBasis)
          : originalBasis;
        const basis = {
          ...source,
          entityId: identities.get(source.entityId) ?? source.entityId,
          content: remapReconciliationIdentity(
            source.content,
            identities,
          ) as Prisma.JsonObject,
        };
        if (source.version.startsWith('reserved:')) {
          const reserved = current.find(
            (value) =>
              value.entityId === basis.entityId &&
              value.entityType === basis.entityType,
          );
          if (
            reserved?.version.startsWith('reserved:') &&
            isEqual(reserved.content, basis.content)
          )
            basis.version = reserved.version;
        }
        return basis;
      })
      .filter((basis) =>
        current.some(
          (value) =>
            value.entityId === basis.entityId &&
            value.entityType === basis.entityType,
        ),
      );
    await tx.proposalReconciliationRevision.create({
      data: {
        proposalId: proposal.id,
        previousRevisionId: original.id,
        source: 'AUTHORING',
        bases: bases as unknown as Prisma.InputJsonValue,
        proposedResult:
          'operations' in (proposal.updates as Prisma.JsonObject)
            ? (projectReconciliationChangeSet(
                bases,
                proposal.updates as unknown as WorkItemChangeSetValidationRequest,
              ) as Prisma.InputJsonValue)
            : (remapReconciliationIdentity(
                original.proposedResult,
                identities,
              ) as Prisma.InputJsonValue),
        intent: original.intent,
      },
    });
  }

  async state(
    tx: AnyTransactionClient,
    proposal: Proposal,
  ): Promise<ProposalReconciliationState> {
    const currentBases = await this.currentBases(tx, proposal);
    const materialization =
      await tx.workItemChangeSetMaterialization.findUnique({
        where: { proposalId: proposal.id },
      });
    const effects: ProposalReconciliationEffect[] = materialization
      ? await tx.proposalReconciliationEffect.findMany({
          where: { materializationId: materialization.id },
        })
      : [];
    if (materialization) {
      const mappings = materialization.relationshipIdMappings as Record<
        string,
        string
      >;
      const operations = (
        materialization.operationSet as unknown as WorkItemChangeSetValidationRequest
      ).operations;
      for (const operation of operations) {
        if (operation.op !== 'relationship.create') continue;
        const id = mappings[`temporary:${operation.ref.tempId}`];
        if (
          !id ||
          currentBases.some(
            (basis) => basis.entityType === 'EDGE' && basis.entityId === id,
          )
        )
          continue;
        const current = await this.edgeBasis(proposal, id);
        if (current.version !== 'absent') currentBases.push(current);
      }
    }
    for (const effect of effects) {
      if (
        currentBases.some(
          (basis) =>
            basis.entityType === effect.entityType &&
            basis.entityId === effect.entityId,
        )
      )
        continue;
      currentBases.push(
        effect.entityType === 'EDGE'
          ? await this.edgeBasis(proposal, effect.entityId)
          : await this.adapter.task(tx, proposal, effect.entityId, false),
      );
    }
    const rows: StoredRevision[] =
      await tx.proposalReconciliationRevision.findMany({
        where: { proposalId: proposal.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
    const latestOwn = rows.at(-1);
    let predecessor = rows[0]?.previousRevisionId;
    const seen = new Set(rows.map((row) => row.id));
    while (predecessor && !seen.has(predecessor)) {
      const row = await tx.proposalReconciliationRevision.findUnique({
        where: { id: predecessor },
      });
      if (!row) break;
      seen.add(row.id);
      rows.unshift(row);
      predecessor = row.previousRevisionId;
    }
    const revisions = rows.map((row) => ({
      id: row.id,
      proposalId: row.proposalId,
      source: row.source as ProposalReconciliationRevision['source'],
      previousRevisionId: row.previousRevisionId,
      bases: row.bases as unknown as ProposalReconciliationBasis[],
      proposedResult: row.proposedResult as Prisma.JsonObject,
      intent: row.intent,
      createdAt: row.createdAt.toISOString(),
    }));
    const latest = latestOwn
      ? revisions.find((revision) => revision.id === latestOwn.id)
      : undefined;
    const expectedBases = new Map(
      (latest?.bases ?? []).map((basis) => [
        `${basis.entityType}:${basis.entityId}`,
        basis,
      ]),
    );
    for (const effect of effects)
      expectedBases.set(
        `${effect.entityType}:${effect.entityId}`,
        effect.basis as unknown as ProposalReconciliationBasis,
      );
    let status: ProposalReconciliationState['status'] = 'NOT_APPLICABLE';
    if (currentBases.length) {
      status = !latest
        ? 'AGENT_FIX_REQUIRED'
        : this.basesMatch(
              await this.resolveReservedBases(tx, [...expectedBases.values()]),
              currentBases,
            )
          ? latest.source === 'AUTHORING'
            ? 'CURRENT'
            : 'READY_FOR_REVIEW'
          : 'RECONCILIATION_REQUIRED';
    }
    if (materialization?.status === 'PUBLISHED') status = 'NOT_APPLICABLE';
    let replacement = await tx.proposalReconciliationReplacement.findFirst({
      where: { proposalId: proposal.id },
      orderBy: { createdAt: 'desc' },
    });
    if (replacement?.replacementGroupId) {
      const group = await tx.proposalGroup.findUnique({
        where: { id: replacement.replacementGroupId },
      });
      if (!group || group.status === 'BUILDING') replacement = null;
    }
    return {
      status,
      currentBases,
      revisions,
      conflictingPaths: [],
      ...(latest ? { candidateRevisionId: latest.id } : {}),
      ...(replacement
        ? {
            replacementProposalId: replacement.replacementProposalId,
            ...(replacement.replacementGroupId
              ? { replacementGroupId: replacement.replacementGroupId }
              : {}),
          }
        : {}),
    };
  }

  prepareMerge(proposal: Proposal, state: ProposalReconciliationState) {
    const original = state.revisions.at(-1);
    if (!original || !state.currentBases[0] || proposal.action === 'DELETE') {
      return { kind: 'AGENT_FIX_REQUIRED', conflictingPaths: [''] } as const;
    }
    const patch = proposal.updates as UpdateTaskDto | UpdateDesignDocDto;
    // Ordered requirement operations carry semantic intent, not replacement content.
    if (
      'requirementOps' in patch ||
      'operations' in patch ||
      proposal.targetEntityType === 'ENTITY_PROMPT_TEMPLATE' ||
      proposal.targetEntityType === 'WORK_ITEM_TYPE'
    ) {
      return { kind: 'AGENT_FIX_REQUIRED', conflictingPaths: [''] } as const;
    }
    const textPaths = new Set<string>();
    const sections = (state.currentBases[0].content.sections ??
      {}) as Prisma.JsonObject;
    for (const [key, value] of Object.entries(sections)) {
      if (typeof value === 'string')
        textPaths.add(
          `/sections/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`,
        );
    }
    const result = this.merge(
      original.bases[0]!,
      state.currentBases[0],
      original.proposedResult,
      textPaths,
    );
    if (result.kind !== 'MERGED') return result;
    return {
      kind: 'MERGED',
      updates: reconciliationPatch(
        patch,
        state.currentBases[0].content,
        result.candidate as Prisma.JsonObject,
      ),
    } as const;
  }

  async assertApplicable(
    tx: AnyTransactionClient,
    proposal: Proposal,
    reviewedRevisionId?: string,
    requireRevisionReview = false,
  ): Promise<void> {
    const replacement = await tx.proposalReconciliationReplacement.findFirst({
      where: { proposalId: proposal.id },
      orderBy: { createdAt: 'desc' },
    });
    if (replacement) {
      const group = replacement.replacementGroupId
        ? await tx.proposalGroup.findUnique({
            where: { id: replacement.replacementGroupId },
          })
        : null;
      if (
        !replacement.replacementGroupId ||
        (group && group.status !== 'BUILDING')
      ) {
        throw new ConflictException(
          'This proposal has a reconciled replacement. Review and apply the replacement.',
        );
      }
    }
    const current = await this.currentBases(tx, proposal, true);
    if (!current.length) return;
    const revision = await tx.proposalReconciliationRevision.findFirst({
      where: { proposalId: proposal.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!revision) {
      throw new ConflictException(
        'Original proposal content is unavailable. Agent fix and fresh review are required.',
      );
    }
    if (
      reviewedRevisionId !== undefined &&
      reviewedRevisionId !== revision.id
    ) {
      throw new ConflictException(
        'The displayed proposal revision has changed. Review the complete current candidate.',
      );
    }
    if (
      requireRevisionReview &&
      revision.source !== 'AUTHORING' &&
      reviewedRevisionId !== revision.id
    ) {
      throw new ConflictException(
        'Approval must identify the reconciled revision displayed for review.',
      );
    }
    this.assertReviewedBasisCurrent(
      await this.resolveReservedBases(
        tx,
        revision.bases as unknown as ProposalReconciliationBasis[],
      ),
      current,
    );
  }

  /** The entity write and its receipt share one transaction and the same owner lock. */
  async guardTaskEffect<T>(
    tx: AnyTransactionClient,
    proposal: Proposal,
    materializationId: string,
    taskId: string,
    operationIndex: number,
    createsTarget: boolean,
    write: () => Promise<T>,
  ): Promise<T | undefined> {
    const identity = {
      materializationId,
      entityType: 'TASK',
      entityId: taskId,
    };
    const receipt = await tx.proposalReconciliationEffect.findUnique({
      where: { materializationId_entityType_entityId: identity },
    });
    if (!createsTarget || receipt) {
      const current = await this.adapter.task(tx, proposal, taskId, true);
      const revision = await tx.proposalReconciliationRevision.findFirst({
        where: { proposalId: proposal.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const expected = receipt
        ? (receipt.basis as unknown as ProposalReconciliationBasis)
        : (
            revision?.bases as unknown as
              | ProposalReconciliationBasis[]
              | undefined
          )?.find(
            (basis) => basis.entityType === 'TASK' && basis.entityId === taskId,
          );
      if (!expected)
        throw new ConflictException(
          'Original target content is unavailable. Reconciliation is required.',
        );
      this.assertReviewedBasisCurrent(
        await this.resolveReservedBases(tx, [expected]),
        [current],
      );
      if (receipt?.operationIndexes.includes(operationIndex)) return undefined;
    }
    const result = await write();
    const basis = await this.adapter.task(tx, proposal, taskId, true);
    await tx.proposalReconciliationEffect.upsert({
      where: { materializationId_entityType_entityId: identity },
      create: {
        ...identity,
        basis: basis as unknown as Prisma.InputJsonValue,
        operationIndexes: [operationIndex],
      },
      update: {
        basis: basis as unknown as Prisma.InputJsonValue,
        operationIndexes: { push: operationIndex },
      },
    });
    return result;
  }

  async reviewedEdgeBasis(
    tx: AnyTransactionClient,
    proposal: Proposal,
    materializationId: string,
    edgeId: string,
    verifyDeletionReceipt = false,
  ): Promise<ProposalReconciliationBasis> {
    const receipt = await tx.proposalReconciliationEffect.findUnique({
      where: {
        materializationId_entityType_entityId: {
          materializationId,
          entityType: 'EDGE',
          entityId: edgeId,
        },
      },
    });
    const revision = await tx.proposalReconciliationRevision.findFirst({
      where: { proposalId: proposal.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const expected = receipt
      ? (receipt.basis as unknown as ProposalReconciliationBasis)
      : (
          revision?.bases as unknown as
            | ProposalReconciliationBasis[]
            | undefined
        )?.find(
          (basis) => basis.entityType === 'EDGE' && basis.entityId === edgeId,
        );
    if (!expected)
      throw new ConflictException(
        'Original relationship content is unavailable. Reconciliation is required.',
      );
    const current = await this.edgeBasis(proposal, edgeId);
    // The Graph provider proves an already-completed conditional deletion by its
    // durable deletion receipt; absence alone is never proof of our operation.
    if (!(verifyDeletionReceipt && current.version === 'absent'))
      this.assertReviewedBasisCurrent([expected], [current]);
    return expected;
  }

  async publishTaskEffects(
    tx: AnyTransactionClient,
    proposal: Proposal,
    materializationId: string,
    writeMarker: () => Promise<void>,
  ): Promise<void> {
    const receipts = await tx.proposalReconciliationEffect.findMany({
      where: { materializationId, entityType: 'TASK' },
      orderBy: { entityId: 'asc' },
    });
    for (const receipt of receipts) {
      this.assertReviewedBasisCurrent(
        [receipt.basis as unknown as ProposalReconciliationBasis],
        [await this.adapter.task(tx, proposal, receipt.entityId, true)],
      );
    }
    await writeMarker();
    for (const receipt of receipts) {
      const basis = await this.adapter.task(
        tx,
        proposal,
        receipt.entityId,
        true,
      );
      await tx.proposalReconciliationEffect.update({
        where: {
          materializationId_entityType_entityId: {
            materializationId,
            entityType: 'TASK',
            entityId: receipt.entityId,
          },
        },
        data: { basis: basis as unknown as Prisma.InputJsonValue },
      });
    }
  }

  async appendRevision(
    tx: AnyTransactionClient,
    revision: Omit<ProposalReconciliationRevision, 'id' | 'createdAt'>,
  ): Promise<string> {
    const created = await tx.proposalReconciliationRevision.create({
      data: {
        proposalId: revision.proposalId,
        previousRevisionId: revision.previousRevisionId,
        source: revision.source,
        bases: revision.bases.map((basis) => ({
          entityType: basis.entityType,
          entityId: basis.entityId,
          version: basis.version,
          content: basis.content,
        })),
        proposedResult: revision.proposedResult as Prisma.InputJsonValue,
        intent: revision.intent,
      },
      select: { id: true },
    });
    return created.id;
  }

  /** Missing original content is never synthesized from today's entity. */
  merge(
    original: ProposalReconciliationBasis | null,
    current: ProposalReconciliationBasis,
    proposedResult: Prisma.JsonObject,
    textPaths: ReadonlySet<string> = new Set(),
  ) {
    if (!original) {
      return { kind: 'AGENT_FIX_REQUIRED', conflictingPaths: [''] } as const;
    }
    if (
      original.entityId !== current.entityId ||
      original.entityType !== current.entityType
    ) {
      throw new ConflictException(
        'Reconciliation bases target different entities.',
      );
    }
    return mergeProposalContent(
      original.content,
      current.content,
      proposedResult,
      textPaths,
    );
  }

  /** Call after acquiring the owning adapters' write guards, in the write transaction. */
  assertReviewedBasisCurrent(
    reviewed: readonly ProposalReconciliationBasis[],
    current: readonly ProposalReconciliationBasis[],
  ): void {
    if (!this.basesMatch(reviewed, current)) {
      throw new ConflictException(
        'Proposal content changed after review. Reconciliation is required.',
      );
    }
  }

  private basesMatch(
    reviewed: readonly ProposalReconciliationBasis[],
    current: readonly ProposalReconciliationBasis[],
  ): boolean {
    const currentByIdentity = new Map(
      current.map((basis) => [`${basis.entityType}:${basis.entityId}`, basis]),
    );
    return (
      reviewed.length === current.length &&
      reviewed.every((basis) => {
        const actual = currentByIdentity.get(
          `${basis.entityType}:${basis.entityId}`,
        );
        return (
          actual !== undefined &&
          basis.version === actual.version &&
          isEqual(basis.content, actual.content)
        );
      })
    );
  }
}
