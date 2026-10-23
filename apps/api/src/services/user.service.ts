import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { OrganizationId, PrivateBetaAccessRequestId, UserId } from 'src/types';
import { RegisterDto, UserResponseDto } from '../generated';
import type { PrivateBetaAccessProvisioningFailureCode } from '../generated';
import { AnyTransactionClient, PrismaService } from '../prisma/prisma.service';
import { BrowserSessionRequestMetadata } from '../auth/browser-session.types';
import {
  PASSWORD_CHANGE_CREDENTIAL_ISSUER,
  PasswordChangeCredentialKind,
  PasswordChangeCredentialIssuer,
} from '../auth/password-change-credential.types';
import { OrganizationService } from './organization.service';
import { AccountEntitlementService } from './account-entitlement.service';
import { toPrivateBetaProvisioningError } from './private-beta-provisioning-error';

export interface BetaOnboardingRequestState {
  id: PrivateBetaAccessRequestId;
  normalizedEmail: string;
  name: string;
  organizationName: string;
  status: string;
  provisionedUserId: UserId | null;
  provisionedOrganizationId: OrganizationId | null;
  provisioningUserCompletedAt: Date | null;
  provisioningOrganizationCompletedAt: Date | null;
  provisioningCredentialId: string | null;
  provisioningCredentialCompletedAt: Date | null;
  provisioningOrganizationApiKeyId: string | null;
  provisioningOrganizationApiKeyCompletedAt: Date | null;
  welcomeEmailIdempotencyKey: string | null;
  welcomeEmailSentAt: Date | null;
  provisioningCompletedAt: Date | null;
  provisioningError: string | null;
}

const BETA_ONBOARDING_REQUEST_SELECT = {
  id: true,
  normalizedEmail: true,
  name: true,
  organizationName: true,
  status: true,
  provisionedUserId: true,
  provisionedOrganizationId: true,
  provisioningUserCompletedAt: true,
  provisioningOrganizationCompletedAt: true,
  provisioningCredentialId: true,
  provisioningCredentialCompletedAt: true,
  provisioningOrganizationApiKeyId: true,
  provisioningOrganizationApiKeyCompletedAt: true,
  welcomeEmailIdempotencyKey: true,
  welcomeEmailSentAt: true,
  provisioningCompletedAt: true,
  provisioningError: true,
} as const;

type BetaOnboardingRequestRecord = Prisma.PrivateBetaAccessRequestGetPayload<{
  select: typeof BETA_ONBOARDING_REQUEST_SELECT;
}>;

const AUTHENTICATION_USER_SELECT = {
  email: true,
  name: true,
  isActive: true,
  isDevAdmin: true,
  devAdminMode: true,
  isDemoUser: true,
  memberships: {
    select: { organizationId: true, role: true, isActive: true },
  },
} satisfies Prisma.UserSelect;

