import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  PrivateBetaAccessProvisioningOutcomeDto,
  PrivateBetaAccessRequestDecisionInputDto,
  PrivateBetaAccessRequestDecisionResultDto,
  PrivateBetaAccessRequestStatus,
} from '../generated';
import type { BrowserSessionRequestMetadata } from '../auth/browser-session.types';
import {
  type AnyTransactionClient,
  PrismaService,
} from '../prisma/prisma.service';
import type {
  OrganizationId,
  PrivateBetaAccessRequestId,
  UserId,
} from '../types';
import { AccountEntitlementService } from './account-entitlement.service';
import { BetaOnboardingService } from './beta-onboarding.service';
import {
  PRIVATE_BETA_PROVISIONING_FAILURE_MESSAGE,
  parsePrivateBetaProvisioningFailureCode,
  toPrivateBetaProvisioningError,
} from './private-beta-provisioning-error';
import { PrivateBetaAccessProgramService } from './private-beta-access-program.service';

const DECISION_REQUEST_SELECT = {
  id: true,
  status: true,
  decisionAt: true,
  provisionedUserId: true,
  provisionedOrganizationId: true,
  provisioningAttemptedAt: true,
  provisioningCompletedAt: true,
  provisioningFailureCode: true,
  provisioningError: true,
} as const;

type DecisionRequest = {
  id: string;
  status: PrivateBetaAccessRequestStatus;
  decisionAt: Date | null;
  provisionedUserId: string | null;
  provisionedOrganizationId: string | null;
  provisioningAttemptedAt: Date | null;
  provisioningCompletedAt: Date | null;
  provisioningFailureCode: string | null;
  provisioningError: string | null;
};

type ClaimResult =
  | { kind: 'REJECTED' | 'CLAIMED'; request: DecisionRequest }
  | { kind: 'REPLAY'; request: DecisionRequest };

@Injectable()
export class PrivateBetaAccessDecisionService {
  private readonly logger = new Logger(PrivateBetaAccessDecisionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly betaOnboardingService: BetaOnboardingService,
    private readonly privateBetaAccessProgramService: PrivateBetaAccessProgramService,
    private readonly accountEntitlementService: AccountEntitlementService,
  ) {}

