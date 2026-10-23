import {
  assertProposalEdgeTargetsResolvable,
  loadProposalReferenceMetadata,
  resolveEntityTitle,
  resolveProposalTitle,
  snapshotEdgeTitles,
  snapshotInfluenceReferences,
} from '../proposal-title-snapshot';
import type {
  DesignDocMetadataRow,
  ProposalMetadataRow,
  RegistryRow,
  TaskMetadataRow,
} from '../proposal-title-snapshot';
import { OrganizationId, ProjectId } from '../../../types';

const organizationId = '11111111-1111-1111-1111-111111111111' as OrganizationId;
const projectId = '11111111-1111-4111-8111-111111111112' as ProjectId;
const taskAId = '22222222-2222-2222-2222-222222222222';
const taskBId = '33333333-3333-3333-3333-333333333333';
const designDocId = '44444444-4444-4444-4444-444444444444';
const proposalId = '55555555-5555-5555-5555-555555555555';
const userAId = '66666666-6666-6666-6666-666666666666';
const userBId = '77777777-7777-7777-7777-777777777777';

function makeDb(
  registryRows: unknown[],
  userRows: Array<{ id: string; name: string }> = [],
  taskRows: Array<{ id: string; type: string }> = [],
  designDocRows: Array<{ id: string; projectId: string | null }> = [],
  proposalRows: Array<{ id: string }> = [],
) {
  return {
    entityRegistry: {
      findMany: jest.fn().mockResolvedValue(registryRows),
    },
    user: {
      findMany: jest.fn().mockResolvedValue(userRows),
    },
    task: {
      findMany: jest.fn().mockResolvedValue(taskRows),
    },
    designDoc: {
      findMany: jest.fn().mockResolvedValue(designDocRows),
    },
    proposal: {
      findMany: jest.fn().mockResolvedValue(proposalRows),
    },
  } as any;
}

function makeMetadata(overrides: {
  registryRows?: RegistryRow[];
  taskRows?: TaskMetadataRow[];
  designDocRows?: DesignDocMetadataRow[];
  proposalRows?: ProposalMetadataRow[];
}) {
  const registryRows = overrides.registryRows ?? [];
  return {
    registryRows: new Map(
      registryRows.map((row) => [`${row.entityId}:${row.entityType}`, row]),
    ),
    registryRowsByEntityId: new Map(
      registryRows.map((row) => [row.entityId, [row]]),
    ),
    taskRows: new Map((overrides.taskRows ?? []).map((row) => [row.id, row])),
    designDocRows: new Map(
      (overrides.designDocRows ?? []).map((row) => [row.id, row]),
    ),
    proposalRows: new Map(
      (overrides.proposalRows ?? []).map((row) => [row.id, row]),
    ),
    userNames: new Map(),
  };
}

