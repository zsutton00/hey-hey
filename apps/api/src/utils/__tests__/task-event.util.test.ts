import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import { BadRequestException } from '@nestjs/common';
import type { FeatureTag } from '../../generated';
import type {
  MaterializedWorkItemSection,
  WorkItemSectionKey,
} from '../../types/work-item-section.types';
import {
  buildTaskEventContentSnapshot,
  buildTaskEventContentSnapshotFromSections,
  buildTaskEventUpdateSnapshot,
  toTaskSnapshot,
} from '../task-event.util';
import { EMPTY_FEATURE_REQUIREMENTS_CONTENT } from '../../services/tasks/feature-requirements-reader';

const FEATURE: WorkItemTypeKey = 'FEATURE' as WorkItemTypeKey;
const STANDARD: WorkItemTypeKey = 'STANDARD' as WorkItemTypeKey;
const GOAL: WorkItemTypeKey = 'GOAL' as WorkItemTypeKey;
const FEATURE_REQUIREMENTS = EMPTY_FEATURE_REQUIREMENTS_CONTENT;

const section = (
  key: WorkItemSectionKey,
  materializedMarkdown: string,
  order = 0,
): MaterializedWorkItemSection => ({
  id: `section-${key}`,
  key,
  order,
  materializedMarkdown,
  materializedProposalId: '10000000-0000-4000-8000-000000000001',
});

