import { Injectable, Logger } from '@nestjs/common';
import { isAxiosError } from 'axios';
import { randomUUID } from 'node:crypto';
import {
  OrganizationClosureExecution,
  OrganizationClosureExecutionStage,
  OrganizationClosureProjectionConsumer,
  OrganizationClosureProjectionOutcome,
  OrganizationClosureProjectionCommand,
  Prisma,
} from '@prisma/client';
import type {
  ProjectionDeletionCommand as GraphProjectionDeletionCommand,
  ProjectionDeletionIdentity as GraphProjectionDeletionIdentity,
  ProjectionDeletionIdentityConflictResponse as GraphProjectionDeletionIdentityConflictResponse,
  ProjectionDeletionResult as GraphProjectionDeletionResult,
  ProjectionDeletionRetryableFailureResponse as GraphProjectionDeletionRetryableFailureResponse,
  ProjectionDeletionValidationErrorResponse as GraphProjectionDeletionValidationErrorResponse,
} from '../generated/graphs';
import type {
  ProjectionDeletionCommand as EmbeddingsProjectionDeletionCommand,
  ProjectionDeletionIdentity as EmbeddingsProjectionDeletionIdentity,
  ProjectionDeletionIdentityConflictResponse as EmbeddingsProjectionDeletionIdentityConflictResponse,
  ProjectionDeletionResult as EmbeddingsProjectionDeletionResult,
  ProjectionDeletionRetryableFailureResponse as EmbeddingsProjectionDeletionRetryableFailureResponse,
  ProjectionDeletionValidationErrorResponse as EmbeddingsProjectionDeletionValidationErrorResponse,
} from '../generated/embeddings';
import {
  JwtKeysService,
  ProjectionDeletionProvider,
} from '../auth/services/jwt-keys.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationId } from '../types';
import { EmbeddingsClientService } from './embeddings-client.service';
import { GraphsClientService } from './graphs-client.service';
import { OrganizationAccountDataDeletionOwner } from './organization-account-data-deletion.owner';
import { OrganizationClosureDueWorkService } from './organization-closure-due-work.service';

const CLAIM_DURATION_MS = 5 * 60_000;
const MAX_FAILURE_LENGTH = 2000;
const MAX_RETRY_DELAY_MS = 60 * 60_000;
const RFC3339_INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/;

const CONSUMERS = [
  OrganizationClosureProjectionConsumer.GRAPH,
  OrganizationClosureProjectionConsumer.EMBEDDINGS,
] as const;

type Consumer = (typeof CONSUMERS)[number];

interface ClaimRow {
  consumer: Consumer;
  claimToken: string;
}

interface ConsumerAttempt {
  verified: boolean;
  permanentFailure: boolean;
  failure?: Error;
}

class ProjectionIdentityConflictError extends Error {
  readonly code = 'IDENTITY_CONFLICT';
}

class ProjectionValidationError extends Error {
  readonly code = 'VALIDATION_FAILURE';
}

type ProjectionDeletionCommand = GraphProjectionDeletionCommand;
type ProjectionDeletionResponse =
  | GraphProjectionDeletionResult
  | EmbeddingsProjectionDeletionResult;
type ProjectionDeletionFailureResponse =
  | GraphProjectionDeletionIdentityConflictResponse
  | GraphProjectionDeletionRetryableFailureResponse
  | GraphProjectionDeletionValidationErrorResponse
  | EmbeddingsProjectionDeletionIdentityConflictResponse
  | EmbeddingsProjectionDeletionRetryableFailureResponse
  | EmbeddingsProjectionDeletionValidationErrorResponse;
type ProjectionDeletionIdentitySource =
  | GraphProjectionDeletionCommand
  | GraphProjectionDeletionIdentity
  | GraphProjectionDeletionResult
  | EmbeddingsProjectionDeletionCommand
  | EmbeddingsProjectionDeletionIdentity
  | EmbeddingsProjectionDeletionResult;

