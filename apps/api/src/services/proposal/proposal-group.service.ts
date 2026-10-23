import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CreateProposalDto,
  ProposalGroupApprovalProgress,
  ProposalGroupAttempt,
  ProposalGroupAuthoringSnapshot,
  ProposalGroupBlockedReason,
  ProposalGroupDependency,
  ProposalGroupLifecycle,
  ProposalGroupMemberExecutionState,
  ProposalGroupMemberSnapshot,
  ProposalGroupSnapshot,
  ProposalGroupTerminalTimestamps,
} from 'src/generated';
import {
  type AnyTransactionClient,
  PrismaService,
} from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId } from 'src/types';
import { resolveProposalOutOfDateStatuses } from './proposal-response-policy';
import { toProposalResponseDto } from './proposal.types';
import { readProposalReviewedFutures } from './proposal-response-policy';
import { WorkItemTypeRegistryService } from '../tasks/work-item-type-registry.service';
import { parseProposalApprovalFailure } from './proposal-approval-failure-diagnostic';

export type ProposalGroupWithSnapshot = Prisma.ProposalGroupGetPayload<{
  include: {
    members: {
      orderBy: { memberOrder: 'asc' };
      include: {
        proposal: { include: { approvalRecords: true } };
      };
    };
    dependencies: true;
  };
}>;

@Injectable()
export class ProposalGroupService {
  private readonly logger = new Logger(ProposalGroupService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly workItemTypeRegistry?: WorkItemTypeRegistryService,
  ) {}

  async findOne(
    organizationId: OrganizationId,
    projectId: ProjectId,
    groupId: string,
  ): Promise<ProposalGroupSnapshot> {
    this.logger.log('Reading canonical proposal group', {
      organizationId,
      projectId,
      groupId,
    });

    const snapshot = await this.findOneInDb(
      this.prisma.db,
      organizationId,
      projectId,
      groupId,
    );
    if (snapshot.lifecycle === 'BUILDING') {
      throw new Error(
        'findOne is only valid for frozen proposal groups; use findCanonical for BUILDING groups',
      );
    }
    return snapshot as ProposalGroupSnapshot;
  }

  async findCanonical(
    organizationId: OrganizationId,
    projectId: ProjectId,
    groupId: string,
  ): Promise<ProposalGroupAuthoringSnapshot | ProposalGroupSnapshot> {
    return this.findOneInDb(this.prisma.db, organizationId, projectId, groupId);
  }

