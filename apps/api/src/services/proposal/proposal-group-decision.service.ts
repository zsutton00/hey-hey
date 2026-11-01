import { assertProposalApplicationEligible } from './proposal-application-eligibility';
import { ProposalReconciliationService } from './proposal-reconciliation.service';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  Prisma,
  ProposalApprovalType,
  type ProposalGroupMemberExecutionState,
} from '@prisma/client';
import type {
  ProposalGroupApproveAllMemberResult,
  ProposalGroupApproveAllResult,
} from 'src/generated';
import { AnyTransactionClient, PrismaService } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId, ProposalId, UserId } from 'src/types';
import { evaluatePermissions } from './permission-evaluation';
import { resolvePermissionEvaluationContext } from './permission-evaluation-context';
import { deriveProposalSourceContext } from './proposal-response-policy';
import { ProposalGroupCoordinatorService } from './proposal-group-coordinator.service';
import { ProposalGroupLifecycleEventService } from './proposal-group-lifecycle-event.service';
import { ProjectAccessService } from 'src/auth/services/project-access.service';
import {
  proposalApprovalFailureMessage,
  toProposalApprovalFailureDiagnostic,
} from './proposal-approval-failure-diagnostic';
import {
  ProjectApprovalPolicyService,
  type ProjectApprovalPolicy,
} from './project-approval-policy.service';
import { WorkItemTypeRegistryService } from '../tasks/work-item-type-registry.service';

const APPROVAL_ACTIONABLE_STATES = new Set<ProposalGroupMemberExecutionState>([
  'PENDING_APPROVAL',
  'WAITING_ON_DEPENDENCIES',
]);

const REJECTION_ACTIONABLE_STATES = new Set<ProposalGroupMemberExecutionState>([
  'PENDING_APPROVAL',
  'WAITING_ON_DEPENDENCIES',
  'READY',
  'RETRYABLE_FAILURE',
]);

type DecisionMember = Prisma.ProposalGroupMemberGetPayload<{
  include: {
    group: true;
    proposal: true;
    dependenciesAsDependent: { include: { prerequisiteMember: true } };
  };
}>;

interface BuiltDecisionResult {
  groupId: string;
  revision: number;
  proposalId: string;
  result: ProposalGroupApproveAllMemberResult;
}

export interface GroupedDecisionResult {
  result: ProposalGroupApproveAllMemberResult;
  proposalId: string;
  recorded: boolean;
}

@Injectable()
export class ProposalGroupDecisionService {
  private readonly logger = new Logger(ProposalGroupDecisionService.name);

  async invalidateFutureRefinementsInTransaction(
    tx: AnyTransactionClient,
    organizationId: OrganizationId,
    projectId: ProjectId,
    proposalIds: string[],
  ): Promise<void> {
    const coordinator = this.moduleRef.get(ProposalGroupCoordinatorService, {
      strict: false,
    });
    await coordinator.invalidateFutureRefinementsInTransaction(
      tx as Prisma.TransactionClient,
      organizationId,
      projectId,
      proposalIds,
    );
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycleEvents: ProposalGroupLifecycleEventService,
    private readonly moduleRef: ModuleRef,
    private readonly projectApprovalPolicyService: ProjectApprovalPolicyService,
    private readonly projectAccess: ProjectAccessService,
    @Optional()
    @Inject(WorkItemTypeRegistryService)
    private readonly workItemTypeRegistry:
      | WorkItemTypeRegistryService
      | undefined,
    private readonly reconciliation: ProposalReconciliationService,
  ) {}

