import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  AccountEntitlement,
  PaymentProviderBinding,
  PaymentProviderEventInbox,
  PaymentProviderEventProcessingStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { OrganizationId } from '../../types';
import { AccountEntitlementService } from '../account-entitlement.service';
import { mapPaymentPeriodToEntitlementTransition } from './payment-entitlement-policy';
import {
  NormalizedPaymentProviderEvent,
  PaymentProviderAdapterRequest,
  PaymentProviderInputError,
  PaymentProviderReconciliationError,
} from './payment-provider-adapter';
import { PaymentProviderBindingService } from './payment-provider-binding.service';
import {
  PaymentEntitlementReconciliationInput,
  PaymentEntitlementReconciliationOwner,
  PaymentEntitlementReconciliationResult,
} from './payment-entitlement-reconciliation.owner';

const PAID_PERIOD_UPDATED = 'PAID_PERIOD_UPDATED';
const RECONCILIATION_ACTOR = 'payment-provider-webhook';
const RECONCILIATION_REASON =
  'Verified payment provider entitlement reconciliation';
const MAX_TRANSACTION_ATTEMPTS = 3;

type ReconciliationTransaction = Prisma.TransactionClient;

type StoredProviderOrderingEvidence = Pick<
  PaymentProviderBinding,
  | 'lastAcceptedProviderEventSequence'
  | 'lastAcceptedProviderEventVersion'
  | 'lastAcceptedProviderOccurredAt'
>;

type ProviderOrderingEvidenceUpdate = Pick<
  Prisma.PaymentProviderBindingUpdateInput,
  | 'lastAcceptedProviderEventSequence'
  | 'lastAcceptedProviderEventVersion'
  | 'lastAcceptedProviderOccurredAt'
>;

@Injectable()
export class PaymentEntitlementReconciliationService extends PaymentEntitlementReconciliationOwner {
  private readonly logger = new Logger(
    PaymentEntitlementReconciliationService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly bindingService: PaymentProviderBindingService,
    private readonly accountEntitlementService: AccountEntitlementService,
  ) {
    super();
  }

  async reconcile(
    input: PaymentEntitlementReconciliationInput,
  ): Promise<PaymentEntitlementReconciliationResult> {
    try {
      return await this.reconcileInternal(input);
    } catch (error) {
      if (error instanceof PaymentProviderInputError) throw error;
      if (error instanceof PaymentProviderReconciliationError) throw error;
      throw new PaymentProviderReconciliationError();
    }
  }

  private async reconcileInternal(
    input: PaymentEntitlementReconciliationInput,
  ): Promise<PaymentEntitlementReconciliationResult> {
    this.validateInput(input);
    const { event } = input;

    this.logger.debug({
      event: 'payment_entitlement_reconciliation_started',
      provider: event.provider,
      environment: event.environment,
      providerEventId: event.providerEventId,
      normalizedEventKind: event.normalizedEventKind,
    });

    let binding: PaymentProviderBinding | null = null;
    let closureCorrelation = false;
    let uncorrelatedReason = 'UNKNOWN_OR_DISABLED_BINDING';
    try {
      binding = await this.bindingService.resolveBinding({
        provider: event.provider,
        environment: event.environment,
        externalCustomerId: event.externalCustomerId,
        externalSubscriptionId: event.externalSubscriptionId,
      });
      if (!binding) {
        if (event.externalCustomerId || event.externalSubscriptionId) {
          closureCorrelation = Boolean(
            await this.bindingService.resolveClosureCorrelation({
              provider: event.provider,
              environment: event.environment,
              externalCustomerId: event.externalCustomerId,
              externalSubscriptionId: event.externalSubscriptionId,
            }),
          );
          if (closureCorrelation) {
            uncorrelatedReason = 'ACCOUNT_CLOSURE_REACHED';
          }
        }
        this.logger.debug({
          event: 'payment_entitlement_reconciliation_correlation_miss',
          provider: event.provider,
          environment: event.environment,
          providerEventId: event.providerEventId,
          reason: uncorrelatedReason,
          closureCorrelation,
        });
      }
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof BadRequestException
      ) {
        uncorrelatedReason = error.message.includes('multiple')
          ? 'AMBIGUOUS_BINDING'
          : 'MISMATCHED_BINDING';
        this.logger.debug({
          event: 'payment_entitlement_reconciliation_correlation_rejected',
          provider: event.provider,
          environment: event.environment,
          providerEventId: event.providerEventId,
          reason: uncorrelatedReason,
        });
      } else {
        throw error;
      }
    }