interface ComparableRfc3339Instant {
  epochMilliseconds: number;
  fractionalSecond: string;
}

function parseComparableRfc3339Instant(
  value: string,
): ComparableRfc3339Instant | null {
  const match = RFC3339_INSTANT_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[10] ? Number(match[10]) : 0;
  const offsetMinute = match[11] ? Number(match[11]) : 0;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth[month - 1]! ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return null;
  }

  const epochMilliseconds = Date.parse(value);
  if (!Number.isFinite(epochMilliseconds)) {
    return null;
  }

  return {
    epochMilliseconds,
    fractionalSecond: (match[7] ?? '').replace(/0+$/, ''),
  };
}

function rfc3339InstantsEqual(left: string, right: string): boolean {
  const leftInstant = parseComparableRfc3339Instant(left);
  const rightInstant = parseComparableRfc3339Instant(right);
  return (
    leftInstant !== null &&
    rightInstant !== null &&
    leftInstant.epochMilliseconds === rightInstant.epochMilliseconds &&
    leftInstant.fractionalSecond === rightInstant.fractionalSecond
  );
}

@Injectable()
export class OrganizationProjectionDeletionCoordinatorService {
  private readonly logger = new Logger(
    OrganizationProjectionDeletionCoordinatorService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly dueWork: OrganizationClosureDueWorkService,
    private readonly deletionOwner: OrganizationAccountDataDeletionOwner,
    private readonly jwtKeys: JwtKeysService,
    private readonly graphsClient: GraphsClientService,
    private readonly embeddingsClient: EmbeddingsClientService,
  ) {}

  async executeForOrganization(
    organizationId: OrganizationId,
  ): Promise<boolean> {
    const existing =
      await this.prisma.db.organizationClosureExecution.findUnique({
        where: { organizationId },
      });
    if (!existing) {
      await this.dueWork.materializeReachedSnapshot(organizationId);
    }
    const execution = await this.dueWork.claimNext(new Date(), organizationId);
    if (!execution) {
      return false;
    }
    await this.execute(execution);
    return true;
  }

