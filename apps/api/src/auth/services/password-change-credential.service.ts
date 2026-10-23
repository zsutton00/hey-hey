import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BrowserAuthResponseDto, OrganizationRole } from '../../generated';
import {
  AnyTransactionClient,
  PrismaService,
} from '../../prisma/prisma.service';
import { UserService } from '../../services/user.service';
import {
  PasswordChangeCredentialId,
  PasswordChangeCredentialIdentifier,
  PrivateBetaAccessRequestId,
  UserId,
} from '../../types';
import { BrowserSessionRequestMetadata } from '../browser-session.types';
import {
  ConsumePasswordChangeCredentialOperation,
  IssuePasswordChangeCredentialOperation,
  PasswordChangeCredentialKind,
  PasswordChangeCredentialConsumptionResult,
} from '../password-change-credential.types';
import {
  BrowserSessionService,
  EstablishedBrowserSession,
} from './browser-session.service';

const MAX_PASSWORD_CHANGE_TTL_SECONDS = 15 * 60;
const MAX_IP_ADDRESS_LENGTH = 45;
const MAX_USER_AGENT_LENGTH = 512;

interface LockedPasswordChangeCredentialRow {
  id: string;
  credentialId: string;
  userId: string;
  privateBetaAccessRequestId: string | null;
  privateBetaAccessRequestStatus: string | null;
  expiresAt: Date | null;
  consumedAt: Date | null;
  revokedAt: Date | null;
  issuanceKind: PasswordChangeCredentialKind;
}

interface DatabaseTimestampRow {
  decisionAt: Date;
}

interface PrivateBetaProgramStateRow {
  closedAt: Date | null;
}

