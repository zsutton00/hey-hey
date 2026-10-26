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

  it('judges work items by content, not timestamp-derived versions', () => {
    expect(() =>
      service.assertReviewedBasisCurrent(
        [basis({ name: 'A' })],
        [basis({ name: 'A' }, 'v2')],
      ),
    ).not.toThrow();
  });

  it('rejects relationship version drift even if the content was restored', () => {
    const edge = (version: string): ProposalReconciliationBasis => ({
      ...basis({ name: 'A' }, version),
      entityType: 'EDGE',
    });
    expect(() =>
      service.assertReviewedBasisCurrent([edge('v1')], [edge('v2')]),
    ).toThrow(ConflictException);
  });

  it('accepts semantically equal content with different property order', () => {
    expect(() =>
      service.assertReviewedBasisCurrent(
        [basis({ sections: { data: { a: 1, b: 2 } } })],
        [basis({ sections: { data: { b: 2, a: 1 } } })],
      ),
    ).not.toThrow();
  });

  it('rejects a missing target and preserves meaningful array order', () => {
    expect(() => service.assertReviewedBasisCurrent([basis({})], [])).toThrow(
      ConflictException,
    );
    expect(() =>
      service.assertReviewedBasisCurrent(
        [basis({ sections: { order: [1, 2] } })],
        [basis({ sections: { order: [2, 1] } })],
      ),
    ).toThrow(ConflictException);
  });

  it('accepts omitted and undefined optional fields recursively after JSON persistence', () => {
    const live = {
      sections: {
        definition: {
          name: 'Mockup',
          iconKey: undefined,
          colorKey: undefined,
          nested: [{ optional: undefined, keep: true }],
        },
      },
    };
    const stored = JSON.parse(JSON.stringify(live));
    expect(() =>
      service.assertReviewedBasisCurrent([basis(stored)], [basis(live)]),
    ).not.toThrow();
    expect(() =>
      service.assertReviewedBasisCurrent([basis(live)], [basis(stored)]),
    ).not.toThrow();
  });

  it.each([
    [{}, { optional: null }],
    [{ optional: null }, {}],
    [{ values: [1] }, { values: [1, 2] }],
    [{ values: [1, 2] }, { values: [2, 1] }],
    [{ name: 'Before' }, { name: 'After' }],
  ])('rejects meaningful definition changes: %j -> %j', (reviewed, current) => {
    expect(() =>
      service.assertReviewedBasisCurrent(
        [basis({ sections: { definition: reviewed } })],
        [basis({ sections: { definition: current } })],
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
