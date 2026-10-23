import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  AccountEntitlement,
  OrganizationAccountLifecycle,
  OrganizationAccountLifecycleState,
  OrganizationDeletionMarker,
  OrganizationRole,
  Prisma,
} from '@prisma/client';
import type {
  OrganizationAccountLifecycleDto,
  OrganizationClosedEventPayload,
  OrganizationReactivationDeadlineLostResponseAllOfData,
  OrganizationReactivationSuccess,
} from '../generated';
import {
  OrganizationReactivationDeadlineLostResponse,
  OrganizationReactivationDeadlineLostResponseAllOfData as DeadlineLostData,
  OrganizationReactivationSuccess as ReactivationSuccess,
} from '../generated';
import { DomainEventPublisher } from '../core/events/domain-event-publisher';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../core/events/tokens';
import { EVENT_TYPES } from '../core/events/types/event.types';
import { PrismaService } from '../prisma/prisma.service';
import type { OrganizationId, UserId } from '../types';
import { AccountEntitlementService } from './account-entitlement.service';
import { DEMO_SYSTEM_USER_ID } from './demo-sandbox/demo-sandbox.constants';
import { OrganizationAccountLifecycleOwner } from './organization-account-lifecycle.owner';

const CANCELLATION_REASON = 'Organization account cancellation';
const REACTIVATION_REASON = 'Organization account reactivation';
const SUSPENSION_REASON = 'Organization access horizon reached';
const IRREVERSIBLE_CLOSURE_REASON = 'Organization deletion eligibility reached';
const RECOVERY_GRACE_MS = 27 * 24 * 60 * 60 * 1000;
const DELETION_DEADLINE_MS = 30 * 24 * 60 * 60 * 1000;

type LifecycleOperation = 'read' | 'cancel' | 'reactivate' | 'close';

@Injectable()
export class OrganizationAccountLifecycleService extends OrganizationAccountLifecycleOwner {
  private readonly logger = new Logger(
    OrganizationAccountLifecycleService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountEntitlementService: AccountEntitlementService,
    @Inject(DOMAIN_EVENT_PUBLISHER_TOKEN)
    private readonly eventPublisher: DomainEventPublisher,
  ) {
    super();
  }

  async get(
    organizationId: OrganizationId,
    actorId: UserId,
  ): Promise<OrganizationAccountLifecycleDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockOrganization(tx, organizationId, 'read');
      await this.assertEligibleActor(tx, organizationId, actorId, 'read');
      const now = new Date();
      const [entitlement, current] = await Promise.all([
        tx.accountEntitlement.findUnique({ where: { organizationId } }),
        tx.organizationAccountLifecycle.findUnique({
          where: { organizationId },
        }),
      ]);
      if (!entitlement) {
        throw new ConflictException('Account entitlement does not exist');
      }
      if (!current) {
        return this.toDto(null, entitlement, now);
      }

