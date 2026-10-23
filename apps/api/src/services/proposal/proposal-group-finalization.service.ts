import { assertProposalApplicationEligible } from './proposal-application-eligibility';
import { lockReconciliationReplacement } from './proposal-reconciliation-group.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Proposal, ProposalGroupMember } from '@prisma/client';
import type {
  CreateProposalDto,
  FinalizeProposalGroupRequest,
  ProjectedWorkItem,
  ProjectedWorkItemRelationship,
  ProposalGroupFinalizationResult,
  ProposalGroupSnapshot,
  ProposalGroupValidationIssue,
} from 'src/generated';
import { ProposalEdgeType } from 'src/generated';
import {
  type AnyTransactionClient,
  PrismaService,
} from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId } from 'src/types';
import type { AuthenticatedUser } from 'src/auth/strategies/jwt.strategy';
import { ProposalValidationEngine } from './proposal-validation.engine';
import { ProposalGroupReferenceValidation } from './proposal-group-reference-validation';
import {
  ProposalGroupService,
  type ProposalGroupWithSnapshot,
} from './proposal-group.service';
import { resolvePermissionEvaluationContext } from './permission-evaluation-context';
import { evaluatePermissions } from './permission-evaluation';
import { deriveChangedFields } from './entity-context-resolver';
import { ProposalGroupLifecycleEventService } from './proposal-group-lifecycle-event.service';
import { WorkItemTypeRegistryService } from '../tasks/work-item-type-registry.service';
import { ProposalGroupCoordinatorService } from './proposal-group-coordinator.service';
import type { LintFinding } from '../../mcp/tools/proposal-lint';
import { lintProjectedTopology } from '../../mcp/tools/proposal-topology-lint';
import { workItemChangeSetValidationRequestSchema } from './work-item-change-set.schema';
import {
  rootChildrenView,
  WorkItemChangeSetProjectorService,
} from './work-item-change-set-projector.service';
import { assertStoredTracksDeclarationsValid } from './proposal-tracking-attachment';
import { ProjectApprovalPolicyService } from './project-approval-policy.service';

