import { ProposalReconciliationSuggestion } from 'src/generated';
import { ProposalReconciliationCandidatePipe } from '../../pipes/proposal-reconciliation-candidate.pipe';
import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import type {
  Prisma,
  Proposal,
  ProposalReconciliationEffect,
  ProposalReconciliationRevision as StoredRevision,
} from '@prisma/client';
import { isEqual, isPlainObject } from 'lodash';
import type {
  FutureRevisionBaseline,
  FutureRevisionContent,
  ProposalReconciliationBasis,
  ProposalReconciliationIntervening,
  ProposalReconciliationOverlap,
  ProposalReconciliationRevision,
  ProposalReconciliationState,
  UpdateTaskDto,
  UpdateDesignDocDto,
  WorkItemChangeSetValidationRequest,
} from 'src/generated';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import {
  fieldPathToPointer,
  mergeProposalContent,
  pointerToFieldPath,
  proposalChangedPaths,
  valueAtPointer,
} from './proposal-reconciliation-merge';
import { ProposalReconciliationAdapterService } from './proposal-reconciliation-adapter.service';
import {
  projectReconciliationContent,
  projectReconciliationChangeSet,
  reconciliationPatch,
  remapReconciliationIdentity,
} from './proposal-reconciliation-content';
import { AgentEdgeClientService } from '../agent-edge-client.service';
import {
  futureGraph,
  graphContentBasis,
  type FutureGraphApplication,
} from './future-graph';
import { parseFutureRevisionMutation } from './future-revision';
import type { FutureRevisionMaterializerPorts } from './future-revision-materializer';
import {
  SERVICE_TOKEN_FACTORY,
  type ServiceTokenFactory,
} from './pending-edge.service';
import type { OrganizationId, ProjectId } from 'src/types';
import { isAxiosError } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import type { AgentEdge } from 'src/generated/graphs';

