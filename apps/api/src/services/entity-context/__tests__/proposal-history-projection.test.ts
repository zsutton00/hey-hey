import {
  deterministicUnifiedDiff,
  projectContextProposalSummaries,
  summarizeProposalUpdates,
} from '../proposal-history-projection';
import type { TypedProposalResponse } from '../../proposal/proposal.types';

describe('proposal history projection', () => {
  it('carries stored ELI5 into compact history and leaves legacy absence intact', () => {
    const current = {
      id: 'proposal-current',
      targetEntityId: 'task-current',
      updates: { name: 'Current' },
      eli5: 'Explains the current change.',
    } as TypedProposalResponse;
    const legacy = {
      id: 'proposal-legacy',
      targetEntityId: 'task-legacy',
      updates: { name: 'Legacy' },
    } as TypedProposalResponse;

    const summaries = projectContextProposalSummaries([current, legacy], []);
    expect(summaries[0]?.eli5).toBe('Explains the current change.');
    expect(summaries[1]).not.toHaveProperty('eli5');
  });

  const adjacent = {
    id: '123e4567-e89b-42d3-a456-426614174001',
    createdAt: '2026-09-01T00:00:00.000Z',
    targetEntityId: '123e4567-e89b-42d3-a456-426614174010',
    updates: {
      status: 'BACKLOG',
      metadata: { owner: 'platform', enabled: false },
      sections: [
        { key: 'description', content: 'Ship it.' },
        { key: 'requirements', content: 'One\nTwo\nThree' },
      ],
    },
  };

  it('normalizes scalar, JSON, and section content paths deterministically', () => {
    const changes = summarizeProposalUpdates(
      {
        status: 'ACTIVE',
        metadata: { owner: 'context', enabled: true },
        sections: [
          { key: 'requirements', content: 'One\nThree' },
          { key: 'description', content: 'Ship it!' },
        ],
      },
      [adjacent],
    );

    expect(changes.map((change) => change.path)).toEqual([
      'metadata',
      'sections.description.content',
      'sections.requirements.content',
      'status',
    ]);
    expect(changes[0]).toMatchObject({
      type: 'object',
      diff: '@@ -2,2 +2,2 @@\n-  "enabled": false,\n-  "owner": "platform"\n+  "enabled": true,\n+  "owner": "context"',
    });
    expect(changes[1]).toMatchObject({
      diff: '@@ -1,1 +1,1 @@\n-Ship it.\n+Ship it!',
      diffTruncated: false,
      diffOmittedCharacters: 0,
    });
    expect(changes[1]).not.toHaveProperty('proposedValue');
    expect(changes[1]).not.toHaveProperty('previousValue');
    expect(changes[2]).toMatchObject({
      diff: '@@ -2,1 +1,0 @@\n-Two',
      diffTruncated: false,
      diffOmittedCharacters: 0,
    });
  });

  it('reports why an adjacent baseline cannot support a comparison', () => {
    expect(summarizeProposalUpdates({ status: 'ACTIVE' }, [])).toEqual([
      expect.objectContaining({
        path: 'status',
        unavailableReason: 'no-older-proposal',
        searchedProposalCount: 0,
      }),
    ]);

    expect(
      summarizeProposalUpdates({ priority: 'HIGH' }, [
        { ...adjacent, updates: { status: 'BACKLOG' } },
      ]),
    ).toEqual([
      expect.objectContaining({
        path: 'priority',
        unavailableReason: 'no-same-path-in-window',
        searchedProposalCount: 1,
      }),
    ]);
  });

  it('classifies every source value type and diffs deterministic JSON text', () => {
    const changes = summarizeProposalUpdates(
      {
        array: [2, 1],
        boolean: true,
        nil: null,
        number: 2,
        object: { z: 2, a: 1 },
        string: 'new',
      },
      [
        {
          ...adjacent,
          updates: {
            array: [1],
            boolean: false,
            nil: 'not null',
            number: 1,
            object: { a: 0, z: 2 },
            string: 'old',
          },
        },
      ],
    );

    expect(changes.map(({ path, type }) => [path, type])).toEqual([
      ['array', 'array'],
      ['boolean', 'boolean'],
      ['nil', 'null'],
      ['number', 'number'],
      ['object', 'object'],
      ['string', 'string'],
    ]);
    expect(changes.find(({ path }) => path === 'object')?.diff).toContain(
      '-  "a": 0',
    );
    expect(changes.find(({ path }) => path === 'object')?.diff).toContain(
      '+  "a": 1',
    );
    expect(changes.find(({ path }) => path === 'nil')?.diff).toContain('+null');
  });

  it('uses the nearest older proposal containing the same stable path', () => {
    const changes = summarizeProposalUpdates(
      { sections: [{ key: 'description', content: 'The cat in the hat' }] },
      [
        {
          id: '123e4567-e89b-42d3-a456-426614174002',
          createdAt: '2026-08-31T00:00:00.000Z',
          targetEntityId: adjacent.targetEntityId,
          updates: {
            sections: [{ key: 'requirements', content: 'Unrelated patch' }],
          },
        },
        {
          id: '123e4567-e89b-42d3-a456-426614174003',
          createdAt: '2026-08-30T00:00:00.000Z',
          targetEntityId: adjacent.targetEntityId,
          updates: {
            sections: [{ key: 'description', content: 'The cat in the' }],
          },
        },
      ],
    );

    expect(changes[0]).toMatchObject({
      diff: '@@ -1,1 +1,1 @@\n-The cat in the\n+The cat in the hat',
      diffTruncated: false,
      diffOmittedCharacters: 0,
    });
  });

  it('returns a bounded Markdown preview when no same-path baseline exists', () => {
    const proposed = 'x'.repeat(450);
    const [change] = summarizeProposalUpdates(
      { sections: [{ key: 'description', content: proposed }] },
      [{ ...adjacent, updates: { status: 'BACKLOG' } }],
    );

    expect(change).toMatchObject({
      proposedPreview: 'x'.repeat(400),
      proposedLength: 450,
      proposedPreviewTruncated: true,
      unavailableReason: 'no-same-path-in-window',
      searchedProposalCount: 1,
    });
    expect(change).not.toHaveProperty('diff');
  });

  it('emits one Git-style unified diff string without token segments', () => {
    expect(deterministicUnifiedDiff('Hello', 'Hello world')).toEqual({
      diff: '@@ -1,1 +1,1 @@\n-Hello\n+Hello world',
      diffTruncated: false,
      diffOmittedCharacters: 0,
    });
  });

  it('omits full Markdown values and unchanged context around an append', () => {
    const unchanged = Array.from(
      { length: 20 },
      (_, index) => `Existing requirement ${index + 1}`,
    ).join('\n');
    const proposed = `${unchanged}\nNew requirement`;

    const [change] = summarizeProposalUpdates(
      { sections: [{ key: 'requirements', content: proposed }] },
      [
        {
          ...adjacent,
          updates: {
            sections: [{ key: 'requirements', content: unchanged }],
          },
        },
      ],
    );

    expect(change).not.toHaveProperty('proposedValue');
    expect(change).not.toHaveProperty('previousValue');
    expect(change).toMatchObject({
      diff: '@@ -20,0 +21,1 @@\n+New requirement',
      diffTruncated: false,
      diffOmittedCharacters: 0,
    });
    expect(JSON.stringify(change)).not.toContain('Existing requirement 1\\n');
    expect(JSON.stringify(change).length).toBeLessThan(500);
  });

  it('keeps multiline rewrites readable instead of matching incidental words', () => {
    const result = deterministicUnifiedDiff(
      'A real-time dashboard alongside a compact timeline.',
      [
        'A real-time dashboard for recent work.',
        '',
        '### Project navigation',
        '',
        '* Daily Session',
        '* Coding',
      ].join('\n'),
    );

    expect(result.diff).toBe(
      [
        '@@ -1,1 +1,6 @@',
        '-A real-time dashboard alongside a compact timeline.',
        '+A real-time dashboard for recent work.',
        '+',
        '+### Project navigation',
        '+',
        '+* Daily Session',
        '+* Coding',
      ].join('\n'),
    );
    expect(result.diff).not.toContain('equal');
  });

  it('bounds a unified diff and discloses omitted characters', () => {
    const result = deterministicUnifiedDiff(
      'old',
      Array.from({ length: 300 }, (_, index) => `new line ${index}`).join('\n'),
    );

    expect(result.diff).toHaveLength(2000);
    expect(result.diffTruncated).toBe(true);
    expect(result.diffOmittedCharacters).toBeGreaterThan(0);
  });
});