describe('task-event.util', () => {
  describe('buildTaskEventContentSnapshot', () => {
    it('requires requirements content for FEATURE tasks', () => {
      expect(() =>
        buildTaskEventContentSnapshot({
          type: FEATURE,
          description: 'desc',
        }),
      ).toThrow(BadRequestException);
    });

    it('propagates requirements for FEATURE tasks and omits acceptanceCriteria', () => {
      const snapshot = buildTaskEventContentSnapshot({
        type: FEATURE,
        description: 'desc',
        requirements: ` { "records": [] } `,
      });

      expect(snapshot).toEqual({
        type: FEATURE,
        description: 'desc',
        requirements: FEATURE_REQUIREMENTS,
      });
      expect(snapshot.acceptanceCriteria).toBeUndefined();
    });

    it('rejects blank or malformed FEATURE requirements content', () => {
      expect(() =>
        buildTaskEventContentSnapshot({
          type: FEATURE,
          description: 'desc',
          requirements: '   ',
        }),
      ).toThrow(BadRequestException);
      expect(() =>
        buildTaskEventContentSnapshot({
          type: FEATURE,
          description: 'desc',
          requirements: '{"records":',
        }),
      ).toThrow(BadRequestException);
    });

    it('omits requirements for STANDARD tasks even if passed', () => {
      const snapshot = buildTaskEventContentSnapshot({
        type: STANDARD,
        description: 'desc',
        acceptanceCriteria: 'ac',
        requirements: 'should be dropped',
      });

      expect(snapshot.requirements).toBeUndefined();
      expect(snapshot.acceptanceCriteria).toBe('ac');
    });

    it('emits description-only payload for GOAL tasks', () => {
      const snapshot = buildTaskEventContentSnapshot({
        type: GOAL,
        description: 'achieve outcome X by quarter end',
        acceptanceCriteria: 'should be dropped',
        requirements: 'should be dropped',
      });

      expect(snapshot).toEqual({
        type: GOAL,
        description: 'achieve outcome X by quarter end',
      });
      expect(snapshot.acceptanceCriteria).toBeUndefined();
      expect(snapshot.requirements).toBeUndefined();
    });
  });

  describe('buildTaskEventContentSnapshotFromSections', () => {
    it('preserves custom keys, ordering, empty and non-string section content', () => {
      const sections = [
        { key: 'audience', order: 2, materializedMarkdown: 'Research teams' },
        { key: 'description', order: 0, materializedMarkdown: 'A campaign' },
        {
          key: 'preview',
          order: 1,
          materializedMarkdown: { html: '<p>Preview</p>', css: '' },
        },
        { key: 'cleared', order: 3, materializedMarkdown: null },
      ];
      const snapshot = buildTaskEventContentSnapshotFromSections(
        'campaign' as WorkItemTypeKey,
        sections,
      );
      expect(snapshot.type).toBe('campaign');
      expect(snapshot.sections).toEqual(sections);
      expect(
        buildTaskEventContentSnapshotFromSections(
          'campaign' as WorkItemTypeKey,
          [],
        ).sections,
      ).toEqual([]);
    });
    it('extracts requirements from materialized sections for FEATURE tasks', () => {
      const snapshot = buildTaskEventContentSnapshotFromSections(FEATURE, [
        section('description', 'the description'),
        section('requirements', FEATURE_REQUIREMENTS, 1),
      ]);

      expect(snapshot).toEqual({
        type: FEATURE,
        description: 'the description',
        requirements: FEATURE_REQUIREMENTS,
        sections: [
          {
            key: 'description',
            order: 0,
            materializedMarkdown: 'the description',
          },
          {
            key: 'requirements',
            order: 1,
            materializedMarkdown: FEATURE_REQUIREMENTS,
          },
        ],
      });
    });

    it('emits description-only snapshot for GOAL tasks', () => {
      const snapshot = buildTaskEventContentSnapshotFromSections(GOAL, [
        section('description', 'reach outcome X'),
      ]);

      expect(snapshot).toEqual({
        type: GOAL,
        description: 'reach outcome X',
        sections: [
          {
            key: 'description',
            order: 0,
            materializedMarkdown: 'reach outcome X',
          },
        ],
      });
    });

    it('does not treat summary sections as description content', () => {
      const snapshot = buildTaskEventContentSnapshotFromSections(GOAL, [
        section('summary' as WorkItemSectionKey, 'orientation text'),
      ]);

      expect(snapshot).toEqual({
        type: GOAL,
        description: '',
        sections: [
          {
            key: 'summary',
            order: 0,
            materializedMarkdown: 'orientation text',
          },
        ],
      });
    });
  });

  describe('toTaskSnapshot', () => {
    it('includes requirements in the emitted task snapshot for FEATURE tasks', () => {
      const now = new Date('2026-04-18T00:00:00.000Z');
      const snapshot = toTaskSnapshot(
        {
          name: 'My feature',
          type: FEATURE,
          description: 'desc',
          requirements: FEATURE_REQUIREMENTS,
          projectId: 'proj-1',
          initiativeId: null,
          status: 'ACTIVE' as any,
          id: 'task-1',
          organizationId: 'org-1',
          createdAt: now,
          updatedAt: now,
        },
        {
          type: FEATURE,
          description: 'desc',
          requirements: FEATURE_REQUIREMENTS,
        },
      );

      expect(snapshot.requirements).toBe(FEATURE_REQUIREMENTS);
      expect(snapshot.acceptanceCriteria).toBeUndefined();
    });

    it('omits acceptanceCriteria and requirements for GOAL tasks', () => {
      const now = new Date('2026-04-29T00:00:00.000Z');
      const snapshot = toTaskSnapshot(
        {
          name: 'My goal',
          type: GOAL,
          description: 'reach outcome X',
          projectId: 'proj-1',
          initiativeId: null,
          status: 'ACTIVE' as any,
          dueDate: new Date('2026-06-30T00:00:00.000Z'),
          id: 'task-goal-1',
          organizationId: 'org-1',
          createdAt: now,
          updatedAt: now,
        },
        {
          type: GOAL,
          description: 'reach outcome X',
        },
      );

      expect(snapshot.description).toBe('reach outcome X');
      expect(snapshot.acceptanceCriteria).toBeUndefined();
      expect(snapshot.requirements).toBeUndefined();
    });
  });

  describe('feature tag in event payloads', () => {
    const BACKEND: FeatureTag = 'backend' as FeatureTag;

    it('buildTaskEventContentSnapshot: emits tag for FEATURE tasks when supplied', () => {
      const snapshot = buildTaskEventContentSnapshot({
        type: FEATURE,
        tag: BACKEND,
        description: 'desc',
        requirements: FEATURE_REQUIREMENTS,
      });

      expect(snapshot.tag).toBe(BACKEND);
    });

    it('buildTaskEventContentSnapshot: omits tag for non-FEATURE types', () => {
      const snapshot = buildTaskEventContentSnapshot({
        type: STANDARD,
        description: 'desc',
        acceptanceCriteria: 'ac',
      });

      expect(snapshot.tag).toBeUndefined();
    });

    it('toTaskSnapshot: emits tag from the task row for FEATURE tasks', () => {
      const now = new Date('2026-04-30T00:00:00.000Z');
      const snapshot = toTaskSnapshot(
        {
          name: 'My feature',
          type: FEATURE,
          tag: BACKEND,
          description: 'desc',
          requirements: FEATURE_REQUIREMENTS,
          projectId: 'proj-1',
          initiativeId: null,
          status: 'ACTIVE' as any,
          id: 'task-1',
          organizationId: 'org-1',
          createdAt: now,
          updatedAt: now,
        },
        {
          type: FEATURE,
          tag: BACKEND,
          description: 'desc',
          requirements: FEATURE_REQUIREMENTS,
        },
      );

      expect(snapshot.tag).toBe(BACKEND);
    });

    it('toTaskSnapshot: omits tag when the task row has no tag (non-FEATURE rows)', () => {
      const now = new Date('2026-04-30T00:00:00.000Z');
      const snapshot = toTaskSnapshot(
        {
          name: 'My task',
          type: STANDARD,
          tag: null,
          description: 'desc',
          acceptanceCriteria: 'ac',
          projectId: 'proj-1',
          initiativeId: null,
          status: 'ACTIVE' as any,
          id: 'task-2',
          organizationId: 'org-1',
          createdAt: now,
          updatedAt: now,
        },
        {
          type: STANDARD,
          description: 'desc',
          acceptanceCriteria: 'ac',
        },
      );

      expect(snapshot.tag).toBeUndefined();
    });

    it('buildTaskEventUpdateSnapshot: copies tag when provided', () => {
      const snapshot = buildTaskEventUpdateSnapshot({ tag: BACKEND });
      expect(snapshot.tag).toBe(BACKEND);
    });

    it('buildTaskEventUpdateSnapshot: omits tag when the patch does not include it', () => {
      const snapshot = buildTaskEventUpdateSnapshot({ name: 'renamed' });
      expect(snapshot.tag).toBeUndefined();
    });
  });
});
