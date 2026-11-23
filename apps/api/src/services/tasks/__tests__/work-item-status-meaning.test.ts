import {
  isFinishedMeaning,
  isInProgressMeaning,
  statusGroupOf,
} from '../work-item-status-groups';

describe('reading a status meaning', () => {
  it('treats Completed and Cancelled as finished and everything else as not finished', () => {
    expect(isFinishedMeaning({ kind: 'COMPLETED' })).toBe(true);
    expect(isFinishedMeaning({ kind: 'CANCELLED' })).toBe(true);
    expect(isFinishedMeaning({ kind: 'IN_PROGRESS' })).toBe(false);
    expect(
      isFinishedMeaning({ kind: 'CUSTOM', text: 'Completed, really' }),
    ).toBe(false);
    expect(isFinishedMeaning(undefined)).toBe(false);
  });

  it('treats only the built-in In progress meaning as work underway', () => {
    expect(isInProgressMeaning({ kind: 'IN_PROGRESS' })).toBe(true);
    expect(isInProgressMeaning({ kind: 'CUSTOM', text: 'In progress' })).toBe(
      false,
    );
    expect(isInProgressMeaning({ kind: 'COMPLETED' })).toBe(false);
  });

  it('groups statuses for agent search by meaning, never by the custom words', () => {
    const group = (meaning: Parameters<typeof isFinishedMeaning>[0]) =>
      statusGroupOf({ name: 'Anything', meaning: meaning! });

    expect(group({ kind: 'COMPLETED' })).toBe('DONE');
    expect(group({ kind: 'CANCELLED' })).toBe('CANCELLED');
    expect(group({ kind: 'IN_PROGRESS' })).toBe('IN_PROGRESS');
    expect(group({ kind: 'CUSTOM', text: 'Done' })).toBe('BACKLOG');
  });
});
