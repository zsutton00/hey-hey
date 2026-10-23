import { DeterministicE2EEvidence } from './runners/deterministic-e2e-evidence';
/**
 * RunRegistry — holds active Runs, indexed by runId.
 *
 * `create()` constructs a Run once per session id; subsequent calls with
 * the same id return the existing instance. `get()` is a pure lookup.
 *
 * The registry owns Run construction. `RunApplicationRuntime` supplies its
 * long-lived collaborators once, and the registry injects those named owners
 * into each `new Run(args, collaborators)`.
 *
 * The registry owns registration/removal lifecycle notifications alongside
 * project-id latching, so lifecycle consumers do not depend on Run internals
 * or local UI presence.
 */

import type { SubmissionToolRegistry } from '../agents/submission-tools/registry';
import {
  translatePermissionDecisionToDispatch,
  type PermissionCallbackType,
  type PermissionDecisionRoutingInput,
} from '../agents/permission-response-routing';
import type { SessionRunnerFacade } from '../server/runtime/providers/select';
import type { MonitorProjectContext } from '../server/monitors/project-context';
import type { RunLifecycleEvents } from '../server/run-lifecycle-events';
import { Run, type RunArgs, type RunCollaborators } from './run';

/**
 * Result of delivering a permission decision to a Run's bound runner.
 *
 * - `delivered` — the runner accepted the dispatch and unblocked its gate.
 * - `dropped` — no Run is registered for the runId, the registered Run has no
 *   runner and no durable presentation, or a provider waiter is stale. Stale
 *   presentations are settled by the Run before this outcome is returned.
 * - `failed` — the runner was reached but threw while delivering the decision.
 */
export type PermissionDecisionDeliveryOutcome =
  | { outcome: 'delivered'; callbackType: PermissionCallbackType }
  | { outcome: 'dropped'; reason: string }
  | { outcome: 'failed'; reason: string };

/**
 * Result of routing a question answer to a Run's runner. Never throws:
 * - `delivered` — the waiting tool call was resolved with the answers.
 * - `duplicate` — the idempotency token was already handled.
 * - `stale` — no waiting call matches the request id (e.g. the CLI restarted).
 * - `dropped` — the Run or a question-capable runner was not available.
 * - `failed` — the runner threw while delivering the answer.
 */
export type QuestionAnswerDeliveryOutcome =
  | { outcome: 'delivered' }
  | { outcome: 'duplicate' }
  | { outcome: 'stale'; reason: string }
  | { outcome: 'dropped'; reason: string }
  | { outcome: 'failed'; reason: string };

export type PermissionDecisionOwner =
  | { kind: 'service_scope' }
  | { kind: 'review_file_scope' }
  | { kind: 'settled_specialized_request' }
  | { kind: 'task_monitor_intervention'; taskMonitorId: string }
  | { kind: 'provider_permission' };

export interface RunRegistryDependencies {
  runCollaborators: RunCollaborators;
  submissionToolRegistry: SubmissionToolRegistry;
  sessionRunnerFacade: SessionRunnerFacade;
  monitorProjectContext: MonitorProjectContext;
  runLifecycleEvents: RunLifecycleEvents;
  /** Idle duration after which a genuinely idle Run releases its provider and is evicted. */
  inactivityTimeoutMs?: number;
}

export class RunRegistry {
  private readonly runs = new Map<string, Run>();
  private readonly foregroundSubagentHolds = new Map<string, Set<string>>();

  public constructor(private readonly dependencies: RunRegistryDependencies) {}