export type ReconciliationProvenance = {
  source: ProposalReconciliationRevision['source'];
  preserveVotes?: boolean;
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

type InterveningRow = {
  id: string;
  title: string | null;
  updates: Prisma.JsonValue;
  updatedAt: Date;
  approvalRecords: { createdAt: Date; user: { id: string; name: string } }[];
  reconciliationRevisions: {
    bases: Prisma.JsonValue;
    proposedResult: Prisma.JsonValue;
  }[];
};

/**
 * Owns immutable reconciliation records. Entity adapters supply canonical content;
 * callers retain their transaction through the guarded entity write.
 */
@Injectable()
export class ProposalReconciliationService {
  private readonly logger = new Logger(ProposalReconciliationService.name);

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
      const basis = await this.taskBasis(
        tx,
        proposal,
        proposal.targetEntityId,
        lock,
      );
      if (proposal.action === 'VERSIONED_UPDATE') {
        const mutation = parseFutureRevisionMutation(proposal.updates);
        if (mutation.operation === 'REVISE' && futureGraph(mutation.result)) {
          const graph = await this.adapter.readFutureGraph(
            proposal.organizationId,
            proposal.projectId,
            proposal.targetEntityId,
            tx,
          );
          basis.content.graph = graphContentBasis(
            graph,
          ) as unknown as Prisma.JsonObject;
        }
      }
      return [basis];
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
    /**
     * Live content already equal to the reviewed result is the future's own
     * (possibly partly published) application, not newer content to reconcile.
     */
    reviewedResult?: FutureRevisionContent,
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
    const currentGraph =
      futureGraph(baseline.content) ||
      (reviewedResult && futureGraph(reviewedResult))
        ? await this.adapter.readFutureGraph(
            target.organizationId,
            target.projectId,
            target.targetEntityId,
            tx,
          )
        : undefined;
    const matches = (content: FutureRevisionContent) => {
      const graph = futureGraph(content);
      if (
        graph &&
        currentGraph &&
        !isEqual(graphContentBasis(graph), graphContentBasis(currentGraph))
      )
        return false;
      return isEqual(
        reviewedTargetContent(
          this.adapter.futureContentBasis(
            target.targetEntityType,
            content,
            target.projectId,
          ),
        ),
        reviewedTargetContent(
          this.adapter.currentFutureBasisContent(
            target.targetEntityType,
            current,
          ),
        ),
      );
    };
    return (
      !matches(baseline.content) &&
      !(reviewedResult !== undefined && matches(reviewedResult))
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
      projectGraph: (target, basis, request) =>
        this.adapter.projectFutureGraph(
          target.organizationId,
          target.projectId,
          basis,
          request,
        ),
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
    if (
      proposal.targetEntityType !== 'TASK' &&
      proposal.targetEntityType !== 'DESIGN_DOC'
    )
      return this.state(tx, proposal);
    if (
      proposal.status === 'REJECTED' ||
      (proposal.status === 'APPROVED' &&
        !(await this.isUnappliedFuture(tx, proposal)))
    ) {
      const state = await this.state(tx, proposal);
      const rows: StoredRevision[] =
        await tx.proposalReconciliationRevision.findMany({
          where: { proposalId: proposal.id },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
      // Retain inspectable suggestion evidence after Apply without restoring eligibility.
      return this.withSuggestions(tx, proposal, {
        ...state,
        revisions: rows.map((row) => ({
          id: row.id,
          proposalId: row.proposalId,
          source: row.source as ProposalReconciliationRevision['source'],
          previousRevisionId: row.previousRevisionId,
          bases: row.bases as unknown as ProposalReconciliationBasis[],
          proposedResult: row.proposedResult as Prisma.JsonObject,
          intent: row.intent,
          createdAt: row.createdAt.toISOString(),
        })),
      });
    }
    const mutation = parseFutureRevisionMutation(proposal.updates);
    const future = await tx.proposalFuture.findFirst({
      where: {
        id: mutation.futureId,
        organizationId: proposal.organizationId,
        projectId: proposal.projectId,
      },
    });
    const changed = await this.futureBaselineChanged(
      tx,
      {
        organizationId: proposal.organizationId,
        projectId: proposal.projectId,
        targetEntityType: proposal.targetEntityType,
        targetEntityId: proposal.targetEntityId,
      },
      baseline,
      'result' in mutation ? mutation.result : undefined,
    );
    const state = await this.state(tx, proposal, changed);
    if (!state.revisions.length || state.status === 'NOT_APPLICABLE')
      return state;
    let currentBases = state.currentBases;
    if (changed) {
      // Section identities are response metadata, outside the semantic basis check.
      // Manual recovery must retain actual live identities when carrying new sections forward.
      const live = await this.currentFutureContent({
        organizationId: proposal.organizationId,
        projectId: proposal.projectId,
        targetEntityType: proposal.targetEntityType,
        targetEntityId: proposal.targetEntityId,
      });
      currentBases = state.currentBases.map((basis) => ({
        ...basis,
        content: {
          ...basis.content,
          ...('type' in live ? { source: live.source } : {}),
          materializedSections: live.sections as unknown as Prisma.JsonArray,
        },
      }));
    }
    const {
      replacementProposalId: _legacyProposal,
      replacementGroupId: _legacyGroup,
      ...currentState
    } = state;
    return this.withSuggestions(tx, proposal, {
      ...currentState,
      currentBases,
      futureRevision: future?.revision ?? 0,
      status: changed
        ? 'RECONCILIATION_REQUIRED'
        : state.revisions.at(-1)?.source === 'AUTHORING'
          ? 'CURRENT'
          : 'READY_FOR_REVIEW',
    });
  }

  private async withSuggestions(
    tx: AnyTransactionClient,
    proposal: Proposal,
    state: ProposalReconciliationState,
  ): Promise<ProposalReconciliationState> {
    const suggestions: import('@prisma/client').ProposalReconciliationSuggestion[] =
      await tx.proposalReconciliationSuggestion.findMany({
        where: { proposalId: proposal.id },
        orderBy: { createdAt: 'asc' },
      });
    return {
      ...state,
      suggestions: suggestions.map((suggestion) => {
        const request = new ProposalReconciliationCandidatePipe().transform(
          suggestion.request,
        );
        if (request.method !== 'AGENT_FIX')
          throw new ConflictException(
            'Stored suggestion violates its authoring contract.',
          );
        const statuses = Object.values(
          ProposalReconciliationSuggestion.StatusEnum,
        );
        const status = statuses.find((value) => value === suggestion.status);
        if (!status)
          throw new ConflictException(
            'Stored suggestion has an invalid status.',
          );
        return {
          id: suggestion.id,
          proposalId: proposal.id,
          organizationId: proposal.organizationId,
          projectId: proposal.projectId,
          status:
            status === 'PENDING' &&
            suggestion.candidateRevisionId !== state.candidateRevisionId
              ? ('OUT_OF_DATE' as const)
              : status,
          candidateRevisionId: suggestion.candidateRevisionId,
          proposedResult: request.proposedResult,
          ...(suggestion.messageId ? { messageId: suggestion.messageId } : {}),
          ...(suggestion.legacyProposalId
            ? { legacyProposalId: suggestion.legacyProposalId }
            : {}),
          createdAt: suggestion.createdAt.toISOString(),
        };
      }),
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
      !isEqual(expected.content.graph ?? null, actual.content.graph ?? null) ||
      !isEqual(
        reviewedTargetContent(
          this.adapter.currentFutureBasisContent(targetEntityType, expected),
        ),
        reviewedTargetContent(
          this.adapter.currentFutureBasisContent(targetEntityType, actual),
        ),
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
        this.assertReviewedBasisCurrent(currentExpected, current, proposal.id);
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
    if (previous && !provenance?.preserveVotes)
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

  private async isUnappliedFuture(
    tx: AnyTransactionClient,
    proposal: Proposal,
  ): Promise<boolean> {
    if (proposal.action !== 'VERSIONED_UPDATE') return false;
    const mutation = parseFutureRevisionMutation(proposal.updates);
    if (mutation.operation !== 'REVISE') return false;
    const future = await tx.proposalFuture.findFirst({
      where: {
        id: mutation.futureId,
        organizationId: proposal.organizationId,
        projectId: proposal.projectId,
      },
    });
    return future?.outcome === 'STAGED';
  }

  async state(
    tx: AnyTransactionClient,
    proposal: Proposal,
    baselineChanged = false,
  ): Promise<ProposalReconciliationState> {
    // A decided proposal has nothing left to reconcile or review.
    if (
      proposal.status === 'REJECTED' ||
      (proposal.status === 'APPROVED' &&
        !(await this.isUnappliedFuture(tx, proposal)))
    ) {
      return {
        status: 'NOT_APPLICABLE',
        currentBases: [],
        revisions: [],
        conflictingPaths: [],
        interveningProposals: [],
        overlaps: [],
      };
    }
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
    if (baselineChanged && currentBases.length)
      status = 'RECONCILIATION_REQUIRED';
    if (materialization?.status === 'PUBLISHED') status = 'NOT_APPLICABLE';
    let replacement =
      proposal.action === 'VERSIONED_UPDATE' ||
      (await tx.proposalGroupMember.findUnique({
        where: { proposalId: proposal.id },
      }))
        ? await tx.proposalReconciliationReplacement.findFirst({
            where: { proposalId: proposal.id },
            orderBy: { createdAt: 'desc' },
          })
        : null;
    if (replacement && proposal.action === 'VERSIONED_UPDATE') {
      const candidate = await tx.proposal.findUnique({
        where: { id: replacement.replacementProposalId },
      });
      if (!candidate || candidate.status !== 'DRAFT') replacement = null;
    }
    if (replacement?.replacementGroupId) {
      const group = await tx.proposalGroup.findUnique({
        where: { id: replacement.replacementGroupId },
      });
      if (!group || group.status === 'BUILDING') replacement = null;
    }
    const outOfDate =
      status === 'RECONCILIATION_REQUIRED' ||
      status === 'AGENT_FIX_REQUIRED' ||
      status === 'READY_FOR_REVIEW';
    const origin = outOfDate
      ? await this.originProposal(tx, proposal, rows[0]?.proposalId)
      : proposal;
    const intervening = outOfDate
      ? await this.interveningProposals(tx, proposal, origin)
      : [];
    const overlaps =
      status === 'RECONCILIATION_REQUIRED' && !replacement
        ? this.overlaps(
            this.prepareMerge(proposal, {
              status,
              currentBases,
              revisions,
              conflictingPaths: [],
              interveningProposals: [],
              overlaps: [],
            }),
            proposal.action === 'VERSIONED_UPDATE' &&
              (proposal.targetEntityType === 'TASK' ||
                proposal.targetEntityType === 'DESIGN_DOC')
              ? this.adapter.futureContentBasis(
                  proposal.targetEntityType,
                  this.futureRevisionResult(proposal),
                  proposal.projectId,
                )
              : latest?.proposedResult,
            currentBases[0]?.content,
            intervening,
          )
        : [];
    for (const entry of intervening)
      entry.overlappingPaths = overlaps
        .filter((overlap) => overlap.interveningProposalId === entry.proposalId)
        .map((overlap) => overlap.path);
    return {
      status,
      currentBases,
      revisions,
      conflictingPaths: overlaps.map((overlap) => overlap.path),
      ...(outOfDate ? { writtenAt: origin.createdAt.toISOString() } : {}),
      interveningProposals: intervening,
      overlaps,
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

  /** A merged replacement is reviewed against when the proposal it reconciles was written. */
  private async originProposal(
    tx: AnyTransactionClient,
    proposal: Proposal,
    originId: string | undefined,
  ): Promise<Proposal> {
    if (!originId || originId === proposal.id) return proposal;
    return (
      (await tx.proposal.findUnique({ where: { id: originId } })) ?? proposal
    );
  }

  private async interveningProposals(
    tx: AnyTransactionClient,
    proposal: Proposal,
    origin: Proposal,
  ): Promise<ProposalReconciliationIntervening[]> {
    const approved = await tx.proposal.findMany({
      where: {
        organizationId: proposal.organizationId,
        projectId: proposal.projectId,
        targetEntityId: proposal.targetEntityId,
        status: 'APPROVED',
        id: { notIn: [proposal.id, origin.id] },
        updatedAt: { gt: origin.createdAt },
      },
      select: {
        id: true,
        title: true,
        updates: true,
        updatedAt: true,
        approvalRecords: {
          where: { type: 'APPROVAL' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            createdAt: true,
            user: { select: { id: true, name: true } },
          },
        },
        reconciliationRevisions: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { bases: true, proposedResult: true },
        },
      },
    });
    return (approved as InterveningRow[])
      .map((row) => {
        const approval = row.approvalRecords[0];
        const changedPaths = proposalChangedPaths(row.updates);
        const revision = row.reconciliationRevisions[0];
        const before = (
          revision?.bases as unknown as
            | ProposalReconciliationBasis[]
            | undefined
        )?.[0]?.content;
        return {
          proposalId: row.id,
          title: row.title ?? 'Untitled proposal',
          approvedById: approval?.user.id ?? null,
          approvedByName: approval?.user.name ?? null,
          approvedAt: (approval?.createdAt ?? row.updatedAt).toISOString(),
          changedPaths,
          overlappingPaths: [] as string[],
          changes: revision
            ? changedPaths.flatMap((path) => {
                const pointer = fieldPathToPointer(path);
                const was = valueAtPointer(before, pointer) ?? null;
                const now =
                  valueAtPointer(revision.proposedResult, pointer) ?? null;
                return isEqual(was, now)
                  ? []
                  : [{ path, before: was, after: now }];
              })
            : [],
        };
      })
      .filter((entry) => entry.approvedAt > origin.createdAt.toISOString())
      .sort((a, b) => a.approvedAt.localeCompare(b.approvedAt));
  }

  /** Fields the merge could not combine, attributed to the latest intervening change to them. */
  private overlaps(
    merge: ReturnType<ProposalReconciliationService['prepareMerge']>,
    proposedResult: Prisma.JsonValue | undefined,
    current: Prisma.JsonValue | undefined,
    intervening: readonly ProposalReconciliationIntervening[],
  ): ProposalReconciliationOverlap[] {
    if (merge.kind !== 'AGENT_FIX_REQUIRED') return [];
    return merge.conflictingPaths
      .filter((pointer) => pointer !== '')
      .map((pointer) => {
        const path = pointerToFieldPath(pointer);
        const owner = intervening.findLast((entry) =>
          entry.changedPaths.some(
            (changed) =>
              changed === path ||
              path.startsWith(`${changed}.`) ||
              changed.startsWith(`${path}.`),
          ),
        );
        return {
          path,
          proposedValue: valueAtPointer(proposedResult, pointer) ?? null,
          currentValue: valueAtPointer(current, pointer) ?? null,
          interveningProposalId: owner?.proposalId ?? null,
        };
      });
  }

  private futureRevisionResult(proposal: Proposal): FutureRevisionContent {
    const mutation = parseFutureRevisionMutation(proposal.updates);
    if (mutation.operation !== 'REVISE')
      throw new ConflictException('Cancelled futures have no proposed result.');
    return mutation.result;
  }

  prepareMerge(proposal: Proposal, state: ProposalReconciliationState) {
    const original = state.revisions.at(-1);
    if (!original || !state.currentBases[0] || proposal.action === 'DELETE') {
      return { kind: 'AGENT_FIX_REQUIRED', conflictingPaths: [''] } as const;
    }
    if (
      proposal.action === 'VERSIONED_UPDATE' &&
      (proposal.targetEntityType === 'TASK' ||
        proposal.targetEntityType === 'DESIGN_DOC')
    ) {
      const mutation = parseFutureRevisionMutation(proposal.updates);
      if (mutation.operation !== 'REVISE')
        return { kind: 'AGENT_FIX_REQUIRED', conflictingPaths: [''] } as const;
      const before = this.adapter.futureContentBasis(
        proposal.targetEntityType,
        mutation.baseline.content,
        proposal.projectId,
      );
      const after = this.adapter.futureContentBasis(
        proposal.targetEntityType,
        mutation.result,
        proposal.projectId,
      );
      const textPaths = new Set(
        Object.keys(before.sections as Prisma.JsonObject).map(
          (key) => `/sections/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`,
        ),
      );
      const result = mergeProposalContent(
        before,
        this.adapter.currentFutureBasisContent(
          proposal.targetEntityType,
          state.currentBases[0],
        ),
        after,
        textPaths,
      );
      return result.kind === 'MERGED'
        ? ({ kind: 'AGENT_FIX_REQUIRED', conflictingPaths: [] } as const)
        : result;
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
    const replacement = (await tx.proposalGroupMember.findUnique({
      where: { proposalId: proposal.id },
    }))
      ? await tx.proposalReconciliationReplacement.findFirst({
          where: { proposalId: proposal.id },
          orderBy: { createdAt: 'desc' },
        })
      : null;
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
      proposal.id,
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
    if (receipt?.operationIndexes.includes(operationIndex)) return undefined;
    if (!createsTarget || receipt) {
      const current = await this.adapter.task(tx, proposal, taskId, true);
      const revision = await tx.proposalReconciliationRevision.findFirst({
        where: { proposalId: proposal.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const appliedBasis = await this.futureApplicationBasis(
        tx,
        proposal,
        materializationId,
        'TASK',
        taskId,
      );
      const expected = receipt
        ? (receipt.basis as unknown as ProposalReconciliationBasis)
        : (appliedBasis ??
          (
            revision?.bases as unknown as
              | ProposalReconciliationBasis[]
              | undefined
          )?.find(
            (basis) => basis.entityType === 'TASK' && basis.entityId === taskId,
          ));
      if (!expected)
        throw new ConflictException(
          'Original target content is unavailable. Reconciliation is required.',
        );
      this.assertReviewedBasisCurrent(
        await this.resolveReservedBases(tx, [expected]),
        [current],
        proposal.id,
      );
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

  private async futureApplicationBasis(
    tx: AnyTransactionClient,
    proposal: Proposal,
    materializationId: string,
    entityType: 'TASK' | 'EDGE',
    entityId: string,
  ): Promise<ProposalReconciliationBasis | undefined> {
    if (proposal.action !== 'VERSIONED_UPDATE') return undefined;
    const intent = await tx.workItemChangeSetMaterialization.findUnique({
      where: { id: materializationId, proposalId: proposal.id },
    });
    const stored = intent?.targetProjection as unknown as
      | { futureApplication?: FutureGraphApplication }
      | undefined;
    return stored?.futureApplication?.reviewedBases.find(
      (basis) => basis.entityType === entityType && basis.entityId === entityId,
    );
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
    const appliedBasis = await this.futureApplicationBasis(
      tx,
      proposal,
      materializationId,
      'EDGE',
      edgeId,
    );
    const expected = receipt
      ? (receipt.basis as unknown as ProposalReconciliationBasis)
      : (appliedBasis ??
        (
          revision?.bases as unknown as
            | ProposalReconciliationBasis[]
            | undefined
        )?.find(
          (basis) => basis.entityType === 'EDGE' && basis.entityId === edgeId,
        ));
    if (!expected)
      throw new ConflictException(
        'Original relationship content is unavailable. Reconciliation is required.',
      );
    const current = await this.edgeBasis(proposal, edgeId);
    // The Graph provider proves an already-completed conditional deletion by its
    // durable deletion receipt; absence alone is never proof of our operation.
    if (!(verifyDeletionReceipt && current.version === 'absent'))
      this.assertReviewedBasisCurrent([expected], [current], proposal.id);
    return expected;
  }

  async publishTaskEffects(
    tx: AnyTransactionClient,
    proposal: Proposal,
    materializationId: string,
    /** Receives only the tasks this materialization actually wrote. */
    writeMarker: (writtenTaskIds: string[]) => Promise<void>,
  ): Promise<void> {
    const receipts = await tx.proposalReconciliationEffect.findMany({
      where: { materializationId, entityType: 'TASK' },
      orderBy: { entityId: 'asc' },
    });
    for (const receipt of receipts) {
      this.assertReviewedBasisCurrent(
        [receipt.basis as unknown as ProposalReconciliationBasis],
        [await this.adapter.task(tx, proposal, receipt.entityId, true)],
        proposal.id,
      );
    }
    await writeMarker(
      receipts.map(({ entityId }: { entityId: string }) => entityId),
    );
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
    proposalId?: string,
  ): void {
    const differences = this.basisMismatches(reviewed, current);
    if (differences.length === 0) return;
    const correlationId = uuidv4();
    this.logger.warn(
      `Proposal approval blocked: reviewed basis no longer current ${JSON.stringify({ proposalId, correlationId, differences })}`,
    );
    throw new ConflictException({
      message:
        'Proposal content changed after review. Reconciliation is required.',
      // Read by toProposalApprovalFailureDiagnostic into the approval 409 body.
      issues: differences.flatMap(basisMismatchIssues),
      correlationId,
    });
  }

  private basesMatch(
    reviewed: readonly ProposalReconciliationBasis[],
    current: readonly ProposalReconciliationBasis[],
  ): boolean {
    return this.basisMismatches(reviewed, current).length === 0;
  }

  /**
   * Work items and design docs are compared by content alone: their versions are
   * built from timestamps that unrelated writes (e.g. adding a child) also move.
   */
  private basisMismatches(
    reviewed: readonly ProposalReconciliationBasis[],
    current: readonly ProposalReconciliationBasis[],
  ): BasisMismatch[] {
    const currentByIdentity = new Map(
      current.map((basis) => [`${basis.entityType}:${basis.entityId}`, basis]),
    );
    const mismatches: BasisMismatch[] = [];
    for (const basis of reviewed) {
      const identity = `${basis.entityType}:${basis.entityId}`;
      const actual = currentByIdentity.get(identity);
      currentByIdentity.delete(identity);
      const mismatch = {
        entityType: basis.entityType,
        entityId: basis.entityId,
      };
      if (!actual) {
        mismatches.push({ ...mismatch, kind: 'missing', differingKeys: [] });
        continue;
      }
      if (
        (versionIsMeaningful(basis) || versionIsMeaningful(actual)) &&
        basis.version !== actual.version
      ) {
        mismatches.push({ ...mismatch, kind: 'version', differingKeys: [] });
        continue;
      }
      const differingKeys = differingContentKeys(
        reviewedContent(basis),
        reviewedContent(actual),
      );
      if (differingKeys.length > 0)
        mismatches.push({ ...mismatch, kind: 'content', differingKeys });
    }
    for (const extra of currentByIdentity.values())
      mismatches.push({
        entityType: extra.entityType,
        entityId: extra.entityId,
        kind: 'missing',
        differingKeys: [],
      });
    return mismatches;
  }
}

export type BasisMismatch = {
  entityType: string;
  entityId: string;
  kind: 'missing' | 'version' | 'content';
  /** Field or `sections.<key>` paths only; never content values. */
  differingKeys: string[];
};

const MISMATCH_REASONS: Record<BasisMismatch['kind'], string> = {
  missing: 'The reviewed entity is no longer part of the current target.',
  version: 'The entity was created, deleted or replaced after review.',
  content: 'This field changed after review.',
};

const basisMismatchIssues = (mismatch: BasisMismatch) =>
  (mismatch.differingKeys.length > 0 ? mismatch.differingKeys : ['']).map(
    (key) => ({
      field: `${mismatch.entityType}:${mismatch.entityId}${key ? `.${key}` : ''}`,
      code: 'PROPOSAL_RECONCILIATION_REQUIRED',
      reason: MISMATCH_REASONS[mismatch.kind],
      layer: 'referential' as const,
      suggestion: 'Review a reconciled result before applying.',
    }),
  );

const versionIsMeaningful = (basis: ProposalReconciliationBasis): boolean =>
  (basis.entityType !== 'TASK' && basis.entityType !== 'DESIGN_DOC') ||
  basis.version === 'absent' ||
  String(basis.version).startsWith('reserved:');

// JSON persistence omits unset optional object fields. Their absence does not
// change reviewed content; null, array membership and order remain meaningful.
const sameReviewedContent = (left: unknown, right: unknown): boolean => {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    return (
      left.length === right.length &&
      left.every((value, index) => sameReviewedContent(value, right[index]))
    );
  }
  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) return false;
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].every((key) =>
      sameReviewedContent(a[key], b[key]),
    );
  }
  return left === right;
};

const NESTED_KEYS = new Set(['sections', 'sectionOrder', 'definition']);

const differingContentKeys = (
  left: unknown,
  right: unknown,
  prefix = '',
): string[] => {
  if (sameReviewedContent(left, right)) return [];
  if (!isPlainObject(left) || !isPlainObject(right))
    return [prefix ? prefix.slice(0, -1) : '(root)'];
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((key) =>
    prefix === '' && NESTED_KEYS.has(key)
      ? differingContentKeys(a[key], b[key], `${key}.`)
      : sameReviewedContent(a[key], b[key])
        ? []
        : [`${prefix}${key}`],
  );
};

// Full snapshots remain available for candidate construction and writes.
const reviewedContent = (basis: ProposalReconciliationBasis): unknown =>
  basis.entityType === 'TASK' || basis.entityType === 'DESIGN_DOC'
    ? reviewedTargetContent(basis.content)
    : basis.content;

const reviewedTargetContent = (content: Prisma.JsonObject) => ({
  name: content.name,
  sections: content.sections,
});
