import { BadRequestException } from '@nestjs/common';
import { AnalyticsService } from '../analytics/analytics.service';
import { createMockPrismaService } from '../../utils/testUtils';
import { NavigationAction, OrganizationRole } from '../../generated';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

describe('AnalyticsService', () => {
  const user: AuthenticatedUser = {
    userId: 'user-1' as any,
    email: 'test@example.com',
    name: 'Test User',
    currentOrgId: 'org-1' as any,
    orgMemberships: [{ orgId: 'org-1', role: OrganizationRole.Member }],
    isDevAdmin: false,
    devAdminMode: false,
  };

  const buildNavigationEvent = (
    overrides: Record<string, unknown> = {},
  ): any => ({
    eventId: 'evt_1700000000000_abc123',
    sessionId: 'sess_1700000000000_xyz789',
    userId: 'client-user' as any,
    timestamp: 1700000000100,
    url: 'https://app.test/home',
    userAgent: 'jest',
    viewport: { width: 1920, height: 1080 },
    context: {
      page: { name: 'home', path: '/' },
      ...(overrides.context as object),
    },
    category: 'navigation',
    action: NavigationAction.PageView,
    data: { toPage: '/destination' },
    ...overrides,
  });

  const baseBatch = {
    batchId: 'batch_1700000000000_abc123',
    timestamp: 1700000000000,
    deviceInfo: {
      userAgent: 'jest',
      platform: 'MacIntel',
      language: 'en-US',
      timezone: 'UTC',
    },
    events: [buildNavigationEvent()],
  };

  let prisma: ReturnType<typeof createMockPrismaService>;
  let service: AnalyticsService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    prisma.db.$transaction.mockImplementation(async (cb: any) => cb(prisma.db));
    prisma.db.analyticsEvent.createMany.mockResolvedValue({
      count: baseBatch.events.length,
    });
    service = new AnalyticsService(prisma as any);
  });

  it('throws when the batch has no events', async () => {
    await expect(
      service.recordEventBatch(user, { ...baseBatch, events: [] } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns existing batch without creating duplicates', async () => {
    prisma.db.analyticsEventBatch.findUnique.mockResolvedValue({
      batchId: baseBatch.batchId,
      eventsCount: 2,
    });

    const result = await service.recordEventBatch(user, baseBatch as any);

    expect(result).toEqual({
      batchId: baseBatch.batchId,
      eventsReceived: 2,
    });
    expect(prisma.db.analyticsEventBatch.create).not.toHaveBeenCalled();
    expect(prisma.db.analyticsEvent.createMany).not.toHaveBeenCalled();
  });

  it('stores a new batch and overrides user/org identifiers', async () => {
    prisma.db.analyticsEventBatch.findUnique.mockResolvedValueOnce(null);
    prisma.db.analyticsEventBatch.create.mockResolvedValue({
      id: 'db-batch-1',
      batchId: baseBatch.batchId,
      eventsCount: 1,
      userId: user.userId,
      organizationId: user.currentOrgId,
      timestamp: new Date(baseBatch.timestamp),
      deviceInfo: baseBatch.deviceInfo,
      createdAt: new Date(baseBatch.timestamp),
    });

    const event = buildNavigationEvent({
      context: {
        page: { name: 'home', path: '/' },
        organization: { id: 'other-org', name: 'Other' },
      },
      userId: 'malicious-user',
    });

    const result = await service.recordEventBatch(user, {
      ...baseBatch,
      events: [event],
    } as any);

    expect(prisma.db.analyticsEventBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          batchId: baseBatch.batchId,
          userId: user.userId,
          organizationId: user.currentOrgId,
          eventsCount: 1,
        }),
      }),
    );

    const createManyArgs = prisma.db.analyticsEvent.createMany.mock.calls[0][0];
    expect(createManyArgs.data[0]).toEqual(
      expect.objectContaining({
        batchId: baseBatch.batchId,
        userId: user.userId,
        organizationId: user.currentOrgId,
        eventId: event.eventId,
        action: NavigationAction.PageView,
      }),
    );

    const storedContext = createManyArgs.data[0].context;
    expect(storedContext.organization.id).toBe(user.currentOrgId);
    expect(result).toEqual({
      batchId: baseBatch.batchId,
      eventsReceived: 1,
    });
  });
});