@Injectable()
export class PasswordChangeCredentialService {
  private readonly logger = new Logger(PasswordChangeCredentialService.name);
  private readonly ttlSeconds: number;
  private readonly recoveryTtlSeconds: number;
  private readonly idempotencySecret: string | null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly browserSessionService: BrowserSessionService,
  ) {
    const ttl = Number(
      this.configService.get<string | number>(
        'PASSWORD_CHANGE_TOKEN_TTL_SECONDS',
      ),
    );
    if (
      !Number.isSafeInteger(ttl) ||
      ttl <= 0 ||
      ttl > MAX_PASSWORD_CHANGE_TTL_SECONDS
    ) {
      throw new Error(
        'PASSWORD_CHANGE_TOKEN_TTL_SECONDS must be between 1 and 900',
      );
    }
    this.ttlSeconds = ttl;
    const recoveryTtl = Number(
      this.configService.get<string | number>(
        'PASSWORD_RECOVERY_TOKEN_TTL_SECONDS',
      ) ?? ttl,
    );
    if (
      !Number.isSafeInteger(recoveryTtl) ||
      recoveryTtl <= 0 ||
      recoveryTtl > MAX_PASSWORD_CHANGE_TTL_SECONDS
    ) {
      throw new Error(
        'PASSWORD_RECOVERY_TOKEN_TTL_SECONDS must be between 1 and 900',
      );
    }
    this.recoveryTtlSeconds = recoveryTtl;
    this.idempotencySecret =
      this.configService.get<string>('PASSWORD_CHANGE_IDEMPOTENCY_SECRET') ??
      this.configService.get<string>('JWT_SECRET') ??
      null;
  }

  async issue(
    userId: UserId,
    issuanceKind: PasswordChangeCredentialKind,
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<string> {
    return this.prisma.db.$transaction((tx) =>
      this.issueInTransaction(tx, userId, issuanceKind, requestMetadata),
    );
  }

  async issueInTransaction(
    tx: AnyTransactionClient,
    userId: UserId,
    issuanceKind: PasswordChangeCredentialKind,
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<string> {
    const issuedAt = new Date();
    const passwordChangeToken = randomBytes(32).toString('base64url');
    const credentialId = this.hashToken(passwordChangeToken);
    const operation: IssuePasswordChangeCredentialOperation = {
      id: randomUUID() as PasswordChangeCredentialId,
      credentialId,
      userId,
      issuanceKind,
      issuedAt,
      expiresAt: new Date(
        issuedAt.getTime() +
          (issuanceKind === PasswordChangeCredentialKind.AccountRecovery
            ? this.recoveryTtlSeconds
            : this.ttlSeconds) *
            1000,
      ),
      requestMetadata: this.boundRequestMetadata(requestMetadata),
    };
    await tx.passwordChangeCredential.create({
      data: {
        id: operation.id,
        credentialId: operation.credentialId,
        userId: operation.userId,
        issuanceKind: operation.issuanceKind,
        issuedAt: operation.issuedAt,
        expiresAt: operation.expiresAt,
        issuedIpAddress: operation.requestMetadata.ipAddress,
        issuedUserAgent: operation.requestMetadata.userAgent,
      },
    });
    this.logger.log('Password change credential issued', {
      userId,
      expiresAt: operation.expiresAt?.toISOString() ?? null,
    });
    return passwordChangeToken;
  }

  async issueIdempotentlyInTransaction(
    tx: AnyTransactionClient,
    userId: UserId,
    requestId: PrivateBetaAccessRequestId,
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<string> {
    await this.assertPrivateBetaOpenInTransaction(tx, requestId);

    const passwordChangeToken = this.deriveIdempotentToken(requestId);
    const issuedAt = new Date();
    const operation: IssuePasswordChangeCredentialOperation = {
      id: randomUUID() as PasswordChangeCredentialId,
      credentialId: this.hashToken(passwordChangeToken),
      userId,
      issuanceKind: PasswordChangeCredentialKind.RequiredChange,
      issuedAt,
      expiresAt: null,
      requestMetadata: this.boundRequestMetadata(requestMetadata),
    };

    const credential = await tx.passwordChangeCredential.upsert({
      where: { privateBetaAccessRequestId: requestId },
      create: {
        id: operation.id,
        credentialId: operation.credentialId,
        userId: operation.userId,
        issuanceKind: operation.issuanceKind,
        privateBetaAccessRequestId: requestId,
        issuedAt: operation.issuedAt,
        expiresAt: operation.expiresAt,
        issuedIpAddress: operation.requestMetadata.ipAddress,
        issuedUserAgent: operation.requestMetadata.userAgent,
      },
      update: {},
    });

    const reusedToken = this.reuseIdempotentCredential(
      credential,
      userId,
      requestId,
    );

    this.logger.log(
      'Password change credential issued for private-beta request',
      {
        userId,
        requestId,
        expiresAt: null,
      },
    );
    return reusedToken;
  }

  async revokeInTransaction(
    tx: AnyTransactionClient,
    credentialId: PasswordChangeCredentialIdentifier,
    revokedAt = new Date(),
  ): Promise<boolean> {
    const result = await tx.passwordChangeCredential.updateMany({
      where: {
        credentialId,
        consumedAt: null,
        revokedAt: null,
      },
      data: { revokedAt },
    });
    return result.count === 1;
  }

  async revoke(
    credentialId: PasswordChangeCredentialIdentifier,
    revokedAt = new Date(),
  ): Promise<boolean> {
    return this.prisma.db.$transaction((tx) =>
      this.revokeInTransaction(tx, credentialId, revokedAt),
    );
  }

  async revokeAllPrivateBetaInTransaction(
    tx: AnyTransactionClient,
    revokedAt = new Date(),
  ): Promise<number> {
    const result = await tx.passwordChangeCredential.updateMany({
      where: {
        privateBetaAccessRequestId: { not: null },
        consumedAt: null,
        revokedAt: null,
      },
      data: { revokedAt },
    });
    return result.count;
  }

  async revokeAllPrivateBeta(revokedAt = new Date()): Promise<number> {
    return this.prisma.db.$transaction((tx) =>
      this.revokeAllPrivateBetaInTransaction(tx, revokedAt),
    );
  }

  async complete(
    passwordChangeToken: string,
    newPassword: string,
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<EstablishedBrowserSession> {
    const credentialId = this.resolveCredentialId(passwordChangeToken);
    const metadata = this.boundRequestMetadata(requestMetadata);

    const committed = await this.prisma.db.$transaction(async (tx) => {
      const consumption = await this.consumeInTransaction(tx, {
        credentialId,
        requestMetadata: metadata,
      });
      if (consumption.status !== 'consumed') {
        throw this.invalidCredential();
      }
      const userId = consumption.userId;

      const revocation =
        await this.browserSessionService.revokeAllForUserInTransaction(
          tx,
          userId,
          consumption.consumedAt,
          'password_replaced',
        );
      const user =
        consumption.issuanceKind ===
        PasswordChangeCredentialKind.AccountRecovery
          ? await this.userService.replaceRecoveryPasswordInTransaction(
              tx,
              userId,
              newPassword,
            )
          : await this.userService.replaceRequiredPasswordInTransaction(
              tx,
              userId,
              newPassword,
            );
      const memberships = user.memberships as Array<{
        organizationId: string;
        role: OrganizationRole;
      }>;
      const userResponse = {
        id: user.id as UserId,
        email: user.email,
        name: user.name,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
        currentOrganizationId: null,
      } satisfies BrowserAuthResponseDto['user'];
      const session = await this.browserSessionService.establishInTransaction(
        tx,
        {
          userId,
          user: userResponse,
          claims: {
            email: user.email,
            name: user.name,
            orgMemberships: memberships.map((membership) => ({
              orgId: membership.organizationId,
              role: membership.role,
            })),
            isDevAdmin: user.isDevAdmin,
            devAdminMode: user.devAdminMode,
          },
        },
        metadata,
      );

      return { session, revocation };
    });

    this.browserSessionService.invalidateRevokedSessions(
      committed.revocation.revokedSessionIds,
    );
    this.logger.log('Password change credential committed', {
      userId: committed.session.response.user.id,
      replacementSessionId: committed.session.sessionId,
      revokedSessionCount: committed.revocation.revokedSessionIds.length,
    });
    return committed.session;
  }

  async consumeInTransaction(
    tx: AnyTransactionClient,
    operation: ConsumePasswordChangeCredentialOperation,
  ): Promise<PasswordChangeCredentialConsumptionResult> {
    const privateBetaAccessClosed =
      await this.isPrivateBetaClosedInTransaction(tx);
    const matches = await tx.$queryRaw<LockedPasswordChangeCredentialRow[]>`
      SELECT
        credential."id",
        credential."credential_id" AS "credentialId",
        credential."user_id" AS "userId",
        credential."private_beta_access_request_id" AS "privateBetaAccessRequestId",
        credential."issuance_kind" AS "issuanceKind",
        beta_request."status" AS "privateBetaAccessRequestStatus",
        credential."expires_at" AS "expiresAt",
        credential."consumed_at" AS "consumedAt",
        credential."revoked_at" AS "revokedAt"
      FROM "password_change_credentials" AS credential
      LEFT JOIN "private_beta_access_requests" AS beta_request
        ON beta_request."id" = credential."private_beta_access_request_id"
      WHERE credential."credential_id" = ${operation.credentialId}
      FOR UPDATE OF credential
    `;
    const match = matches[0];
    if (!match) {
      return { status: 'not_found' };
    }
    const consumedAt = await this.getDatabaseTimestamp(tx);
    if (match.consumedAt) {
      return { status: 'already_consumed' };
    }
    if (match.revokedAt) {
      return { status: 'revoked' };
    }
    const isPrivateBetaCredential = Boolean(match.privateBetaAccessRequestId);
    if (isPrivateBetaCredential && privateBetaAccessClosed) {
      await tx.passwordChangeCredential.updateMany({
        where: {
          id: match.id,
          consumedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: consumedAt },
      });
      this.logger.debug(
        'Private-beta credential redemption rejected because access is closed',
        { requestId: match.privateBetaAccessRequestId },
      );
      return { status: 'revoked' };
    }
    const isRedeemablePrivateBetaRequest =
      match.privateBetaAccessRequestStatus === 'APPROVED' ||
      match.privateBetaAccessRequestStatus === 'APPROVAL_IN_PROGRESS' ||
      match.privateBetaAccessRequestStatus === 'PROVISIONING_FAILED';
    if (isPrivateBetaCredential && !isRedeemablePrivateBetaRequest) {
      return { status: 'revoked' };
    }
    if (
      (!isPrivateBetaCredential && match.expiresAt === null) ||
      (match.expiresAt !== null &&
        consumedAt.getTime() >= new Date(match.expiresAt).getTime())
    ) {
      return { status: 'expired' };
    }

    await tx.passwordChangeCredential.update({
      where: { id: match.id },
      data: {
        consumedAt,
        consumedIpAddress: operation.requestMetadata.ipAddress,
        consumedUserAgent: operation.requestMetadata.userAgent,
      },
    });
    return {
      status: 'consumed',
      id: match.id as PasswordChangeCredentialId,
      userId: match.userId as UserId,
      issuanceKind: match.issuanceKind,
      consumedAt,
    };
  }

  private async getDatabaseTimestamp(tx: AnyTransactionClient): Promise<Date> {
    const rows = await tx.$queryRaw<DatabaseTimestampRow[]>`
      SELECT clock_timestamp() AS "decisionAt"
    `;
    const decisionAt = rows[0]?.decisionAt;
    if (!(decisionAt instanceof Date) || Number.isNaN(decisionAt.getTime())) {
      throw new Error('PostgreSQL did not return a valid decision timestamp');
    }
    return decisionAt;
  }

  private resolveCredentialId(
    token: string,
  ): PasswordChangeCredentialIdentifier {
    if (typeof token !== 'string' || token.length === 0) {
      throw this.invalidCredential();
    }
    return this.hashToken(token);
  }

  private hashToken(token: string): PasswordChangeCredentialIdentifier {
    return createHash('sha256')
      .update(token)
      .digest('hex') as PasswordChangeCredentialIdentifier;
  }

  private deriveIdempotentToken(requestId: PrivateBetaAccessRequestId): string {
    if (!this.idempotencySecret) {
      throw new Error(
        'PASSWORD_CHANGE_IDEMPOTENCY_SECRET or JWT_SECRET must be configured',
      );
    }
    return createHmac('sha256', this.idempotencySecret)
      .update(`private-beta-welcome-credential:${requestId}`)
      .digest('base64url');
  }

  private reuseIdempotentCredential(
    credential: {
      credentialId: string;
      userId: string;
      expiresAt: Date | null;
      consumedAt: Date | null;
      revokedAt: Date | null;
    },
    userId: UserId,
    requestId: PrivateBetaAccessRequestId,
  ): string {
    const passwordChangeToken = this.deriveIdempotentToken(requestId);
    if (
      credential.userId !== userId ||
      credential.credentialId !== this.hashToken(passwordChangeToken)
    ) {
      throw new Error(
        'Private-beta credential checkpoint does not match its request identity',
      );
    }
    if (
      credential.consumedAt ||
      credential.revokedAt ||
      (credential.expiresAt !== null &&
        credential.expiresAt.getTime() <= Date.now())
    ) {
      throw new UnauthorizedException(
        'Private-beta password change credential is no longer available',
      );
    }

    this.logger.debug(
      'Reusing private-beta password change credential checkpoint',
      {
        userId,
        requestId,
        expiresAt: credential.expiresAt?.toISOString() ?? null,
      },
    );
    return passwordChangeToken;
  }

  private invalidCredential(): UnauthorizedException {
    return new UnauthorizedException('Password change credential is not valid');
  }

  private async assertPrivateBetaOpenInTransaction(
    tx: AnyTransactionClient,
    requestId: PrivateBetaAccessRequestId,
  ): Promise<void> {
    if (!(await this.isPrivateBetaClosedInTransaction(tx))) return;
    this.logger.debug(
      'Private-beta credential issuance rejected because access is closed',
      { requestId },
    );
    throw new UnauthorizedException('Private-beta access is closed');
  }

  private async isPrivateBetaClosedInTransaction(
    tx: AnyTransactionClient,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<PrivateBetaProgramStateRow[]>`
      SELECT state."closed_at" AS "closedAt"
      FROM "private_beta_access_program_state" AS state
      WHERE state."id" = 'private-beta'
      FOR SHARE
    `;
    const state = rows[0];
    if (!state) {
      throw new Error('Private-beta program state is not initialized');
    }
    return state.closedAt !== null;
  }

  private boundRequestMetadata(
    metadata: BrowserSessionRequestMetadata,
  ): BrowserSessionRequestMetadata {
    const ipAddress = metadata.ipAddress
      ?.trim()
      .slice(0, MAX_IP_ADDRESS_LENGTH);
    const userAgent = metadata.userAgent
      ?.trim()
      .slice(0, MAX_USER_AGENT_LENGTH);
    return {
      ...(ipAddress ? { ipAddress } : {}),
      ...(userAgent ? { userAgent } : {}),
    };
  }
}
