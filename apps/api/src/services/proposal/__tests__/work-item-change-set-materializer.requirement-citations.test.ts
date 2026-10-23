import { WorkItemChangeSetCheckpointStatus } from '@prisma/client';
import { requirementCitationEdgeId } from '../../tasks/feature-requirement-citation-edges';
import { WorkItemChangeSetMaterializerService } from '../work-item-change-set-materializer.service';

const FEATURE_ID = '00000000-0000-4000-8000-000000000001';
const DESIGN_DOC_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const CONTRACT_ID = '44444444-4444-4444-8444-444444444444';
const RECORD_A = '55555555-5555-4555-8555-555555555555';
const RECORD_B = '66666666-6666-4666-8666-666666666666';

const params = {
  proposalId: 'proposal-1',
  organizationId: 'organization-1' as any,
  projectId: 'project-1' as any,
};

function requirements(
  records: Array<{
    id: string;
    designedBy?: Array<[string, string]>;
    fulfilledBy?: Array<[string, string]>;
    contracts?: Array<[string, string]>;
  }>,
): string {
  const cites = (pairs: Array<[string, string]> = []) =>
    pairs.map(([entityType, entityId]) => ({
      entityType,
      entityId,
      entityTitle: 'Title',
    }));
  return JSON.stringify({
    records: records.map((record) => ({
      id: record.id,
      statement: `Statement ${record.id}`,
      designedBy: cites(record.designedBy),
      fulfilledBy: cites(record.fulfilledBy),
      contracts: cites(record.contracts),
    })),
  });
}