  async approve(
    params: {
      proposalId: string;
      organizationId: OrganizationId;
      projectId: ProjectId;
      userId: UserId;
    },
    projectPolicy?: ProjectApprovalPolicy,
  ): Promise<GroupedDecisionResult> {
    const resolvedProjectPolicy =
      projectPolicy ??
      (await this.projectApprovalPolicyService.resolve(params.projectId));
    const committed = await this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT proposal."id"
        FROM "proposals" AS proposal
        INNER JOIN "proposal_group_members" AS member
          ON member."proposal_id" = proposal."id"
        WHERE proposal."id" = ${params.proposalId}
          AND proposal."organization_id" = ${params.organizationId}
          AND proposal."project_id" = ${params.projectId}
        FOR UPDATE OF proposal, member
      `;
      const member = await tx.proposalGroupMember.findFirst({
        where: {
          proposalId: params.proposalId,
          group: {
            organizationId: params.organizationId,
            projectId: params.projectId,
          },
        },
        include: {
          group: true,
          proposal: true,
          dependenciesAsDependent: { include: { prerequisiteMember: true } },
        },
      });
      if (!member) throw new NotFoundException('Grouped proposal not found');
      assertProposalApplicationEligible(
        member.proposal,
        'groupDecision.approve',
      );
      if (
        member.group.status !== 'REVIEWABLE' ||
        member.group.frozenRevision !== member.group.revision
      ) {
        throw new ConflictException(
          'Proposal group is not at its frozen review revision',
        );
      }
      if (member.proposal.targetEntityType === 'WORK_ITEM_TYPE') {
        await this.projectAccess.assertProjectRole(
          params.projectId,
          params.userId,
          'manageWorkItemTypes',
        );
      }
      const existing = await tx.proposalApprovalRecord.findUnique({
        where: {
          proposalId_userId: {
            proposalId: member.proposalId,
            userId: params.userId,
          },
        },
      });
      if (existing) {
        return this.buildResult(
          member,
          existing.type === ProposalApprovalType.APPROVAL
            ? 'ALREADY_APPROVED'
            : 'ALREADY_REJECTED',
          await this.approvalCount(tx, member.proposalId),
        );
      }
      if (!APPROVAL_ACTIONABLE_STATES.has(member.executionState)) {
        return this.buildResult(
          member,
          'ALREADY_TERMINAL',
          await this.approvalCount(tx, member.proposalId),
        );
      }
      if (member.requiredApprovals === null) {
        throw new ConflictException(
          'Frozen member is missing its approval requirement',
        );
      }

      const context = await resolvePermissionEvaluationContext(
        tx,
        params.organizationId,
        params.projectId,
        member.proposal,
        deriveProposalSourceContext(member.proposal),
        this.workItemTypeRegistry,
      );
      const policy = evaluatePermissions(
        context.entity,
        context.proposal,
        resolvedProjectPolicy,
      );
      if (!context.proposal.eligibleProjectMemberIds.includes(params.userId)) {
        this.logger.warn('Rejected ineligible grouped proposal approval', {
          groupId: member.groupId,
          memberId: member.id,
          proposalId: member.proposalId,
          userId: params.userId,
        });
        return this.buildResult(
          member,
          'NOT_ELIGIBLE',
          await this.approvalCount(tx, member.proposalId),
        );
      }
      if (
        context.proposal.source === 'user' &&
        member.proposal.requestorId === params.userId &&
        !policy.allowsProposerApproval
      ) {
        this.logger.warn('Rejected disallowed grouped proposer approval', {
          groupId: member.groupId,
          memberId: member.id,
          proposalId: member.proposalId,
          userId: params.userId,
        });
        return this.buildResult(
          member,
          'NOT_ELIGIBLE',
          await this.approvalCount(tx, member.proposalId),
        );
      }

      await this.reconciliation.assertApplicable(tx, member.proposal);
      await tx.proposalApprovalRecord.create({
        data: {
          proposalId: member.proposalId,
          userId: params.userId,
          type: ProposalApprovalType.APPROVAL,
        },
      });
      const receivedApprovals = await this.approvalCount(tx, member.proposalId);
      const approvalSatisfied = receivedApprovals >= member.requiredApprovals;
      const dependencyReady = member.dependenciesAsDependent.every(
        (dependency) =>
          dependency.prerequisiteMember.executionState === 'APPLIED',
      );
      if (approvalSatisfied) {
        await tx.proposalGroupMember.update({
          where: { id: member.id },
          data: {
            approvalSatisfiedAt: member.approvalSatisfiedAt ?? new Date(),
            executionState: dependencyReady
              ? 'READY'
              : 'WAITING_ON_DEPENDENCIES',
          },
        });
        member.approvalSatisfiedAt ??= new Date();
        member.executionState = dependencyReady
          ? 'READY'
          : 'WAITING_ON_DEPENDENCIES';
      }
      this.logger.log('Recorded isolated grouped proposal approval', {
        groupId: member.groupId,
        memberId: member.id,
        proposalId: member.proposalId,
        receivedApprovals,
        requiredApprovals: member.requiredApprovals,
        approvalSatisfied,
        dependencyReady,
      });
      await this.lifecycleEvents.publishInTransaction(tx, {
        organizationId: params.organizationId,
        projectId: params.projectId,
        groupId: member.groupId,
        revision: member.group.revision,
        changedMemberIds: [member.id],
      });
      return this.buildResult(
        member,
        'APPROVAL_RECORDED',
        receivedApprovals,
        true,
      );
    });

    if (
      committed.recorded &&
      committed.result.outcome === 'APPROVAL_RECORDED' &&
      committed.result.executionState === 'READY'
    ) {
      await this.moduleRef
        .get(ProposalGroupCoordinatorService, { strict: false })
        .dispatchReadyMembers({
          memberIds: [committed.result.memberId],
          organizationId: params.organizationId,
          projectId: params.projectId,
        });
    }
    if (
      committed.result.outcome === 'ALREADY_APPROVED' &&
      ['READY', 'RETRYABLE_FAILURE', 'APPLYING'].includes(
        committed.result.executionState,
      )
    ) {
      const coordinator = this.moduleRef.get(ProposalGroupCoordinatorService, {
        strict: false,
      });
      if (committed.result.executionState === 'READY') {
        await coordinator.dispatchReadyMembers({
          memberIds: [committed.result.memberId],
          organizationId: params.organizationId,
          projectId: params.projectId,
        });
      } else {
        await coordinator.retrySelectedMember({
          memberId: committed.result.memberId,
          organizationId: params.organizationId,
          projectId: params.projectId,
        });
      }
    }

    return {
      result: committed.result,
      proposalId: committed.proposalId,
      recorded: committed.recorded,
    };
  }

  async reject(
    params: {
      proposalId: string;
      organizationId: OrganizationId;
      projectId: ProjectId;
      userId: UserId;
      reason?: string;
    },
    projectPolicy?: ProjectApprovalPolicy,
  ): Promise<GroupedDecisionResult> {
    const resolvedProjectPolicy =
      projectPolicy ??
      (await this.projectApprovalPolicyService.resolve(params.projectId));
    const committed = await this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT proposal."id"
        FROM "proposals" AS proposal
        INNER JOIN "proposal_group_members" AS member
          ON member."proposal_id" = proposal."id"
        WHERE proposal."id" = ${params.proposalId}
          AND proposal."organization_id" = ${params.organizationId}
          AND proposal."project_id" = ${params.projectId}
        FOR UPDATE OF proposal, member
      `;
      const member = await tx.proposalGroupMember.findFirst({
        where: {
          proposalId: params.proposalId,
          group: {
            organizationId: params.organizationId,
            projectId: params.projectId,
          },
        },
        include: {
          group: true,
          proposal: true,
          dependenciesAsDependent: { include: { prerequisiteMember: true } },
        },
      });
      if (!member) throw new NotFoundException('Grouped proposal not found');
      if (
        member.group.status !== 'REVIEWABLE' ||
        member.group.frozenRevision !== member.group.revision
      ) {
        throw new ConflictException(
          'Proposal group is not at its frozen review revision',
        );
      }
      const existing = await tx.proposalApprovalRecord.findUnique({
        where: {
          proposalId_userId: {
            proposalId: member.proposalId,
            userId: params.userId,
          },
        },
      });
      if (existing) {
        return this.buildResult(
          member,
          existing.type === ProposalApprovalType.APPROVAL
            ? 'ALREADY_APPROVED'
            : 'ALREADY_REJECTED',
          await this.approvalCount(tx, member.proposalId),
        );
      }
      if (!REJECTION_ACTIONABLE_STATES.has(member.executionState)) {
        return this.buildResult(
          member,
          'ALREADY_TERMINAL',
          await this.approvalCount(tx, member.proposalId),
        );
      }
      const normalizedReason = params.reason?.trim() || null;
      if (member.proposal.action !== 'CREATE' && normalizedReason === null) {
        throw new BadRequestException(
          'A reason is required when rejecting an UPDATE or DELETE proposal',
        );
      }
      const context = await resolvePermissionEvaluationContext(
        tx,
        params.organizationId,
        params.projectId,
        member.proposal,
        deriveProposalSourceContext(member.proposal),
        this.workItemTypeRegistry,
      );
      const policy = evaluatePermissions(
        context.entity,
        context.proposal,
        resolvedProjectPolicy,
      );
      if (
        !context.proposal.eligibleProjectMemberIds.includes(params.userId) ||
        (context.proposal.source === 'user' &&
          member.proposal.requestorId === params.userId &&
          !policy.allowsProposerApproval)
      ) {
        this.logger.warn('Rejected ineligible grouped proposal rejection', {
          groupId: member.groupId,
          memberId: member.id,
          proposalId: member.proposalId,
          userId: params.userId,
        });
        return this.buildResult(
          member,
          'NOT_ELIGIBLE',
          await this.approvalCount(tx, member.proposalId),
        );
      }
      try {
        await tx.proposalApprovalRecord.create({
          data: {
            proposalId: member.proposalId,
            userId: params.userId,
            type: ProposalApprovalType.REJECTION,
            reason: normalizedReason,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException(
            'User has already recorded a decision on this proposal',
          );
        }
        throw error;
      }
      const now = new Date();
      await tx.proposal.update({
        where: { id: member.proposalId },
        data: { status: 'REJECTED' },
      });
      await tx.proposalGroupMember.update({
        where: { id: member.id },
        data: {
          executionState: 'REJECTED',
          rejectedAt: now,
          completedAt: now,
          terminalReason: normalizedReason,
          claimToken: null,
          leaseExpiresAt: null,
        },
      });
      member.executionState = 'REJECTED';
      this.logger.log('Recorded isolated grouped proposal rejection', {
        groupId: member.groupId,
        memberId: member.id,
        proposalId: member.proposalId,
      });
      await this.lifecycleEvents.publishInTransaction(tx, {
        organizationId: params.organizationId,
        projectId: params.projectId,
        groupId: member.groupId,
        revision: member.group.revision,
        changedMemberIds: [member.id],
      });
      return this.buildResult(
        member,
        'ALREADY_REJECTED',
        await this.approvalCount(tx, member.proposalId),
        true,
      );
    });

    if (committed.result.executionState === 'REJECTED') {
      const coordinator = this.moduleRef.get(ProposalGroupCoordinatorService, {
        strict: false,
      });
      await coordinator.propagateTerminalImpossibility({
        sourceMemberId: committed.result.memberId,
        organizationId: params.organizationId,
        projectId: params.projectId,
      });
    }
    return {
      result: committed.result,
      proposalId: committed.proposalId,
      recorded: committed.recorded,
    };
  }

