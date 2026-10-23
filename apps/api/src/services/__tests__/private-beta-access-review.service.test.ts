import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PrivateBetaAccessRequestId } from '../../types';
import { PrivateBetaAccessReviewService } from '../private-beta-access-review.service';

const requestId =
  '550e8400-e29b-41d4-a716-446655440026' as PrivateBetaAccessRequestId;
const createdAt = new Date('2026-08-12T00:00:00.000Z');
const decisionAt = new Date('2026-08-12T01:00:00.000Z');
const attemptedAt = new Date('2026-08-12T01:01:00.000Z');

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: requestId,
    normalizedEmail: 'ada@example.com',
    name: 'Ada Lovelace',
    organizationName: 'Analytical Engines',
    teamSize: 5,
    productContext: 'A developer tool.',
    accessRationale: 'Evaluate agent-assisted planning.',
    status: 'PENDING' as const,
    createdAt,
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

describe('PrivateBetaAccessReviewService', () => {
  let findMany: jest.Mock;
  let findUnique: jest.Mock;
  let service: PrivateBetaAccessReviewService;

  beforeEach(() => {
    findMany = jest.fn();
    findUnique = jest.fn();
    service = new PrivateBetaAccessReviewService({
      db: {
        privateBetaAccessRequest: { findMany, findUnique },
      },
    } as unknown as PrismaService);
  });

  it('maps the complete durable request collection in stable newest-first order', async () => {
    const newest = makeRequest({
      id: '550e8400-e29b-41d4-a716-446655440028',
      createdAt: new Date('2026-08-13T00:00:00.000Z'),
      status: 'APPROVED',
      decisionAt,
      provisioningAttemptedAt: attemptedAt,
      provisioningCompletedAt: new Date('2026-08-13T00:03:00.000Z'),
      provisionedUserId: '550e8400-e29b-41d4-a716-446655440027',
      provisionedOrganizationId: '550e8400-e29b-41d4-a716-446655440029',
    });
    findMany.mockResolvedValue([newest, makeRequest()]);

    await expect(service.findMany()).resolves.toEqual([
      expect.objectContaining({
        requestId: newest.id,
        status: 'APPROVED',
        provisioningOutcome: expect.objectContaining({
          status: 'SUCCEEDED',
          organizationId: newest.provisionedOrganizationId,
          userId: newest.provisionedUserId,
        }),
      }),
      expect.objectContaining({ requestId }),
    ]);
    expect(findMany).toHaveBeenCalledWith({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        normalizedEmail: true,
        name: true,
        organizationName: true,
        teamSize: true,
        productContext: true,
        accessRationale: true,
        status: true,
        createdAt: true,
        decisionAt: true,
        provisionedUserId: true,
        provisionedOrganizationId: true,
        provisioningAttemptedAt: true,
        provisioningCompletedAt: true,
        provisioningFailureCode: true,
        provisioningError: true,
      },
    });
  });

  it('maps a pending request and preserves nullable review metadata', async () => {
    findUnique.mockResolvedValue(makeRequest());

    await expect(service.findOne(requestId)).resolves.toEqual({
      requestId,
      name: 'Ada Lovelace',
      workEmail: 'ada@example.com',
      organizationName: 'Analytical Engines',
      teamSize: 5,
      productContext: 'A developer tool.',
      accessRationale: 'Evaluate agent-assisted planning.',
      status: 'PENDING',
      createdAt: '2026-08-12T00:00:00.000Z',
      decidedAt: null,
      provisioningOutcome: null,
    });
  });

  it('maps a failed provisioning outcome without inventing failure metadata', async () => {
    findUnique.mockResolvedValue(
      makeRequest({
        status: 'PROVISIONING_FAILED',
        decisionAt,
        provisioningAttemptedAt: attemptedAt,
        provisioningCompletedAt: new Date('2026-08-12T01:02:00.000Z'),
        provisioningFailureCode: 'ORGANIZATION_PROVISIONING',
        provisioningError: 'Private-beta provisioning could not be completed.',
      }),
    );

    await expect(service.findOne(requestId)).resolves.toMatchObject({
      status: 'PROVISIONING_FAILED',
      decidedAt: '2026-08-12T01:00:00.000Z',
      provisioningOutcome: {
        status: 'FAILED',
        attemptedAt: '2026-08-12T01:01:00.000Z',
        completedAt: '2026-08-12T01:02:00.000Z',
        organizationId: null,
        userId: null,
        failureCode: 'ORGANIZATION_PROVISIONING',
        failureMessage: 'Private-beta provisioning could not be completed.',
        retryable: true,
      },
    });
  });

  it('does not expose resource checkpoints as a completed success', async () => {
    findUnique.mockResolvedValue(
      makeRequest({
        status: 'APPROVAL_IN_PROGRESS',
        decisionAt,
        provisioningAttemptedAt: attemptedAt,
        provisionedUserId: '550e8400-e29b-41d4-a716-446655440027',
        provisionedOrganizationId: '550e8400-e29b-41d4-a716-446655440028',
      }),
    );

    await expect(service.findOne(requestId)).resolves.toMatchObject({
      status: 'APPROVAL_IN_PROGRESS',
      provisioningOutcome: null,
    });
  });

  it('maps a terminal approved request and successful provisioning outcome', async () => {
    findUnique.mockResolvedValue(
      makeRequest({
        status: 'APPROVED',
        decisionAt,
        provisioningAttemptedAt: attemptedAt,
        provisionedUserId: '550e8400-e29b-41d4-a716-446655440027',
        provisionedOrganizationId: '550e8400-e29b-41d4-a716-446655440028',
        provisioningCompletedAt: new Date('2026-08-12T01:03:00.000Z'),
      }),
    );

    await expect(service.findOne(requestId)).resolves.toMatchObject({
      status: 'APPROVED',
      provisioningOutcome: {
        status: 'SUCCEEDED',
        attemptedAt: '2026-08-12T01:01:00.000Z',
        completedAt: '2026-08-12T01:03:00.000Z',
        organizationId: '550e8400-e29b-41d4-a716-446655440028',
        userId: '550e8400-e29b-41d4-a716-446655440027',
        failureCode: null,
        failureMessage: null,
        retryable: false,
      },
    });
  });

  it('returns the documented not-found result for an unknown request', async () => {
    findUnique.mockResolvedValue(null);

    await expect(service.findOne(requestId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: requestId },
      select: {
        id: true,
        normalizedEmail: true,
        name: true,
        organizationName: true,
        teamSize: true,
        productContext: true,
        accessRationale: true,
        status: true,
        createdAt: true,
        decisionAt: true,
        provisionedUserId: true,
        provisionedOrganizationId: true,
        provisioningAttemptedAt: true,
        provisioningCompletedAt: true,
        provisioningFailureCode: true,
        provisioningError: true,
      },
    });
  });
});
