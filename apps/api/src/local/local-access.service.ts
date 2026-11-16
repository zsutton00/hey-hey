import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  LocalBootstrapResponseDto,
  LocalCliCredentialsResponseDto,
  LocalSetupStatusDto,
} from '@hey-hey/contracts/api/models';
import { OrganizationId, UserId } from '../types';
import { AuthService } from '../auth/services/auth.service';
import {
  BrowserSessionService,
  EstablishedBrowserSession,
} from '../auth/services/browser-session.service';
import { BrowserSessionRequestMetadata } from '../auth/browser-session.types';
import { ACCESS_TOKEN_EXPIRES_IN } from '../auth/oauth/oauth.constants';
import { isLocalAccountEmail } from '../auth/local-account';
import { RedisService } from '../core/redis/redis.service';
import { isLocalApplication } from '../deployment-environment';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationService } from '../services/organization.service';
import type { PendingMachineEnrollment } from '@prisma/client';
import { UserService } from '../services/user.service';
import { LocalDefaultProjectService } from '../services/local-default-project.service';
import { LocalFirstPasskeyAuthority } from './local-first-passkey-authority';

/** A completed activation stays active after its original enrollment deadline. */
function localPairingState(
  enrollment: Pick<PendingMachineEnrollment, 'state' | 'expiresAt'> | null,
): NonNullable<LocalSetupStatusDto['pairingState']> {
  if (!enrollment) {
    return 'UNAVAILABLE';
  }
  if (enrollment.state === 'ACTIVE') {
    return 'ACTIVE';
  }
  if (enrollment.state === 'REJECTED') {
    return 'REJECTED';
  }
  if (
    enrollment.state === 'EXPIRED' ||
    enrollment.expiresAt.getTime() <= Date.now()
  ) {
    return 'EXPIRED';
  }
  if (enrollment.state === 'CONSUMED') {
    return 'UNAVAILABLE';
  }
  return 'WAITING';
}

/** Local installation account access: bootstrap, CLI handoff and setup status. */
@Injectable()
export class LocalAccessService {
  private readonly logger = new Logger(LocalAccessService.name);

  constructor(
    private readonly userService: UserService,
    private readonly organizationService: OrganizationService,
    private readonly authService: AuthService,
    private readonly browserSessionService: BrowserSessionService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly localDefaultProjectService: LocalDefaultProjectService,
    private readonly firstPasskeyAuthority: LocalFirstPasskeyAuthority,
  ) {}

  async createLocalHandoff(
    installationSecret: string | undefined,
  ): Promise<LocalBootstrapResponseDto> {
    this.assertLocalInstallationSecret(installationSecret);
    const user =
      await this.userService.createLocalBootstrapUser(installationSecret);
    const handoffToken = randomBytes(32).toString('base64url');
    const handoffKey = this.localHandoffKey(handoffToken);
    await this.redisService
      .getClient()
      .set(handoffKey, user.id, 'EX', 120, 'NX');
    const livePasskeys = await this.prisma.db.accountPasskey.count({
      where: { userId: user.id, revokedAt: null },
    });
    this.logger.log('Local browser handoff issued', {
      userId: user.id,
      livePasskeys,
    });

    return {
      handoffToken,
      expiresInSeconds: 120,
      accountHasPasskey: livePasskeys > 0,
    };
  }

  /** The local account the installation secret speaks for. */
  async localAccountUserId(
    installationSecret: string | undefined,
  ): Promise<UserId> {
    this.assertLocalInstallationSecret(installationSecret);
    const user =
      await this.userService.createLocalBootstrapUser(installationSecret);

    return user.id as UserId;
  }

