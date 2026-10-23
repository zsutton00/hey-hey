import { SummaryCategory, SubfacetStatus } from '@prisma/client';
import { TopologyConsolidationSchedulerService } from '../topology-consolidation-scheduler.service';
import * as TestUtils from 'src/utils/testUtils';

describe('TopologyConsolidationSchedulerService lifecycle integration', () => {
  it('promotes up to 2 candidates per category when ACTIVE+PROVISIONAL capacity allows', async () => {
    const prisma = TestUtils.createMockPrismaService();
    const tx = {
      subfacet: {
        findMany: jest.fn().mockImplementation(({ where }) => {
          if (where.category === SummaryCategory.technology) {
            return Promise.resolve(
              Array.from({ length: 10 }, () => ({
                status: SubfacetStatus.ACTIVE,
              })),
            );
          }
          return Promise.resolve(
            Array.from({ length: 24 }, () => ({
              status: SubfacetStatus.ACTIVE,
            })),
          );
        }),
      },
    };

    const subfacetCandidateService = {
      listPromotableCandidates: jest
        .fn()
        .mockImplementation(({ category, limit }) =>
          category === SummaryCategory.technology
            ? Promise.resolve(
                [
                  { id: 'cand-1', name: 'runtime isolation' },
                  { id: 'cand-2', name: 'safety policy' },
                  { id: 'cand-3', name: 'extra candidate' },
                ].slice(0, limit),
              )
            : Promise.resolve([]),
        ),
      markPromoted: jest.fn().mockResolvedValue(undefined),
    };
    const subfacetService = {
      createProvisionalSubfacet: jest
        .fn()
        .mockImplementation(({ name }) =>
          Promise.resolve({ id: `sf-${name}`, name }),
        ),
    };

    const scheduler = new TopologyConsolidationSchedulerService(
      prisma as any,
      {} as any,
      subfacetService as any,
      subfacetCandidateService as any,
    );

    await (scheduler as any).promoteCandidatesToProvisionals({
      tx,
      organizationId: TestUtils.testIds.organization,
      projectId: TestUtils.testIds.project,
    });

    expect(
      subfacetCandidateService.listPromotableCandidates,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        category: SummaryCategory.technology,
        limit: 2,
      }),
    );
    expect(subfacetService.createProvisionalSubfacet).toHaveBeenCalledTimes(2);
    expect(subfacetCandidateService.markPromoted).toHaveBeenCalledWith(
      expect.objectContaining({
        promotions: [
          { candidateId: 'cand-1', subfacetId: 'sf-runtime isolation' },
          { candidateId: 'cand-2', subfacetId: 'sf-safety policy' },
        ],
      }),
    );
  });

  it('runs candidate promotion intake on successful no-op runs', async () => {
    const tx = {
      topologyConsolidationRun: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      topologyConsolidationSchedule: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation(async (fn) => fn(tx)),
    };

    const scheduler = new TopologyConsolidationSchedulerService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const promoteSpy = jest
      .spyOn(scheduler as any, 'promoteCandidatesToProvisionals')
      .mockResolvedValue(undefined);
    const releaseSpy = jest
      .spyOn(scheduler as any, 'releaseScheduleLock')
      .mockResolvedValue(undefined);

    await (scheduler as any).completeNoopRun(
      {
        id: 'sched-1',
        organizationId: TestUtils.testIds.organization,
        projectId: TestUtils.testIds.project,
        cadenceHours: 24,
      },
      'run-1',
    );

    expect(promoteSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tx,
        organizationId: TestUtils.testIds.organization,
        projectId: TestUtils.testIds.project,
      }),
    );
    expect(releaseSpy).toHaveBeenCalled();
  });
});
