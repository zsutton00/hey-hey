import {
  ProposalReconciliationService,
  type ReconciliationGroupMember,
} from './proposal-reconciliation.service';
import {
  currentWritingSessionId,
  EvalOutputAdmissionService,
} from '../eval/eval-output-admission.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProposalAction,
  ProposalType,
  TargetEntityType,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type {
  AddProposalGroupMemberRequest,
  CreateProposalDto,
  ProposalGroupAuthoringSnapshot,
  RemoveProposalGroupMemberRequest,
  ReplaceProposalGroupPrerequisitesRequest,
  StartProposalGroupRequest,
  UpdateProposalGroupMemberRequest,
} from 'src/generated';
import type { WorkItemTypeDefinitionDto } from 'src/generated/model/workItemTypeDefinitionDto';
import {
  type AnyTransactionClient,
  PrismaService,
} from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId, UserId } from 'src/types';
import { assertWorkflowProposalLinksStructurallyValid } from './proposal-validation.engine';
import { assertProposalStructurallyValid } from './proposal-validation.engine';
import {
  ProposalValidationEngine,
  type AdmittedProposalCandidate,
  type ProposalAuthoringAdmission,
} from './proposal-validation.engine';
import {
  assertNoRawTracksDeclaration,
  storeTracksAttachmentAsProposalEdge,
} from './proposal-tracking-attachment';
import { evaluateSupersedeInvariant } from './supersede-invariant';
import { buildOriginInfluence } from './origin-influence';
import {
  assertProposalEdgeTargetsResolvable,
  loadProposalReferenceMetadata,
  proposalReferenceKey,
  resolveProposalTitle,
  snapshotEdgeTitles,
  snapshotInfluenceReferences,
} from './proposal-title-snapshot';
import { ProposalGroupService } from './proposal-group.service';
import { ProjectAccessService } from 'src/auth/services/project-access.service';
import type { StampedCreateProposalDto } from './proposal.types';
import {
  NIL_UUID,
  normalizeWorkItemTypeParentage,
} from './work-item-type-proposal.builder';

type PreparedGroupProposal = {
  data: Prisma.ProposalUncheckedCreateInput;
  reservedTargetEntityId: string | null;
};

type GroupReservedEntity = {
  entityId: string;
  entityType: string;
  workItemType?: string;
};

@Injectable()
export class ProposalGroupAuthoringService {
  private readonly logger = new Logger(ProposalGroupAuthoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly validationEngine: ProposalValidationEngine,
    private readonly proposalGroupService: ProposalGroupService,
    private readonly projectAccess: ProjectAccessService,
    private readonly reconciliation: ProposalReconciliationService,
    @Optional()
    private readonly evalOutputAdmission: EvalOutputAdmissionService = new EvalOutputAdmissionService(),
  ) {}

  private async assertMayAuthorProposals(
    projectId: ProjectId,
    userId: UserId,
    proposals: readonly Pick<StampedCreateProposalDto, 'targetEntityType'>[],
  ): Promise<void> {
    if (!proposals.some((p) => p.targetEntityType === 'WORK_ITEM_TYPE')) return;
    await this.projectAccess.assertProjectRole(
      projectId,
      userId,
      'manageWorkItemTypes',
    );
  }

  private async prepareTaskMutationRequirements(
    dto: CreateProposalDto,
    organizationId: OrganizationId,
    projectId: ProjectId,
    db: AnyTransactionClient,
  ): Promise<CreateProposalDto> {
    const preparer = (
      this.validationEngine as unknown as {
        prepareTaskMutationRequirements?: (
          dto: CreateProposalDto,
          organizationId: OrganizationId,
          projectId: ProjectId,
          db: AnyTransactionClient,
        ) => Promise<CreateProposalDto>;
      }
    ).prepareTaskMutationRequirements;
    // Isolated authoring tests may provide a narrow validation double. The
    // production engine freezes requirement IDs before the group member is
    // persisted and reviewed.
    return typeof preparer === 'function'
      ? preparer.call(this.validationEngine, dto, organizationId, projectId, db)
      : dto;
  }

