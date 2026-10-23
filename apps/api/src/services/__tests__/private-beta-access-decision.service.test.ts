import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PrivateBetaAccessRequestDecisionInputDto } from '../../generated';
import type { PrismaService } from '../../prisma/prisma.service';
import type { BrowserSessionRequestMetadata } from '../../auth/browser-session.types';
import type { PrivateBetaAccessRequestId, UserId } from '../../types';
import { BetaOnboardingService } from '../beta-onboarding.service';
import { AccountEntitlementService } from '../account-entitlement.service';
import { PrivateBetaAccessDecisionService } from '../private-beta-access-decision.service';
import { PrivateBetaAccessProgramService } from '../private-beta-access-program.service';

const requestId =
  '550e8400-e29b-41d4-a716-446655440026' as PrivateBetaAccessRequestId;
const operatorId = '550e8400-e29b-41d4-a716-446655440027' as UserId;
const decisionAt = new Date('2026-08-12T01:00:00.000Z');
const completedAt = new Date('2026-08-12T01:03:00.000Z');
const attemptedAt = new Date('2026-08-12T01:02:00.000Z');
const requestMetadata: BrowserSessionRequestMetadata = {
  ipAddress: '203.0.113.10',
  userAgent: 'private-beta-decision-test',
};

type RequestState = {
  id: string;
  status:
    | 'PENDING'
    | 'APPROVAL_IN_PROGRESS'
    | 'APPROVED'
    | 'REJECTED'
    | 'PROVISIONING_FAILED';
  decisionAt: Date | null;
  provisionedUserId: string | null;
  provisionedOrganizationId: string | null;
  provisioningAttemptedAt: Date | null;
  provisioningCompletedAt: Date | null;
  provisioningFailureCode: string | null;
  provisioningError: string | null;
};

function makeRequest(overrides: Partial<RequestState> = {}): RequestState {
  return {
    id: requestId,
    status: 'PENDING',
    decisionAt: null,
    provisionedUserId: null,
    provisionedOrganizationId: null,
    provisioningAttemptedAt: null,
    provisioningCompletedAt: null,
    provisioningFailureCode: null,
    provisioningError: null,
    ...overrides,
  };
}

function makeHarness(initial: RequestState = makeRequest()) {
  let state = initial;
  const events: string[] = [];
  const transactionQueryRaw = jest.fn().mockResolvedValue([{ id: requestId }]);
  const transactionFindUnique = jest
    .fn()
    .mockImplementation(async () => ({ ...state }));
  const transactionUpdate = jest
    .fn()
    .mockImplementation(async ({ data }: { data: Partial<RequestState> }) => {
      state = { ...state, ...data };
      return { ...state };
    });
  const rootFindUnique = jest
    .fn()
    .mockImplementation(async () => ({ ...state }));
  const rootUpdate = jest
    .fn()
    .mockImplementation(async ({ data }: { data: Partial<RequestState> }) => {
      state = { ...state, ...data };
      return { ...state };
    });
  const tx = {
    $queryRaw: transactionQueryRaw,
    privateBetaAccessRequest: {
      findUnique: transactionFindUnique,
      update: transactionUpdate,
    },
  };
  const prisma = {
    db: {
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => unknown) => {
          const result = await callback(tx);
          events.push('transaction-complete');
          return result;
        },
      ),
      privateBetaAccessRequest: {
        findUnique: rootFindUnique,
        update: rootUpdate,
      },
    },
  } as unknown as PrismaService;
  const onboardApprovedRequest = jest.fn().mockImplementation(async () => {
    events.push('onboarding-start');
    return {
      userId: '550e8400-e29b-41d4-a716-446655440028',
      organizationId: '550e8400-e29b-41d4-a716-446655440029',
      email: 'ada@example.com',
    };
  });
  const onboarding = {
    onboardApprovedRequest,
  } as unknown as BetaOnboardingService;
  const assertOpenInTransaction = jest.fn().mockResolvedValue(undefined);
  const program = {
    assertOpenInTransaction,
  } as unknown as PrivateBetaAccessProgramService;
  const assertBetaAdmissionEntitlement = jest.fn().mockResolvedValue({});
  const accountEntitlementService = {
    assertBetaAdmissionEntitlement,
  } as unknown as AccountEntitlementService;
  const service = new PrivateBetaAccessDecisionService(
    prisma,
    onboarding,
    program,
    accountEntitlementService,
  );

  return {
    service,
    onboardApprovedRequest,
    rootFindUnique,
    rootUpdate,
    transactionUpdate,
    assertOpenInTransaction,
    assertBetaAdmissionEntitlement,
    events,
    getState: () => state,
  };
}

const decide = (
  service: PrivateBetaAccessDecisionService,
  decision: PrivateBetaAccessRequestDecisionInputDto['decision'],
) => service.decide(requestId, { decision }, operatorId, requestMetadata);