describe('snapshotInfluenceReferences', () => {
  it('returns the input unchanged when there are no influences', async () => {
    const db = makeDb([]);
    expect(
      await snapshotInfluenceReferences(db, organizationId, undefined),
    ).toBeUndefined();
    expect(await snapshotInfluenceReferences(db, organizationId, [])).toEqual(
      [],
    );
    expect(db.entityRegistry.findMany).not.toHaveBeenCalled();
  });

  it('preserves caller-supplied entityTitle and only resolves missing rows', async () => {
    const db = makeDb([
      {
        entityId: taskBId,
        entityType: 'TASK',
        entityName: 'Looked-up task title',
        deletedAt: null,
      },
    ]);

    const result = await snapshotInfluenceReferences(db, organizationId, [
      {
        entityId: taskAId,
        entityType: 'TASK',
        entityTitle: 'Caller-supplied title',
        reasoning: 'a',
        reasonType: 'explicit_mention',
      },
      {
        entityId: taskBId,
        entityType: 'TASK',
        reasoning: 'b',
        reasonType: 'derived',
      },
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        entityId: taskAId,
        entityTitle: 'Caller-supplied title',
      }),
      expect.objectContaining({
        entityId: taskBId,
        entityTitle: 'Looked-up task title',
      }),
    ]);

    const [call] = db.entityRegistry.findMany.mock.calls;
    expect(call[0].where.entityId).toEqual({ in: [taskBId] });
    expect(call[0].where.organizationId).toBe(organizationId);
  });

  it('writes null when the registry has no row for the target', async () => {
    const db = makeDb([]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await snapshotInfluenceReferences(db, organizationId, [
      {
        entityId: taskAId,
        entityType: 'TASK',
        reasoning: 'missing',
        reasonType: 'implied',
      },
    ]);

    expect(result![0]!.entityTitle).toBeNull();
    warn.mockRestore();
  });

  it('loads a TASK title and subtype through one coordinated metadata pass', async () => {
    const db = makeDb(
      [
        {
          entityId: taskAId,
          entityType: 'TASK',
          entityName: 'One task',
          deletedAt: null,
        },
      ],
      [],
      [{ id: taskAId, type: 'BUG' }],
    );

    const result = await snapshotInfluenceReferences(db, organizationId, [
      {
        entityId: taskAId,
        entityType: 'TASK',
        reasoning: 'one reference',
        reasonType: 'explicit_mention',
      },
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        entityTitle: 'One task',
        taskType: 'BUG',
      }),
    ]);
    expect(db.entityRegistry.findMany).toHaveBeenCalledTimes(1);
    expect(db.task.findMany).toHaveBeenCalledTimes(1);
  });

  it('resolves USER influences against the user table (skipping the entity registry)', async () => {
    const db = makeDb(
      [],
      [
        { id: userAId, name: 'Ada Lovelace' },
        { id: userBId, name: 'Grace Hopper' },
      ],
    );

    const result = await snapshotInfluenceReferences(db, organizationId, [
      {
        entityId: userAId,
        entityType: 'USER',
        reasoning: 'edited the task',
        reasonType: 'user_reason',
      },
      {
        entityId: userBId,
        entityType: 'USER',
        reasoning: '',
        reasonType: 'user_reason',
      },
    ]);

    expect(result![0]!.entityTitle).toBe('Ada Lovelace');
    expect(result![1]!.entityTitle).toBe('Grace Hopper');
    expect(db.user.findMany).toHaveBeenCalledTimes(1);
    expect(db.entityRegistry.findMany).not.toHaveBeenCalled();
  });

  it('writes null for a USER influence whose user has been hard-deleted', async () => {
    const db = makeDb([], []);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await snapshotInfluenceReferences(db, organizationId, [
      {
        entityId: userAId,
        entityType: 'USER',
        reasoning: 'orphaned',
        reasonType: 'user_reason',
      },
    ]);

    expect(result![0]!.entityTitle).toBeNull();
    warn.mockRestore();
  });

  it('treats soft-deleted registry rows as missing', async () => {
    const db = makeDb([
      {
        entityId: taskAId,
        entityType: 'TASK',
        entityName: 'Was once here',
        deletedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);

    const result = await snapshotInfluenceReferences(db, organizationId, [
      {
        entityId: taskAId,
        entityType: 'TASK',
        reasoning: 'gone',
        reasonType: 'derived',
      },
    ]);

    expect(result![0]!.entityTitle).toBeNull();
  });

  it('snapshots built-in and project-defined task types without changing non-TASK influences', async () => {
    const db = makeDb(
      [
        {
          entityId: taskAId,
          entityType: 'TASK',
          entityName: 'Bug task',
          deletedAt: null,
        },
        {
          entityId: taskBId,
          entityType: 'TASK',
          entityName: 'Custom task',
          deletedAt: null,
        },
        {
          entityId: designDocId,
          entityType: 'DESIGN_DOC',
          entityName: 'Design doc',
          deletedAt: null,
        },
      ],
      [],
      [
        { id: taskAId, type: 'BUG' },
        { id: taskBId, type: 'customer_request' },
      ],
    );

    const result = await snapshotInfluenceReferences(db, organizationId, [
      {
        entityId: taskAId,
        entityType: 'TASK',
        reasoning: 'built-in',
        reasonType: 'explicit_mention',
      },
      {
        entityId: taskBId,
        entityType: 'TASK',
        reasoning: 'custom',
        reasonType: 'derived',
      },
      {
        entityId: designDocId,
        entityType: 'DESIGN_DOC',
        reasoning: 'not a task',
        reasonType: 'implied',
      },
    ]);

    expect(result).toEqual([
      expect.objectContaining({ entityId: taskAId, taskType: 'BUG' }),
      expect.objectContaining({
        entityId: taskBId,
        taskType: 'customer_request',
      }),
      expect.not.objectContaining({ taskType: expect.anything() }),
    ]);
    expect(db.task.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: [taskAId, taskBId] },
        organizationId,
        archivedAt: null,
      },
      select: { id: true, type: true, projectId: true },
    });
  });

  it('preserves supplied taskType and leaves unresolved legacy values absent', async () => {
    const db = makeDb(
      [
        {
          entityId: taskAId,
          entityType: 'TASK',
          entityName: 'Known task',
          deletedAt: null,
        },
        {
          entityId: taskBId,
          entityType: 'TASK',
          entityName: 'Legacy task',
          deletedAt: null,
        },
      ],
      [],
      [{ id: taskAId, type: 'STANDARD' }],
    );

    const result = await snapshotInfluenceReferences(db, organizationId, [
      {
        entityId: taskAId,
        entityType: 'TASK',
        taskType: 'project_defined',
        reasoning: 'already snapshotted',
        reasonType: 'explicit_mention',
      },
      {
        entityId: taskBId,
        entityType: 'TASK',
        reasoning: 'legacy gap',
        reasonType: 'derived',
      },
    ]);

    expect(result![0]!.taskType).toBe('project_defined');
    expect(result![1]).not.toHaveProperty('taskType');
    expect(db.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: [taskBId] } }),
      }),
    );
  });
});