  async start(
    organizationId: OrganizationId,
    projectId: ProjectId,
    dto: StartProposalGroupRequest,
  ): Promise<ProposalGroupAuthoringSnapshot> {
    this.logger.log('Starting hidden proposal-group authoring', {
      organizationId,
      projectId,
      originatingConversationId: dto.originatingConversationId,
    });

    return this.prisma.db.$transaction(async (tx) => {
      await this.assertAuthoringScope(tx, organizationId, projectId, dto);
      const group = await tx.proposalGroup.create({
        data: {
          organizationId,
          projectId,
          conversationId: dto.originatingConversationId ?? null,
          messageId: null,
          status: 'BUILDING',
          revision: 1,
        },
        select: { id: true },
      });
      const snapshot = await this.loadAuthoringSnapshot(
        tx,
        organizationId,
        projectId,
        group.id,
      );
      this.logger.log('Committed hidden proposal-group authoring start', {
        groupId: group.id,
        organizationId,
        projectId,
        revision: snapshot.currentRevision,
      });
      return snapshot;
    });
  }

  async addMember(
    organizationId: OrganizationId,
    projectId: ProjectId,
    groupId: string,
    userId: UserId,
    dto: Omit<AddProposalGroupMemberRequest, 'proposal'> & {
      proposal: StampedCreateProposalDto;
    },
  ): Promise<ProposalGroupAuthoringSnapshot> {
    this.logger.log('Adding hidden proposal-group member', {
      organizationId,
      projectId,
      groupId,
      expectedRevision: dto.expectedRevision,
      action: dto.proposal.action,
      targetEntityType: dto.proposal.targetEntityType,
    });
    await this.assertMayAuthorProposals(projectId, userId, [dto.proposal]);

    return this.prisma.db.$transaction(async (tx) => {
      const group = await this.lockBuildingGroup(
        tx,
        organizationId,
        projectId,
        groupId,
        dto.expectedRevision,
      );
      const groupReservedEntities = await this.loadGroupReservedEntities(
        tx,
        groupId,
      );
      const allowedUnmaterializedTargetKeys = new Set(
        groupReservedEntities.map(proposalReferenceKey),
      );
      const prepared = await this.prepareProposal(
        tx,
        organizationId,
        projectId,
        groupId,
        userId,
        dto.proposal,
        null,
        allowedUnmaterializedTargetKeys,
        groupReservedEntities,
      );
      const aggregate = await tx.proposalGroupMember.aggregate({
        where: { groupId },
        _max: { memberOrder: true },
      });
      const memberOrder = (aggregate._max.memberOrder ?? -1) + 1;
      const proposal = await tx.proposal.create({ data: prepared.data });
      const member = await tx.proposalGroupMember.create({
        data: {
          groupId,
          proposalId: proposal.id,
          memberOrder,
          reservedTargetEntityId: prepared.reservedTargetEntityId,
          executionState: 'PENDING_APPROVAL',
        },
      });
      await this.reconciliation.captureAuthoring(tx, proposal);
      await this.advanceRevision(tx, group.id, group.revision);

      this.logger.debug('Allocated hidden proposal-group member', {
        groupId,
        memberId: member.id,
        proposalId: proposal.id,
        memberOrder,
        reservedTargetEntityId: prepared.reservedTargetEntityId,
        previousRevision: group.revision,
        nextRevision: group.revision + 1,
      });
      return this.loadAuthoringSnapshot(tx, organizationId, projectId, groupId);
    });
  }