describe('PrivateBetaAccessDecisionService', () => {
  it('completes automatic authorization through the same onboarding operation and preserves the authorization timestamp', async () => {
    const harness = makeHarness(
      makeRequest({
        status: 'APPROVAL_IN_PROGRESS',
        decisionAt,
        provisioningAttemptedAt: attemptedAt,
      }),
    );
    await expect(
      harness.service.completeSignupApproval(requestId, requestMetadata),
    ).resolves.toMatchObject({
      status: 'APPROVED',
      decidedAt: decisionAt.toISOString(),
      provisioningOutcome: { status: 'SUCCEEDED' },
    });
    expect(harness.onboardApprovedRequest).toHaveBeenCalledWith(
      requestId,
      requestMetadata,
    );
    await expect(decide(harness.service, 'APPROVE')).resolves.toMatchObject({
      status: 'APPROVED',
    });
    expect(harness.onboardApprovedRequest).toHaveBeenCalledTimes(1);
  });

  it.each(['PENDING', 'REJECTED'] as const)(
    'cannot use automatic completion to authorize %s',
    async (status) => {
      const harness = makeHarness(makeRequest({ status }));
      await expect(
        harness.service.completeSignupApproval(requestId, requestMetadata),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(harness.onboardApprovedRequest).not.toHaveBeenCalled();
    },
  );

  it('keeps automatic provisioning failures visible and retryable by the operator', async () => {
    const harness = makeHarness(
      makeRequest({
        status: 'APPROVAL_IN_PROGRESS',
        decisionAt,
        provisioningAttemptedAt: attemptedAt,
      }),
    );
    harness.onboardApprovedRequest.mockRejectedValueOnce(
      new Error('delivery failed'),
    );
    await expect(
      harness.service.completeSignupApproval(requestId, requestMetadata),
    ).resolves.toMatchObject({
      status: 'PROVISIONING_FAILED',
      provisioningOutcome: { retryable: true },
    });
    await expect(decide(harness.service, 'APPROVE')).resolves.toMatchObject({
      status: 'APPROVED',
    });
    expect(harness.getState().decisionAt).toEqual(decisionAt);
  });

  it('rejects a pending request atomically without invoking onboarding', async () => {
    const harness = makeHarness();

    await expect(decide(harness.service, 'REJECT')).resolves.toMatchObject({
      requestId,
      decision: 'REJECT',
      status: 'REJECTED',
      provisioningOutcome: null,
    });
    expect(harness.onboardApprovedRequest).not.toHaveBeenCalled();
    expect(harness.getState().status).toBe('REJECTED');
    expect(harness.getState().decisionAt).not.toBeNull();
  });

  it('claims approval before onboarding and passes only the request identity and bounded metadata', async () => {
    const harness = makeHarness();

    await expect(decide(harness.service, 'APPROVE')).resolves.toMatchObject({
      requestId,
      decision: 'APPROVE',
      status: 'APPROVED',
      provisioningOutcome: {
        status: 'SUCCEEDED',
        organizationId: '550e8400-e29b-41d4-a716-446655440029',
        userId: '550e8400-e29b-41d4-a716-446655440028',
      },
    });
    expect(harness.events.indexOf('transaction-complete')).toBeLessThan(
      harness.events.indexOf('onboarding-start'),
    );
    expect(harness.onboardApprovedRequest).toHaveBeenCalledTimes(1);
    expect(harness.assertOpenInTransaction).toHaveBeenCalledTimes(1);
    expect(harness.onboardApprovedRequest).toHaveBeenCalledWith(
      requestId,
      requestMetadata,
    );
    expect(harness.getState()).toMatchObject({
      status: 'APPROVED',
      provisionedUserId: '550e8400-e29b-41d4-a716-446655440028',
      provisionedOrganizationId: '550e8400-e29b-41d4-a716-446655440029',
      provisioningCompletedAt: expect.any(Date),
      provisioningError: null,
    });
  });

  it('does not claim a pending approval after private-beta access closes', async () => {
    const harness = makeHarness();
    harness.assertOpenInTransaction.mockRejectedValueOnce(
      new ConflictException('Private-beta access is closed'),
    );

    await expect(decide(harness.service, 'APPROVE')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(harness.transactionUpdate).not.toHaveBeenCalled();
    expect(harness.onboardApprovedRequest).not.toHaveBeenCalled();
  });

  it('returns an approved replay without invoking onboarding again', async () => {
    const harness = makeHarness(
      makeRequest({
        status: 'APPROVED',
        decisionAt,
        provisionedUserId: '550e8400-e29b-41d4-a716-446655440028',
        provisionedOrganizationId: '550e8400-e29b-41d4-a716-446655440029',
        provisioningAttemptedAt: attemptedAt,
        provisioningCompletedAt: completedAt,
      }),
    );

    await expect(decide(harness.service, 'APPROVE')).resolves.toEqual({
      requestId,
      decision: 'APPROVE',
      status: 'APPROVED',
      decidedAt: decisionAt.toISOString(),
      provisioningOutcome: {
        status: 'SUCCEEDED',
        attemptedAt: attemptedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        organizationId: '550e8400-e29b-41d4-a716-446655440029',
        userId: '550e8400-e29b-41d4-a716-446655440028',
        failureCode: null,
        failureMessage: null,
        retryable: false,
      },
    });
    expect(harness.onboardApprovedRequest).not.toHaveBeenCalled();
    expect(harness.assertBetaAdmissionEntitlement).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440029',
      {
        actor: '550e8400-e29b-41d4-a716-446655440028',
        reason: `PRIVATE_BETA_ADMISSION:${requestId}`,
      },
    );
    expect(harness.rootUpdate).not.toHaveBeenCalled();
  });

  it('persists a bounded organization failure when approved replay entitlement validation fails', async () => {
    const harness = makeHarness(
      makeRequest({
        status: 'APPROVED',
        decisionAt,
        provisionedUserId: '550e8400-e29b-41d4-a716-446655440028',
        provisionedOrganizationId: '550e8400-e29b-41d4-a716-446655440029',
        provisioningAttemptedAt: attemptedAt,
        provisioningCompletedAt: completedAt,
      }),
    );
    harness.assertBetaAdmissionEntitlement.mockRejectedValueOnce(
      new ConflictException('conflicting entitlement'),
    );

    await expect(decide(harness.service, 'APPROVE')).resolves.toMatchObject({
      status: 'PROVISIONING_FAILED',
      provisioningOutcome: {
        status: 'FAILED',
        failureCode: 'ORGANIZATION_PROVISIONING',
        failureMessage: 'Private-beta provisioning could not be completed.',
        retryable: true,
      },
    });
    expect(harness.onboardApprovedRequest).not.toHaveBeenCalled();
  });

  it('allows approval retry after a provisioning failure and preserves the original decision timestamp', async () => {
    const harness = makeHarness(
      makeRequest({
        status: 'PROVISIONING_FAILED',
        decisionAt,
        provisioningAttemptedAt: attemptedAt,
        provisioningFailureCode: 'UNKNOWN',
        provisioningError: 'previous bounded failure',
      }),
    );

    await expect(decide(harness.service, 'APPROVE')).resolves.toMatchObject({
      status: 'APPROVED',
      decidedAt: decisionAt.toISOString(),
    });
    expect(harness.transactionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'APPROVAL_IN_PROGRESS',
          provisioningAttemptedAt: expect.any(Date),
          provisioningFailureCode: null,
          provisioningError: null,
        }),
      }),
    );
  });

  it('returns a typed sanitized persisted failure instead of rethrowing onboarding errors', async () => {
    const harness = makeHarness();
    const rawFailure = 'recipient@example.com provider unavailable';
    harness.onboardApprovedRequest.mockRejectedValueOnce(new Error(rawFailure));

    await expect(decide(harness.service, 'APPROVE')).resolves.toMatchObject({
      status: 'PROVISIONING_FAILED',
      provisioningOutcome: {
        status: 'FAILED',
        failureCode: 'UNKNOWN',
        failureMessage: 'Private-beta provisioning could not be completed.',
        retryable: true,
      },
    });
    expect(harness.getState().status).toBe('PROVISIONING_FAILED');
    expect(harness.getState().provisioningError).not.toContain(rawFailure);
    expect(harness.rootUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PROVISIONING_FAILED',
          provisioningFailureCode: 'UNKNOWN',
          provisioningError:
            'Private-beta provisioning could not be completed.',
        }),
      }),
    );
  });

  it.each([
    ['APPROVAL_IN_PROGRESS', 'APPROVE'],
    ['APPROVED', 'REJECT'],
    ['REJECTED', 'APPROVE'],
    ['REJECTED', 'REJECT'],
    ['PROVISIONING_FAILED', 'REJECT'],
  ] as const)('returns conflict for %s + %s', async (status, decision) => {
    const harness = makeHarness(makeRequest({ decisionAt }));
    harness.getState().status = status;

    await expect(decide(harness.service, decision)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(harness.onboardApprovedRequest).not.toHaveBeenCalled();
  });

  it('returns not found before attempting a decision for an unknown request', async () => {
    const txFindUnique = jest.fn().mockResolvedValue(null);
    const prisma = {
      db: {
        $transaction: jest.fn(async (callback: (client: unknown) => unknown) =>
          callback({
            $queryRaw: jest.fn().mockResolvedValue([{ id: requestId }]),
            privateBetaAccessRequest: { findUnique: txFindUnique },
          }),
        ),
      },
    } as unknown as PrismaService;
    const service = new PrivateBetaAccessDecisionService(
      prisma,
      {
        onboardApprovedRequest: jest.fn(),
      } as unknown as BetaOnboardingService,
      {
        assertOpenInTransaction: jest.fn(),
      } as unknown as PrivateBetaAccessProgramService,
      {
        assertBetaAdmissionEntitlement: jest.fn(),
      } as unknown as AccountEntitlementService,
    );

    await expect(decide(service, 'REJECT')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(txFindUnique).toHaveBeenCalledTimes(1);
  });
});
