import {
  AccountAccessStatus,
  AccountEntitlement,
  AccountSubscriptionType,
  OrganizationAccountLifecycle,
  Prisma,
} from '@prisma/client';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationId } from '../types';

export interface AccountEntitlementAuditMetadata {
  actor: string;
  reason: string;
}

export interface AccountEntitlementTransitionInput {
  subscriptionType: AccountSubscriptionType;
  accessStatus: AccountAccessStatus;
  accessThroughAt: Date | null;
  paidThroughAt: Date | null;
}

export interface AccountAccessResolution {
  authorized: boolean;
  status: AccountAccessStatus;
  subscriptionType: AccountSubscriptionType | null;
  accessHorizon: Date | null;
  revision: number | null;
}

type ResolvableEntitlement = Pick<
  AccountEntitlement,
  | 'subscriptionType'
  | 'accessStatus'
  | 'accessThroughAt'
  | 'paidThroughAt'
  | 'revision'
>;

type ResolvableLifecycle = Pick<OrganizationAccountLifecycle, 'accessEndsAt'>;

type AccountEntitlementTransaction = Pick<
  Prisma.TransactionClient,
  | '$queryRaw'
  | 'accountEntitlement'
  | 'accountEntitlementTransition'
  | 'organizationAccountLifecycle'
>;

