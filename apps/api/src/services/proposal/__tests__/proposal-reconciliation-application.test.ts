import { ConflictException } from '@nestjs/common';
import type { Proposal } from '@prisma/client';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import type { ProposalReconciliationBasis } from 'src/generated';
import { ProposalReconciliationService } from '../proposal-reconciliation.service';
import { projectReconciliationContent } from '../proposal-reconciliation-content';

const original: ProposalReconciliationBasis = {
  entityType: 'TASK',
  entityId: 'target',
  version: 'first',
  content: {
    name: 'Original',
    sections: { description: 'Keep this', notes: 'Notes' },
    sectionOrder: { description: 0, notes: 1 },
  },
};
const proposal = {
  id: 'proposal',
  action: 'UPDATE',
  targetEntityType: 'TASK',
  targetEntityId: 'target',
  updates: { name: 'Renamed' },
  title: 'Rename',
  eli5: null,
  status: 'DRAFT',
  organizationId: 'org',
  projectId: 'project',
  createdAt: new Date('2026-10-01T00:00:00Z'),
} as unknown as Proposal;

function fixture() {
  let current = structuredClone(original);
  const adapter = { task: jest.fn(async () => structuredClone(current)) };
  const revision = {
    id: 'revision',
    proposalId: proposal.id,
    previousRevisionId: null,
    source: 'AUTHORING',
    bases: [structuredClone(original)],
    proposedResult: projectReconciliationContent(
      original.content,
      proposal.updates as object,
    ),
    intent: 'Rename',
    createdAt: new Date(),
  };
  let receipt: {
    basis: ProposalReconciliationBasis;
    operationIndexes: number[];
  } | null = null;
  const intervening: unknown[] = [];
  const db = {
    proposal: {
      findMany: jest.fn(async () => intervening),
      findUnique: jest.fn(async () => null),
    },
    workItemChangeSetMaterialization: { findUnique: jest.fn(async () => null) },
    proposalGroupMember: { findUnique: jest.fn(async () => null) },
    proposalReconciliationRevision: {
      findFirst: jest.fn(async () => revision),
      findMany: jest.fn(async () => [revision]),
      create: jest.fn(async ({ data }) => ({ id: 'new-revision', ...data })),
    },
    proposalReconciliationReplacement: { findFirst: jest.fn(async () => null) },
    proposalApprovalRecord: { deleteMany: jest.fn() },
    proposalReconciliationEffect: {
      findMany: jest.fn(async () =>
        receipt ? [{ ...receipt, entityType: 'TASK', entityId: 'target' }] : [],
      ),
      findUnique: jest.fn(async () => receipt),
      update: jest.fn(),
      upsert: jest.fn(async ({ create, update }) => {
        receipt = receipt
          ? {
              basis: update.basis,
              operationIndexes: [
                ...receipt.operationIndexes,
                update.operationIndexes.push,
              ],
            }
          : create;
      }),
    },
  };
  const tx = db as unknown as AnyTransactionClient;
  const owner = new ProposalReconciliationService(
    adapter as never,
    {} as never,
    jest.fn(),
  );
  return {
    owner,
    tx,
    db,
    revision,
    intervening,
    getCurrent: () => current,
    change: (
      content: ProposalReconciliationBasis['content'],
      version: string,
    ) => {
      current = { ...original, content, version };
    },
  };
}

