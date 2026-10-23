import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { OrganizationMember } from '@prisma/client';
import {
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';

import {
  BrowserAuthResponseDto,
  BrowserSessionResponseDto,
  BrowserOrganizationSelectionDto,
  OrganizationRole,
  AccountDefaultOrganizationDto,
} from '../../generated';
import {
  AnyTransactionClient,
  PrismaService,
} from '../../prisma/prisma.service';
import { WebsocketUserConnectionLifecycleService } from '../../core/websockets/websocket-user-connection-lifecycle.service';
import {
  BrowserSessionFamilyId,
  BrowserSessionId,
  OrganizationId,
  RefreshGenerationId,
  RefreshGenerationNumber,
  RefreshSecretHash,
  UserId,
} from '../../types';
import {
  BrowserSessionRequestMetadata,
  BrowserSessionRevocationResult,
  BrowserSessionRotationResult,
  LogoutBrowserSessionOperation,
  RefreshBrowserSessionOperation,
  RotateBrowserSessionOperation,
} from '../browser-session.types';
import { JwtPayload } from '../strategies/jwt.strategy';
import { JwtKeysService } from './jwt-keys.service';
import { AccountEntitlementService } from '../../services/account-entitlement.service';

const REQUIRED_ACCESS_TTL_SECONDS = 900;
const REQUIRED_INACTIVITY_TTL_SECONDS = 7 * 24 * 60 * 60;
const REQUIRED_ABSOLUTE_TTL_SECONDS = 30 * 24 * 60 * 60;
const REFRESH_SECRET_BYTES = 32;
const MAX_IP_ADDRESS_LENGTH = 45;
const MAX_USER_AGENT_LENGTH = 512;

export interface BrowserSessionPrincipal {
  userId: UserId;
  user: BrowserAuthResponseDto['user'];
  claims: Pick<
    JwtPayload,
    'email' | 'name' | 'orgMemberships' | 'isDevAdmin' | 'devAdminMode'
  >;
}

export interface EstablishedBrowserSession {
  response: BrowserSessionResponseDto;
  refreshSecret: string;
  sessionId: BrowserSessionId;
  familyId: BrowserSessionFamilyId;
}

interface LockedBrowserSessionRow {
  generationId: string;
  generation: number;
  consumedAt: Date | null;
  familyRowId: string;
  familyId: string;
  sessionId: string;
  userId: string;
  inactivityExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  userIsActive: boolean;
  currentOrganizationId: string | null;
}

interface LogoutBrowserSessionRow {
  familyRowId: string;
  familyId: string;
  sessionId: string;
  revokedAt: Date | null;
}

interface RevocableBrowserSessionRow {
  familyRowId: string;
  familyId: string;
  sessionId: string;
}

interface DatabaseTimestampRow {
  decisionAt: Date;
}

type SessionMembership = {
  orgId: OrganizationId;
  role: OrganizationRole;
};

type AuthorizedSessionClaims = {
  memberships: SessionMembership[];
  currentOrganizationId?: OrganizationId;
};

@Injectable()
export class BrowserSessionService {
  private readonly logger = new Logger(BrowserSessionService.name);
  private readonly accessTtlSeconds: number;
  private readonly inactivityTtlSeconds: number;
  private readonly absoluteTtlSeconds: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly jwtKeysService: JwtKeysService,
    private readonly accountEntitlementService: AccountEntitlementService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {
    this.accessTtlSeconds = this.requiredPositiveInteger(
      'BROWSER_ACCESS_TOKEN_TTL_SECONDS',
    );
    this.inactivityTtlSeconds = this.requiredPositiveInteger(
      'BROWSER_SESSION_INACTIVITY_TTL_SECONDS',
    );
    this.absoluteTtlSeconds = this.requiredPositiveInteger(
      'BROWSER_SESSION_ABSOLUTE_TTL_SECONDS',
    );

    if (
      this.accessTtlSeconds !== REQUIRED_ACCESS_TTL_SECONDS ||
      this.inactivityTtlSeconds !== REQUIRED_INACTIVITY_TTL_SECONDS ||
      this.absoluteTtlSeconds !== REQUIRED_ABSOLUTE_TTL_SECONDS
    ) {
      throw new Error(
        'Browser session policy does not match the reviewed cutover policy',
      );
    }
  }

  async establish(
    principal: BrowserSessionPrincipal,
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<EstablishedBrowserSession> {
    if (!principal.userId) {
      throw new Error('Browser session principal is missing a user ID');
    }

    try {
      const established = await this.prisma.db.$transaction((tx) =>
        this.establishInTransaction(tx, principal, requestMetadata),
      );

      this.logger.log('Browser session established', {
        userId: principal.userId,
        selectedOrganizationId: established.response.user.currentOrganizationId,
        sessionId: established.sessionId,
        familyId: established.familyId,
        generation: 0,
      });

      return established;
    } catch (error) {
      this.logger.error('Browser session establishment failed', {
        userId: principal.userId,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      throw error;
    }
  }

  async establishInTransaction(
    tx: AnyTransactionClient,
    principal: BrowserSessionPrincipal,
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<EstablishedBrowserSession> {
    if (!principal.userId) {
      throw new Error('Browser session principal is missing a user ID');
    }

    const now = new Date();
    const sessionId = randomUUID() as BrowserSessionId;
    const familyId = randomUUID() as BrowserSessionFamilyId;
    const refreshGenerationId = randomUUID() as RefreshGenerationId;
    const refreshSecret =
      randomBytes(REFRESH_SECRET_BYTES).toString('base64url');
    const refreshSecretHash = createHash('sha256')
      .update(refreshSecret)
      .digest('hex') as RefreshSecretHash;
    const inactivityExpiresAt = new Date(
      now.getTime() + this.inactivityTtlSeconds * 1000,
    );
    const absoluteExpiresAt = new Date(
      now.getTime() + this.absoluteTtlSeconds * 1000,
    );
    const metadata = this.boundRequestMetadata(requestMetadata);

    const account = await tx.user.findUniqueOrThrow({
      where: { id: principal.userId },
      select: {
        defaultOrganizationId: true,
        isActive: true,
        memberships: { where: { isActive: true } },
      },
    });
    if (!account.isActive)
      throw new UnauthorizedException('Account is inactive');

    const authorizedClaims = await this.resolveAuthorizedSessionClaims(
      tx,
      account.memberships.map((membership: OrganizationMember) => ({
        orgId: membership.organizationId as OrganizationId,
        role: membership.role as OrganizationRole,
      })),
      (account.defaultOrganizationId as OrganizationId | null) ?? undefined,
      now,
      account.defaultOrganizationId === null,
    );
    const userResponse = {
      ...principal.user,
      currentOrganizationId: authorizedClaims.currentOrganizationId ?? null,
    } satisfies BrowserAuthResponseDto['user'];

    const family = await tx.browserSessionFamily.create({
      data: {
        id: familyId,
        userId: principal.userId,
        sessionId,
        familyId,
        createdAt: now,
        lastUsedAt: now,
        inactivityExpiresAt,
        absoluteExpiresAt,
        createdIpAddress: metadata.ipAddress,
        createdUserAgent: metadata.userAgent,
        lastUsedIpAddress: metadata.ipAddress,
        lastUsedUserAgent: metadata.userAgent,
        currentOrganizationId: authorizedClaims.currentOrganizationId ?? null,
      },
    });

    await tx.refreshGeneration.create({
      data: {
        id: refreshGenerationId,
        browserSessionFamilyId: family.id,
        generation: 0 as RefreshGenerationNumber,
        secretHash: refreshSecretHash,
        issuedAt: now,
      },
    });

    return {
      response: authorizedClaims.currentOrganizationId
        ? this.accessResponse(
            principal,
            authorizedClaims,
            sessionId,
            userResponse,
          )
        : await this.selectionResponse(
            tx,
            userResponse,
            authorizedClaims,
            account.defaultOrganizationId !== null,
          ),
      refreshSecret,
      sessionId,
      familyId,
    };
  }

  private accessResponse(
    principal: BrowserSessionPrincipal,
    claims: AuthorizedSessionClaims,
    sessionId: BrowserSessionId,
    user: BrowserAuthResponseDto['user'],
  ): BrowserAuthResponseDto {
    return {
      user,
      accessToken: this.jwtKeysService.signToken(
        {
          ...principal.claims,
          sub: principal.userId,
          token_use: 'access',
          sid: sessionId,
          currentOrgId: claims.currentOrganizationId,
          orgMemberships: claims.memberships,
        } satisfies JwtPayload,
        { expiresIn: this.accessTtlSeconds, jwtid: randomUUID() },
      ),
      expiresIn: this.accessTtlSeconds,
    };
  }

  async accountDefaultOrganization(
    accessToken: string | undefined,
    requestedOrganizationId?: OrganizationId,
  ): Promise<AccountDefaultOrganizationDto> {
    const binding = this.validAccessSessionBinding(accessToken);
    if (!binding || !accessToken)
      throw new UnauthorizedException('Valid browser session required');
    const payload = this.jwtKeysService.verifyToken(accessToken) as JwtPayload;
    return this.prisma.db.$transaction(async (tx) => {
      const { organizationId, decisionAt } = await this.lockPreferenceSession(
        tx,
        binding,
        payload,
      );
      const user = await tx.user.findUniqueOrThrow({
        where: { id: binding.userId },
        include: { memberships: { where: { isActive: true } } },
      });
      if (!user.isActive)
        throw new UnauthorizedException('Account is inactive');
      const claims = await this.resolveAuthorizedSessionClaims(
        tx,
        user.memberships.map((membership) => ({
          orgId: membership.organizationId as OrganizationId,
          role: membership.role as OrganizationRole,
        })),
        organizationId,
        decisionAt,
        false,
      );
      if (
        !claims.currentOrganizationId ||
        (requestedOrganizationId !== undefined &&
          requestedOrganizationId !== claims.currentOrganizationId)
      ) {
        throw new ForbiddenException(
          'Default must match the currently authorized organization',
        );
      }
      if (requestedOrganizationId !== undefined) {
        await tx.user.update({
          where: { id: binding.userId },
          data: { defaultOrganizationId: requestedOrganizationId },
        });
      }
      return {
        organizationId: requestedOrganizationId ?? user.defaultOrganizationId,
      } satisfies AccountDefaultOrganizationDto;
    });
  }

  private async lockPreferenceSession(
    tx: AnyTransactionClient,
    binding: { userId: UserId; sessionId: BrowserSessionId },
    payload: JwtPayload,
  ): Promise<{ organizationId: OrganizationId; decisionAt: Date }> {
    const sessions = await tx.$queryRaw<
      Array<{
        currentOrganizationId: string | null;
        inactivityExpiresAt: Date;
        absoluteExpiresAt: Date;
        revokedAt: Date | null;
      }>
    >`
      SELECT family."current_organization_id" AS "currentOrganizationId",
        family."inactivity_expires_at" AS "inactivityExpiresAt",
        family."absolute_expires_at" AS "absoluteExpiresAt",
        family."revoked_at" AS "revokedAt"
      FROM "browser_session_families" family
      WHERE family."session_id" = ${binding.sessionId}
        AND family."user_id" = ${binding.userId}
      FOR UPDATE OF family
    `;
    const session = sessions[0];
    const decisionAt = await this.getDatabaseTimestamp(tx);
    if (
      !session ||
      session.revokedAt ||
      typeof payload.exp !== 'number' ||
      payload.exp * 1000 <= decisionAt.getTime() ||
      session.inactivityExpiresAt <= decisionAt ||
      session.absoluteExpiresAt <= decisionAt ||
      !session.currentOrganizationId ||
      session.currentOrganizationId !== payload.currentOrgId
    ) {
      throw new UnauthorizedException(
        'Browser session choice is no longer current',
      );
    }
    return {
      organizationId: session.currentOrganizationId as OrganizationId,
      decisionAt,
    };
  }

  async refresh(
    operation: RefreshBrowserSessionOperation,
  ): Promise<BrowserSessionRotationResult> {
    if (
      typeof operation.presentedSecret !== 'string' ||
      operation.presentedSecret.length === 0
    ) {
      return { status: 'not_found' };
    }

    const replacementSecret =
      randomBytes(REFRESH_SECRET_BYTES).toString('base64url');
    const replacementSecretHash = createHash('sha256')
      .update(replacementSecret)
      .digest('hex') as RefreshSecretHash;
    const rotationOperation: RotateBrowserSessionOperation = {
      presentedSecretHash: createHash('sha256')
        .update(operation.presentedSecret)
        .digest('hex') as RefreshSecretHash,
      replacementGenerationId: randomUUID() as RefreshGenerationId,
      replacementSecretHash,
      requestMetadata: this.boundRequestMetadata(operation.requestMetadata),
      requestedOrganizationId: operation.requestedOrganizationId,
    };

    const result = await this.prisma.db.$transaction(async (tx) =>
      this.rotateInTransaction(tx, rotationOperation, replacementSecret),
    );

    if (result.status === 'replay_detected') {
      this.logger.warn('Browser refresh replay detected', {
        eventType: 'BROWSER_REFRESH_REPLAY_DETECTED',
        severity: 'HIGH',
        userId: result.userId,
        sessionId: result.sessionId,
        familyId: result.familyId,
        generation: result.generation,
      });
      this.invalidateBrowserSession(result.sessionId);
    }

    if (result.status === 'rotated') {
      this.logger.log('Browser session refreshed', {
        userId: result.userId,
        selectedOrganizationId: result.response.user.currentOrganizationId,
        organizationSelection:
          'status' in result.response
            ? result.response.status
            : operation.requestedOrganizationId
              ? 'requested_authorized'
              : 'session_preserved',
        sessionId: result.sessionId,
        familyId: result.familyId,
        generation: result.generation,
      });
    }

    return result;
  }

  async logout(
    operation: LogoutBrowserSessionOperation,
  ): Promise<BrowserSessionRevocationResult> {
    this.boundRequestMetadata(operation.requestMetadata);
    const refreshHash =
      typeof operation.presentedRefreshSecret === 'string' &&
      operation.presentedRefreshSecret.length > 0
        ? (createHash('sha256')
            .update(operation.presentedRefreshSecret)
            .digest('hex') as RefreshSecretHash)
        : undefined;
    const accessBinding = this.validAccessSessionBinding(operation.accessToken);
    const now = new Date();

    const result = await this.prisma.db.$transaction(async (tx) => {
      if (refreshHash) {
        const refreshMatches = await tx.$queryRaw<LogoutBrowserSessionRow[]>`
          SELECT
            family."id" AS "familyRowId",
            family."family_id" AS "familyId",
            family."session_id" AS "sessionId",
            family."revoked_at" AS "revokedAt"
          FROM "refresh_generations" AS generation
          INNER JOIN "browser_session_families" AS family
            ON family."id" = generation."browser_session_family_id"
          WHERE generation."secret_hash" = ${refreshHash}
          FOR UPDATE OF family
        `;
        const refreshMatch = refreshMatches[0];
        if (refreshMatch) {
          return this.revokeLogoutMatch(tx, refreshMatch, now);
        }
      }

      if (accessBinding) {
        const accessMatches = await tx.$queryRaw<LogoutBrowserSessionRow[]>`
          SELECT
            family."id" AS "familyRowId",
            family."family_id" AS "familyId",
            family."session_id" AS "sessionId",
            family."revoked_at" AS "revokedAt"
          FROM "browser_session_families" AS family
          WHERE family."session_id" = ${accessBinding.sessionId}
            AND family."user_id" = ${accessBinding.userId}
          FOR UPDATE OF family
        `;
        const accessMatch = accessMatches[0];
        if (accessMatch) {
          return this.revokeLogoutMatch(tx, accessMatch, now);
        }
      }

      return {
        revokedFamilyIds: [],
        revokedSessionIds: [],
      } satisfies BrowserSessionRevocationResult;
    });

    this.invalidateRevokedSessions(result.revokedSessionIds);
    this.logger.log('Browser logout resolved', {
      resolution: result.revokedSessionIds.length > 0 ? 'revoked' : 'no_change',
      revokedSessionCount: result.revokedSessionIds.length,
    });
    return result;
  }

  async revokeAllForUserInTransaction(
    tx: AnyTransactionClient,
    userId: UserId,
    revokedAt: Date,
    reason: string,
  ): Promise<BrowserSessionRevocationResult> {
    const matches = await tx.$queryRaw<RevocableBrowserSessionRow[]>`
      SELECT
        family."id" AS "familyRowId",
        family."family_id" AS "familyId",
        family."session_id" AS "sessionId"
      FROM "browser_session_families" AS family
      WHERE family."user_id" = ${userId}
        AND family."revoked_at" IS NULL
      ORDER BY family."id"
      FOR UPDATE OF family
    `;

    if (matches.length > 0) {
      await tx.browserSessionFamily.updateMany({
        where: {
          id: {
            in: matches.map(
              (match: RevocableBrowserSessionRow) => match.familyRowId,
            ),
          },
        },
        data: { revokedAt, revocationReason: reason },
      });
    }

    return {
      revokedFamilyIds: matches.map(
        (match: RevocableBrowserSessionRow) =>
          match.familyId as BrowserSessionFamilyId,
      ),
      revokedSessionIds: matches.map(
        (match: RevocableBrowserSessionRow) =>
          match.sessionId as BrowserSessionId,
      ),
    };
  }

  invalidateRevokedSessions(sessionIds: BrowserSessionId[]): void {
    for (const sessionId of sessionIds) {
      this.invalidateBrowserSession(sessionId);
    }
  }

  private async revokeLogoutMatch(
    tx: AnyTransactionClient,
    match: LogoutBrowserSessionRow,
    revokedAt: Date,
  ): Promise<BrowserSessionRevocationResult> {
    if (match.revokedAt) {
      return { revokedFamilyIds: [], revokedSessionIds: [] };
    }

    await tx.browserSessionFamily.update({
      where: { id: match.familyRowId },
      data: {
        revokedAt,
        revocationReason: 'logout',
      },
    });
    return {
      revokedFamilyIds: [match.familyId as BrowserSessionFamilyId],
      revokedSessionIds: [match.sessionId as BrowserSessionId],
    };
  }

  private validAccessSessionBinding(
    accessToken: string | undefined,
  ): { userId: UserId; sessionId: BrowserSessionId } | undefined {
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      return undefined;
    }

    try {
      const payload = this.jwtKeysService.verifyToken(
        accessToken,
      ) as JwtPayload;
      if (
        payload.token_use !== 'access' ||
        typeof payload.sub !== 'string' ||
        payload.sub.length === 0 ||
        typeof payload.sid !== 'string' ||
        payload.sid.length === 0
      ) {
        return undefined;
      }
      return {
        userId: payload.sub as UserId,
        sessionId: payload.sid as BrowserSessionId,
      };
    } catch {
      return undefined;
    }
  }

  private async rotateInTransaction(
    tx: AnyTransactionClient,
    operation: RotateBrowserSessionOperation,
    replacementSecret: string,
  ): Promise<BrowserSessionRotationResult> {
    const matches = await tx.$queryRaw<LockedBrowserSessionRow[]>`
      SELECT
        generation."id" AS "generationId",
        generation."generation" AS "generation",
        generation."consumed_at" AS "consumedAt",
        family."id" AS "familyRowId",
        family."family_id" AS "familyId",
        family."session_id" AS "sessionId",
        family."user_id" AS "userId",
        family."inactivity_expires_at" AS "inactivityExpiresAt",
        family."absolute_expires_at" AS "absoluteExpiresAt",
        family."revoked_at" AS "revokedAt",
        account."is_active" AS "userIsActive",
        family."current_organization_id" AS "currentOrganizationId"
      FROM "refresh_generations" AS generation
      INNER JOIN "browser_session_families" AS family
        ON family."id" = generation."browser_session_family_id"
      INNER JOIN "users" AS account
        ON account."id" = family."user_id"
      WHERE generation."secret_hash" = ${operation.presentedSecretHash}
      FOR UPDATE OF generation, family, account
    `;

    const match = matches[0];
    if (!match) {
      return { status: 'not_found' };
    }

    const decisionAt = await this.getDatabaseTimestamp(tx);

    const familyId = match.familyId as BrowserSessionFamilyId;
    const sessionId = match.sessionId as BrowserSessionId;
    const userId = match.userId as UserId;

    if (match.revokedAt) {
      return { status: 'revoked' };
    }

    if (match.consumedAt !== null && match.consumedAt !== undefined) {
      await this.revokeFamily(
        tx,
        match.familyRowId,
        decisionAt,
        'refresh_replay',
      );
      return {
        status: 'replay_detected',
        userId,
        sessionId,
        familyId,
        generation: match.generation as RefreshGenerationNumber,
      };
    }

    if (!match.userIsActive) {
      await this.revokeFamily(
        tx,
        match.familyRowId,
        decisionAt,
        'user_inactive',
      );
      return { status: 'inactive' };
    }

    const absoluteExpiresAt = new Date(match.absoluteExpiresAt);
    if (decisionAt.getTime() >= absoluteExpiresAt.getTime()) {
      await this.revokeFamily(
        tx,
        match.familyRowId,
        decisionAt,
        'absolute_expired',
      );
      return { status: 'absolutely_expired' };
    }

    const inactivityExpiresAt = new Date(match.inactivityExpiresAt);
    if (decisionAt.getTime() >= inactivityExpiresAt.getTime()) {
      await this.revokeFamily(
        tx,
        match.familyRowId,
        decisionAt,
        'inactivity_expired',
      );
      return { status: 'revoked' };
    }

    const user = await tx.user.findUnique({
      where: { id: match.userId },
      include: {
        memberships: {
          where: { isActive: true },
          include: { organization: true },
        },
      },
    });

    if (!user || !user.isActive) {
      await this.revokeFamily(
        tx,
        match.familyRowId,
        decisionAt,
        'user_inactive',
      );
      return { status: 'inactive' };
    }

    const nextInactivityExpiresAt = new Date(
      Math.min(
        decisionAt.getTime() + this.inactivityTtlSeconds * 1000,
        absoluteExpiresAt.getTime(),
      ),
    );
    const memberships = user.memberships as Array<{
      organizationId: string;
      role: OrganizationRole;
    }>;
    const authorizedClaims = await this.resolveAuthorizedSessionClaims(
      tx,
      memberships.map((membership) => ({
        orgId: membership.organizationId as OrganizationId,
        role: membership.role,
      })),
      operation.requestedOrganizationId ??
        (match.currentOrganizationId as OrganizationId | null) ??
        undefined,
      decisionAt,
      false,
    );
    const userResponse = {
      id: user.id as UserId,
      email: user.email,
      name: user.name,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      currentOrganizationId: authorizedClaims.currentOrganizationId ?? null,
    } satisfies BrowserAuthResponseDto['user'];

    await tx.refreshGeneration.update({
      where: { id: match.generationId },
      data: { consumedAt: decisionAt },
    });
    await tx.refreshGeneration.create({
      data: {
        id: operation.replacementGenerationId,
        browserSessionFamilyId: match.familyRowId,
        generation: match.generation + 1,
        secretHash: operation.replacementSecretHash,
        issuedAt: decisionAt,
      },
    });
    await tx.browserSessionFamily.update({
      where: { id: match.familyRowId },
      data: {
        lastUsedAt: decisionAt,
        inactivityExpiresAt: nextInactivityExpiresAt,
        currentOrganizationId: authorizedClaims.currentOrganizationId ?? null,
        ...(operation.requestMetadata.ipAddress
          ? { lastUsedIpAddress: operation.requestMetadata.ipAddress }
          : {}),
        ...(operation.requestMetadata.userAgent
          ? { lastUsedUserAgent: operation.requestMetadata.userAgent }
          : {}),
      },
    });

    if (!authorizedClaims.currentOrganizationId) {
      return {
        status: 'rotated',
        response: await this.selectionResponse(
          tx,
          userResponse,
          authorizedClaims,
          operation.requestedOrganizationId !== undefined ||
            match.currentOrganizationId != null,
        ),
        refreshSecret: replacementSecret,
        userId,
        sessionId,
        familyId,
        generation: (match.generation + 1) as RefreshGenerationNumber,
        inactivityExpiresAt: nextInactivityExpiresAt,
        absoluteExpiresAt,
      };
    }

    const accessToken = this.jwtKeysService.signToken(
      {
        sub: user.id,
        token_use: 'access',
        sid: sessionId,
        email: user.email,
        name: user.name,
        currentOrgId: authorizedClaims.currentOrganizationId,
        orgMemberships: authorizedClaims.memberships,
        isDevAdmin: user.isDevAdmin,
        devAdminMode: user.devAdminMode,
      } satisfies JwtPayload,
      {
        expiresIn: this.accessTtlSeconds,
        jwtid: randomUUID(),
      },
    );

    return {
      status: 'rotated',
      response: {
        user: userResponse,
        accessToken,
        expiresIn: this.accessTtlSeconds,
      } satisfies BrowserAuthResponseDto,
      refreshSecret: replacementSecret,
      userId,
      sessionId,
      familyId,
      generation: (match.generation + 1) as RefreshGenerationNumber,
      inactivityExpiresAt: nextInactivityExpiresAt,
      absoluteExpiresAt,
    };
  }

  private async resolveAuthorizedSessionClaims(
    tx: AnyTransactionClient,
    memberships: readonly SessionMembership[],
    requestedCurrentOrganizationId: OrganizationId | undefined,
    now: Date,
    autoSelectSoleOrganization: boolean,
  ): Promise<AuthorizedSessionClaims> {
    const ordered = [
      ...new Map(
        memberships.map((membership) => [membership.orgId, membership]),
      ).values(),
    ].sort((left, right) => left.orgId.localeCompare(right.orgId));
    if (ordered.length === 0) {
      return { memberships: [] };
    }
    const authorizedOrganizationIds =
      await this.accountEntitlementService.getAuthorizedOrganizationIds(
        ordered.map((membership) => membership.orgId),
        now,
        tx,
      );
    const authorizedMemberships = ordered.filter((membership) =>
      authorizedOrganizationIds.has(membership.orgId),
    );
    const requestedMembership = authorizedMemberships.find(
      (membership) => membership.orgId === requestedCurrentOrganizationId,
    );
    const currentOrganizationId = requestedMembership
      ? requestedMembership.orgId
      : autoSelectSoleOrganization && authorizedMemberships.length === 1
        ? authorizedMemberships[0]?.orgId
        : undefined;

    return {
      memberships: authorizedMemberships,
      currentOrganizationId,
    };
  }

  private async selectionResponse(
    tx: AnyTransactionClient,
    user: BrowserAuthResponseDto['user'],
    claims: AuthorizedSessionClaims,
    denied: boolean,
  ): Promise<BrowserOrganizationSelectionDto> {
    const organizations = await tx.organization.findMany({
      where: { id: { in: claims.memberships.map(({ orgId }) => orgId) } },
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
    });
    return {
      status: denied ? 'selection_denied' : 'selection_required',
      user: { ...user, currentOrganizationId: null },
      organizations,
    } satisfies BrowserOrganizationSelectionDto;
  }

  private async revokeFamily(
    tx: AnyTransactionClient,
    familyRowId: string,
    decisionAt: Date,
    reason: string,
  ): Promise<void> {
    await tx.browserSessionFamily.update({
      where: { id: familyRowId },
      data: {
        revokedAt: decisionAt,
        revocationReason: reason,
      },
    });
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

  private invalidateBrowserSession(sessionId: BrowserSessionId): void {
    if (!this.moduleRef) {
      return;
    }

    try {
      this.moduleRef
        .get(WebsocketUserConnectionLifecycleService, { strict: false })
        ?.invalidateSession(sessionId);
    } catch (error) {
      this.logger.error('Browser session lifecycle invalidation failed', {
        sessionId,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
    }
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

  private requiredPositiveInteger(key: string): number {
    const rawValue = this.configService.get<string | number>(key);
    const normalized =
      typeof rawValue === 'number' ? rawValue : rawValue?.trim();
    const value = Number(normalized);

    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${key} must be a configured positive integer`);
    }

    return value;
  }
}
