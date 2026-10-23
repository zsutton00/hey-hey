import { WorkStatus } from '../../../generated';
import {
  isPreExecutionStepStatus,
  isTerminalStepStatus,
  mapTaskStatusToPlanStepStatus,
} from '../plan-step-status.util';

describe('plan-step-status.util', () => {
  describe('mapTaskStatusToPlanStepStatus', () => {
    it('projects a cancelled task to the terminal SKIPPED step status', () => {
      expect(mapTaskStatusToPlanStepStatus(WorkStatus.Cancelled)).toBe(
        'SKIPPED',
      );
    });

    it('keeps backlog and archived tasks on the pre-execution NOT_STARTED status', () => {
      expect(mapTaskStatusToPlanStepStatus(WorkStatus.Backlog)).toBe(
        'NOT_STARTED',
      );
      expect(mapTaskStatusToPlanStepStatus(WorkStatus.Archived)).toBe(
        'NOT_STARTED',
      );
    });

    it('projects a ready task to the execution-ready plan step status', () => {
      expect(mapTaskStatusToPlanStepStatus(WorkStatus.Ready)).toBe('READY');
    });

    it('maps an active task to IN_PROGRESS and a completed task to COMPLETE', () => {
      expect(mapTaskStatusToPlanStepStatus(WorkStatus.Active)).toBe(
        'IN_PROGRESS',
      );
      expect(mapTaskStatusToPlanStepStatus(WorkStatus.Completed)).toBe(
        'COMPLETE',
      );
    });

    it('throws on unsupported task statuses instead of falling back', () => {
      expect(() =>
        mapTaskStatusToPlanStepStatus('NOT_A_STATUS' as WorkStatus),
      ).toThrow('Unsupported task status for plan step mapping: NOT_A_STATUS');
    });
  });

  describe('isTerminalStepStatus', () => {
    it('treats COMPLETE and SKIPPED as terminal', () => {
      expect(isTerminalStepStatus('COMPLETE')).toBe(true);
      expect(isTerminalStepStatus('SKIPPED')).toBe(true);
    });

    it('treats in-flight and pre-execution statuses as non-terminal', () => {
      expect(isTerminalStepStatus('NOT_STARTED')).toBe(false);
      expect(isTerminalStepStatus('READY')).toBe(false);
      expect(isTerminalStepStatus('REFINING')).toBe(false);
      expect(isTerminalStepStatus('IN_PROGRESS')).toBe(false);
      expect(isTerminalStepStatus('VERIFYING')).toBe(false);
      expect(isTerminalStepStatus('BLOCKED')).toBe(false);
    });

    it('does not overlap with isPreExecutionStepStatus', () => {
      const allStatuses = [
        'NOT_STARTED',
        'READY',
        'REFINING',
        'IN_PROGRESS',
        'VERIFYING',
        'BLOCKED',
        'SKIPPED',
        'COMPLETE',
      ];
      for (const status of allStatuses) {
        expect(
          isTerminalStepStatus(status) && isPreExecutionStepStatus(status),
        ).toBe(false);
      }
    });
  });
});