  async addMembers(
    organizationId: OrganizationId,
    projectId: ProjectId,
    groupId: string,
    userId: UserId,
    expectedRevision: number,
    proposals: StampedCreateProposalDto[],
    reconciliationMembers?: readonly ReconciliationGroupMember[],
  ): Promise<ProposalGroupAuthoringSnapshot> {
    if (proposals.length === 0) {
      throw new BadRequestException(
        'At least one proposal-group member is required',
      );
    }
    this.logger.log('Adding hidden proposal-group member batch', {
      organizationId,
      projectId,
      groupId,
      expectedRevision,
      memberCount: proposals.length,
    });
    await this.assertMayAuthorProposals(projectId, userId, proposals);

    return this.prisma.db.$transaction(async (tx) => {
      const group = await this.lockBuildingGroup(
        tx,
        organizationId,
        projectId,
        groupId,
        expectedRevision,
      );
      const groupReservedEntities = await this.loadGroupReservedEntities(
        tx,
        groupId,
      );
      const allowedUnmaterializedTargetKeys = new Set(
        groupReservedEntities.map(proposalReferenceKey),
      );
      const batchReservations = proposals.map((proposalInput, index) =>
        reconciliationMembers
          ? reconciliationMembers[index]!.reservedEntityId
          : proposalInput.action === 'CREATE'
            ? randomUUID()
            : null,
      );
      const batchReservedEntities = proposals.flatMap(
        (proposalInput, index): GroupReservedEntity[] => {
          const entityId = batchReservations[index];
          if (!entityId) return [];
          return [
            {
              entityId,
              entityType: proposalInput.targetEntityType,
              workItemType:
                proposalInput.targetEntityType === 'TASK'
                  ? (proposalInput.updates as { type?: string }).type
                  : proposalInput.targetEntityType === 'WORK_ITEM_TYPE'
                    ? (proposalInput.updates as { key?: string }).key
                    : undefined,
            },
          ];
        },
      );
      for (const entity of batchReservedEntities) {
        allowedUnmaterializedTargetKeys.add(proposalReferenceKey(entity));
      }
      const allReservedEntities = [
        ...groupReservedEntities,
        ...batchReservedEntities,
      ];
      const normalizedProposals = proposals.map((proposalInput) =>
        this.normalizeProposalInput(proposalInput),
      );
      const origins = new Map<
        string,
        Awaited<ReturnType<typeof buildOriginInfluence>>
      >();
      for (const { conversationId } of normalizedProposals) {
        if (conversationId && !origins.has(conversationId)) {
          origins.set(
            conversationId,
            await buildOriginInfluence(tx, conversationId),
          );
        }
      }
      const admissionCandidates = normalizedProposals.map(
        (normalized, index) => {
          const sanitizedInfluences = (normalized.influences ?? []).filter(
            (influence) => influence.reasonType !== 'origin',
          );
          const origin = normalized.conversationId
            ? origins.get(normalized.conversationId)
            : null;
          return {
            ...normalized,
            targetEntityId:
              batchReservations[index] ?? normalized.targetEntityId,
            influences: origin
              ? [...sanitizedInfluences, origin]
              : sanitizedInfluences,
          };
        },
      );
      const admission =
        await this.validationEngine.assertAuthoringCandidatesValid({
          proposals: admissionCandidates,
          context: {
            organizationId,
            projectId,
            db: tx,
            group: { groupId, reservedEntities: allReservedEntities },
          },
        });
      const aggregate = await tx.proposalGroupMember.aggregate({
        where: { groupId },
        _max: { memberOrder: true },
      });
      const firstMemberOrder = (aggregate._max.memberOrder ?? -1) + 1;

      const reconciliationCaptures: Array<() => Promise<void>> = [];
      for (const [index, proposalInput] of proposals.entries()) {
        const prepared = await this.prepareProposal(
          tx,
          organizationId,
          projectId,
          groupId,
          userId,
          proposalInput,
          batchReservations[index],
          allowedUnmaterializedTargetKeys,
          allReservedEntities,
          {
            admitted: admission.candidates[index]!,
            metadata: admission.metadata,
          },
        );
        const reconciliationMember = reconciliationMembers?.[index];
        const proposal = await tx.proposal.create({
          data: {
            ...prepared.data,
            ...(reconciliationMember
              ? { id: reconciliationMember.proposalId }
              : {}),
          },
        });
        const member = await tx.proposalGroupMember.create({
          data: {
            groupId,
            proposalId: proposal.id,
            memberOrder: firstMemberOrder + index,
            reservedTargetEntityId: prepared.reservedTargetEntityId,
            executionState: 'PENDING_APPROVAL',
          },
        });
        if (prepared.reservedTargetEntityId) {
          allowedUnmaterializedTargetKeys.add(
            proposalReferenceKey({
              entityId: prepared.reservedTargetEntityId,
              entityType: prepared.data.targetEntityType,
            }),
          );
        }
        reconciliationCaptures.push(async () => {
          if (reconciliationMember?.provenance) {
            await this.reconciliation.captureAuthoring(
              tx,
              proposal,
              reconciliationMember.provenance,
              reconciliationMember.identityMappings,
            );
          } else if (reconciliationMember) {
            await this.reconciliation.copyOriginalBasis(
              tx,
              proposal,
              reconciliationMember.sourceProposalId,
              reconciliationMember.identityMappings,
            );
          } else {
            await this.reconciliation.captureAuthoring(tx, proposal);
          }
        });
        this.logger.debug('Allocated hidden proposal-group batch member', {
          groupId,
          memberId: member.id,
          proposalId: proposal.id,
          memberOrder: firstMemberOrder + index,
          reservedTargetEntityId: prepared.reservedTargetEntityId,
        });
      }

      for (const capture of reconciliationCaptures) await capture();
      await this.advanceRevision(tx, group.id, group.revision);
      return this.loadAuthoringSnapshot(tx, organizationId, projectId, groupId);
    });
  }

