import { WorkItemChangeSetCheckpointStatus } from '@prisma/client';
import { WorkItemChangeSetMaterializerService } from '../work-item-change-set-materializer.service';

const SUCCESSOR_ID = '123e4567-e89b-42d3-a456-426614174401';
const REVISION = 'revision-1';
const SUPERSEDES_CHECKPOINT_INDEX = -3;

const params = {
  proposalId: 'proposal-1',
  organizationId: 'organization-1' as any,
  projectId: 'project-1' as any,
};

function createService(applyDeclaredSupersession: jest.Mock) {
  const calls: string[] = [];
  const checkpointUpdate = jest.fn(async (args: any) => {
    calls.push(`checkpoint:${args.data.status}`);
    return undefined;
  });
  const materialization = {
    findFirst: jest.fn().mockResolvedValue({ id: 'materialization-1' }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const checkpoint = {
    update: checkpointUpdate,
    updateMany: jest.fn(async (args: any) => {
      await checkpointUpdate(args);
      return { count: 1 };
    }),
  };
  const tx = {
    workItemChangeSetMaterialization: materialization,
    workItemChangeSetMaterializationCheckpoint: checkpoint,
  };
  const prisma = {
    db: {
      $transaction: jest.fn(async (callback: (t: typeof tx) => unknown) =>
        callback(tx),
      ),
      workItemChangeSetMaterialization: materialization,
      workItemChangeSetMaterializationCheckpoint: checkpoint,
      proposal: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'proposal-1',
          edges: [{ edgeType: 'SUPERSEDES', targetEntityType: 'TASK' }],
        }),
      },
    },
  };
  const service = new WorkItemChangeSetMaterializerService(
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    jest.fn().mockReturnValue('token'),
    {} as any,
    {} as any,
    { applyDeclaredSupersession } as any,
    {} as any,
  );
  return { service, calls, checkpointUpdate };
}

function prepared(status: WorkItemChangeSetCheckpointStatus | null) {
  return {
    id: 'materialization-1',
    validationRevision: REVISION,
    operationSet: {
      root: { refType: 'existing', id: SUCCESSOR_ID },
      operations: [],
    },
    checkpoints:
      status === null
        ? []
        : [
            {
              id: 'checkpoint-supersedes',
              operationIndex: SUPERSEDES_CHECKPOINT_INDEX,
              validationRevision: REVISION,
              status,
            },
          ],
  };
}

const mappings = {
  workItems: { [`existing:${SUCCESSOR_ID}`]: SUCCESSOR_ID },
  relationships: {},
};

function run(service: any, intent: ReturnType<typeof prepared>) {
  return service.applySupersessionTransition(
    params,
    intent,
    mappings,
    REVISION,
    'claim-1',
  );
}

describe('declared supersession in the durable change-set lifecycle', () => {
  it('runs the one atomic transition for the successor and records completion', async () => {
    const transition = jest.fn().mockResolvedValue(undefined);
    const { service, calls } = createService(transition);

    await run(service, prepared(WorkItemChangeSetCheckpointStatus.PENDING));

    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'proposal-1' }),
      SUCCESSOR_ID,
    );
    expect(calls).toEqual([
      `checkpoint:${WorkItemChangeSetCheckpointStatus.APPLYING}`,
      `checkpoint:${WorkItemChangeSetCheckpointStatus.COMPLETED}`,
    ]);
  });

  it('does not repeat a completed transition when the approval is retried', async () => {
    const transition = jest.fn().mockResolvedValue(undefined);
    const { service, calls } = createService(transition);

    await run(service, prepared(WorkItemChangeSetCheckpointStatus.COMPLETED));

    expect(transition).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('is a no-op for a proposal that declares no supersession', async () => {
    const transition = jest.fn();
    const { service } = createService(transition);

    await run(service, prepared(null));

    expect(transition).not.toHaveBeenCalled();
  });

  it('surfaces a failed transition as a recoverable failure instead of completing', async () => {
    const transition = jest
      .fn()
      .mockRejectedValueOnce(new Error('Graph unavailable'))
      .mockResolvedValue(undefined);
    const { service, calls } = createService(transition);
    const intent = prepared(WorkItemChangeSetCheckpointStatus.PENDING);

    await expect(run(service, intent)).rejects.toThrow('Graph unavailable');
    expect(calls).toContain(
      `checkpoint:${WorkItemChangeSetCheckpointStatus.FAILED}`,
    );
    expect(calls).not.toContain(
      `checkpoint:${WorkItemChangeSetCheckpointStatus.COMPLETED}`,
    );

    // Explicit retry resumes the unfinished transition.
    await run(service, intent);
    expect(transition).toHaveBeenCalledTimes(2);
    expect(calls).toContain(
      `checkpoint:${WorkItemChangeSetCheckpointStatus.COMPLETED}`,
    );
  });
});