  async execute(execution: OrganizationClosureExecution): Promise<void> {
    let current = execution;
    this.logger.log({
      event: 'organization_projection_deletion_coordinator_entered',
      organizationId: current.organizationId,
      markerId: current.markerId,
      stage: current.stage,
      attemptCount: current.attemptCount,
      claimedAt: current.claimedAt?.toISOString() ?? null,
      leaseExpiresAt: current.leaseExpiresAt?.toISOString() ?? null,
    });

    if (current.stage === OrganizationClosureExecutionStage.PENDING) {
      // The owner deliberately stops after irreversible authority revocation.
      // Projection command rows must be durable before either downstream call
      // and before the owner is allowed to delete PostgreSQL content.
      this.logger.log({
        event:
          'organization_projection_deletion_authority_revocation_delegated',
        organizationId: current.organizationId,
        markerId: current.markerId,
        attemptCount: current.attemptCount,
      });
      await this.deletionOwner.execute(current);
      current = await this.loadExecution(current.organizationId);
      this.logger.log({
        event: 'organization_projection_deletion_authority_revocation_returned',
        organizationId: current.organizationId,
        markerId: current.markerId,
        stage: current.stage,
        attemptCount: current.attemptCount,
      });
    }

    if (
      current.stage === OrganizationClosureExecutionStage.COMPLETED ||
      current.stage === OrganizationClosureExecutionStage.FAILED
    ) {
      this.logger.debug({
        event: 'organization_projection_deletion_terminal_stage_skipped',
        organizationId: current.organizationId,
        markerId: current.markerId,
        stage: current.stage,
        attemptCount: current.attemptCount,
      });
      return;
    }

    if (
      current.stage === OrganizationClosureExecutionStage.CONTENT_DELETED ||
      current.stage ===
        OrganizationClosureExecutionStage.PROJECTIONS_INVALIDATED ||
      current.stage === OrganizationClosureExecutionStage.VERIFIED
    ) {
      this.logger.log({
        event:
          'organization_projection_deletion_post_projection_resume_delegated',
        organizationId: current.organizationId,
        markerId: current.markerId,
        stage: current.stage,
        attemptCount: current.attemptCount,
      });
      await this.deletionOwner.executeAfterProjectionDeletion(current);
      return;
    }

    if (current.stage !== OrganizationClosureExecutionStage.AUTHORITY_REVOKED) {
      throw new Error(
        `Unsupported organization closure coordinator stage: ${current.stage}`,
      );
    }

    const identity = this.toCommand({
      organizationId: current.organizationId,
      markerId: current.markerId,
      irreversibleClosureAt: current.effectiveClosureAt,
      deletionDeadline: current.deletionDeadline,
    });
    const systemTokens = new Map<Consumer, string>();

    const getSystemToken = (consumer: Consumer): string => {
      const existing = systemTokens.get(consumer);
      if (existing) {
        return existing;
      }
      const provider = consumer satisfies ProjectionDeletionProvider;
      const token = this.jwtKeys.getProjectionDeletionToken(
        {
          organizationId: current.organizationId as OrganizationId,
          markerId: current.markerId,
          irreversibleClosureAt: current.effectiveClosureAt,
          deletionDeadline: current.deletionDeadline,
        },
        provider,
      );
      systemTokens.set(consumer, token);
      return token;
    };

    let attempts: ConsumerAttempt[];
    try {
      this.logger.log({
        event: 'organization_projection_deletion_commands_preparing',
        organizationId: current.organizationId,
        markerId: current.markerId,
        consumers: CONSUMERS,
      });
      await this.ensureConsumerCommands(identity, new Date());
      attempts = [];
      for (const consumer of CONSUMERS) {
        attempts.push(
          await this.processConsumer(
            identity,
            consumer,
            new Date(),
            getSystemToken,
          ),
        );
      }
    } catch (error) {
      const latest = await this.loadExecution(current.organizationId);
      this.logger.error({
        event: 'organization_projection_deletion_coordination_failed',
        organizationId: latest.organizationId,
        markerId: latest.markerId,
        stage: latest.stage,
        attemptCount: latest.attemptCount,
        failureType:
          error instanceof Error ? error.constructor.name : typeof error,
        failure: this.failureMessage(error),
        disposition:
          error instanceof ProjectionIdentityConflictError
            ? 'terminal-failure'
            : 'retry',
      });
      if (error instanceof ProjectionIdentityConflictError) {
        await this.dueWork.failClaim(latest, error);
      } else {
        await this.dueWork.releaseClaim(latest, error);
      }
      throw error;
    }

    const latest = await this.loadExecution(current.organizationId);
    this.logger.log({
      event: 'organization_projection_deletion_attempts_completed',
      organizationId: latest.organizationId,
      markerId: latest.markerId,
      stage: latest.stage,
      attemptCount: latest.attemptCount,
      consumers: attempts.map((attempt, index) => ({
        consumer: CONSUMERS[index],
        verified: attempt.verified,
        permanentFailure: attempt.permanentFailure,
        failure: attempt.failure?.message ?? null,
      })),
    });
    if (
      latest.stage === OrganizationClosureExecutionStage.COMPLETED ||
      latest.stage === OrganizationClosureExecutionStage.FAILED
    ) {
      return;
    }
    if (attempts.every((attempt) => attempt.verified)) {
      this.logger.log({
        event: 'organization_projection_deletions_verified',
        organizationId: latest.organizationId,
        markerId: latest.markerId,
      });
      this.logger.log({
        event: 'organization_postgresql_deletion_delegated',
        organizationId: latest.organizationId,
        markerId: latest.markerId,
      });
      await this.deletionOwner.executeAfterProjectionDeletion(latest);
      return;
    }

    const permanentFailure = attempts.find(
      (attempt) => attempt.permanentFailure,
    );
    if (permanentFailure) {
      this.logger.error({
        event: 'organization_projection_deletion_claim_failed_permanently',
        organizationId: latest.organizationId,
        markerId: latest.markerId,
        stage: latest.stage,
        attemptCount: latest.attemptCount,
        failure:
          permanentFailure.failure?.message ??
          'Organization projection deletion permanently failed',
      });
      await this.dueWork.failClaim(
        latest,
        permanentFailure.failure ??
          new Error('Organization projection deletion permanently failed'),
      );
      return;
    }

    this.logger.warn({
      event: 'organization_projection_deletion_claim_released_for_retry',
      organizationId: latest.organizationId,
      markerId: latest.markerId,
      stage: latest.stage,
      attemptCount: latest.attemptCount,
    });
    await this.dueWork.releaseClaim(
      latest,
      new Error('Organization projection deletion is awaiting retry'),
    );
  }

