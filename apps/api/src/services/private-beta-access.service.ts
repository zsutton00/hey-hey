import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type {
  PrivateBetaAccessRequestAcceptedResponseDto,
  PrivateBetaAccessRequestSubmissionDto,
} from '../generated';
import {
  type AnyTransactionClient,
  PrismaService,
} from '../prisma/prisma.service';
import { privateBetaAccessRequestSubmissionJsonSchema } from '../generated/private-beta-access-request-submission.schema';
import type { PrivateBetaAccessRequestId } from '../types';
import type { BrowserSessionRequestMetadata } from '../auth/browser-session.types';
import { getDeploymentEnvironment } from '../deployment-environment';
import { PrivateBetaAccessProgramService } from './private-beta-access-program.service';
import { PrivateBetaAccessDecisionService } from './private-beta-access-decision.service';

const SUBMISSION_TEXT_FIELDS = [
  'name',
  'workEmail',
  'organizationName',
  'productContext',
  'accessRationale',
] as const;

const EXISTING_ACCOUNT_NOTICE_COOLDOWN_MS = 30 * 60_000;

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});
addFormats(ajv);
const validateSubmission: ValidateFunction<PrivateBetaAccessRequestSubmissionDto> =
  ajv.compile<PrivateBetaAccessRequestSubmissionDto>(
    privateBetaAccessRequestSubmissionJsonSchema,
  );

type NormalizedSubmission = {
  submittedEmail: string;
  normalizedEmail: string;
  name: string;
  organizationName: string;
  teamSize: number | null;
  productContext: string | null;
  accessRationale: string | null;
};

@Injectable()
export class PrivateBetaAccessService {
  private readonly logger = new Logger(PrivateBetaAccessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly program: PrivateBetaAccessProgramService,
    private readonly decisions: PrivateBetaAccessDecisionService,
  ) {}