  /** Read-state observers can never interrupt the Run that raised the change. */
  private publishRunUpdated(runId: string): void {
    try {
      this.dependencies.runLifecycleEvents.publishRunUpdated(runId);
    } catch (error) {
      this.dependencies.runCollaborators.logger.warn('run-registry.run_updated_listener_failed', {
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Registered Runs, including Runs restored only to answer a read. */
  public get size(): number {
    return this.runs.size;
  }

  public get inactivityTimeoutMs(): number {
    return this.dependencies.inactivityTimeoutMs ?? 0;
  }

  public create(args: RunArgs): Run {
    const existing = this.runs.get(args.runId);
    if (existing) return existing;

    const runCollaborators: RunCollaborators = {
      ...this.dependencies.runCollaborators,
      ...(this.inactivityTimeoutMs ? { idleRunReaper: this } : {}),
      durableInputReady: () => this.notifyDurableInputReady(args.runId),
      readStateChanged: () => this.publishRunUpdated(args.runId),
    };
    const run = new Run(args, runCollaborators);
    DeterministicE2EEvidence.current()?.record('run_created', { runId: args.runId });
    for (const interactionId of this.foregroundSubagentHolds.get(args.runId) ?? []) {
      run.holdForSubagent(interactionId);
    }
    this.runs.set(args.runId, run);
    this.dependencies.runCollaborators.logger.info('run-registry.created', {
      runId: args.runId,
      provider: args.provider,
      registeredRunCount: this.runs.size,
    });
    if (run.projectId) {
      this.dependencies.monitorProjectContext.learnAndSubscribe(run.projectId);
    }
    this.dependencies.runLifecycleEvents.publishRunRegistered(args.runId);
    return run;
  }

  /** Foreground holds also block admission before a persisted Run is hydrated. */
  public canAcceptDurableInput(runId: string): boolean {
    if ((this.foregroundSubagentHolds.get(runId)?.size ?? 0) > 0) return false;
    return this.get(runId)?.canAcceptDurableInput ?? true;
  }

  public get(runId: string): Run | null {
    return this.runs.get(runId) ?? null;
  }

  public holdForSubagent(runId: string, interactionId: string): void {
    const holds = this.foregroundSubagentHolds.get(runId) ?? new Set<string>();
    holds.add(interactionId);
    this.foregroundSubagentHolds.set(runId, holds);
    this.get(runId)?.holdForSubagent(interactionId);
  }

  public releaseSubagentHold(runId: string, interactionId: string): void {
    const holds = this.foregroundSubagentHolds.get(runId);
    holds?.delete(interactionId);
    if (holds?.size === 0) this.foregroundSubagentHolds.delete(runId);
    const run = this.get(runId);
    if (run) run.releaseSubagentHold(interactionId);
    // No hydrated Run will raise readiness, and nothing else re-offers its queued input.
    else if (holds?.size === 0) this.notifyDurableInputReady(runId);
  }

  /** Forwards a Run's readiness to the durable input queue once registry holds also allow it. */
  private notifyDurableInputReady(runId: string): void {
    if (!this.canAcceptDurableInput(runId)) return;
    this.dependencies.runCollaborators.runFollowUpAdmission.durableInputReady(runId);
  }

  public async classifyPermissionDecisionOwner(
    runId: string,
    requestId: string,
    idempotencyToken: string,
    taskMonitorId: string | null,
  ): Promise<PermissionDecisionOwner> {
    const run = this.runs.get(runId);
    if (run?.serviceScope.getServiceScopeRequest(requestId)) return { kind: 'service_scope' };
    if (run?.hasReviewFileScopeRequestRecord(requestId)) return { kind: 'review_file_scope' };
    if (
      run?.serviceScope.isServiceScopeRequestSettled(requestId) ||
      run?.isReviewFileScopeRequestSettled(requestId) ||
      (await this.dependencies.runCollaborators.runStore.hasIdempotencyToken(
        runId,
        idempotencyToken,
      ))
    ) {
      return { kind: 'settled_specialized_request' };
    }
    return taskMonitorId
      ? { kind: 'task_monitor_intervention', taskMonitorId }
      : { kind: 'provider_permission' };
  }

  /** Snapshot of all currently-registered Runs. Caller must not mutate. */
  public list(): readonly Run[] {
    return [...this.runs.values()];
  }

  /** Remove exactly the newly-created Run after failed read preparation. */
  public remove(runId: string, expectedRun: Run): boolean {
    if (this.runs.get(runId) !== expectedRun) return false;
    this.runs.delete(runId);
    this.dependencies.submissionToolRegistry.unregisterByRunId(runId);
    this.dependencies.sessionRunnerFacade.forgetRun(runId);
    expectedRun.cleanup();
    this.dependencies.runLifecycleEvents.publishRunRemoved(runId);
    this.dependencies.runCollaborators.logger.info('run-registry.removed', {
      runId,
      registeredRunCount: this.runs.size,
    });
    return true;
  }

  /**
   * Deliver a user permission decision to the Run's bound runner. Resolves the
   * Run by runId, translates the wire decision into the provider dispatch, and
   * invokes the runner's `submitPermissionDecision`. Never throws — an absent
   * Run or unbound runner returns a `dropped` outcome; a runner error returns
   * `failed` — so the trigger dispatch path can record the outcome and discard
   * the frame without surfacing an error.
   */
  public async submitPermissionDecision(
    runId: string,
    input: PermissionDecisionRoutingInput,
  ): Promise<PermissionDecisionDeliveryOutcome> {
    const run = this.runs.get(runId);
    if (!run) {
      return { outcome: 'dropped', reason: 'no_run_registered' };
    }
    if (run.serviceScope.hasServiceScopeRequestRecord(input.requestId)) {
      if (!input.idempotencyToken) {
        return { outcome: 'dropped', reason: 'service_scope_decision_missing_idempotency_token' };
      }
      try {
        return await run.serviceScopeCoordinator.decide({
          requestId: input.requestId,
          sessionId: input.sessionId,
          agentType: input.agentType,
          decision: input.decision === 'approve' ? 'approve' : 'deny',
          reason: input.reason,
          idempotencyToken: input.idempotencyToken,
        });
      } catch (error) {
        return {
          outcome: 'failed',
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }
    if (run.hasReviewFileScopeRequestRecord(input.requestId)) {
      if (!input.idempotencyToken) {
        return {
          outcome: 'dropped',
          reason: 'review_file_scope_decision_missing_idempotency_token',
        };
      }
      try {
        return await run.submitReviewFileScopeDecision({
          requestId: input.requestId,
          sessionId: input.sessionId,
          agentType: input.agentType,
          decision: input.decision === 'approve' ? 'approve' : 'deny',
          reason: input.reason,
          idempotencyToken: input.idempotencyToken,
        });
      } catch (error) {
        return {
          outcome: 'failed',
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }
    const runner = run.runner;
    if (!runner?.submitPermissionDecision) {
      if (run.hasPermissionRequestRecord(input.requestId)) {
        return run.recoverStalePermissionDecision(input);
      }
      return { outcome: 'dropped', reason: 'no_runner_bound' };
    }
    // The "Approved"/"Denied" user message (emitted by the Claude and
    // OpenCode runners) appends to the conversation tail through the runner's
    // existing emitRawEvent/poster path — the server resolves its parent — so
    // no parent message id is declared here.
    const dispatch = translatePermissionDecisionToDispatch(input);
    try {
      const result = await runner.submitPermissionDecision({
        session: run.session,
        dispatch,
      });
      if (!result.delivered) {
        return run.recoverStalePermissionDecision(input);
      }
      run.notePermissionDecisionDelivered({
        requestId: input.requestId,
        decision: input.decision,
        callbackType: result.callbackType,
      });
      return { outcome: 'delivered', callbackType: result.callbackType };
    } catch (error) {
      return {
        outcome: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Deliver a user's answers to the Run's waiting `AskUserQuestion` call, then
   * publish the resumed phase through the Run.
   */
  public submitQuestionAnswer(
    runId: string,
    input: { requestId: string; idempotencyToken: string; answers: Record<string, string> },
  ): QuestionAnswerDeliveryOutcome {
    const run = this.runs.get(runId);
    if (!run) {
      return { outcome: 'dropped', reason: 'no_run_registered' };
    }
    const runner = run.runner;
    if (!runner?.submitQuestionAnswer) {
      return { outcome: 'dropped', reason: 'no_question_capable_runner_bound' };
    }
    try {
      const result = runner.submitQuestionAnswer(input);
      if (!result.delivered) {
        return result.outcome === 'duplicate'
          ? { outcome: 'duplicate' }
          : { outcome: 'stale', reason: result.reason };
      }
      run.noteQuestionAnswerDelivered({ requestId: input.requestId });
      return { outcome: 'delivered' };
    } catch (error) {
      return {
        outcome: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public claimAndEvict(run: Run): boolean {
    if (this.runs.get(run.runId) !== run) return false;
    this.runs.delete(run.runId);
    this.dependencies.submissionToolRegistry.unregisterByRunId(run.runId);
    this.dependencies.sessionRunnerFacade.forgetRun(run.runId);
    this.dependencies.runLifecycleEvents.publishRunRemoved(run.runId, 'idle');
    this.dependencies.runCollaborators.logger.info('run-registry.idle_run_evicted', {
      runId: run.runId,
      provider: run.provider,
      registeredRunCount: this.runs.size,
    });
    return true;
  }

  public dispose(): void {
    this.dependencies.runCollaborators.logger.info('run-registry.disposing', {
      registeredRunCount: this.runs.size,
    });
    for (const [runId, run] of this.runs) {
      this.dependencies.submissionToolRegistry.unregisterByRunId(runId);
      this.dependencies.sessionRunnerFacade.forgetRun(runId);
      run.cleanup();
      this.dependencies.runLifecycleEvents.publishRunRemoved(runId);
    }
    this.runs.clear();
    this.foregroundSubagentHolds.clear();
    this.dependencies.runCollaborators.logger.info('run-registry.disposed');
  }
}
