import fs from 'node:fs/promises';
import { z } from 'zod';
import type { AgentSessionReviewFileScopeRequest } from '../../shared/api/generated/api';
import { MessageStatus, SystemMessageDataTypeEnum } from '../../shared/api/generated/api';
import type { RunStore } from '../../run-store/run-store';
import type { MessagePoster } from '../../run/message-poster';
import type { Run } from '../../run/run';
import type { ServerLogger } from '../../server/logger';
import type { RunFollowUpAdmission } from '../../server/input-admission/input-admission-payload';
import { resolveRunServiceRoots } from '../../run/file-change-facts';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type {
  ReviewFileScopeDecisionInput,
  ReviewFileScopeReconciliation,
  ReviewFileScopeRequestPresentation,
} from './review-file-scope-types';

export type ReviewFileScopeDecisionResult =
  | { outcome: 'dropped'; reason: string }
  | { outcome: 'failed'; reason: string };

const presentationIdentitySchema = z.object({
  request: z.object({
    id: z.string().min(1),
    runId: z.string().min(1),
    sessionId: z.string().min(1),
    agentId: z.literal('code_review'),
    agentType: z.enum(['claude', 'codex', 'opencode']),
    idempotencyToken: z.string().min(1),
  }),
  messageId: z.string().min(1),
});

const reconciliationSchema = z
  .object({
    requestId: z.string().min(1),
    stableKey: z.string().min(1),
    turnId: z.string().min(1),
    disposition: z.enum(['continue', 'settled']),
    input: z
      .object({ userMessage: z.string().optional() })
      .transform((input) =>
        input.userMessage === undefined ? {} : { userMessage: input.userMessage },
      )
      .nullable(),
    userId: z.string().min(1),
    delivered: z.boolean(),
  })
  .refine((record) => record.stableKey === `review-service-recovery:${record.turnId}`, {
    message: 'Legacy Review reconciliation identity is invalid.',
  })
  .refine(
    (record) =>
      record.disposition === 'settled'
        ? record.delivered && record.input === null
        : record.input !== null,
    {
      message: 'Legacy Review continuation disposition is invalid.',
    },
  );

interface ReviewFileScopeCoordinatorDependencies {
  runStore: RunStore;
  poster: MessagePoster;
  logger: ServerLogger;
  admission: RunFollowUpAdmission;
}

/** Compatibility only: original requests are evidence, never new write permissions. */
export class ReviewFileScopeCoordinator {
  private pending: Promise<void> | null = null;

  public constructor(private readonly dependencies: ReviewFileScopeCoordinatorDependencies) {}

  public reconcile(run: Run): Promise<void> {
    if (this.pending) return this.pending;
    const pending = this.reconcileRequests(run).catch(() => {
      this.dependencies.logger.error('local.review_file_scope.reconciliation.failed', {
        runId: run.runId,
        reason: 'unreadable_legacy_review_evidence',
        preserved: true,
      });
    });
    this.pending = pending;
    return pending.finally(() => {
      if (this.pending === pending) this.pending = null;
    });
  }

  public getPresentation(
    run: Run,
    requestId: string,
  ):
    | {
        request: AgentSessionReviewFileScopeRequest;
        messageId: string;
        data: null;
      }
    | undefined {
    const presentation = (run.session.reviewFileScopeRequestPresentations ?? []).find(
      (item) => item?.request?.id === requestId,
    );
    return presentation ? { ...presentation, data: null } : undefined;
  }

  public hasRequest(run: Run, requestId: string): boolean {
    if (
      (run.session.reviewFileScopeRequestPresentations ?? []).some(
        (item) => item?.request?.id === requestId,
      ) ||
      (run.session.reviewFileScopeReconciliations ?? []).some(
        (item) => item?.requestId === requestId,
      )
    )
      return true;
    const legacy = z
      .object({
        _reviewFileScopeDecision: z.object({ requestId: z.string().min(1) }),
      })
      .safeParse(run.session.reviewFileScopeContinuation?.input.payload);
    return legacy.success && legacy.data._reviewFileScopeDecision.requestId === requestId;
  }

  public isSettled(run: Run, requestId: string): boolean {
    const record = run.session.reviewFileScopeReconciliations?.find(
      (item) => item?.requestId === requestId,
    );
    const parsed = reconciliationSchema.safeParse(record);
    return parsed.success && parsed.data.delivered;
  }