describe('snapshotEdgeTitles', () => {
  it('snapshots durable proposal titles without substituting entity endpoints', async () => {
    const edge = {
      endpointMode: 'PROPOSAL' as const,
      targetEntityType: 'PROPOSAL' as const,
      targetEntityId: proposalId,
      edgeType: 'EVOLVES' as const,
    };
    const metadata = makeMetadata({
      proposalRows: [
        {
          id: proposalId,
          title: 'Reviewable proposal',
          action: 'CREATE',
          status: 'DRAFT',
          targetEntityType: 'TASK',
          updates: { type: 'FEATURE' },
        },
      ],
    });
    const result = await snapshotEdgeTitles(
      makeDb([]),
      organizationId,
      [edge],
      metadata,
    );
    expect(result).toEqual([
      { ...edge, targetEntityTitle: 'Reviewable proposal' },
    ]);
  });

  it('preserves a deferred Diagram Element source and title semantics for a Proposal target', async () => {
    const edge = {
      sourceRef: { refType: 'temporary' as const, tempId: 'element-a' },
      targetEntityType: 'PROPOSAL' as const,
      targetEntityId: proposalId,
      edgeType: 'RELATED_TO' as const,
    };
    const metadata = makeMetadata({
      proposalRows: [
        {
          id: proposalId,
          title: 'Target',
          action: 'CREATE',
          status: 'DRAFT',
          targetEntityType: 'TASK',
          updates: { type: 'FEATURE' },
        },
      ],
    });

    expect(
      await snapshotEdgeTitles(makeDb([]), organizationId, [edge], metadata),
    ).toEqual([{ ...edge, targetEntityTitle: null }]);
  });

  it('skips the registry lookup for PROPOSAL targets and stamps null', async () => {
    const db = makeDb([]);

    const result = await snapshotEdgeTitles(db, organizationId, [
      {
        targetEntityId: proposalId,
        targetEntityType: 'PROPOSAL' as any,
        edgeType: 'RELATED_TO' as any,
      },
    ]);

    expect(result![0]!.targetEntityTitle).toBeNull();
    expect(db.entityRegistry.findMany).not.toHaveBeenCalled();
  });

  it('resolves titles for TASK and DESIGN_DOC targets', async () => {
    const db = makeDb([
      {
        entityId: taskAId,
        entityType: 'TASK',
        entityName: 'A task',
        deletedAt: null,
      },
      {
        entityId: designDocId,
        entityType: 'DESIGN_DOC',
        entityName: 'A design doc',
        deletedAt: null,
      },
    ]);

    const result = await snapshotEdgeTitles(db, organizationId, [
      {
        targetEntityId: taskAId,
        targetEntityType: 'TASK' as any,
        edgeType: 'DEPENDS_ON' as any,
      },
      {
        targetEntityId: designDocId,
        targetEntityType: 'DESIGN_DOC' as any,
        edgeType: 'RELATED_TO' as any,
      },
    ]);

    expect(result![0]!.targetEntityTitle).toBe('A task');
    expect(result![1]!.targetEntityTitle).toBe('A design doc');
  });

  it('preserves caller-supplied targetEntityTitle', async () => {
    const db = makeDb([]);

    const result = await snapshotEdgeTitles(db, organizationId, [
      {
        targetEntityId: taskAId,
        targetEntityType: 'TASK' as any,
        targetEntityTitle: 'Caller knew',
        edgeType: 'DEPENDS_ON' as any,
      },
    ]);

    expect(result![0]!.targetEntityTitle).toBe('Caller knew');
    expect(db.entityRegistry.findMany).not.toHaveBeenCalled();
  });
});