describe('reviewed reconciliation application', () => {
  it('uses completed-effect receipts for retry classification without refreshing the original revision', async () => {
    const f = fixture();
    f.db.workItemChangeSetMaterialization.findUnique.mockResolvedValue({
      id: 'intent',
      status: 'FAILED',
      operationSet: { operations: [] },
      relationshipIdMappings: {},
    } as never);
    await f.owner.guardTaskEffect(
      f.tx,
      proposal,
      'intent',
      'target',
      0,
      false,
      async () => {
        f.change({ ...original.content, name: 'Renamed' }, 'own-effect');
      },
    );
    expect((await f.owner.state(f.tx, proposal)).status).toBe('CURRENT');
    expect(f.revision.bases).toEqual([original]);
    f.change({ ...f.getCurrent().content, name: 'External edit' }, 'external');
    expect((await f.owner.state(f.tx, proposal)).status).toBe(
      'RECONCILIATION_REQUIRED',
    );
  });

  it('does not make reserved references stale when finalization updates proposal metadata', async () => {
    const f = fixture();
    f.db.proposalGroupMember.findUnique.mockResolvedValue({
      groupId: 'group',
    } as never);
    const creator = {
      proposalId: 'creator',
      executionState: 'PENDING_APPROVAL',
      proposal: {
        createdAt: new Date('2026-09-28T00:00:00Z'),
        updatedAt: new Date('2026-09-28T00:00:00Z'),
        updates: { name: 'Reserved' },
      },
    };
    Object.assign(f.db.proposalGroupMember, {
      findFirst: jest.fn(async () => creator),
    });
    const before = await f.owner.currentBases(f.tx, proposal);
    creator.proposal.updatedAt = new Date('2026-09-28T01:00:00Z');
    expect(await f.owner.currentBases(f.tx, proposal)).toEqual(before);
  });

  it('expands a patch without deleting omitted fields or sections', () => {
    expect(
      projectReconciliationContent(original.content, { name: 'Renamed' }),
    ).toEqual({ ...original.content, name: 'Renamed' });
  });

  it('accepts an unchanged authored proposal and rejects drift irrespective of acknowledgement', async () => {
    const f = fixture();
    await expect(
      f.owner.assertApplicable(f.tx, proposal),
    ).resolves.toBeUndefined();
    f.change({ ...original.content, name: 'Someone else' }, 'second');
    await expect(
      f.owner.assertApplicable(f.tx, {
        ...proposal,
        updates: {
          ...(proposal.updates as object),
          acknowledgeOutOfDate: true,
        },
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('requires Agent fix when the original basis is unavailable', async () => {
    const f = fixture();
    f.db.proposalReconciliationRevision.findFirst.mockResolvedValueOnce(
      null as never,
    );
    await expect(f.owner.assertApplicable(f.tx, proposal)).rejects.toThrow(
      'Original proposal content is unavailable',
    );
  });

  it('binds reconciliation review to the exact candidate while allowing an unchanged application retry', async () => {
    const f = fixture();
    f.revision.source = 'MERGE';
    await expect(
      f.owner.assertApplicable(f.tx, proposal, undefined, true),
    ).rejects.toThrow('identify the reconciled revision');
    await expect(
      f.owner.assertApplicable(f.tx, proposal, 'another', true),
    ).rejects.toThrow('displayed proposal revision');
    await expect(
      f.owner.assertApplicable(f.tx, proposal, 'revision', true),
    ).resolves.toBeUndefined();
    await expect(
      f.owner.assertApplicable(f.tx, proposal),
    ).resolves.toBeUndefined();
  });

  it('preserves intervening work during Merge and rejects further drift after review', async () => {
    const f = fixture();
    f.change(
      {
        ...original.content,
        sections: { description: 'Keep this', notes: 'New notes' },
      },
      'second',
    );
    const state = await f.owner.state(f.tx, proposal);
    expect(state.status).toBe('RECONCILIATION_REQUIRED');
    expect(f.owner.prepareMerge(proposal, state)).toEqual({
      kind: 'MERGED',
      updates: { name: 'Renamed' },
    });
    f.revision.bases = [structuredClone(f.getCurrent())];
    f.revision.source = 'MERGE';
    f.change({ ...f.getCurrent().content, name: 'Changed again' }, 'third');
    await expect(
      f.owner.assertApplicable(f.tx, proposal, 'revision', true),
    ).rejects.toThrow(ConflictException);
  });

  it('retains the original basis on edits and invalidates earlier votes', async () => {
    const f = fixture();
    f.change({ ...original.content, name: 'Intervening' }, 'second');
    await f.owner.captureAuthoring(f.tx, {
      ...proposal,
      updates: { name: 'Edited proposal' },
    });
    expect(f.db.proposalReconciliationRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ bases: [original] }),
      }),
    );
    expect(f.db.proposalApprovalRecord.deleteMany).toHaveBeenCalledWith({
      where: { proposalId: proposal.id },
    });
  });

  it('records its own effect, skips replay, and rejects a later external write', async () => {
    const f = fixture();
    const write = jest.fn(async () => {
      f.change({ ...original.content, name: 'Renamed' }, 'second');
    });
    await f.owner.guardTaskEffect(
      f.tx,
      proposal,
      'materialization',
      'target',
      0,
      false,
      write,
    );
    await f.owner.guardTaskEffect(
      f.tx,
      proposal,
      'materialization',
      'target',
      0,
      false,
      write,
    );
    expect(write).toHaveBeenCalledTimes(1);
    const next = jest.fn(async () => {
      f.change(
        {
          ...f.getCurrent().content,
          sections: { description: 'Own second effect' },
        },
        'third',
      );
    });
    await f.owner.guardTaskEffect(
      f.tx,
      proposal,
      'materialization',
      'target',
      1,
      false,
      next,
    );
    f.change({ ...f.getCurrent().content, name: 'External' }, 'fourth');
    await expect(
      f.owner.guardTaskEffect(
        f.tx,
        proposal,
        'materialization',
        'target',
        2,
        false,
        write,
      ),
    ).rejects.toThrow(ConflictException);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('stays applicable when only the target version moves, e.g. after a child is approved', async () => {
    const f = fixture();
    f.change(structuredClone(original.content), 'child-approved-bump');
    await expect(
      f.owner.assertApplicable(f.tx, proposal),
    ).resolves.toBeUndefined();
    expect((await f.owner.state(f.tx, proposal)).status).toBe('CURRENT');
  });

  it('names the differing fields and sections when content really changed', async () => {
    const f = fixture();
    f.change(
      {
        ...original.content,
        name: 'Someone else',
        sections: { description: 'Rewritten', notes: 'Notes' },
      },
      'second',
    );
    const error = await f.owner
      .assertApplicable(f.tx, proposal)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConflictException);
    const body = (error as ConflictException).getResponse() as {
      issues: { field: string; code: string }[];
      correlationId: string;
    };
    expect(body.issues.map((issue) => issue.field)).toEqual([
      'TASK:target.name',
      'TASK:target.sections.description',
    ]);
    expect(body.issues[0].code).toBe('PROPOSAL_RECONCILIATION_REQUIRED');
    expect(JSON.stringify(body)).not.toContain('Rewritten');
    expect(body.correlationId).toEqual(expect.any(String));
  });

  it('keeps version checks for absent, reserved and relationship bases', () => {
    const owner = fixture().owner;
    const cases: [ProposalReconciliationBasis, ProposalReconciliationBasis][] =
      [
        [
          { ...original, version: 'absent', content: {} },
          { ...original, version: 'first', content: {} },
        ],
        [
          { ...original, version: 'reserved:creator:a', content: {} },
          { ...original, version: 'reserved:creator:b', content: {} },
        ],
        [
          { entityType: 'EDGE', entityId: 'edge', version: 'a', content: {} },
          { entityType: 'EDGE', entityId: 'edge', version: 'b', content: {} },
        ],
      ];
    for (const [reviewed, current] of cases) {
      expect(() =>
        owner.assertReviewedBasisCurrent([reviewed], [current], 'proposal'),
      ).toThrow(ConflictException);
    }
  });

  it('lets a retried effect proceed after a version-only bump and publishes only written tasks', async () => {
    const f = fixture();
    await f.owner.guardTaskEffect(
      f.tx,
      proposal,
      'materialization',
      'target',
      0,
      false,
      async () => {
        f.change({ ...original.content, name: 'Renamed' }, 'second');
      },
    );
    f.change(structuredClone(f.getCurrent().content), 'child-approved-bump');
    const writeMarker = jest.fn(async () => undefined);
    await f.owner.publishTaskEffects(
      f.tx,
      proposal,
      'materialization',
      writeMarker,
    );
    expect(writeMarker).toHaveBeenCalledWith(['target']);
  });
});

describe('out-of-date review state', () => {
  const approvedRow = (
    id: string,
    updates: object,
    approvedAt: string,
  ): unknown => ({
    id,
    title: `Change ${id}`,
    updates,
    updatedAt: new Date(approvedAt),
    approvalRecords: [
      {
        createdAt: new Date(approvedAt),
        user: { id: 'approver', name: 'Zac' },
      },
    ],
    reconciliationRevisions: [],
  });

  it('shows nothing to reconcile on approved or rejected proposals', async () => {
    const f = fixture();
    f.change({ ...original.content, name: 'Elsewhere' }, 'second');
    for (const status of ['APPROVED', 'REJECTED'] as const) {
      const state = await f.owner.state(f.tx, { ...proposal, status });
      expect(state).toEqual({
        status: 'NOT_APPLICABLE',
        currentBases: [],
        revisions: [],
        conflictingPaths: [],
        interveningProposals: [],
        overlaps: [],
      });
    }
    expect(f.db.proposal.findMany).not.toHaveBeenCalled();
  });

  it('lists changes approved since the proposal was written, oldest first, for a clean merge', async () => {
    const f = fixture();
    f.change(
      {
        ...original.content,
        sections: { description: 'Keep this', notes: 'New notes' },
      },
      'second',
    );
    f.intervening.push(
      approvedRow(
        'later',
        { sections: [{ key: 'notes', content: 'New notes' }] },
        '2026-10-03T00:00:00Z',
      ),
      approvedRow('earlier', { status: 'ACTIVE' }, '2026-10-02T00:00:00Z'),
    );
    const state = await f.owner.state(f.tx, proposal);
    expect(state.status).toBe('RECONCILIATION_REQUIRED');
    expect(state.writtenAt).toBe('2026-10-01T00:00:00.000Z');
    expect(state.interveningProposals.map((p) => p.proposalId)).toEqual([
      'earlier',
      'later',
    ]);
    expect(state.interveningProposals[1]).toMatchObject({
      approvedByName: 'Zac',
      changedPaths: ['sections.notes'],
      overlappingPaths: [],
    });
    expect(state.overlaps).toEqual([]);
    expect(f.db.proposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          targetEntityId: 'target',
          status: 'APPROVED',
          id: { notIn: ['proposal', 'proposal'] },
        }),
      }),
    );
  });

  it('flags an overlapping field with both values and attributes it to the intervening change', async () => {
    const f = fixture();
    f.change({ ...original.content, name: 'Renamed elsewhere' }, 'second');
    f.intervening.push(
      approvedRow(
        'rename',
        { name: 'Renamed elsewhere' },
        '2026-10-02T00:00:00Z',
      ),
    );
    const state = await f.owner.state(f.tx, proposal);
    expect(state.overlaps).toEqual([
      {
        path: 'name',
        proposedValue: 'Renamed',
        currentValue: 'Renamed elsewhere',
        interveningProposalId: 'rename',
      },
    ]);
    expect(state.conflictingPaths).toEqual(['name']);
    expect(state.interveningProposals[0]?.overlappingPaths).toEqual(['name']);
  });
});
