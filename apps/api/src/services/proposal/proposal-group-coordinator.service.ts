import {
  BadRequestException,
  ConflictException,
  forwardRef,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma, type ProposalGroupMemberExecutionState } from '@prisma/client';
import {
  type AnyTransactionClient,
  PrismaService,
} from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId } from 'src/types';
import { ProposalApprovalService } from './proposal-approval.service';
import { ProposalGroupLifecycleEventService } from './proposal-group-lifecycle-event.service';
import {
  proposalApprovalFailureMessage,
  serializeProposalApprovalFailure,
  toProposalApprovalFailureDiagnostic,
  type PersistedProposalApprovalFailure,
} from './proposal-approval-failure-diagnostic';

const TERMINAL_STATES: ProposalGroupMemberExecutionState[] = [
  'APPLIED',
  'REJECTED',
  'INVALIDATED',
  'FAILED',
];
const IMPOSSIBLE_STATES: ProposalGroupMemberExecutionState[] = [
  'REJECTED',
  'INVALIDATED',
  'FAILED',
];

type FailureClassification = 'RETRYABLE' | 'PERMANENT';

export interface ProposalGroupMemberClaim {
  id: string;
  groupId: string;
  proposalId: string;
  organizationId: string;
  projectId: string;
  priorExecutionState:
    | 'READY'
    | 'WAITING_ON_DEPENDENCIES'
    | 'RETRYABLE_FAILURE'
    | 'APPLYING';
  attemptId: string;
  attemptCount: number;
  claimToken: string;
  leaseExpiresAt: Date;
  reservedTargetEntityId: string | null;
}

interface InvalidatedMemberRow {
  id: string;
}