  public async decide(
    run: Run,
    input: ReviewFileScopeDecisionInput,
  ): Promise<ReviewFileScopeDecisionResult> {
    const presentation = (run.session.reviewFileScopeRequestPresentations ?? []).find(
      (item) => item?.request?.id === input.requestId,
    );
    if (!presentation) {
      if (this.hasRequest(run, input.requestId)) await this.reconcile(run);
      return { outcome: 'dropped', reason: 'review_file_scope_request_not_found' };
    }
    const request = presentation.request;
    if (
      request.sessionId !== input.sessionId ||
      request.agentType !== input.agentType ||
      request.idempotencyToken !== input.idempotencyToken
    )
      return { outcome: 'dropped', reason: 'review_file_scope_decision_context_mismatch' };
    await this.reconcile(run);
    const record = run.session.reviewFileScopeReconciliations?.find(
      (item) => item?.requestId === request.id,
    );
    if (!record?.delivered)
      return { outcome: 'failed', reason: 'legacy_review_continuation_reconciliation_failed' };
    // The obsolete decision is never delivered as a provider permission or approval.
    return { outcome: 'dropped', reason: 'legacy_review_file_scope_reconciled' };
  }

  private async reconcileRequests(run: Run): Promise<void> {
    const presentations = run.session.reviewFileScopeRequestPresentations ?? [];
    for (const presentation of presentations) {
      const identity = presentationIdentitySchema.safeParse(presentation);
      if (
        !identity.success ||
        identity.data.request.runId !== run.runId ||
        identity.data.request.sessionId !== run.session.agentic_session_id
      ) {
        this.dependencies.logger.error('local.review_file_scope.reconciliation.failed', {
          runId: run.runId,
          reason: 'invalid_legacy_review_request_identity',
          preserved: true,
        });
        continue;
      }
      try {
        await this.reconcileRequest(run, presentation.request);
      } catch (error) {
        this.dependencies.logger.error('local.review_file_scope.reconciliation.failed', {
          runId: run.runId,
          requestId: presentation.request.id,
          reason: error instanceof Error ? error.message : 'legacy_review_reconciliation_failed',
        });
        // Preserve all evidence; this failure belongs only to this Run's continuation.
      }
      try {
        await this.closePresentation(run, presentation);
      } catch (error) {
        this.dependencies.logger.warn('local.review_file_scope.reconciliation.presentation_retry', {
          runId: run.runId,
          requestId: presentation.request.id,
          reason: error instanceof Error ? error.message : 'presentation_closure_failed',
        });
      }
    }
    // Older decided requests removed their presentation, but retained the continuation.
    const legacy = z
      .object({
        _reviewFileScopeDecision: z.object({ requestId: z.string().min(1) }),
      })
      .safeParse(run.session.reviewFileScopeContinuation?.input.payload);
    if (
      legacy.success &&
      !presentations.some(
        (item) => item?.request?.id === legacy.data._reviewFileScopeDecision.requestId,
      )
    ) {
      const requestId = legacy.data._reviewFileScopeDecision.requestId;
      try {
        await this.reconcileRequest(run, {
          id: requestId,
          runId: run.runId,
          sessionId: run.session.agentic_session_id,
          agentId: 'code_review',
        });
      } catch {
        this.dependencies.logger.error('local.review_file_scope.reconciliation.failed', {
          runId: run.runId,
          requestId,
          reason: 'legacy_decided_continuation_unavailable',
        });
      }
    }
  }

  private async save(run: Run, record: ReviewFileScopeReconciliation): Promise<void> {
    const records = [
      ...(run.session.reviewFileScopeReconciliations ?? []).filter(
        (item) => item?.requestId !== record.requestId,
      ),
      record,
    ];
    await this.dependencies.runStore.updateRunReviewFileScopeReconciliations(run.runId, records);
    run.refreshSessionFields({ reviewFileScopeReconciliations: records });
    this.dependencies.logger.debug('local.review_file_scope.reconciliation.persisted', {
      runId: run.runId,
      requestId: record.requestId,
      disposition: record.disposition,
      delivered: record.delivered,
    });
  }

