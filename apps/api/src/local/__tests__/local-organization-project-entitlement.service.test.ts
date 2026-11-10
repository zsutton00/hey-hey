import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationId } from '../../types';
import { LocalOrganizationProjectEntitlementService } from '../local-organization-project-entitlement.service';

describe('LocalOrganizationProjectEntitlementService', () => {
  const organizationId =
    '50e01076-bce8-4a65-b205-c5da8480e8fb' as OrganizationId;
  let tx: any;
  let service: LocalOrganizationProjectEntitlementService;

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: organizationId }]),
      // An existing override lower than the project count, as left by the old hosted limit.
      organizationProjectEntitlement: {
        findUnique: jest.fn().mockResolvedValue({ projectLimitOverride: 2 }),
      },
      organizationCapacityUsage: {
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      project: { count: jest.fn().mockResolvedValue(7) },
      task: { count: jest.fn().mockResolvedValue(40) },
    };
    service = new LocalOrganizationProjectEntitlementService({
      db: tx,
    } as unknown as PrismaService);
  });

  it('reports no limit and ignores a stored override, while still recording usage', async () => {
    const result = await service.resolve(organizationId, tx);

    expect(result).toMatchObject({
      projectLimit: null,
      projectLimitOverride: null,
      canCreateProject: true,
      creationUnavailableReason: null,
      usage: { projectCount: 7, workItemCount: 40 },
    });
    expect(tx.organizationCapacityUsage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ projectCount: 7, workItemCount: 40 }),
      }),
    );
  });

  it('never refuses project creation, past the old default and a stored override', async () => {
    await expect(
      service.assertProjectCreationAllowed(tx, organizationId),
    ).resolves.toBeUndefined();
    expect(tx.$queryRaw).toHaveBeenCalled();
  });
});
