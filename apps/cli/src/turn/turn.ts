import type { SessionRole } from '../shared/agent-bridge-contract/generated/api';
import type { RunAttachmentReference } from '../shared/agent-bridge-contract/generated/api';
/**
 * Turn — one user-message → assistant-complete cycle on a Run.
 *
 * A Turn is a stateful lifecycle owner. Every execution input is resolved by
 * the Run before `new Turn(...)` runs, so the Turn carries no nullable
 * placeholders that require runtime guards. It retains a deliberately narrow
 * Run owner reference for lifecycle navigation and never reads the run store.
 *
 * Invariants enforced at the type level:
 *
 *   - `resolvedPrompt` is a non-null string. Handlers that produce no user
 *     text set it to an empty string; a failed resolve throws before the
 *     Turn is constructed.
 *   - `handler` is a non-null `PromptTypeHandler`. Every promptType has
 *     exactly one registered handler; an unregistered
 *     promptType is rejected at the edge, not carried as null onto the Turn.
 *   - `runner`, `abortController`, `logger`, and the Run owner are required.
 *
 * `externalAgentNodeId` and `triggerMessageId` stay `string | null` because
 * null is a legitimate resolved value for legacy POST callers — the Run
 * stamps both from the request before Turn construction and passes them
 * through unchanged.
 *
 * Phases: `created → began → running → ended`.
 *
 *   begin()  — phase transition + readiness log. No async work; every field
 *              is already resolved.
 *   run()    — invokes `runner.run(abortSignal)`. Always calls `end()` in
 *              finally. Errors are logged, not re-thrown — the Turn always
 *              terminates cleanly so the Run returns to idle.
 *   end()    — navigates to `owner.onTurnEnded(this)`. Idempotent; a second
 *              call returns the same promise. The Run owns post-Turn cleanup.
 *
 * There is no `stillMineActiveTurn` guard. With Run as the sole scheduler
 * and `new Turn(...)` immutable, the "Turn 1 late-completes while Turn 2 is
 * already active" race is impossible by construction: Turn 2 can only be
 * built inside Turn 1's owner notification, so Turn 1's state clearing runs
 * before Turn 2 exists.
 */

import type { PromptTypeHandler } from '../agents/prompt-type-handler';
import type { TurnPlatformMcpProxy } from '../agents/platform-mcp-proxy/turn-proxy';
import type { LocalReasoningEffort } from '../shared/agent-bridge-contract/index';
import type { ServerLogger } from '../server/logger';
import type { Run } from '../run/run';
import type { FeatureVerificationSuggestion } from '../agents/completion-reconciliation/schemas';
import { ChangedFileReporting } from './changed-file-reporting';
import { CompletionCorrection } from './completion-correction';
import {
  formatRunEventAppendLockGuidance,
  getExistingRunEventAppendLockPath,
} from './run-event-append-lock-guidance';

// ---------------------------------------------------------------------------
// Runner — the dispatch choice picked by the Run before Turn construction.
// ---------------------------------------------------------------------------

/**
 * A runnable dispatch choice for a Turn. Implementations bind to a
 * resume/runPrompt call on the Run's provider session, or to a subagent
 * spawn. The Turn only knows how to invoke `run(signal)`.
 */
