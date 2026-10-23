import { OrganizationService } from './organization.service';

describe('OrganizationService admin detail', () => {
  const db = {
    organization: { findUnique: jest.fn() },
    task: { groupBy: jest.fn() },
    agentSession: { findMany: jest.fn(), count: jest.fn() },
    project: { findMany: jest.fn() },
    workItemType: { findMany: jest.fn() },
    workItemTypeTemplate: { findMany: jest.fn() },
    accountEntitlement: { findUnique: jest.fn() },
    organizationAccountLifecycle: { findUnique: jest.fn() },
    organizationMember: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
  };
  const accountEntitlementService = { resolve: jest.fn() };
  const service = new OrganizationService(
    { membershipRemoved: jest.fn() } as never,
    {
      projectWhere: jest
        .fn()
        .mockReturnValue({ members: { some: { userId: 'caller' } } }),
    } as never,
    { db } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    accountEntitlementService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    db.accountEntitlement.findUnique.mockResolvedValue({
      subscriptionType: 'BETA',
      accessStatus: 'ACTIVE',
      accessThroughAt: new Date('2026-12-01T00:00:00.000Z'),
      paidThroughAt: null,
      revision: 3,
    });
    db.organizationAccountLifecycle.findUnique.mockResolvedValue(null);
    accountEntitlementService.resolve.mockReturnValue({
      authorized: true,
      status: 'ACTIVE',
      subscriptionType: 'BETA',
      accessHorizon: new Date('2026-12-01T00:00:00.000Z'),
      revision: 3,
    });
  });

  it('returns all-time counts, resolved dynamic labels, and recent sessions in database order', async () => {
    db.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      name: 'Acme',
      createdAt: new Date('2026-01-01'),
      _count: { members: 2, projects: 1 },
    });
    db.task.groupBy.mockResolvedValue([
      { type: 'research_finding', _count: { _all: 3 } },
    ]);
    db.agentSession.findMany.mockResolvedValue([
      {
        id: 'session-1',
        title: 'Latest',
        type: 'CODING',
        status: 'COMPLETED',
        projectId: 'project-1',
        updatedAt: new Date('2026-09-01'),
      },
    ]);
    db.agentSession.count.mockResolvedValue(7);
    db.project.findMany.mockResolvedValue([{ id: 'project-1' }]);
    db.workItemType.findMany.mockResolvedValue([
      { typeKey: 'research_finding', name: 'Research Findings' },
    ]);
    db.workItemTypeTemplate.findMany.mockResolvedValue([]);

    await expect(
      service.getAdminOrganizationDetail('org-1' as never),
    ).resolves.toMatchObject({
      evidence: {
        workItemsCreatedAllTime: 3,
        agentSessionsCreatedAllTime: 7,
        workItemsByType: [
          {
            typeKey: 'research_finding',
            displayName: 'Research Findings',
            count: 3,
          },
        ],
      },
      entitlement: {
        subscriptionType: 'BETA',
        accessStatus: 'ACTIVE',
        accessThroughAt: '2026-12-01T00:00:00.000Z',
        paidThroughAt: null,
        effectiveAccessThroughAt: '2026-12-01T00:00:00.000Z',
        revision: 3,
      },
      latestAgentSessions: [{ name: 'Latest' }],
    });
    expect(db.agentSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      }),
    );
  });

  it('projects open-ended beta access without fabricating a horizon', async () => {
    db.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      name: 'Acme',
      createdAt: new Date('2026-01-01'),
      _count: { members: 0, projects: 0 },
    });
    db.task.groupBy.mockResolvedValue([]);
    db.agentSession.findMany.mockResolvedValue([]);
    db.agentSession.count.mockResolvedValue(0);
    db.project.findMany.mockResolvedValue([]);
    db.workItemType.findMany.mockResolvedValue([]);
    db.workItemTypeTemplate.findMany.mockResolvedValue([]);
    db.accountEntitlement.findUnique.mockResolvedValue({
      subscriptionType: 'BETA',
      accessStatus: 'ACTIVE',
      accessThroughAt: null,
      paidThroughAt: null,
      revision: 4,
    });
    accountEntitlementService.resolve.mockReturnValue({
      authorized: true,
      status: 'ACTIVE',
      subscriptionType: 'BETA',
      accessHorizon: null,
      revision: 4,
    });

    await expect(
      service.getAdminOrganizationDetail('org-1' as never),
    ).resolves.toMatchObject({
      entitlement: {
        accessThroughAt: null,
        paidThroughAt: null,
        effectiveAccessThroughAt: null,
      },
    });
  });

  it('keeps paid-through evidence while projecting an irreversible closure as revoked', async () => {
    db.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      name: 'Acme',
      createdAt: new Date('2026-01-01'),
      _count: { members: 0, projects: 0 },
    });
    db.task.groupBy.mockResolvedValue([]);
    db.agentSession.findMany.mockResolvedValue([]);
    db.agentSession.count.mockResolvedValue(0);
    db.project.findMany.mockResolvedValue([]);
    db.workItemType.findMany.mockResolvedValue([]);
    db.workItemTypeTemplate.findMany.mockResolvedValue([]);
    db.accountEntitlement.findUnique.mockResolvedValue({
      subscriptionType: 'PAID',
      accessStatus: 'ACTIVE',
      accessThroughAt: null,
      paidThroughAt: new Date('2027-01-01T00:00:00.000Z'),
      revision: 8,
    });
    const accessEndsAt = new Date('2026-09-01T00:00:00.000Z');
    db.organizationAccountLifecycle.findUnique.mockResolvedValue({
      accessEndsAt,
    });
    accountEntitlementService.resolve.mockReturnValue({
      authorized: false,
      status: 'REVOKED',
      subscriptionType: 'PAID',
      accessHorizon: accessEndsAt,
      revision: 8,
    });

    await expect(
      service.getAdminOrganizationDetail('org-1' as never),
    ).resolves.toMatchObject({
      entitlement: {
        subscriptionType: 'PAID',
        accessStatus: 'REVOKED',
        paidThroughAt: '2027-01-01T00:00:00.000Z',
        effectiveAccessThroughAt: '2026-09-01T00:00:00.000Z',
      },
    });
    expect(accountEntitlementService.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionType: 'PAID' }),
      expect.any(Date),
      { accessEndsAt },
    );
  });

  it('uses resolved lifecycle closure state and rejects missing canonical entitlements', async () => {
    db.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      name: 'Acme',
      createdAt: new Date('2026-01-01'),
      _count: { members: 0, projects: 0 },
    });
    db.task.groupBy.mockResolvedValue([]);
    db.agentSession.findMany.mockResolvedValue([]);
    db.accountEntitlement.findUnique.mockResolvedValue(null);
    await expect(
      service.getAdminOrganizationDetail('org-1' as never),
    ).rejects.toThrow('Organization entitlement not found');
  });

  it('returns searchable cursor-paged active members with organization roles', async () => {
    db.organization.findUnique.mockResolvedValue({ id: 'org-1' });
    db.organizationMember.findMany.mockResolvedValue([
      {
        id: 'membership-1',
        userId: 'user-1',
        role: 'OWNER',
        user: {
          name: 'Ada',
          email: 'ada@example.com',
          lastLoginAt: null,
          _count: { projectMemberships: 2 },
        },
      },
      {
        id: 'membership-2',
        userId: 'user-2',
        role: 'ADMIN',
        user: {
          name: 'Grace',
          email: 'grace@example.com',
          lastLoginAt: new Date('2026-09-01'),
          _count: { projectMemberships: 1 },
        },
      },
    ]);
    db.organizationMember.count.mockResolvedValue(2);
    const page = await service.listAdminOrganizationMembers(
      'org-1' as never,
      'caller' as never,
      {
        name: ' a ',
        limit: '1',
      },
    );
    expect(page.members).toEqual([
      expect.objectContaining({
        name: 'Ada',
        organizationRole: 'OWNER',
        projectCount: 2,
      }),
    ]);
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(db.organizationMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
        where: expect.objectContaining({
          organizationId: 'org-1',
          isActive: true,
        }),
      }),
    );
    expect(page.totalCount).toBe(2);
  });
});
