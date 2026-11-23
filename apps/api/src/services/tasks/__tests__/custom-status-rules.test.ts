import { workItemTypeStatusesSchema } from '../work-item-type-status.schema';
import {
  deriveRules,
  undeclaredAgentSettableStatuses,
  writtenAgentSettableStatuses,
} from '../work-item-type-registry.service';
import type { WorkItemTypeDefinitionDto } from '@hey-hey/contracts/api/models';
import {
  resolveWorkItemStatusAuthoring,
  statusAuthoringRequestSchema,
} from '../work-item-status-inference';

const recipe = {
  key: 'recipe',
  name: 'Recipe',
  role: 'project-info',
  sections: [],
  statuses: [
    { name: 'Idea', meaning: { kind: 'CUSTOM' as const, text: 'Not started' } },
    { name: 'Testing', meaning: { kind: 'IN_PROGRESS' as const } },
    { name: 'Made', meaning: { kind: 'COMPLETED' as const } },
    { name: 'Rejected', meaning: { kind: 'COMPLETED' as const } },
  ],
} satisfies WorkItemTypeDefinitionDto;

describe('effective custom status rules', () => {
  it('preserves ordered names and meanings and initializes from the first ordinary status', () => {
    const rules = deriveRules(recipe);

    expect(rules.statuses).toEqual(recipe.statuses);
    expect(rules.initialStatusPolicy.initialStatus).toBe('Idea');
    expect(rules.allowedStatuses).toEqual([
      'Idea',
      'Testing',
      'Made',
      'Rejected',
      'ARCHIVED',
    ]);
    expect(writtenAgentSettableStatuses(recipe)).toEqual(rules.allowedStatuses);
  });

  it('keeps supersession outside ordinary statuses and agent defaults', () => {
    const supersedable = {
      ...recipe,
      capabilities: { supportsSupersession: true },
    } satisfies WorkItemTypeDefinitionDto;
    const rules = deriveRules(supersedable);

    expect(rules.allowedStatuses).toContain('SUPERSEDED');
    expect(rules.statuses).toEqual(recipe.statuses);
    expect(rules.initialStatusPolicy.initialStatus).toBe('Idea');
    expect(writtenAgentSettableStatuses(supersedable)).not.toContain(
      'SUPERSEDED',
    );
  });

  it('supports ongoing types without a finished status', () => {
    const ongoing = {
      ...recipe,
      statuses: [
        { name: 'Maintained', meaning: { kind: 'IN_PROGRESS' as const } },
      ],
    } satisfies WorkItemTypeDefinitionDto;

    expect(deriveRules(ongoing).statuses).toEqual(ongoing.statuses);
  });
});

describe('agent-settable statuses', () => {
  it('derives rules without rejecting stale names; write paths own that check', () => {
    const renamed = {
      ...recipe,
      statuses: [
        {
          name: 'Drafting',
          meaning: { kind: 'CUSTOM' as const, text: 'Not started' } as const,
        },
      ],
    } satisfies WorkItemTypeDefinitionDto;

    expect(
      undeclaredAgentSettableStatuses({
        ...renamed,
        agentSettableStatuses: ['Draft', 'Drafting', 'ARCHIVED'],
      }),
    ).toEqual(['Draft']);
    expect(
      deriveRules({ ...renamed, agentSettableStatuses: ['Draft'] })
        .agentSettableStatuses,
    ).toEqual(['Draft']);
  });
});