  async updateMember(
    organizationId: OrganizationId,
    projectId: ProjectId,
    groupId: string,
    memberId: string,
    userId: UserId,
    dto: Omit<UpdateProposalGroupMemberRequest, 'proposal'> & {
      proposal: StampedCreateProposalDto;
    },
  ): Promise<ProposalGroupAuthoringSnapshot> {
    await this.assertMayAuthorProposals(projectId, userId, [dto.proposal]);
    return this.prisma.db.$transaction(async (tx) => {
      const group = await this.lockBuildingGroup(
        tx,
        organizationId,
        projectId,
        groupId,
        dto.expectedRevision,
      );
      const existing = await tx.proposalGroupMember.findFirst({
        where: { id: memberId, groupId },
        include: { proposal: true },
      });
      if (!existing) {
        throw new NotFoundException('Proposal group member not found');
      }
      if (
        existing.proposal.messageId !== null &&
        dto.proposal.conversationId !== undefined &&
        dto.proposal.conversationId !== existing.proposal.conversationId
      ) {
        this.logger.warn(
          'Rejected Conversation reassignment for a Message-owned grouped Proposal',
          {
            groupId,
            memberId,
            proposalId: existing.proposalId,
            existingConversationId: existing.proposal.conversationId,
            requestedConversationId: dto.proposal.conversationId,
            messageId: existing.proposal.messageId,
          },
        );
        throw new ConflictException(
          'A Message-owned Proposal cannot be moved to another Conversation',
        );
      }
      const proposalInput =
        existing.proposal.messageId !== null &&
        dto.proposal.conversationId === undefined
          ? {
              ...dto.proposal,
              conversationId: existing.proposal.conversationId ?? undefined,
            }
          : dto.proposal;
      const groupReservedEntities = await this.loadGroupReservedEntities(
        tx,
        groupId,
      );
      const allowedUnmaterializedTargetKeys = new Set(
        groupReservedEntities.map(proposalReferenceKey),
      );
      const preservedReservation =
        existing.proposal.action === 'CREATE' &&
        dto.proposal.action === 'CREATE'
          ? existing.reservedTargetEntityId
          : null;
      if (existing.reservedTargetEntityId) {
        allowedUnmaterializedTargetKeys.delete(
          proposalReferenceKey({
            entityId: existing.reservedTargetEntityId,
            entityType: existing.proposal.targetEntityType,
          }),
        );
        if (preservedReservation) {
          allowedUnmaterializedTargetKeys.add(
            proposalReferenceKey({
              entityId: preservedReservation,
              entityType: dto.proposal.targetEntityType,
            }),
          );
        }
      }
      const prepared = await this.prepareProposal(
        tx,
        organizationId,
        projectId,
        groupId,
        userId,
        proposalInput,
        preservedReservation,
        allowedUnmaterializedTargetKeys,
        groupReservedEntities.filter(
          (entity) => entity.entityId !== existing.reservedTargetEntityId,
        ),
      );

      const revisedProposal = await tx.proposal.update({
        where: { id: existing.proposalId },
        data: {
          type: prepared.data.type,
          action: prepared.data.action,
          targetEntityId: prepared.data.targetEntityId,
          targetEntityType: prepared.data.targetEntityType,
          updates: prepared.data.updates,
          title: prepared.data.title,
          eli5: prepared.data.eli5,
          requestorId: prepared.data.requestorId,
          requestorContext: prepared.data.requestorContext,
          influences: prepared.data.influences,
          generatedWithVersion: prepared.data.generatedWithVersion,
          validationSessionId: prepared.data.validationSessionId,
          conversationId: prepared.data.conversationId,
          edges: prepared.data.edges,
        },
      });
      await this.reconciliation.captureAuthoring(tx, revisedProposal);
      await tx.proposalGroupMember.update({
        where: { id: memberId },
        data: {
          reservedTargetEntityId: prepared.reservedTargetEntityId,
        },
      });
      await this.advanceRevision(tx, group.id, group.revision);
      this.logger.debug('Replaced hidden proposal-group member draft', {
        groupId,
        memberId,
        proposalId: existing.proposalId,
        reservedTargetEntityId: prepared.reservedTargetEntityId,
        nextRevision: group.revision + 1,
      });
      return this.loadAuthoringSnapshot(tx, organizationId, projectId, groupId);
    });
  }

