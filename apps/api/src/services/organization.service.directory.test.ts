import { BadRequestException } from '@nestjs/common';
import { OrganizationService } from './organization.service';
import {
  OrganizationDirectorySortBy,
  OrganizationDirectorySortOrder,
} from '../generated';
import { AccountAccessStatus, AccountSubscriptionType } from '@prisma/client';

describe('OrganizationService.listOrganizationDirectory', () => {
  const organizationFindMany = jest.fn();
  const entitlementFindMany = jest.fn();
  const lifecycleFindMany = jest.fn();
  const resolveEntitlement = jest.fn();
  const service = new OrganizationService(
    { membershipRemoved: jest.fn() } as never,
    {} as never,
    {
      db: {
        organization: { findMany: organizationFindMany },
        accountEntitlement: { findMany: entitlementFindMany },
        organizationAccountLifecycle: { findMany: lifecycleFindMany },
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { resolve: resolveEntitlement } as never,
  );

  beforeEach(() => {
    organizationFindMany.mockReset();
    entitlementFindMany.mockReset();
    lifecycleFindMany.mockReset();
    resolveEntitlement.mockReset();
    entitlementFindMany.mockImplementation(({ where }) =>
      Promise.resolve(
        where.organizationId.in.map((organizationId: string) => ({
          organizationId,
          subscriptionType: AccountSubscriptionType.BETA,
          accessStatus: AccountAccessStatus.ACTIVE,
        })),
      ),
    );
    lifecycleFindMany.mockResolvedValue([]);
    resolveEntitlement.mockImplementation((entitlement) => ({
      subscriptionType: entitlement?.subscriptionType ?? null,
      status: entitlement?.accessStatus ?? AccountAccessStatus.EXPIRED,
    }));
  });

  it('returns newest organizations by default with stable pagination metadata', async () => {
    organizationFindMany.mockResolvedValue([
      {
        id: 'org-old',
        name: 'Old Organization',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        _count: { members: 2 },
      },
      {
        id: 'org-new',
        name: 'New Organization',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        _count: { members: 4 },
      },
    ]);

    await expect(
      service.listOrganizationDirectory({ limit: '1' }),
    ).resolves.toEqual(
      expect.objectContaining({
        organizations: [
          expect.objectContaining({ id: 'org-new', memberCount: 4 }),
        ],
        totalCount: 2,
        nextCursor: expect.any(String),
      }),
    );

    expect(organizationFindMany).toHaveBeenCalledWith({
      where: undefined,
      select: {
        id: true,
        name: true,
        createdAt: true,
        _count: { select: { members: true } },
      },
    });
  });

  it('filters by name, supports each sort field, and resumes the exact query after a cursor', async () => {
    organizationFindMany.mockResolvedValue([
      {
        id: 'org-a',
        name: 'Alpha',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        _count: { members: 8 },
      },
      {
        id: 'org-b',
        name: 'Alpine',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        _count: { members: 2 },
      },
    ]);

    const firstPage = await service.listOrganizationDirectory({
      name: ' Al ',
      sortBy: OrganizationDirectorySortBy.Name,
      sortOrder: OrganizationDirectorySortOrder.Asc,
      limit: '1',
    });

    expect(firstPage.organizations[0]?.name).toBe('Alpha');
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(organizationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          name: { contains: 'Al', mode: 'insensitive' },
        },
      }),
    );

    const secondPage = await service.listOrganizationDirectory({
      name: ' Al ',
      sortBy: OrganizationDirectorySortBy.Name,
      sortOrder: OrganizationDirectorySortOrder.Asc,
      cursor: firstPage.nextCursor ?? undefined,
      limit: '1',
    });

    expect(secondPage.organizations).toEqual([
      expect.objectContaining({ id: 'org-b', name: 'Alpine' }),
    ]);

    await expect(
      service.listOrganizationDirectory({
        sortBy: OrganizationDirectorySortBy.MemberCount,
        sortOrder: OrganizationDirectorySortOrder.Desc,
        limit: '2',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        organizations: [
          expect.objectContaining({ id: 'org-a', memberCount: 8 }),
          expect.objectContaining({ id: 'org-b', memberCount: 2 }),
        ],
      }),
    );
  });

  it('batch-resolves active, revoked, and expired entitlement states at one timestamp', async () => {
    organizationFindMany.mockResolvedValue(
      ['active', 'revoked', 'expired'].map((status, index) => ({
        id: `org-${status}`,
        name: status,
        createdAt: new Date(`2026-09-0${index + 1}T00:00:00.000Z`),
        _count: { members: index },
      })),
    );
    entitlementFindMany.mockResolvedValue([
      {
        organizationId: 'org-active',
        subscriptionType: AccountSubscriptionType.BETA,
        accessStatus: AccountAccessStatus.ACTIVE,
      },
      {
        organizationId: 'org-revoked',
        subscriptionType: AccountSubscriptionType.PAID,
        accessStatus: AccountAccessStatus.REVOKED,
      },
      {
        organizationId: 'org-expired',
        subscriptionType: AccountSubscriptionType.BETA,
        accessStatus: AccountAccessStatus.EXPIRED,
      },
    ]);

    const page = await service.listOrganizationDirectory({ limit: '3' });

    expect(page.organizations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'org-active',
          subscriptionType: 'BETA',
          accessStatus: 'ACTIVE',
        }),
        expect.objectContaining({
          id: 'org-revoked',
          subscriptionType: 'PAID',
          accessStatus: 'REVOKED',
        }),
        expect.objectContaining({
          id: 'org-expired',
          subscriptionType: 'BETA',
          accessStatus: 'EXPIRED',
        }),
      ]),
    );
    const resolvedTimes = resolveEntitlement.mock.calls.map((call) => call[1]);
    expect(resolvedTimes).toHaveLength(3);
    expect(resolvedTimes.every((value) => value === resolvedTimes[0])).toBe(
      true,
    );
    expect(entitlementFindMany).toHaveBeenCalledTimes(1);
    expect(lifecycleFindMany).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ limit: '0' }, 'limit'],
    [{ limit: '101' }, 'limit'],
    [{ sortBy: 'role' }, 'sort field'],
    [{ sortOrder: 'sideways' }, 'sort direction'],
  ])('rejects an invalid directory %s', async (query, label) => {
    await expect(
      service.listOrganizationDirectory(query as never),
    ).rejects.toThrow(BadRequestException);
    expect(label).toBeTruthy();
    expect(organizationFindMany).not.toHaveBeenCalled();
  });

  it('rejects a cursor used with different query inputs', async () => {
    organizationFindMany.mockResolvedValue([
      {
        id: 'org-a',
        name: 'Alpha',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        _count: { members: 1 },
      },
      {
        id: 'org-b',
        name: 'Beta',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        _count: { members: 2 },
      },
    ]);

    const firstPage = await service.listOrganizationDirectory({ limit: '1' });

    await expect(
      service.listOrganizationDirectory({
        sortBy: OrganizationDirectorySortBy.Name,
        sortOrder: OrganizationDirectorySortOrder.Asc,
        cursor: firstPage.nextCursor ?? undefined,
        limit: '1',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
