import { BadRequestException } from '@nestjs/common';
import { PrivateBetaAccessService } from '../private-beta-access.service';
import type { PrivateBetaAccessRequestSubmissionDto } from '../../generated';
import * as deploymentEnvironment from '../../deployment-environment';

const submission = {
  name: ' Ada ',
  workEmail: ' Ada@Example.com ',
  organizationName: ' Engines ',
};
const requestId = '550e8400-e29b-41d4-a716-446655440026';

describe('Unified beta signup intake', () => {
  const requests = {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const notifications = {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  const users = { findFirst: jest.fn() };
  const tx = {
    privateBetaAccessRequest: requests,
    privateBetaAccessNotificationAttempt: notifications,
    user: users,
    $executeRaw: jest.fn(),
  };
  const prisma = { db: { $transaction: jest.fn() } };
  const program = {
    isSelfServiceAdmissionOpenInTransaction: jest.fn(),
  };
  const decisions = { completeSignupApproval: jest.fn() };
  const service = new PrivateBetaAccessService(
    prisma as never,
    program as never,
    decisions as never,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    jest
      .spyOn(deploymentEnvironment, 'getDeploymentEnvironment')
      .mockReturnValue('test');
    requests.findFirst.mockResolvedValue(null);
    users.findFirst.mockResolvedValue(null);
    notifications.findUnique.mockResolvedValue(null);
    requests.create.mockResolvedValue({ id: requestId });
    program.isSelfServiceAdmissionOpenInTransaction.mockResolvedValue(true);
    prisma.db.$transaction.mockImplementation((operation) => operation(tx));
  });

  it('authorizes OPEN at persistence and invokes shared onboarding only after commit', async () => {
    const order: string[] = [];
    prisma.db.$transaction.mockImplementation(async (operation) => {
      const result = await operation(tx);
      order.push('committed');
      return result;
    });
    decisions.completeSignupApproval.mockImplementation(async () => {
      order.push('onboarded');
    });
    await expect(
      service.submit(submission, { userAgent: 'browser' }),
    ).resolves.toEqual({ accepted: true });
    expect(requests.create).toHaveBeenCalledWith({
      data: {
        name: 'Ada',
        submittedEmail: 'Ada@Example.com',
        normalizedEmail: 'ada@example.com',
        organizationName: 'Engines',
        teamSize: null,
        productContext: null,
        accessRationale: null,
        status: 'APPROVAL_IN_PROGRESS',
        decisionAt: expect.any(Date),
        provisioningAttemptedAt: expect.any(Date),
      },
    });
    expect(order).toEqual(['committed', 'onboarded']);
    expect(decisions.completeSignupApproval).toHaveBeenCalledWith(requestId, {
      userAgent: 'browser',
    });
    expect(notifications.create).not.toHaveBeenCalled();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each(deploymentEnvironment.DEPLOYMENT_ENVIRONMENTS)(
    'retains PAUSED signup pending authenticated approval without onboarding in %s',
    async (environment) => {
      jest
        .mocked(deploymentEnvironment.getDeploymentEnvironment)
        .mockReturnValue(environment);
      program.isSelfServiceAdmissionOpenInTransaction.mockResolvedValue(false);
      await expect(service.submit(submission)).resolves.toEqual({
        accepted: true,
      });
      expect(requests.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'PENDING',
          decisionAt: null,
          provisioningAttemptedAt: null,
        }),
      });
      expect(decisions.completeSignupApproval).not.toHaveBeenCalled();
      expect(notifications.create).toHaveBeenCalledTimes(
        environment === 'production' ? 2 : 1,
      );
      expect(notifications.create).toHaveBeenNthCalledWith(1, {
        data: {
          requestId,
          recipientRole: 'REQUESTER',
          deliveryState: 'PENDING',
          nextRetryAt: expect.any(Date),
        },
      });
      if (environment === 'production') {
        expect(notifications.create).toHaveBeenNthCalledWith(2, {
          data: {
            requestId,
            recipientRole: 'OPERATOR',
            deliveryState: 'PENDING',
            nextRetryAt: expect.any(Date),
          },
        });
      }
    },
  );

  it.each([
    'PENDING',
    'REJECTED',
    'APPROVAL_IN_PROGRESS',
    'APPROVED',
    'PROVISIONING_FAILED',
  ])(
    'reuses a %s request without changing its admission decision or identity',
    async (status) => {
      requests.findFirst.mockResolvedValue({ id: requestId, status });
      await expect(service.submit(submission)).resolves.toEqual({
        accepted: true,
      });
      expect(requests.findFirst).toHaveBeenCalledWith({
        where: { normalizedEmail: 'ada@example.com' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          status: true,
          provisioningFailureCode: true,
          provisionedUserId: true,
          provisionedOrganizationId: true,
        },
      });
      expect(requests.create).not.toHaveBeenCalled();
      expect(decisions.completeSignupApproval).not.toHaveBeenCalled();
      expect(
        program.isSelfServiceAdmissionOpenInTransaction,
      ).not.toHaveBeenCalled();
      expect(notifications.create).not.toHaveBeenCalled();
    },
  );

  describe('existing account', () => {
    const now = Date.now();
    const existingAccountNotice = (overrides: Record<string, unknown>) => ({
      id: 'notice-1',
      deliveryState: 'SENT',
      nextRetryAt: null,
      deliveredAt: new Date(now - 5 * 60_000),
      lastAttemptAt: new Date(now - 5 * 60_000),
      createdAt: new Date(now - 5 * 60_000),
      ...overrides,
    });

    beforeEach(() => {
      users.findFirst.mockResolvedValue({ id: 'user-1' });
    });

    it('records EXISTING_ACCOUNT and queues a sign-in notice without authorizing or provisioning', async () => {
      await expect(service.submit(submission)).resolves.toEqual({
        accepted: true,
      });
      expect(users.findFirst).toHaveBeenCalledWith({
        where: {
          email: { equals: 'ada@example.com', mode: 'insensitive' },
        },
        select: { id: true },
      });
      expect(requests.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          normalizedEmail: 'ada@example.com',
          status: 'EXISTING_ACCOUNT',
        }),
      });
      expect(notifications.create).toHaveBeenCalledTimes(1);
      expect(notifications.create).toHaveBeenCalledWith({
        data: {
          requestId,
          recipientRole: 'EXISTING_ACCOUNT_HOLDER',
          deliveryState: 'PENDING',
          nextRetryAt: expect.any(Date),
        },
      });
      expect(
        program.isSelfServiceAdmissionOpenInTransaction,
      ).not.toHaveBeenCalled();
      expect(decisions.completeSignupApproval).not.toHaveBeenCalled();
    });

    it('also notifies the operator in production', async () => {
      jest
        .mocked(deploymentEnvironment.getDeploymentEnvironment)
        .mockReturnValue('production');
      await service.submit(submission);
      expect(notifications.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ recipientRole: 'OPERATOR' }),
      });
    });

    it('throttles a resubmission inside the cooldown window', async () => {
      requests.findFirst.mockResolvedValue({
        id: requestId,
        status: 'EXISTING_ACCOUNT',
      });
      notifications.findUnique.mockResolvedValue(existingAccountNotice({}));
      await service.submit(submission);
      expect(notifications.update).not.toHaveBeenCalled();
      expect(notifications.create).not.toHaveBeenCalled();
      expect(requests.create).not.toHaveBeenCalled();
    });

    it('re-arms the sign-in notice after the cooldown window', async () => {
      requests.findFirst.mockResolvedValue({
        id: requestId,
        status: 'EXISTING_ACCOUNT',
      });
      const longAgo = new Date(now - 2 * 60 * 60_000);
      notifications.findUnique.mockResolvedValue(
        existingAccountNotice({
          deliveredAt: longAgo,
          lastAttemptAt: longAgo,
          createdAt: longAgo,
        }),
      );
      await service.submit(submission);
      expect(notifications.update).toHaveBeenCalledWith({
        where: { id: 'notice-1' },
        data: expect.objectContaining({
          deliveryState: 'PENDING',
          attemptCount: 0,
          nextRetryAt: expect.any(Date),
        }),
      });
      expect(decisions.completeSignupApproval).not.toHaveBeenCalled();
    });

    it('leaves an in-flight notice alone', async () => {
      requests.findFirst.mockResolvedValue({
        id: requestId,
        status: 'EXISTING_ACCOUNT',
      });
      notifications.findUnique.mockResolvedValue(
        existingAccountNotice({
          deliveryState: 'FAILED',
          nextRetryAt: new Date(now + 60_000),
          createdAt: new Date(now - 2 * 60 * 60_000),
        }),
      );
      await service.submit(submission);
      expect(notifications.update).not.toHaveBeenCalled();
    });

    it('reclassifies a request stranded by USER_CONFLICT and sends the notice', async () => {
      requests.findFirst.mockResolvedValue({
        id: requestId,
        status: 'PROVISIONING_FAILED',
        provisioningFailureCode: 'USER_CONFLICT',
        provisionedUserId: null,
        provisionedOrganizationId: null,
      });
      await service.submit(submission);
      expect(requests.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: {
          status: 'EXISTING_ACCOUNT',
          provisioningFailureCode: null,
          provisioningError: null,
        },
      });
      expect(notifications.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          recipientRole: 'EXISTING_ACCOUNT_HOLDER',
        }),
      });
    });

    it.each(['APPROVAL_IN_PROGRESS', 'APPROVED', 'PENDING', 'REJECTED'])(
      'keeps silent replay for a %s request',
      async (status) => {
        requests.findFirst.mockResolvedValue({ id: requestId, status });
        await service.submit(submission);
        expect(requests.update).not.toHaveBeenCalled();
        expect(notifications.create).not.toHaveBeenCalled();
        expect(notifications.update).not.toHaveBeenCalled();
      },
    );
  });

  it('converges concurrent submissions on one durable identity and onboarding invocation', async () => {
    let persisted: { id: string } | null = null;
    let queue = Promise.resolve();
    requests.findFirst.mockImplementation(async () => persisted);
    requests.create.mockImplementation(
      async () => (persisted = { id: requestId }),
    );
    prisma.db.$transaction.mockImplementation((operation) => {
      const result = queue.then(() => operation(tx));
      queue = result.then(() => undefined);
      return result;
    });
    await Promise.all([service.submit(submission), service.submit(submission)]);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(requests.create).toHaveBeenCalledTimes(1);
    expect(decisions.completeSignupApproval).toHaveBeenCalledTimes(1);
  });

  it('preserves the accepted response after a provisioning failure', async () => {
    decisions.completeSignupApproval.mockRejectedValue(
      new Error('delivery failed'),
    );
    await expect(service.submit(submission)).resolves.toEqual({
      accepted: true,
    });
  });

  it('does not acknowledge a failed persistence transaction', async () => {
    program.isSelfServiceAdmissionOpenInTransaction.mockResolvedValue(false);
    notifications.create.mockRejectedValue(new Error('outbox write failed'));
    await expect(service.submit(submission)).rejects.toThrow(
      'outbox write failed',
    );
    expect(decisions.completeSignupApproval).not.toHaveBeenCalled();
  });

  it('preserves optional historical review context when provided', async () => {
    await service.submit({
      ...submission,
      teamSize: 4,
      productContext: ' Product ',
      accessRationale: ' Context ',
    });
    expect(requests.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        teamSize: 4,
        productContext: 'Product',
        accessRationale: 'Context',
      }),
    });
  });

  it.each([
    { name: ' ' },
    { workEmail: 'invalid' },
    { organizationName: '' },
    { teamSize: 0 },
    { teamSize: 1.5 },
    { productContext: '' },
    { unexpected: 'field' },
  ])(
    'rejects contract-invalid fields %j before persistence',
    async (overrides) => {
      await expect(
        service.submit({
          ...submission,
          ...overrides,
        } as PrivateBetaAccessRequestSubmissionDto),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.db.$transaction).not.toHaveBeenCalled();
    },
  );
});