@Injectable()
export class ProposalGroupFinalizationService {
  private readonly logger = new Logger(ProposalGroupFinalizationService.name);
  private readonly topologyLintByFrozenRevision = new Map<
    string,
    readonly LintFinding[]
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly validationEngine: ProposalValidationEngine,
    private readonly referenceValidation: ProposalGroupReferenceValidation,
    private readonly proposalGroupService: ProposalGroupService,
    private readonly moduleRef: ModuleRef,
    private readonly projectApprovalPolicyService: ProjectApprovalPolicyService,
    @Optional()
    private readonly lifecycleEvents?: ProposalGroupLifecycleEventService,
    @Optional()
    private readonly workItemTypeRegistry?: WorkItemTypeRegistryService,
    @Optional()
    private readonly workItemChangeSetProjector?: WorkItemChangeSetProjectorService,
  ) {}

  takeFrozenTopologyLintFindings(
    groupId: string,
    revision: number,
  ): readonly LintFinding[] {
    const key = `${groupId}:${revision}`;
    const findings = this.topologyLintByFrozenRevision.get(key) ?? [];
    this.topologyLintByFrozenRevision.delete(key);
    return findings;
  }

  async finalize(
    organizationId: OrganizationId,
    projectId: ProjectId,
    groupId: string,
    requestor: AuthenticatedUser,
    dto: FinalizeProposalGroupRequest,
  ): Promise<ProposalGroupFinalizationResult> {
    this.logger.log('Finalizing hidden proposal group', {
      organizationId,
      projectId,
      groupId,
      expectedRevision: dto.expectedRevision,
    });

    try {
      let topologyLintFindings: LintFinding[] = [];
      const result: ProposalGroupFinalizationResult =
        await this.prisma.db.$transaction(async (tx) => {
          const group = await this.lockAndReadGroup(
            tx,
            organizationId,
            projectId,
            groupId,
            dto.expectedRevision,
          );
          for (const member of group.members) {
            assertProposalApplicationEligible(
              member.proposal,
              'groupFinalization.finalize',
            );
          }
          const replacementSourceGroupId = await lockReconciliationReplacement(
            tx,
            groupId,
          );
          const projectPolicy =
            await this.projectApprovalPolicyService.resolve(projectId);
          const authoringSnapshot =
            this.proposalGroupService.toAuthoringSnapshot(group);
          const issues: ProposalGroupValidationIssue[] = [];

          if (group.members.length === 0) {
            issues.push({
              code: 'GROUP_EMPTY',
              location: '/members',
              memberId: null,
              message: 'A proposal group must contain at least one member.',
            });
          }
          for (const [index, member] of group.members.entries()) {
            if (
              member.proposal.organizationId !== organizationId ||
              member.proposal.projectId !== projectId
            ) {
              issues.push({
                code: 'MEMBER_INVALID',
                location: `/members/${index}/proposal`,
                memberId: member.id,
                message:
                  'Every proposal must belong to the group organization and project.',
              });
            }
          }

          const referenceResult = this.referenceValidation.validate(
            group.members,
            group.dependencies,
          );
          issues.push(...referenceResult.issues);

          const reservedEntities = group.members.flatMap((member) => {
            if (
              member.proposal.action !== 'CREATE' ||
              !member.reservedTargetEntityId
            ) {
              return [];
            }
            const updates = member.proposal.updates as Record<string, unknown>;
            return [
              {
                entityId: member.reservedTargetEntityId,
                entityType: member.proposal.targetEntityType,
                ...(member.proposal.targetEntityType === 'TASK'
                  ? typeof updates.type === 'string'
                    ? { workItemType: updates.type }
                    : {}
                  : member.proposal.targetEntityType === 'WORK_ITEM_TYPE'
                    ? {
                        workItemType:
                          typeof updates.key === 'string'
                            ? updates.key
                            : undefined,
                      }
                    : {}),
              },
            ];
          });

          issues.push(
            ...(await this.validateReservationOwnership(
              tx,
              group,
              referenceResult.referencesByMemberId,
            )),
          );

          for (const [index, member] of group.members.entries()) {
            try {
              if (!this.workItemTypeRegistry) {
                const edges = Array.isArray(member.proposal.edges)
                  ? member.proposal.edges
                  : [];
                if (
                  edges.some(
                    (edge) =>
                      typeof edge === 'object' &&
                      edge !== null &&
                      (edge as { edgeType?: unknown }).edgeType ===
                        ProposalEdgeType.Tracks,
                  )
                ) {
                  throw new Error(
                    'TRACKS eligibility policy is unavailable during finalization.',
                  );
                }
                continue;
              }
              await assertStoredTracksDeclarationsValid({
                db: tx,
                registry: this.workItemTypeRegistry,
                organizationId,
                projectId,
                proposal: member.proposal,
              });
            } catch (error) {
              issues.push({
                code:
                  error instanceof NotFoundException
                    ? 'MEMBER_REFERENCE_UNRESOLVED'
                    : 'MEMBER_INVALID',
                location: `/members/${index}/proposal/edges`,
                memberId: member.id,
                message: error instanceof Error ? error.message : String(error),
              });
            }
          }

          for (const [index, member] of group.members.entries()) {
            const proposal = this.toValidationDto(member.proposal);
            const result = await this.validationEngine.validate({
              proposals: [proposal],
              context: {
                organizationId,
                projectId,
                requestor,
                db: tx,
                group: { groupId, reservedEntities },
              },
            });
            for (const error of result.proposals[0]?.errors ?? []) {
              issues.push({
                code:
                  error.code === 'entity_not_found'
                    ? 'MEMBER_REFERENCE_UNRESOLVED'
                    : 'MEMBER_INVALID',
                location: this.toMemberPointer(index, error.field),
                memberId: member.id,
                message: error.reason,
              });
            }
          }

          const policyByMemberId = new Map<string, number>();
          for (const [index, member] of group.members.entries()) {
            try {
              const requestorContext = (member.proposal.requestorContext ??
                {}) as {
                source?: unknown;
                toolName?: unknown;
              };
              if (
                requestorContext.source !== 'user' &&
                requestorContext.source !== 'agent'
              ) {
                throw new Error(
                  'Persisted proposal is missing a valid server-stamped source.',
                );
              }
              const entityInput = {
                targetEntityType: member.proposal.targetEntityType,
                action: member.proposal.action,
                targetEntityId: member.proposal.targetEntityId,
                updates: member.proposal.updates,
              };
              const sourceContext: {
                source: 'user' | 'agent';
                toolName: string | null;
                authorId: string;
              } = {
                source: requestorContext.source,
                toolName:
                  typeof requestorContext.toolName === 'string'
                    ? requestorContext.toolName
                    : null,
                authorId: member.proposal.requestorId,
              };
              const reservationOwner =
                member.proposal.action === 'CREATE'
                  ? undefined
                  : group.members.find(
                      (candidate) =>
                        candidate.proposal.action === 'CREATE' &&
                        candidate.reservedTargetEntityId ===
                          member.proposal.targetEntityId &&
                        candidate.proposal.targetEntityType ===
                          member.proposal.targetEntityType,
                    );
              const evaluationContext = reservationOwner
                ? await this.resolveReservedTargetPolicyContext(
                    tx,
                    organizationId,
                    projectId,
                    reservationOwner.proposal,
                    entityInput,
                    sourceContext,
                  )
                : await resolvePermissionEvaluationContext(
                    tx,
                    organizationId,
                    projectId,
                    entityInput,
                    sourceContext,
                    this.workItemTypeRegistry,
                  );
              const config = evaluatePermissions(
                evaluationContext.entity,
                evaluationContext.proposal,
                projectPolicy,
              );
              policyByMemberId.set(
                member.id,
                replacementSourceGroupId
                  ? Math.max(1, config.threshold)
                  : config.threshold,
              );
              this.logger.debug('Captured proposal-group member policy', {
                groupId,
                memberId: member.id,
                proposalId: member.proposalId,
                requiredApprovals: config.threshold,
              });
            } catch (error) {
              issues.push({
                code: 'APPROVAL_POLICY_UNRESOLVED',
                location: `/members/${index}/proposal`,
                memberId: member.id,
                message:
                  error instanceof Error
                    ? error.message
                    : 'Approval policy could not be evaluated.',
              });
            }
          }

          if (issues.length > 0) {
            this.logger.warn(
              'Proposal-group finalization validation failed; draft remains mutable and hidden',
              {
                groupId,
                revision: group.revision,
                issueCount: issues.length,
                issueCodes: issues.map((issue) => issue.code),
              },
            );
            return {
              outcome: 'VALIDATION_FAILED',
              authoringSnapshot,
              issues,
            };
          }

          topologyLintFindings = await this.lintProjectedGroupTopology({
            organizationId,
            projectId,
            members: group.members,
          });

          const reviewMessageId = group.messageId;
          const proposalIds = group.members.map((member) => member.proposalId);
          if (reviewMessageId) {
            const attached = await tx.proposal.updateMany({
              where: { id: { in: proposalIds } },
              data: { messageId: reviewMessageId },
            });
            if (attached.count !== proposalIds.length) {
              throw new Error(
                'Every finalized proposal-group member must be attached to the review message',
              );
            }
          }

          const now = new Date();
          const prerequisitesByMemberId = new Map<
            string,
            ProposalGroupMember[]
          >();
          const memberById = new Map(
            group.members.map((member) => [member.id, member]),
          );
          for (const dependency of group.dependencies) {
            const prerequisite = memberById.get(
              dependency.prerequisiteMemberId,
            );
            if (!prerequisite) continue;
            const current =
              prerequisitesByMemberId.get(dependency.dependentMemberId) ?? [];
            current.push(prerequisite);
            prerequisitesByMemberId.set(dependency.dependentMemberId, current);
          }

          for (const member of group.members) {
            const requiredApprovals = policyByMemberId.get(member.id);
            if (requiredApprovals === undefined) {
              throw new Error(
                `Approval policy missing after successful validation for member ${member.id}`,
              );
            }
            const approvalSatisfied = requiredApprovals === 0;
            const prerequisitesApplied = (
              prerequisitesByMemberId.get(member.id) ?? []
            ).every(
              (prerequisite) => prerequisite.executionState === 'APPLIED',
            );
            const executionState = approvalSatisfied
              ? prerequisitesApplied
                ? 'READY'
                : 'WAITING_ON_DEPENDENCIES'
              : 'PENDING_APPROVAL';
            await tx.proposalGroupMember.update({
              where: { id: member.id },
              data: {
                requiredApprovals,
                approvalPolicyRevision: null,
                approvalSatisfiedAt: approvalSatisfied ? now : null,
                executionState,
              },
            });
            this.logger.debug(
              'Initialized frozen proposal-group member state',
              {
                groupId,
                memberId: member.id,
                requiredApprovals,
                approvalSatisfied,
                prerequisitesApplied,
                executionState,
              },
            );
          }

          if (replacementSourceGroupId) {
            await tx.proposalGroupMember.updateMany({
              where: {
                groupId: replacementSourceGroupId,
                executionState: { not: 'APPLIED' },
              },
              data: {
                executionState: 'INVALIDATED',
                invalidatedAt: now,
                terminalReason:
                  'Replaced by a reconciled group requiring fresh review.',
              },
            });
          }
          const frozen = await tx.proposalGroup.updateMany({
            where: {
              id: groupId,
              organizationId,
              projectId,
              status: 'BUILDING',
              revision: group.revision,
            },
            data: {
              ...(reviewMessageId ? { messageId: reviewMessageId } : {}),
              status: 'REVIEWABLE',
              frozenRevision: group.revision,
              frozenAt: now,
            },
          });
          if (frozen.count !== 1) {
            throw new ConflictException(
              'Proposal group changed while finalization was committing',
            );
          }
          const snapshot = await this.proposalGroupService.findOneInDb(
            tx,
            organizationId,
            projectId,
            groupId,
          );
          if (snapshot.lifecycle === 'BUILDING') {
            throw new Error('Finalized proposal group remained BUILDING');
          }
          this.logger.log(
            'Committed immutable proposal-group review revision',
            {
              groupId,
              revision: group.revision,
              frozenAt: now.toISOString(),
              memberCount: group.members.length,
            },
          );
          await this.lifecycleEvents?.publishInTransaction(tx, {
            organizationId,
            projectId,
            groupId,
            revision: snapshot.currentRevision,
            changedMemberIds: snapshot.members.map((member) => member.memberId),
          });
          return {
            outcome: 'FINALIZED',
            group: snapshot as ProposalGroupSnapshot,
          };
        });
      if (result.outcome === 'FINALIZED') {
        const readyMemberIds = result.group.members
          .filter((member) => member.executionState === 'READY')
          .map((member) => member.memberId);
        if (readyMemberIds.length > 0) {
          await this.moduleRef
            .get(ProposalGroupCoordinatorService, { strict: false })
            .dispatchReadyMembers({
              memberIds: readyMemberIds,
              organizationId,
              projectId,
            });
        }
        this.topologyLintByFrozenRevision.set(
          `${groupId}:${result.group.currentRevision}`,
          topologyLintFindings,
        );
      }
      return result;
    } catch (error) {
      this.logger.error('Rolled back proposal-group finalization', {
        organizationId,
        projectId,
        groupId,
        expectedRevision: dto.expectedRevision,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async lintProjectedGroupTopology(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    members: ReadonlyArray<ProposalGroupWithSnapshot['members'][number]>;
  }): Promise<LintFinding[]> {
    if (!this.workItemChangeSetProjector || !this.workItemTypeRegistry) {
      return [];
    }
    const overlayNodes = new Map<string, ProjectedWorkItem>();
    const overlayRelationships = new Map<
      string,
      ProjectedWorkItemRelationship
    >();
    for (const member of params.members) {
      if (
        member.proposal.targetEntityType !== 'TASK' ||
        member.proposal.action !== 'CREATE' ||
        !member.reservedTargetEntityId
      ) {
        continue;
      }
      const updates = member.proposal.updates as Record<string, unknown>;
      const sections = Array.isArray(updates.sections)
        ? updates.sections.flatMap((section) => {
            if (
              typeof section !== 'object' ||
              section === null ||
              typeof (section as { key?: unknown }).key !== 'string'
            ) {
              return [];
            }
            return [
              {
                key: (section as { key: string }).key,
                content: (section as { content?: unknown }).content ?? null,
              },
            ];
          })
        : [];
      const identity = {
        refType: 'existing' as const,
        id: member.reservedTargetEntityId,
      };
      if (typeof updates.type !== 'string') {
        throw new Error(
          'Validated TASK CREATE proposal is missing its work-item type.',
        );
      }
      overlayNodes.set(JSON.stringify(identity), {
        identity,
        label:
          typeof updates.name === 'string'
            ? updates.name
            : (member.proposal.title ?? member.reservedTargetEntityId),
        type: updates.type,
        name:
          typeof updates.name === 'string'
            ? updates.name
            : (member.proposal.title ?? member.reservedTargetEntityId),
        ...(typeof updates.parentTaskId === 'string'
          ? {
              parent: {
                refType: 'existing' as const,
                id: updates.parentTaskId,
              },
            }
          : {}),
        sections,
        deleted: false,
      });
    }
    const topologies = [];
    for (const member of params.members) {
      if (
        member.proposal.targetEntityType !== 'TASK' ||
        member.proposal.action !== 'UPDATE'
      ) {
        continue;
      }
      const parsed = workItemChangeSetValidationRequestSchema.safeParse(
        member.proposal.updates,
      );
      if (!parsed.success) continue;
      const topology = await this.workItemChangeSetProjector.projectTopology({
        organizationId: params.organizationId,
        projectId: params.projectId,
        request: parsed.data,
        overlayNodes: [...overlayNodes.values()],
        overlayRelationships: [...overlayRelationships.values()],
        view: rootChildrenView,
      });
      if (topology.projection.valid) {
        topologies.push(topology);
        topology.nodes.forEach((node) =>
          overlayNodes.set(JSON.stringify(node.identity), node),
        );
        topology.relationships.forEach((relationship) =>
          overlayRelationships.set(
            JSON.stringify(relationship.identity),
            relationship,
          ),
        );
      }
    }
    if (topologies.length === 0) return [];

    const nodes = new Map(
      topologies.flatMap((topology) =>
        topology.nodes.map(
          (node) => [JSON.stringify(node.identity), node] as const,
        ),
      ),
    );
    const relationships = new Map(
      topologies.flatMap((topology) =>
        topology.relationships.map(
          (relationship) =>
            [JSON.stringify(relationship.identity), relationship] as const,
        ),
      ),
    );
    const featureContractCitations = new Map<string, ReadonlySet<string>>();
    const participatingFeatureByWorkflowNode = new Map<string, string>();
    for (const topology of topologies) {
      topology.featureContractCitations.forEach((contracts, feature) => {
        const existing =
          featureContractCitations.get(feature) ?? new Set<string>();
        featureContractCitations.set(
          feature,
          new Set([...existing, ...contracts]),
        );
      });
      topology.participatingFeatureByWorkflowNode.forEach((feature, node) =>
        participatingFeatureByWorkflowNode.set(node, feature),
      );
    }
    const graphRootType = topologies[0]!.projection.projectedRoot.type;
    return lintProjectedTopology({
      nodes: [...nodes.values()],
      relationships: [...relationships.values()],
      featureContractCitations,
      participatingFeatureByWorkflowNode,
      semantics: this.workItemTypeRegistry.getProjectedTopologySemantics(
        params.projectId,
        graphRootType,
      ),
    });
  }

  private async resolveReservedTargetPolicyContext(
    tx: AnyTransactionClient,
    organizationId: OrganizationId,
    projectId: ProjectId,
    createProposal: Proposal,
    memberInput: {
      targetEntityType: string;
      action: string;
      targetEntityId: string;
      updates: unknown;
    },
    sourceContext: {
      source: 'user' | 'agent';
      toolName: string | null;
      authorId: string;
    },
  ) {
    const creatorContext = await resolvePermissionEvaluationContext(
      tx,
      organizationId,
      projectId,
      {
        targetEntityType: createProposal.targetEntityType,
        action: 'CREATE',
        targetEntityId: createProposal.targetEntityId,
        updates: createProposal.updates,
      },
      sourceContext,
    );
    this.logger.debug(
      'Evaluating proposal-group policy against reserved CREATE context',
      {
        reservedTargetEntityId: createProposal.targetEntityId,
        action: memberInput.action,
      },
    );
    return {
      entity: creatorContext.entity,
      proposal: {
        ...creatorContext.proposal,
        action:
          memberInput.action === 'VERSIONED_UPDATE'
            ? 'UPDATE'
            : (memberInput.action as 'UPDATE' | 'DELETE'),
        changedFields: await deriveChangedFields(tx, memberInput, {
          organizationId,
          projectId,
          workItemTypeRegistry: this.workItemTypeRegistry,
        }),
      },
    };
  }

  private async lockAndReadGroup(
    tx: AnyTransactionClient,
    organizationId: OrganizationId,
    projectId: ProjectId,
    groupId: string,
    expectedRevision: number,
  ): Promise<ProposalGroupWithSnapshot> {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new BadRequestException(
        'expectedRevision must be a non-negative integer',
      );
    }
    this.logger.debug('Locking proposal-group finalization aggregate', {
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
    const seed = await tx.proposalGroup.findFirst({
      where: { id: groupId, organizationId, projectId },
      select: { id: true, status: true, revision: true },
    });
    if (!seed) throw new NotFoundException('Proposal group not found');
    if (seed.status !== 'BUILDING') {
      throw new ConflictException('Proposal group is already finalized');
    }
    if (seed.revision !== expectedRevision) {
      throw new ConflictException({
        code: 'PROPOSAL_GROUP_REVISION_CONFLICT',
        groupId,
        expectedRevision,
        currentRevision: seed.revision,
      });
    }

    await tx.$queryRaw`
      SELECT id
      FROM proposal_group_members
      WHERE group_id = ${groupId}
      ORDER BY member_order
      FOR UPDATE
    `;
    await tx.$queryRaw`
      SELECT proposal.id
      FROM proposals AS proposal
      INNER JOIN proposal_group_members AS member
        ON member.proposal_id = proposal.id
      WHERE member.group_id = ${groupId}
      FOR UPDATE OF proposal
    `;
    await tx.$queryRaw`
      SELECT id
      FROM proposal_group_dependencies
      WHERE group_id = ${groupId}
      FOR UPDATE
    `;

    const group = await tx.proposalGroup.findFirst({
      where: { id: groupId, organizationId, projectId },
      include: {
        members: {
          orderBy: { memberOrder: 'asc' },
          include: {
            proposal: { include: { approvalRecords: true } },
          },
        },
        dependencies: true,
      },
    });
    if (!group) throw new NotFoundException('Proposal group not found');
    this.logger.debug('Re-read locked proposal-group finalization aggregate', {
      groupId,
      revision: group.revision,
      memberCount: group.members.length,
      dependencyCount: group.dependencies.length,
    });
    return group;
  }

  private async validateReservationOwnership(
    tx: AnyTransactionClient,
    group: ProposalGroupWithSnapshot,
    referencesByMemberId: ReadonlyMap<
      string,
      ReadonlyArray<{ entityId: string; location: string }>
    >,
  ): Promise<ProposalGroupValidationIssue[]> {
    const issues: ProposalGroupValidationIssue[] = [];
    const reservations = group.members.flatMap((member) =>
      member.reservedTargetEntityId
        ? [
            {
              memberId: member.id,
              entityId: member.reservedTargetEntityId,
            },
          ]
        : [],
    );
    const reservationIds = reservations.map(
      (reservation) => reservation.entityId,
    );
    if (reservationIds.length > 0) {
      const materialized = await tx.entityRegistry.findMany({
        where: {
          organizationId: group.organizationId,
          entityId: { in: reservationIds },
          deletedAt: null,
        },
        select: { entityId: true },
      });
      for (const row of materialized) {
        const reservation = reservations.find(
          (candidate) => candidate.entityId === row.entityId,
        );
        const index = group.members.findIndex(
          (member) => member.id === reservation?.memberId,
        );
        issues.push({
          code: 'RESERVED_ENTITY_ID_CONFLICT',
          location: `/members/${index}/reservedEntityId`,
          memberId: reservation?.memberId ?? null,
          message: 'The reserved identity is already materialized.',
        });
      }
    }

    const allReferencedIds = [
      ...new Set(
        [...referencesByMemberId.values()].flatMap((references) =>
          references.map((reference) => reference.entityId),
        ),
      ),
    ];
    if (allReferencedIds.length > 0) {
      const materialized = await tx.entityRegistry.findMany({
        where: {
          organizationId: group.organizationId,
          entityId: { in: allReferencedIds },
          deletedAt: null,
        },
        select: { entityId: true },
      });
      const materializedIds = new Set(
        materialized.map((row: { entityId: string }) => row.entityId),
      );
      const externalOwners = await tx.proposalGroupMember.findMany({
        where: {
          reservedTargetEntityId: { in: allReferencedIds },
          groupId: { not: group.id },
        },
        select: { reservedTargetEntityId: true, groupId: true },
      });
      const externalIds = new Set(
        externalOwners.flatMap(
          (owner: {
            reservedTargetEntityId: string | null;
            groupId: string;
          }) =>
            owner.reservedTargetEntityId ? [owner.reservedTargetEntityId] : [],
        ),
      );
      for (const [memberId, references] of referencesByMemberId) {
        for (const reference of references) {
          if (
            materializedIds.has(reference.entityId) ||
            !externalIds.has(reference.entityId)
          ) {
            continue;
          }
          issues.push({
            code: 'MEMBER_REFERENCE_UNRESOLVED',
            location: reference.location,
            memberId,
            message:
              'Reserved identities are private to their owning proposal group.',
          });
        }
      }
    }
    return issues;
  }

  private toValidationDto(proposal: Proposal): CreateProposalDto {
    return {
      type: proposal.type,
      action: proposal.action,
      targetEntityId: proposal.targetEntityId,
      targetEntityType: proposal.targetEntityType,
      title: proposal.title,
      eli5: proposal.eli5 ?? undefined,
      updates: proposal.updates as CreateProposalDto['updates'],
      requestorContext:
        (proposal.requestorContext as CreateProposalDto['requestorContext']) ??
        undefined,
      influences:
        (proposal.influences as unknown as CreateProposalDto['influences']) ??
        undefined,
      generatedWithVersion: proposal.generatedWithVersion ?? undefined,
      validationSessionId: proposal.validationSessionId ?? undefined,
      conversationId: proposal.conversationId ?? undefined,
      edges:
        (proposal.edges as unknown as CreateProposalDto['edges']) ?? undefined,
    } satisfies CreateProposalDto;
  }

  private toMemberPointer(memberIndex: number, field: string): string {
    const suffix = field
      .replace(/^proposals\[0\]\.?/, '')
      .replace(/\[(\d+)\]/g, '/$1')
      .replace(/\./g, '/');
    return `/members/${memberIndex}/proposal${suffix ? `/${suffix}` : ''}`;
  }
}
