import { describe, expect, it } from 'vitest';
import {
  toTaskMonitorReviewLifecycleMessage,
  toTaskMonitorSupervisionMessage,
} from './task-monitor-decision-message';

describe('toTaskMonitorSupervisionMessage', () => {
  it('maps acceptance to rationale without guidance', () => {
    expect(
      toTaskMonitorSupervisionMessage('project-1', {
        action: 'ACCEPT_TASK',
        rationale: 'The canonical evidence fulfills the selected Task.',
      }).data,
    ).toEqual({
      type: 'TASK_MONITOR_SUPERVISION',
      response: 'The canonical evidence fulfills the selected Task.',
      agentIdentity: 'task-monitor-coordinator',
      outcome: 'ACCEPTED',
      rationale: 'The canonical evidence fulfills the selected Task.',
    });
  });

  it('maps requested changes to rationale and guidance', () => {
    expect(
      toTaskMonitorSupervisionMessage('project-1', {
        action: 'REQUEST_CHANGES',
        rationale: 'One acceptance check remains unresolved.',
        guidance: 'Run the focused check and publish its canonical result.',
      }).data,
    ).toEqual({
      type: 'TASK_MONITOR_SUPERVISION',
      response: 'One acceptance check remains unresolved.',
      agentIdentity: 'task-monitor-coordinator',
      outcome: 'CHANGES_REQUESTED',
      rationale: 'One acceptance check remains unresolved.',
      guidance: 'Run the focused check and publish its canonical result.',
    });
  });

  it.each([
    [{ action: 'WAIT', rationale: 'Evidence is settling.' }, 'WAITING'],
    [
      {
        action: 'REQUEST_JUDGMENT',
        rationale: 'A user choice is required.',
        guidance: 'Choose A or B.',
      },
      'JUDGMENT_REQUESTED',
    ],
    [
      {
        action: 'HALT',
        rationale: 'The contract conflicts.',
        failureContext: 'Two authoritative requirements disagree.',
      },
      'HALTED',
    ],
  ] as const)('maps %s to %s', (decision, outcome) => {
    expect(toTaskMonitorSupervisionMessage('project-1', decision).data).toMatchObject({ outcome });
  });

  it('requires Review decisions to use a stable-identity lifecycle projection', () => {
    expect(() =>
      toTaskMonitorSupervisionMessage('project-1', {
        action: 'REQUEST_REVIEW',
        rationale: 'Review is required.',
      }),
    ).toThrow('durable lifecycle');

    expect(
      toTaskMonitorReviewLifecycleMessage('project-1', {
        outcome: 'AWAITING_REVIEW',
        requestId: '22222222-2222-4222-8222-222222222222',
        rationale: 'Review is required.',
      }).data,
    ).toMatchObject({
      outcome: 'AWAITING_REVIEW',
      requestId: '22222222-2222-4222-8222-222222222222',
    });
  });
});
