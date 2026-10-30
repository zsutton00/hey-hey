import { workItemTypeStatusesSchema } from '../work-item-type-status.schema';
import {
  deriveRules,
  writtenAgentSettableStatuses,
} from '../work-item-type-registry.service';
import type { WorkItemTypeDefinitionDto } from '../../../generated/model/workItemTypeDefinitionDto';
import { resolveWorkItemStatusAuthoring } from '../work-item-status-inference';

const recipe = {
  key: 'recipe',
  name: 'Recipe',
  role: 'project-info',
  sections: [],
  statuses: [
    { name: 'Idea', meaning: 'NOT_STARTED' },
    { name: 'Testing', meaning: 'IN_PROGRESS' },
    { name: 'Made', meaning: 'FINISHED' },
    { name: 'Rejected', meaning: 'FINISHED' },
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
      statuses: [{ name: 'Maintained', meaning: 'IN_PROGRESS' }],
    } satisfies WorkItemTypeDefinitionDto;

    expect(deriveRules(ongoing).statuses).toEqual(ongoing.statuses);
  });
});

describe('status definitions at the authoring boundary', () => {
  it('recognizes clear status names regardless of their order', () => {
    expect(
      resolveWorkItemStatusAuthoring({
        purpose: 'Work',
        names: ['Active', 'Idea', 'In progress', 'Blocked', 'Done'],
      }).statuses,
    ).toEqual([
      { name: 'Active', meaning: 'IN_PROGRESS' },
      { name: 'Idea', meaning: 'NOT_STARTED' },
      { name: 'In progress', meaning: 'IN_PROGRESS' },
      { name: 'Blocked', meaning: 'UNFINISHED' },
      { name: 'Done', meaning: 'FINISHED' },
    ]);
  });
  it('offers the same standard statuses regardless of purpose', () => {
    const result = resolveWorkItemStatusAuthoring({ purpose: 'Recipe' });
    expect(result.state).toBe('RESOLVED');
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
        expect.objectContaining({
          name: 'ACTIVE',
          label: 'In progress',
          meaning: 'IN_PROGRESS',
        }),
        expect.objectContaining({
          name: 'CANCELLED',
          meaning: 'FINISHED',
          completionBehavior: 'CANCELLED',
        }),
      ]),
    );
  });

  it('asks about ambiguous finished states and accepts none', () => {
    const input = { purpose: 'Résumé', names: ['Draft', 'Maintained'] };
    expect(resolveWorkItemStatusAuthoring(input).state).toBe('CLARIFICATION');
    expect(
      resolveWorkItemStatusAuthoring({ ...input, finishedNames: [] }).statuses,
    ).toEqual([
      { name: 'Draft', meaning: 'NOT_STARTED' },
      { name: 'Maintained', meaning: 'IN_PROGRESS' },
    ]);
  });

  it('preserves authored meanings and completion metadata when editing', () => {
    const existingStatuses = [
      { name: 'ACTIVE', label: 'In progress', meaning: 'IN_PROGRESS' as const },
      {
        name: 'CANCELLED',
        meaning: 'FINISHED' as const,
        completionBehavior: 'CANCELLED' as const,
      },
      { name: 'BLOCKED', meaning: 'UNFINISHED' as const },
    ];
    expect(
      resolveWorkItemStatusAuthoring({
        purpose: 'Work',
        names: existingStatuses.map((status) => status.name),
        existingStatuses,
      }).statuses,
    ).toEqual(existingStatuses);
  });

  it('rejects whitespace, reserved names and duplicate names', () => {
    for (const names of [[' '], [' Archived '], ['Idea', ' idea ']]) {
      expect(() =>
        resolveWorkItemStatusAuthoring({ purpose: 'Recipe', names }),
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
        workItemTypeStatusesSchema.parse([{ name, meaning: 'UNFINISHED' }]),
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
