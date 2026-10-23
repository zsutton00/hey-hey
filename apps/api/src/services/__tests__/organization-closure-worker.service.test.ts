import {
  OrganizationClosureExecution,
  OrganizationClosureExecutionStage,
} from '@prisma/client';
import { OrganizationClosureWorkerService } from '../organization-closure-worker.service';

const EXECUTION_BASE = {
  organizationId: 'organization-id',
  markerId: 'marker-id',
  effectiveClosureAt: new Date('2026-08-31T00:18:00.000Z'),
  deletionDeadline: new Date('2026-09-30T00:18:00.000Z'),
  attemptCount: 1,
  attemptId: 'attempt-id',
  claimToken: 'claim-token',
  claimedAt: new Date('2026-08-31T00:18:00.000Z'),
  leaseExpiresAt: new Date('2026-08-31T00:23:00.000Z'),
} as const;

function execution(
  stage: OrganizationClosureExecutionStage,
): OrganizationClosureExecution {
  return {
    ...EXECUTION_BASE,
    stage,
  } as OrganizationClosureExecution;
}

describe('OrganizationClosureWorkerService', () => {
  it.each([
    OrganizationClosureExecutionStage.PENDING,
    OrganizationClosureExecutionStage.AUTHORITY_REVOKED,
    OrganizationClosureExecutionStage.CONTENT_DELETED,
    OrganizationClosureExecutionStage.PROJECTIONS_INVALIDATED,
    OrganizationClosureExecutionStage.VERIFIED,
  ])(
    'dispatches a claimed %s execution to the projection coordinator',
    async (stage) => {
      const claimedExecution = execution(stage);
      const dueWork = {
        materializeNextReachedSnapshot: jest.fn().mockResolvedValue(false),
        claimNext: jest
          .fn()
          .mockResolvedValueOnce(claimedExecution)
          .mockResolvedValueOnce(null),
      };
      const projectionCoordinator = {
        execute: jest.fn().mockResolvedValue(undefined),
      };
      const worker = new OrganizationClosureWorkerService(
        dueWork as never,
        projectionCoordinator as never,
      );

      await worker.processDueClosures();

      expect(projectionCoordinator.execute).toHaveBeenCalledTimes(1);
      expect(projectionCoordinator.execute).toHaveBeenCalledWith(
        claimedExecution,
      );
    },
  );
});