@Injectable()
export class ProposalGroupCoordinatorService {
  private readonly logger = new Logger(ProposalGroupCoordinatorService.name);
  private readonly leaseDurationMs = 5 * 60_000;
  private readonly leaseRenewalMs = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ProposalApprovalService))
    private readonly proposalApprovalService: ProposalApprovalService,
    @Optional()
    private readonly lifecycleEvents?: ProposalGroupLifecycleEventService,
  ) {}

  async dispatchReadyMembers(params: {
    memberIds: readonly string[];
    organizationId: OrganizationId;
    projectId: ProjectId;
  }): Promise<void> {
    for (const memberId of params.memberIds) {
      await this.enactSelectedMember({
        memberId,
        organizationId: params.organizationId,
        projectId: params.projectId,
        mode: 'READY',
      });
    }
  }

  async retrySelectedMember(params: {
    memberId: string;
    organizationId: OrganizationId;
    projectId: ProjectId;
  }): Promise<void> {
    await this.enactSelectedMember({ ...params, mode: 'EXPLICIT_RETRY' });
  }

  private async enactSelectedMember(params: {
    memberId: string;
    organizationId: OrganizationId;
    projectId: ProjectId;
    mode: 'READY' | 'EXPLICIT_RETRY';
  }): Promise<void> {
    const claim = await this.claimSelectedMember(params);
    if (!claim) {
      if (params.mode === 'READY') {
        this.logger.debug(
          'Selected proposal group member was no longer READY',
          {
            memberId: params.memberId,
            organizationId: params.organizationId,
            projectId: params.projectId,
          },
        );
        return;
      }
      throw new ConflictException(
        'The selected grouped proposal is not ready for explicit retry.',
      );
    }
    await this.executeClaim(claim);
  }

  private async claimSelectedMember(params: {
    memberId: string;
    organizationId: OrganizationId;
    projectId: ProjectId;
    mode: 'READY' | 'EXPLICIT_RETRY';
  }): Promise<ProposalGroupMemberClaim | null> {
    const statePredicate =
      params.mode === 'READY'
        ? Prisma.sql`member."execution_state" = 'READY'`
        : Prisma.sql`
          (
            member."execution_state" = 'RETRYABLE_FAILURE'
            OR (
              member."execution_state" = 'APPLYING'
              AND member."lease_expires_at" IS NOT NULL
              AND member."lease_expires_at" <= CURRENT_TIMESTAMP
            )
        )`;
    const approvalPredicate =
      params.mode === 'READY'
        ? Prisma.sql`TRUE`
        : Prisma.sql`member."approval_satisfied_at" IS NOT NULL`;
    const claims = await this.prisma.db.$queryRaw<ProposalGroupMemberClaim[]>(
      Prisma.sql`
        WITH candidate AS (
          SELECT
            member."id",
            member."execution_state"::text AS "priorExecutionState",
            group_record."organization_id" AS "organizationId",
            group_record."project_id" AS "projectId"
          FROM "proposal_group_members" AS member
          INNER JOIN "proposal_groups" AS group_record
            ON group_record."id" = member."group_id"
          WHERE member."id" = ${params.memberId}
            AND group_record."organization_id" = ${params.organizationId}
            AND group_record."project_id" = ${params.projectId}
            AND group_record."status" = 'REVIEWABLE'
            AND ${approvalPredicate}
            AND ${statePredicate}
            AND NOT EXISTS (
              SELECT 1
              FROM "proposal_group_dependencies" AS dependency
              INNER JOIN "proposal_group_members" AS prerequisite
                ON prerequisite."group_id" = dependency."group_id"
                AND prerequisite."id" = dependency."prerequisite_member_id"
              WHERE dependency."group_id" = member."group_id"
                AND dependency."dependent_member_id" = member."id"
                AND prerequisite."execution_state" <> 'APPLIED'
            )
          FOR UPDATE OF member SKIP LOCKED
        )
        UPDATE "proposal_group_members" AS member
        SET
          "execution_state" = 'APPLYING',
          "attempt_id" = CASE
            WHEN candidate."priorExecutionState" = 'APPLYING'
              THEN member."attempt_id"
            ELSE gen_random_uuid()::text
          END,
          "attempt_count" = CASE
            WHEN candidate."priorExecutionState" = 'APPLYING'
              THEN member."attempt_count"
            ELSE member."attempt_count" + 1
          END,
          "started_at" = CASE
            WHEN candidate."priorExecutionState" = 'APPLYING'
              THEN member."started_at"
            ELSE CURRENT_TIMESTAMP
          END,
          "last_attempted_at" = CURRENT_TIMESTAMP,
          "claim_token" = gen_random_uuid()::text,
          "lease_expires_at" =
            CURRENT_TIMESTAMP + ${this.leaseDurationMs} * INTERVAL '1 millisecond',
          "updated_at" = CURRENT_TIMESTAMP
        FROM candidate
        WHERE member."id" = candidate."id"
        RETURNING
          member."id",
          member."group_id" AS "groupId",
          member."proposal_id" AS "proposalId",
          candidate."organizationId",
          candidate."projectId",
          candidate."priorExecutionState",
          member."attempt_id" AS "attemptId",
          member."attempt_count" AS "attemptCount",
          member."claim_token" AS "claimToken",
          member."lease_expires_at" AS "leaseExpiresAt",
          member."reserved_target_entity_id" AS "reservedTargetEntityId"
      `,
    );

    const claim = claims[0] ?? null;
    if (!claim) return null;

    this.logger.log('Claimed selected proposal group member for enactment', {
      groupId: claim.groupId,
      memberId: claim.id,
      proposalId: claim.proposalId,
      attemptId: claim.attemptId,
      attemptCount: claim.attemptCount,
      priorExecutionState: claim.priorExecutionState,
      leaseExpiresAt: claim.leaseExpiresAt,
      mode: params.mode,
    });
    return claim;
  }

  async executeClaim(claim: ProposalGroupMemberClaim): Promise<void> {
    const current = await this.validateFrozenClaim(claim);
    if (!current) return;

    const renewed = await this.renewClaim(claim);
    if (!renewed) {
      this.logLostFence(claim, 'before enactment');
      return;
    }

    let heartbeatRunning = false;
    const heartbeat = setInterval(() => {
      if (heartbeatRunning) return;
      heartbeatRunning = true;
      void this.renewClaim(claim)
        .then((stillOwned) => {
          if (!stillOwned) this.logLostFence(claim, 'during enactment');
        })
        .catch((error: unknown) => {
          this.logger.error('Failed to renew proposal group member lease', {
            groupId: claim.groupId,
            memberId: claim.id,
            attemptId: claim.attemptId,
            error: this.errorMessage(error),
          });
        })
        .finally(() => {
          heartbeatRunning = false;
        });
    }, this.leaseRenewalMs);
    heartbeat.unref();

    try {
      this.logger.log('Enacting claimed proposal group member', {
        groupId: claim.groupId,
        memberId: claim.id,
        proposalId: claim.proposalId,
        attemptId: claim.attemptId,
        reservedTargetEntityId: claim.reservedTargetEntityId,
      });
      const enactment = await this.proposalApprovalService.enactGroupedMember({
        memberId: claim.id,
        organizationId: claim.organizationId as OrganizationId,
        projectId: claim.projectId as ProjectId,
      });
      if (!enactment.enacted) {
        await this.recordReady(claim);
        return;
      }
      const readyMemberIds = await this.recordApplied(claim);
      await this.dispatchReadyMembers({
        memberIds: readyMemberIds,
        organizationId: claim.organizationId as OrganizationId,
        projectId: claim.projectId as ProjectId,
      });
    } catch (error) {
      const failure: PersistedProposalApprovalFailure = {
        message: proposalApprovalFailureMessage(error),
        diagnostic: toProposalApprovalFailureDiagnostic(error),
      };
      await this.recordFailure(claim, error, failure);
      if (error instanceof HttpException && error.getStatus() === 409)
        throw error;
      throw error instanceof HttpException
        ? new HttpException(failure, error.getStatus())
        : new InternalServerErrorException(failure);
    } finally {
      clearInterval(heartbeat);
    }
  }

  async invalidateFutureRefinementsInTransaction(
    tx: Prisma.TransactionClient,
    organizationId: OrganizationId,
    projectId: ProjectId,
    proposalIds: string[],
  ): Promise<void> {
    const members = await tx.proposalGroupMember.findMany({
      where: {
        proposalId: { in: proposalIds },
        group: { organizationId, projectId },
      },
      select: { id: true, groupId: true },
    });
    const now = new Date();
    for (const member of members) {
      await tx.proposalGroupMember.update({
        where: { id: member.id },
        data: {
          executionState: 'INVALIDATED',
          invalidatedAt: now,
          terminalReason:
            'Future applied with confirmed refinement invalidation.',
        },
      });
      const dependentIds = await this.invalidateImpossibleDependents(
        tx,
        member.id,
        member.groupId,
        now,
      );
      await this.settleIfTerminal(tx, member.groupId, now);
      await this.publishLifecycleInTransaction(
        tx,
        organizationId,
        projectId,
        member.id,
        [member.id, ...dependentIds],
      );
    }
  }

  async propagateTerminalImpossibility(params: {
    sourceMemberId: string;
    organizationId: OrganizationId;
    projectId: ProjectId;
  }): Promise<number> {
    const invalidated = await this.prisma.db.$transaction(async (tx) => {
      const source = await tx.proposalGroupMember.findFirst({
        where: {
          id: params.sourceMemberId,
          group: {
            organizationId: params.organizationId,
            projectId: params.projectId,
          },
        },
        select: { id: true, groupId: true, executionState: true },
      });
      if (!source)
        throw new NotFoundException('Proposal group member not found');
      if (!IMPOSSIBLE_STATES.includes(source.executionState)) {
        throw new ConflictException(
          `Cannot propagate terminal impossibility from ${source.executionState}.`,
        );
      }

      const invalidatedMemberIds = await this.invalidateImpossibleDependents(
        tx as unknown as Prisma.TransactionClient,
        source.id,
        source.groupId,
        new Date(),
      );
      await this.settleIfTerminal(
        tx as unknown as Prisma.TransactionClient,
        source.groupId,
        new Date(),
      );
      await this.publishLifecycleInTransaction(
        tx,
        params.organizationId,
        params.projectId,
        source.id,
        [source.id, ...invalidatedMemberIds],
      );
      return invalidatedMemberIds.length;
    });
    return invalidated;
  }

  classifyFailure(error: unknown): FailureClassification {
    if (
      error instanceof BadRequestException ||
      error instanceof ConflictException ||
      error instanceof NotFoundException ||
      error instanceof Prisma.PrismaClientValidationError
    ) {
      return 'PERMANENT';
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return [
        'P2000',
        'P2002',
        'P2003',
        'P2004',
        'P2011',
        'P2014',
        'P2025',
      ].includes(error.code)
        ? 'PERMANENT'
        : 'RETRYABLE';
    }
    return 'RETRYABLE';
  }

  private async validateFrozenClaim(
    claim: ProposalGroupMemberClaim,
  ): Promise<boolean> {
    const member = await this.prisma.db.proposalGroupMember.findFirst({
      where: {
        id: claim.id,
        groupId: claim.groupId,
        group: {
          organizationId: claim.organizationId,
          projectId: claim.projectId,
        },
      },
      include: {
        group: true,
        dependenciesAsDependent: {
          include: { prerequisiteMember: true },
        },
      },
    });

    const invalidReason = !member
      ? 'member missing from frozen group'
      : member.group.status !== 'REVIEWABLE'
        ? `group is ${member.group.status}`
        : member.executionState !== 'APPLYING'
          ? `member is ${member.executionState}`
          : member.attemptId !== claim.attemptId ||
              member.claimToken !== claim.claimToken
            ? 'claim fence changed'
            : member.approvalSatisfiedAt === null
              ? 'approval is not satisfied'
              : member.dependenciesAsDependent.some(
                    (dependency) =>
                      dependency.prerequisiteMember.executionState !==
                      'APPLIED',
                  )
                ? 'not all prerequisites are applied'
                : null;

    if (!invalidReason) return true;
    this.logger.warn(
      'Rejected proposal group enactment claim during revalidation',
      {
        groupId: claim.groupId,
        memberId: claim.id,
        attemptId: claim.attemptId,
        reason: invalidReason,
      },
    );

    if (
      member &&
      member.executionState === 'APPLYING' &&
      member.attemptId === claim.attemptId &&
      member.claimToken === claim.claimToken &&
      (member.approvalSatisfiedAt === null ||
        member.dependenciesAsDependent.some(
          (dependency) =>
            dependency.prerequisiteMember.executionState !== 'APPLIED',
        ))
    ) {
      await this.prisma.db.proposalGroupMember.updateMany({
        where: this.claimFenceWhere(claim),
        data: {
          executionState:
            member.approvalSatisfiedAt === null
              ? 'PENDING_APPROVAL'
              : 'WAITING_ON_DEPENDENCIES',
          claimToken: null,
          leaseExpiresAt: null,
        },
      });
    }
    return false;
  }

  private async renewClaim(claim: ProposalGroupMemberClaim): Promise<boolean> {
    const renewedAt = new Date();
    const result = await this.prisma.db.proposalGroupMember.updateMany({
      where: this.claimFenceWhere(claim),
      data: {
        leaseExpiresAt: new Date(renewedAt.getTime() + this.leaseDurationMs),
      },
    });
    return result.count === 1;
  }

  private async recordApplied(
    claim: ProposalGroupMemberClaim,
  ): Promise<string[]> {
    return this.prisma.db.$transaction(async (tx) => {
      const completedAt = new Date();
      const applied = await tx.proposalGroupMember.updateMany({
        where: this.claimFenceWhere(claim),
        data: {
          executionState: 'APPLIED',
          completedAt,
          appliedAt: completedAt,
          lastError: null,
          terminalReason: null,
          claimToken: null,
          leaseExpiresAt: null,
        },
      });
      if (applied.count !== 1) {
        this.logLostFence(claim, 'while recording APPLIED');
        return [];
      }

      const readyMemberIds = await this.wakeDirectDependents(
        tx as unknown as Prisma.TransactionClient,
        claim.id,
        claim.groupId,
        completedAt,
      );
      await this.settleIfTerminal(
        tx as unknown as Prisma.TransactionClient,
        claim.groupId,
        completedAt,
      );
      await this.publishLifecycleInTransaction(
        tx,
        claim.organizationId as OrganizationId,
        claim.projectId as ProjectId,
        claim.id,
      );
      this.logger.log('Recorded applied proposal group member', {
        groupId: claim.groupId,
        memberId: claim.id,
        proposalId: claim.proposalId,
        attemptId: claim.attemptId,
        readyMemberIds,
      });
      return readyMemberIds;
    });
  }

  private async recordReady(claim: ProposalGroupMemberClaim): Promise<void> {
    const recorded = await this.prisma.db.proposalGroupMember.updateMany({
      where: this.claimFenceWhere(claim),
      data: {
        executionState: 'READY',
        lastError: null,
        claimToken: null,
        leaseExpiresAt: null,
      },
    });
    if (recorded.count !== 1) {
      this.logLostFence(claim, 'while returning contention to READY');
      return;
    }
    this.logger.log(
      'Returned proposal group member to READY after materialization contention',
      {
        groupId: claim.groupId,
        memberId: claim.id,
        proposalId: claim.proposalId,
        attemptId: claim.attemptId,
      },
    );
  }

  private async recordFailure(
    claim: ProposalGroupMemberClaim,
    error: unknown,
    failure: PersistedProposalApprovalFailure = {
      message: proposalApprovalFailureMessage(error),
      diagnostic: toProposalApprovalFailureDiagnostic(error),
    },
  ): Promise<void> {
    const classification = this.classifyFailure(error);
    const failedAt = new Date();
    const persistedError = serializeProposalApprovalFailure(
      failure.message,
      failure.diagnostic,
    );
    await this.prisma.db.$transaction(async (tx) => {
      if (classification === 'RETRYABLE') {
        const recorded = await tx.proposalGroupMember.updateMany({
          where: this.claimFenceWhere(claim),
          data: {
            executionState: 'RETRYABLE_FAILURE',
            lastError: persistedError,
            claimToken: null,
            leaseExpiresAt: null,
          },
        });
        if (recorded.count !== 1) {
          this.logLostFence(claim, 'while recording retryable failure');
          return;
        }
        this.logger.warn('Recorded proposal group member enactment failure', {
          groupId: claim.groupId,
          memberId: claim.id,
          proposalId: claim.proposalId,
          attemptId: claim.attemptId,
          attemptCount: claim.attemptCount,
          classification,
          retryMode: 'explicit',
          error: failure.message,
          diagnostic: failure.diagnostic,
        });
        await this.publishLifecycleInTransaction(
          tx,
          claim.organizationId as OrganizationId,
          claim.projectId as ProjectId,
          claim.id,
        );
        return;
      }

      const recorded = await tx.proposalGroupMember.updateMany({
        where: this.claimFenceWhere(claim),
        data: {
          executionState: 'FAILED',
          completedAt: failedAt,
          failedAt,
          lastError: persistedError,
          terminalReason: 'PERMANENT_ENACTMENT_FAILURE',
          claimToken: null,
          leaseExpiresAt: null,
        },
      });
      if (recorded.count !== 1) {
        this.logLostFence(claim, 'while recording permanent failure');
        return;
      }
      const invalidatedMemberIds = await this.invalidateImpossibleDependents(
        tx as unknown as Prisma.TransactionClient,
        claim.id,
        claim.groupId,
        failedAt,
      );
      await this.settleIfTerminal(
        tx as unknown as Prisma.TransactionClient,
        claim.groupId,
        failedAt,
      );
      await this.publishLifecycleInTransaction(
        tx,
        claim.organizationId as OrganizationId,
        claim.projectId as ProjectId,
        claim.id,
        [claim.id, ...invalidatedMemberIds],
      );
      this.logger.error('Recorded permanent proposal group member failure', {
        groupId: claim.groupId,
        memberId: claim.id,
        proposalId: claim.proposalId,
        attemptId: claim.attemptId,
        attemptCount: claim.attemptCount,
        classification,
        invalidatedCount: invalidatedMemberIds.length,
        error: failure.message,
        diagnostic: failure.diagnostic,
      });
      return;
    });
  }

  private async wakeDirectDependents(
    tx: Prisma.TransactionClient,
    appliedMemberId: string,
    groupId: string,
    now: Date,
  ): Promise<string[]> {
    const ready = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE "proposal_group_members" AS dependent
      SET
        "execution_state" = 'READY',
        "updated_at" = ${now}
      WHERE dependent."group_id" = ${groupId}
        AND dependent."approval_satisfied_at" IS NOT NULL
        AND dependent."execution_state" IN (
          'PENDING_APPROVAL',
          'WAITING_ON_DEPENDENCIES'
        )
        AND EXISTS (
          SELECT 1
          FROM "proposal_group_dependencies" AS direct_dependency
          WHERE direct_dependency."group_id" = dependent."group_id"
            AND direct_dependency."dependent_member_id" = dependent."id"
            AND direct_dependency."prerequisite_member_id" = ${appliedMemberId}
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "proposal_group_dependencies" AS dependency
          INNER JOIN "proposal_group_members" AS prerequisite
            ON prerequisite."group_id" = dependency."group_id"
            AND prerequisite."id" = dependency."prerequisite_member_id"
          WHERE dependency."group_id" = dependent."group_id"
            AND dependency."dependent_member_id" = dependent."id"
            AND prerequisite."execution_state" <> 'APPLIED'
        )
      RETURNING dependent."id"
    `);
    if (ready.length > 0) {
      this.logger.log(
        'Moved dependency-ready proposal group members to READY',
        {
          groupId,
          appliedMemberId,
          readyMemberIds: ready.map((member) => member.id),
        },
      );
    }
    return ready.map((member) => member.id);
  }

  private async invalidateImpossibleDependents(
    tx: Prisma.TransactionClient,
    sourceMemberId: string,
    groupId: string,
    now: Date,
  ): Promise<string[]> {
    const invalidated = await tx.$queryRaw<InvalidatedMemberRow[]>(
      Prisma.sql`
        WITH RECURSIVE impossible("memberId") AS (
          SELECT dependency."dependent_member_id"
          FROM "proposal_group_dependencies" AS dependency
          INNER JOIN "proposal_group_members" AS source
            ON source."group_id" = dependency."group_id"
            AND source."id" = dependency."prerequisite_member_id"
          INNER JOIN "proposal_group_members" AS dependent
            ON dependent."group_id" = dependency."group_id"
            AND dependent."id" = dependency."dependent_member_id"
          WHERE dependency."group_id" = ${groupId}
            AND source."id" = ${sourceMemberId}
            AND source."execution_state" IN (
              'REJECTED',
              'INVALIDATED',
              'FAILED'
            )
            AND dependent."execution_state" NOT IN (
              'APPLIED',
              'REJECTED',
              'INVALIDATED',
              'FAILED'
            )
          UNION
          SELECT dependency."dependent_member_id"
          FROM "proposal_group_dependencies" AS dependency
          INNER JOIN impossible
            ON impossible."memberId" = dependency."prerequisite_member_id"
          INNER JOIN "proposal_group_members" AS dependent
            ON dependent."group_id" = dependency."group_id"
            AND dependent."id" = dependency."dependent_member_id"
          WHERE dependency."group_id" = ${groupId}
            AND dependent."execution_state" NOT IN (
              'APPLIED',
              'REJECTED',
              'INVALIDATED',
              'FAILED'
            )
        )
        UPDATE "proposal_group_members" AS member
        SET
          "execution_state" = 'INVALIDATED',
          "completed_at" = ${now},
          "invalidated_at" = ${now},
          "terminal_reason" = 'IMPOSSIBLE_PREREQUISITE',
          "claim_token" = NULL,
          "lease_expires_at" = NULL,
          "updated_at" = ${now}
        WHERE member."group_id" = ${groupId}
          AND member."id" IN (SELECT "memberId" FROM impossible)
          AND member."execution_state" NOT IN (
            'APPLIED',
            'REJECTED',
            'INVALIDATED',
            'FAILED'
          )
        RETURNING member."id"
      `,
    );
    if (invalidated.length > 0) {
      this.logger.warn('Invalidated impossible proposal group dependents', {
        groupId,
        sourceMemberId,
        invalidatedMemberIds: invalidated.map((member) => member.id),
      });
    }
    return invalidated.map((member) => member.id);
  }

  private async settleIfTerminal(
    tx: Prisma.TransactionClient,
    groupId: string,
    now: Date,
  ): Promise<boolean> {
    await tx.$queryRaw(
      Prisma.sql`
        SELECT "id"
        FROM "proposal_groups"
        WHERE "id" = ${groupId}
        FOR UPDATE
      `,
    );
    const unsettledCount = await tx.proposalGroupMember.count({
      where: {
        groupId,
        executionState: { notIn: TERMINAL_STATES },
      },
    });
    if (unsettledCount > 0) {
      this.logger.debug('Proposal group remains unsettled', {
        groupId,
        unsettledMemberCount: unsettledCount,
      });
      return false;
    }

    const settled = await tx.proposalGroup.updateMany({
      where: { id: groupId, status: 'REVIEWABLE' },
      data: { status: 'SETTLED', settledAt: now },
    });
    this.logger.log('Evaluated proposal group settlement', {
      groupId,
      settled: settled.count === 1,
    });
    return settled.count === 1;
  }

  private claimFenceWhere(claim: ProposalGroupMemberClaim) {
    return {
      id: claim.id,
      groupId: claim.groupId,
      executionState: 'APPLYING' as const,
      attemptId: claim.attemptId,
      claimToken: claim.claimToken,
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private logLostFence(
    claim: ProposalGroupMemberClaim,
    boundary: string,
  ): void {
    this.logger.warn('Lost proposal group member claim fence', {
      groupId: claim.groupId,
      memberId: claim.id,
      proposalId: claim.proposalId,
      attemptId: claim.attemptId,
      boundary,
    });
  }

  private async publishLifecycleInTransaction(
    tx: AnyTransactionClient,
    organizationId: OrganizationId,
    projectId: ProjectId,
    memberId: string,
    changedMemberIds: string[] = [memberId],
  ): Promise<void> {
    if (!this.lifecycleEvents) return;
    const member = await tx.proposalGroupMember.findFirst({
      where: {
        id: memberId,
        group: { organizationId, projectId },
      },
      select: { groupId: true, group: { select: { revision: true } } },
    });
    if (!member) return;
    await this.lifecycleEvents.publishInTransaction(tx, {
      organizationId,
      projectId,
      groupId: member.groupId,
      revision: member.group.revision,
      changedMemberIds,
    });
  }
}