      const stable = await this.advanceLifecycleIfNeeded(
        tx,
        current,
        actorId,
        now,
      );
      if (
        stable.lifecycleState ===
        OrganizationAccountLifecycleState.IRREVERSIBLY_CLOSED
      ) {
        await this.establishReachedClosureEvidence(
          tx,
          organizationId,
          stable,
          now,
        );
      }
      return this.toDto(stable, entitlement, now);
    });
  }

  async cancel(
    organizationId: OrganizationId,
    actorId: UserId,
  ): Promise<OrganizationAccountLifecycleDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockOrganization(tx, organizationId, 'cancel');
      await this.assertEligibleActor(tx, organizationId, actorId, 'cancel');
      const now = new Date();
      const entitlement = await tx.accountEntitlement.findUnique({
        where: { organizationId },
      });
      if (!entitlement) {
        throw new ConflictException('Account entitlement does not exist');
      }

      const current = await tx.organizationAccountLifecycle.findUnique({
        where: { organizationId },
      });
      if (current?.accessEndsAt) {
        const stable = await this.advanceLifecycleIfNeeded(
          tx,
          current,
          actorId,
          now,
        );
        if (
          stable.lifecycleState ===
          OrganizationAccountLifecycleState.IRREVERSIBLY_CLOSED
        ) {
          await this.establishReachedClosureEvidence(
            tx,
            organizationId,
            stable,
            now,
          );
        }
        return this.toDto(stable, entitlement, now);
      }

      const resolution = this.accountEntitlementService.resolve(
        entitlement,
        now,
      );
      const accessEndsAt =
        resolution.authorized &&
        resolution.accessHorizon &&
        resolution.accessHorizon.getTime() > now.getTime()
          ? resolution.accessHorizon
          : now;
      const deletionEligibleAt = new Date(
        accessEndsAt.getTime() + RECOVERY_GRACE_MS,
      );
      const lifecycleState =
        accessEndsAt.getTime() > now.getTime()
          ? OrganizationAccountLifecycleState.ACTIVE
          : OrganizationAccountLifecycleState.SUSPENDED;

      const persisted = current
        ? await this.scheduleActiveLifecycle(
            tx,
            current,
            entitlement,
            lifecycleState,
            accessEndsAt,
            deletionEligibleAt,
            actorId,
          )
        : await this.createLifecycle(
            tx,
            organizationId,
            entitlement,
            lifecycleState,
            accessEndsAt,
            deletionEligibleAt,
            actorId,
          );
      return this.toDto(persisted, entitlement, now);
    });
  }

  async reactivate(
    organizationId: OrganizationId,
    actorId: UserId,
  ): Promise<OrganizationReactivationSuccess> {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockOrganization(tx, organizationId, 'reactivate');
      await this.assertEligibleActor(tx, organizationId, actorId, 'reactivate');
      const now = new Date();
      const [entitlement, current] = await Promise.all([
        tx.accountEntitlement.findUnique({ where: { organizationId } }),
        tx.organizationAccountLifecycle.findUnique({
          where: { organizationId },
        }),
      ]);
      if (!entitlement) {
        throw new ConflictException('Account entitlement does not exist');
      }
      if (!current) {
        throw new ConflictException(
          'Only a recoverably suspended account can be reactivated',
        );
      }

      const stable = await this.advanceLifecycleIfNeeded(
        tx,
        current,
        actorId,
        now,
      );
      if (
        stable.lifecycleState ===
          OrganizationAccountLifecycleState.IRREVERSIBLY_CLOSED ||
        stable.lifecycleState === OrganizationAccountLifecycleState.DELETED
      ) {
        if (
          stable.lifecycleState ===
          OrganizationAccountLifecycleState.IRREVERSIBLY_CLOSED
        ) {
          await this.establishReachedClosureEvidence(
            tx,
            organizationId,
            stable,
            now,
          );
        }
        return {
          kind: 'deadline-lost' as const,
          data: this.deadlineLostData(stable, entitlement, now),
        };
      }
      if (
        stable.lifecycleState !== OrganizationAccountLifecycleState.SUSPENDED ||
        !stable.deletionEligibleAt
      ) {
        throw new ConflictException(
          'Only a recoverably suspended account can be reactivated',
        );
      }
      if (
        !this.accountEntitlementService.resolve(entitlement, now).authorized
      ) {
        throw new ConflictException(
          'Current account entitlement does not permit reactivation',
        );
      }

      const updatedRows = await tx.$executeRaw(Prisma.sql`
        UPDATE organization_account_lifecycles
        SET
          lifecycle_state = ${OrganizationAccountLifecycleState.ACTIVE}::organization_account_lifecycle_state,
          access_ends_at = NULL,
          deletion_eligible_at = NULL,
          irreversible_closure_at = NULL,
          deleted_at = NULL,
          closure_entitlement_revision = NULL,
          revision = revision + 1,
          updated_at = clock_timestamp(),
          updated_by = ${actorId},
          update_reason = ${REACTIVATION_REASON}
        WHERE organization_id = ${organizationId}
          AND revision = ${stable.revision}
          AND lifecycle_state = ${OrganizationAccountLifecycleState.SUSPENDED}::organization_account_lifecycle_state
          AND deletion_eligible_at > clock_timestamp()
          AND irreversible_closure_at IS NULL
      `);
      if (updatedRows !== 1) {
        const latest = await tx.organizationAccountLifecycle.findUniqueOrThrow({
          where: { organizationId },
        });
        const advanced = await this.advanceLifecycleIfNeeded(
          tx,
          latest,
          actorId,
          new Date(),
        );
        if (
          advanced.lifecycleState ===
            OrganizationAccountLifecycleState.IRREVERSIBLY_CLOSED ||
          advanced.lifecycleState === OrganizationAccountLifecycleState.DELETED
        ) {
          if (
            advanced.lifecycleState ===
            OrganizationAccountLifecycleState.IRREVERSIBLY_CLOSED
          ) {
            await this.establishReachedClosureEvidence(
              tx,
              organizationId,
              advanced,
              new Date(),
            );
          }
          return {
            kind: 'deadline-lost' as const,
            data: this.deadlineLostData(advanced, entitlement, new Date()),
          };
        }
        throw new ConflictException('Account lifecycle revision conflict');
      }

      const reactivated =
        await tx.organizationAccountLifecycle.findUniqueOrThrow({
          where: { organizationId },
        });
      await this.recordTransition(
        tx,
        stable,
        reactivated,
        actorId,
        REACTIVATION_REASON,
      );
      return {
        kind: 'reactivated' as const,
        data: {
          ...this.toDto(reactivated, entitlement, now),
          outcome: ReactivationSuccess.OutcomeEnum.Reactivated,
        } satisfies OrganizationReactivationSuccess,
      };
    });

    if (result.kind === 'deadline-lost') {
      throw new ConflictException({
        message: 'Reactivation deadline was lost to irreversible closure',
        code: OrganizationReactivationDeadlineLostResponse.CodeEnum
          .ReactivationDeadlineLost,
        data: result.data,
      });
    }
    return result.data;
  }

  async materializeReachedClosure(
    organizationId: OrganizationId,
    now = new Date(),
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockOrganization(tx, organizationId, 'close');
      const current = await tx.organizationAccountLifecycle.findUnique({
        where: { organizationId },
      });
      if (!current?.deletionEligibleAt) {
        throw new ConflictException(
          'Organization does not have a deletion eligibility milestone',
        );
      }
      const reached = await this.advanceLifecycleIfNeeded(
        tx,
        current,
        'account-closure-worker' as UserId,
        now,
      );
      await this.establishReachedClosureEvidence(
        tx,
        organizationId,
        reached,
        now,
      );
    });
  }

  /**
   * Irreversibly closes a system-owned organization at once, inside the
   * caller's transaction, and records the closure evidence that drives final
   * deletion. There is no recovery window: such organizations are never
   * cancelled or reactivated by a customer.
   */
  async closeImmediatelyForSystemOrganization(
    tx: Prisma.TransactionClient,
    organizationId: OrganizationId,
    actorId: string,
    reason: string,
  ): Promise<OrganizationDeletionMarker> {
    await this.lockOrganization(tx, organizationId, 'close');
    await this.assertSystemOwned(tx, organizationId);
    const [entitlement, existing] = await Promise.all([
      tx.accountEntitlement.findUnique({ where: { organizationId } }),
      tx.organizationAccountLifecycle.findUnique({
        where: { organizationId },
      }),
    ]);
    if (!entitlement) {
      throw new ConflictException('Account entitlement does not exist');
    }
    if (existing) {
      throw new ConflictException(
        'System organization already has an account lifecycle',
      );
    }
    const now = new Date();
    const lifecycle = await tx.organizationAccountLifecycle.create({
      data: {
        organizationId,
        lifecycleState: OrganizationAccountLifecycleState.IRREVERSIBLY_CLOSED,
        accessEndsAt: now,
        deletionEligibleAt: now,
        irreversibleClosureAt: now,
        deletedAt: null,
        closureEntitlementRevision: entitlement.revision,
        revision: 1,
        createdBy: actorId,
        createdReason: reason,
        updatedBy: actorId,
        updateReason: reason,
      },
    });
    await this.recordTransition(tx, null, lifecycle, actorId as UserId, reason);
    return this.establishReachedClosureEvidence(
      tx,
      organizationId,
      lifecycle,
      now,
    );
  }

  /** Closure has no recovery window, so only the system principal's organizations qualify. */
  private async assertSystemOwned(
    tx: Prisma.TransactionClient,
    organizationId: OrganizationId,
  ): Promise<void> {
    const owners = await tx.organizationMember.findMany({
      where: { organizationId, role: OrganizationRole.OWNER },
      select: { userId: true },
    });
    const systemOwned =
      owners.length > 0 &&
      owners.every((owner) => owner.userId === DEMO_SYSTEM_USER_ID);
    if (!systemOwned) {
      this.logger.warn({
        event: 'organization_immediate_closure_refused_not_system_owned',
        organizationId,
      });
      throw new ForbiddenException(
        'Only system-owned organizations can be closed immediately',
      );
    }
  }

  private async lockOrganization(
    tx: Prisma.TransactionClient,
    organizationId: OrganizationId,
    operation: LifecycleOperation,
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE
    `);
    if (rows.length !== 1) {
      throw new ConflictException('Organization does not exist');
    }
    this.logger.debug({
      event: 'organization_account_lifecycle_lock_acquired',
      organizationId,
      operation,
    });
  }

  private async assertEligibleActor(
    tx: Prisma.TransactionClient,
    organizationId: OrganizationId,
    actorId: UserId,
    operation: Exclude<LifecycleOperation, 'close'>,
  ): Promise<void> {
    const membership = await tx.organizationMember.findUnique({
      where: {
        userId_organizationId: { userId: actorId, organizationId },
      },
      select: { isActive: true, role: true },
    });
    const eligible =
      membership?.isActive === true &&
      (membership.role === OrganizationRole.OWNER ||
        membership.role === OrganizationRole.ADMIN);
    this.logger.debug({
      event: 'organization_account_lifecycle_actor_validated',
      organizationId,
      actorId,
      operation,
      eligible,
    });
    if (!eligible) {
      throw new ForbiddenException(
        'An active organization owner or admin membership is required',
      );
    }
  }

  private async createLifecycle(
    tx: Prisma.TransactionClient,
    organizationId: OrganizationId,
    entitlement: AccountEntitlement,
    lifecycleState: OrganizationAccountLifecycleState,
    accessEndsAt: Date,
    deletionEligibleAt: Date,
    actorId: UserId,
  ): Promise<OrganizationAccountLifecycle> {
    const lifecycle = await tx.organizationAccountLifecycle.create({
      data: {
        organizationId,
        lifecycleState,
        accessEndsAt,
        deletionEligibleAt,
        irreversibleClosureAt: null,
        deletedAt: null,
        closureEntitlementRevision: entitlement.revision,
        revision: 1,
        createdBy: actorId,
        createdReason: CANCELLATION_REASON,
        updatedBy: actorId,
        updateReason: CANCELLATION_REASON,
      },
    });
    await this.recordTransition(
      tx,
      null,
      lifecycle,
      actorId,
      CANCELLATION_REASON,
    );
    return lifecycle;
  }

  private async scheduleActiveLifecycle(
    tx: Prisma.TransactionClient,
    current: OrganizationAccountLifecycle,
    entitlement: AccountEntitlement,
    lifecycleState: OrganizationAccountLifecycleState,
    accessEndsAt: Date,
    deletionEligibleAt: Date,
    actorId: UserId,
  ): Promise<OrganizationAccountLifecycle> {
    if (
      current.lifecycleState !== OrganizationAccountLifecycleState.ACTIVE ||
      current.accessEndsAt !== null
    ) {
      throw new ConflictException('Account lifecycle state is invalid');
    }
    const updated = await tx.organizationAccountLifecycle.updateMany({
      where: {
        organizationId: current.organizationId,
        revision: current.revision,
        lifecycleState: OrganizationAccountLifecycleState.ACTIVE,
        accessEndsAt: null,
      },
      data: {
        lifecycleState,
        accessEndsAt,
        deletionEligibleAt,
        closureEntitlementRevision: entitlement.revision,
        revision: { increment: 1 },
        updatedBy: actorId,
        updateReason: CANCELLATION_REASON,
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException('Account lifecycle revision conflict');
    }
    const persisted = await tx.organizationAccountLifecycle.findUniqueOrThrow({
      where: { organizationId: current.organizationId },
    });
    await this.recordTransition(
      tx,
      current,
      persisted,
      actorId,
      CANCELLATION_REASON,
    );
    return persisted;
  }

  private async advanceLifecycleIfNeeded(
    tx: Prisma.TransactionClient,
    current: OrganizationAccountLifecycle,
    actorId: UserId,
    now: Date,
  ): Promise<OrganizationAccountLifecycle> {
    let stable = current;
    if (
      stable.lifecycleState === OrganizationAccountLifecycleState.ACTIVE &&
      stable.accessEndsAt &&
      stable.accessEndsAt.getTime() <= now.getTime()
    ) {
      stable = await this.transitionState(
        tx,
        stable,
        OrganizationAccountLifecycleState.SUSPENDED,
        actorId,
        SUSPENSION_REASON,
        {},
      );
    }
    if (
      stable.lifecycleState === OrganizationAccountLifecycleState.SUSPENDED &&
      stable.deletionEligibleAt &&
      stable.deletionEligibleAt.getTime() <= now.getTime()
    ) {
      stable = await this.transitionState(
        tx,
        stable,
        OrganizationAccountLifecycleState.IRREVERSIBLY_CLOSED,
        actorId,
        IRREVERSIBLE_CLOSURE_REASON,
        { irreversibleClosureAt: now },
      );
    }
    return stable;
  }

  private async transitionState(
    tx: Prisma.TransactionClient,
    current: OrganizationAccountLifecycle,
    lifecycleState: OrganizationAccountLifecycleState,
    actorId: UserId,
    reason: string,
    milestoneUpdate: Pick<
      Partial<OrganizationAccountLifecycle>,
      'irreversibleClosureAt' | 'deletedAt'
    >,
  ): Promise<OrganizationAccountLifecycle> {
    const updated = await tx.organizationAccountLifecycle.updateMany({
      where: {
        organizationId: current.organizationId,
        revision: current.revision,
        lifecycleState: current.lifecycleState,
      },
      data: {
        lifecycleState,
        ...milestoneUpdate,
        revision: { increment: 1 },
        updatedBy: actorId,
        updateReason: reason,
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException('Account lifecycle revision conflict');
    }
    const persisted = await tx.organizationAccountLifecycle.findUniqueOrThrow({
      where: { organizationId: current.organizationId },
    });
    await this.recordTransition(tx, current, persisted, actorId, reason);
    return persisted;
  }

  private async recordTransition(
    tx: Prisma.TransactionClient,
    previous: OrganizationAccountLifecycle | null,
    current: OrganizationAccountLifecycle,
    actorId: UserId,
    reason: string,
  ): Promise<void> {
    await tx.organizationAccountLifecycleTransition.create({
      data: {
        organizationId: current.organizationId,
        fromRevision: previous?.revision ?? null,
        toRevision: current.revision,
        previousLifecycleState: previous?.lifecycleState ?? null,
        lifecycleState: current.lifecycleState,
        previousAccessEndsAt: previous?.accessEndsAt ?? null,
        accessEndsAt: current.accessEndsAt,
        previousDeletionEligibleAt: previous?.deletionEligibleAt ?? null,
        deletionEligibleAt: current.deletionEligibleAt,
        previousIrreversibleClosureAt: previous?.irreversibleClosureAt ?? null,
        irreversibleClosureAt: current.irreversibleClosureAt,
        previousDeletedAt: previous?.deletedAt ?? null,
        deletedAt: current.deletedAt,
        previousClosureEntitlementRevision:
          previous?.closureEntitlementRevision ?? null,
        closureEntitlementRevision: current.closureEntitlementRevision,
        changedBy: actorId,
        reason,
      },
    });
  }

  async establishReachedClosureEvidence(
    tx: Prisma.TransactionClient,
    organizationId: OrganizationId,
    lifecycle: OrganizationAccountLifecycle,
    now: Date,
  ): Promise<OrganizationDeletionMarker> {
    if (
      lifecycle.lifecycleState !==
        OrganizationAccountLifecycleState.IRREVERSIBLY_CLOSED ||
      lifecycle.organizationId !== organizationId ||
      !lifecycle.accessEndsAt ||
      !lifecycle.irreversibleClosureAt ||
      lifecycle.irreversibleClosureAt.getTime() > now.getTime()
    ) {
      throw new ConflictException(
        'Organization closure evidence requires committed irreversible closure',
      );
    }

    const deletionDeadline = new Date(
      lifecycle.accessEndsAt.getTime() + DELETION_DEADLINE_MS,
    );

    const [existingMarker, existingExecution] = await Promise.all([
      tx.organizationDeletionMarker.findUnique({ where: { organizationId } }),
      tx.organizationClosureExecution.findUnique({ where: { organizationId } }),
    ]);
    if (existingMarker || existingExecution) {
      if (
        !existingMarker ||
        !existingExecution ||
        existingExecution.markerId !== existingMarker.id ||
        existingMarker.accessEndsAt.getTime() !==
          lifecycle.accessEndsAt.getTime() ||
        existingMarker.effectiveClosureAt.getTime() !==
          lifecycle.irreversibleClosureAt.getTime() ||
        existingExecution.effectiveClosureAt.getTime() !==
          lifecycle.irreversibleClosureAt.getTime() ||
        existingMarker.deletionDeadline.getTime() !==
          deletionDeadline.getTime() ||
        existingExecution.deletionDeadline.getTime() !==
          deletionDeadline.getTime()
      ) {
        throw new ConflictException(
          'Organization closure evidence is inconsistent',
        );
      }
      return existingMarker;
    }

    const marker = await tx.organizationDeletionMarker.create({
      data: {
        organizationId,
        accessEndsAt: lifecycle.accessEndsAt,
        effectiveClosureAt: lifecycle.irreversibleClosureAt,
        deletionDeadline,
      },
    });
    await tx.organizationClosureExecution.create({
      data: {
        organizationId,
        markerId: marker.id,
        effectiveClosureAt: lifecycle.irreversibleClosureAt,
        deletionDeadline,
      },
    });

    const payload = {
      payloadType: EVENT_TYPES.ORGANIZATION.CLOSED,
      organizationId,
      markerId: marker.id,
      irreversibleClosureAt: lifecycle.irreversibleClosureAt.toISOString(),
      deletionDeadline: deletionDeadline.toISOString(),
    } satisfies OrganizationClosedEventPayload;
    await this.eventPublisher.publishInTransaction(tx, {
      type: EVENT_TYPES.ORGANIZATION.CLOSED,
      aggregateId: organizationId,
      payload,
    });
    return marker;
  }

  private deadlineLostData(
    lifecycle: OrganizationAccountLifecycle,
    entitlement: AccountEntitlement,
    now: Date,
  ): OrganizationReactivationDeadlineLostResponseAllOfData {
    return {
      outcome: DeadlineLostData.OutcomeEnum.DeadlineLost,
      lifecycle: this.toDto(lifecycle, entitlement, now),
    } satisfies OrganizationReactivationDeadlineLostResponseAllOfData;
  }

  private toDto(
    lifecycle: OrganizationAccountLifecycle | null,
    entitlement: AccountEntitlement,
    now: Date,
  ): OrganizationAccountLifecycleDto {
    const access = this.accountEntitlementService.resolve(
      entitlement,
      now,
      lifecycle,
    );
    const entitlementEligible = this.accountEntitlementService.resolve(
      entitlement,
      now,
    ).authorized;
    const canReactivate =
      lifecycle?.lifecycleState ===
        OrganizationAccountLifecycleState.SUSPENDED &&
      lifecycle.deletionEligibleAt !== null &&
      lifecycle.deletionEligibleAt.getTime() > now.getTime() &&
      entitlementEligible;
    return {
      lifecycleState:
        lifecycle?.lifecycleState ?? OrganizationAccountLifecycleState.ACTIVE,
      accessEndsAt: lifecycle?.accessEndsAt?.toISOString() ?? null,
      deletionEligibleAt: lifecycle?.deletionEligibleAt?.toISOString() ?? null,
      irreversibleClosureAt:
        lifecycle?.irreversibleClosureAt?.toISOString() ?? null,
      deletedAt: lifecycle?.deletedAt?.toISOString() ?? null,
      accessAllowed: access.authorized,
      canReactivate,
    } satisfies OrganizationAccountLifecycleDto;
  }
}