  async approveAll(params: {
    groupId: string;
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
  }): Promise<ProposalGroupApproveAllResult> {
    const group = await this.prisma.db.proposalGroup.findFirst({
      where: {
        id: params.groupId,
        organizationId: params.organizationId,
        projectId: params.projectId,
      },
      include: {
        members: { orderBy: [{ memberOrder: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!group) throw new NotFoundException('Proposal group not found');
    if (
      group.status !== 'REVIEWABLE' ||
      group.frozenRevision !== group.revision
    ) {
      throw new ConflictException(
        'Proposal group is not at its frozen review revision',
      );
    }
    const projectPolicy = await this.projectApprovalPolicyService.resolve(
      params.projectId,
    );
    const results: ProposalGroupApproveAllMemberResult[] = [];
    for (const member of group.members) {
      try {
        results.push(
          (
            await this.approve(
              { ...params, proposalId: member.proposalId },
              projectPolicy,
            )
          ).result,
        );
      } catch (error) {
        results.push(
          await this.buildFailedAttemptResult({
            memberId: member.id,
            proposalId: member.proposalId,
            organizationId: params.organizationId,
            projectId: params.projectId,
            error,
          }),
        );
      }
    }
    return { groupId: group.id, revision: group.revision, results };
  }

  private async buildFailedAttemptResult(params: {
    memberId: string;
    proposalId: string;
    organizationId: OrganizationId;
    projectId: ProjectId;
    error: unknown;
  }): Promise<ProposalGroupApproveAllMemberResult> {
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT proposal."id"
        FROM "proposals" AS proposal
        INNER JOIN "proposal_group_members" AS member
          ON member."proposal_id" = proposal."id"
        WHERE member."id" = ${params.memberId}
          AND proposal."id" = ${params.proposalId}
          AND proposal."organization_id" = ${params.organizationId}
          AND proposal."project_id" = ${params.projectId}
        FOR UPDATE OF proposal, member
      `;
      const member = await tx.proposalGroupMember.findFirst({
        where: {
          id: params.memberId,
          proposalId: params.proposalId,
          group: {
            organizationId: params.organizationId,
            projectId: params.projectId,
          },
        },
        include: {
          group: true,
          proposal: true,
          dependenciesAsDependent: {
            include: { prerequisiteMember: true },
          },
        },
      });
      if (!member) {
        throw new ConflictException(
          'Unable to load authoritative state for failed grouped approval',
        );
      }

      return {
        ...this.buildResult(
          member,
          'FAILED',
          await this.approvalCount(tx, member.proposalId),
        ).result,
        message: proposalApprovalFailureMessage(params.error),
        diagnostic: toProposalApprovalFailureDiagnostic(params.error),
      };
    });
  }

  private async approvalCount(
    tx: AnyTransactionClient,
    proposalId: string,
  ): Promise<number> {
    const approvalRecords = tx.proposalApprovalRecord as unknown as {
      count(args: Prisma.ProposalApprovalRecordCountArgs): Promise<number>;
    };
    return approvalRecords.count({
      where: { proposalId, type: ProposalApprovalType.APPROVAL },
    });
  }

  private buildResult(
    member: DecisionMember,
    outcome: ProposalGroupApproveAllMemberResult['outcome'],
    receivedApprovals: number,
    recorded = false,
  ): BuiltDecisionResult & { recorded: boolean } {
    if (member.requiredApprovals === null) {
      throw new ConflictException(
        'Frozen member is missing its approval requirement',
      );
    }
    const approvalSatisfied =
      member.approvalSatisfiedAt !== null ||
      receivedApprovals >= member.requiredApprovals;
    const dependencyReady = member.dependenciesAsDependent.every(
      (dependency) =>
        dependency.prerequisiteMember.executionState === 'APPLIED',
    );
    return {
      groupId: member.groupId,
      revision: member.group.revision,
      proposalId: member.proposalId,
      recorded,
      result: {
        memberId: member.id,
        proposalId: member.proposalId as ProposalId,
        outcome,
        receivedApprovals,
        requiredApprovals: member.requiredApprovals,
        approvalSatisfied,
        dependencyReady,
        executionState: member.executionState,
        ...(!approvalSatisfied
          ? { blockedReason: 'APPROVALS_PENDING' as const }
          : !dependencyReady
            ? { blockedReason: 'DEPENDENCIES_PENDING' as const }
            : {}),
      } satisfies ProposalGroupApproveAllMemberResult,
    };
  }
}