  private async ensureConsumerCommands(
    identity: ProjectionDeletionCommand,
    now: Date,
  ): Promise<void> {
    const marker = await this.prisma.db.organizationDeletionMarker.findUnique({
      where: { organizationId: identity.organizationId },
    });
    if (!marker) {
      throw new Error('Retained organization deletion marker is missing');
    }
    this.assertMatchingIdentity(
      this.toCommand({
        organizationId: marker.organizationId,
        markerId: marker.id,
        irreversibleClosureAt: marker.effectiveClosureAt,
        deletionDeadline: marker.deletionDeadline,
      }),
      identity,
      'Retained organization deletion marker identity does not match execution',
    );

    for (const consumer of CONSUMERS) {
      const existing =
        await this.prisma.db.organizationClosureProjectionCommand.findFirst({
          where: {
            organizationId: identity.organizationId,
            markerId: identity.markerId,
            consumer,
          },
        });
      if (existing) {
        try {
          this.assertMatchingIdentity(
            this.toCommand(existing),
            identity,
            `Projection command identity conflict for ${consumer}`,
          );
        } catch (error) {
          await this.prisma.db.organizationClosureProjectionCommand.updateMany({
            where: {
              organizationId: identity.organizationId,
              markerId: identity.markerId,
              consumer,
            },
            data: {
              nextRetryAt: null,
              lastFailureCode: 'IDENTITY_CONFLICT',
              lastFailureMessage: this.failureMessage(error),
              lastFailureAt: now,
            },
          });
          throw error;
        }
        continue;
      }

      await this.prisma.db.organizationClosureProjectionCommand.create({
        data: {
          organizationId: identity.organizationId,
          markerId: identity.markerId,
          irreversibleClosureAt: new Date(identity.irreversibleClosureAt),
          deletionDeadline: new Date(identity.deletionDeadline),
          consumer,
          nextRetryAt: now,
        },
      });
      this.logger.log({
        event: 'organization_projection_deletion_command_created',
        organizationId: identity.organizationId,
        markerId: identity.markerId,
        consumer,
      });
    }
  }