describe('status definitions at the authoring boundary', () => {
  it('offers standard meanings only when statuses are omitted', () => {
    const result = resolveWorkItemStatusAuthoring({ purpose: 'Work' });
    expect(result.statuses).toContainEqual({
      name: 'COMPLETED',
      meaning: { kind: 'COMPLETED' },
    });

    expect(() =>
      resolveWorkItemStatusAuthoring({
        purpose: 'Work',
        statuses: [{ name: 'completed' }],
      }),
    ).toThrow(/Statuses without one: completed/);
  });

  it('keeps the meaning the author wrote, even on a standard name', () => {
    expect(
      resolveWorkItemStatusAuthoring({
        purpose: 'Work',
        statuses: [
          { name: 'BACKLOG', meaning: { kind: 'COMPLETED' as const } },
        ],
      }).statuses,
    ).toEqual([{ name: 'BACKLOG', meaning: { kind: 'COMPLETED' as const } }]);
  });

  it('rejects statuses without a meaning, naming each and the fix', () => {
    const rejection = () =>
      resolveWorkItemStatusAuthoring({
        purpose: 'Work',
        statuses: [
          { name: 'Considering' },
          { name: 'Applied', meaning: { kind: 'IN_PROGRESS' as const } },
          { name: 'Rejected' },
        ],
      });

    expect(rejection).toThrow(/Considering, Rejected/);
    expect(rejection).toThrow(/Completed, Cancelled, In progress or Custom/);
  });

  it.each([
    [
      'a built-in name as custom text',
      { kind: 'CUSTOM' as const, text: ' iN PrOgReSs ' },
    ],
    ['empty custom text', { kind: 'CUSTOM' as const, text: '' }],
    ['missing custom text', { kind: 'CUSTOM' as const }],
    [
      'custom text over 50 characters',
      { kind: 'CUSTOM' as const, text: '🚀'.repeat(51) },
    ],
    [
      'text on a built-in meaning',
      { kind: 'COMPLETED' as const, text: 'Done' },
    ],
  ])('rejects %s', (_name, meaning) => {
    expect(
      statusAuthoringRequestSchema.safeParse({
        purpose: 'Work',
        statuses: [{ name: 'Idea', meaning }],
      }).success,
    ).toBe(false);
  });

  it('accepts custom text of exactly 50 characters', () => {
    const text = '🚀'.repeat(50);

    expect(
      resolveWorkItemStatusAuthoring({
        purpose: 'Work',
        statuses: [
          { name: 'Idea', meaning: { kind: 'CUSTOM' as const, text } },
        ],
      }).statuses,
    ).toEqual([{ name: 'Idea', meaning: { kind: 'CUSTOM' as const, text } }]);
  });

  it('offers the same standard statuses regardless of purpose', () => {
    const result = resolveWorkItemStatusAuthoring({ purpose: 'Recipe' });
    expect(result.suggestions).toEqual([
      'BACKLOG',
      'REFINING',
      'READY',
      'ACTIVE',
      'BLOCKED',
      'ON_HOLD',
      'VERIFYING',
      'COMPLETED',
      'CANCELLED',
    ]);
    expect(
      resolveWorkItemStatusAuthoring({ purpose: 'Research' }).suggestions,
    ).toEqual(result.suggestions);
    expect(result.statuses).toEqual(
      expect.arrayContaining([
        { name: 'ACTIVE', meaning: { kind: 'IN_PROGRESS' as const } },
        { name: 'CANCELLED', meaning: { kind: 'CANCELLED' as const } },
      ]),
    );
  });

  it('rejects whitespace, reserved names and duplicate names', () => {
    for (const names of [[' '], [' Archived '], ['Idea', ' idea ']]) {
      expect(() =>
        resolveWorkItemStatusAuthoring({
          purpose: 'Recipe',
          statuses: names.map((name) => ({
            name,
            meaning: { kind: 'IN_PROGRESS' as const },
          })),
        }),
      ).toThrow();
    }
  });

  it('accepts a resolved custom list', () => {
    expect(workItemTypeStatusesSchema.parse(recipe.statuses)).toEqual(
      recipe.statuses,
    );
  });

  it.each(['ARCHIVED', 'Archived', 'SUPERSEDED', 'Superseded'])(
    'rejects reserved ordinary status %s',
    (name) => {
      expect(() =>
        workItemTypeStatusesSchema.parse([
          { name, meaning: { kind: 'CUSTOM' as const, text: 'Unfinished' } },
        ]),
      ).toThrow();
    },
  );

  it('rejects duplicate names and a missing ordinary initial status', () => {
    expect(() =>
      workItemTypeStatusesSchema.parse([
        recipe.statuses[0],
        recipe.statuses[0],
      ]),
    ).toThrow();
    expect(() => workItemTypeStatusesSchema.parse([])).toThrow();
  });
});