@Injectable()
export class AccountEntitlementService {
  private readonly logger = new Logger(AccountEntitlementService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createBetaAtAdmission(
    organizationId: OrganizationId,
    metadata: AccountEntitlementAuditMetadata,
  ): Promise<AccountEntitlement> {
    return this.prisma.$transaction((tx) =>
      this.createBetaAtAdmissionInTransaction(tx, organizationId, metadata),
    );
  }

  async assertBetaAdmissionEntitlement(
    organizationId: OrganizationId,
    metadata: AccountEntitlementAuditMetadata,
  ): Promise<AccountEntitlement> {
    this.validateMetadata(metadata);
    return this.prisma.$transaction((tx) =>
      this.assertBetaAdmissionEntitlementInTransaction(
        tx,
        organizationId,
        metadata,
      ),
    );
  }

  async createBetaAtAdmissionInTransaction(
    tx: AccountEntitlementTransaction,
    organizationId: OrganizationId,
    metadata: AccountEntitlementAuditMetadata,
  ): Promise<AccountEntitlement> {
    this.validateMetadata(metadata);
    const created = await tx.accountEntitlement.createMany({
      data: {
        organizationId,
        subscriptionType: AccountSubscriptionType.BETA,
        accessStatus: AccountAccessStatus.ACTIVE,
        accessThroughAt: null,
        paidThroughAt: null,
        revision: 1,
        createdBy: metadata.actor,
        createdReason: metadata.reason,
        updatedBy: metadata.actor,
        updateReason: metadata.reason,
      },
      skipDuplicates: true,
    });

    if (created.count === 1) {
      await tx.accountEntitlementTransition.create({
        data: {
          organizationId,
          fromRevision: null,
          toRevision: 1,
          previousSubscriptionType: null,
          subscriptionType: AccountSubscriptionType.BETA,
          previousAccessStatus: null,
          accessStatus: AccountAccessStatus.ACTIVE,
          previousAccessThroughAt: null,
          accessThroughAt: null,
          previousPaidThroughAt: null,
          paidThroughAt: null,
          changedBy: metadata.actor,
          reason: metadata.reason,
        },
      });
    }

    const entitlement = await tx.accountEntitlement.findUnique({
      where: { organizationId },
    });
    if (!entitlement) {
      throw new Error('Account entitlement admission did not persist a record');
    }

    if (created.count === 0) {
      return this.assertBetaAdmissionEntitlementInTransaction(
        tx,
        organizationId,
        metadata,
      );
    } else if (
      entitlement.subscriptionType !== AccountSubscriptionType.BETA ||
      entitlement.accessStatus !== AccountAccessStatus.ACTIVE ||
      entitlement.accessThroughAt !== null ||
      entitlement.paidThroughAt !== null ||
      entitlement.revision !== 1 ||
      entitlement.updatedBy !== metadata.actor ||
      entitlement.updateReason !== metadata.reason
    ) {
      throw new Error('Account entitlement admission persisted invalid state');
    }

    return entitlement;
  }

  private async assertBetaAdmissionEntitlementInTransaction(
    tx: AccountEntitlementTransaction,
    organizationId: OrganizationId,
    metadata: AccountEntitlementAuditMetadata,
  ): Promise<AccountEntitlement> {
    const entitlement = await tx.accountEntitlement.findUnique({
      where: { organizationId },
    });
    if (!entitlement) {
      throw new ConflictException('Account entitlement does not exist');
    }
    if (
      entitlement.createdBy !== metadata.actor ||
      entitlement.createdReason !== metadata.reason
    ) {
      throw new ConflictException(
        'Existing account entitlement conflicts with beta admission',
      );
    }

    const initialTransition = await tx.accountEntitlementTransition.findUnique({
      where: {
        organizationId_toRevision: { organizationId, toRevision: 1 },
      },
    });
    if (
      !initialTransition ||
      initialTransition.fromRevision !== null ||
      initialTransition.previousSubscriptionType !== null ||
      initialTransition.subscriptionType !== AccountSubscriptionType.BETA ||
      initialTransition.previousAccessStatus !== null ||
      initialTransition.accessStatus !== AccountAccessStatus.ACTIVE ||
      initialTransition.previousAccessThroughAt !== null ||
      initialTransition.accessThroughAt !== null ||
      initialTransition.previousPaidThroughAt !== null ||
      initialTransition.paidThroughAt !== null ||
      initialTransition.changedBy !== metadata.actor ||
      initialTransition.reason !== metadata.reason
    ) {
      throw new ConflictException(
        'Existing account entitlement evidence conflicts with beta admission',
      );
    }

    const currentTransition =
      entitlement.revision === 1
        ? initialTransition
        : await tx.accountEntitlementTransition.findUnique({
            where: {
              organizationId_toRevision: {
                organizationId,
                toRevision: entitlement.revision,
              },
            },
          });
    if (
      !currentTransition ||
      currentTransition.subscriptionType !== entitlement.subscriptionType ||
      currentTransition.accessStatus !== entitlement.accessStatus ||
      currentTransition.accessThroughAt?.getTime() !==
        entitlement.accessThroughAt?.getTime() ||
      currentTransition.paidThroughAt?.getTime() !==
        entitlement.paidThroughAt?.getTime() ||
      currentTransition.changedBy !== entitlement.updatedBy ||
      currentTransition.reason !== entitlement.updateReason
    ) {
      throw new ConflictException(
        'Existing account entitlement state conflicts with its evidence',
      );
    }

    return entitlement;
  }

  async transition(
    organizationId: OrganizationId,
    expectedRevision: number,
    next: AccountEntitlementTransitionInput,
    metadata: AccountEntitlementAuditMetadata,
  ): Promise<AccountEntitlement> {
    this.validateTransitionRequest(expectedRevision, next, metadata);
    return this.prisma.$transaction((tx) =>
      this.transitionInTransaction(
        tx,
        organizationId,
        expectedRevision,
        next,
        metadata,
      ),
    );
  }

  async transitionInTransaction(
    tx: AccountEntitlementTransaction,
    organizationId: OrganizationId,
    expectedRevision: number,
    next: AccountEntitlementTransitionInput,
    metadata: AccountEntitlementAuditMetadata,
  ): Promise<AccountEntitlement> {
    this.validateTransitionRequest(expectedRevision, next, metadata);

    this.logger.debug({
      event: 'account_entitlement_transition_lock_requested',
      organizationId,
      expectedRevision,
    });
    const lockedOrganizations = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
          SELECT id
          FROM organizations
          WHERE id = ${organizationId}
          FOR UPDATE
        `,
    );
    if (lockedOrganizations.length !== 1) {
      throw new ConflictException('Organization does not exist');
    }
    this.logger.debug({
      event: 'account_entitlement_transition_lock_acquired',
      organizationId,
      expectedRevision,
    });

    const current = await tx.accountEntitlement.findUnique({
      where: { organizationId },
    });
    if (!current) {
      throw new ConflictException('Account entitlement does not exist');
    }

    return this.persistTransitionInTransaction(
      tx,
      organizationId,
      current,
      expectedRevision,
      next,
      metadata,
    );
  }

  async makeBetaAccessOpenEnded(
    organizationId: OrganizationId,
    expectedRevision: number,
    metadata: AccountEntitlementAuditMetadata,
  ): Promise<AccountEntitlement> {
    this.validateMakeBetaAccessOpenEndedRequest(expectedRevision, metadata);

    return this.prisma.$transaction(async (tx) => {
      const lockedOrganizations = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT id
          FROM organizations
          WHERE id = ${organizationId}
          FOR UPDATE
        `,
      );
      if (lockedOrganizations.length !== 1) {
        this.logAdministrativeRejection(organizationId, 'organization_missing');
        throw new NotFoundException('Organization does not exist');
      }

      const [current, lifecycle] = await Promise.all([
        tx.accountEntitlement.findUnique({ where: { organizationId } }),
        tx.organizationAccountLifecycle.findUnique({
          where: { organizationId },
        }),
      ]);
      if (!current) {
        this.logAdministrativeRejection(organizationId, 'entitlement_missing');
        throw new NotFoundException('Account entitlement does not exist');
      }
      if (current.revision !== expectedRevision) {
        this.logAdministrativeRejection(organizationId, 'stale_revision');
        throw new ConflictException('Account entitlement revision conflict');
      }
      if (current.subscriptionType !== AccountSubscriptionType.BETA) {
        this.logAdministrativeRejection(organizationId, 'non_beta_basis');
        throw new BadRequestException('Account entitlement is not BETA');
      }
      if (
        current.accessStatus !== AccountAccessStatus.ACTIVE ||
        current.accessThroughAt === null ||
        current.accessThroughAt.getTime() <= Date.now()
      ) {
        this.logAdministrativeRejection(
          organizationId,
          'beta_access_not_active_and_expiring',
        );
        throw new BadRequestException(
          'BETA access must be active and have a future expiry',
        );
      }
      if (
        lifecycle?.irreversibleClosureAt !== null &&
        lifecycle?.irreversibleClosureAt !== undefined
      ) {
        this.logAdministrativeRejection(organizationId, 'irreversible_closure');
        throw new ConflictException('Organization is irreversibly closed');
      }

      const transitioned = await this.persistTransitionInTransaction(
        tx,
        organizationId,
        current,
        expectedRevision,
        {
          subscriptionType: AccountSubscriptionType.BETA,
          accessStatus: AccountAccessStatus.ACTIVE,
          accessThroughAt: null,
          paidThroughAt: null,
        },
        metadata,
      );
      this.logger.log({
        event: 'account_entitlement_open_ended_succeeded',
        organizationId,
        revision: transitioned.revision,
      });
      return transitioned;
    });
  }

  private async persistTransitionInTransaction(
    tx: AccountEntitlementTransaction,
    organizationId: OrganizationId,
    current: AccountEntitlement,
    expectedRevision: number,
    next: AccountEntitlementTransitionInput,
    metadata: AccountEntitlementAuditMetadata,
  ): Promise<AccountEntitlement> {
    const update = await tx.accountEntitlement.updateMany({
      where: { organizationId, revision: expectedRevision },
      data: {
        ...next,
        revision: { increment: 1 },
        updatedBy: metadata.actor,
        updateReason: metadata.reason,
      },
    });
    if (update.count !== 1) {
      throw new ConflictException('Account entitlement revision conflict');
    }

    const toRevision = expectedRevision + 1;
    await tx.accountEntitlementTransition.create({
      data: {
        organizationId,
        fromRevision: expectedRevision,
        toRevision,
        previousSubscriptionType: current.subscriptionType,
        subscriptionType: next.subscriptionType,
        previousAccessStatus: current.accessStatus,
        accessStatus: next.accessStatus,
        previousAccessThroughAt: current.accessThroughAt,
        accessThroughAt: next.accessThroughAt,
        previousPaidThroughAt: current.paidThroughAt,
        paidThroughAt: next.paidThroughAt,
        changedBy: metadata.actor,
        reason: metadata.reason,
      },
    });

    const transitioned = await tx.accountEntitlement.findUnique({
      where: { organizationId },
    });
    if (!transitioned || transitioned.revision !== toRevision) {
      throw new Error('Account entitlement transition was not persisted');
    }
    return transitioned;
  }

  private logAdministrativeRejection(
    organizationId: OrganizationId,
    reason: string,
  ): void {
    this.logger.warn({
      event: 'account_entitlement_open_ended_rejected',
      organizationId,
      reason,
    });
  }

  private validateMakeBetaAccessOpenEndedRequest(
    expectedRevision: number,
    metadata: AccountEntitlementAuditMetadata,
  ): void {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      throw new BadRequestException(
        'Expected entitlement revision must be positive',
      );
    }
    if (
      typeof metadata.actor !== 'string' ||
      typeof metadata.reason !== 'string' ||
      !metadata.actor.trim() ||
      !metadata.reason.trim()
    ) {
      throw new BadRequestException(
        'Entitlement audit actor and reason are required',
      );
    }
    if (metadata.actor.length > 120 || metadata.reason.length > 255) {
      throw new BadRequestException(
        'Entitlement audit metadata exceeds storage limits',
      );
    }
  }

  private validateTransitionRequest(
    expectedRevision: number,
    next: AccountEntitlementTransitionInput,
    metadata: AccountEntitlementAuditMetadata,
  ): void {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      throw new Error('Expected entitlement revision must be positive');
    }
    this.validateInput(next);
    this.validateMetadata(metadata);
  }

  async resolveForOrganization(
    organizationId: OrganizationId,
    now = new Date(),
  ): Promise<AccountAccessResolution> {
    const [entitlement, lifecycle] = await Promise.all([
      this.prisma.accountEntitlement.findUnique({ where: { organizationId } }),
      this.prisma.organizationAccountLifecycle.findUnique({
        where: { organizationId },
      }),
    ]);
    return this.resolve(entitlement, now, lifecycle);
  }

  async assertOrganizationAuthorized(
    organizationId: OrganizationId,
    tx?: AccountEntitlementTransaction,
  ): Promise<void> {
    if (!(await this.isOrganizationAuthorized(organizationId, tx))) {
      throw new UnauthorizedException('Not authorized');
    }
  }

  async isOrganizationAuthorized(
    organizationId: OrganizationId,
    tx?: AccountEntitlementTransaction,
    now = new Date(),
  ): Promise<boolean> {
    const client = tx ?? this.prisma;
    const [entitlement, lifecycle] = await Promise.all([
      client.accountEntitlement.findUnique({ where: { organizationId } }),
      client.organizationAccountLifecycle.findUnique({
        where: { organizationId },
      }),
    ]);
    return this.resolve(entitlement, now, lifecycle).authorized;
  }

  async areOrganizationsAuthorized(
    organizationIds: readonly OrganizationId[],
    now = new Date(),
  ): Promise<boolean> {
    const uniqueOrganizationIds = [...new Set(organizationIds)];
    if (uniqueOrganizationIds.length === 0) {
      return true;
    }
    const authorizedOrganizationIds = await this.getAuthorizedOrganizationIds(
      uniqueOrganizationIds,
      now,
    );
    return authorizedOrganizationIds.size === uniqueOrganizationIds.length;
  }

  async getAuthorizedOrganizationIds(
    organizationIds: readonly OrganizationId[],
    now = new Date(),
    tx?: AccountEntitlementTransaction,
  ): Promise<Set<OrganizationId>> {
    const uniqueOrganizationIds = [...new Set(organizationIds)];
    if (uniqueOrganizationIds.length === 0) {
      return new Set();
    }
    const client = tx ?? this.prisma;
    const [entitlements, lifecycles] = await Promise.all([
      client.accountEntitlement.findMany({
        where: { organizationId: { in: uniqueOrganizationIds } },
        select: {
          organizationId: true,
          subscriptionType: true,
          accessStatus: true,
          accessThroughAt: true,
          paidThroughAt: true,
          revision: true,
        },
      }),
      client.organizationAccountLifecycle.findMany({
        where: { organizationId: { in: uniqueOrganizationIds } },
        select: { organizationId: true, accessEndsAt: true },
      }),
    ]);
    const lifecycleByOrganizationId = new Map(
      lifecycles.map((lifecycle) => [lifecycle.organizationId, lifecycle]),
    );
    return new Set(
      entitlements
        .filter(
          (entitlement) =>
            this.resolve(
              entitlement,
              now,
              lifecycleByOrganizationId.get(entitlement.organizationId),
            ).authorized,
        )
        .map((entitlement) => entitlement.organizationId as OrganizationId),
    );
  }

  resolve(
    entitlement: ResolvableEntitlement | null,
    now = new Date(),
    lifecycle?: ResolvableLifecycle | null,
  ): AccountAccessResolution {
    if (!entitlement) {
      return {
        authorized: false,
        status: AccountAccessStatus.EXPIRED,
        subscriptionType: null,
        accessHorizon: null,
        revision: null,
      };
    }

    if (lifecycle?.accessEndsAt) {
      if (lifecycle.accessEndsAt.getTime() <= now.getTime()) {
        return this.denied(
          entitlement,
          AccountAccessStatus.REVOKED,
          lifecycle.accessEndsAt,
        );
      }
      return {
        authorized: true,
        status: AccountAccessStatus.ACTIVE,
        subscriptionType: entitlement.subscriptionType,
        accessHorizon: lifecycle.accessEndsAt,
        revision: entitlement.revision,
      };
    }

    if (entitlement.accessStatus === AccountAccessStatus.REVOKED) {
      return this.denied(entitlement, AccountAccessStatus.REVOKED, null);
    }
    if (entitlement.accessStatus === AccountAccessStatus.EXPIRED) {
      return this.denied(entitlement, AccountAccessStatus.EXPIRED, null);
    }

    const horizon =
      entitlement.subscriptionType === AccountSubscriptionType.BETA
        ? entitlement.accessThroughAt
        : entitlement.paidThroughAt;
    const authorized =
      entitlement.subscriptionType === AccountSubscriptionType.BETA
        ? horizon === null || horizon.getTime() > now.getTime()
        : horizon !== null && horizon.getTime() > now.getTime();

    if (!authorized) {
      return this.denied(entitlement, AccountAccessStatus.EXPIRED, horizon);
    }
    return {
      authorized: true,
      status: AccountAccessStatus.ACTIVE,
      subscriptionType: entitlement.subscriptionType,
      accessHorizon: horizon,
      revision: entitlement.revision,
    };
  }

  private denied(
    entitlement: ResolvableEntitlement,
    status: AccountAccessStatus,
    accessHorizon: Date | null,
  ): AccountAccessResolution {
    return {
      authorized: false,
      status,
      subscriptionType: entitlement.subscriptionType,
      accessHorizon,
      revision: entitlement.revision,
    };
  }

  private validateInput(input: AccountEntitlementTransitionInput): void {
    if (
      input.subscriptionType === AccountSubscriptionType.BETA &&
      input.paidThroughAt !== null
    ) {
      throw new Error('BETA account entitlement cannot have paidThroughAt');
    }
  }

  private validateMetadata(metadata: AccountEntitlementAuditMetadata): void {
    if (!metadata.actor.trim() || !metadata.reason.trim()) {
      throw new Error('Entitlement audit actor and reason are required');
    }
    if (metadata.actor.length > 120 || metadata.reason.length > 255) {
      throw new Error('Entitlement audit metadata exceeds storage limits');
    }
  }
}