  private async reconcileRequest(
    run: Run,
    request: Pick<AgentSessionReviewFileScopeRequest, 'id' | 'runId' | 'sessionId' | 'agentId'>,
  ): Promise<void> {
    if (
      request.runId !== run.runId ||
      request.sessionId !== run.session.agentic_session_id ||
      request.agentId !== 'code_review'
    )
      throw new Error('Legacy Review request ownership is invalid.');
    const existing = run.session.reviewFileScopeReconciliations?.find(
      (item) => item?.requestId === request.id,
    );
    let record = existing ? reconciliationSchema.parse(existing) : undefined;
    if (!record) {
      const continuation = run.session.reviewFileScopeContinuation;
      const turnId = continuation?.input.inputAdmissionTurnId;
      if (!continuation || !turnId || continuation.input.promptType !== LocalPromptType.CodeReview)
        throw new Error('Legacy Review is missing canonical continuation identity.');
      if (!this.dependencies.admission.inspectReviewContinuation)
        throw new Error('Legacy Review admission evidence is unavailable.');
      const authority = await this.dependencies.admission.inspectReviewContinuation(
        run.agentSessionId,
        run.runId,
        turnId,
      );
      const settled =
        authority.settled ||
        (await this.dependencies.runStore.readDurableRunEvents(run.runId)).some(
          (event) => event.payload.kind === 'input_turn_settled' && event.payload.turnId === turnId,
        );
      const payload = continuation.input.payload;
      const userMessage =
        payload && 'userMessage' in payload && typeof payload.userMessage === 'string'
          ? payload.userMessage
          : undefined;
      record = {
        requestId: request.id,
        stableKey: `review-service-recovery:${turnId}`,
        turnId,
        disposition: settled ? 'settled' : 'continue',
        input: settled
          ? null
          : {
              ...(userMessage !== undefined ? { userMessage } : {}),
            },
        userId: authority.userId,
        delivered: settled,
      };
      await this.save(run, record);
      this.dependencies.logger.info('local.review_file_scope.reconciliation.classified', {
        runId: run.runId,
        requestId: request.id,
        turnId,
        settled,
      });
    }
    if (!record.delivered && record.input) {
      // Recheck settlement on every delivery retry; committed reconciliation is not permission
      // to revive an admission that settled after classification.
      const turnId = record.turnId;
      if (!turnId || !this.dependencies.admission.inspectReviewContinuation)
        throw new Error('Legacy Review delivery is missing canonical admission evidence.');
      const authority = await this.dependencies.admission.inspectReviewContinuation(
        run.agentSessionId,
        run.runId,
        turnId,
      );
      const settled =
        authority.settled ||
        (await this.dependencies.runStore.readDurableRunEvents(run.runId)).some(
          (event) => event.payload.kind === 'input_turn_settled' && event.payload.turnId === turnId,
        );
      if (settled) {
        record = { ...record, disposition: 'settled', input: null, delivered: true };
        await this.save(run, record);
      } else {
        const roots = resolveRunServiceRoots(run.session);
        if (roots.length === 0) throw new Error('Legacy Review has no authorized Service roots.');
        for (const root of roots) await fs.realpath(root.root);
        this.dependencies.logger.debug('local.review_file_scope.reconciliation.authorized', {
          runId: run.runId,
          requestId: request.id,
          serviceIds: roots.map((root) => root.serviceId),
        });
        const userMessage = record.input.userMessage;
        const { replayed } = await this.dependencies.admission.admit({
          stableKey: record.stableKey,
          agentSessionId: run.agentSessionId,
          runId: run.runId,
          organizationId: run.organizationId,
          projectId: run.projectId,
          userId: record.userId,
          payload: {
            kind: 'run_follow_up',
            origin: 'review_service_recovery',
            replacesTurnId: turnId,
            requestId: record.stableKey,
            agentInput: {
              promptType: LocalPromptType.CodeReview,
              ...(userMessage !== undefined ? { userMessage } : {}),
            },
          },
        });
        record = { ...record, delivered: true };
        await this.save(run, record);
        this.dependencies.logger.info('local.review_file_scope.reconciliation.delivered', {
          runId: run.runId,
          requestId: request.id,
          replayed,
        });
      }
    }
  }

  private async closePresentation(
    run: Run,
    presentation: ReviewFileScopeRequestPresentation,
  ): Promise<void> {
    const { request } = presentation;
    const current = (run.session.reviewFileScopeRequestPresentations ?? []).find(
      (item) => item?.request?.id === request.id,
    );
    if (!current?.closed) {
      await this.dependencies.poster.complete(
        run.organizationId,
        run.projectId,
        presentation.messageId,
        {
          status: MessageStatus.Completed,
          data: {
            type: SystemMessageDataTypeEnum.Questions,
            title: 'Review file approval retired',
            response: 'Approved Service workspaces govern required Review repairs.',
            detectedIntent: 'agent_request_review_file_scope',
            intentConfidence: 1,
            ragEnabled: false,
            uiElements: [],
            triggerNotification: false,
          },
        },
        null,
      );
      const presentations = (run.session.reviewFileScopeRequestPresentations ?? []).map((item) =>
        item?.request?.id === request.id ? { ...item, closed: true } : item,
      );
      await this.dependencies.runStore.updateRunReviewFileScopeRequestPresentations(
        run.runId,
        presentations,
      );
      run.refreshSessionFields({ reviewFileScopeRequestPresentations: presentations });
      this.dependencies.logger.info('local.review_file_scope.reconciliation.presentation_closed', {
        runId: run.runId,
        requestId: request.id,
      });
    }
  }
}