function createService() {
  const workItemChangeSetMaterialization = {
    findFirst: jest.fn().mockResolvedValue({ id: 'materialization-1' }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const workItemChangeSetMaterializationCheckpoint = {
    update: jest.fn().mockResolvedValue(undefined),
  };
  const tx = {
    workItemChangeSetMaterialization,
    workItemChangeSetMaterializationCheckpoint,
  };
  const prisma = {
    db: {
      $transaction: jest.fn(
        async (callback: (transaction: typeof tx) => unknown) => callback(tx),
      ),
      workItemChangeSetMaterialization,
      workItemChangeSetMaterializationCheckpoint,
    },
  };
  const agentEdgeClient = {
    createBatch: jest.fn().mockImplementation((_org, _project, dtos) =>
      Promise.resolve(
        dtos.map((dto: Record<string, unknown>, index: number) => ({
          index,
          success: true,
          edge: dto,
        })),
      ),
    ),
    delete: jest.fn().mockResolvedValue(undefined),
    get: jest.fn(),
  };
  const service = new WorkItemChangeSetMaterializerService(
    prisma as any,
    {} as any,
    {} as any,
    agentEdgeClient as any,
    {} as any,
    jest.fn().mockReturnValue('token'),
    {
      guardTaskEffect: jest.fn(async (...args: unknown[]) =>
        (args[6] as () => Promise<unknown>)(),
      ),
      recordEdgeEffect: jest.fn(),
      reviewedEdgeBasis: jest.fn().mockResolvedValue({ version: '' }),
    } as any,
    {} as any,
    {} as any,
    { extractAndValidate: async () => [] } as any,
  );
  return { service, agentEdgeClient, checkpoints: tx };
}

function featureSnapshot(content: string | null) {
  return {
    [FEATURE_ID]: {
      id: FEATURE_ID,
      type: 'FEATURE',
      sections:
        content === null
          ? []
          : [{ key: 'requirements', materializedMarkdown: content }],
    },
  };
}

describe('WorkItemChangeSetMaterializerService requirement citation edges', () => {
  describe('planning at prepare time', () => {
    it('plans every cited entity for a FEATURE create', () => {
      const { service } = createService();
      const plan = (service as any).planRequirementCitationEdges(
        params.proposalId,
        {
          root: { refType: 'temporary', tempId: 'root' },
          operations: [
            {
              op: 'workItem.create',
              ref: { refType: 'temporary', tempId: 'root' },
              name: 'Feature',
              type: 'FEATURE',
            },
            {
              op: 'section.replace',
              ref: { refType: 'temporary', tempId: 'root' },
              key: 'requirements',
              content: requirements([
                {
                  id: RECORD_A,
                  designedBy: [['DESIGN_DOC', DESIGN_DOC_ID]],
                  contracts: [['CONTRACT', CONTRACT_ID]],
                },
              ]),
            },
          ],
        },
        FEATURE_ID,
        {},
      );

      expect(plan.deletes).toEqual([]);
      expect(plan.creates).toEqual([
        {
          id: requirementCitationEdgeId(FEATURE_ID, DESIGN_DOC_ID),
          featureId: FEATURE_ID,
          entityId: DESIGN_DOC_ID,
          entityType: 'DESIGN_DOC',
        },
        {
          id: requirementCitationEdgeId(FEATURE_ID, CONTRACT_ID),
          featureId: FEATURE_ID,
          entityId: CONTRACT_ID,
          entityType: 'TASK',
        },
      ]);
    });

    it('diffs a FEATURE edit against the prepared prior snapshot', () => {
      const { service } = createService();
      const prior = requirements([
        {
          id: RECORD_A,
          fulfilledBy: [['TASK', TASK_ID]],
          contracts: [['CONTRACT', CONTRACT_ID]],
        },
      ]);
      const plan = (service as any).planRequirementCitationEdges(
        params.proposalId,
        {
          root: { refType: 'existing', id: FEATURE_ID },
          operations: [
            {
              op: 'workItem.update',
              ref: { refType: 'existing', id: FEATURE_ID },
            },
            {
              op: 'section.replace',
              ref: { refType: 'existing', id: FEATURE_ID },
              key: 'requirements',
              content: requirements([
                { id: RECORD_A },
                { id: RECORD_B, fulfilledBy: [['TASK', TASK_ID]] },
              ]),
            },
          ],
        },
        FEATURE_ID,
        featureSnapshot(prior),
      );

      expect(plan.creates).toEqual([]);
      expect(plan.deletes.map((edge: any) => edge.id)).toEqual([
        requirementCitationEdgeId(FEATURE_ID, CONTRACT_ID),
      ]);
    });

    it('plans nothing when the change set leaves requirements alone', () => {
      const { service } = createService();
      expect(
        (service as any).planRequirementCitationEdges(
          params.proposalId,
          {
            root: { refType: 'existing', id: FEATURE_ID },
            operations: [
              {
                op: 'section.replace',
                ref: { refType: 'existing', id: FEATURE_ID },
                key: 'description',
                content: 'Body',
              },
            ],
          },
          FEATURE_ID,
          featureSnapshot(requirements([{ id: RECORD_A }])),
        ),
      ).toBeUndefined();
    });

    it('plans nothing for a non-FEATURE root', () => {
      const { service } = createService();
      expect(
        (service as any).planRequirementCitationEdges(
          params.proposalId,
          {
            root: { refType: 'temporary', tempId: 'root' },
            operations: [
              {
                op: 'workItem.create',
                ref: { refType: 'temporary', tempId: 'root' },
                name: 'Task',
                type: 'STANDARD',
              },
              {
                op: 'section.replace',
                ref: { refType: 'temporary', tempId: 'root' },
                key: 'requirements',
                content: requirements([
                  { id: RECORD_A, fulfilledBy: [['TASK', TASK_ID]] },
                ]),
              },
            ],
          },
          FEATURE_ID,
          {},
        ),
      ).toBeUndefined();
    });

    it('removes nothing when the prior requirements are unconverted markdown', () => {
      const { service } = createService();
      const plan = (service as any).planRequirementCitationEdges(
        params.proposalId,
        {
          root: { refType: 'existing', id: FEATURE_ID },
          operations: [
            {
              op: 'section.replace',
              ref: { refType: 'existing', id: FEATURE_ID },
              key: 'requirements',
              content: requirements([
                { id: RECORD_A, fulfilledBy: [['TASK', TASK_ID]] },
              ]),
            },
          ],
        },
        FEATURE_ID,
        featureSnapshot('- legacy requirement'),
      );

      expect(plan.deletes).toEqual([]);
      expect(plan.creates.map((edge: any) => edge.entityId)).toEqual([TASK_ID]);
    });
  });

  describe('applying the planned checkpoint', () => {
    function prepared(status: WorkItemChangeSetCheckpointStatus) {
      return {
        id: 'materialization-1',
        priorProjection: {
          schemaVersion: 'work-item-change-set-projection.v1',
          requirementCitationEdges: {
            creates: [
              {
                id: requirementCitationEdgeId(FEATURE_ID, DESIGN_DOC_ID),
                featureId: FEATURE_ID,
                entityId: DESIGN_DOC_ID,
                entityType: 'DESIGN_DOC',
              },
            ],
            deletes: [
              {
                id: requirementCitationEdgeId(FEATURE_ID, CONTRACT_ID),
                featureId: FEATURE_ID,
                entityId: CONTRACT_ID,
                entityType: 'TASK',
              },
            ],
          },
        },
        checkpoints: [
          {
            id: 'citation-checkpoint',
            operationIndex: -2,
            operationKind: 'requirementCitationEdges.sync',
            validationRevision: 'revision-1',
            status,
          },
        ],
      };
    }

    it('creates planned edges with deterministic ids and deletes removed ones by id', async () => {
      const { service, agentEdgeClient, checkpoints } = createService();

      await (service as any).applyRequirementCitationEdges(
        params,
        prepared(WorkItemChangeSetCheckpointStatus.PENDING),
        'revision-1',
        'claim-1',
      );

      expect(agentEdgeClient.createBatch).toHaveBeenCalledWith(
        params.organizationId,
        params.projectId,
        [
          expect.objectContaining({
            id: requirementCitationEdgeId(FEATURE_ID, DESIGN_DOC_ID),
            sourceNodeId: FEATURE_ID,
            sourceEntityType: 'TASK',
            targetNodeId: DESIGN_DOC_ID,
            targetEntityType: 'DESIGN_DOC',
            type: 'DEPENDS_ON',
            category: 'meta',
          }),
        ],
        'token',
        'materialization-1',
      );
      expect(agentEdgeClient.delete).toHaveBeenCalledWith(
        params.organizationId,
        params.projectId,
        requirementCitationEdgeId(FEATURE_ID, CONTRACT_ID),
        'token',
        expect.any(String),
        'materialization-1',
      );
      expect(
        checkpoints.workItemChangeSetMaterializationCheckpoint.update,
      ).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: 'citation-checkpoint' },
          data: expect.objectContaining({
            status: WorkItemChangeSetCheckpointStatus.COMPLETED,
          }),
        }),
      );
    });

    it('skips a checkpoint that already completed', async () => {
      const { service, agentEdgeClient } = createService();

      await (service as any).applyRequirementCitationEdges(
        params,
        prepared(WorkItemChangeSetCheckpointStatus.COMPLETED),
        'revision-1',
        'claim-1',
      );

      expect(agentEdgeClient.createBatch).not.toHaveBeenCalled();
      expect(agentEdgeClient.delete).not.toHaveBeenCalled();
    });

    it('reports a Graph rejection and leaves the checkpoint retryable', async () => {
      const { service, agentEdgeClient, checkpoints } = createService();
      agentEdgeClient.createBatch.mockResolvedValue([
        {
          index: 0,
          success: false,
          error: 'A DEPENDS_ON relationship already joins these entities.',
        },
      ]);

      await expect(
        (service as any).applyRequirementCitationEdges(
          params,
          prepared(WorkItemChangeSetCheckpointStatus.PENDING),
          'revision-1',
          'claim-1',
        ),
      ).rejects.toThrow('requirement citation edge');

      expect(agentEdgeClient.delete).not.toHaveBeenCalled();
      expect(
        checkpoints.workItemChangeSetMaterializationCheckpoint.update,
      ).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: 'citation-checkpoint' },
          data: expect.objectContaining({
            status: WorkItemChangeSetCheckpointStatus.FAILED,
          }),
        }),
      );
    });

    it('gates publication on the citation checkpoint', () => {
      const { service } = createService();
      const intent = {
        validationRevision: 'revision-1',
        ...prepared(WorkItemChangeSetCheckpointStatus.PENDING),
      };

      expect(() => (service as any).assertCheckpointsComplete(intent)).toThrow(
        'before all checkpoints complete',
      );
    });
  });
});
