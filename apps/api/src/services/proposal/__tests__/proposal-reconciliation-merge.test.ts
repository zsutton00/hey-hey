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
