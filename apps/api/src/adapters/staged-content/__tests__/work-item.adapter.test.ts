import { WorkItemStagedContentAdapter } from '../work-item.adapter';

type PrivateAdapter = {
  mapTaskToStagedEntity: (task: unknown) => Record<string, unknown>;
  mapStagedEntityToTaskUpdates: (updates: unknown) => {
    sections?: Array<{ key: string; content: string }>;
  };
};

const buildAdapter = (): PrivateAdapter => {
  const adapter = new WorkItemStagedContentAdapter(
    {} as any,
    {} as any,
    {} as any,
    {
      // Mirror the registry's section-derived levels: STANDARD is two-level,
      // every other built-in type is single-level (description only).
      getTaskRefinementLevels: (type: string) =>
        type === 'STANDARD'
          ? ['description', 'acceptanceCriteria']
          : ['description'],
    } as any,
  );
  return adapter as unknown as PrivateAdapter;
};

describe('WorkItemStagedContentAdapter', () => {
  describe('mapTaskToStagedEntity', () => {
    it('surfaces the requirements section content for FEATURE tasks', () => {
      const adapter = buildAdapter();
      const now = new Date('2026-04-18T00:00:00.000Z');

      const mapped = adapter.mapTaskToStagedEntity({
        id: 'task-1',
        name: 'Feature A',
        status: 'REFINING_REQUIREMENTS',
        type: 'FEATURE',
        priority: 'MEDIUM',
        assigneeId: null,
        organizationId: 'org-1',
        initiativeId: 'init-1',
        createdAt: now,
        updatedAt: now,
        sections: [
          {
            id: 'sec-desc',
            key: 'description',
            order: 0,
            materializedMarkdown: 'the description',
          },
          {
            id: 'sec-req',
            key: 'requirements',
            order: 1,
            materializedMarkdown: '- must handle empty input',
          },
        ],
      });

      expect(mapped.requirements).toBe('- must handle empty input');
      expect(mapped.description).toBe('the description');
    });

    it('surfaces only description for GOAL tasks (no acceptanceCriteria or requirements)', () => {
      const adapter = buildAdapter();
      const now = new Date('2026-04-29T00:00:00.000Z');

      const mapped = adapter.mapTaskToStagedEntity({
        id: 'task-goal-1',
        name: 'Goal A',
        status: 'REFINING_DESCRIPTION',
        type: 'GOAL',
        priority: 'MEDIUM',
        assigneeId: null,
        organizationId: 'org-1',
        initiativeId: null,
        createdAt: now,
        updatedAt: now,
        sections: [
          {
            id: 'sec-desc',
            key: 'description',
            order: 0,
            materializedMarkdown: 'reach outcome X',
          },
        ],
      });

      expect(mapped.description).toBe('reach outcome X');
      expect(mapped.acceptanceCriteria).toBeUndefined();
      expect(mapped.requirements).toBeUndefined();
    });

    it('drops stale acceptanceCriteria and requirements section rows for GOAL tasks', () => {
      const adapter = buildAdapter();
      const now = new Date('2026-04-29T00:00:00.000Z');

      const mapped = adapter.mapTaskToStagedEntity({
        id: 'task-goal-2',
        name: 'Goal B',
        status: 'REFINING_DESCRIPTION',
        type: 'GOAL',
        priority: 'MEDIUM',
        assigneeId: null,
        organizationId: 'org-1',
        initiativeId: null,
        createdAt: now,
        updatedAt: now,
        sections: [
          {
            id: 'sec-desc',
            key: 'description',
            order: 0,
            materializedMarkdown: 'reach outcome Y',
          },
          {
            id: 'sec-ac-stale',
            key: 'acceptanceCriteria',
            order: 1,
            materializedMarkdown: 'leftover acceptance criteria',
          },
          {
            id: 'sec-req-stale',
            key: 'requirements',
            order: 2,
            materializedMarkdown: 'leftover requirements',
          },
        ],
      });

      expect(mapped.description).toBe('reach outcome Y');
      expect(mapped.acceptanceCriteria).toBeUndefined();
      expect(mapped.requirements).toBeUndefined();
    });
  });

  describe('mapStagedEntityToTaskUpdates', () => {
    it('emits a requirements section update when requirements is present', () => {
      const adapter = buildAdapter();

      const result = adapter.mapStagedEntityToTaskUpdates({
        requirements: '- new requirement',
      });

      expect(result.sections).toEqual([
        { key: 'requirements', content: '- new requirement' },
      ]);
    });

    it('emits an empty-string requirements update when explicitly cleared', () => {
      const adapter = buildAdapter();

      const result = adapter.mapStagedEntityToTaskUpdates({
        requirements: '',
      });

      expect(result.sections).toEqual([{ key: 'requirements', content: '' }]);
    });

    it('does not emit a requirements section update when requirements is undefined', () => {
      const adapter = buildAdapter();

      const result = adapter.mapStagedEntityToTaskUpdates({
        description: 'just a description edit',
      });

      expect(result.sections).toEqual([
        { key: 'description', content: 'just a description edit' },
      ]);
      expect(result.sections?.some((s) => s.key === 'requirements')).toBe(
        false,
      );
    });
  });
});