  async issueLocalCliCredentials(
    installationSecret: string | undefined,
  ): Promise<LocalCliCredentialsResponseDto> {
    this.assertLocalInstallationSecret(installationSecret);
    const user =
      await this.userService.createLocalBootstrapUser(installationSecret);
    const tokens = await this.authService.generateTokensForUserId(
      user.id as UserId,
    );
    this.logger.log('Local CLI credentials issued', { userId: user.id });
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSeconds: ACCESS_TOKEN_EXPIRES_IN,
    };
  }

  async completeLocalHandoff(
    handoffToken: string,
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<EstablishedBrowserSession> {
    this.assertLocalApplication();
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(handoffToken)) {
      throw new UnauthorizedException('Local browser handoff expired');
    }
    const userId = await this.redisService
      .getClient()
      .getdel(this.localHandoffKey(handoffToken));
    if (!userId) {
      throw new UnauthorizedException('Local browser handoff expired');
    }
    const user = await this.userService.findForAuthentication(userId);
    if (!user || !isLocalAccountEmail(user.email) || !user.isActive) {
      throw new UnauthorizedException('Local browser handoff is unavailable');
    }
    const session = await this.establishBrowserSession(
      userId as UserId,
      requestMetadata,
    );
    await this.firstPasskeyAuthority.recordCliOpenedSession(session.sessionId);
    return session;
  }

  async updateLocalDisplayName(
    userId: UserId,
    name: string,
  ): Promise<LocalSetupStatusDto> {
    this.assertLocalApplication();
    await this.userService.updateLocalDisplayName(userId, name);
    // Pairing's first grant needs a project, so the name save creates it.
    await this.localDefaultProjectService.ensure(
      userId,
      await this.localOrganizationId(userId),
    );
    return this.getLocalStatus(userId);
  }

  async getLocalStatus(
    userId: UserId,
    enrollmentId?: string,
  ): Promise<LocalSetupStatusDto> {
    this.assertLocalApplication();
    const user = await this.userService.findForAuthentication(userId);
    if (!user || !isLocalAccountEmail(user.email)) {
      throw new UnauthorizedException('Local account is unavailable');
    }
    const organizationId = await this.localOrganizationId(userId);
    const enrollment = enrollmentId
      ? await this.prisma.db.pendingMachineEnrollment.findFirst({
          where: {
            id: enrollmentId,
            claimantUserId: userId,
            claimantOrganizationId: organizationId,
          },
          select: { machineId: true, state: true, expiresAt: true },
        })
      : null;
    const pairingState = enrollmentId
      ? localPairingState(enrollment)
      : undefined;
    const machines =
      enrollmentId && !enrollment
        ? []
        : await this.prisma.db.machine.findMany({
            where: {
              userId,
              organizationId,
              revokedAt: null,
              ...(enrollment ? { id: enrollment.machineId } : {}),
            },
            select: {
              id: true,
              authorizationProtocolVersion: true,
              authorizationState: true,
              controllerCredentials: { select: { revokedAt: true } },
            },
          });
    const hasProjects =
      (await this.localDefaultProjectService.findDefault(organizationId)) !==
      null;
    const setupProjectId =
      await this.localDefaultProjectService.findUnfinished(organizationId);
    const connected = await Promise.all(
      machines.map((machine) =>
        this.redisService
          .getClient()
          .exists(`machine:presence:${machine.id}`)
          .then((count) => count === 1),
      ),
    );
    const machineConnected =
      connected.some(Boolean) && (!enrollmentId || pairingState === 'ACTIVE');
    const executionReady =
      machineConnected &&
      machines.some(
        (machine, index) =>
          connected[index] === true &&
          machine.authorizationProtocolVersion === 2 &&
          machine.authorizationState === 'READY' &&
          machine.controllerCredentials.some(
            (credential) => !credential.revokedAt,
          ),
      );
    return {
      nameComplete: user.name.trim().length > 0,
      browserSession: true,
      machineConnected,
      executionReady,
      ...(pairingState ? { pairingState } : {}),
      hasProjects,
      setupProjectId,
    } satisfies LocalSetupStatusDto;
  }

  /** A local installation's account belongs to exactly one organization. */
  private async localOrganizationId(userId: UserId): Promise<OrganizationId> {
    const membership = await this.prisma.db.organizationMember.findFirstOrThrow(
      {
        where: { userId, isActive: true },
        select: { organizationId: true },
      },
    );
    return membership.organizationId as OrganizationId;
  }

  private async establishBrowserSession(
    userId: UserId,
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<EstablishedBrowserSession> {
    const user = await this.userService.findForAuthentication(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Local account is unavailable');
    }
    const userWithOrgs =
      await this.userService.getUserWithOrganizations(userId);
    const orgMemberships = [
      ...(await this.organizationService.getUserMemberships(userId)),
    ].sort((left, right) =>
      left.organizationId.localeCompare(right.organizationId),
    );
    const localUserResponse = {
      ...userWithOrgs,
      isLocalAccount: true,
    };
    return this.browserSessionService.establish(
      {
        userId,
        user: localUserResponse,
        claims: {
          email: user.email,
          name: user.name,
          orgMemberships: orgMemberships.map((membership) => ({
            orgId: membership.organizationId,
            role: membership.role,
          })),
          isDevAdmin: false,
          devAdminMode: false,
          isLocalAccount: true,
        },
      },
      requestMetadata,
    );
  }

  private assertLocalInstallationSecret(
    installationSecret: string | undefined,
  ): asserts installationSecret is string {
    this.assertLocalApplication();
    const expected = process.env.LOCAL_INSTALLATION_SECRET;
    if (
      !expected ||
      !installationSecret ||
      Buffer.byteLength(expected) !== Buffer.byteLength(installationSecret) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(installationSecret))
    ) {
      throw new UnauthorizedException('Local machine authority is required');
    }
  }

  private assertLocalApplication(): void {
    if (!isLocalApplication()) {
      throw new UnauthorizedException(
        'Local application access is unavailable',
      );
    }
  }

  private localHandoffKey(token: string): string {
    return `local:browser-handoff:${createHash('sha256').update(token).digest('hex')}`;
  }
}
