import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentProviderBinding,
  PaymentProviderBindingStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { OrganizationId } from '../../types';

export interface PaymentProviderBindingAuditMetadata {
  actor: string;
  reason: string;
}

export interface CreatePaymentProviderBindingInput
  extends PaymentProviderBindingAuditMetadata {
  organizationId: OrganizationId;
  provider: string;
  environment: string;
  externalCustomerId?: string | null;
  externalSubscriptionId?: string | null;
}

export interface RotatePaymentProviderBindingInput
  extends PaymentProviderBindingAuditMetadata {
  bindingId: string;
  provider?: string;
  environment?: string;
  externalCustomerId?: string | null;
  externalSubscriptionId?: string | null;
}

export interface ResolvePaymentProviderBindingInput {
  provider: string;
  environment: string;
  externalCustomerId?: string | null;
  externalSubscriptionId?: string | null;
}

export interface ResolveClosureProviderCorrelationInput {
  provider: string;
  environment: string;
  externalCustomerId?: string | null;
  externalSubscriptionId?: string | null;
}

@Injectable()
export class PaymentProviderBindingService {
  constructor(private readonly prisma: PrismaService) {}

  async createBinding(
    input: CreatePaymentProviderBindingInput,
  ): Promise<PaymentProviderBinding> {
    this.validateCorrelation(input);
    this.validateAudit(input);

    return this.prisma.db.paymentProviderBinding.create({
      data: {
        organizationId: input.organizationId,
        provider: this.normalizeKey(input.provider, 'provider'),
        environment: this.normalizeKey(input.environment, 'environment'),
        externalCustomerId: this.normalizeOptional(
          input.externalCustomerId,
          'externalCustomerId',
        ),
        externalSubscriptionId: this.normalizeOptional(
          input.externalSubscriptionId,
          'externalSubscriptionId',
        ),
        status: PaymentProviderBindingStatus.ACTIVE,
        revision: 1,
        createdBy: input.actor,
        createdReason: input.reason,
        updatedBy: input.actor,
        updateReason: input.reason,
      },
    });
  }

