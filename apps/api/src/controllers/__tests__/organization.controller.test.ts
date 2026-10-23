import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import type {
  OrganizationAccountLifecycleDto,
  OrganizationDirectoryPageDto,
  OrganizationReactivationSuccess,
} from '../../generated';
import {
  OrganizationDirectorySortBy,
  OrganizationDirectorySortOrder,
} from '../../generated';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { OrganizationGuard } from '../../auth/guards/organization.guard';
import { OrganizationId, UserId } from '../../types';
import { OrganizationController } from '../organization.controller';

describe('OrganizationController', () => {
  const organizationId =
    '50e01076-bce8-4a65-b205-c5da8480e8fb' as OrganizationId;
  const userId = '3b8a5b0e-33d7-4aa1-8b6f-dc362aa62597' as UserId;
  const entitlement = {
    defaultProjectLimit: 2,
    projectLimitOverride: null,
    projectLimit: 2,
    usage: {
      projectCount: 1,
      workItemCount: 20,
      observedAt: '2026-08-11T20:00:00.000Z',
    },
    canCreateProject: true,
    creationUnavailableReason: null,
  };
  const entitlementService = {
    resolve: jest.fn().mockResolvedValue(entitlement),
    updateOverride: jest.fn().mockResolvedValue(entitlement),
  };
  const lifecycle = {
    lifecycleState: 'SUSPENDED',
    accessEndsAt: '2026-08-18T20:00:00.000Z',
    deletionEligibleAt: '2026-09-14T20:00:00.000Z',
    irreversibleClosureAt: null,
    deletedAt: null,
    accessAllowed: false,
    canReactivate: true,
  } satisfies OrganizationAccountLifecycleDto;
  const organizationService = {
    deactivateOrganization: jest.fn(),
    purgeOrganization: jest.fn(),
    listOrganizationDirectory: jest.fn(),
    getAdminOrganizationDetail: jest.fn(),
    listAdminOrganizationMembers: jest.fn(),
  };
  const directoryPage = {
    organizations: [
      {
        id: organizationId,
        name: 'Acme',
        createdAt: '2026-09-01T00:00:00.000Z',
        memberCount: 3,
        subscriptionType: 'BETA',
        accessStatus: 'ACTIVE',
      },
    ],
    totalCount: 1,
    nextCursor: null,
  } satisfies OrganizationDirectoryPageDto;
  const lifecycleOwner = {
    get: jest.fn().mockResolvedValue(lifecycle),
    cancel: jest.fn().mockResolvedValue(lifecycle),
    reactivate: jest.fn().mockResolvedValue({
      ...lifecycle,
      lifecycleState: 'ACTIVE',
      accessEndsAt: null,
      deletionEligibleAt: null,
      canReactivate: false,
      outcome: 'REACTIVATED',
    } satisfies OrganizationReactivationSuccess),
  };
  const accountEntitlementOwner = {
    makeBetaAccessOpenEnded: jest.fn().mockResolvedValue({
      organizationId,
      subscriptionType: 'BETA',
      accessStatus: 'ACTIVE',
      accessThroughAt: null,
      paidThroughAt: null,
      revision: 4,
      updatedAt: new Date('2026-09-10T06:00:00.000Z'),
    }),
  };
  const controller = new OrganizationController(
    organizationService as never,
    {} as never,
    entitlementService as never,
    lifecycleOwner as never,
    accountEntitlementOwner as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the backend-resolved entitlement', async () => {
    await expect(
      controller.getOrganizationProjectEntitlement(organizationId),
    ).resolves.toEqual(entitlement);
  });

  it('delegates the cross-organization directory query without using membership roles', async () => {
    organizationService.listOrganizationDirectory.mockResolvedValue(
      directoryPage,
    );

    await expect(
      controller.listOrganizationDirectory(
        ' Acme ',
        OrganizationDirectorySortBy.Name,
        OrganizationDirectorySortOrder.Asc,
        'cursor-1',
        '10',
      ),
    ).resolves.toEqual(directoryPage);

    expect(organizationService.listOrganizationDirectory).toHaveBeenCalledWith({
      name: ' Acme ',
      sortBy: OrganizationDirectorySortBy.Name,
      sortOrder: OrganizationDirectorySortOrder.Asc,
      cursor: 'cursor-1',
      limit: '10',
    });
  });

  it('passes the authenticated user to override authorization', async () => {
    await controller.updateOrganizationProjectEntitlement(
      organizationId,
      { projectLimitOverride: 4 },
      { userId } as never,
    );

    expect(entitlementService.updateOverride).toHaveBeenCalledWith(
      organizationId,
      userId,
      { projectLimitOverride: 4 },
    );
  });

  it('delegates cancellation with authoritative organization and actor identity', async () => {
    await expect(
      controller.cancelOrganizationAccount(organizationId, {
        userId,
      } as never),
    ).resolves.toEqual(lifecycle);

    expect(lifecycleOwner.cancel).toHaveBeenCalledTimes(1);
    expect(lifecycleOwner.cancel).toHaveBeenCalledWith(organizationId, userId);
    expect(organizationService.deactivateOrganization).not.toHaveBeenCalled();
    expect(organizationService.purgeOrganization).not.toHaveBeenCalled();
  });

  it('delegates the suspended-safe lifecycle read with authoritative identities', async () => {
    await expect(
      controller.getOrganizationAccountLifecycle(organizationId, {
        userId,
      } as never),
    ).resolves.toEqual(lifecycle);

    expect(lifecycleOwner.get).toHaveBeenCalledWith(organizationId, userId);
  });

  it('delegates reactivation with authoritative organization and actor identity', async () => {
    await expect(
      controller.reactivateOrganizationAccount(organizationId, {
        userId,
      } as never),
    ).resolves.toEqual({
      ...lifecycle,
      lifecycleState: 'ACTIVE',
      accessEndsAt: null,
      deletionEligibleAt: null,
      canReactivate: false,
      outcome: 'REACTIVATED',
    });

    expect(lifecycleOwner.reactivate).toHaveBeenCalledTimes(1);
    expect(lifecycleOwner.reactivate).toHaveBeenCalledWith(
      organizationId,
      userId,
    );
    expect(organizationService.deactivateOrganization).not.toHaveBeenCalled();
    expect(organizationService.purgeOrganization).not.toHaveBeenCalled();
  });

  it('passes generated permanent-beta input and authenticated operator identity to the canonical owner', async () => {
    await expect(
      controller.makeBetaAccessOpenEnded(
        organizationId,
        { expectedRevision: 3, reason: 'Extend approved beta access' },
        { userId } as never,
      ),
    ).resolves.toEqual({
      organizationId,
      subscriptionType: 'BETA',
      accessStatus: 'ACTIVE',
      accessThroughAt: null,
      paidThroughAt: null,
      revision: 4,
      updatedAt: '2026-09-10T06:00:00.000Z',
    });

    expect(
      accountEntitlementOwner.makeBetaAccessOpenEnded,
    ).toHaveBeenCalledWith(organizationId, 3, {
      actor: userId,
      reason: 'Extend approved beta access',
    });
  });

  it.each([
    ['cancelOrganizationAccount', ':organizationId/cancel'],
    ['getOrganizationAccountLifecycle', ':organizationId/account-lifecycle'],
    ['reactivateOrganizationAccount', ':organizationId/reactivate'],
  ] as const)(
    'uses generic organization authorization for %s',
    (method, path) => {
      const handler = Object.getOwnPropertyDescriptor(
        OrganizationController.prototype,
        method,
      )?.value as object;

      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
        method === 'getOrganizationAccountLifecycle'
          ? RequestMethod.GET
          : RequestMethod.POST,
      );
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
        OrganizationGuard,
      ]);
    },
  );

  it('protects the directory with the server admin guard and keeps its route separate', () => {
    const handler = Object.getOwnPropertyDescriptor(
      OrganizationController.prototype,
      'listOrganizationDirectory',
    )?.value as object;

    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('directory');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([AdminGuard]);
  });

  it.each([
    ['getAdminOrganizationDetail', 'directory/:organizationId'],
    ['listAdminOrganizationMembers', 'directory/:organizationId/members'],
    [
      'makeBetaAccessOpenEnded',
      'directory/:organizationId/entitlement/make-open-ended',
    ],
  ] as const)(
    'protects %s with the same server admin guard',
    (method, path) => {
      const handler = Object.getOwnPropertyDescriptor(
        OrganizationController.prototype,
        method,
      )?.value as object;
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
        AdminGuard,
      ]);
    },
  );
});
