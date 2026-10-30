import type { UpdateTaskDto } from 'src/generated';
import { reconciliationPatch } from '../proposal-reconciliation-content';
import { mergeProposalContent } from '../proposal-reconciliation-merge';

describe('proposal reconciliation merge', () => {
  it('preserves intervening changes while reapplying a disjoint change', () => {
    expect(
      mergeProposalContent(
        { name: 'Before', sections: { description: 'Original' } },
        { name: 'Before', sections: { description: 'Intervening work' } },
        { name: 'After', sections: { description: 'Original' } },
      ),
    ).toEqual({
      kind: 'MERGED',
      candidate: {
        name: 'After',
        sections: { description: 'Intervening work' },
      },
    });
  });

  it('combines compatible edits to different paragraphs of the same field', () => {
    expect(
      mergeProposalContent(
        { sections: { description: 'First paragraph.\n\nSecond paragraph.' } },
        {
          sections: {
            description: 'Changed first paragraph.\n\nSecond paragraph.',
          },
        },
        {
          sections: {
            description: 'First paragraph.\n\nChanged second paragraph.',
          },
        },
        new Set(['/sections/description']),
      ),
    ).toEqual({
      kind: 'MERGED',
      candidate: {
        sections: {
          description: 'Changed first paragraph.\n\nChanged second paragraph.',
        },
      },
    });
  });
  it('compares structured content independently of object key order', () => {
    expect(
      mergeProposalContent({ a: 1, b: 2 }, { b: 2, a: 1 }, { a: 3, b: 2 }),
    ).toEqual({ kind: 'MERGED', candidate: { a: 3, b: 2 } });
  });

  it('merges clearly separated text edits', () => {
    expect(
      mergeProposalContent(
        'alpha middle omega',
        'ALPHA middle omega',
        'alpha middle OMEGA',
        new Set(['']),
      ),
    ).toEqual({ kind: 'MERGED', candidate: 'ALPHA middle OMEGA' });
  });

  it.each([
    ['abc', 'aXbc', 'aYbc'],
    ['abc', 'axc', 'ayc'],
    ['abcd', 'aXcd', 'abYd'],
  ])(
    'routes overlapping or touching text edits to Agent fix',
    (baseline, current, proposed) => {
      expect(mergeProposalContent(baseline, current, proposed).kind).toBe(
        'AGENT_FIX_REQUIRED',
      );
    },
  );

  it('does not infer array reordering intent', () => {
    expect(mergeProposalContent([1, 2], [2, 1], [1, 2, 3])).toEqual({
      kind: 'AGENT_FIX_REQUIRED',
      conflictingPaths: [''],
    });
  });

  it('distinguishes removed properties from explicit null', () => {
    expect(
      mergeProposalContent({ a: 1, b: 2 }, { a: 1, b: 3 }, { a: null, b: 2 }),
    ).toEqual({ kind: 'MERGED', candidate: { a: null, b: 3 } });
    expect(
      mergeProposalContent({ a: 1, b: 2 }, { a: 1, b: 3 }, { b: 2 }),
    ).toEqual({ kind: 'MERGED', candidate: { b: 3 } });
  });

  it('requires Agent fix for deletion versus intervening modification', () => {
    expect(
      mergeProposalContent({ section: 'old' }, { section: 'new' }, {}),
    ).toEqual({ kind: 'AGENT_FIX_REQUIRED', conflictingPaths: ['/section'] });
  });

  it('accepts identical concurrent results without duplicating edits', () => {
    expect(mergeProposalContent('old', 'new', 'new')).toEqual({
      kind: 'MERGED',
      candidate: 'new',
    });
  });
  it('does not splice identifiers or other scalar strings without adapter text semantics', () => {
    expect(
      mergeProposalContent(
        'alpha middle omega',
        'ALPHA middle omega',
        'alpha middle OMEGA',
      ).kind,
    ).toBe('AGENT_FIX_REQUIRED');
  });

  it('only applies text merging to paths identified by the owning adapter', () => {
    expect(
      mergeProposalContent(
        { body: 'alpha middle omega' },
        { body: 'ALPHA middle omega' },
        { body: 'alpha middle OMEGA' },
        new Set(['/body']),
      ),
    ).toEqual({ kind: 'MERGED', candidate: { body: 'ALPHA middle OMEGA' } });
  });

  it('keeps prototype-named JSON fields as ordinary own properties', () => {
    const baseline = JSON.parse('{"__proto__":{"value":1},"constructor":1}');
    const current = JSON.parse('{"__proto__":{"value":2},"constructor":1}');
    const proposed = JSON.parse('{"__proto__":{"value":1},"constructor":2}');
    const result = mergeProposalContent(baseline, current, proposed);
    expect(result).toEqual({
      kind: 'MERGED',
      candidate: JSON.parse('{"__proto__":{"value":2},"constructor":2}'),
    });
  });
});

describe('requirement identity merges', () => {
  const requirement = (id: string, statement = id) => ({
    id,
    statement,
    designedBy: [],
    fulfilledBy: [],
    contracts: [],
  });
  const content = (...records: ReturnType<typeof requirement>[]) => ({
    sections: { requirements: { records } },
  });
  const a = requirement('a');
  const b = requirement('b');
  it('merges independent edits and positions additions after their surviving predecessor', () => {
    expect(
      mergeProposalContent(
        content(a, b),
        content(requirement('a', 'Live'), b),
        content(a, requirement('new'), requirement('b', 'Proposed')),
      ),
    ).toEqual({
      kind: 'MERGED',
      candidate: content(
        requirement('a', 'Live'),
        requirement('new'),
        requirement('b', 'Proposed'),
      ),
    });
  });
  it.each([
    [
      content(requirement('a', 'Live'), b),
      content(requirement('a', 'Proposed'), b),
    ],
    [content(b), content(requirement('a', 'Proposed'), b)],
    [content(requirement('a', 'Live'), b), content(b)],
  ])('reports only the overlapping requirement', (current, proposed) => {
    expect(mergeProposalContent(content(a, b), current, proposed)).toEqual({
      kind: 'AGENT_FIX_REQUIRED',
      conflictingPaths: ['/sections/requirements/records/a'],
    });
  });
  it('preserves live order and accepts equivalent reordering', () => {
    expect(
      mergeProposalContent(
        content(a, b),
        content(b, a),
        content(requirement('a', 'Proposed'), b),
      ),
    ).toEqual({
      kind: 'MERGED',
      candidate: content(b, requirement('a', 'Proposed')),
    });
  });
  it('carries the merged requirements into an operation-authored update', () => {
    const patch = {
      requirementOps: [{ op: 'update', targetId: 'b', statement: 'Proposed' }],
    } satisfies UpdateTaskDto;
    const current = content(requirement('a', 'Live'), b);
    const proposed = content(a, requirement('b', 'Proposed'));
    const result = mergeProposalContent(content(a, b), current, proposed);
    expect(result.kind).toBe('MERGED');
    if (result.kind !== 'MERGED') {
      throw new Error('Independent requirements must merge');
    }
    expect(result.candidate).toEqual(
      content(requirement('a', 'Live'), requirement('b', 'Proposed')),
    );
    expect(
      reconciliationPatch(
        patch,
        current,
        content(requirement('a', 'Live'), requirement('b', 'Proposed')),
      ),
    ).toEqual({
      sections: [
        {
          key: 'requirements',
          content: {
            records: [requirement('a', 'Live'), requirement('b', 'Proposed')],
          },
        },
      ],
    });
  });
});
