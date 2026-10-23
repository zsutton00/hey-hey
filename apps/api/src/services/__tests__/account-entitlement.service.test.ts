import { AccountAccessStatus, AccountSubscriptionType } from '@prisma/client';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AccountEntitlementService } from '../account-entitlement.service';
import { OrganizationId } from '../../types';

const organizationId = 'organization-1' as OrganizationId;
const now = new Date('2026-08-13T12:00:00.000Z');

const entitlement = (
  overrides: Partial<{
    subscriptionType: AccountSubscriptionType;
    accessStatus: AccountAccessStatus;
    accessThroughAt: Date | null;
    paidThroughAt: Date | null;
    revision: number;
  }> = {},
) => ({
  subscriptionType: AccountSubscriptionType.BETA,
  accessStatus: AccountAccessStatus.ACTIVE,
  accessThroughAt: null,
  paidThroughAt: null,
  revision: 1,
  ...overrides,
});

describe('AccountEntitlementService', () => {
  const createService = (db: Record<string, unknown> = {}) =>
    new AccountEntitlementService(db as never);

  it.each([
    ['open-ended beta', entitlement(), true, AccountAccessStatus.ACTIVE],
    [
      'future beta expiry',
      entitlement({ accessThroughAt: new Date('2026-08-14T00:00:00.000Z') }),
      true,
      AccountAccessStatus.ACTIVE,
    ],
    [
      'elapsed beta expiry',
      entitlement({ accessThroughAt: new Date('2026-08-13T00:00:00.000Z') }),
      false,
      AccountAccessStatus.EXPIRED,
    ],
    [
      'future paid-through',
      entitlement({
        subscriptionType: AccountSubscriptionType.PAID,
        paidThroughAt: new Date('2026-08-14T00:00:00.000Z'),
      }),
      true,
      AccountAccessStatus.ACTIVE,
    ],
    [
      'elapsed paid-through',
      entitlement({
        subscriptionType: AccountSubscriptionType.PAID,
        paidThroughAt: new Date('2026-08-13T00:00:00.000Z'),
      }),
      false,
      AccountAccessStatus.EXPIRED,
    ],
    [
      'missing paid-through',
      entitlement({ subscriptionType: AccountSubscriptionType.PAID }),
      false,
      AccountAccessStatus.EXPIRED,
    ],
    [
      'revoked beta',
      entitlement({ accessStatus: AccountAccessStatus.REVOKED }),
      false,
      AccountAccessStatus.REVOKED,
    ],
  ])('resolves %s', (_case, record, authorized, status) => {
    const service = createService();

    expect(service.resolve(record, now)).toMatchObject({ authorized, status });
  });

  it('never treats an expiring beta record as paid', () => {
    const service = createService();
    const accessThroughAt = new Date('2026-08-14T00:00:00.000Z');

    expect(service.resolve(entitlement({ accessThroughAt }), now)).toEqual({
      authorized: true,
      status: AccountAccessStatus.ACTIVE,
      subscriptionType: AccountSubscriptionType.BETA,
      accessHorizon: accessThroughAt,
      revision: 1,
    });
  });

  it('denies a tenant batch when any requested organization is missing or inactive', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([
        { organizationId: 'organization-1', ...entitlement() },
      ]);
    const service = createService({
      accountEntitlement: { findMany },
      organizationAccountLifecycle: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    });

    await expect(
      service.areOrganizationsAuthorized([
        'organization-1' as OrganizationId,
        'foreign-organization' as OrganizationId,
      ]),
    ).resolves.toBe(false);
    expect(findMany).toHaveBeenCalledWith({
      select: {
        organizationId: true,
        subscriptionType: true,
        accessStatus: true,
        accessThroughAt: true,
        paidThroughAt: true,
        revision: true,
      },
      where: {
        organizationId: {
          in: ['organization-1', 'foreign-organization'],
        },
      },
    });
  });

  it('returns only organizations whose current entitlement resolves active', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { organizationId: 'organization-1', ...entitlement() },
      {
        organizationId: 'organization-2',
        ...entitlement({ accessStatus: AccountAccessStatus.REVOKED }),
      },
    ]);
    const service = createService({
      accountEntitlement: { findMany },
      organizationAccountLifecycle: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    });

    await expect(
      service.getAuthorizedOrganizationIds(
        [
          'organization-1' as OrganizationId,
          'organization-2' as OrganizationId,
        ],
        now,
      ),
    ).resolves.toEqual(new Set(['organization-1']));
  });

  it('keeps a scheduled account authorized through its immutable closure snapshot', () => {
    const service = createService();
    const effectiveClosureAt = new Date('2026-08-14T00:00:00.000Z');

    expect(
      service.resolve(
        entitlement({ accessStatus: AccountAccessStatus.REVOKED }),
        now,
        { accessEndsAt: effectiveClosureAt },
      ),
    ).toMatchObject({
      authorized: true,
      status: AccountAccessStatus.ACTIVE,
      accessHorizon: effectiveClosureAt,
    });
  });

  it('re-reads lifecycle decisions and denies at the access horizon', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        organizationId,
        ...entitlement(),
      },
    ]);
    const findLifecycles = jest.fn().mockResolvedValue([
      {
        organizationId,
        accessEndsAt: new Date(now.getTime() + 1000),
      },
    ]);
    const service = createService({
      accountEntitlement: { findMany },
      organizationAccountLifecycle: { findMany: findLifecycles },
    });
    await expect(
      service.getAuthorizedOrganizationIds([organizationId], now),
    ).resolves.toEqual(new Set([organizationId]));
    await expect(
      service.getAuthorizedOrganizationIds(
        [organizationId],
        new Date(now.getTime() + 1000),
      ),
    ).resolves.toEqual(new Set());
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findLifecycles).toHaveBeenCalledTimes(2);
    expect(findLifecycles).toHaveBeenCalledWith({
      where: { organizationId: { in: [organizationId] } },
      select: { organizationId: true, accessEndsAt: true },
    });
  });

  it('denies access at the closure snapshot despite later entitlement state', () => {
    const service = createService();

    expect(
      service.resolve(entitlement(), now, {
        accessEndsAt: new Date('2026-08-13T12:00:00.000Z'),
      }),
    ).toMatchObject({
      authorized: false,
      status: AccountAccessStatus.REVOKED,
    });
  });

  it('creates beta admission and its initial evidence once', async () => {
    const current = {
      organizationId,
      ...entitlement(),
      createdAt: now,
      createdBy: 'user-1',
      createdReason: 'PRIVATE_BETA_ADMISSION:request-1',
      updatedAt: now,
      updatedBy: 'user-1',
      updateReason: 'PRIVATE_BETA_ADMISSION:request-1',
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: organizationId }]),
      accountEntitlement: {
        createMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(current),
      },
      accountEntitlementTransition: {
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({
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
          changedBy: 'user-1',
          reason: 'PRIVATE_BETA_ADMISSION:request-1',
        }),
      },
    };
    const service = createService();

    await service.createBetaAtAdmissionInTransaction(
      tx as never,
      organizationId,
      { actor: 'user-1', reason: 'PRIVATE_BETA_ADMISSION:request-1' },
    );
    await service.createBetaAtAdmissionInTransaction(
      tx as never,
      organizationId,
      { actor: 'user-1', reason: 'PRIVATE_BETA_ADMISSION:request-1' },
    );

    expect(tx.accountEntitlementTransition.create).toHaveBeenCalledTimes(1);
    expect(tx.accountEntitlementTransition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId,
        fromRevision: null,
        toRevision: 1,
        subscriptionType: AccountSubscriptionType.BETA,
        paidThroughAt: null,
      }),
    });
    expect(tx.accountEntitlementTransition.findUnique).toHaveBeenCalledTimes(1);
  });

  it('rejects replay when its initial transition evidence is missing', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: organizationId }]),
      accountEntitlement: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({
          organizationId,
          ...entitlement(),
          createdBy: 'user-1',
          createdReason: 'PRIVATE_BETA_ADMISSION:request-1',
          updatedBy: 'user-1',
          updateReason: 'PRIVATE_BETA_ADMISSION:request-1',
        }),
      },
      accountEntitlementTransition: {
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const service = createService();

    await expect(
      service.createBetaAtAdmissionInTransaction(tx as never, organizationId, {
        actor: 'user-1',
        reason: 'PRIVATE_BETA_ADMISSION:request-1',
      }),
    ).rejects.toThrow(ConflictException);
    expect(tx.accountEntitlementTransition.create).not.toHaveBeenCalled();
  });

  it('fails a conflicting admission without replacing the current authority', async () => {
    const tx = {
      accountEntitlement: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({
          organizationId,
          ...entitlement(),
          createdBy: 'another-user',
          createdReason: 'PRIVATE_BETA_ADMISSION:another-request',
        }),
      },
      accountEntitlementTransition: { create: jest.fn() },
    };
    const service = createService();

    await expect(
      service.createBetaAtAdmissionInTransaction(tx as never, organizationId, {
        actor: 'user-1',
        reason: 'PRIVATE_BETA_ADMISSION:request-1',
      }),
    ).rejects.toThrow(ConflictException);
    expect(tx.accountEntitlementTransition.create).not.toHaveBeenCalled();
  });

  it('reuses an admission-owned entitlement after a valid later transition', async () => {
    const accessThroughAt = new Date('2026-08-14T00:00:00.000Z');
    const current = {
      organizationId,
      ...entitlement({ accessThroughAt, revision: 2 }),
      createdBy: 'user-1',
      createdReason: 'PRIVATE_BETA_ADMISSION:request-1',
      updatedBy: 'operator-1',
      updateReason: 'Set beta expiry',
    };
    const tx = {
      accountEntitlement: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(current),
      },
      accountEntitlementTransition: {
        create: jest.fn(),
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
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
            changedBy: 'user-1',
            reason: 'PRIVATE_BETA_ADMISSION:request-1',
          })
          .mockResolvedValueOnce({
            organizationId,
            fromRevision: 1,
            toRevision: 2,
            subscriptionType: AccountSubscriptionType.BETA,
            accessStatus: AccountAccessStatus.ACTIVE,
            accessThroughAt,
            paidThroughAt: null,
            changedBy: 'operator-1',
            reason: 'Set beta expiry',
          }),
      },
    };
    const service = createService();

    await expect(
      service.createBetaAtAdmissionInTransaction(tx as never, organizationId, {
        actor: 'user-1',
        reason: 'PRIVATE_BETA_ADMISSION:request-1',
      }),
    ).resolves.toBe(current);
    expect(tx.accountEntitlementTransition.create).not.toHaveBeenCalled();
    expect(tx.accountEntitlementTransition.findUnique).toHaveBeenCalledTimes(2);
  });

  it('rolls a successful revision-checked update and evidence into one transaction', async () => {
    const current = { organizationId, ...entitlement() };
    const transitioned = {
      ...current,
      accessThroughAt: new Date('2026-08-14T00:00:00.000Z'),
      revision: 2,
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: organizationId }]),
      accountEntitlement: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(current)
          .mockResolvedValueOnce(transitioned),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      accountEntitlementTransition: { create: jest.fn() },
    };
    const transaction = jest.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
    const service = createService({ $transaction: transaction });

    await expect(
      service.transition(
        organizationId,
        1,
        {
          subscriptionType: AccountSubscriptionType.BETA,
          accessStatus: AccountAccessStatus.ACTIVE,
          accessThroughAt: transitioned.accessThroughAt,
          paidThroughAt: null,
        },
        { actor: 'user-1', reason: 'Set beta expiry' },
      ),
    ).resolves.toBe(transitioned);

    expect(tx.accountEntitlement.updateMany).toHaveBeenCalledWith({
      where: { organizationId, revision: 1 },
      data: expect.objectContaining({ revision: { increment: 1 } }),
    });
    expect(tx.accountEntitlementTransition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId,
        fromRevision: 1,
        toRevision: 2,
        previousAccessThroughAt: null,
        accessThroughAt: transitioned.accessThroughAt,
      }),
    });
  });

  it('writes no transition evidence when the expected revision conflicts', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: organizationId }]),
      accountEntitlement: {
        findUnique: jest.fn().mockResolvedValue({
          organizationId,
          ...entitlement({ revision: 2 }),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      accountEntitlementTransition: { create: jest.fn() },
    };
    const service = createService({
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    });

    await expect(
      service.transition(
        organizationId,
        1,
        {
          subscriptionType: AccountSubscriptionType.BETA,
          accessStatus: AccountAccessStatus.REVOKED,
          accessThroughAt: null,
          paidThroughAt: null,
        },
        { actor: 'user-1', reason: 'Revoke access' },
      ),
    ).rejects.toThrow(ConflictException);
    expect(tx.accountEntitlementTransition.create).not.toHaveBeenCalled();
  });

  it('rejects provider-incompatible beta paid-through data before persistence', async () => {
    const transaction = jest.fn();
    const service = createService({ $transaction: transaction });

    await expect(
      service.transition(
        organizationId,
        1,
        {
          subscriptionType: AccountSubscriptionType.BETA,
          accessStatus: AccountAccessStatus.ACTIVE,
          accessThroughAt: null,
          paidThroughAt: new Date('2026-08-14T00:00:00.000Z'),
        },
        { actor: 'user-1', reason: 'Invalid beta transition' },
      ),
    ).rejects.toThrow('BETA account entitlement cannot have paidThroughAt');
    expect(transaction).not.toHaveBeenCalled();
  });

  describe('makeBetaAccessOpenEnded', () => {
    const expiring = {
      organizationId,
      ...entitlement({
        accessThroughAt: new Date('2099-09-30T00:00:00.000Z'),
        revision: 3,
      }),
      createdAt: now,
      createdBy: 'admission-operator',
      createdReason: 'Private beta admission',
      updatedAt: now,
      updatedBy: 'admission-operator',
      updateReason: 'Set beta expiry',
    };

    const createAdministrativeTransaction = (
      current: typeof expiring | null = expiring,
      lifecycle: Record<string, unknown> | null = null,
    ) => {
      const transitioned = current
        ? {
            ...current,
            accessStatus: AccountAccessStatus.ACTIVE,
            accessThroughAt: null,
            paidThroughAt: null,
            revision: current.revision + 1,
            updatedAt: new Date('2026-09-10T06:00:00.000Z'),
          }
        : null;
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: organizationId }]),
        accountEntitlement: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce(current)
            .mockResolvedValueOnce(transitioned),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        accountEntitlementTransition: { create: jest.fn() },
        organizationAccountLifecycle: {
          findUnique: jest.fn().mockResolvedValue(lifecycle),
        },
      };
      const service = createService({
        $transaction: jest.fn(
          async (callback: (client: typeof tx) => Promise<unknown>) =>
            callback(tx),
        ),
      });
      return { service, tx, transitioned };
    };

    it('atomically makes an expiring beta entitlement open-ended and appends evidence', async () => {
      const { service, tx, transitioned } = createAdministrativeTransaction();

      await expect(
        service.makeBetaAccessOpenEnded(organizationId, 3, {
          actor: 'platform-admin',
          reason: 'Extend approved beta access',
        }),
      ).resolves.toEqual(transitioned);

      expect(tx.accountEntitlement.updateMany).toHaveBeenCalledWith({
        where: { organizationId, revision: 3 },
        data: expect.objectContaining({
          subscriptionType: AccountSubscriptionType.BETA,
          accessStatus: AccountAccessStatus.ACTIVE,
          accessThroughAt: null,
          paidThroughAt: null,
          revision: { increment: 1 },
          updatedBy: 'platform-admin',
          updateReason: 'Extend approved beta access',
        }),
      });
      expect(tx.accountEntitlementTransition.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fromRevision: 3,
          toRevision: 4,
          previousAccessThroughAt: expiring.accessThroughAt,
          accessThroughAt: null,
          changedBy: 'platform-admin',
          reason: 'Extend approved beta access',
        }),
      });
    });

    it.each([
      ['missing', null, null, 3, NotFoundException],
      ['stale revision', expiring, null, 2, ConflictException],
      [
        'paid basis',
        {
          ...expiring,
          subscriptionType: AccountSubscriptionType.PAID,
          accessThroughAt: null,
          paidThroughAt: new Date('2026-09-30T00:00:00.000Z'),
        },
        null,
        3,
        BadRequestException,
      ],
      [
        'already open-ended beta',
        { ...expiring, accessThroughAt: null },
        null,
        3,
        BadRequestException,
      ],
      [
        'revoked beta',
        { ...expiring, accessStatus: AccountAccessStatus.REVOKED },
        null,
        3,
        BadRequestException,
      ],
      [
        'expired beta horizon',
        {
          ...expiring,
          accessThroughAt: new Date('2020-09-30T00:00:00.000Z'),
        },
        null,
        3,
        BadRequestException,
      ],
      [
        'irreversible closure',
        expiring,
        {
          irreversibleClosureAt: new Date('2026-09-09T00:00:00.000Z'),
          accessEndsAt: new Date('2026-08-01T00:00:00.000Z'),
        },
        3,
        ConflictException,
      ],
    ])(
      'rejects %s without changing entitlement, evidence, or lifecycle',
      async (_label, current, lifecycle, expectedRevision, exception) => {
        const { service, tx } = createAdministrativeTransaction(
          current as typeof expiring | null,
          lifecycle,
        );

        await expect(
          service.makeBetaAccessOpenEnded(organizationId, expectedRevision, {
            actor: 'platform-admin',
            reason: 'Extend approved beta access',
          }),
        ).rejects.toThrow(exception);

        expect(tx.accountEntitlement.updateMany).not.toHaveBeenCalled();
        expect(tx.accountEntitlementTransition.create).not.toHaveBeenCalled();
        expect(tx.organizationAccountLifecycle.findUnique).toHaveBeenCalled();
      },
    );

    it.each([
      ['', 'reason'],
      ['platform-admin', ''],
      ['platform-admin', undefined],
      ['platform-admin', 123],
    ])(
      'rejects missing audit metadata before opening a transaction',
      async (actor, reason) => {
        const transaction = jest.fn();
        const service = createService({ $transaction: transaction });

        await expect(
          service.makeBetaAccessOpenEnded(organizationId, 3, {
            actor,
            reason,
          } as never),
        ).rejects.toThrow('Entitlement audit actor and reason are required');
        expect(transaction).not.toHaveBeenCalled();
      },
    );
  });
});
