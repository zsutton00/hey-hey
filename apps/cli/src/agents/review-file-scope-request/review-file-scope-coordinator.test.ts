import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestRun,
  createTestRunStore,
  createTestMessagePoster,
} from '../../run/run.test-support';
import { NOOP_LOGGER } from '../../server/logger';
import type { AgentSessionReviewFileScopeRequest } from '../../shared/api/generated/api';
import type { RunFollowUpAdmission } from '../../server/input-admission/input-admission-payload';
import { ReviewFileScopeCoordinator } from './review-file-scope-coordinator';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'review-recovery-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

async function fixture() {
  const store = createTestRunStore();
  vi.spyOn(store, 'readDurableRunEvents').mockResolvedValue([]);
  const poster = createTestMessagePoster();
  const admission: RunFollowUpAdmission = {
    inspectReviewContinuation: vi.fn(async () => ({ userId: 'user-1', settled: false })),
    admit: vi.fn(async () => ({ replayed: false })),
    durableInputReady: vi.fn(),
  };
  const run = createTestRun({}, { runStore: store, poster, runFollowUpAdmission: admission });
  await run.ensureSeeded();
  run.refreshSessionFields({
    contextMetadata: { ...run.session.contextMetadata, agentSessionId: 'platform-session-1' },
  });
  vi.spyOn(store, 'updateRunReviewFileScopeReconciliations').mockImplementation(
    async () => run.session,
  );
  vi.spyOn(store, 'updateRunReviewFileScopeRequestPresentations').mockImplementation(
    async () => run.session,
  );
  const request: AgentSessionReviewFileScopeRequest = {
    id: 'request-1',
    runId: run.runId,
    sessionId: run.session.agentic_session_id,
    agentId: 'code_review',
    agentType: 'claude',
    timestamp: '2026-10-09T00:00:00.000Z',
    idempotencyToken: 'token-1',
    files: new Set([
      { serviceId: 'service-1', filePath: 'not-yet-created.ts', reason: 'Required repair.' },
    ]),
  };
  run.refreshSessionFields({
    services: [{ id: 'service-1', path: root }],
    launchServiceId: 'service-1',
    reviewFileScopeRequestPresentations: [{ request, messageId: 'message-1' }],
    reviewFileScopeContinuation: {
      input: {
        promptType: 'code_review',
        payload: { userMessage: 'Repair lifecycle.' },
        references: { resolved: [], unresolved: [] },
        triggerContext: null,
        inputAdmissionTurnId: 'original-review',
      },
    },
  });
  const coordinator = new ReviewFileScopeCoordinator({
    runStore: store,
    poster,
    admission,
    logger: NOOP_LOGGER,
  });
  return { run, store, poster, admission, request, coordinator };
}