  async rotateBinding(
    input: RotatePaymentProviderBindingInput,
  ): Promise<PaymentProviderBinding> {
    this.validateAudit(input);

    return this.prisma.db.$transaction(async (tx) => {
      const current = await tx.paymentProviderBinding.findUnique({
        where: { id: input.bindingId },
      });
      if (!current) {
        throw new NotFoundException('Payment provider binding does not exist');
      }

      const externalCustomerId =
        input.externalCustomerId === undefined
          ? current.externalCustomerId
          : this.normalizeOptional(
              input.externalCustomerId,
              'externalCustomerId',
            );
      const externalSubscriptionId =
        input.externalSubscriptionId === undefined
          ? current.externalSubscriptionId
          : this.normalizeOptional(
              input.externalSubscriptionId,
              'externalSubscriptionId',
            );
      this.validateCorrelation({ externalCustomerId, externalSubscriptionId });
      const provider =
        input.provider === undefined
          ? current.provider
          : this.normalizeKey(input.provider, 'provider');
      const environment =
        input.environment === undefined
          ? current.environment
          : this.normalizeKey(input.environment, 'environment');
      const providerIdentityChanged =
        provider !== current.provider ||
        environment !== current.environment ||
        externalCustomerId !== current.externalCustomerId ||
        externalSubscriptionId !== current.externalSubscriptionId;

      const updated = await tx.paymentProviderBinding.updateMany({
        where: { id: current.id, revision: current.revision },
        data: {
          provider,
          environment,
          externalCustomerId,
          externalSubscriptionId,
          ...(providerIdentityChanged
            ? {
                lastAcceptedProviderEventSequence: null,
                lastAcceptedProviderEventVersion: null,
                lastAcceptedProviderOccurredAt: null,
              }
            : {}),
          revision: { increment: 1 },
          updatedBy: input.actor,
          updateReason: input.reason,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'Payment provider binding revision conflict',
        );
      }

      return tx.paymentProviderBinding.findUniqueOrThrow({
        where: { id: current.id },
      });
    });
  }

  async disableBinding(
    bindingId: string,
    metadata: PaymentProviderBindingAuditMetadata,
  ): Promise<PaymentProviderBinding> {
    this.validateAudit(metadata);

    return this.prisma.db.$transaction(async (tx) => {
      const current = await tx.paymentProviderBinding.findUnique({
        where: { id: bindingId },
      });
      if (!current) {
        throw new NotFoundException('Payment provider binding does not exist');
      }
      if (current.status === PaymentProviderBindingStatus.DISABLED) {
        return current;
      }

      const updated = await tx.paymentProviderBinding.updateMany({
        where: { id: current.id, revision: current.revision },
        data: {
          status: PaymentProviderBindingStatus.DISABLED,
          revision: { increment: 1 },
          updatedBy: metadata.actor,
          updateReason: metadata.reason,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'Payment provider binding revision conflict',
        );
      }

      return tx.paymentProviderBinding.findUniqueOrThrow({
        where: { id: current.id },
      });
    });
  }

  async resolveBinding(
    input: ResolvePaymentProviderBindingInput,
  ): Promise<PaymentProviderBinding | null> {
    const provider = this.normalizeKey(input.provider, 'provider');
    const environment = this.normalizeKey(input.environment, 'environment');
    const externalCustomerId = this.normalizeOptional(
      input.externalCustomerId,
      'externalCustomerId',
    );
    const externalSubscriptionId = this.normalizeOptional(
      input.externalSubscriptionId,
      'externalSubscriptionId',
    );
    this.validateCorrelation({ externalCustomerId, externalSubscriptionId });

    const candidates = await this.prisma.db.paymentProviderBinding.findMany({
      where: {
        provider,
        environment,
        status: PaymentProviderBindingStatus.ACTIVE,
        OR: [
          ...(externalCustomerId ? [{ externalCustomerId }] : []),
          ...(externalSubscriptionId ? [{ externalSubscriptionId }] : []),
        ],
      },
    });
    if (candidates.length > 1) {
      throw new ConflictException(
        'Payment provider identifiers resolve to multiple bindings',
      );
    }

    const candidate = candidates[0];
    if (!candidate) return null;

    // If an event supplies both provider-owned identifiers, they must agree on
    // the same binding. An OR query alone would otherwise accept a mismatched
    // customer/subscription pair.
    if (
      (externalCustomerId !== null &&
        candidate.externalCustomerId !== externalCustomerId) ||
      (externalSubscriptionId !== null &&
        candidate.externalSubscriptionId !== externalSubscriptionId)
    ) {
      return null;
    }
    return candidate;
  }

  async snapshotForClosure(
    tx: Prisma.TransactionClient,
    organizationId: OrganizationId,
    markerId: string,
  ): Promise<void> {
    const bindings = await tx.paymentProviderBinding.findMany({
      where: { organizationId },
      select: {
        provider: true,
        environment: true,
        externalCustomerId: true,
        externalSubscriptionId: true,
      },
    });
    if (bindings.length === 0) return;

    await tx.organizationClosureProviderCorrelationTombstone.createMany({
      data: bindings.map((binding) => ({
        organizationId,
        markerId,
        provider: binding.provider,
        environment: binding.environment,
        externalCustomerId: binding.externalCustomerId,
        externalSubscriptionId: binding.externalSubscriptionId,
      })),
      skipDuplicates: true,
    });
  }

  async resolveClosureCorrelation(
    input: ResolveClosureProviderCorrelationInput,
    tx?: Prisma.TransactionClient,
  ) {
    const provider = this.normalizeKey(input.provider, 'provider');
    const environment = this.normalizeKey(input.environment, 'environment');
    const externalCustomerId = this.normalizeOptional(
      input.externalCustomerId,
      'externalCustomerId',
    );
    const externalSubscriptionId = this.normalizeOptional(
      input.externalSubscriptionId,
      'externalSubscriptionId',
    );
    this.validateCorrelation({ externalCustomerId, externalSubscriptionId });

    const where = {
      provider,
      environment,
      OR: [
        ...(externalCustomerId ? [{ externalCustomerId }] : []),
        ...(externalSubscriptionId ? [{ externalSubscriptionId }] : []),
      ],
    };
    const candidates = tx
      ? await tx.organizationClosureProviderCorrelationTombstone.findMany({
          where,
        })
      : await this.prisma.db.organizationClosureProviderCorrelationTombstone.findMany(
          { where },
        );
    if (candidates.length > 1) {
      throw new ConflictException(
        'Payment provider identifiers resolve to multiple closure markers',
      );
    }

    const candidate = candidates[0];
    if (!candidate) return null;
    if (
      (externalCustomerId !== null &&
        candidate.externalCustomerId !== externalCustomerId) ||
      (externalSubscriptionId !== null &&
        candidate.externalSubscriptionId !== externalSubscriptionId)
    ) {
      return null;
    }
    return candidate;
  }

  private validateCorrelation(input: {
    externalCustomerId?: string | null;
    externalSubscriptionId?: string | null;
  }): void {
    const customer = this.normalizeOptional(
      input.externalCustomerId,
      'externalCustomerId',
    );
    const subscription = this.normalizeOptional(
      input.externalSubscriptionId,
      'externalSubscriptionId',
    );
    if (!customer && !subscription) {
      throw new BadRequestException(
        'At least one provider-owned correlation identifier is required',
      );
    }
  }

  private validateAudit(metadata: PaymentProviderBindingAuditMetadata): void {
    if (!metadata.actor?.trim() || !metadata.reason?.trim()) {
      throw new BadRequestException(
        'Binding audit actor and reason are required',
      );
    }
    if (metadata.actor.length > 120 || metadata.reason.length > 255) {
      throw new BadRequestException(
        'Binding audit metadata exceeds storage limits',
      );
    }
  }

  private normalizeKey(value: string, field: string): string {
    if (!value?.trim()) {
      throw new BadRequestException(`${field} is required`);
    }
    return value.trim().toLowerCase();
  }

  private normalizeOptional(
    value: string | null | undefined,
    field: string,
  ): string | null {
    if (value === null || value === undefined) return null;
    if (!value.trim()) {
      throw new BadRequestException(`${field} cannot be blank`);
    }
    return value.trim();
  }
}