describe('proposal edge endpoint resolution', () => {
  it('loads endpoint identity even when the caller supplied a title', async () => {
    const db = makeDb(
      [
        {
          entityId: taskAId,
          entityType: 'TASK',
          entityName: 'Live task',
          deletedAt: null,
        },
      ],
      [],
      [{ id: taskAId, type: 'BUG' }],
    );

    const metadata = await loadProposalReferenceMetadata(
      db,
      organizationId,
      [
        {
          entityId: taskAId,
          entityType: 'TASK',
          needsExistence: true,
          needsTitle: false,
        },
      ],
      projectId,
    );

    expect(metadata.registryRows.get(`${taskAId}:TASK`)).toEqual(
      expect.objectContaining({ entityId: taskAId }),
    );
    expect(metadata.taskRows.get(taskAId)).toEqual(
      expect.objectContaining({ id: taskAId, type: 'BUG' }),
    );
    expect(db.entityRegistry.findMany).toHaveBeenCalledTimes(1);
    expect(db.task.findMany).toHaveBeenCalledTimes(1);
  });

  it('reports missing, deleted, wrong-type, and out-of-scope endpoints at their indexed fields', () => {
    const metadata = makeMetadata({
      registryRows: [
        {
          entityId: taskAId,
          entityType: 'DESIGN_DOC' as any,
          entityName: 'Wrong type',
          deletedAt: null,
        },
        {
          entityId: designDocId,
          entityType: 'DESIGN_DOC' as any,
          entityName: 'Deleted doc',
          deletedAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          entityId: taskBId,
          entityType: 'TASK' as any,
          entityName: 'Other project task',
          deletedAt: null,
        },
      ],
      taskRows: [{ id: taskBId, type: 'STANDARD', projectId: 'other-project' }],
    });

    expect(() =>
      assertProposalEdgeTargetsResolvable(
        [
          {
            targetEntityId: taskAId,
            targetEntityType: 'TASK' as any,
            targetEntityTitle: 'Caller title',
            edgeType: 'RELATED_TO' as any,
          },
          {
            targetEntityId: designDocId,
            targetEntityType: 'DESIGN_DOC' as any,
            edgeType: 'RELATED_TO' as any,
          },
          {
            targetEntityId: taskBId,
            targetEntityType: 'TASK' as any,
            edgeType: 'RELATED_TO' as any,
          },
          {
            targetEntityId: proposalId,
            targetEntityType: 'PROPOSAL' as any,
            edgeType: 'RELATED_TO' as any,
          },
        ],
        metadata,
        projectId,
      ),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          errors: [
            expect.objectContaining({
              field: 'edges[0].targetEntityType',
              code: 'unresolved_reference',
              layer: 'referential',
            }),
            expect.objectContaining({ field: 'edges[1].targetEntityId' }),
            expect.objectContaining({ field: 'edges[2].targetEntityId' }),
            expect.objectContaining({ field: 'edges[3].targetEntityId' }),
          ],
        }),
      }),
    );
  });

  it('accepts a live same-scope proposal target for deferred materialization', () => {
    const metadata = makeMetadata({
      proposalRows: [
        {
          id: proposalId,
          title: 'Target',
          action: 'CREATE',
          status: 'DRAFT',
          targetEntityType: 'TASK',
          updates: { type: 'FEATURE' },
        },
      ],
    });

    expect(() =>
      assertProposalEdgeTargetsResolvable(
        [
          {
            targetEntityId: proposalId,
            targetEntityType: 'PROPOSAL' as any,
            edgeType: 'DEPENDS_ON' as any,
          },
        ],
        metadata,
        projectId,
      ),
    ).not.toThrow();
  });

  it('accepts an active organization-scoped design doc from another project', () => {
    const metadata = makeMetadata({
      registryRows: [
        {
          entityId: designDocId,
          entityType: 'DESIGN_DOC' as any,
          entityName: 'Shared design doc',
          deletedAt: null,
        },
      ],
      designDocRows: [{ id: designDocId, projectId: 'another-project' }],
    });

    expect(() =>
      assertProposalEdgeTargetsResolvable(
        [
          {
            targetEntityId: designDocId,
            targetEntityType: 'DESIGN_DOC' as any,
            edgeType: 'RELATED_TO' as any,
          },
        ],
        metadata,
        projectId,
      ),
    ).not.toThrow();
  });
});

