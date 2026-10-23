import { WorkStatus } from '../../generated';
import {
  CANONICAL_REFINEMENT_LEVELS,
  canTaskFinalizeAtLevel,
  getTaskActiveSection,
  getTaskCurrentRefinementLevel,
  getTaskNextRefinementLevel,
  getTaskNextRefinementLevelFromStatus,
  getTaskNextStatus,
  getTaskPreviousRefinementLevel,
  getTaskRefinementProgressPercentage,
  isTaskSectionAllowedForType,
  TaskRefinementLevel,
} from '../task-refinement-profile.util';
import { TaskActiveSectionEnum } from '../../generated/agents/models';

// Level sets stand in for what WorkItemTypeRegistryService.getTaskRefinementLevels
// derives from a type's sections: a two-level (description + acceptanceCriteria)
// type and a single-level (description-only) type.
const TWO_LEVEL: readonly TaskRefinementLevel[] = [
  'description',
  'acceptanceCriteria',
];
const SINGLE_LEVEL: readonly TaskRefinementLevel[] = ['description'];

describe('task-refinement-profile.util', () => {
  describe('CANONICAL_REFINEMENT_LEVELS', () => {
    it('is the full description -> acceptanceCriteria order', () => {
      expect(CANONICAL_REFINEMENT_LEVELS).toEqual([
        'description',
        'acceptanceCriteria',
      ]);
    });
  });

  describe('isTaskSectionAllowedForType', () => {
    it('allows acceptanceCriteria only for a two-level set', () => {
      expect(isTaskSectionAllowedForType('acceptanceCriteria', TWO_LEVEL)).toBe(
        true,
      );
      expect(
        isTaskSectionAllowedForType('acceptanceCriteria', SINGLE_LEVEL),
      ).toBe(false);
    });

    it('allows description for every set', () => {
      expect(isTaskSectionAllowedForType('description', TWO_LEVEL)).toBe(true);
      expect(isTaskSectionAllowedForType('description', SINGLE_LEVEL)).toBe(
        true,
      );
    });

    it('rejects an unknown section key', () => {
      expect(isTaskSectionAllowedForType('requirements', TWO_LEVEL)).toBe(
        false,
      );
    });
  });

  describe('getTaskCurrentRefinementLevel', () => {
    it('maps description statuses to the description level', () => {
      expect(
        getTaskCurrentRefinementLevel(
          WorkStatus.RefiningDescription,
          TWO_LEVEL,
        ),
      ).toBe('description');
      expect(
        getTaskCurrentRefinementLevel(WorkStatus.Backlog, SINGLE_LEVEL),
      ).toBe('description');
    });

    it('maps acceptance statuses to acceptanceCriteria only for a two-level set', () => {
      expect(
        getTaskCurrentRefinementLevel(
          WorkStatus.RefiningAcceptanceCriteria,
          TWO_LEVEL,
        ),
      ).toBe('acceptanceCriteria');
      // A single-level type never reports the acceptanceCriteria level.
      expect(
        getTaskCurrentRefinementLevel(
          WorkStatus.RefiningAcceptanceCriteria,
          SINGLE_LEVEL,
        ),
      ).toBe('description');
    });
  });

  describe('getTaskActiveSection', () => {
    it('returns review for terminal/review statuses', () => {
      expect(getTaskActiveSection(WorkStatus.Active, TWO_LEVEL)).toBe(
        TaskActiveSectionEnum.review,
      );
    });

    it('reflects the current refinement level for active refinement statuses', () => {
      expect(
        getTaskActiveSection(WorkStatus.RefiningDescription, TWO_LEVEL),
      ).toBe(TaskActiveSectionEnum.description);
      expect(
        getTaskActiveSection(WorkStatus.RefiningAcceptanceCriteria, TWO_LEVEL),
      ).toBe(TaskActiveSectionEnum.acceptanceCriteria);
    });
  });

  describe('getTaskNextRefinementLevel', () => {
    it('advances description -> acceptanceCriteria in a two-level set', () => {
      expect(getTaskNextRefinementLevel('description', TWO_LEVEL)).toBe(
        'acceptanceCriteria',
      );
      expect(getTaskNextRefinementLevel('acceptanceCriteria', TWO_LEVEL)).toBe(
        null,
      );
    });

    it('has no next level in a single-level set', () => {
      expect(getTaskNextRefinementLevel('description', SINGLE_LEVEL)).toBe(
        null,
      );
    });
  });

  describe('getTaskPreviousRefinementLevel', () => {
    it('steps back acceptanceCriteria -> description in a two-level set', () => {
      expect(
        getTaskPreviousRefinementLevel('acceptanceCriteria', TWO_LEVEL),
      ).toBe('description');
      expect(getTaskPreviousRefinementLevel('description', TWO_LEVEL)).toBe(
        null,
      );
    });
  });

  describe('getTaskNextRefinementLevelFromStatus', () => {
    it('returns acceptanceCriteria as the next level from a description status (two-level)', () => {
      expect(
        getTaskNextRefinementLevelFromStatus(
          WorkStatus.RefiningDescription,
          TWO_LEVEL,
        ),
      ).toBe('acceptanceCriteria');
    });

    it('returns null from a description status in a single-level set', () => {
      expect(
        getTaskNextRefinementLevelFromStatus(
          WorkStatus.RefiningDescription,
          SINGLE_LEVEL,
        ),
      ).toBe(null);
    });
  });

  describe('getTaskNextStatus', () => {
    it('advances to the acceptance-criteria refining status for a two-level set', () => {
      expect(getTaskNextStatus(WorkStatus.RefiningDescription, TWO_LEVEL)).toBe(
        WorkStatus.RefiningAcceptanceCriteria,
      );
    });

    it('finalizes to ACTIVE when there is no next level (single-level set)', () => {
      expect(
        getTaskNextStatus(WorkStatus.RefiningDescription, SINGLE_LEVEL),
      ).toBe(WorkStatus.Active);
    });
  });

  describe('canTaskFinalizeAtLevel', () => {
    it('finalizes a single-level type at description', () => {
      expect(canTaskFinalizeAtLevel('description', SINGLE_LEVEL)).toBe(true);
      expect(canTaskFinalizeAtLevel('acceptanceCriteria', SINGLE_LEVEL)).toBe(
        false,
      );
    });

    it('finalizes a two-level type only at acceptanceCriteria', () => {
      expect(canTaskFinalizeAtLevel('acceptanceCriteria', TWO_LEVEL)).toBe(
        true,
      );
      expect(canTaskFinalizeAtLevel('description', TWO_LEVEL)).toBe(false);
    });
  });

  describe('getTaskRefinementProgressPercentage', () => {
    it('reports 100% at the sole level of a single-level type', () => {
      expect(
        getTaskRefinementProgressPercentage('description', SINGLE_LEVEL),
      ).toBe(100);
    });

    it('reports 50% then 100% across a two-level type', () => {
      expect(
        getTaskRefinementProgressPercentage('description', TWO_LEVEL),
      ).toBe(50);
      expect(
        getTaskRefinementProgressPercentage('acceptanceCriteria', TWO_LEVEL),
      ).toBe(100);
    });
  });
});
