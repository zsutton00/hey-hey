import { describe, expect, it, vi } from 'vitest';
import { normalizeEvent } from '../normalize';
import { handlePermission } from './permission';
import { handlePermissionGroupItemAdded } from './permission-group-item-added';
import { handlePermissionDecisionRecorded } from './permission-decision-recorded';
import { makePoster, makeDeps, makeTestRun } from './__test-utils';
import type {
  LocalAgentOutputEvent,
  PermissionDecisionRecordedEvent,
  PermissionEvent,
  PermissionGroupItemAddedEvent,
} from '../types';
import type { Run } from '../run';
import type { AgentRequestPermissionPayload, SystemMessageData } from '../../shared/api/index';

const base = {
  runId: 'run-1',
  source: 'local',
  timestamp: '2025-01-01T00:00:00.000Z',
  sessionId: 'session-1',
  agentId: 'claude',
} as const;

const leaderEvent: LocalAgentOutputEvent = {
  ...base,
  eventType: 'permission_request_detected',
  payload: {
    enrichment_metadata: { referenced_files: [], reason: 'WebSearch: query=alpha' },
    permission_request: {
      id: 'perm-1',
      permission_type: 'WebSearch',
      session_id: 'session-1',
      agent_id: 'claude',
      agent_type: 'claude',
      timestamp: '2025-01-01T00:00:00.000Z',
      idempotency_token: 'perm-1',
      run_id: 'run-1',
    },
  },
};

const joined = (requestId: string, description: string): LocalAgentOutputEvent => ({
  ...base,
  eventType: 'permission_group_item_added',
  payload: { cardRequestId: 'perm-1', cardDescription: 'alpha', requestId, description },
});

const decided = (requestId: string, decision: 'approve' | 'deny'): LocalAgentOutputEvent => ({
  ...base,
  eventType: 'permission_decision_ui',
  payload: { requestId, decision, decidedAt: '2025-01-01T00:01:00.000Z' },
});

/** A Run with its real permission-card bookkeeping. */
const makeCardRun = (): Run => {
  const run = makeTestRun();
  vi.mocked(run.recordPermissionRequestMessage).mockRestore();
  vi.mocked(run.getPermissionRequestMessage).mockRestore();

  return run;
};

const cardPayload = (data: SystemMessageData): AgentRequestPermissionPayload =>
  data.uiElements?.[0]?.payload as unknown as AgentRequestPermissionPayload;

describe('grouped permission card message', () => {
  it('keeps one message with a decision per row and completes it once every row is decided', async () => {
    const poster = makePoster();
    const deps = makeDeps(poster);
    const ctx = makeCardRun();

    await handlePermission(normalizeEvent(leaderEvent, 'claude') as PermissionEvent, ctx, deps);
    for (const [id, description] of [
      ['perm-2', 'beta'],
      ['perm-3', 'gamma'],
    ] as const) {
      await handlePermissionGroupItemAdded(
        normalizeEvent(joined(id, description), 'claude') as PermissionGroupItemAddedEvent,
        ctx,
        deps,
      );
    }

    // Only one message was ever created; the joins updated it in place.
    expect(poster.createOutOfBand).toHaveBeenCalledOnce();
    const afterJoins = (poster.update as ReturnType<typeof vi.fn>).mock.calls.at(-1)![3]
      .data as SystemMessageData;
    expect(
      cardPayload(afterJoins).groupedRequests?.map((row) => [row.requestId, row.description]),
    ).toEqual([
      ['perm-1', 'alpha'],
      ['perm-2', 'beta'],
      ['perm-3', 'gamma'],
    ]);

    // Deciding one row leaves the message open and records only that row.
    await handlePermissionDecisionRecorded(
      normalizeEvent(decided('perm-2', 'deny'), 'claude') as PermissionDecisionRecordedEvent,
      ctx,
      deps,
    );
    expect(poster.complete).not.toHaveBeenCalled();
    const afterOne = ctx.getPermissionRequestMessage('perm-3')!.data!;
    expect(cardPayload(afterOne).groupedRequests?.map((row) => row.decision ?? null)).toEqual([
      null,
      'deny',
      null,
    ]);
    expect(cardPayload(afterOne).decision ?? null).toBeNull();

    await handlePermissionDecisionRecorded(
      normalizeEvent(decided('perm-1', 'approve'), 'claude') as PermissionDecisionRecordedEvent,
      ctx,
      deps,
    );
    await handlePermissionDecisionRecorded(
      normalizeEvent(decided('perm-3', 'approve'), 'claude') as PermissionDecisionRecordedEvent,
      ctx,
      deps,
    );

    expect(poster.complete).toHaveBeenCalledOnce();
    const completed = (poster.complete as ReturnType<typeof vi.fn>).mock.calls[0]![3] as {
      status: string;
      data: SystemMessageData;
    };
    expect(completed.status).toBe('completed');
    expect(cardPayload(completed.data)).toMatchObject({
      decision: 'approve',
      groupedRequests: [
        { requestId: 'perm-1', decision: 'approve' },
        { requestId: 'perm-2', decision: 'deny' },
        { requestId: 'perm-3', decision: 'approve' },
      ],
    });
  });

  it('keeps a request that joins before the first card has finished posting', async () => {
    const poster = makePoster();
    let finishPost: (messageId: string) => void = () => {};
    vi.mocked(poster.createOutOfBand).mockImplementation(
      () => new Promise<string>((resolve) => (finishPost = resolve)),
    );
    const deps = makeDeps(poster);
    const ctx = makeCardRun();

    // The first card is still being posted when two more requests arrive,
    // the second of them before the card's own event has even been handled.
    const joinEarly = handlePermissionGroupItemAdded(
      normalizeEvent(joined('perm-2', 'beta'), 'claude') as PermissionGroupItemAddedEvent,
      ctx,
      deps,
    );
    const leader = handlePermission(
      normalizeEvent(leaderEvent, 'claude') as PermissionEvent,
      ctx,
      deps,
    );
    const joinDuringPost = handlePermissionGroupItemAdded(
      normalizeEvent(joined('perm-3', 'gamma'), 'claude') as PermissionGroupItemAddedEvent,
      ctx,
      deps,
    );
    expect(poster.update).not.toHaveBeenCalled();

    finishPost('card-msg-1');
    await Promise.all([joinEarly, leader, joinDuringPost]);

    expect(deps.logger.warn).not.toHaveBeenCalled();
    const rows = cardPayload(ctx.getPermissionRequestMessage('perm-3')!.data!).groupedRequests;
    expect(rows?.map((row) => [row.requestId, row.description])).toEqual([
      ['perm-1', 'alpha'],
      ['perm-2', 'beta'],
      ['perm-3', 'gamma'],
    ]);
    expect(ctx.getPermissionRequestMessage('perm-2')).toBe(
      ctx.getPermissionRequestMessage('perm-1'),
    );
  });
});
