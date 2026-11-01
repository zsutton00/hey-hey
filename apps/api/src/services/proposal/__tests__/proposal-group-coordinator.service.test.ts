import { ConflictException, HttpException } from '@nestjs/common';
import type { PrismaService } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId } from 'src/types';
import type { ProposalApprovalService } from '../proposal-approval.service';
import type { ProposalGroupLifecycleEventService } from '../proposal-group-lifecycle-event.service';
import {
  ProposalGroupCoordinatorService,
  type ProposalGroupMemberClaim,
} from '../proposal-group-coordinator.service';

jest.mock('../proposal-approval.service', () => ({
  ProposalApprovalService: class ProposalApprovalService {},
}));

const organizationId = '123e4567-e89b-42d3-a456-426614174101' as OrganizationId;
const projectId = '123e4567-e89b-42d3-a456-426614174102' as ProjectId;

function claim(
  overrides: Partial<ProposalGroupMemberClaim> = {},
): ProposalGroupMemberClaim {
  return {
    id: '123e4567-e89b-42d3-a456-426614174103',
    groupId: '123e4567-e89b-42d3-a456-426614174104',
    proposalId: '123e4567-e89b-42d3-a456-426614174105',
    organizationId,
    projectId,
    priorExecutionState: 'READY',
    attemptId: '123e4567-e89b-42d3-a456-426614174106',
    attemptCount: 1,
    claimToken: '123e4567-e89b-42d3-a456-426614174107',
    leaseExpiresAt: new Date('2026-07-24T01:05:00.000Z'),
    reservedTargetEntityId: '123e4567-e89b-42d3-a456-426614174108',
    ...overrides,
  };
}

function sqlText(query: unknown): string {
  const sql = query as { sql?: string; text?: string };
  return sql.sql ?? sql.text ?? String(query);
}