  async removeMember(
    organizationId: OrganizationId,
    projectId: ProjectId,
    groupId: string,
    memberId: string,
    dto: RemoveProposalGroupMemberRequest,
  ): Promise<ProposalGroupAuthoringSnapshot> {
    return this.prisma.db.$transaction(async (tx) => {
      const group = await this.lockBuildingGroup(
        tx,
        organizationId,
        projectId,
        groupId,
        dto.expectedRevision,
      );
      const member = await tx.proposalGroupMember.findFirst({
        where: { id: memberId, groupId },
        select: { id: true, proposalId: true, memberOrder: true },
      });
      if (!member) {
        throw new NotFoundException('Proposal group member not found');
      }
      await tx.proposalGroupMember.delete({ where: { id: member.id } });
      await tx.proposal.delete({ where: { id: member.proposalId } });
      await tx.proposalGroupMember.updateMany({
        where: { groupId, memberOrder: { gt: member.memberOrder } },
        data: { memberOrder: { decrement: 1 } },
      });
      await this.advanceRevision(tx, group.id, group.revision);
      this.logger.debug('Removed and compacted hidden proposal-group member', {
        groupId,
        memberId,
        removedOrder: member.memberOrder,
        nextRevision: group.revision + 1,
      });
      return this.loadAuthoringSnapshot(tx, organizationId, projectId, groupId);
    });
  }

  async replacePrerequisites(
    organizationId: OrganizationId,
    projectId: ProjectId,
    groupId: string,
    memberId: string,
    dto: ReplaceProposalGroupPrerequisitesRequest,
  ): Promise<ProposalGroupAuthoringSnapshot> {
    const prerequisiteMemberIds = this.normalizeMemberIds(
      dto.prerequisiteMemberIds,
    );
    return this.prisma.db.$transaction(async (tx) => {
      const group = await this.lockBuildingGroup(
        tx,
        organizationId,
        projectId,
        groupId,
        dto.expectedRevision,
      );
      const memberIds = await tx.proposalGroupMember.findMany({
        where: {
          groupId,
          id: { in: [memberId, ...prerequisiteMemberIds] },
        },
        select: { id: true },
      });
      const found = new Set(memberIds.map((member) => member.id));
      if (!found.has(memberId)) {
        throw new NotFoundException('Proposal group member not found');
      }
      const missing = prerequisiteMemberIds.filter((id) => !found.has(id));
      if (missing.length > 0) {
        throw new BadRequestException({
          message: 'Prerequisites must be members of the same proposal group',
          missingMemberIds: missing,
        });
      }
      if (prerequisiteMemberIds.includes(memberId)) {
        throw new BadRequestException(
          'A proposal group member cannot depend on itself',
        );
      }

      await tx.proposalGroupDependency.deleteMany({
        where: { groupId, dependentMemberId: memberId },
      });
      if (prerequisiteMemberIds.length > 0) {
        await tx.proposalGroupDependency.createMany({
          data: prerequisiteMemberIds.map((prerequisiteMemberId) => ({
            groupId,
            dependentMemberId: memberId,
            prerequisiteMemberId,
          })),
        });
      }
      await this.advanceRevision(tx, group.id, group.revision);
      this.logger.debug('Replaced proposal-group all-of prerequisites', {
        groupId,
        memberId,
        prerequisiteMemberIds,
        nextRevision: group.revision + 1,
      });
      return this.loadAuthoringSnapshot(tx, organizationId, projectId, groupId);
    });
  }

