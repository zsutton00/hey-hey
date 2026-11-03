import { randomUUID } from 'node:crypto';
import { DemoSandboxStatus } from '@prisma/client';
import type { GraphsClientService } from '../../graphs-client.service';
import { DemoSandboxReadinessService } from '../demo-sandbox-readiness.service';
import {
  createPersistedGraphCopyIntent,
  type CopiedDesignDocExpectation,
  type CopiedWorkItemExpectation,
} from '../template-graph-copy-intent';

const FEATURES = [
  '128754cc-10ca-4ff3-9fe5-3e6ae4b41fc3',
  '6a0f1d2e-3b4c-4d5e-8f60-718293a4b5c6',
  '350e8400-e29b-41d4-a716-446655440000',
];
const WORK_ITEMS: CopiedWorkItemExpectation[] = [
  { id: FEATURES[0]!, typeKey: 'FEATURE', parentTaskId: null },
  { id: FEATURES[1]!, typeKey: 'FEATURE', parentTaskId: FEATURES[0]! },
  { id: FEATURES[2]!, typeKey: 'FEATURE', parentTaskId: null },
  {
    id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    typeKey: 'STANDARD',
    parentTaskId: FEATURES[0]!,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440001',
    typeKey: 'BUG',
    parentTaskId: null,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440002',
    typeKey: 'CUSTOM_CHECKLIST',
    parentTaskId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  },
];
const DESIGN_DOCS: CopiedDesignDocExpectation[] = [
  {
    id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    parentEntityType: 'TASK',
    parentEntityId: FEATURES[0]!,
  },
  {
    id: '8d0f7780-8536-41ef-a55c-f18fd2a01bf8',
    parentEntityType: 'DESIGN_DOC',
    parentEntityId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  },
  {
    id: '9e1a8891-9647-42f0-b66d-029ae3b12c09',
    parentEntityType: null,
    parentEntityId: null,
  },
];
const graphCommand = { id: randomUUID(), snapshot: { nodes: [], edges: [] } };
const row = (deadlineInMs: number) => ({
  organizationId: 'org-1',
  projectId: 'project-1',
  readinessFeatureIds: FEATURES,
  provisioningDeadline: new Date(Date.now() + deadlineInMs),
});