  private async processConsumer(
    identity: ProjectionDeletionCommand,
    consumer: Consumer,
    now: Date,
    getSystemToken: (consumer: Consumer) => string,
  ): Promise<ConsumerAttempt> {
    const repository = this.prisma.db.organizationClosureProjectionCommand;
    const existing = await repository.findFirst({
      where: {
        organizationId: identity.organizationId,
        markerId: identity.markerId,
        consumer,
      },
    });
    if (!existing) {
      throw new Error(`Projection command row is missing for ${consumer}`);
    }
    this.assertMatchingIdentity(
      this.toCommand(existing),
      identity,
      `Projection command identity conflict for ${consumer}`,
    );

    if (
      existing.acknowledgedAt &&
      existing.verifiedOutcome === OrganizationClosureProjectionOutcome.VERIFIED
    ) {
      this.logger.log({
        event: 'organization_projection_deletion_acknowledgement_reused',
        organizationId: identity.organizationId,
        markerId: identity.markerId,
        consumer,
        acknowledgedAt: existing.acknowledgedAt.toISOString(),
      });
      return { verified: true, permanentFailure: false };
    }

    if (
      existing.lastFailureCode === 'IDENTITY_CONFLICT' ||
      existing.lastFailureCode === 'VALIDATION_FAILURE'
    ) {
      this.logger.error({
        event: 'organization_projection_deletion_identity_conflict_retained',
        organizationId: identity.organizationId,
        markerId: identity.markerId,
        consumer,
        failure: existing.lastFailureMessage,
      });
      return { verified: false, permanentFailure: true };
    }

    if (
      existing.nextRetryAt &&
      existing.nextRetryAt.getTime() > now.getTime()
    ) {
      this.logger.log({
        event: 'organization_projection_deletion_not_due',
        organizationId: identity.organizationId,
        markerId: identity.markerId,
        consumer,
        nextRetryAt: existing.nextRetryAt.toISOString(),
      });
      return { verified: false, permanentFailure: false };
    }

    const claimed = await this.claimConsumer(identity, consumer, now);
    if (!claimed) {
      return { verified: false, permanentFailure: false };
    }

    const command = await repository.findFirst({
      where: {
        organizationId: identity.organizationId,
        markerId: identity.markerId,
        consumer,
        claimToken: claimed.claimToken,
      },
    });
    if (!command) {
      throw new Error(`Claimed projection command disappeared for ${consumer}`);
    }

    const request = this.toCommand(command);
    this.logger.log({
      event: 'organization_projection_deletion_call_started',
      organizationId: request.organizationId,
      markerId: request.markerId,
      consumer,
      irreversibleClosureAt: request.irreversibleClosureAt,
      deletionDeadline: request.deletionDeadline,
      attemptCount: command.attemptCount,
    });

    try {
      const response = await this.callConsumer(
        consumer,
        request,
        getSystemToken(consumer),
      );
      this.logger.log({
        event: 'organization_projection_deletion_call_response_received',
        organizationId: request.organizationId,
        markerId: request.markerId,
        consumer,
        response: {
          organizationId: response.organizationId,
          markerId: response.markerId,
          irreversibleClosureAt: response.irreversibleClosureAt,
          deletionDeadline: response.deletionDeadline,
          tombstoneRecorded: response.tombstoneRecorded,
          contentVerificationCompleted: response.contentVerificationCompleted,
        },
      });
      this.assertVerifiedResponse(response, request, consumer);
      await this.recordAcknowledgement(command, now);
      this.logger.log({
        event: 'organization_projection_deletion_acknowledged',
        organizationId: request.organizationId,
        markerId: request.markerId,
        consumer,
      });
      return { verified: true, permanentFailure: false };
    } catch (error) {
      if (
        error instanceof ProjectionIdentityConflictError ||
        this.responseStatus(error) === 409 ||
        this.projectionDeletionFailure(error)?.errorCode ===
          'PROJECTION_DELETION_IDENTITY_CONFLICT'
      ) {
        const conflict =
          error instanceof ProjectionIdentityConflictError
            ? error
            : new ProjectionIdentityConflictError(
                `Downstream ${consumer} rejected the immutable closure identity`,
              );
        await this.recordCommandFailure(command, conflict, now, true);
        this.logger.error({
          event: 'organization_projection_deletion_identity_conflict',
          organizationId: request.organizationId,
          markerId: request.markerId,
          consumer,
          failure: conflict.message,
        });
        return { verified: false, permanentFailure: true, failure: conflict };
      }

      if (
        error instanceof ProjectionValidationError ||
        this.responseStatus(error) === 400 ||
        this.projectionDeletionFailure(error)?.errorCode ===
          'PROJECTION_DELETION_VALIDATION_FAILED'
      ) {
        const validation =
          error instanceof ProjectionValidationError
            ? error
            : new ProjectionValidationError(this.failureMessage(error));
        await this.recordCommandFailure(command, validation, now, true);
        this.logger.error({
          event: 'organization_projection_deletion_validation_failure',
          organizationId: request.organizationId,
          markerId: request.markerId,
          consumer,
          failure: validation.message,
        });
        return {
          verified: false,
          permanentFailure: true,
          failure: validation,
        };
      }

      await this.recordCommandFailure(command, error, now, false);
      this.logger.warn({
        event: 'organization_projection_deletion_retryable_failure',
        organizationId: request.organizationId,
        markerId: request.markerId,
        consumer,
        failure: this.failureMessage(error),
      });
      return { verified: false, permanentFailure: false };
    }
  }

