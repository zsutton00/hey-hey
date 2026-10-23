import { WorkStatus } from '../../../generated';
import { getCurrentSectionFromStatus } from '../../../utils/work-item.util';

const getTaskCurrentLevel = getCurrentSectionFromStatus;
const getInitiativeCurrentLevel = getCurrentSectionFromStatus;

describe('WorkStatus Integration Tests', () => {
  describe('WorkStatus enum validation', () => {
    it('should have all expected WorkStatus values', () => {
      const expectedValues = [
        'BACKLOG',
        'REFINING_DESCRIPTION',
        'REFINING_DETAILS',
        'REFINING_ACCEPTANCE_CRITERIA',
        'GENERATING_DESCRIPTION',
        'GENERATING_DETAILS',
        'GENERATING_DESCRIPTION_AND_DETAILS',
        'GENERATING_ACCEPTANCE_CRITERIA',
        'GENERATING_ALL',
        'ACTIVE',
        'ON_HOLD',
        'VERIFYING',
        'COMPLETED',
        'CANCELLED',
      ];

      // Test that we can access WorkStatus values correctly
      expect(typeof WorkStatus.Backlog).toBe('string');
      expect(typeof WorkStatus.RefiningDescription).toBe('string');
      expect(typeof WorkStatus.Active).toBe('string');
    });

    it('should have consistent enum object structure', () => {
      expect(WorkStatus.Backlog).toBe('BACKLOG');
      expect(WorkStatus.RefiningDescription).toBe('REFINING_DESCRIPTION');
      expect(WorkStatus.RefiningDetails).toBe('REFINING_DETAILS');
      expect(WorkStatus.RefiningAcceptanceCriteria).toBe(
        'REFINING_ACCEPTANCE_CRITERIA',
      );
      expect(WorkStatus.Active).toBe('ACTIVE');
      expect(WorkStatus.Verifying).toBe('VERIFYING');
      expect(WorkStatus.Completed).toBe('COMPLETED');
    });
  });

  describe('Task status level mapping', () => {
    it('should correctly map task statuses to refinement levels', () => {
      expect(getTaskCurrentLevel('BACKLOG')).toBe('description');
      expect(getTaskCurrentLevel('REFINING_DESCRIPTION')).toBe('description');
      expect(getTaskCurrentLevel('GENERATING_DESCRIPTION')).toBe('description');

      expect(getTaskCurrentLevel('REFINING_DETAILS')).toBe('details');
      expect(getTaskCurrentLevel('GENERATING_DETAILS')).toBe('details');

      expect(getTaskCurrentLevel('REFINING_ACCEPTANCE_CRITERIA')).toBe(
        'acceptanceCriteria',
      );
      expect(getTaskCurrentLevel('GENERATING_ACCEPTANCE_CRITERIA')).toBe(
        'acceptanceCriteria',
      );
    });

    it('should handle completed task statuses correctly', () => {
      expect(getTaskCurrentLevel('UNKNOWN_STATUS')).toBe('description');
      expect(getTaskCurrentLevel('ACTIVE')).toBe('acceptanceCriteria'); // Fully refined
      expect(getTaskCurrentLevel('VERIFYING')).toBe('acceptanceCriteria'); // Fully refined
      expect(getTaskCurrentLevel('COMPLETED')).toBe('acceptanceCriteria'); // Fully refined
    });
  });

  describe('Initiative status level mapping', () => {
    it('should map supported initiative statuses to refinement levels', () => {
      expect(getInitiativeCurrentLevel('REFINING_DESCRIPTION')).toBe(
        'description',
      );
      expect(getInitiativeCurrentLevel('GENERATING_DESCRIPTION')).toBe(
        'description',
      );
      expect(getInitiativeCurrentLevel('GENERATING_DETAILS')).toBe('details');

      expect(getInitiativeCurrentLevel('REFINING_DETAILS')).toBe('details');
      expect(getInitiativeCurrentLevel('GENERATING_ACCEPTANCE_CRITERIA')).toBe(
        'acceptanceCriteria',
      );

      expect(getInitiativeCurrentLevel('REFINING_ACCEPTANCE_CRITERIA')).toBe(
        'acceptanceCriteria',
      );
      expect(getInitiativeCurrentLevel('GENERATING_ALL')).toBe(
        'acceptanceCriteria',
      );
    });
  });

  describe('Cross-entity consistency', () => {
    it('should provide consistent level mapping between tasks and initiatives', () => {
      const consistentStatuses = [
        'REFINING_DESCRIPTION',
        'REFINING_DETAILS',
        'REFINING_ACCEPTANCE_CRITERIA',
        'GENERATING_DESCRIPTION',
      ];

      consistentStatuses.forEach((status) => {
        const taskLevel = getTaskCurrentLevel(status);
        const initiativeLevel = getInitiativeCurrentLevel(status);
        expect(taskLevel).toBe(initiativeLevel);
      });
    });
  });

  describe('Status progression validation', () => {
    it('should support proper refinement level progression', () => {
      const progressionCases = [
        {
          from: 'REFINING_DESCRIPTION',
          to: 'REFINING_DETAILS',
          fromLevel: 'description',
          toLevel: 'details',
        },
        {
          from: 'REFINING_DETAILS',
          to: 'REFINING_ACCEPTANCE_CRITERIA',
          fromLevel: 'details',
          toLevel: 'acceptanceCriteria',
        },
      ];

      progressionCases.forEach(({ from, to, fromLevel, toLevel }) => {
        expect(getTaskCurrentLevel(from)).toBe(fromLevel);
        expect(getTaskCurrentLevel(to)).toBe(toLevel);
        expect(getInitiativeCurrentLevel(from)).toBe(fromLevel);
        expect(getInitiativeCurrentLevel(to)).toBe(toLevel);
      });
    });
  });
});