  async decide(
    requestId: PrivateBetaAccessRequestId,
    input: PrivateBetaAccessRequestDecisionInputDto,
    operatorId: UserId,
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<PrivateBetaAccessRequestDecisionResultDto> {
    this.logger.debug('Private-beta decision request entered service', {
      requestId,
      operatorId,
      decision: input.decision,
    });

    const claimed = await this.claimDecision(requestId, input.decision);

    if (claimed.kind === 'REPLAY') {
      try {
        await this.assertPersistedApprovalEntitlement(claimed.request);
        this.logger.debug(
          'Private-beta decision replay returned persisted state',
          {
            requestId,
            operatorId,
            status: claimed.request.status,
          },
        );
        return this.toDecisionResult(claimed.request, input.decision);
      } catch (error) {
        return this.persistProvisioningFailure(
          requestId,
          operatorId,
          'ORGANIZATION_PROVISIONING',
          error,
        );
      }
    }

    if (claimed.kind === 'REJECTED') {
      this.logger.debug('Private-beta request rejected without onboarding', {
        requestId,
        operatorId,
        status: claimed.request.status,
      });
      return this.toDecisionResult(claimed.request, 'REJECT');
    }

    return this.completeClaimedApproval(
      claimed.request,
      requestMetadata,
      operatorId,
    );
  }

  // Intake calls this only for the claim it created and committed atomically.
  async completeSignupApproval(
    requestId: PrivateBetaAccessRequestId,
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<PrivateBetaAccessRequestDecisionResultDto> {
    const request = await this.readDecisionRequest(requestId);
    if (request.status !== 'APPROVAL_IN_PROGRESS') {
      throw new ConflictException('Signup has no active authorization claim');
    }
    return this.completeClaimedApproval(request, requestMetadata);
  }

  private async completeClaimedApproval(
    request: DecisionRequest,
    requestMetadata: BrowserSessionRequestMetadata,
    operatorId?: UserId,
  ): Promise<PrivateBetaAccessRequestDecisionResultDto> {
    const requestId = request.id as PrivateBetaAccessRequestId;
    this.logger.debug(
      'Private-beta approval claim committed before onboarding',
      {
        requestId,
        operatorId,
        status: request.status,
      },
    );

    try {
      const onboardingResult =
        await this.betaOnboardingService.onboardApprovedRequest(
          requestId,
          requestMetadata,
        );

      this.logger.debug('Private-beta onboarding boundary completed', {
        requestId,
        operatorId,
        outcome: 'succeeded',
      });

      const completedAt = new Date();
      if (request.decisionAt === null) {
        throw new Error(
          'Private-beta approval claim is missing its decision timestamp',
        );
      }
      await this.prisma.db.privateBetaAccessRequest.update({
        where: { id: requestId },
        data: {
          status: 'APPROVED',
          decisionAt: request.decisionAt,
          provisionedUserId: onboardingResult.userId,
          provisionedOrganizationId: onboardingResult.organizationId,
          provisioningCompletedAt: completedAt,
          provisioningFailureCode: null,
          provisioningError: null,
        },
      });

      this.logger.debug('Private-beta approved state write completed', {
        requestId,
        operatorId,
        status: 'APPROVED',
      });

      const persisted = await this.readDecisionRequest(requestId);
      return this.toDecisionResult(persisted, 'APPROVE');
    } catch (error) {
      return this.persistProvisioningFailure(
        requestId,
        operatorId,
        'UNKNOWN',
        error,
      );
    }
  }

  private async assertPersistedApprovalEntitlement(
    request: DecisionRequest,
  ): Promise<void> {
    if (!request.provisionedUserId || !request.provisionedOrganizationId) {
      throw new Error(
        'Private-beta approved request is missing provisioning ownership',
      );
    }
    await this.accountEntitlementService.assertBetaAdmissionEntitlement(
      request.provisionedOrganizationId as OrganizationId,
      {
        actor: request.provisionedUserId,
        reason: `PRIVATE_BETA_ADMISSION:${request.id}`,
      },
    );
  }

  private async persistProvisioningFailure(
    requestId: PrivateBetaAccessRequestId,
    operatorId: UserId | undefined,
    code: Parameters<typeof toPrivateBetaProvisioningError>[0],
    error: unknown,
  ): Promise<PrivateBetaAccessRequestDecisionResultDto> {
    const failure = toPrivateBetaProvisioningError(code, error);
    await this.prisma.db.privateBetaAccessRequest.update({
      where: { id: requestId },
      data: {
        status: 'PROVISIONING_FAILED',
        provisioningCompletedAt: new Date(),
        provisioningFailureCode: failure.code,
        provisioningError: PRIVATE_BETA_PROVISIONING_FAILURE_MESSAGE,
      },
    });

    this.logger.error(
      'Private-beta provisioning failure state write completed',
      {
        requestId,
        operatorId,
        outcome: 'failed',
        failureCode: failure.code,
        errorType: failure.errorType,
      },
    );
    const persisted = await this.readDecisionRequest(requestId);
    return this.toDecisionResult(persisted, 'APPROVE');
  }

  private async claimDecision(
    requestId: PrivateBetaAccessRequestId,
    decision: PrivateBetaAccessRequestDecisionInputDto['decision'],
  ): Promise<ClaimResult> {
    return this.prisma.db.$transaction(async (tx) => {
      this.logger.debug('Private-beta decision row lock requested', {
        requestId,
        decision,
      });

      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT request."id"
        FROM "private_beta_access_requests" AS request
        WHERE request."id" = ${requestId}
        FOR UPDATE OF request
      `;

      if (locked.length === 0) {
        this.logger.debug('Private-beta decision lookup found no request', {
          requestId,
        });
        throw new NotFoundException('Private-beta access request not found');
      }

      const request = await this.readDecisionRequestInTransaction(
        tx,
        requestId,
      );
      this.logger.debug('Private-beta decision state loaded under lock', {
        requestId,
        decision,
        status: request.status,
      });

      if (request.status === 'PENDING') {
        const decisionAt = new Date();
        if (decision === 'REJECT') {
          const rejected = await tx.privateBetaAccessRequest.update({
            where: { id: requestId },
            data: { status: 'REJECTED', decisionAt },
            select: DECISION_REQUEST_SELECT,
          });
          return { kind: 'REJECTED', request: rejected };
        }

        if (decision === 'APPROVE') {
          await this.privateBetaAccessProgramService.assertOpenInTransaction(
            tx,
          );
          const claimed = await tx.privateBetaAccessRequest.update({
            where: { id: requestId },
            data: {
              status: 'APPROVAL_IN_PROGRESS',
              decisionAt,
              provisioningAttemptedAt: new Date(),
              provisioningCompletedAt: null,
              provisioningFailureCode: null,
              provisioningError: null,
            },
            select: DECISION_REQUEST_SELECT,
          });
          return { kind: 'CLAIMED', request: claimed };
        }
      }

      if (request.status === 'PROVISIONING_FAILED' && decision === 'APPROVE') {
        await this.privateBetaAccessProgramService.assertOpenInTransaction(tx);
        if (request.decisionAt === null) {
          throw new Error(
            'Private-beta provisioning failure has no decision timestamp',
          );
        }
        const claimed = await tx.privateBetaAccessRequest.update({
          where: { id: requestId },
          data: {
            status: 'APPROVAL_IN_PROGRESS',
            provisioningAttemptedAt: new Date(),
            provisioningCompletedAt: null,
            provisioningFailureCode: null,
            provisioningError: null,
          },
          select: DECISION_REQUEST_SELECT,
        });
        return { kind: 'CLAIMED', request: claimed };
      }

      if (request.status === 'APPROVED' && decision === 'APPROVE') {
        return { kind: 'REPLAY', request };
      }

      this.logger.debug(
        'Private-beta decision transition rejected as conflict',
        {
          requestId,
          decision,
          status: request.status,
        },
      );
      throw new ConflictException(
        'Private-beta access request decision conflicts with its current state',
      );
    });
  }

  private async readDecisionRequest(
    requestId: PrivateBetaAccessRequestId,
  ): Promise<DecisionRequest> {
    const request = await this.prisma.db.privateBetaAccessRequest.findUnique({
      where: { id: requestId },
      select: DECISION_REQUEST_SELECT,
    });
    if (!request) {
      throw new NotFoundException('Private-beta access request not found');
    }
    return request;
  }

  private async readDecisionRequestInTransaction(
    tx: AnyTransactionClient,
    requestId: PrivateBetaAccessRequestId,
  ): Promise<DecisionRequest> {
    const request = await tx.privateBetaAccessRequest.findUnique({
      where: { id: requestId },
      select: DECISION_REQUEST_SELECT,
    });
    if (!request) {
      throw new NotFoundException('Private-beta access request not found');
    }
    return request;
  }

  private toDecisionResult(
    request: DecisionRequest,
    decision: PrivateBetaAccessRequestDecisionResultDto['decision'],
  ): PrivateBetaAccessRequestDecisionResultDto {
    if (request.decisionAt === null) {
      throw new Error(
        'Private-beta access request decision is missing its timestamp',
      );
    }

    const result = {
      requestId: request.id,
      decision,
      status: request.status,
      decidedAt: request.decisionAt.toISOString(),
      provisioningOutcome: this.toProvisioningOutcome(request),
    } satisfies PrivateBetaAccessRequestDecisionResultDto;

    this.logger.debug('Private-beta decision result mapped', {
      requestId: request.id,
      decision,
      status: request.status,
      hasProvisioningOutcome: result.provisioningOutcome !== null,
    });
    return result;
  }

  private toProvisioningOutcome(
    request: DecisionRequest,
  ): PrivateBetaAccessProvisioningOutcomeDto | null {
    if (
      request.provisionedUserId === null &&
      request.provisionedOrganizationId === null &&
      request.provisioningCompletedAt === null &&
      request.provisioningError === null
    ) {
      return null;
    }

    if (request.provisioningAttemptedAt === null) {
      throw new Error(
        'Private-beta provisioning outcome is missing its attempt timestamp',
      );
    }

    const failed = request.provisioningError !== null;
    if (failed !== (request.provisioningFailureCode !== null)) {
      throw new Error(
        'Private-beta provisioning failure metadata is incomplete',
      );
    }
    return {
      status: failed ? 'FAILED' : 'SUCCEEDED',
      attemptedAt: request.provisioningAttemptedAt.toISOString(),
      completedAt: request.provisioningCompletedAt?.toISOString() ?? null,
      organizationId: request.provisionedOrganizationId,
      userId: request.provisionedUserId,
      failureCode: parsePrivateBetaProvisioningFailureCode(
        request.provisioningFailureCode,
      ),
      failureMessage: request.provisioningError,
      retryable: failed && request.status === 'PROVISIONING_FAILED',
    } satisfies PrivateBetaAccessProvisioningOutcomeDto;
  }
}