describe('legacy Review compatibility', () => {
  it('reconciles persisted requests when their owning Run activates', async () => {
    const { run, store, poster, admission } = await fixture();
    const restored = createTestRun(
      { session: run.session },
      {
        runStore: store,
        poster,
        runFollowUpAdmission: admission,
      },
    );
    await restored.ensureSeeded();
    expect(admission.admit).toHaveBeenCalledOnce();
    expect(restored.session.reviewFileScopeRequestPresentations?.[0]?.closed).toBe(true);
  });

  it('rechecks canonical settlement after persisting its continuation disposition', async () => {
    const { run, admission, coordinator } = await fixture();
    vi.mocked(admission.inspectReviewContinuation!)
      .mockResolvedValueOnce({ userId: 'user-1', settled: false })
      .mockResolvedValueOnce({ userId: 'user-1', settled: true });
    await coordinator.reconcile(run);
    expect(admission.admit).not.toHaveBeenCalled();
    expect(run.session.reviewFileScopeReconciliations?.[0]).toMatchObject({
      disposition: 'settled',
      input: null,
    });
  });

  it('preserves malformed reconciliation evidence without executing its continuation', async () => {
    const { run, admission, coordinator } = await fixture();
    const malformed = {
      requestId: 'request-1',
      stableKey: 'review-service-recovery:original-review',
      turnId: 'original-review',
      disposition: 'continue' as const,
      input: null,
      userId: 'user-1',
      delivered: false,
    };
    run.refreshSessionFields({ reviewFileScopeReconciliations: [malformed] });
    await coordinator.reconcile(run);
    expect(admission.admit).not.toHaveBeenCalled();
    expect(run.session.reviewFileScopeReconciliations).toEqual([malformed]);
  });
  it('continues a live Review without approving files or adding canonical membership', async () => {
    const { run, store, poster, admission, coordinator, request } = await fixture();
    await coordinator.reconcile(run);
    expect(admission.admit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        stableKey: 'review-service-recovery:original-review',
        payload: {
          kind: 'run_follow_up',
          origin: 'review_service_recovery',
          replacesTurnId: 'original-review',
          requestId: 'review-service-recovery:original-review',
          agentInput: { promptType: 'code_review', userMessage: 'Repair lifecycle.' },
        },
      }),
    );
    expect(store.updateRunReviewFileScopeReconciliations).toHaveBeenCalledBefore(
      vi.mocked(admission.admit),
    );
    expect(run.session.reviewFileScopeRequestPresentations?.[0]).toEqual({
      request,
      messageId: 'message-1',
      closed: true,
    });
    expect(poster.complete).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'message-1',
      expect.objectContaining({ data: expect.objectContaining({ uiElements: [] }) }),
      null,
    );
    expect(run.getFileChangeProjection()).toEqual([]);
  });

  it('drops concurrent and repeated stale approve or deny decisions without repeating execution', async () => {
    const { run, admission, coordinator, request } = await fixture();
    const decision = {
      requestId: request.id,
      sessionId: request.sessionId,
      agentType: request.agentType,
      idempotencyToken: request.idempotencyToken,
      decision: 'deny' as const,
      reason: null,
    };
    const results = await Promise.all([
      coordinator.decide(run, decision),
      coordinator.decide(run, decision),
    ]);
    await coordinator.decide(run, { ...decision, decision: 'approve' });
    expect(results).toEqual([
      { outcome: 'dropped', reason: 'legacy_review_file_scope_reconciled' },
      { outcome: 'dropped', reason: 'legacy_review_file_scope_reconciled' },
    ]);
    expect(admission.admit).toHaveBeenCalledOnce();
  });

  it.each(['admission', 'event'])(
    'never continues a Review settled in %s evidence',
    async (source) => {
      const { run, store, admission, coordinator } = await fixture();
      if (source === 'admission')
        vi.mocked(admission.inspectReviewContinuation!).mockResolvedValue({
          userId: 'user-1',
          settled: true,
        });
      else
        vi.spyOn(store, 'readDurableRunEvents').mockResolvedValue([
          {
            eventId: 'event-1',
            runId: run.runId,
            occurredAt: '2026-10-09T00:00:00.000Z',
            payload: {
              kind: 'input_turn_settled',
              turnId: 'original-review',
              status: 'COMPLETED',
              reportIds: [],
            },
          },
        ] as never);
      await coordinator.reconcile(run);
      expect(admission.admit).not.toHaveBeenCalled();
      expect(run.session.reviewFileScopeReconciliations?.[0]).toMatchObject({
        disposition: 'settled',
        delivered: true,
        input: null,
      });
    },
  );

  it('retries presentation failure independently from committed execution', async () => {
    const { run, admission, poster, coordinator } = await fixture();
    vi.mocked(poster.complete).mockRejectedValueOnce(new Error('presentation unavailable'));
    await coordinator.reconcile(run);
    expect(run.session.reviewFileScopeRequestPresentations?.[0]?.closed).toBeUndefined();
    await coordinator.reconcile(run);
    expect(poster.complete).toHaveBeenCalledTimes(2);
    expect(admission.admit).toHaveBeenCalledOnce();
    expect(run.session.reviewFileScopeRequestPresentations?.[0]?.closed).toBe(true);
  });

  it('replays the same durable identity after a crash between admission and delivery persistence', async () => {
    const { run, admission, store, poster, coordinator } = await fixture();
    vi.mocked(store.updateRunReviewFileScopeReconciliations)
      .mockResolvedValueOnce(run.session)
      .mockRejectedValueOnce(new Error('interrupted'));
    await coordinator.reconcile(run);
    expect(run.session.reviewFileScopeReconciliations?.[0]?.delivered).toBe(false);
    const restored = new ReviewFileScopeCoordinator({
      runStore: store,
      poster,
      admission,
      logger: NOOP_LOGGER,
    });
    vi.mocked(admission.admit).mockResolvedValue({ replayed: true });
    await restored.reconcile(run);
    expect(vi.mocked(admission.admit).mock.calls.map(([input]) => input.stableKey)).toEqual([
      'review-service-recovery:original-review',
      'review-service-recovery:original-review',
    ]);
    expect(run.session.reviewFileScopeReconciliations?.[0]?.delivered).toBe(true);
  });

  it('isolates a corrupt presentation from a healthy request in the same Run', async () => {
    const { run, admission, coordinator } = await fixture();
    run.refreshSessionFields({
      reviewFileScopeRequestPresentations: [
        null as never,
        ...run.session.reviewFileScopeRequestPresentations!,
      ],
    });
    await coordinator.reconcile(run);
    expect(admission.admit).toHaveBeenCalledOnce();
    expect(run.session.reviewFileScopeRequestPresentations?.[0]).toBeNull();
    expect(run.session.reviewFileScopeRequestPresentations?.[1]?.closed).toBe(true);
  });
  it('isolates unreadable admission evidence from an independent healthy Run and preserves the request', async () => {
    const invalid = await fixture();
    const healthy = await fixture();
    vi.mocked(invalid.admission.inspectReviewContinuation!).mockRejectedValue(
      new Error('unreadable admission'),
    );
    await Promise.all([
      invalid.coordinator.reconcile(invalid.run),
      healthy.coordinator.reconcile(healthy.run),
    ]);
    expect(invalid.admission.admit).not.toHaveBeenCalled();
    expect(invalid.run.session.reviewFileScopeRequestPresentations?.[0]?.request).toEqual(
      invalid.request,
    );
    expect(invalid.run.session.reviewFileScopeReconciliations).toBeUndefined();
    expect(healthy.admission.admit).toHaveBeenCalledOnce();
    expect(invalid.poster.complete).toHaveBeenCalledOnce();
  });

  it('reconciles older decided continuations after their presentation was removed', async () => {
    const { run, admission, coordinator } = await fixture();
    const continuation = run.session.reviewFileScopeContinuation!;
    run.refreshSessionFields({
      reviewFileScopeRequestPresentations: [],
      reviewFileScopeContinuation: {
        input: {
          ...continuation.input,
          payload: {
            userMessage: 'Repair lifecycle.',
            _reviewFileScopeDecision: { requestId: 'request-1', decision: 'approve', files: [] },
          } as never,
        },
      },
    });
    await coordinator.reconcile(run);
    expect(admission.admit).toHaveBeenCalledOnce();
    expect(vi.mocked(admission.admit).mock.calls[0]?.[0].payload.agentInput).not.toHaveProperty(
      '_reviewFileScopeDecision',
    );
  });

  it('uses the authoritative worktree even when the host checkout no longer exists', async () => {
    const { run, admission, coordinator } = await fixture();
    run.refreshSessionFields({
      services: [{ id: 'service-1', path: path.join(root, 'missing-host') }],
      worktreeState: { 'service-1': { branch: 'review', worktreePath: root } } as never,
    });
    await coordinator.reconcile(run);
    expect(admission.admit).toHaveBeenCalledOnce();
  });

  it('does not deliver without an accessible authorized workspace', async () => {
    const { run, admission, coordinator } = await fixture();
    run.refreshSessionFields({ services: [{ id: 'service-1', path: path.join(root, 'missing') }] });
    await coordinator.reconcile(run);
    expect(admission.admit).not.toHaveBeenCalled();
    expect(run.session.reviewFileScopeReconciliations?.[0]?.delivered).toBe(false);
  });
});