  private async prepareProposal(
    tx: AnyTransactionClient,
    organizationId: OrganizationId,
    projectId: ProjectId,
    groupId: string,
    userId: UserId,
    input: StampedCreateProposalDto,
    preservedReservation: string | null = null,
    allowedUnmaterializedTargetKeys: ReadonlySet<string> = new Set(),
    groupReservedEntities: ReadonlyArray<GroupReservedEntity> = [],
    preparation?: {
      admitted: AdmittedProposalCandidate<StampedCreateProposalDto>;
      metadata: ProposalAuthoringAdmission['metadata'];
    },
  ): Promise<PreparedGroupProposal> {
    if (!input || typeof input !== 'object') {
      throw new BadRequestException('proposal is required');
    }
    input = this.normalizeProposalInput(input);
    const reservedTargetEntityId =
      input.action === 'CREATE' ? (preservedReservation ?? randomUUID()) : null;
    const targetEntityId = reservedTargetEntityId ?? input.targetEntityId;
    const withReservedTarget: StampedCreateProposalDto = {
      ...input,
      targetEntityId,
    };
    const sanitizedInfluences = (withReservedTarget.influences ?? []).filter(
      (influence) => influence.reasonType !== 'origin',
    );
    const origin = preparation
      ? null
      : await buildOriginInfluence(tx, withReservedTarget.conversationId);
    const withOrigin: StampedCreateProposalDto = preparation?.admitted
      .candidate ?? {
      ...withReservedTarget,
      influences: origin
        ? [...sanitizedInfluences, origin]
        : sanitizedInfluences,
    };
    const reservedEntities = [
      ...groupReservedEntities,
      ...(reservedTargetEntityId
        ? [
            {
              entityId: reservedTargetEntityId,
              entityType: withOrigin.targetEntityType,
              workItemType:
                withOrigin.targetEntityType === 'TASK'
                  ? (withOrigin.updates as { type?: string }).type
                  : withOrigin.targetEntityType === 'WORK_ITEM_TYPE'
                    ? (withOrigin.updates as { key?: string }).key
                    : undefined,
            },
          ]
        : []),
    ];
    if (!preparation) {
      await this.validationEngine.assertAuthoringCandidatesValid({
        proposals: [withOrigin],
        context: {
          organizationId,
          projectId,
          db: tx,
          group: { groupId, reservedEntities },
        },
      });
    }
    if (!preparation) {
      this.assertServerStampedSource(input);
      this.assertCreateTitle(input);
      const supersedeViolation = evaluateSupersedeInvariant(input);
      if (supersedeViolation) {
        throw new BadRequestException(
          `${supersedeViolation.reason} ${supersedeViolation.suggestion}`,
        );
      }
      assertProposalStructurallyValid(input);
      assertWorkflowProposalLinksStructurallyValid(input);
      assertNoRawTracksDeclaration(input);
      if (input.tracks) {
        await this.validationEngine.assertTrackingAttachmentValid(
          input,
          organizationId,
          projectId,
          tx,
        );
      }
    }
    const persistenceCandidate = preparation
      ? withOrigin
      : storeTracksAttachmentAsProposalEdge(withOrigin);
    const metadata =
      preparation?.metadata ??
      (await loadProposalReferenceMetadata(
        tx,
        organizationId,
        [
          ...(persistenceCandidate.action === 'CREATE' ||
          persistenceCandidate.targetEntityType === 'WORK_ITEM_TYPE'
            ? []
            : [
                {
                  entityId: persistenceCandidate.targetEntityId,
                  entityType: persistenceCandidate.targetEntityType,
                  needsTaskMetadata:
                    persistenceCandidate.targetEntityType === 'TASK',
                  needsTitle: persistenceCandidate.title === undefined,
                },
              ]),
          ...(persistenceCandidate.influences ?? []).map(
            ({ entityId, entityType, entityTitle, taskType }) => ({
              entityId,
              entityType,
              needsTaskMetadata:
                entityType === 'TASK' && taskType === undefined,
              needsTitle: entityTitle === undefined,
            }),
          ),
          ...(persistenceCandidate.edges ?? []).map(
            ({
              targetEntityId: entityId,
              targetEntityType: entityType,
              targetEntityTitle,
            }) => ({
              entityId,
              entityType,
              needsExistence: true,
              needsTitle: targetEntityTitle === undefined,
            }),
          ),
        ],
        projectId,
      ));
    assertProposalEdgeTargetsResolvable(
      persistenceCandidate.edges,
      metadata,
      projectId,
      allowedUnmaterializedTargetKeys,
    );
    const [influences, edges] = await Promise.all([
      snapshotInfluenceReferences(
        tx,
        organizationId,
        persistenceCandidate.influences,
        metadata,
      ),
      snapshotEdgeTitles(
        tx,
        organizationId,
        persistenceCandidate.edges,
        metadata,
      ),
    ]);
    const prepared: StampedCreateProposalDto = {
      ...persistenceCandidate,
      updates: (
        await this.prepareTaskMutationRequirements(
          persistenceCandidate,
          organizationId,
          projectId,
          tx,
        )
      ).updates,
      influences,
      edges,
    };
    const title = await resolveProposalTitle({
      db: tx,
      organizationId,
      action: prepared.action,
      targetEntityType: prepared.targetEntityType,
      targetEntityId: prepared.targetEntityId,
      callerTitle: prepared.title,
      metadata,
    });

    this.logger.debug('Prepared inert BUILDING proposal member', {
      action: prepared.action,
      targetEntityType: prepared.targetEntityType,
      targetEntityId: prepared.targetEntityId,
      reservedTargetEntityId,
      influenceCount: influences?.length ?? 0,
      edgeCount: edges?.length ?? 0,
    });

    const evalData = (
      await this.evalOutputAdmission.resolveProposal(tx, {
        organizationId,
        projectId,
        writingSessionId: currentWritingSessionId(),
        proposal: prepared,
      })
    ).data;

    return {
      reservedTargetEntityId,
      data: {
        ...evalData,
        organizationId,
        projectId,
        type: prepared.type as ProposalType,
        action: prepared.action as ProposalAction,
        targetEntityId: prepared.targetEntityId,
        targetEntityType: prepared.targetEntityType as TargetEntityType,
        updates: prepared.updates as Prisma.InputJsonValue,
        title,
        eli5: prepared.eli5,
        requestorId: userId,
        requestorContext: prepared.requestorContext
          ? (prepared.requestorContext as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        influences: prepared.influences
          ? (prepared.influences as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        generatedWithVersion: prepared.generatedWithVersion ?? null,
        validationSessionId: prepared.validationSessionId ?? null,
        conversationId: prepared.conversationId ?? null,
        messageId: null,
        edges: prepared.edges
          ? (prepared.edges as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    };
  }

  private async assertAuthoringScope(
    tx: AnyTransactionClient,
    organizationId: OrganizationId,
    projectId: ProjectId,
    dto: StartProposalGroupRequest,
  ): Promise<void> {
    const project = await tx.project.findFirst({
      where: { id: projectId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    if (dto.originatingConversationId) {
      const conversation = await tx.conversation.findFirst({
        where: {
          id: dto.originatingConversationId,
          organizationId,
          projectId,
        },
        select: { id: true },
      });
      if (!conversation) {
        throw new BadRequestException(
          'Originating conversation is outside the authoring scope',
        );
      }
    }
  }

  private normalizeProposalInput(
    input: StampedCreateProposalDto,
  ): StampedCreateProposalDto {
    if (
      input.targetEntityType === 'WORK_ITEM_TYPE' &&
      input.action === 'CREATE' &&
      input.targetEntityId === NIL_UUID
    ) {
      return {
        ...input,
        updates: normalizeWorkItemTypeParentage(
          input.updates as WorkItemTypeDefinitionDto,
        ),
      };
    }
    if (
      input.targetEntityType === 'WORK_ITEM_TYPE' &&
      input.action === 'UPDATE' &&
      input.updates !== null &&
      typeof input.updates === 'object' &&
      'definition' in input.updates
    ) {
      const updates = input.updates as {
        definition: WorkItemTypeDefinitionDto;
      };
      return {
        ...input,
        updates: {
          ...updates,
          definition: normalizeWorkItemTypeParentage(updates.definition),
        },
      };
    }
    return input;
  }

  private async loadGroupReservedEntities(
    tx: AnyTransactionClient,
    groupId: string,
  ): Promise<GroupReservedEntity[]> {
    const members = await tx.proposalGroupMember.findMany({
      where: { groupId, reservedTargetEntityId: { not: null } },
      select: {
        reservedTargetEntityId: true,
        proposal: {
          select: { targetEntityType: true, updates: true },
        },
      },
    });
    return members.map(
      (member: {
        reservedTargetEntityId: string | null;
        proposal: { targetEntityType: string; updates: unknown };
      }) => ({
        entityId: member.reservedTargetEntityId as string,
        entityType: member.proposal.targetEntityType,
        workItemType:
          member.proposal.targetEntityType === 'TASK'
            ? (member.proposal.updates as { type?: string }).type
            : member.proposal.targetEntityType === 'WORK_ITEM_TYPE'
              ? (member.proposal.updates as { key?: string }).key
              : undefined,
      }),
    );
  }

  private async lockBuildingGroup(
    tx: AnyTransactionClient,
    organizationId: OrganizationId,
    projectId: ProjectId,
    groupId: string,
    expectedRevision: number,
  ): Promise<{ id: string; revision: number }> {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new BadRequestException(
        'expectedRevision must be a non-negative integer',
      );
    }
    this.logger.debug('Locking proposal-group authoring revision', {
      organizationId,
      projectId,
      groupId,
      expectedRevision,
    });
    await tx.$queryRaw`
      SELECT id
      FROM proposal_groups
      WHERE id = ${groupId}
        AND organization_id = ${organizationId}
        AND project_id = ${projectId}
      FOR UPDATE
    `;
    const group = await tx.proposalGroup.findFirst({
      where: { id: groupId, organizationId, projectId },
      select: { id: true, status: true, revision: true },
    });
    if (!group) throw new NotFoundException('Proposal group not found');
    if (group.status !== 'BUILDING') {
      throw new ConflictException(
        'Proposal group authoring is frozen after finalization',
      );
    }
    if (group.revision !== expectedRevision) {
      throw new ConflictException({
        code: 'PROPOSAL_GROUP_REVISION_CONFLICT',
        groupId,
        expectedRevision,
        currentRevision: group.revision,
      });
    }
    return group;
  }

  private async advanceRevision(
    tx: AnyTransactionClient,
    groupId: string,
    revision: number,
  ): Promise<void> {
    const advanced = await tx.proposalGroup.updateMany({
      where: { id: groupId, status: 'BUILDING', revision },
      data: { revision: { increment: 1 } },
    });
    if (advanced.count !== 1) {
      throw new ConflictException(
        'Proposal group revision changed while authoring',
      );
    }
  }

  private async loadAuthoringSnapshot(
    tx: AnyTransactionClient,
    organizationId: OrganizationId,
    projectId: ProjectId,
    groupId: string,
  ): Promise<ProposalGroupAuthoringSnapshot> {
    const snapshot = await this.proposalGroupService.findOneInDb(
      tx,
      organizationId,
      projectId,
      groupId,
    );
    if (snapshot.lifecycle !== 'BUILDING') {
      throw new ConflictException('Proposal group is no longer BUILDING');
    }
    return snapshot as ProposalGroupAuthoringSnapshot;
  }

  private assertServerStampedSource(dto: CreateProposalDto): void {
    const source = (dto.requestorContext as { source?: unknown } | undefined)
      ?.source;
    if (source !== 'user' && source !== 'agent') {
      throw new BadRequestException(
        "Proposal must carry a server-stamped requestorContext.source ('user' or 'agent').",
      );
    }
  }

  private assertCreateTitle(dto: CreateProposalDto): void {
    if (
      dto.action === 'CREATE' &&
      (typeof dto.title !== 'string' || dto.title.length === 0)
    ) {
      throw new BadRequestException(
        'CREATE proposals must include a non-empty title.',
      );
    }
  }

  private normalizeMemberIds(value: Set<string> | string[]): string[] {
    if (!Array.isArray(value) && !(value instanceof Set)) {
      throw new BadRequestException(
        'prerequisiteMemberIds must be an array of member UUIDs',
      );
    }
    const values = Array.isArray(value) ? value : [...value];
    const deduplicated = [...new Set(values)];
    if (deduplicated.length !== values.length) {
      throw new BadRequestException(
        'prerequisiteMemberIds must contain unique values',
      );
    }
    return deduplicated;
  }
}