describe('resolveEntityTitle', () => {
  it('returns the registry name when present', async () => {
    const db = makeDb([
      {
        entityId: taskAId,
        entityType: 'TASK',
        entityName: 'Hello',
        deletedAt: null,
      },
    ]);

    expect(await resolveEntityTitle(db, organizationId, taskAId, 'TASK')).toBe(
      'Hello',
    );
  });

  it('returns null for an unsupported entity type', async () => {
    const db = makeDb([]);
    expect(
      await resolveEntityTitle(db, organizationId, taskAId, 'PROPOSAL'),
    ).toBeNull();
    expect(db.entityRegistry.findMany).not.toHaveBeenCalled();
  });

  it('resolves a USER target against the user table', async () => {
    const db = makeDb([], [{ id: userAId, name: 'Ada Lovelace' }]);
    expect(await resolveEntityTitle(db, organizationId, userAId, 'USER')).toBe(
      'Ada Lovelace',
    );
    expect(db.user.findMany).toHaveBeenCalledTimes(1);
    expect(db.entityRegistry.findMany).not.toHaveBeenCalled();
  });
});

describe('resolveProposalTitle', () => {
  it('returns caller-supplied title for CREATE without touching the registry', async () => {
    const db = makeDb([]);
    const title = await resolveProposalTitle({
      db,
      organizationId,
      action: 'CREATE',
      targetEntityType: 'TASK',
      targetEntityId: taskAId,
      callerTitle: 'A brand-new task',
    });
    expect(title).toBe('A brand-new task');
    expect(db.entityRegistry.findMany).not.toHaveBeenCalled();
  });

  it('returns caller-supplied title for CREATE/PLAN — no per-type peek into updates', async () => {
    const db = makeDb([]);
    const title = await resolveProposalTitle({
      db,
      organizationId,
      action: 'CREATE',
      targetEntityType: 'PLAN',
      targetEntityId: '88888888-8888-8888-8888-888888888888',
      callerTitle: 'A brand-new plan',
    });
    expect(title).toBe('A brand-new plan');
    expect(db.entityRegistry.findMany).not.toHaveBeenCalled();
  });

  it('returns null for CREATE when caller omits the title (service is responsible for rejecting)', async () => {
    const db = makeDb([]);
    const title = await resolveProposalTitle({
      db,
      organizationId,
      action: 'CREATE',
      targetEntityType: 'TASK',
      targetEntityId: taskAId,
      callerTitle: undefined,
    });
    expect(title).toBeNull();
    expect(db.entityRegistry.findMany).not.toHaveBeenCalled();
  });

  it('returns the registry name for UPDATE without a caller-supplied title', async () => {
    const db = makeDb([
      {
        entityId: taskAId,
        entityType: 'TASK',
        entityName: 'Current task name',
        deletedAt: null,
      },
    ]);
    const title = await resolveProposalTitle({
      db,
      organizationId,
      action: 'UPDATE',
      targetEntityType: 'TASK',
      targetEntityId: taskAId,
      callerTitle: undefined,
    });
    expect(title).toBe('Current task name');
  });

  it('returns the registry (prior) name for UPDATE even when the diff would rename the target', async () => {
    // The registry hasn't been renamed yet — the rename only applies on
    // approval — so a registry read pre-apply naturally yields the prior
    // name, which is the snapshot semantic UPDATE wants.
    const db = makeDb([
      {
        entityId: taskAId,
        entityType: 'TASK',
        entityName: 'Prior name',
        deletedAt: null,
      },
    ]);
    const title = await resolveProposalTitle({
      db,
      organizationId,
      action: 'UPDATE',
      targetEntityType: 'TASK',
      targetEntityId: taskAId,
      callerTitle: undefined,
    });
    expect(title).toBe('Prior name');
  });

  it('caller-supplied title wins over registry on UPDATE', async () => {
    const db = makeDb([
      {
        entityId: taskAId,
        entityType: 'TASK',
        entityName: 'Registry-resolved name',
        deletedAt: null,
      },
    ]);
    const title = await resolveProposalTitle({
      db,
      organizationId,
      action: 'UPDATE',
      targetEntityType: 'TASK',
      targetEntityId: taskAId,
      callerTitle: 'Caller-known name',
    });
    expect(title).toBe('Caller-known name');
    expect(db.entityRegistry.findMany).not.toHaveBeenCalled();
  });

  it('returns the registry name for DELETE without a caller-supplied title', async () => {
    const db = makeDb([
      {
        entityId: designDocId,
        entityType: 'DESIGN_DOC',
        entityName: 'About to be deleted',
        deletedAt: null,
      },
    ]);
    const title = await resolveProposalTitle({
      db,
      organizationId,
      action: 'DELETE',
      targetEntityType: 'DESIGN_DOC',
      targetEntityId: designDocId,
      callerTitle: undefined,
    });
    expect(title).toBe('About to be deleted');
  });

  it('returns null and warns when the UPDATE/DELETE target is missing from the registry', async () => {
    const db = makeDb([]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const title = await resolveProposalTitle({
      db,
      organizationId,
      action: 'UPDATE',
      targetEntityType: 'TASK',
      targetEntityId: taskAId,
      callerTitle: undefined,
    });
    expect(title).toBeNull();
    warn.mockRestore();
  });

  it('preserves an explicit null caller-supplied title (does not fall back to registry)', async () => {
    const db = makeDb([
      {
        entityId: taskAId,
        entityType: 'TASK',
        entityName: 'Should not be returned',
        deletedAt: null,
      },
    ]);
    const title = await resolveProposalTitle({
      db,
      organizationId,
      action: 'UPDATE',
      targetEntityType: 'TASK',
      targetEntityId: taskAId,
      callerTitle: null,
    });
    expect(title).toBeNull();
    expect(db.entityRegistry.findMany).not.toHaveBeenCalled();
  });
});
