import { ConflictException } from '@nestjs/common';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import { ProposalReconciliationService } from '../proposal-reconciliation.service';
import type { ProposalReconciliationBasis } from 'src/generated';

const basis = (
  content: ProposalReconciliationBasis['content'],
  version = 'v1',
): ProposalReconciliationBasis => ({
  entityType: 'TASK',
  entityId: 'target',
  version,
  content,
});

describe('proposal reconciliation owner', () => {
  const service = new ProposalReconciliationService(
    {} as never,
    {} as never,
    jest.fn(),
  );

  it('routes a legacy proposal without original content to Agent fix', () => {
    expect(
      service.merge(null, basis({ name: 'Current' }), { name: 'Proposed' })
        .kind,
    ).toBe('AGENT_FIX_REQUIRED');
  });

  it('does not let a reviewed basis authorize changed content', () => {
    expect(() =>
      service.assertReviewedBasisCurrent(
        [basis({ sections: { description: 'Reviewed' } })],
        [basis({ sections: { description: 'Intervening edit' } })],
      ),
    ).toThrow(ConflictException);
  });

  it('rejects version drift even if the content changed and was restored', () => {
    expect(() =>
      service.assertReviewedBasisCurrent(
        [basis({ name: 'A' })],
        [basis({ name: 'A' }, 'v2')],
      ),
    ).toThrow(ConflictException);
  });

  it('accepts semantically equal content with different property order', () => {
    expect(() =>
      service.assertReviewedBasisCurrent(
        [basis({ a: 1, b: 2 })],
        [basis({ b: 2, a: 1 })],
      ),
    ).not.toThrow();
  });

  it('rejects a missing target and preserves meaningful array order', () => {
    expect(() => service.assertReviewedBasisCurrent([basis({})], [])).toThrow(
      ConflictException,
    );
    expect(() =>
      service.assertReviewedBasisCurrent(
        [basis({ order: [1, 2] })],
        [basis({ order: [2, 1] })],
      ),
    ).toThrow(ConflictException);
  });

  it('never merges content across entity identities', () => {
    expect(() =>
      service.merge(basis({}), { ...basis({}), entityId: 'different' }, {}),
    ).toThrow(ConflictException);
  });
  it('appends a new record with the exact supplied basis and predecessor', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'new-revision' });
    const tx = {
      proposalReconciliationRevision: { create },
    } as unknown as AnyTransactionClient;
    const revision = {
      proposalId: 'proposal',
      previousRevisionId: 'original-revision',
      source: 'MERGE' as const,
      bases: [basis({ name: 'Intervening content' }, 'v2')],
      proposedResult: { name: 'Merged candidate' },
      intent: 'Preserve intervening work while renaming',
    };
    expect(await service.appendRevision(tx, revision)).toBe('new-revision');
    expect(create).toHaveBeenCalledWith({
      data: revision,
      select: { id: true },
    });
    // There is no update call, baseline refresh, vote, or application in candidate persistence.
    expect(Object.keys(tx.proposalReconciliationRevision)).toEqual(['create']);
  });
});
