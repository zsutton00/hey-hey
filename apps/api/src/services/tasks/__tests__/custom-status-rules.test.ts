import { workItemTypeStatusesSchema } from '../work-item-type-status.schema';
import {
  deriveRules,
  writtenAgentSettableStatuses,
} from '../work-item-type-registry.service';
import type { WorkItemTypeDefinitionDto } from '../../../generated/model/workItemTypeDefinitionDto';

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
