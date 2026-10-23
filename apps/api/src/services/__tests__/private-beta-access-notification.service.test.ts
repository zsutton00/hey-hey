import {
  PrivateBetaAccessNotificationDeliveryState,
  PrivateBetaAccessNotificationRecipientRole,
} from '@prisma/client';
import type { EmailService } from '../email.service';
import { PrivateBetaAccessNotificationService } from '../private-beta-access-notification.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PrivateBetaAccessRequestId } from '../../types';

const request = {
  id: '550e8400-e29b-41d4-a716-446655440026' as PrivateBetaAccessRequestId,
  submittedEmail: 'Ada@example.com',
  normalizedEmail: 'ada@example.com',
  name: 'Ada Lovelace',
  organizationName: 'Analytical Engines',
  teamSize: 5,
  productContext: 'A developer tool.',
  accessRationale: 'We want to evaluate it.',
  status: 'PENDING' as const,
  createdAt: new Date('2026-08-12T00:00:00.000Z'),
  decisionAt: null,
  provisionedUserId: null,
  provisionedOrganizationId: null,
  provisioningCompletedAt: null,
  provisioningError: null,
};

function makeJob(
  recipientRole: PrivateBetaAccessNotificationRecipientRole,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `${recipientRole.toLowerCase()}-job`,
    requestId: request.id,
    recipientRole,
    deliveryState: PrivateBetaAccessNotificationDeliveryState.PENDING,
    attemptCount: 0,
    maxAttempts: 3,
    claimedAt: null,
    claimExpiresAt: null,
    claimToken: null,
    lastAttemptAt: null,
    deliveredAt: null,
    lastError: null,
    nextRetryAt: new Date('2026-08-11T00:00:00.000Z'),
    createdAt: new Date('2026-08-12T00:00:00.000Z'),
    updatedAt: new Date('2026-08-12T00:00:00.000Z'),
    request,
    ...overrides,
  };
}

