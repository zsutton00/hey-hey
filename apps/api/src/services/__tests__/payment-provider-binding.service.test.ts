import { PaymentProviderBindingStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationId } from '../../types';
import { PaymentProviderBindingService } from '../payment-entitlement/payment-provider-binding.service';

describe('PaymentProviderBindingService', () => {
  const organizationId =
    '50e01076-bce8-4a65-b205-c5da8480e8fb' as OrganizationId;
  const binding = {
    id: 'binding-1',
    organizationId,
    provider: 'stripe',
    environment: 'sandbox',
    externalCustomerId: 'cus_123',
    externalSubscriptionId: 'sub_123',
    status: PaymentProviderBindingStatus.ACTIVE,
    revision: 1,
  };
  let tx: any;
  let prisma: PrismaService;
  let service: PaymentProviderBindingService;

  beforeEach(() => {
    tx = {
      paymentProviderBinding: {
        create: jest.fn(async ({ data }) => ({ ...binding, ...data })),
        findUnique: jest.fn(async () => binding),
        findUniqueOrThrow: jest.fn(async () => ({ ...binding, revision: 2 })),
        findMany: jest.fn(async () => [binding]),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      organizationClosureProviderCorrelationTombstone: {
        createMany: jest.fn(async () => ({ count: 1 })),
        findMany: jest.fn(async () => []),
      },
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    prisma = { db: tx } as unknown as PrismaService;
    service = new PaymentProviderBindingService(prisma);
  });

  it('creates an active binding from provider-owned identifiers', async () => {
    const result = await service.createBinding({
      organizationId,
      provider: ' Stripe ',
      environment: 'Sandbox',
      externalCustomerId: 'cus_123',
      actor: 'operator',
      reason: 'Attach verified provider customer',
    });

    expect(result.status).toBe(PaymentProviderBindingStatus.ACTIVE);
    expect(tx.paymentProviderBinding.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'stripe',
        environment: 'sandbox',
        externalCustomerId: 'cus_123',
        externalSubscriptionId: null,
      }),
    });
  });

  it('rotates identifiers with an optimistic revision and keeps organization ownership', async () => {
    await service.rotateBinding({
      bindingId: binding.id,
      externalCustomerId: 'cus_rotated',
      externalSubscriptionId: null,
      actor: 'operator',
      reason: 'Rotate provider customer',
    });

    expect(tx.paymentProviderBinding.updateMany).toHaveBeenCalledWith({
      where: { id: binding.id, revision: 1 },
      data: expect.objectContaining({
        externalCustomerId: 'cus_rotated',
        externalSubscriptionId: null,
        lastAcceptedProviderEventSequence: null,
        lastAcceptedProviderEventVersion: null,
        lastAcceptedProviderOccurredAt: null,
        revision: { increment: 1 },
      }),
    });
  });

  it('disables a binding idempotently and excludes disabled bindings from resolution', async () => {
    await service.disableBinding(binding.id, {
      actor: 'operator',
      reason: 'Disable retired provider connection',
    });
    expect(tx.paymentProviderBinding.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PaymentProviderBindingStatus.DISABLED,
        }),
      }),
    );

    tx.paymentProviderBinding.findMany.mockResolvedValueOnce([]);
    await expect(
      service.resolveBinding({
        provider: 'stripe',
        environment: 'sandbox',
        externalCustomerId: 'cus_123',
      }),
    ).resolves.toBeNull();
    expect(tx.paymentProviderBinding.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        status: PaymentProviderBindingStatus.ACTIVE,
      }),
    });
  });

  it('fails closed for ambiguous and mismatched provider identifiers', async () => {
    tx.paymentProviderBinding.findMany.mockResolvedValueOnce([
      binding,
      { ...binding, id: 'binding-2' },
    ]);
    await expect(
      service.resolveBinding({
        provider: 'stripe',
        environment: 'sandbox',
        externalCustomerId: 'cus_123',
      }),
    ).rejects.toThrow('multiple bindings');

    tx.paymentProviderBinding.findMany.mockResolvedValueOnce([
      { ...binding, externalSubscriptionId: 'sub_other' },
    ]);
    await expect(
      service.resolveBinding({
        provider: 'stripe',
        environment: 'sandbox',
        externalCustomerId: 'cus_123',
        externalSubscriptionId: 'sub_123',
      }),
    ).resolves.toBeNull();
  });

  it('snapshots only provider/environment and opaque identifiers for a closure marker', async () => {
    await service.snapshotForClosure(tx, organizationId, 'marker-1');

    expect(
      tx.organizationClosureProviderCorrelationTombstone.createMany,
    ).toHaveBeenCalledWith({
      data: [
        {
          organizationId,
          markerId: 'marker-1',
          provider: 'stripe',
          environment: 'sandbox',
          externalCustomerId: 'cus_123',
          externalSubscriptionId: 'sub_123',
        },
      ],
      skipDuplicates: true,
    });
  });

  it('resolves an exact closure correlation but rejects a paired mismatch', async () => {
    tx.organizationClosureProviderCorrelationTombstone.findMany.mockResolvedValueOnce(
      [
        {
          id: 'tombstone-1',
          organizationId,
          markerId: 'marker-1',
          provider: 'stripe',
          environment: 'sandbox',
          externalCustomerId: 'cus_123',
          externalSubscriptionId: 'sub_123',
        },
      ],
    );
    await expect(
      service.resolveClosureCorrelation({
        provider: 'stripe',
        environment: 'sandbox',
        externalCustomerId: 'cus_123',
        externalSubscriptionId: 'sub_123',
      }),
    ).resolves.toMatchObject({ markerId: 'marker-1' });

    tx.organizationClosureProviderCorrelationTombstone.findMany.mockResolvedValueOnce(
      [
        {
          id: 'tombstone-1',
          organizationId,
          markerId: 'marker-1',
          provider: 'stripe',
          environment: 'sandbox',
          externalCustomerId: 'cus_123',
          externalSubscriptionId: 'sub_other',
        },
      ],
    );
    await expect(
      service.resolveClosureCorrelation({
        provider: 'stripe',
        environment: 'sandbox',
        externalCustomerId: 'cus_123',
        externalSubscriptionId: 'sub_123',
      }),
    ).resolves.toBeNull();
  });
});