type AuthenticationUser = Prisma.UserGetPayload<{
  select: typeof AUTHENTICATION_USER_SELECT;
}>;

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => OrganizationService))
    private organizationService: OrganizationService,
    private accountEntitlementService: AccountEntitlementService,
    private moduleRef: ModuleRef,
  ) {}

  async findById(id: string) {
    return this.prisma.db.user.findUnique({
      where: { id },
      include: {
        memberships: {
          include: {
            organization: true,
          },
        },
      },
    });
  }

  async findForAuthentication(id: string): Promise<AuthenticationUser | null> {
    return this.prisma.db.user.findUnique({
      where: { id },
      select: AUTHENTICATION_USER_SELECT,
    });
  }

  async findByEmail(email: string) {
    return this.prisma.db.user.findUnique({
      where: { email },
      include: {
        memberships: {
          include: {
            organization: true,
          },
        },
      },
    });
  }

  async create(data: RegisterDto): Promise<User> {
    // Hash the password with bcrypt (12 salt rounds)
    const hashedPassword = await bcrypt.hash(data.password, 12);

    // Create user and default organization in a transaction
    const result = await this.prisma.db.$transaction(async (tx) => {
      // Create the user
      const user = await tx.user.create({
        data: {
          email: data.email,
          name: data.name,
          passwordHash: hashedPassword,
        },
      });

      // Create organization with system user using OrganizationService
      const orgName = data.organizationName || `${data.name}'s Organization`;
      await this.organizationService.createOrganizationWithTransaction(
        tx,
        {
          name: orgName,
          description: `Default organization for ${data.name}`,
          slug: data.organizationName,
        },
        user.id,
      );

      return user;
    });

    return result;
  }

  async validatePassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash);
  }

  async replaceCurrentPasswordInTransaction(
    tx: AnyTransactionClient,
    userId: UserId,
    currentPassword: string,
    newPassword: string,
  ) {
    // Raw SQL only takes the row lock: $queryRaw returns snake_case columns,
    // so mapped fields must be read through the Prisma client.
    await tx.$queryRaw`
      SELECT "id"
      FROM "users"
      WHERE "id" = ${userId}
      FOR UPDATE
    `;
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { isActive: true, passwordHash: true },
    });

    if (!user || !user.isActive) {
      this.logger.warn(
        `Password replacement rejected for user ${userId}: user missing or inactive`,
      );
      throw new UnauthorizedException('Invalid current password');
    }

    const currentPasswordMatches = await bcrypt.compare(
      currentPassword,
      user.passwordHash,
    );
    if (!currentPasswordMatches) {
      this.logger.warn(
        `Password replacement rejected for user ${userId}: current password mismatch`,
      );
      throw new UnauthorizedException('Invalid current password');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    this.logger.log(`Replacing current password for user ${userId}`);
    return tx.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        mustChangePassword: false,
      },
      include: {
        memberships: {
          where: { isActive: true },
          include: { organization: true },
        },
      },
    });
  }

  async getUserWithOrganizations(userId: UserId): Promise<UserResponseDto> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          where: { isActive: true },
          include: {
            organization: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Get the first active organization as current (or could be user preference)
    const currentOrganization = user.memberships[0]?.organization;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt?.toISOString() || null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      currentOrganizationId: currentOrganization?.id || null,
    };
  }

  async updateLastLogin(userId: UserId): Promise<void> {
    await this.prisma.db.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }

  async updateDevAdminMode(
    userId: UserId,
    devAdminMode: boolean,
  ): Promise<void> {
    await this.prisma.db.user.update({
      where: { id: userId },
      data: { devAdminMode },
    });
  }

  /**
   * Create a beta user with an internal bootstrap password and return a
   * purpose-specific password-change credential for the welcome email.
   */
  async createBetaUser(
    data: {
      email: string;
      name: string;
      organizationName: string;
    },
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<{
    user: User;
    organizationId: OrganizationId;
    passwordChangeCredential: string;
  }> {
    const bootstrapPassword = crypto.randomBytes(12).toString('base64url');
    const hashedPassword = await bcrypt.hash(bootstrapPassword, 12);

    const result = await this.prisma.db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: data.email,
          name: data.name,
          passwordHash: hashedPassword,
          mustChangePassword: true,
        },
      });

      const org =
        await this.organizationService.createOrganizationWithTransaction(
          tx,
          {
            name: data.organizationName,
            description: `Organization for ${data.name}`,
          },
          user.id,
        );

      const passwordChangeCredential =
        await this.passwordChangeCredentialService().issueInTransaction(
          tx,
          user.id as UserId,
          PasswordChangeCredentialKind.RequiredChange,
          requestMetadata,
        );

      return {
        user,
        organizationId: org.id as OrganizationId,
        passwordChangeCredential,
      };
    });

    this.logger.log(
      `Created beta user ${result.user.id} in org ${result.organizationId}`,
    );

    return result;
  }

  async getBetaOnboardingRequest(
    requestId: PrivateBetaAccessRequestId,
  ): Promise<BetaOnboardingRequestState> {
    const request = await this.prisma.db.privateBetaAccessRequest.findUnique({
      where: { id: requestId },
      select: BETA_ONBOARDING_REQUEST_SELECT,
    });

    if (!request) {
      throw new NotFoundException('Private-beta access request not found');
    }

    return this.toBetaOnboardingRequestState(request);
  }

  async createOrResumeBetaUserForRequest(
    requestId: PrivateBetaAccessRequestId,
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<{
    request: BetaOnboardingRequestState;
    user: User;
    organizationId: OrganizationId;
    passwordChangeCredential: string;
  }> {
    const userStage = await this.runPrivateBetaProvisioningStage(
      'USER_PROVISIONING',
      () =>
        this.prisma.db.$transaction(async (tx: AnyTransactionClient) => {
          const request = await this.readLockedBetaOnboardingRequest(
            tx,
            requestId,
          );
          let user: User;

          if (request.provisionedUserId) {
            if (!request.provisioningUserCompletedAt) {
              throw new Error(
                'Private-beta user checkpoint is missing its completion timestamp',
              );
            }
            const existingUser = await tx.user.findUnique({
              where: { id: request.provisionedUserId },
            });
            if (!existingUser) {
              throw new Error(
                'Private-beta user checkpoint points to a missing user',
              );
            }
            user = existingUser;
            this.logger.debug('Private-beta user checkpoint reused', {
              requestId,
              userId: user.id,
            });
          } else {
            if (request.provisioningUserCompletedAt) {
              throw new Error(
                'Private-beta user completion checkpoint has no user',
              );
            }
            const existingUser = await tx.user.findFirst({
              where: {
                email: { equals: request.normalizedEmail, mode: 'insensitive' },
              },
            });
            if (existingUser) {
              throw new ConflictException(
                'Private-beta request cannot adopt an existing user',
              );
            }

            const bootstrapPassword = crypto
              .randomBytes(12)
              .toString('base64url');
            const hashedPassword = await bcrypt.hash(bootstrapPassword, 12);
            user = await tx.user.create({
              data: {
                email: request.normalizedEmail,
                name: request.name,
                passwordHash: hashedPassword,
                mustChangePassword: true,
              },
            });
            await tx.privateBetaAccessRequest.update({
              where: { id: requestId },
              data: {
                provisionedUserId: user.id,
                provisioningUserCompletedAt: new Date(),
              },
            });
            this.logger.debug(
              'Private-beta user resource and checkpoint committed',
              {
                requestId,
                userId: user.id,
              },
            );
          }

          return {
            request: await this.readLockedBetaOnboardingRequest(tx, requestId),
            user,
          };
        }),
    );

    const organizationStage = await this.runPrivateBetaProvisioningStage(
      'ORGANIZATION_PROVISIONING',
      () =>
        this.prisma.db.$transaction(async (tx: AnyTransactionClient) => {
          const request = await this.readLockedBetaOnboardingRequest(
            tx,
            requestId,
          );
          if (!request.provisionedUserId) {
            throw new Error(
              'Private-beta organization stage has no user checkpoint',
            );
          }
          if (request.provisionedUserId !== userStage.user.id) {
            throw new Error(
              'Private-beta user checkpoint changed during provisioning',
            );
          }

          let organizationId: OrganizationId;
          if (request.provisionedOrganizationId) {
            if (!request.provisioningOrganizationCompletedAt) {
              throw new Error(
                'Private-beta organization checkpoint is missing its completion timestamp',
              );
            }
            const existingOrganization = await tx.organization.findUnique({
              where: { id: request.provisionedOrganizationId },
            });
            if (!existingOrganization) {
              throw new Error(
                'Private-beta organization checkpoint points to a missing organization',
              );
            }
            organizationId = existingOrganization.id as OrganizationId;
            this.logger.debug('Private-beta organization checkpoint reused', {
              requestId,
              organizationId,
            });
          } else {
            if (request.provisioningOrganizationCompletedAt) {
              throw new Error(
                'Private-beta organization completion checkpoint has no organization',
              );
            }
            const organization =
              await this.organizationService.createOrganizationWithTransaction(
                tx,
                {
                  name: request.organizationName,
                  description: `Organization for ${request.name}`,
                },
                userStage.user.id as UserId,
              );
            organizationId = organization.id as OrganizationId;
            await tx.privateBetaAccessRequest.update({
              where: { id: requestId },
              data: {
                provisionedOrganizationId: organizationId,
                provisioningOrganizationCompletedAt: new Date(),
              },
            });
            this.logger.debug(
              'Private-beta organization resource and checkpoint committed',
              { requestId, organizationId },
            );
          }

          await this.accountEntitlementService.createBetaAtAdmissionInTransaction(
            tx,
            organizationId,
            {
              actor: request.provisionedUserId,
              reason: `PRIVATE_BETA_ADMISSION:${requestId}`,
            },
          );

          return {
            request: await this.readLockedBetaOnboardingRequest(tx, requestId),
            organizationId,
          };
        }),
    );

    const credentialStage = await this.runPrivateBetaProvisioningStage(
      'CREDENTIAL_PROVISIONING',
      () =>
        this.prisma.db.$transaction(async (tx: AnyTransactionClient) => {
          const request = await this.readLockedBetaOnboardingRequest(
            tx,
            requestId,
          );
          if (
            !request.provisionedUserId ||
            !request.provisionedOrganizationId
          ) {
            throw new Error(
              'Private-beta credential stage is missing a resource checkpoint',
            );
          }
          if (
            request.provisioningCredentialId &&
            !request.provisioningCredentialCompletedAt
          ) {
            throw new Error(
              'Private-beta credential checkpoint is missing its completion timestamp',
            );
          }

          const credential = await tx.passwordChangeCredential.findUnique({
            where: { privateBetaAccessRequestId: requestId },
            select: { id: true },
          });
          if (
            request.provisioningCredentialId &&
            (!credential || credential.id !== request.provisioningCredentialId)
          ) {
            throw new Error(
              'Private-beta credential checkpoint points to a missing credential',
            );
          }

          const passwordChangeCredential =
            await this.passwordChangeCredentialService().issueIdempotentlyInTransaction(
              tx,
              request.provisionedUserId as UserId,
              requestId,
              requestMetadata,
            );
          const issuedCredential = await tx.passwordChangeCredential.findUnique(
            {
              where: { privateBetaAccessRequestId: requestId },
              select: { id: true },
            },
          );
          if (!issuedCredential) {
            throw new Error(
              'Private-beta credential issuance did not create a checkpoint',
            );
          }

          if (!request.provisioningCredentialId) {
            await tx.privateBetaAccessRequest.update({
              where: { id: requestId },
              data: {
                provisioningCredentialId: issuedCredential.id,
                provisioningCredentialCompletedAt: new Date(),
              },
            });
          }

          return {
            request: await this.readLockedBetaOnboardingRequest(tx, requestId),
            passwordChangeCredential,
          };
        }),
    );

    const result = {
      request: this.toBetaOnboardingRequestState(credentialStage.request),
      user: userStage.user,
      organizationId: organizationStage.organizationId,
      passwordChangeCredential: credentialStage.passwordChangeCredential,
    };

    this.logger.debug(
      'Private-beta user, organization, and credential checkpoints committed',
      {
        requestId,
        userId: result.user.id,
        organizationId: result.organizationId,
      },
    );
    return result;
  }

  private async runPrivateBetaProvisioningStage<T>(
    code: PrivateBetaAccessProvisioningFailureCode,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw toPrivateBetaProvisioningError(code, error);
    }
  }

  private async readLockedBetaOnboardingRequest(
    tx: AnyTransactionClient,
    requestId: PrivateBetaAccessRequestId,
  ): Promise<BetaOnboardingRequestRecord> {
    const lockedRequests = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT request."id"
      FROM "private_beta_access_requests" AS request
      WHERE request."id" = ${requestId}
      FOR UPDATE OF request
    `;
    if (lockedRequests.length === 0) {
      throw new NotFoundException('Private-beta access request not found');
    }

    const request = await tx.privateBetaAccessRequest.findUnique({
      where: { id: requestId },
      select: BETA_ONBOARDING_REQUEST_SELECT,
    });
    if (!request) {
      throw new NotFoundException('Private-beta access request not found');
    }

    this.logger.debug('Private-beta provisioning checkpoints read', {
      requestId,
      hasUser: request.provisionedUserId !== null,
      hasOrganization: request.provisionedOrganizationId !== null,
      hasCredential: request.provisioningCredentialId !== null,
    });
    return request;
  }

  async recordBetaOnboardingApiKey(
    requestId: PrivateBetaAccessRequestId,
    apiKeyId: string,
  ): Promise<void> {
    await this.prisma.db.$transaction(async (tx: AnyTransactionClient) => {
      await tx.$queryRaw`
        SELECT request."id"
        FROM "private_beta_access_requests" AS request
        WHERE request."id" = ${requestId}
        FOR UPDATE OF request
      `;
      const request = await tx.privateBetaAccessRequest.findUnique({
        where: { id: requestId },
        select: { provisioningOrganizationApiKeyId: true },
      });
      if (!request) {
        throw new NotFoundException('Private-beta access request not found');
      }
      if (
        request.provisioningOrganizationApiKeyId &&
        request.provisioningOrganizationApiKeyId !== apiKeyId
      ) {
        throw new Error(
          'Private-beta API-key checkpoint does not match its request identity',
        );
      }
      if (!request.provisioningOrganizationApiKeyId) {
        await tx.privateBetaAccessRequest.update({
          where: { id: requestId },
          data: {
            provisioningOrganizationApiKeyId: apiKeyId,
            provisioningOrganizationApiKeyCompletedAt: new Date(),
          },
        });
      }
    });
    this.logger.debug('Private-beta organization API-key checkpoint recorded', {
      requestId,
      apiKeyId,
    });
  }

  async markBetaWelcomeEmailSent(
    requestId: PrivateBetaAccessRequestId,
    idempotencyKey: string,
  ): Promise<void> {
    await this.prisma.db.privateBetaAccessRequest.update({
      where: { id: requestId },
      data: {
        welcomeEmailIdempotencyKey: idempotencyKey,
        welcomeEmailSentAt: new Date(),
        provisioningCompletedAt: new Date(),
        provisioningFailureCode: null,
        provisioningError: null,
        status: 'APPROVED',
      },
    });
    this.logger.debug('Private-beta welcome-email checkpoint recorded', {
      requestId,
    });
  }

  /**
   * Create a User row inside an existing transaction for the
   * invite-to-organization flow. Unlike createBetaUser this does NOT create
   * an Organization or API key — the caller already has the org. Returns the
   * created User plus a purpose-specific password-change credential for the
   * welcome email. The random bootstrap password is never disclosed.
   */
  async createInvitedUser(
    tx: AnyTransactionClient,
    data: { email: string; name?: string },
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<{ user: User; passwordChangeCredential: string }> {
    const bootstrapPassword = crypto.randomBytes(12).toString('base64url');
    const hashedPassword = await bcrypt.hash(bootstrapPassword, 12);

    // InviteToOrganizationDto carries no name — derive a placeholder from the
    // email local-part so the non-null User.name column is satisfied. The
    // invited user can change it after their first login.
    const derivedName =
      data.name?.trim() || data.email.split('@')[0] || data.email;

    this.logger.debug('[createInvitedUser] creating invited user in tx', {
      email: data.email,
    });

    const user = await tx.user.create({
      data: {
        email: data.email,
        name: derivedName,
        passwordHash: hashedPassword,
        mustChangePassword: true,
      },
    });

    this.logger.log(
      `[createInvitedUser] created invited user ${user.id} for ${data.email}`,
    );

    const passwordChangeCredential =
      await this.passwordChangeCredentialService().issueInTransaction(
        tx,
        user.id as UserId,
        PasswordChangeCredentialKind.RequiredChange,
        requestMetadata,
      );

    return { user, passwordChangeCredential };
  }

  async updatePassword(userId: UserId, newPassword: string): Promise<void> {
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await this.prisma.db.user.update({
      where: { id: userId },
      data: {
        passwordHash: hashedPassword,
        mustChangePassword: false,
      },
    });
    this.logger.log(`Password updated for user ${userId}`);
  }

  async replaceRequiredPasswordInTransaction(
    tx: AnyTransactionClient,
    userId: UserId,
    newPassword: string,
  ) {
    const lockedUsers = await tx.$queryRaw<
      Array<{ id: string; isActive: boolean; mustChangePassword: boolean }>
    >`
      SELECT
        account."id",
        account."is_active" AS "isActive",
        account."must_change_password" AS "mustChangePassword"
      FROM "users" AS account
      WHERE account."id" = ${userId}
      FOR UPDATE OF account
    `;
    const lockedUser = lockedUsers[0];
    if (!lockedUser || !lockedUser.isActive || !lockedUser.mustChangePassword) {
      throw new UnauthorizedException(
        'Password change credential is not valid',
      );
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash: hashedPassword,
        mustChangePassword: false,
      },
      include: {
        memberships: {
          where: { isActive: true },
          include: { organization: true },
        },
      },
    });

    this.logger.log('Required password replaced', { userId });
    return updatedUser;
  }

  async replaceRecoveryPasswordInTransaction(
    tx: AnyTransactionClient,
    userId: UserId,
    newPassword: string,
  ) {
    const lockedUsers = await tx.$queryRaw<
      Array<{ id: string; isActive: boolean }>
    >`
      SELECT account."id", account."is_active" AS "isActive"
      FROM "users" AS account
      WHERE account."id" = ${userId}
      FOR UPDATE OF account
    `;
    const lockedUser = lockedUsers[0];
    if (!lockedUser?.isActive) {
      throw new UnauthorizedException(
        'Password change credential is not valid',
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false },
      include: {
        memberships: {
          where: { isActive: true },
          include: { organization: true },
        },
      },
    });
    this.logger.log('Recovery password replaced', { userId });
    return updatedUser;
  }

  private toBetaOnboardingRequestState(request: {
    id: string;
    normalizedEmail: string;
    name: string;
    organizationName: string;
    status: string;
    provisionedUserId: string | null;
    provisionedOrganizationId: string | null;
    provisioningUserCompletedAt: Date | null;
    provisioningOrganizationCompletedAt: Date | null;
    provisioningCredentialId: string | null;
    provisioningCredentialCompletedAt: Date | null;
    provisioningOrganizationApiKeyId: string | null;
    provisioningOrganizationApiKeyCompletedAt: Date | null;
    welcomeEmailIdempotencyKey: string | null;
    welcomeEmailSentAt: Date | null;
    provisioningCompletedAt: Date | null;
    provisioningError: string | null;
  }): BetaOnboardingRequestState {
    return {
      id: request.id as PrivateBetaAccessRequestId,
      normalizedEmail: request.normalizedEmail,
      name: request.name,
      organizationName: request.organizationName,
      status: request.status,
      provisionedUserId: request.provisionedUserId as UserId | null,
      provisionedOrganizationId:
        request.provisionedOrganizationId as OrganizationId | null,
      provisioningUserCompletedAt: request.provisioningUserCompletedAt,
      provisioningOrganizationCompletedAt:
        request.provisioningOrganizationCompletedAt,
      provisioningCredentialId: request.provisioningCredentialId,
      provisioningCredentialCompletedAt:
        request.provisioningCredentialCompletedAt,
      provisioningOrganizationApiKeyId:
        request.provisioningOrganizationApiKeyId,
      provisioningOrganizationApiKeyCompletedAt:
        request.provisioningOrganizationApiKeyCompletedAt,
      welcomeEmailIdempotencyKey: request.welcomeEmailIdempotencyKey,
      welcomeEmailSentAt: request.welcomeEmailSentAt,
      provisioningCompletedAt: request.provisioningCompletedAt,
      provisioningError: request.provisioningError,
    };
  }

  private passwordChangeCredentialService(): PasswordChangeCredentialIssuer {
    return this.moduleRef.get<PasswordChangeCredentialIssuer>(
      PASSWORD_CHANGE_CREDENTIAL_ISSUER,
      {
        strict: false,
      },
    );
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()
      .substring(0, 50);
  }
}