describe('ProposalGroupCoordinatorService', () => {
  let db: {
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
    proposalGroupMember: {
      findFirst: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
    proposalGroup: { updateMany: jest.Mock };
  };
  let enactGroupedMember: jest.Mock;
  let publishInTransaction: jest.Mock;
  let service: ProposalGroupCoordinatorService;

  beforeEach(() => {
    db = {
      $queryRaw: jest.fn(),
      $transaction: jest.fn(),
      proposalGroupMember: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn(),
      },
      proposalGroup: { updateMany: jest.fn() },
    };
    db.$transaction.mockImplementation(
      async (callback: (tx: typeof db) => unknown) => callback(db),
    );
    enactGroupedMember = jest.fn().mockResolvedValue({ enacted: true });
    publishInTransaction = jest.fn();
    service = new ProposalGroupCoordinatorService(
      { db } as unknown as PrismaService,
      { enactGroupedMember } as unknown as ProposalApprovalService,
      { publishInTransaction } as unknown as ProposalGroupLifecycleEventService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('claims only the exact READY member selected by a committed transition', async () => {
    const selected = claim();
    db.$queryRaw.mockResolvedValue([selected]);
    jest.spyOn(service, 'executeClaim').mockResolvedValue();

    await service.dispatchReadyMembers({
      memberIds: [selected.id],
      organizationId,
      projectId,
    });

    const query = sqlText(db.$queryRaw.mock.calls[0][0]);
    expect(query).toContain('member."id" =');
    expect(query).toContain('member."execution_state" = \'READY\'');
    expect(query).toContain('FOR UPDATE OF member SKIP LOCKED');
    expect(query).toContain('"claim_token" = gen_random_uuid()::text');
    expect(query).not.toContain('next_attempt_at');
  });

  it('does not substitute another READY member when the selected member is gone', async () => {
    db.$queryRaw.mockResolvedValue([]);
    const execute = jest.spyOn(service, 'executeClaim');

    await service.dispatchReadyMembers({
      memberIds: ['selected-member'],
      organizationId,
      projectId,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(sqlText(db.$queryRaw.mock.calls[0][0])).toContain('member."id" =');
  });

  it('claims and executes only the selected failed member for explicit retry', async () => {
    const selected = claim({ priorExecutionState: 'RETRYABLE_FAILURE' });
    db.$queryRaw.mockResolvedValue([selected]);
    const execute = jest.spyOn(service, 'executeClaim').mockResolvedValue();

    await service.retrySelectedMember({
      memberId: selected.id,
      organizationId,
      projectId,
    });

    const query = sqlText(db.$queryRaw.mock.calls[0][0]);
    expect(query).toContain('WHERE member."id" =');
    expect(query).toContain('member."execution_state" = \'RETRYABLE_FAILURE\'');
    expect(query).toContain('member."execution_state" = \'APPLYING\'');
    expect(execute).toHaveBeenCalledWith(selected);
  });

  it('preserves attempt identity when explicitly retrying an expired APPLYING member', async () => {
    const expired = claim({
      priorExecutionState: 'APPLYING',
      attemptId: '123e4567-e89b-42d3-a456-426614174109',
      attemptCount: 3,
    });
    db.$queryRaw.mockResolvedValue([expired]);
    jest.spyOn(service, 'executeClaim').mockResolvedValue();

    await service.retrySelectedMember({
      memberId: expired.id,
      organizationId,
      projectId,
    });

    const query = sqlText(db.$queryRaw.mock.calls[0][0]);
    expect(query).toContain(
      'WHEN candidate."priorExecutionState" = \'APPLYING\'',
    );
    expect(query).toContain('THEN member."attempt_id"');
    expect(query).toContain('THEN member."attempt_count"');
  });

  it('rejects explicit retry unless the selected member is failed or expired', async () => {
    db.$queryRaw.mockResolvedValue([]);

    await expect(
      service.retrySelectedMember({
        memberId: 'selected-member',
        organizationId,
        projectId,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('stops before enactment when the claim fence is lost', async () => {
    db.proposalGroupMember.findFirst.mockResolvedValue(currentClaimRecord());
    db.proposalGroupMember.updateMany.mockResolvedValueOnce({ count: 0 });

    await service.executeClaim(claim());

    expect(enactGroupedMember).not.toHaveBeenCalled();
  });

  it('records APPLIED only after graph-aware enactment has completed', async () => {
    let completeEnactment: (() => void) | undefined;
    const enactment = new Promise<{ enacted: true }>((resolve) => {
      completeEnactment = () => resolve({ enacted: true });
    });
    db.proposalGroupMember.findFirst.mockResolvedValue(currentClaimRecord());
    db.proposalGroupMember.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    db.$queryRaw.mockResolvedValue([]);
    db.proposalGroupMember.count.mockResolvedValue(1);
    enactGroupedMember.mockReturnValue(enactment);

    const execution = service.executeClaim(claim());
    await Promise.resolve();
    await Promise.resolve();
    expect(db.proposalGroupMember.updateMany).toHaveBeenCalledTimes(1);

    completeEnactment?.();
    await execution;

    expect(db.proposalGroupMember.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ executionState: 'APPLIED' }),
      }),
    );
  });

  it('returns a contended grouped member to READY without recording failure', async () => {
    db.proposalGroupMember.findFirst.mockResolvedValue(currentClaimRecord());
    db.proposalGroupMember.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    enactGroupedMember.mockResolvedValue({ enacted: false });

    await service.executeClaim(claim());

    expect(db.proposalGroupMember.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: {
          executionState: 'READY',
          lastError: null,
          claimToken: null,
          leaseExpiresAt: null,
        },
      }),
    );
    expect(db.proposalGroupMember.count).not.toHaveBeenCalled();
  });

  it('preserves the original reconciliation conflict for grouped enactment', async () => {
    db.proposalGroupMember.findFirst.mockResolvedValue(currentClaimRecord());
    db.proposalGroupMember.updateMany.mockResolvedValue({ count: 1 });
    const conflict = new ConflictException({
      message: 'Changed after review',
      issues: [
        {
          field: 'sections.description',
          code: 'PROPOSAL_RECONCILIATION_REQUIRED',
          reason: 'Content changed',
          layer: 'referential',
        },
      ],
      correlationId: 'conflict-correlation',
    });
    enactGroupedMember.mockRejectedValue(conflict);
    db.$queryRaw.mockResolvedValue([]);
    db.proposalGroupMember.count.mockResolvedValue(1);
    await expect(service.executeClaim(claim())).rejects.toBe(conflict);
  });

  it('records recoverable failure without due-at scheduling', async () => {
    db.proposalGroupMember.findFirst.mockResolvedValue(currentClaimRecord());
    db.proposalGroupMember.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    enactGroupedMember.mockRejectedValue(new Error('temporary outage'));

    await expect(
      service.executeClaim(claim({ attemptCount: 2 })),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: 'temporary outage',
        diagnostic: expect.objectContaining({
          issues: [],
          issueCount: 0,
          truncated: false,
          correlationId: expect.any(String),
        }),
      }),
    });

    const retry = db.proposalGroupMember.updateMany.mock.calls[1][0];
    const persistedFailure = JSON.parse(retry.data.lastError);
    expect(persistedFailure).toEqual({
      message: 'temporary outage',
      diagnostic: {
        issues: [],
        issueCount: 0,
        truncated: false,
        correlationId: expect.any(String),
      },
    });
    expect(retry.data).toEqual(
      expect.objectContaining({
        executionState: 'RETRYABLE_FAILURE',
        claimToken: null,
        leaseExpiresAt: null,
      }),
    );
    expect(retry.data).not.toHaveProperty('nextAttemptAt');
  });

  it('dispatches only members made READY by prerequisite release', async () => {
    db.proposalGroupMember.findFirst.mockResolvedValue(currentClaimRecord());
    db.proposalGroupMember.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    db.$queryRaw.mockResolvedValueOnce([{ id: 'now-ready' }]);
    db.proposalGroupMember.count.mockResolvedValue(2);
    enactGroupedMember.mockResolvedValue({ enacted: true });
    const dispatch = jest
      .spyOn(service, 'dispatchReadyMembers')
      .mockResolvedValue();

    await service.executeClaim(claim());

    expect(dispatch).toHaveBeenCalledWith({
      memberIds: ['now-ready'],
      organizationId,
      projectId,
    });
  });

  it('marks deterministic failures terminal and invalidates only downstream work', async () => {
    db.proposalGroupMember.findFirst.mockResolvedValue(currentClaimRecord());
    db.proposalGroupMember.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    db.$queryRaw
      .mockResolvedValueOnce([{ id: 'dependent-member' }])
      .mockResolvedValueOnce([]);
    db.proposalGroupMember.count.mockResolvedValue(1);
    enactGroupedMember.mockRejectedValue(
      new ConflictException('reserved identity conflict'),
    );

    await expect(service.executeClaim(claim())).rejects.toBeInstanceOf(
      HttpException,
    );

    expect(db.proposalGroupMember.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          executionState: 'FAILED',
          terminalReason: 'PERMANENT_ENACTMENT_FAILURE',
        }),
      }),
    );
    expect(publishInTransaction).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        changedMemberIds: [claim().id, 'dependent-member'],
      }),
    );
  });

  it('propagates terminal impossibility and settles a fully terminal group', async () => {
    db.proposalGroupMember.findFirst.mockResolvedValue({
      id: 'rejected-source',
      groupId: 'group-id',
      executionState: 'REJECTED',
      group: { revision: 4 },
    });
    db.$queryRaw
      .mockResolvedValueOnce([{ id: 'child' }])
      .mockResolvedValueOnce([]);
    db.proposalGroupMember.count.mockResolvedValue(0);
    db.proposalGroup.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.propagateTerminalImpossibility({
        sourceMemberId: 'rejected-source',
        organizationId,
        projectId,
      }),
    ).resolves.toBe(1);

    expect(db.proposalGroup.updateMany).toHaveBeenCalledWith({
      where: { id: 'group-id', status: 'REVIEWABLE' },
      data: { status: 'SETTLED', settledAt: expect.any(Date) },
    });
    expect(publishInTransaction).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        groupId: 'group-id',
        revision: 4,
        changedMemberIds: ['rejected-source', 'child'],
      }),
    );
  });

  function currentClaimRecord() {
    return {
      id: claim().id,
      groupId: claim().groupId,
      executionState: 'APPLYING',
      attemptId: claim().attemptId,
      claimToken: claim().claimToken,
      approvalSatisfiedAt: new Date('2026-07-24T00:00:00.000Z'),
      group: { status: 'REVIEWABLE', revision: 4 },
      dependenciesAsDependent: [],
    };
  }
});
