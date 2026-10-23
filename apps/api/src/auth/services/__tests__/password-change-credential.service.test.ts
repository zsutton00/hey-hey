import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

import { PrismaService } from '../../../prisma/prisma.service';
import {
  BrowserSessionFamilyId,
  BrowserSessionId,
  OrganizationId,
  PrivateBetaAccessRequestId,
  UserId,
} from '../../../types';
import { UserService } from '../../../services/user.service';
import { BrowserSessionService } from '../browser-session.service';
import { PasswordChangeCredentialService } from '../password-change-credential.service';
import { PasswordChangeCredentialKind } from '../../password-change-credential.types';

describe('PasswordChangeCredentialService', () => {
  const userId = 'user-1' as UserId;
  const now = new Date('2026-07-31T12:00:00.000Z');

  afterEach(() => {
    jest.useRealTimers();
  });

  const createHarness = (options?: { privateBetaAccessClosed?: boolean }) => {
    const credentialCreate = jest.fn().mockResolvedValue({ id: 'row-1' });
    const credentialUpsert = jest.fn(
      async ({ create }: { create: Record<string, unknown> }) => ({
        id: create.id,
        credentialId: create.credentialId,
        userId: create.userId,
        expiresAt: create.expiresAt,
        consumedAt: null as Date | null,
        revokedAt: null as Date | null,
      }),
    );
    const credentialUpdate = jest.fn().mockResolvedValue({ id: 'row-1' });
    const credentialUpdateMany = jest.fn().mockResolvedValue({ count: 2 });
    let credentialRows: unknown[] = [];
    let databaseTimestamp: Date | null = null;
    const queryRaw = jest.fn(
      async (query: TemplateStringsArray): Promise<unknown[]> => {
        const sql = query.join('');
        if (sql.includes('private_beta_access_program_state')) {
          return [{ closedAt: options?.privateBetaAccessClosed ? now : null }];
        }
        if (sql.includes('clock_timestamp')) {
          return [{ decisionAt: databaseTimestamp ?? new Date() }];
        }
        return credentialRows;
      },
    );
    const transactionClient = {
      $queryRaw: queryRaw,
      passwordChangeCredential: {
        create: credentialCreate,
        update: credentialUpdate,
        updateMany: credentialUpdateMany,
        upsert: credentialUpsert,
      },
    };
    const transaction = jest.fn(
      async (callback: (tx: typeof transactionClient) => unknown) =>
        callback(transactionClient),
    );
    const prisma = {
      db: {
        passwordChangeCredential: { create: credentialCreate },
        $transaction: transaction,
      },
    } as unknown as PrismaService;
    const replaceRequiredPasswordInTransaction = jest.fn();
    const userService = {
      replaceRequiredPasswordInTransaction,
    } as unknown as UserService;
    const revokeAllForUserInTransaction = jest.fn();
    const establishInTransaction = jest.fn();
    const invalidateRevokedSessions = jest.fn();
    const browserSessionService = {
      revokeAllForUserInTransaction,
      establishInTransaction,
      invalidateRevokedSessions,
    } as unknown as BrowserSessionService;
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'PASSWORD_CHANGE_TOKEN_TTL_SECONDS') {
          return '900';
        }
        if (key === 'PASSWORD_CHANGE_IDEMPOTENCY_SECRET') {
          return 'test-idempotency-secret';
        }
        return undefined;
      }),
    } as unknown as ConfigService;

    return {
      service: new PasswordChangeCredentialService(
        configService,
        prisma,
        userService,
        browserSessionService,
      ),
      credentialCreate,
      credentialUpsert,
      credentialUpdate,
      credentialUpdateMany,
      queryRaw,
      transactionClient,
      transaction,
      replaceRequiredPasswordInTransaction,
      revokeAllForUserInTransaction,
      establishInTransaction,
      invalidateRevokedSessions,
      setCredentialRows: (rows: unknown[]) => {
        credentialRows = rows;
      },
      setDatabaseTimestamp: (value: Date) => {
        databaseTimestamp = value;
      },
    };
  };

  it('persists a purpose-specific credential for at most fifteen minutes without creating a browser session', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const harness = createHarness();

    const token = await harness.service.issue(
      userId,
      PasswordChangeCredentialKind.RequiredChange,
      {
        ipAddress: ` ${'1'.repeat(60)} `,
        userAgent: ` ${'a'.repeat(600)} `,
      },
    );

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const persisted = harness.credentialCreate.mock.calls[0][0].data;
    expect(persisted.credentialId).toBe(
      createHash('sha256').update(token).digest('hex'),
    );
    expect(persisted.credentialId).not.toBe(token);
    expect(persisted.expiresAt.getTime() - persisted.issuedAt.getTime()).toBe(
      15 * 60 * 1000,
    );
    expect(persisted.issuedIpAddress).toBe('1'.repeat(45));
    expect(persisted.issuedUserAgent).toBe('a'.repeat(512));
    expect(harness.establishInTransaction).not.toHaveBeenCalled();
    expect(harness.transaction).toHaveBeenCalledTimes(1);
  });

  it('persists an invitation credential in the caller transaction without opening a nested transaction', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const harness = createHarness();

    await expect(
      harness.service.issueInTransaction(
        harness.transactionClient as never,
        userId,
        PasswordChangeCredentialKind.RequiredChange,
        { ipAddress: '203.0.113.10', userAgent: 'invite-test' },
      ),
    ).resolves.toMatch(/^[A-Za-z0-9_-]{43}$/);

    expect(harness.credentialCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId,
        issuedIpAddress: '203.0.113.10',
        issuedUserAgent: 'invite-test',
      }),
    });
    expect(harness.transaction).not.toHaveBeenCalled();
  });

  it('issues and replays one deterministic request-keyed credential without persisting the raw token', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const harness = createHarness();
    const requestId =
      '550e8400-e29b-41d4-a716-446655440026' as PrivateBetaAccessRequestId;

    const firstToken = await harness.service.issueIdempotentlyInTransaction(
      harness.transactionClient as never,
      userId,
      requestId,
      { ipAddress: '203.0.113.10', userAgent: 'invite-test' },
    );

    const persisted = harness.credentialUpsert.mock.calls[0]![0].create;
    expect(persisted.privateBetaAccessRequestId).toBe(requestId);
    expect(persisted.expiresAt).toBeNull();
    expect(persisted.credentialId).not.toBe(firstToken);
    expect(JSON.stringify(persisted)).not.toContain(firstToken);

    jest.setSystemTime(new Date(now.getTime() + 16 * 60 * 1000));
    const replayedToken = await harness.service.issueIdempotentlyInTransaction(
      harness.transactionClient as never,
      userId,
      requestId,
      {},
    );

    expect(replayedToken).toBe(firstToken);
    expect(harness.credentialUpsert).toHaveBeenCalledTimes(2);
  });

  it('blocks private-beta credential issuance when beta access is closed', async () => {
    const harness = createHarness({ privateBetaAccessClosed: true });
    const requestId =
      '550e8400-e29b-41d4-a716-446655440026' as PrivateBetaAccessRequestId;

    await expect(
      harness.service.issueIdempotentlyInTransaction(
        harness.transactionClient as never,
        userId,
        requestId,
        {},
      ),
    ).rejects.toThrow('Private-beta access is closed');
    expect(harness.credentialUpsert).not.toHaveBeenCalled();
  });

  it('does not reuse a revoked request-keyed credential', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const harness = createHarness();
    const requestId =
      '550e8400-e29b-41d4-a716-446655440027' as PrivateBetaAccessRequestId;
    await harness.service.issueIdempotentlyInTransaction(
      harness.transactionClient as never,
      userId,
      requestId,
      {},
    );
    const persisted = harness.credentialUpsert.mock.calls[0]![0].create;
    harness.credentialUpsert.mockResolvedValueOnce({
      id: persisted.id,
      credentialId: persisted.credentialId,
      userId,
      expiresAt: null,
      consumedAt: null,
      revokedAt: now,
    });

    await expect(
      harness.service.issueIdempotentlyInTransaction(
        harness.transactionClient as never,
        userId,
        requestId,
        {},
      ),
    ).rejects.toThrow('no longer available');
  });

  it('consumes an approved beta credential after the ordinary fifteen-minute window', async () => {
    jest
      .useFakeTimers()
      .setSystemTime(new Date(now.getTime() + 16 * 60 * 1000));
    const harness = createHarness();
    harness.setCredentialRows([
      {
        id: 'credential-row-1',
        credentialId: 'credential-1',
        userId,
        privateBetaAccessRequestId: 'request-1',
        privateBetaAccessRequestStatus: 'APPROVED',
        expiresAt: null,
        consumedAt: null,
        revokedAt: null,
      },
    ]);

    await expect(
      harness.service.consumeInTransaction(harness.transactionClient as never, {
        credentialId: 'credential-1' as never,
        requestMetadata: {},
      }),
    ).resolves.toMatchObject({
      status: 'consumed',
      userId,
    });
    expect(harness.credentialUpdate).toHaveBeenCalledWith({
      where: { id: 'credential-row-1' },
      data: {
        consumedAt: expect.any(Date),
        consumedIpAddress: undefined,
        consumedUserAgent: undefined,
      },
    });
  });

  it('revokes instead of consuming a beta credential after beta access closes', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const harness = createHarness({ privateBetaAccessClosed: true });
    harness.setCredentialRows([
      {
        id: 'credential-row-1',
        credentialId: 'credential-1',
        userId,
        privateBetaAccessRequestId: 'request-1',
        privateBetaAccessRequestStatus: 'APPROVED',
        expiresAt: null,
        consumedAt: null,
        revokedAt: null,
      },
    ]);

    await expect(
      harness.service.consumeInTransaction(harness.transactionClient as never, {
        credentialId: 'credential-1' as never,
        requestMetadata: {},
      }),
    ).resolves.toEqual({ status: 'revoked' });
    expect(harness.credentialUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'credential-row-1',
        consumedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: now },
    });
    expect(harness.credentialUpdate).not.toHaveBeenCalled();
  });

  it('keeps a beta credential valid while provisioning is retryable', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const harness = createHarness();
    harness.setCredentialRows([
      {
        id: 'credential-row-1',
        credentialId: 'credential-1',
        userId,
        privateBetaAccessRequestId: 'request-1',
        privateBetaAccessRequestStatus: 'PROVISIONING_FAILED',
        expiresAt: null,
        consumedAt: null,
        revokedAt: null,
      },
    ]);

    await expect(
      harness.service.consumeInTransaction(harness.transactionClient as never, {
        credentialId: 'credential-1' as never,
        requestMetadata: {},
      }),
    ).resolves.toMatchObject({ status: 'consumed', userId });
  });

  it('rejects an empty credential before opening a transaction', async () => {
    const harness = createHarness();

    await expect(
      harness.service.complete('', 'new-password', {}),
    ).rejects.toThrow(UnauthorizedException);
    expect(harness.transaction).not.toHaveBeenCalled();
  });

  it('rejects an unknown opaque credential without mutating password or sessions', async () => {
    const harness = createHarness();

    await expect(
      harness.service.complete('access-token', 'new-password', {}),
    ).rejects.toThrow(UnauthorizedException);
    expect(harness.transaction).toHaveBeenCalledTimes(1);
    expect(harness.credentialUpdate).not.toHaveBeenCalled();
    expect(harness.replaceRequiredPasswordInTransaction).not.toHaveBeenCalled();
    expect(harness.establishInTransaction).not.toHaveBeenCalled();
  });

  it('atomically consumes one credential, revokes prior families, and establishes one fresh session', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const harness = createHarness();
    harness.setCredentialRows([
      {
        id: 'credential-row-1',
        credentialId: 'credential-1',
        userId,
        privateBetaAccessRequestId: null,
        privateBetaAccessRequestStatus: null,
        expiresAt: new Date(now.getTime() + 60_000),
        consumedAt: null,
        revokedAt: null,
      },
    ]);
    harness.revokeAllForUserInTransaction.mockResolvedValue({
      revokedFamilyIds: ['old-family'] as BrowserSessionFamilyId[],
      revokedSessionIds: ['old-session'] as BrowserSessionId[],
    });
    harness.replaceRequiredPasswordInTransaction.mockResolvedValue({
      id: userId,
      email: 'user@example.com',
      name: 'User',
      isActive: true,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
      isDevAdmin: false,
      devAdminMode: false,
      memberships: [
        {
          organizationId: 'org-1' as OrganizationId,
          role: 'MEMBER',
        },
      ],
    });
    const freshSession = {
      response: {
        user: {
          id: userId,
          email: 'user@example.com',
          name: 'User',
          isActive: true,
          lastLoginAt: null,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          currentOrganizationId: 'org-1' as OrganizationId,
        },
        accessToken: 'fresh-access',
        expiresIn: 900,
      },
      refreshSecret: 'fresh-refresh',
      sessionId: 'fresh-session' as BrowserSessionId,
      familyId: 'fresh-family' as BrowserSessionFamilyId,
      inactivityExpiresAt: new Date(now.getTime() + 60_000),
      absoluteExpiresAt: new Date(now.getTime() + 120_000),
    };
    harness.establishInTransaction.mockResolvedValue(freshSession);

    const result = await harness.service.complete(
      'opaque-password-change-token',
      'new-password',
      {
        ipAddress: '203.0.113.10',
        userAgent: 'browser/1.0',
      },
    );

    expect(result).toBe(freshSession);
    expect(harness.credentialUpdate).toHaveBeenCalledWith({
      where: { id: 'credential-row-1' },
      data: {
        consumedAt: now,
        consumedIpAddress: '203.0.113.10',
        consumedUserAgent: 'browser/1.0',
      },
    });
    expect(harness.revokeAllForUserInTransaction).toHaveBeenCalledWith(
      harness.transactionClient,
      userId,
      now,
      'password_replaced',
    );
    expect(harness.replaceRequiredPasswordInTransaction).toHaveBeenCalledWith(
      harness.transactionClient,
      userId,
      'new-password',
    );
    expect(harness.establishInTransaction).toHaveBeenCalledTimes(1);
    expect(harness.invalidateRevokedSessions).toHaveBeenCalledWith([
      'old-session',
    ]);
    expect(harness.invalidateRevokedSessions).not.toHaveBeenCalledWith([
      'fresh-session',
    ]);
    expect(JSON.stringify(result.response)).not.toContain('fresh-refresh');
  });

  it.each([
    [
      'replayed credential',
      {
        id: 'credential-row-1',
        credentialId: 'credential-1',
        userId,
        privateBetaAccessRequestId: null,
        privateBetaAccessRequestStatus: null,
        expiresAt: new Date(now.getTime() + 60_000),
        consumedAt: now,
        revokedAt: null,
      },
    ],
    [
      'expired credential',
      {
        id: 'credential-row-1',
        credentialId: 'credential-1',
        userId,
        privateBetaAccessRequestId: null,
        privateBetaAccessRequestStatus: null,
        expiresAt: now,
        consumedAt: null,
        revokedAt: null,
      },
    ],
    [
      'revoked credential',
      {
        id: 'credential-row-1',
        credentialId: 'credential-1',
        userId,
        privateBetaAccessRequestId: null,
        privateBetaAccessRequestStatus: null,
        expiresAt: new Date(now.getTime() + 60_000),
        consumedAt: null,
        revokedAt: now,
      },
    ],
    [
      'closed beta credential',
      {
        id: 'credential-row-1',
        credentialId: 'credential-1',
        userId,
        privateBetaAccessRequestId: 'request-1',
        privateBetaAccessRequestStatus: 'REJECTED',
        expiresAt: null,
        consumedAt: null,
        revokedAt: null,
      },
    ],
  ])(
    'rejects a %s without mutating password or sessions',
    async (_case, row) => {
      jest.useFakeTimers().setSystemTime(now);
      const harness = createHarness();
      harness.setCredentialRows([row]);

      await expect(
        harness.service.complete(
          'opaque-password-change-token',
          'new-password',
          {},
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(harness.credentialUpdate).not.toHaveBeenCalled();
      expect(harness.revokeAllForUserInTransaction).not.toHaveBeenCalled();
      expect(
        harness.replaceRequiredPasswordInTransaction,
      ).not.toHaveBeenCalled();
      expect(harness.establishInTransaction).not.toHaveBeenCalled();
      expect(harness.invalidateRevokedSessions).not.toHaveBeenCalled();
    },
  );

  it('uses the post-lock database timestamp when expiry passes while waiting', async () => {
    const expiresAt = new Date(now.getTime() + 1_000);
    const decisionAt = new Date(now.getTime() + 2_000);
    jest.useFakeTimers().setSystemTime(now);
    const harness = createHarness();
    harness.setCredentialRows([
      {
        id: 'credential-row-1',
        credentialId: 'credential-1',
        userId,
        privateBetaAccessRequestId: null,
        privateBetaAccessRequestStatus: null,
        expiresAt,
        consumedAt: null,
        revokedAt: null,
      },
    ]);
    harness.setDatabaseTimestamp(decisionAt);

    await expect(
      harness.service.complete(
        'opaque-password-change-token',
        'new-password',
        {},
      ),
    ).rejects.toThrow(UnauthorizedException);

    expect(harness.credentialUpdate).not.toHaveBeenCalled();
    expect(harness.revokeAllForUserInTransaction).not.toHaveBeenCalled();
    expect(harness.replaceRequiredPasswordInTransaction).not.toHaveBeenCalled();
    expect(harness.establishInTransaction).not.toHaveBeenCalled();
  });

  it('does not invalidate prior sessions when replacement fails before commit', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const harness = createHarness();
    harness.setCredentialRows([
      {
        id: 'credential-row-1',
        credentialId: 'credential-1',
        userId,
        privateBetaAccessRequestId: null,
        privateBetaAccessRequestStatus: null,
        expiresAt: new Date(now.getTime() + 60_000),
        consumedAt: null,
        revokedAt: null,
      },
    ]);
    harness.revokeAllForUserInTransaction.mockResolvedValue({
      revokedFamilyIds: ['old-family'],
      revokedSessionIds: ['old-session'],
    });
    harness.replaceRequiredPasswordInTransaction.mockRejectedValue(
      new UnauthorizedException(),
    );

    await expect(
      harness.service.complete(
        'opaque-password-change-token',
        'new-password',
        {},
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(harness.establishInTransaction).not.toHaveBeenCalled();
    expect(harness.invalidateRevokedSessions).not.toHaveBeenCalled();
  });
});