describe('PrivateBetaAccessNotificationService', () => {
  it('delivers requester and operator jobs independently and records a retryable partial failure', async () => {
    const jobs = [
      makeJob(PrivateBetaAccessNotificationRecipientRole.REQUESTER),
      makeJob(PrivateBetaAccessNotificationRecipientRole.OPERATOR),
    ];
    const requesterJob = jobs[0]!;
    const operatorJob = jobs[1]!;
    const findFirst = jest.fn(async () => {
      const due = jobs.find(
        (job) =>
          (job.deliveryState ===
            PrivateBetaAccessNotificationDeliveryState.PENDING ||
            job.deliveryState ===
              PrivateBetaAccessNotificationDeliveryState.FAILED) &&
          job.nextRetryAt !== null &&
          job.nextRetryAt.getTime() <= Date.now(),
      );
      return due ?? null;
    });
    const updateMany = jest.fn(
      async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, any>;
      }) => {
        const job = jobs.find((candidate) => candidate.id === where.id);
        if (!job) return { count: 0 };

        if (
          data.deliveryState ===
          PrivateBetaAccessNotificationDeliveryState.PROCESSING
        ) {
          if (job.deliveryState !== where.deliveryState) return { count: 0 };
          job.deliveryState = data.deliveryState;
          job.attemptCount += 1;
          job.claimToken = data.claimToken;
          job.claimedAt = data.claimedAt;
          job.claimExpiresAt = data.claimExpiresAt;
          job.lastAttemptAt = data.lastAttemptAt;
          return { count: 1 };
        }

        if (where.claimToken !== job.claimToken) return { count: 0 };
        Object.assign(job, data);
        return { count: 1 };
      },
    );
    const emailService = {
      sendPrivateBetaAccessRequesterEmail: jest
        .fn()
        .mockResolvedValue(undefined),
      sendPrivateBetaAccessOperatorEmail: jest
        .fn()
        .mockRejectedValueOnce(new Error('operator provider unavailable')),
    };
    const prisma = {
      db: {
        privateBetaAccessNotificationAttempt: { findFirst, updateMany },
      },
    };
    const service = new PrivateBetaAccessNotificationService(
      prisma as unknown as PrismaService,
      emailService as unknown as EmailService,
    );

    await expect(service.processDueNotifications()).resolves.toBe(2);

    expect(
      emailService.sendPrivateBetaAccessRequesterEmail,
    ).toHaveBeenCalledTimes(1);
    expect(
      emailService.sendPrivateBetaAccessOperatorEmail,
    ).toHaveBeenCalledTimes(1);
    expect(requesterJob.deliveryState).toBe(
      PrivateBetaAccessNotificationDeliveryState.SENT,
    );
    expect(requesterJob.attemptCount).toBe(1);
    expect(operatorJob.deliveryState).toBe(
      PrivateBetaAccessNotificationDeliveryState.FAILED,
    );
    expect(operatorJob.attemptCount).toBe(1);
    expect(operatorJob.lastError).toBe(
      'Private-beta notification delivery failed.',
    );
    expect(operatorJob.nextRetryAt).toBeInstanceOf(Date);

    operatorJob.nextRetryAt = new Date(Date.now() - 1);
    (
      emailService.sendPrivateBetaAccessOperatorEmail as jest.Mock
    ).mockResolvedValueOnce(undefined);

    await expect(service.processDueNotifications()).resolves.toBe(1);

    expect(
      emailService.sendPrivateBetaAccessOperatorEmail,
    ).toHaveBeenCalledTimes(2);
    expect(operatorJob.deliveryState).toBe(
      PrivateBetaAccessNotificationDeliveryState.SENT,
    );
    expect(operatorJob.attemptCount).toBe(2);
  });

  it('delivers the existing-account notice through its own email', async () => {
    const job = makeJob(
      PrivateBetaAccessNotificationRecipientRole.EXISTING_ACCOUNT_HOLDER,
    );
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(job)
      .mockResolvedValue(null);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const emailService = {
      sendPrivateBetaAccessRequesterEmail: jest.fn(),
      sendPrivateBetaAccessOperatorEmail: jest.fn(),
      sendPrivateBetaAccessExistingAccountEmail: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    const service = new PrivateBetaAccessNotificationService(
      {
        db: {
          privateBetaAccessNotificationAttempt: { findFirst, updateMany },
        },
      } as unknown as PrismaService,
      emailService as unknown as EmailService,
    );

    await expect(service.processDueNotifications()).resolves.toBe(1);

    expect(
      emailService.sendPrivateBetaAccessExistingAccountEmail,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        name: request.name,
        submittedEmail: request.submittedEmail,
      }),
    );
    expect(
      emailService.sendPrivateBetaAccessRequesterEmail,
    ).not.toHaveBeenCalled();
    expect(
      emailService.sendPrivateBetaAccessOperatorEmail,
    ).not.toHaveBeenCalled();
  });

  it('uses the claim token as the ownership boundary for delivery outcomes', async () => {
    const job = makeJob(PrivateBetaAccessNotificationRecipientRole.REQUESTER);
    const findFirst = jest.fn().mockResolvedValue(job);
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const emailService = {
      sendPrivateBetaAccessRequesterEmail: jest
        .fn()
        .mockResolvedValue(undefined),
      sendPrivateBetaAccessOperatorEmail: jest.fn(),
    };
    const service = new PrivateBetaAccessNotificationService(
      {
        db: {
          privateBetaAccessNotificationAttempt: { findFirst, updateMany },
        },
      } as unknown as PrismaService,
      emailService as unknown as EmailService,
    );

    const claim = await service.claimNext(new Date('2026-08-12T00:00:00.000Z'));

    expect(claim?.claimToken).toEqual(expect.any(String));
    expect(updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          claimToken: claim?.claimToken,
          attemptCount: { increment: 1 },
        }),
      }),
    );
  });
});
