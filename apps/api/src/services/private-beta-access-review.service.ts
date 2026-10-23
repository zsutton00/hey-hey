import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  PrivateBetaAccessProvisioningOutcomeDto,
  PrivateBetaAccessRequestReviewDto,
} from '../generated';
import { PrismaService } from '../prisma/prisma.service';
import type { PrivateBetaAccessRequestId } from '../types';
import { parsePrivateBetaProvisioningFailureCode } from './private-beta-provisioning-error';

const PRIVATE_BETA_ACCESS_REQUEST_REVIEW_SELECT = {
  id: true,
  normalizedEmail: true,
  name: true,
  organizationName: true,
  teamSize: true,
  productContext: true,
  accessRationale: true,
  status: true,
  createdAt: true,
  decisionAt: true,
  provisionedUserId: true,
  provisionedOrganizationId: true,
  provisioningAttemptedAt: true,
  provisioningCompletedAt: true,
  provisioningFailureCode: true,
  provisioningError: true,
} as const;

@Injectable()
export class PrivateBetaAccessReviewService {
  private readonly logger = new Logger(PrivateBetaAccessReviewService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findMany(): Promise<PrivateBetaAccessRequestReviewDto[]> {
    this.logger.debug('Private-beta review collection lookup started', {
      operation: 'list',
    });

    const requests = await this.prisma.db.privateBetaAccessRequest.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: PRIVATE_BETA_ACCESS_REQUEST_REVIEW_SELECT,
    });

    const reviews = requests.map((request) => this.mapReview(request));
    this.logger.debug('Private-beta review collection mapping completed', {
      operation: 'list',
      requestCount: reviews.length,
    });
    return reviews;
  }

  async findOne(
    requestId: PrivateBetaAccessRequestId,
  ): Promise<PrivateBetaAccessRequestReviewDto> {
    this.logger.debug('Private-beta review lookup started', {
      requestId,
      operation: 'get-one',
    });

    const request = await this.prisma.db.privateBetaAccessRequest.findUnique({
      where: { id: requestId },
      select: PRIVATE_BETA_ACCESS_REQUEST_REVIEW_SELECT,
    });

    if (!request) {
      this.logger.debug('Private-beta review lookup found no request', {
        requestId,
        outcome: 'not-found',
      });
      throw new NotFoundException('Private-beta access request not found');
    }

    this.logger.debug('Private-beta review request loaded', {
      requestId,
      outcome: 'found',
      status: request.status,
    });

    const review = this.mapReview(request);
    this.logger.debug('Private-beta review provisioning outcome mapped', {
      requestId,
      hasOutcome: review.provisioningOutcome !== null,
      outcomeStatus: review.provisioningOutcome?.status,
    });

    this.logger.debug('Private-beta review state mapping completed', {
      requestId,
      status: review.status,
      hasDecisionTimestamp: review.decidedAt !== null,
      hasProvisioningOutcome: review.provisioningOutcome !== null,
    });

    return review;
  }

  private mapReview(request: {
    id: string;
    normalizedEmail: string;
    name: string;
    organizationName: string;
    teamSize: number | null;
    productContext: string | null;
    accessRationale: string | null;
    status: string;
    createdAt: Date;
    decisionAt: Date | null;
    provisionedUserId: string | null;
    provisionedOrganizationId: string | null;
    provisioningAttemptedAt: Date | null;
    provisioningCompletedAt: Date | null;
    provisioningFailureCode: string | null;
    provisioningError: string | null;
  }): PrivateBetaAccessRequestReviewDto {
    return {
      requestId: request.id,
      name: request.name,
      workEmail: request.normalizedEmail,
      organizationName: request.organizationName,
      teamSize: request.teamSize,
      productContext: request.productContext,
      accessRationale: request.accessRationale,
      status: request.status as PrivateBetaAccessRequestReviewDto['status'],
      createdAt: request.createdAt.toISOString(),
      decidedAt: request.decisionAt?.toISOString() ?? null,
      provisioningOutcome: this.mapProvisioningOutcome(request),
    } satisfies PrivateBetaAccessRequestReviewDto;
  }

  private mapProvisioningOutcome(request: {
    provisioningAttemptedAt: Date | null;
    provisionedUserId: string | null;
    provisionedOrganizationId: string | null;
    provisioningCompletedAt: Date | null;
    provisioningFailureCode: string | null;
    provisioningError: string | null;
    status: string;
  }): PrivateBetaAccessProvisioningOutcomeDto | null {
    const hasPersistedOutcome =
      request.provisionedUserId !== null ||
      request.provisionedOrganizationId !== null ||
      request.provisioningCompletedAt !== null ||
      request.provisioningError !== null;

    if (!hasPersistedOutcome) {
      return null;
    }

    // Resource checkpoints are progress evidence, not a completed outcome.
    // Do not expose a partially provisioned request as successful while the
    // API-key or welcome-email stages are still pending.
    if (
      request.provisioningCompletedAt === null &&
      request.provisioningError === null
    ) {
      return null;
    }

    if (request.provisioningAttemptedAt === null) {
      this.logger.error(
        'Private-beta review found provisioning metadata without an attempt timestamp',
        { outcome: 'invalid-durable-state' },
      );
      throw new Error(
        'Private-beta access request provisioning metadata requires provisioningAttemptedAt',
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