  async submit(
    input: PrivateBetaAccessRequestSubmissionDto,
    requestMetadata: BrowserSessionRequestMetadata = {},
  ): Promise<PrivateBetaAccessRequestAcceptedResponseDto> {
    const submission = this.validateAndNormalize(input);
    const shouldNotifyOperator = getDeploymentEnvironment() === 'production';
    const claim = await this.prisma.db.$transaction(async (tx) => {
      // Serialize submission/replay by normalized identity, including after a
      // request leaves PENDING. An OPEN resubmission cannot overturn a rejection
      // or authorize an earlier PAUSED submission.
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${`beta-signup:${submission.normalizedEmail}`}, 0))
      `;
      const now = new Date();
      const existing = await tx.privateBetaAccessRequest.findFirst({
        where: { normalizedEmail: submission.normalizedEmail },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          status: true,
          provisioningFailureCode: true,
          provisionedUserId: true,
          provisionedOrganizationId: true,
        },
      });
      // Existing accounts are recognized before authorization so they never
      // reach provisioning; the conflict check in user provisioning remains
      // only as a race backstop.
      const existingUser = await tx.user.findFirst({
        where: {
          email: { equals: submission.normalizedEmail, mode: 'insensitive' },
        },
        select: { id: true },
      });

      if (existing) {
        const requestId = existing.id as PrivateBetaAccessRequestId;
        const strandedByUserConflict =
          existing.status === 'PROVISIONING_FAILED' &&
          existing.provisioningFailureCode === 'USER_CONFLICT' &&
          existing.provisionedUserId === null &&
          existing.provisionedOrganizationId === null;
        if (
          existingUser &&
          (existing.status === 'EXISTING_ACCOUNT' || strandedByUserConflict)
        ) {
          if (strandedByUserConflict) {
            await tx.privateBetaAccessRequest.update({
              where: { id: requestId },
              data: {
                status: 'EXISTING_ACCOUNT',
                provisioningFailureCode: null,
                provisioningError: null,
              },
            });
            this.logger.log(
              'Private-beta request stranded by user conflict reclassified as existing account',
              { requestId },
            );
          }
          await this.queueExistingAccountNotice(tx, requestId, now);
          return null;
        }
        this.logger.log('Private-beta duplicate submission ignored', {
          requestId,
          status: existing.status,
        });
        return null;
      }

      if (existingUser) {
        const request = await tx.privateBetaAccessRequest.create({
          data: { ...submission, status: 'EXISTING_ACCOUNT' },
        });
        const requestId = request.id as PrivateBetaAccessRequestId;
        this.logger.log('Private-beta submission matched an existing account', {
          requestId,
        });
        await this.queueExistingAccountNotice(tx, requestId, now);
        if (shouldNotifyOperator) {
          await tx.privateBetaAccessNotificationAttempt.create({
            data: {
              requestId,
              recipientRole: 'OPERATOR',
              deliveryState: 'PENDING',
              nextRetryAt: now,
            },
          });
        }
        return null;
      }

      const authorized =
        await this.program.isSelfServiceAdmissionOpenInTransaction(tx);
      const request = await tx.privateBetaAccessRequest.create({
        data: {
          ...submission,
          status: authorized ? 'APPROVAL_IN_PROGRESS' : 'PENDING',
          decisionAt: authorized ? now : null,
          provisioningAttemptedAt: authorized ? now : null,
        },
      });
      const requestId = request.id as PrivateBetaAccessRequestId;
      if (!authorized) {
        this.logger.log(
          'Private-beta submission held for review while paused',
          {
            requestId,
          },
        );
        await tx.privateBetaAccessNotificationAttempt.create({
          data: {
            requestId,
            recipientRole: 'REQUESTER',
            deliveryState: 'PENDING',
            nextRetryAt: now,
          },
        });
      }
      if (shouldNotifyOperator) {
        await tx.privateBetaAccessNotificationAttempt.create({
          data: {
            requestId,
            recipientRole: 'OPERATOR',
            deliveryState: 'PENDING',
            nextRetryAt: now,
          },
        });
      }
      return authorized ? requestId : null;
    });

    if (claim) {
      try {
        await this.decisions.completeSignupApproval(claim, requestMetadata);
      } catch (error) {
        // Persistence is the public success boundary. A failed completion write
        // leaves the durable claim visible for operator recovery.
        this.logger.error('Signup completion failed after durable receipt', {
          requestId: claim,
          errorType: error instanceof Error ? error.name : typeof error,
        });
      }
    }
    return { accepted: true };
  }

  /**
   * One notification row exists per request and role, so re-sends re-arm the
   * same row. A notice still in flight is left alone; a delivered or exhausted
   * one is re-armed only after the cooldown so the form cannot be used to
   * flood an account holder's inbox.
   */
  private async queueExistingAccountNotice(
    tx: AnyTransactionClient,
    requestId: PrivateBetaAccessRequestId,
    now: Date,
  ): Promise<void> {
    const notice = await tx.privateBetaAccessNotificationAttempt.findUnique({
      where: {
        requestId_recipientRole: {
          requestId,
          recipientRole: 'EXISTING_ACCOUNT_HOLDER',
        },
      },
    });
    if (!notice) {
      await tx.privateBetaAccessNotificationAttempt.create({
        data: {
          requestId,
          recipientRole: 'EXISTING_ACCOUNT_HOLDER',
          deliveryState: 'PENDING',
          nextRetryAt: now,
        },
      });
      this.logger.log('Private-beta existing-account notice queued', {
        requestId,
      });
      return;
    }

    const inFlight =
      notice.deliveryState === 'PENDING' ||
      notice.deliveryState === 'PROCESSING' ||
      (notice.deliveryState === 'FAILED' && notice.nextRetryAt !== null);
    if (inFlight) {
      this.logger.log('Private-beta existing-account notice already queued', {
        requestId,
        deliveryState: notice.deliveryState,
      });
      return;
    }

    const lastSentAt =
      notice.deliveredAt ?? notice.lastAttemptAt ?? notice.createdAt;
    if (
      now.getTime() - lastSentAt.getTime() <
      EXISTING_ACCOUNT_NOTICE_COOLDOWN_MS
    ) {
      this.logger.log('Private-beta existing-account notice throttled', {
        requestId,
        lastSentAt: lastSentAt.toISOString(),
      });
      return;
    }

    await tx.privateBetaAccessNotificationAttempt.update({
      where: { id: notice.id },
      data: {
        deliveryState: 'PENDING',
        attemptCount: 0,
        nextRetryAt: now,
        deliveredAt: null,
        lastError: null,
        claimedAt: null,
        claimExpiresAt: null,
        claimToken: null,
      },
    });
    this.logger.log('Private-beta existing-account notice re-queued', {
      requestId,
    });
  }

  private validateAndNormalize(
    input: PrivateBetaAccessRequestSubmissionDto,
  ): NormalizedSubmission {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new BadRequestException(
        'A private-beta access request is required.',
      );
    }

    const fields = input as unknown as Record<string, unknown>;
    const normalizedCandidate = { ...fields };
    for (const field of SUBMISSION_TEXT_FIELDS) {
      if (typeof normalizedCandidate[field] === 'string') {
        normalizedCandidate[field] = normalizedCandidate[field].trim();
      }
    }
    if (!validateSubmission(normalizedCandidate)) {
      throw new BadRequestException(
        'Private-beta access request does not match the public contract.',
      );
    }

    const {
      name,
      workEmail,
      organizationName,
      teamSize,
      productContext,
      accessRationale,
    } = normalizedCandidate;

    const normalizedSubmission: NormalizedSubmission = {
      submittedEmail: workEmail,
      normalizedEmail: workEmail.toLowerCase(),
      name,
      organizationName,
      teamSize: teamSize ?? null,
      productContext: productContext ?? null,
      accessRationale: accessRationale ?? null,
    };

    this.logger.debug('Private-beta submission fields normalized', {
      emailLength: normalizedSubmission.normalizedEmail.length,
      textTrimmed: [
        fields.name !== name,
        fields.workEmail !== workEmail,
        fields.organizationName !== organizationName,
        fields.productContext !== productContext,
        fields.accessRationale !== accessRationale,
      ].filter(Boolean).length,
      emailCaseNormalized: workEmail !== normalizedSubmission.normalizedEmail,
    });

    return normalizedSubmission;
  }
}