  private async claimConsumer(
    identity: ProjectionDeletionCommand,
    consumer: Consumer,
    now: Date,
  ): Promise<ClaimRow | null> {
    const claimToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + CLAIM_DURATION_MS);
    const rows = await this.prisma.$queryRaw<ClaimRow[]>(Prisma.sql`
      WITH candidate AS (
        SELECT organization_id, marker_id, consumer
        FROM organization_closure_projection_commands
        WHERE organization_id = ${identity.organizationId}
          AND marker_id = ${identity.markerId}
          AND effective_closure_at = ${new Date(identity.irreversibleClosureAt)}
          AND deletion_deadline = ${new Date(identity.deletionDeadline)}
          AND consumer = ${consumer}::organization_closure_projection_consumer
          AND acknowledged_at IS NULL
          AND last_failure_code IS DISTINCT FROM 'IDENTITY_CONFLICT'
          AND last_failure_code IS DISTINCT FROM 'VALIDATION_FAILURE'
          AND (next_retry_at IS NULL OR next_retry_at <= ${now})
          AND (lease_expires_at IS NULL OR lease_expires_at <= ${now})
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE organization_closure_projection_commands command
      SET claim_token = ${claimToken},
          claimed_at = ${now},
          lease_expires_at = ${leaseExpiresAt},
          attempt_count = command.attempt_count + 1,
          last_attempted_at = ${now},
          last_failure_code = NULL,
          last_failure_message = NULL,
          last_failure_at = NULL,
          next_retry_at = NULL,
          updated_at = ${now}
      FROM candidate
      WHERE command.organization_id = candidate.organization_id
        AND command.marker_id = candidate.marker_id
        AND command.consumer = candidate.consumer
      RETURNING command.consumer AS consumer, command.claim_token AS "claimToken"
    `);
    const claimed = rows[0];
    if (claimed) {
      this.logger.log({
        event: 'organization_projection_deletion_command_claimed',
        organizationId: identity.organizationId,
        markerId: identity.markerId,
        consumer,
        claimToken,
      });
    }
    return claimed ?? null;
  }

  private async recordAcknowledgement(
    command: OrganizationClosureProjectionCommand,
    now: Date,
  ): Promise<void> {
    const updated =
      await this.prisma.db.organizationClosureProjectionCommand.updateMany({
        where: {
          organizationId: command.organizationId,
          markerId: command.markerId,
          consumer: command.consumer,
          claimToken: command.claimToken,
        },
        data: {
          acknowledgedAt: now,
          verifiedOutcome: OrganizationClosureProjectionOutcome.VERIFIED,
          claimToken: null,
          claimedAt: null,
          leaseExpiresAt: null,
          nextRetryAt: null,
          lastFailureCode: null,
          lastFailureMessage: null,
          lastFailureAt: null,
        },
      });
    if (updated.count !== 1) {
      throw new Error('Projection command claim was lost while acknowledging');
    }
  }

  private async recordCommandFailure(
    command: OrganizationClosureProjectionCommand,
    error: unknown,
    now: Date,
    permanent: boolean,
  ): Promise<void> {
    const retryAt = permanent
      ? null
      : new Date(
          now.getTime() +
            Math.min(
              60_000 * 2 ** Math.max(command.attemptCount - 1, 0),
              MAX_RETRY_DELAY_MS,
            ),
        );
    const updated =
      await this.prisma.db.organizationClosureProjectionCommand.updateMany({
        where: {
          organizationId: command.organizationId,
          markerId: command.markerId,
          consumer: command.consumer,
          claimToken: command.claimToken,
        },
        data: {
          claimToken: null,
          claimedAt: null,
          leaseExpiresAt: null,
          nextRetryAt: retryAt,
          lastFailureCode: permanent
            ? error instanceof ProjectionValidationError
              ? error.code
              : 'IDENTITY_CONFLICT'
            : this.failureCode(error),
          lastFailureMessage: this.failureMessage(error),
          lastFailureAt: now,
        },
      });
    if (updated.count !== 1) {
      throw new Error(
        'Projection command claim was lost while recording failure',
      );
    }
  }

  private async callConsumer(
    consumer: Consumer,
    command: ProjectionDeletionCommand,
    systemToken: string,
  ): Promise<ProjectionDeletionResponse> {
    if (consumer === OrganizationClosureProjectionConsumer.GRAPH) {
      return this.graphsClient.deleteOrganizationProjection(
        command,
        systemToken,
      );
    }
    return this.embeddingsClient.deleteOrganizationProjection(
      command,
      systemToken,
    );
  }

  private assertVerifiedResponse(
    response: ProjectionDeletionResponse,
    expected: ProjectionDeletionCommand,
    consumer: Consumer,
  ): void {
    this.assertMatchingIdentity(
      response,
      expected,
      `Downstream ${consumer} returned a conflicting closure identity`,
    );
    if (!response.tombstoneRecorded || !response.contentVerificationCompleted) {
      throw new Error(`Downstream ${consumer} returned an unverified deletion`);
    }
  }

  private assertMatchingIdentity(
    value: ProjectionDeletionIdentitySource,
    expected: ProjectionDeletionCommand,
    message: string,
  ): void {
    if (
      value.organizationId !== expected.organizationId ||
      value.markerId !== expected.markerId ||
      !rfc3339InstantsEqual(
        value.irreversibleClosureAt,
        expected.irreversibleClosureAt,
      ) ||
      !rfc3339InstantsEqual(value.deletionDeadline, expected.deletionDeadline)
    ) {
      throw new ProjectionIdentityConflictError(message);
    }
  }

  private toCommand(value: {
    organizationId: string;
    markerId: string;
    irreversibleClosureAt: Date;
    deletionDeadline: Date;
  }): ProjectionDeletionCommand {
    const command = {
      organizationId: value.organizationId,
      markerId: value.markerId,
      irreversibleClosureAt: value.irreversibleClosureAt.toISOString(),
      deletionDeadline: value.deletionDeadline.toISOString(),
    } satisfies GraphProjectionDeletionCommand;
    command satisfies EmbeddingsProjectionDeletionCommand;
    return command;
  }

  private async loadExecution(
    organizationId: string,
  ): Promise<OrganizationClosureExecution> {
    return this.prisma.db.organizationClosureExecution.findUniqueOrThrow({
      where: { organizationId },
    });
  }

  private responseStatus(error: unknown): number | undefined {
    return isAxiosError(error) ? error.response?.status : undefined;
  }

  private projectionDeletionFailure(
    error: unknown,
  ): ProjectionDeletionFailureResponse | undefined {
    return isAxiosError<ProjectionDeletionFailureResponse>(error)
      ? error.response?.data
      : undefined;
  }

  private failureCode(error: unknown): string {
    const failure = this.projectionDeletionFailure(error);
    if (failure?.errorCode) {
      return failure.errorCode.slice(0, 128);
    }
    const status = this.responseStatus(error);
    return status
      ? `DOWNSTREAM_HTTP_${status}`.slice(0, 128)
      : 'RETRYABLE_FAILURE';
  }

  private failureMessage(error: unknown): string {
    const failure = this.projectionDeletionFailure(error);
    if (failure?.message) {
      return failure.message.slice(0, MAX_FAILURE_LENGTH);
    }
    return (error instanceof Error ? error.message : String(error)).slice(
      0,
      MAX_FAILURE_LENGTH,
    );
  }
}