describe('DemoSandboxReadinessService', () => {
  const checkFeatureProjectConnection = jest.fn();
  const checkWorkItemProjectReadiness = jest.fn();
  const checkDesignDocProjectReadiness = jest.fn();
  const db = {
    designDoc: { findMany: jest.fn() },
    demoSandbox: { findUnique: jest.fn(), updateMany: jest.fn() },
    demoGraphCopyIntent: { findUnique: jest.fn() },
  };
  // A fresh instance each time, as after an API restart.
  const build = () =>
    new DemoSandboxReadinessService(
      { db } as never,
      {
        checkFeatureProjectConnection,
        checkWorkItemProjectReadiness,
        checkDesignDocProjectReadiness,
      } as unknown as GraphsClientService,
      () => 'token',
    );
  const workItemIntent = (
    workItems = WORK_ITEMS,
    designDocs = DESIGN_DOCS,
  ) => ({
    command: createPersistedGraphCopyIntent(
      graphCommand,
      workItems,
      designDocs,
    ),
  });
  const destinationRows = (docs = DESIGN_DOCS) =>
    docs.map(({ id, parentEntityType, parentEntityId }) => ({
      id,
      parentEntityType,
      parentEntityId,
    }));
  const verified = (verifiedCount: number) => ({ verifiedCount });
  const connected = (connectedCount: number) => ({ connectedCount });
  const recordedCounts = () =>
    db.demoSandbox.updateMany.mock.calls.map(
      ([{ data }]: [{ data: { connectedFeatureCount: number } }]) =>
        data.connectedFeatureCount,
    );

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
    db.demoSandbox.findUnique.mockResolvedValue(row(120_000));
    db.demoGraphCopyIntent.findUnique.mockResolvedValue(workItemIntent());
    checkFeatureProjectConnection.mockResolvedValue(connected(FEATURES.length));
    checkWorkItemProjectReadiness.mockResolvedValue(
      verified(WORK_ITEMS.length),
    );
    checkDesignDocProjectReadiness.mockResolvedValue(
      verified(DESIGN_DOCS.length),
    );
    db.designDoc.findMany.mockResolvedValue(destinationRows());
  });
  afterEach(() => jest.useRealTimers());

  it('checks the persisted Features and exact copied work items in their destination project', async () => {
    await expect(build().waitUntilConnected('sandbox-1')).resolves.toBe(true);

    expect(db.demoSandbox.findUnique).toHaveBeenCalledWith({
      where: { id: 'sandbox-1' },
      select: {
        organizationId: true,
        projectId: true,
        readinessFeatureIds: true,
        provisioningDeadline: true,
      },
    });
    expect(db.demoGraphCopyIntent.findUnique).toHaveBeenCalledWith({
      where: { projectId: 'project-1' },
      select: { command: true },
    });
    expect(checkFeatureProjectConnection).toHaveBeenCalledWith(
      'org-1',
      'project-1',
      { featureIds: FEATURES },
      'token',
    );
    expect(checkWorkItemProjectReadiness).toHaveBeenCalledWith(
      'org-1',
      'project-1',
      {
        workItems: WORK_ITEMS.map((item) => ({
          ...item,
          parentTaskId: item.parentTaskId ?? '',
        })),
      },
      'token',
    );
    expect(db.demoSandbox.updateMany).toHaveBeenCalledWith({
      where: { id: 'sandbox-1', status: DemoSandboxStatus.PROVISIONING },
      data: { connectedFeatureCount: FEATURES.length },
    });
  });

  it('keeps readiness pending until both checks match their complete captured sets', async () => {
    checkWorkItemProjectReadiness
      .mockResolvedValueOnce(verified(3))
      .mockResolvedValueOnce(verified(5))
      .mockResolvedValueOnce(verified(WORK_ITEMS.length));

    const outcome = build().waitUntilConnected('sandbox-1');
    await jest.advanceTimersByTimeAsync(0);
    expect(checkFeatureProjectConnection).toHaveBeenCalledTimes(1);
    expect(checkWorkItemProjectReadiness).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(checkWorkItemProjectReadiness).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1_000);

    await expect(outcome).resolves.toBe(true);
    expect(checkFeatureProjectConnection).toHaveBeenCalledTimes(3);
    expect(checkWorkItemProjectReadiness).toHaveBeenCalledTimes(3);
  });

  it('retries when the work-item Graph read is unavailable', async () => {
    checkWorkItemProjectReadiness
      .mockRejectedValueOnce(new Error('Graph unavailable'))
      .mockResolvedValueOnce(verified(WORK_ITEMS.length));

    const outcome = build().waitUntilConnected('sandbox-1');
    await jest.advanceTimersByTimeAsync(1_000);

    await expect(outcome).resolves.toBe(true);
    expect(checkFeatureProjectConnection).toHaveBeenCalledTimes(2);
    expect(checkWorkItemProjectReadiness).toHaveBeenCalledTimes(2);
  });

  it('does not pass when any captured work-item identity is missing', async () => {
    db.demoSandbox.findUnique.mockResolvedValue(row(3_000));
    checkWorkItemProjectReadiness.mockResolvedValue(
      verified(WORK_ITEMS.length - 1),
    );

    const outcome = build().waitUntilConnected('sandbox-1');
    await jest.advanceTimersByTimeAsync(3_000);

    await expect(outcome).resolves.toBe(false);
    expect(checkFeatureProjectConnection).toHaveBeenCalledTimes(3);
    expect(checkWorkItemProjectReadiness).toHaveBeenCalledTimes(3);
  });

  it('does not pass if the graph checks finish at the persisted deadline', async () => {
    db.demoSandbox.findUnique.mockResolvedValue(row(1_000));
    checkFeatureProjectConnection.mockImplementation(async () => {
      await jest.advanceTimersByTimeAsync(1_000);
      return connected(FEATURES.length);
    });

    await expect(build().waitUntilConnected('sandbox-1')).resolves.toBe(false);
    expect(checkFeatureProjectConnection).toHaveBeenCalledTimes(1);
    expect(checkWorkItemProjectReadiness).toHaveBeenCalledTimes(1);
  });

  it('checks expected work items in bounded batches', async () => {
    const workItems = [
      ...WORK_ITEMS,
      ...Array.from({ length: 495 }, () => ({
        id: randomUUID(),
        typeKey: 'STANDARD',
        parentTaskId: null,
      })),
    ];
    db.demoGraphCopyIntent.findUnique.mockResolvedValue(
      workItemIntent(workItems),
    );
    checkWorkItemProjectReadiness
      .mockResolvedValueOnce(verified(500))
      .mockResolvedValueOnce(verified(1));

    await expect(build().waitUntilConnected('sandbox-1')).resolves.toBe(true);

    const requests = checkWorkItemProjectReadiness.mock.calls.map(
      ([, , request]) => request,
    );
    expect(requests.map((request) => request.workItems.length)).toEqual([
      500, 1,
    ]);
  });

  it('reuses the same expected set and persisted deadline after a restart', async () => {
    const persisted = row(2_000);
    const expectedDeadline = persisted.provisioningDeadline;
    db.demoSandbox.findUnique.mockResolvedValue(persisted);
    checkWorkItemProjectReadiness.mockResolvedValue(verified(0));

    const firstAttempt = build().waitUntilConnected('sandbox-1');
    await jest.advanceTimersByTimeAsync(1_500);
    const restartAttempt = build().waitUntilConnected('sandbox-1');
    await jest.advanceTimersByTimeAsync(500);

    await expect(firstAttempt).resolves.toBe(false);
    await expect(restartAttempt).resolves.toBe(false);
    expect(db.demoGraphCopyIntent.findUnique).toHaveBeenCalledTimes(2);
    expect(
      checkWorkItemProjectReadiness.mock.calls.map(([, , request]) => request),
    ).toEqual(
      Array.from({ length: 3 }, () => ({
        workItems: WORK_ITEMS.map((item) => ({
          ...item,
          parentTaskId: item.parentTaskId ?? '',
        })),
      })),
    );
    expect(persisted.provisioningDeadline).toEqual(expectedDeadline);
  });

  it('fails closed when the persisted Feature set differs from the captured clone set', async () => {
    db.demoSandbox.findUnique.mockResolvedValue({
      ...row(120_000),
      readinessFeatureIds: ['550e8400-e29b-41d4-a716-446655440010'],
    });

    await expect(build().waitUntilConnected('sandbox-1')).resolves.toBe(false);
    expect(checkFeatureProjectConnection).not.toHaveBeenCalled();
    expect(checkWorkItemProjectReadiness).not.toHaveBeenCalled();
  });

  it('fails an attempt whose durable copy intent is missing', async () => {
    db.demoGraphCopyIntent.findUnique.mockResolvedValue(null);

    await expect(build().waitUntilConnected('sandbox-1')).resolves.toBe(false);
    expect(checkFeatureProjectConnection).not.toHaveBeenCalled();
    expect(checkWorkItemProjectReadiness).not.toHaveBeenCalled();
  });

  describe('copied design docs', () => {
    const attempt = async (deadlineInMs = 3_000) => {
      db.demoSandbox.findUnique.mockResolvedValue(row(deadlineInMs));
      const outcome = build().waitUntilConnected('sandbox-1');
      await jest.advanceTimersByTimeAsync(deadlineInMs);
      return outcome;
    };

    it('verifies the exact captured docs by Graph identity and destination owner', async () => {
      await expect(build().waitUntilConnected('sandbox-1')).resolves.toBe(true);

      expect(checkDesignDocProjectReadiness).toHaveBeenCalledWith(
        'org-1',
        'project-1',
        { designDocIds: DESIGN_DOCS.map((doc) => doc.id) },
        'token',
      );
      expect(db.designDoc.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: { in: DESIGN_DOCS.map((doc) => doc.id) },
            organizationId: 'org-1',
            projectId: 'project-1',
          },
        }),
      );
    });

    it('does not pass when Graph is missing a doc even if other counts match', async () => {
      checkDesignDocProjectReadiness.mockResolvedValue(
        verified(DESIGN_DOCS.length - 1),
      );

      await expect(attempt()).resolves.toBe(false);
    });

    it('does not pass when a doc is attached to a different owner', async () => {
      db.designDoc.findMany.mockResolvedValue(
        destinationRows().map((doc, index) =>
          index === 0
            ? { ...doc, parentEntityId: '550e8400-e29b-41d4-a716-446655440099' }
            : doc,
        ),
      );

      await expect(attempt()).resolves.toBe(false);
    });

    it('does not pass when a substituted doc replaces an expected one in the destination project', async () => {
      db.designDoc.findMany.mockResolvedValue([
        ...destinationRows().slice(1),
        {
          id: randomUUID(),
          parentEntityType: DESIGN_DOCS[0]!.parentEntityType,
          parentEntityId: DESIGN_DOCS[0]!.parentEntityId,
        },
      ]);

      await expect(attempt()).resolves.toBe(false);
    });

    it('does not pass when a doc has no destination-project row', async () => {
      db.designDoc.findMany.mockResolvedValue(destinationRows().slice(1));

      await expect(attempt()).resolves.toBe(false);
    });

    it('keeps polling until the doc check passes within the original deadline', async () => {
      checkDesignDocProjectReadiness
        .mockResolvedValueOnce(verified(0))
        .mockResolvedValue(verified(DESIGN_DOCS.length));

      const outcome = build().waitUntilConnected('sandbox-1');
      await jest.advanceTimersByTimeAsync(1_000);

      await expect(outcome).resolves.toBe(true);
      expect(checkDesignDocProjectReadiness).toHaveBeenCalledTimes(2);
    });

    it('passes the doc check for an empty expected set without skipping the other checks', async () => {
      db.demoGraphCopyIntent.findUnique.mockResolvedValue(
        workItemIntent(WORK_ITEMS, []),
      );

      await expect(build().waitUntilConnected('sandbox-1')).resolves.toBe(true);
      expect(checkDesignDocProjectReadiness).not.toHaveBeenCalled();
      expect(checkWorkItemProjectReadiness).toHaveBeenCalledTimes(1);

      jest.resetAllMocks();
      db.demoSandbox.findUnique.mockResolvedValue(row(120_000));
      db.demoGraphCopyIntent.findUnique.mockResolvedValue(
        workItemIntent(WORK_ITEMS, []),
      );
      checkFeatureProjectConnection.mockResolvedValue(
        connected(FEATURES.length),
      );
      checkWorkItemProjectReadiness.mockResolvedValue(verified(0));
      db.demoSandbox.findUnique.mockResolvedValue(row(2_000));
      const outcome = build().waitUntilConnected('sandbox-1');
      await jest.advanceTimersByTimeAsync(2_000);
      await expect(outcome).resolves.toBe(false);
    });
  });
});
