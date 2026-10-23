import { afterEach, describe, expect, it, vi } from 'vitest';

import { NOOP_LOGGER } from '../server/logger';
import {
  RunProposalTracker,
  type RunProposalTrackerDeps,
  type TrackedProposalStatus,
} from './run-proposal-tracker';

const created = (overrides: Partial<TrackedProposalStatus> = {}): TrackedProposalStatus => ({
  status: 'APPROVED',
  action: 'CREATE',
  targetEntityId: 'task-9',
  targetEntityType: 'TASK',
  ...overrides,
});

const makeHarness = (statuses: Record<string, () => Promise<TrackedProposalStatus>>) => {
  const lookupProposal = vi.fn<RunProposalTrackerDeps['lookupProposal']>((id) =>
    (statuses[id] as () => Promise<TrackedProposalStatus>)(),
  );
  const lookupEntityTitle = vi.fn<RunProposalTrackerDeps['lookupEntityTitle']>(() =>
    Promise.resolve('Fix the thing'),
  );
  const tracker = new RunProposalTracker({
    runId: 'run-1',
    logger: NOOP_LOGGER,
    lookupProposal,
    lookupEntityTitle,
  });
  return { tracker, lookupProposal, lookupEntityTitle };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('RunProposalTracker', () => {
  it('names the created item for an approved create', async () => {
    const { tracker } = makeHarness({ 'p-1': () => Promise.resolve(created()) });
    tracker.record('p-1');

    const notices = await tracker.refresh();

    expect(notices.proposalIds).toEqual(['p-1']);
    expect(notices.lines).toEqual([
      'Proposal p-1 was approved by the user and created @[task:task-9|Fix the thing]; reference that item, not the proposal.',
    ]);
  });

  it('still announces a created item that has no readable title', async () => {
    const { tracker, lookupEntityTitle } = makeHarness({
      'p-1': () => Promise.resolve(created()),
    });
    lookupEntityTitle.mockResolvedValue(null);
    tracker.record('p-1');

    const notices = await tracker.refresh();

    expect(notices.lines).toEqual([
      'Proposal p-1 was approved by the user and created task task-9, which no longer has a readable title; reference that item, not the proposal.',
    ]);
    tracker.delivered(notices);
    expect((await tracker.refresh()).lines).toEqual([]);
  });

  it('says only approved for a non-create action', async () => {
    const { tracker, lookupEntityTitle } = makeHarness({
      'p-1': () => Promise.resolve(created({ action: 'UPDATE' })),
    });
    tracker.record('p-1');

    expect((await tracker.refresh()).lines).toEqual(['Proposal p-1 was approved by the user.']);
    expect(lookupEntityTitle).not.toHaveBeenCalled();
  });

  it('says rejected for a rejected proposal', async () => {
    const { tracker } = makeHarness({
      'p-1': () => Promise.resolve(created({ status: 'REJECTED' })),
    });
    tracker.record('p-1');

    expect((await tracker.refresh()).lines).toEqual(['Proposal p-1 was rejected by the user.']);
  });

  it('adds nothing while a proposal is pending and keeps it tracked', async () => {
    let status = 'PENDING';
    const { tracker, lookupProposal } = makeHarness({
      'p-1': () => Promise.resolve(created({ status })),
    });
    tracker.record('p-1');

    expect((await tracker.refresh()).lines).toEqual([]);
    status = 'APPROVED';
    expect((await tracker.refresh()).proposalIds).toEqual(['p-1']);
    expect(lookupProposal).toHaveBeenCalledTimes(2);
  });

  it('skips a failed lookup and retries on the next refresh', async () => {
    let fail = true;
    const { tracker } = makeHarness({
      'p-1': () => (fail ? Promise.reject(new Error('boom')) : Promise.resolve(created())),
    });
    tracker.record('p-1');

    expect((await tracker.refresh()).lines).toEqual([]);
    fail = false;
    expect((await tracker.refresh()).proposalIds).toEqual(['p-1']);
  });

  it('skips a slow lookup after the timeout and keeps the proposal tracked', async () => {
    vi.useFakeTimers();
    let slow = true;
    const { tracker } = makeHarness({
      'p-1': () =>
        slow ? new Promise<TrackedProposalStatus>(() => undefined) : Promise.resolve(created()),
    });
    tracker.record('p-1');

    const pending = tracker.refresh();
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await pending).lines).toEqual([]);

    slow = false;
    expect((await tracker.refresh()).proposalIds).toEqual(['p-1']);
  });

  it('stops tracking a forgotten proposal', async () => {
    const { tracker, lookupProposal } = makeHarness({ 'p-1': () => Promise.resolve(created()) });
    tracker.record('p-1');
    tracker.forget('p-1');

    expect((await tracker.refresh()).lines).toEqual([]);
    expect(lookupProposal).not.toHaveBeenCalled();
  });

  it('keeps notices until delivered, then never repeats them', async () => {
    const { tracker } = makeHarness({ 'p-1': () => Promise.resolve(created()) });
    tracker.record('p-1');

    const first = await tracker.refresh();
    expect((await tracker.refresh()).lines).toEqual(first.lines);

    tracker.delivered(first);
    expect((await tracker.refresh()).lines).toEqual([]);
  });
});
