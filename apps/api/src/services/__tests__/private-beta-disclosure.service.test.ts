import { ConflictException } from '@nestjs/common';
import type { PrivateBetaDisclosureAcceptanceInputDto } from '../../generated';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrivateBetaDisclosureService } from '../private-beta-disclosure.service';

const user = {
  userId: 'user-1',
  currentOrgId: 'organization-1',
} as AuthenticatedUser;

const acceptanceInput: PrivateBetaDisclosureAcceptanceInputDto = {
  documentKind: 'TERMS',
  version: '1.2-beta',
  effectiveDate: '2026-09-14',
  actionType: 'AGREED',
};

const makeAcceptance = (overrides: Record<string, unknown> = {}) => ({
  id: 'acceptance-1',
  userId: user.userId,
  organizationId: user.currentOrgId,
  documentKind: 'TERMS' as const,
  version: '1.2-beta',
  effectiveDate: new Date('2026-09-14T00:00:00.000Z'),
  actionType: 'AGREED' as const,
  acceptedAt: new Date('2026-09-15T12:00:00.000Z'),
  ...overrides,
});

describe('PrivateBetaDisclosureService', () => {
  const db = {
    privateBetaDisclosureAcceptance: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };
  const service = new PrivateBetaDisclosureService({
    db,
  } as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    db.privateBetaDisclosureAcceptance.findMany.mockResolvedValue([]);
    db.privateBetaDisclosureAcceptance.findUnique.mockResolvedValue(null);
  });

  it('fails closed in the status model until all three current actions exist', async () => {
    db.privateBetaDisclosureAcceptance.findMany.mockResolvedValue([
      makeAcceptance(),
      makeAcceptance({
        id: 'acceptance-2',
        documentKind: 'PRIVACY',
        actionType: 'ACKNOWLEDGED',
      }),
    ]);

    await expect(service.getStatus(user)).resolves.toMatchObject({
      isComplete: false,
      recordedAcceptances: [
        expect.objectContaining({
          documentKind: 'TERMS',
          userId: 'user-1',
          organizationId: 'organization-1',
          effectiveDate: '2026-09-14',
          acceptedAt: '2026-09-15T12:00:00.000Z',
        }),
        expect.objectContaining({ documentKind: 'PRIVACY' }),
      ],
    });
    expect(db.privateBetaDisclosureAcceptance.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', organizationId: 'organization-1' },
      orderBy: [{ acceptedAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('rejects stale document versions before writing an audit record', async () => {
    await expect(
      service.submitAcceptance(user, {
        ...acceptanceInput,
        version: '1.0-private-beta',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.privateBetaDisclosureAcceptance.create).not.toHaveBeenCalled();
  });

  it('derives identity and timestamp fields server-side and reuses repeats', async () => {
    const acceptance = makeAcceptance();
    db.privateBetaDisclosureAcceptance.create.mockResolvedValue(acceptance);

    await expect(
      service.submitAcceptance(user, acceptanceInput),
    ).resolves.toEqual({
      accepted: true,
      acceptance: expect.objectContaining({
        id: 'acceptance-1',
        userId: 'user-1',
        organizationId: 'organization-1',
        acceptedAt: '2026-09-15T12:00:00.000Z',
      }),
    });
    expect(db.privateBetaDisclosureAcceptance.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        organizationId: 'organization-1',
        documentKind: 'TERMS',
        version: '1.2-beta',
        effectiveDate: new Date('2026-09-14T00:00:00.000Z'),
        actionType: 'AGREED',
      },
    });

    db.privateBetaDisclosureAcceptance.findUnique.mockResolvedValue(acceptance);
    await expect(
      service.submitAcceptance(user, acceptanceInput),
    ).resolves.toEqual({
      accepted: true,
      acceptance: expect.objectContaining({ id: 'acceptance-1' }),
    });
    expect(db.privateBetaDisclosureAcceptance.create).toHaveBeenCalledTimes(1);
  });
});