export interface Runner {
  run(signal: AbortSignal): Promise<void>;
  /**
   * Resumes the Turn's provider session with a follow-up prompt without
   * admitting input or building a new Turn. `reportingRepair` restricts the
   * session to changed-file reporting.
   */
  continueTurn?(
    prompt: string,
    signal: AbortSignal,
    options: { reportingRepair: boolean },
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// TurnPhase — the state machine.
// ---------------------------------------------------------------------------

export type TurnPhase = 'created' | 'began' | 'running' | 'ended';
export type ManagedTurnTerminalOutcome = 'COMPLETED' | 'FAILED' | 'ABORTED';

export interface TurnCompletionArtifactIds {
  proposalIds: string[];
  reportIds: string[];
}

// ---------------------------------------------------------------------------
// TurnArgs — everything the Run resolves before construction. No nullable
// fields that require runtime guards inside Turn code.
// ---------------------------------------------------------------------------

export interface TurnArgs {
  turnId: string;
  runId: string;
  attachments?: readonly RunAttachmentReference[];
  resolvedPrompt: string;
  handler: PromptTypeHandler<unknown>;
  payload?: unknown;
  externalAgentNodeId: string | null;
  triggerMessageId: string | null;
  runner: Runner;
  platformMcpProxy: TurnPlatformMcpProxy | null;
  abortController: AbortController;
  logger: ServerLogger;
  owner: Run;
  /** Effective role resolved from the fixed executing handler. */
  effectiveRole: SessionRole;
  /** Effective model id submitted to the SDK for this Turn (or null when none resolves). */
  effectiveModel: string | null;
  /** Effective reasoning effort submitted to the SDK for this Turn (or null when none resolves). */
  effectiveReasoningEffort: LocalReasoningEffort | null;
}

// ---------------------------------------------------------------------------
// Turn class.
// ---------------------------------------------------------------------------

export class Turn {
  readonly changedFileReporting: ChangedFileReporting;
  readonly completionCorrection: CompletionCorrection;
  readonly turnId: string;
  readonly runId: string;
  readonly attachments: readonly RunAttachmentReference[];
  readonly resolvedPrompt: string;
  readonly handler: PromptTypeHandler<unknown>;
  readonly payload: unknown;
  readonly externalAgentNodeId: string | null;
  readonly triggerMessageId: string | null;
  readonly runner: Runner;
  readonly platformMcpProxy: TurnPlatformMcpProxy | null;
  readonly abortController: AbortController;
  readonly effectiveRole: SessionRole;
  readonly effectiveModel: string | null;
  readonly effectiveReasoningEffort: LocalReasoningEffort | null;

  private readonly logger: ServerLogger;
  private readonly owner: Run;
  private _phase: TurnPhase = 'created';
  private _terminalOutcome: ManagedTurnTerminalOutcome = 'ABORTED';
  private _completedAssistantMessageId: string | null = null;
  private _completionPublicationFailed = false;
  private _featureVerificationSuggestion: FeatureVerificationSuggestion | null = null;
  private readonly createdProposalIds: string[] = [];
  private readonly createdProposalIdSet = new Set<string>();
  private completionArtifactIds: TurnCompletionArtifactIds | null = null;
  private _endPromise: Promise<void> | null = null;
  private _subagentProviderSessionId: string | null = null;

  constructor(args: TurnArgs) {
    this.turnId = args.turnId;
    this.runId = args.runId;
    this.attachments = Object.freeze(
      (args.attachments ?? []).map((reference) => Object.freeze({ ...reference })),
    );
    this.resolvedPrompt = args.resolvedPrompt;
    this.handler = args.handler;
    this.payload = args.payload;
    this.externalAgentNodeId = args.externalAgentNodeId;
    this.triggerMessageId = args.triggerMessageId;
    this.runner = args.runner;
    this.platformMcpProxy = args.platformMcpProxy;
    this.abortController = args.abortController;
    this.effectiveRole = args.effectiveRole;
    this.effectiveModel = args.effectiveModel;
    this.effectiveReasoningEffort = args.effectiveReasoningEffort;
    this.logger = args.logger;
    this.changedFileReporting = new ChangedFileReporting(args.turnId, args.logger);
    this.completionCorrection = new CompletionCorrection(args.turnId, args.logger);
    this.owner = args.owner;
    // The Turn's own list is cleared at completion; the Run's tracker keeps ids across Turns.
    this.platformMcpProxy?.setProposalIdentityObserver((proposalId) => {
      this.recordCreatedProposal(proposalId);
      this.owner.proposalTracker.record(proposalId);
    });
    this.platformMcpProxy?.setProposalRemovalObserver((proposalId) => {
      this.recordRemovedProposal(proposalId);
      this.owner.proposalTracker.forget(proposalId);
    });
  }

  get phase(): TurnPhase {
    return this._phase;
  }

  get abortSignal(): AbortSignal {
    return this.abortController.signal;
  }

  get terminalOutcome(): ManagedTurnTerminalOutcome {
    return this._terminalOutcome;
  }

  get completedAssistantMessageId(): string | null {
    return this._completedAssistantMessageId;
  }

  /** The Verify Feature concern the agent raised during this Turn, if any. */
  get featureVerificationSuggestion(): FeatureVerificationSuggestion | null {
    return this._featureVerificationSuggestion;
  }

  /** Keeps the first concern; returns false when the Turn already holds one. */
  public recordFeatureVerificationSuggestion(suggestion: FeatureVerificationSuggestion): boolean {
    if (this._featureVerificationSuggestion !== null) return false;
    this._featureVerificationSuggestion = suggestion;
    return true;
  }

  get completionPublicationFailed(): boolean {
    return this._completionPublicationFailed;
  }

  /**
   * The isolated provider session a subagent Turn runs in, first observed at
   * Run event ingress. Null for Run-owned Turns and until the subagent's first
   * identified event. Never the Run's own provider session.
   */
  get subagentProviderSessionId(): string | null {
    return this._subagentProviderSessionId;
  }

  public recordSubagentProviderSession(providerSessionId: string): void {
    this._subagentProviderSessionId = providerSessionId;
  }

  public recordCompletionPublicationFailure(): void {
    if (this._completedAssistantMessageId !== null) {
      this.logger.warn('runtime.turn.completion_publication_failure_ignored_after_commit', {
        turnId: this.turnId,
        runId: this.runId,
        promptType: this.handler.promptType,
        completedAssistantMessageId: this._completedAssistantMessageId,
      });
      return;
    }
    this._completionPublicationFailed = true;
    if (!this.abortSignal.aborted) this._terminalOutcome = 'FAILED';
    const artifactIds = this.readCompletionArtifactIds();
    this.logger.error('runtime.turn.completion_publication_failed', {
      turnId: this.turnId,
      runId: this.runId,
      promptType: this.handler.promptType,
      terminalOutcome: this._terminalOutcome,
      proposalIds: artifactIds?.proposalIds ?? [],
      reportIds: artifactIds?.reportIds ?? [],
    });
  }

  public recordCompletedAssistantMessage(messageId: string): void {
    this._completedAssistantMessageId = messageId;
    this._completionPublicationFailed = false;
    this.createdProposalIds.length = 0;
    this.createdProposalIdSet.clear();
    this.completionArtifactIds = null;
    this.logger.debug('runtime.turn.completed_assistant_message.recorded', {
      turnId: this.turnId,
      runId: this.runId,
      promptType: this.handler.promptType,
      messageId,
    });
  }

  public readonly recordCreatedProposal = (proposalId: string): void => {
    if (this.createdProposalIdSet.has(proposalId)) {
      this.logger.debug('runtime.turn.proposal.duplicate_ignored', {
        turnId: this.turnId,
        runId: this.runId,
        proposalId,
      });
      return;
    }
    if (this.completionArtifactIds) {
      this.logger.warn('runtime.turn.proposal.record_skipped_after_completion_snapshot', {
        turnId: this.turnId,
        runId: this.runId,
        proposalId,
      });
      return;
    }
    this.createdProposalIdSet.add(proposalId);
    this.createdProposalIds.push(proposalId);
    this.logger.debug('runtime.turn.proposal.recorded', {
      turnId: this.turnId,
      runId: this.runId,
      proposalId,
      proposalCount: this.createdProposalIds.length,
    });
  };

  public readonly recordRemovedProposal = (proposalId: string): void => {
    if (!this.createdProposalIdSet.has(proposalId)) {
      this.logger.debug('runtime.turn.proposal.removal_not_collected', {
        turnId: this.turnId,
        runId: this.runId,
        proposalId,
      });
      return;
    }
    if (this.completionArtifactIds) {
      this.logger.warn('runtime.turn.proposal.removal_skipped_after_completion_snapshot', {
        turnId: this.turnId,
        runId: this.runId,
        proposalId,
      });
      return;
    }
    this.createdProposalIdSet.delete(proposalId);
    const index = this.createdProposalIds.indexOf(proposalId);
    if (index !== -1) this.createdProposalIds.splice(index, 1);
    this.logger.debug('runtime.turn.proposal.removed', {
      turnId: this.turnId,
      runId: this.runId,
      proposalId,
      proposalCount: this.createdProposalIds.length,
    });
  };

  public readCreatedProposalIds(): readonly string[] {
    return this.createdProposalIds.slice();
  }

  public includeExistingProposals(proposalIds: readonly string[]): void {
    if (this.completionArtifactIds) {
      throw new Error('Cannot include Proposals after the completion snapshot was created');
    }
    for (const proposalId of proposalIds) this.recordCreatedProposal(proposalId);
  }

  public snapshotCompletionArtifactIds(reportIds: readonly string[]): TurnCompletionArtifactIds {
    this.completionArtifactIds ??= {
      proposalIds: this.createdProposalIds.slice(),
      reportIds: reportIds.slice(),
    };
    return {
      proposalIds: this.completionArtifactIds.proposalIds.slice(),
      reportIds: this.completionArtifactIds.reportIds.slice(),
    };
  }

  public readCompletionArtifactIds(): TurnCompletionArtifactIds | null {
    if (!this.completionArtifactIds) return null;
    return {
      proposalIds: this.completionArtifactIds.proposalIds.slice(),
      reportIds: this.completionArtifactIds.reportIds.slice(),
    };
  }

  /**
   * Phase transition only. Every field the Turn needs is already resolved,
   * so `begin()` has no async work — it flips the state machine and logs.
   */
  async begin(): Promise<void> {
    if (this._phase !== 'created') {
      throw new Error(`Turn.begin() called in phase "${this._phase}"; expected "created".`);
    }
    this._phase = 'began';
    this.logger.info('runtime.turn.begin.ready', {
      handlerId: this.handler.id,
      effectiveRole: this.effectiveRole,
      turnId: this.turnId,
      runId: this.runId,
      promptType: this.handler.promptType,
      triggerMessageId: this.triggerMessageId,
    });
  }

  /**
   * Invoke the chosen runner. Always calls end() in finally. Errors from
   * the runner are logged but not re-thrown — the Turn lifecycle always
   * terminates cleanly so the Run returns to idle.
   */
  async run(): Promise<void> {
    if (this._phase !== 'began') {
      throw new Error(`Turn.run() called in phase "${this._phase}"; expected "began".`);
    }
    this._phase = 'running';
    this.logger.info('runtime.turn.run.started', {
      turnId: this.turnId,
      runId: this.runId,
      promptType: this.handler.promptType,
      triggerMessageId: this.triggerMessageId,
    });
    try {
      await this.runner.run(this.abortSignal);
      await this.owner.completeCompletionCorrection(this);
      await this.owner.completeChangedFileReporting(this);
      this._terminalOutcome = this.abortSignal.aborted
        ? 'ABORTED'
        : this._completionPublicationFailed
          ? 'FAILED'
          : 'COMPLETED';
      this.logger.info('runtime.turn.run.runner_returned', {
        turnId: this.turnId,
        runId: this.runId,
        promptType: this.handler.promptType,
        triggerMessageId: this.triggerMessageId,
      });
      await this.owner.onTurnRunnerCompleted(this);
    } catch (error) {
      this._terminalOutcome = this.abortSignal.aborted ? 'ABORTED' : 'FAILED';
      const appendLockPath =
        error instanceof Error ? getExistingRunEventAppendLockPath(error) : null;
      if (appendLockPath !== null) {
        this.logger.info('runtime.turn.run_failed.append_lock_guidance', {
          turnId: this.turnId,
          runId: this.runId,
          promptType: this.handler.promptType,
          appendLockPath,
          message: formatRunEventAppendLockGuidance(),
        });
      }
      if (!this.abortSignal.aborted) {
        this.logger.error('runtime.turn.run_failed', {
          turnId: this.turnId,
          runId: this.runId,
          promptType: this.handler.promptType,
          triggerMessageId: this.triggerMessageId,
          error,
        });
      }
      try {
        await this.owner.onTurnRunnerFailed(this, error);
      } catch (publishError) {
        this.logger.error('runtime.turn.run_failure_publication_failed', {
          turnId: this.turnId,
          runId: this.runId,
          promptType: this.handler.promptType,
          triggerMessageId: this.triggerMessageId,
          error: publishError,
        });
      }
    } finally {
      if (this.abortSignal.aborted) {
        this.logger.info('runtime.turn.run.cancelled', {
          turnId: this.turnId,
          runId: this.runId,
          promptType: this.handler.promptType,
          triggerMessageId: this.triggerMessageId,
        });
      }
      await this.end();
    }
  }

  /**
   * Notify the owning Run so it can clear per-Turn state,
   * mark itself idle, and drain its queue. Idempotent: a second call
   * returns the same promise as the first. A throw from the owner is
   * caught and logged; the phase still transitions to `ended` so the
   * state machine never wedges.
   */
  end(): Promise<void> {
    if (this._endPromise) {
      return this._endPromise;
    }

    this._endPromise = (async () => {
      this.logger.info('runtime.turn.end.starting', {
        turnId: this.turnId,
        runId: this.runId,
        promptType: this.handler.promptType,
        triggerMessageId: this.triggerMessageId,
        phase: this._phase,
      });

      this.platformMcpProxy?.close();

      try {
        await this.owner.onTurnEnded(this);
      } catch (error) {
        this.logger.error('runtime.turn.end_onEnd_failed', {
          turnId: this.turnId,
          runId: this.runId,
          promptType: this.handler.promptType,
          triggerMessageId: this.triggerMessageId,
          error,
        });
      }

      this._phase = 'ended';
      this.logger.info('runtime.turn.end.cleared', {
        turnId: this.turnId,
        runId: this.runId,
        promptType: this.handler.promptType,
        triggerMessageId: this.triggerMessageId,
      });
    })();

    return this._endPromise;
  }

  /**
   * Fire the Turn's own abort controller. `Run.abort()` propagates into
   * here via `Run → activeTurn`, keeping "abort signals flow from the Run
   * to the active Turn" from the design doc.
   */
  abort(): void {
    this.abortController.abort();
  }
}