    if (!binding) {
      return this.recordUncorrelatedOutcome(input, uncorrelatedReason);
    }

    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        const result = await this.runTransaction((tx) =>
          this.reconcileInTransaction(
            tx,
            input,
            binding as PaymentProviderBinding,
          ),
        );
        this.logger.debug({
          event: 'payment_entitlement_reconciliation_outcome',
          provider: event.provider,
          environment: event.environment,
          providerEventId: event.providerEventId,
          bindingId: binding.id,
          organizationId: binding.organizationId,
          status: result.status,
          duplicate: result.duplicate,
          entitlementRevision: result.entitlementRevision,
        });
        return result;
      } catch (error) {
        if (
          !this.isRetryableTransactionError(error) ||
          attempt === MAX_TRANSACTION_ATTEMPTS
        ) {
          this.logger.warn({
            event: 'payment_entitlement_reconciliation_failed',
            provider: event.provider,
            environment: event.environment,
            providerEventId: event.providerEventId,
            bindingId: binding.id,
            attempt,
            errorType: this.errorType(error),
          });
          throw error;
        }

        this.logger.debug({
          event: 'payment_entitlement_reconciliation_retry',
          provider: event.provider,
          environment: event.environment,
          providerEventId: event.providerEventId,
          bindingId: binding.id,
          attempt,
          errorType: this.errorType(error),
        });
      }
    }

    throw new Error('Payment entitlement reconciliation exhausted retries');
  }

  private async reconcileInTransaction(
    tx: ReconciliationTransaction,
    input: PaymentEntitlementReconciliationInput,
    resolvedBinding: PaymentProviderBinding,
  ): Promise<PaymentEntitlementReconciliationResult> {
    const { event } = input;
    await this.lockEventIdentity(tx, event);

    const existing = await tx.paymentProviderEventInbox.findUnique({
      where: {
        provider_environment_providerEventId: {
          provider: event.provider,
          environment: event.environment,
          providerEventId: event.providerEventId,
        },
      },
    });
    if (existing) {
      this.logger.debug({
        event: 'payment_entitlement_reconciliation_duplicate',
        provider: event.provider,
        environment: event.environment,
        providerEventId: event.providerEventId,
        bindingId: existing.bindingId,
        organizationId: existing.organizationId,
        status: existing.processingStatus,
      });
      return this.toResult(existing, true);
    }

    const binding = await this.lockAndRevalidateBinding(
      tx,
      resolvedBinding,
      event,
    );
    const closureCorrelation =
      !binding &&
      Boolean(event.externalCustomerId || event.externalSubscriptionId) &&
      Boolean(
        await this.bindingService.resolveClosureCorrelation(
          {
            provider: event.provider,
            environment: event.environment,
            externalCustomerId: event.externalCustomerId,
            externalSubscriptionId: event.externalSubscriptionId,
          },
          tx,
        ),
      );
    const inbox = await tx.paymentProviderEventInbox.create({
      data: {
        organizationId: binding?.organizationId ?? null,
        bindingId: binding?.id ?? null,
        provider: event.provider,
        environment: event.environment,
        providerEventId: event.providerEventId,
        normalizedEventKind: event.normalizedEventKind,
        payloadHash: event.payloadHash,
        providerOccurredAt: event.providerOccurredAt,
        providerEventVersion: event.providerEventVersion,
        providerEventSequence: event.providerEventSequence,
        processingStatus: PaymentProviderEventProcessingStatus.RECEIVED,
      },
    });

    if (!binding) {
      return this.finishOutcome(
        tx,
        inbox,
        PaymentProviderEventProcessingStatus.IGNORED,
        closureCorrelation
          ? 'ACCOUNT_CLOSURE_REACHED'
          : 'BINDING_CHANGED_OR_DISABLED',
        null,
      );
    }

    await this.lockOrganization(tx, binding.organizationId);
    const [entitlement, lifecycle, closureMarker] = await Promise.all([
      tx.accountEntitlement.findUnique({
        where: { organizationId: binding.organizationId },
      }),
      tx.organizationAccountLifecycle.findUnique({
        where: { organizationId: binding.organizationId },
      }),
      tx.organizationDeletionMarker.findUnique({
        where: { organizationId: binding.organizationId },
      }),
    ]);

    this.logger.debug({
      event: 'payment_entitlement_reconciliation_transaction_decision',
      provider: event.provider,
      environment: event.environment,
      providerEventId: event.providerEventId,
      bindingId: binding.id,
      organizationId: binding.organizationId,
      currentEntitlementRevision: entitlement?.revision ?? null,
      lifecycleState: lifecycle?.lifecycleState ?? null,
      irreversibleClosureAt:
        lifecycle?.irreversibleClosureAt?.toISOString() ?? null,
      retainedClosureAt:
        closureMarker?.effectiveClosureAt?.toISOString() ?? null,
    });

    if (!entitlement) {
      return this.finishOutcome(
        tx,
        inbox,
        PaymentProviderEventProcessingStatus.IGNORED,
        'MISSING_ENTITLEMENT',
        null,
      );
    }

    const lifecycleClosureReached =
      lifecycle?.irreversibleClosureAt !== null &&
      lifecycle?.irreversibleClosureAt !== undefined;
    if (closureMarker || lifecycleClosureReached) {
      this.logger.debug({
        event: 'payment_entitlement_reconciliation_closure_barrier',
        provider: event.provider,
        environment: event.environment,
        providerEventId: event.providerEventId,
        organizationId: binding.organizationId,
        irreversibleClosureAt:
          closureMarker?.effectiveClosureAt?.toISOString() ??
          lifecycle?.irreversibleClosureAt?.toISOString() ??
          null,
        closureEntitlementRevision:
          lifecycle?.closureEntitlementRevision ?? null,
      });
      return this.finishOutcome(
        tx,
        inbox,
        PaymentProviderEventProcessingStatus.IGNORED,
        'ACCOUNT_CLOSURE_REACHED',
        null,
      );
    }

    if (event.normalizedEventKind !== PAID_PERIOD_UPDATED) {
      return this.finishOutcome(
        tx,
        inbox,
        PaymentProviderEventProcessingStatus.IGNORED,
        'UNSUPPORTED_EVENT_KIND',
        null,
      );
    }

    const ordering = this.compareOrderingEvidence(event, binding);
    const paidPeriodRegressesWithoutOrdering =
      ordering === null &&
      entitlement.paidThroughAt !== null &&
      (event.paidThroughAt === null ||
        event.paidThroughAt.getTime() <= entitlement.paidThroughAt.getTime());
    if (ordering !== null && ordering <= 0) {
      this.logger.debug({
        event: 'payment_entitlement_reconciliation_stale_event',
        provider: event.provider,
        environment: event.environment,
        providerEventId: event.providerEventId,
        organizationId: binding.organizationId,
        ordering,
      });
      return this.finishOutcome(
        tx,
        inbox,
        PaymentProviderEventProcessingStatus.IGNORED,
        'STALE_OR_OUT_OF_ORDER',
        null,
      );
    }
    if (paidPeriodRegressesWithoutOrdering) {
      return this.finishOutcome(
        tx,
        inbox,
        PaymentProviderEventProcessingStatus.IGNORED,
        'STALE_OR_OUT_OF_ORDER',
        null,
      );
    }

    const next = mapPaymentPeriodToEntitlementTransition(
      { paidThroughAt: event.paidThroughAt },
      new Date(),
    );
    const unchanged = this.sameEntitlement(entitlement, next);
    const transitioned = unchanged
      ? entitlement
      : await this.accountEntitlementService.transitionInTransaction(
          tx,
          binding.organizationId as OrganizationId,
          entitlement.revision,
          next,
          {
            actor: RECONCILIATION_ACTOR,
            reason: RECONCILIATION_REASON,
          },
        );

    await this.advanceOrderingCursor(tx, binding, event, ordering);

    return this.finishOutcome(
      tx,
      inbox,
      PaymentProviderEventProcessingStatus.ACCEPTED,
      null,
      transitioned.revision,
    );
  }

  private async recordUncorrelatedOutcome(
    input: PaymentEntitlementReconciliationInput,
    reason: string,
  ): Promise<PaymentEntitlementReconciliationResult> {
    const { event } = input;
    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        return await this.runTransaction(async (tx) => {
          await this.lockEventIdentity(tx, event);
          const existing = await tx.paymentProviderEventInbox.findUnique({
            where: {
              provider_environment_providerEventId: {
                provider: event.provider,
                environment: event.environment,
                providerEventId: event.providerEventId,
              },
            },
          });
          if (existing) return this.toResult(existing, true);

          const inbox = await tx.paymentProviderEventInbox.create({
            data: {
              organizationId: null,
              bindingId: null,
              provider: event.provider,
              environment: event.environment,
              providerEventId: event.providerEventId,
              normalizedEventKind: event.normalizedEventKind,
              payloadHash: event.payloadHash,
              providerOccurredAt: event.providerOccurredAt,
              providerEventVersion: event.providerEventVersion,
              providerEventSequence: event.providerEventSequence,
              processingStatus: PaymentProviderEventProcessingStatus.RECEIVED,
            },
          });
          return this.finishOutcome(
            tx,
            inbox,
            PaymentProviderEventProcessingStatus.IGNORED,
            reason,
            null,
          );
        });
      } catch (error) {
        if (
          !this.isRetryableTransactionError(error) ||
          attempt === MAX_TRANSACTION_ATTEMPTS
        ) {
          throw error;
        }
        this.logger.debug({
          event: 'payment_entitlement_reconciliation_retry',
          provider: event.provider,
          environment: event.environment,
          providerEventId: event.providerEventId,
          attempt,
          errorType: this.errorType(error),
        });
      }
    }

    throw new Error('Payment entitlement reconciliation exhausted retries');
  }

  private async lockAndRevalidateBinding(
    tx: ReconciliationTransaction,
    resolvedBinding: PaymentProviderBinding,
    event: NormalizedPaymentProviderEvent,
  ): Promise<PaymentProviderBinding | null> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT id
        FROM payment_provider_bindings
        WHERE id = ${resolvedBinding.id}
        FOR UPDATE
      `,
    );
    if (rows.length !== 1) return null;

    const binding = await tx.paymentProviderBinding.findUnique({
      where: { id: resolvedBinding.id },
    });
    if (
      !binding ||
      binding.status !== 'ACTIVE' ||
      binding.provider !== event.provider ||
      binding.environment !== event.environment ||
      (event.externalCustomerId !== null &&
        binding.externalCustomerId !== event.externalCustomerId) ||
      (event.externalSubscriptionId !== null &&
        binding.externalSubscriptionId !== event.externalSubscriptionId)
    ) {
      return null;
    }
    return binding;
  }

  private async advanceOrderingCursor(
    tx: ReconciliationTransaction,
    binding: PaymentProviderBinding,
    event: NormalizedPaymentProviderEvent,
    ordering: number | null,
  ): Promise<void> {
    if (
      !this.hasOrderingEvidence(event) ||
      (ordering !== null && ordering <= 0)
    ) {
      return;
    }

    const data: ProviderOrderingEvidenceUpdate = {};
    if (
      this.isNewerOrderingEvidence(
        event.providerEventSequence,
        binding.lastAcceptedProviderEventSequence,
        (current, previous) =>
          current < previous ? -1 : current > previous ? 1 : 0,
      )
    ) {
      data.lastAcceptedProviderEventSequence = event.providerEventSequence;
    }
    if (
      this.isNewerOrderingEvidence(
        event.providerEventVersion,
        binding.lastAcceptedProviderEventVersion,
        (current, previous) => this.compareOrderingToken(current, previous),
      )
    ) {
      data.lastAcceptedProviderEventVersion = event.providerEventVersion;
    }
    if (
      this.isNewerOrderingEvidence(
        event.providerOccurredAt,
        binding.lastAcceptedProviderOccurredAt,
        (current, previous) =>
          current.getTime() < previous.getTime()
            ? -1
            : current.getTime() > previous.getTime()
              ? 1
              : 0,
      )
    ) {
      data.lastAcceptedProviderOccurredAt = event.providerOccurredAt;
    }
    if (Object.keys(data).length === 0) return;

    await tx.paymentProviderBinding.update({
      where: { id: binding.id },
      data,
    });
  }

  private async lockOrganization(
    tx: ReconciliationTransaction,
    organizationId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT id
        FROM organizations
        WHERE id = ${organizationId}
        FOR UPDATE
      `,
    );
    if (rows.length !== 1) {
      throw new ConflictException('Organization does not exist');
    }
  }

  private async lockEventIdentity(
    tx: ReconciliationTransaction,
    event: NormalizedPaymentProviderEvent,
  ): Promise<void> {
    const identity = JSON.stringify([
      event.provider,
      event.environment,
      event.providerEventId,
    ]);
    await tx.$queryRaw(
      Prisma.sql`
        SELECT TRUE
        FROM (
          SELECT pg_advisory_xact_lock(hashtextextended(${identity}, 0))
        ) AS advisory_lock
      `,
    );
  }

  private async finishOutcome(
    tx: ReconciliationTransaction,
    inbox: PaymentProviderEventInbox,
    status: PaymentProviderEventProcessingStatus,
    failureReason: string | null,
    entitlementRevision: number | null,
  ): Promise<PaymentEntitlementReconciliationResult> {
    const processedAt = new Date();
    const updated = await tx.paymentProviderEventInbox.update({
      where: { id: inbox.id },
      data: {
        processingStatus: status,
        failureReason,
        acceptedEntitlementRevision: entitlementRevision,
        processedAt,
      },
    });
    return this.toResult(updated, false);
  }

  private toResult(
    event: PaymentProviderEventInbox,
    duplicate: boolean,
  ): PaymentEntitlementReconciliationResult {
    return {
      status: event.processingStatus,
      providerEventId: event.providerEventId,
      entitlementRevision: event.acceptedEntitlementRevision,
      duplicate,
    };
  }

  private sameEntitlement(
    current: AccountEntitlement,
    next: {
      subscriptionType: AccountEntitlement['subscriptionType'];
      accessStatus: AccountEntitlement['accessStatus'];
      accessThroughAt: Date | null;
      paidThroughAt: Date | null;
    },
  ): boolean {
    return (
      current.subscriptionType === next.subscriptionType &&
      current.accessStatus === next.accessStatus &&
      this.sameDate(current.accessThroughAt, next.accessThroughAt) &&
      this.sameDate(current.paidThroughAt, next.paidThroughAt)
    );
  }

  private compareOrderingEvidence(
    current: NormalizedPaymentProviderEvent,
    previous: StoredProviderOrderingEvidence,
  ): number | null {
    if (
      current.providerEventSequence !== null &&
      previous.lastAcceptedProviderEventSequence !== null
    ) {
      return current.providerEventSequence <
        previous.lastAcceptedProviderEventSequence
        ? -1
        : current.providerEventSequence >
            previous.lastAcceptedProviderEventSequence
          ? 1
          : 0;
    }
    if (
      current.providerEventVersion !== null &&
      previous.lastAcceptedProviderEventVersion !== null
    ) {
      return this.compareOrderingToken(
        current.providerEventVersion,
        previous.lastAcceptedProviderEventVersion,
      );
    }
    if (
      current.providerOccurredAt !== null &&
      previous.lastAcceptedProviderOccurredAt !== null
    ) {
      return current.providerOccurredAt.getTime() <
        previous.lastAcceptedProviderOccurredAt.getTime()
        ? -1
        : current.providerOccurredAt.getTime() >
            previous.lastAcceptedProviderOccurredAt.getTime()
          ? 1
          : 0;
    }
    return null;
  }

  private hasOrderingEvidence(event: NormalizedPaymentProviderEvent): boolean {
    return (
      event.providerEventSequence !== null ||
      event.providerEventVersion !== null ||
      event.providerOccurredAt !== null
    );
  }

  private compareOrderingToken(current: string, previous: string): number {
    if (/^\d+$/.test(current) && /^\d+$/.test(previous)) {
      const currentNumber = BigInt(current);
      const previousNumber = BigInt(previous);
      return currentNumber < previousNumber
        ? -1
        : currentNumber > previousNumber
          ? 1
          : 0;
    }
    return current < previous ? -1 : current > previous ? 1 : 0;
  }

  private isNewerOrderingEvidence<T>(
    current: T | null,
    previous: T | null,
    compare: (current: T, previous: T) => number,
  ): current is T {
    return (
      current !== null && (previous === null || compare(current, previous) > 0)
    );
  }

  private sameDate(left: Date | null, right: Date | null): boolean {
    return left?.getTime() === right?.getTime();
  }

  private validateInput(input: PaymentEntitlementReconciliationInput): void {
    const request: PaymentProviderAdapterRequest = input.request;
    const event: NormalizedPaymentProviderEvent = input.event;
    if (!Buffer.isBuffer(request.rawBody) || request.rawBody.length === 0) {
      throw new PaymentProviderInputError();
    }
    if (
      request.provider.trim().toLowerCase() !==
        event.provider.trim().toLowerCase() ||
      request.environment.trim().toLowerCase() !==
        event.environment.trim().toLowerCase()
    ) {
      throw new PaymentProviderInputError();
    }
    if (!event.providerEventId.trim() || !event.normalizedEventKind.trim()) {
      throw new PaymentProviderInputError();
    }
    if (!/^[0-9a-f]{64}$/i.test(event.payloadHash)) {
      throw new PaymentProviderInputError();
    }
    for (const date of [event.providerOccurredAt, event.paidThroughAt]) {
      if (
        date !== null &&
        (!(date instanceof Date) || !Number.isFinite(date.getTime()))
      ) {
        throw new PaymentProviderInputError();
      }
    }
  }

  private async runTransaction<T>(
    work: (tx: ReconciliationTransaction) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }

  private isRetryableTransactionError(error: unknown): boolean {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
    if (code === 'P2002' || code === 'P2034') return true;
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    return (
      message.includes('serialization') ||
      message.includes('deadlock') ||
      message.includes('could not serialize')
    );
  }

  private errorType(error: unknown): string {
    return error instanceof Error ? error.constructor.name : typeof error;
  }
}