  async findOneInDb(
    db: AnyTransactionClient,
    organizationId: OrganizationId,
    projectId: ProjectId,
    groupId: string,
  ): Promise<ProposalGroupAuthoringSnapshot | ProposalGroupSnapshot> {
    const group = await db.proposalGroup.findFirst({
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

    if (!group) {
      this.logger.warn('Canonical proposal group not found in scope', {
        organizationId,
        projectId,
        groupId,
      });
      throw new NotFoundException('Proposal group not found');
    }

    const response =
      group.status === 'BUILDING'
        ? this.toAuthoringSnapshot(group)
        : await this.toSnapshot(group, db);
    this.logger.debug('Mapped canonical proposal group snapshot', {
      organizationId,
      projectId,
      groupId,
      lifecycle: response.lifecycle,
      revision: response.currentRevision,
      memberCount: response.members.length,
      dependencyCount:
        'dependencies' in response ? response.dependencies.length : undefined,
    });
    return response;
  }

  toAuthoringSnapshot(
    group: ProposalGroupWithSnapshot,
  ): ProposalGroupAuthoringSnapshot {
    const prerequisitesByMemberId = new Map<string, string[]>();
    for (const dependency of group.dependencies) {
      const current =
        prerequisitesByMemberId.get(dependency.dependentMemberId) ?? [];
      current.push(dependency.prerequisiteMemberId);
      prerequisitesByMemberId.set(dependency.dependentMemberId, current);
    }

    return {
      groupId: group.id,
      organizationId: group.organizationId as OrganizationId,
      projectId: group.projectId as ProjectId,
      lifecycle: 'BUILDING',
      currentRevision: group.revision,
      originatingConversationId:
        (group.conversationId as ProposalGroupAuthoringSnapshot['originatingConversationId']) ??
        undefined,
      originatingMessageId:
        (group.messageId as ProposalGroupAuthoringSnapshot['originatingMessageId']) ??
        undefined,
      members: group.members.map((member) => ({
        memberId: member.id,
        memberOrder: member.memberOrder,
        proposal: this.toAuthoringProposal(member.proposal),
        reservedEntityId: member.reservedTargetEntityId,
        // OpenAPI Generator represents uniqueItems arrays as Set<T>, while
        // the HTTP representation remains a JSON array.
        prerequisiteMemberIds: (prerequisitesByMemberId.get(member.id) ??
          []) as unknown as Set<string>,
      })),
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
    } satisfies ProposalGroupAuthoringSnapshot;
  }

  async toSnapshot(
    group: ProposalGroupWithSnapshot,
    db: AnyTransactionClient = this.prisma.db,
  ): Promise<ProposalGroupSnapshot> {
    const outOfDateStatuses = await resolveProposalOutOfDateStatuses(
      db,
      group.members.map((member) => member.proposal),
    );
    const memberById = new Map(
      group.members.map((member) => [member.id, member]),
    );
    const dependenciesByMemberId = new Map<string, ProposalGroupDependency[]>();
    const dependencies: ProposalGroupDependency[] = group.dependencies.map(
      (dependency) => {
        const mapped: ProposalGroupDependency = {
          dependentMemberId: dependency.dependentMemberId,
          prerequisiteMemberId: dependency.prerequisiteMemberId,
        };
        const current =
          dependenciesByMemberId.get(mapped.dependentMemberId) ?? [];
        dependenciesByMemberId.set(mapped.dependentMemberId, [
          ...current,
          mapped,
        ]);
        return mapped;
      },
    );

    const preparedMembers = group.members.map((member) => {
      const requiredApprovals = member.requiredApprovals;
      if (requiredApprovals === null) {
        throw new Error(
          `Proposal group member ${member.id} has no frozen approval requirement`,
        );
      }

      const { proposal: storedProposal, ...membership } = member;
      const outOfDateStatus = outOfDateStatuses.get(storedProposal.id);
      if (!outOfDateStatus) {
        throw new Error(
          `Missing out-of-date status for proposal ${storedProposal.id}`,
        );
      }
      const proposal = {
        ...storedProposal,
        groupMembership: {
          ...membership,
          group: {
            status: group.status,
            revision: group.revision,
            frozenRevision: group.frozenRevision,
          },
        },
      };
      return { member, proposal, requiredApprovals, outOfDateStatus };
    });
    const reviewedFuturesByProposalId = await readProposalReviewedFutures(
      db,
      this.workItemTypeRegistry,
      preparedMembers.map(({ proposal }) => proposal),
    );

    const members = preparedMembers.map(
      ({
        member,
        proposal,
        requiredApprovals,
        outOfDateStatus,
      }): ProposalGroupMemberSnapshot => {
        const reviewedProposal = toProposalResponseDto(
          proposal,
          requiredApprovals,
          reviewedFuturesByProposalId.get(proposal.id) ?? null,
          outOfDateStatus,
        );
        const approvalCount = reviewedProposal.approvals.filter(
          (record) => record.type === 'APPROVAL',
        ).length;
        const approvalProgress: ProposalGroupApprovalProgress = {
          receivedApprovals: approvalCount,
          requiredApprovals,
          approvalSatisfied: approvalCount >= requiredApprovals,
          approvalSatisfiedAt: this.toNullableIso(member.approvalSatisfiedAt),
        };

        const attempt = this.toAttempt(member);
        const terminalTimestamps = this.toTerminalTimestamps(member);
        const blockedReason = this.getBlockedReason(
          member.executionState,
          dependenciesByMemberId.get(member.id) ?? [],
          memberById,
        );

        return {
          memberId: member.id,
          memberOrder: member.memberOrder,
          proposal: reviewedProposal,
          reservedEntityId: member.reservedTargetEntityId ?? null,
          approvalProgress,
          executionState: member.executionState,
          dependencies: dependenciesByMemberId.get(member.id) ?? [],
          ...(blockedReason ? { blockedReason } : {}),
          ...(attempt ? { attempt } : {}),
          terminalTimestamps,
        };
      },
    );

    return {
      groupId: group.id,
      organizationId: group.organizationId as OrganizationId,
      projectId: group.projectId as ProjectId,
      lifecycle: group.status as ProposalGroupLifecycle,
      currentRevision: group.revision,
      frozenRevision: group.frozenRevision ?? null,
      frozenAt: this.toNullableIso(group.frozenAt),
      settledAt: this.toNullableIso(group.settledAt),
      originatingConversationId:
        (group.conversationId as ProposalGroupSnapshot['originatingConversationId']) ??
        undefined,
      originatingMessageId:
        (group.messageId as ProposalGroupSnapshot['originatingMessageId']) ??
        undefined,
      members,
      dependencies,
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
    };
  }

  private toAuthoringProposal(
    proposal: ProposalGroupWithSnapshot['members'][number]['proposal'],
  ): CreateProposalDto {
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

  private toAttempt(
    member: ProposalGroupWithSnapshot['members'][number],
  ): ProposalGroupAttempt | undefined {
    if (
      member.attemptCount === 0 &&
      member.attemptId === null &&
      member.startedAt === null &&
      member.completedAt === null &&
      member.lastAttemptedAt === null &&
      member.lastError === null
    ) {
      return undefined;
    }

    const persistedFailure = parseProposalApprovalFailure(member.lastError);
    return {
      attemptCount: member.attemptCount,
      attemptId: member.attemptId,
      startedAt: this.toNullableIso(member.startedAt),
      completedAt: this.toNullableIso(member.completedAt),
      lastAttemptedAt: this.toNullableIso(member.lastAttemptedAt),
      lastError: persistedFailure?.message ?? member.lastError,
      ...(persistedFailure?.diagnostic
        ? { diagnostic: persistedFailure.diagnostic }
        : {}),
    };
  }

  private toTerminalTimestamps(
    member: ProposalGroupWithSnapshot['members'][number],
  ): ProposalGroupTerminalTimestamps {
    return {
      appliedAt: this.toNullableIso(member.appliedAt),
      rejectedAt: this.toNullableIso(member.rejectedAt),
      invalidatedAt: this.toNullableIso(member.invalidatedAt),
      failedAt: this.toNullableIso(member.failedAt),
    };
  }

  private getBlockedReason(
    executionState: ProposalGroupMemberExecutionState,
    dependencies: ProposalGroupDependency[],
    memberById: ReadonlyMap<
      string,
      ProposalGroupWithSnapshot['members'][number]
    >,
  ): ProposalGroupBlockedReason | undefined {
    if (executionState === 'PENDING_APPROVAL') {
      return 'APPROVALS_PENDING';
    }
    if (executionState === 'RETRYABLE_FAILURE') {
      return 'RETRYABLE_FAILURE';
    }
    if (executionState !== 'WAITING_ON_DEPENDENCIES') {
      return undefined;
    }

    const prerequisiteStates = dependencies.map((dependency) => {
      const prerequisite = memberById.get(dependency.prerequisiteMemberId);
      if (!prerequisite) {
        throw new Error(
          `Proposal group dependency ${dependency.prerequisiteMemberId} is missing its prerequisite member`,
        );
      }
      return prerequisite.executionState;
    });

    if (prerequisiteStates.includes('REJECTED')) {
      return 'PREREQUISITE_REJECTED';
    }
    if (prerequisiteStates.includes('INVALIDATED')) {
      return 'PREREQUISITE_INVALIDATED';
    }
    if (prerequisiteStates.includes('FAILED')) {
      return 'PREREQUISITE_FAILED';
    }
    return 'DEPENDENCIES_PENDING';
  }

  private toNullableIso(value: Date | null): string | null {
    return value?.toISOString() ?? null;
  }
}
