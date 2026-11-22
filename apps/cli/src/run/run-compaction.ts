import {
  AgentSessionRunnerError,
  type AgentSessionRunner,
} from '../agents/providers/session-runner';
import type { ServerLogger } from '../server/logger';
import type { RunEventPublisher } from '../server/run-event-publisher';
import type { AgenticSession } from '../session/types';
import type { LocalContextData } from '../shared/agent-bridge-contract/runtime-types';
import type { SubAgentContextReading } from './subagent';
import type {
  CompactionNoticeMarker,
  SystemMessageDataNoticeSeverityEnum as NoticeSeverity,
} from '../shared/api/index';
import type { Turn } from '../turn/turn';

export const DEFAULT_AUTO_COMPACT_THRESHOLD = 150_000;
/** 150k of a 200k window: the same point, scaled to whatever window the model reports. */
export const DEFAULT_AUTO_COMPACT_WINDOW_FRACTION = 0.75;

/** The only way `RunCompaction` sees the Run that owns it. */
export interface RunCompactionDeps {
  runId: string;
  agentSessionId: string;
  logger: ServerLogger;
  broadcaster: RunEventPublisher;
  /** Resolved auto-compact policy. Null when disabled or absent. */
  autoCompact: { threshold: number; windowFraction?: number } | null;
  runner(): AgentSessionRunner | undefined;
  isProcessing(): boolean;
  /** Mark the Run busy so incoming messages queue instead of starting a Turn. */
  holdRun(): void;
  /** Release a hold: drain queued messages in order, or go idle when none. */
  releaseRun(): void;
  session(): AgenticSession;
  activeTurn(): Pick<Turn, 'turnId' | 'subagentProviderSessionId'> | null;
  contextProviderSessionId(): string | null;
  postRuntimeNotice(
    response: string,
    severity: NoticeSeverity,
    session: AgenticSession,
    compaction?: CompactionNoticeMarker,
  ): Promise<void>;
}

/**
 * Manual and automatic compaction of a Run's provider context, and the
 * context-window figure published for the Context capsule.
 */
export class RunCompaction {
  private pendingCompact: {
    silent: boolean;
    resolvers: Array<{ resolve: () => void; reject: (err: unknown) => void }>;
  } | null = null;

  /** Latest pre-disconnect context reading from a context-counted subagent session. */
  private subagentContextReading: SubAgentContextReading | null = null;

  constructor(private readonly deps: RunCompactionDeps) {}

  /** The compaction currently executing; concurrent requests join it. */
  private inFlight: Promise<void> | null = null;

  /**
   * Compact the provider context. A compaction occupies the Run like a Turn:
   * from acceptance until settlement messages queue and no Turn starts. While
   * a Turn is processing the request is deferred to `afterTurnEnd`;
   * concurrent callers coalesce onto one compact that posts notes unless
   * every caller was silent.
   */
  async compact(options?: { silent?: boolean }): Promise<void> {
    const silent = options?.silent ?? false;
    if (this.inFlight !== null) return this.inFlight;
    if (this.deps.isProcessing()) return this.defer(silent);

    this.deps.holdRun();
    this.deps.logger.info('local.run.compaction.run_held', { runId: this.deps.runId, silent });
    let outcome = 'completed';
    try {
      await this.runExclusive(silent);
    } catch (error) {
      outcome = compactErrorCode(error);
      throw error;
    } finally {
      if (outcome === 'completed' && !silent) await this.publishContextSize();
      this.deps.logger.info('local.run.compaction.run_released', {
        runId: this.deps.runId,
        silent,
        outcome,
      });
      this.deps.releaseRun();
    }
  }

  private defer(silent: boolean): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const wasSilent = this.pendingCompact?.silent ?? true;
      if (this.pendingCompact === null) {
        this.pendingCompact = { silent, resolvers: [{ resolve, reject }] };
      } else {
        // AND the silent flags: once any non-silent caller joins the deferred
        // run posts notes.
        this.pendingCompact.silent = this.pendingCompact.silent && silent;
        this.pendingCompact.resolvers.push({ resolve, reject });
      }
      // One queued notice per deferred compact, posted when it first becomes
      // non-silent.
      if (wasSilent && !silent) {
        void this.deps
          .postRuntimeNotice(
            'Compact queued until the current turn finishes',
            'info',
            this.deps.session(),
            { phase: 'queued' },
          )
          .catch((error: unknown) => {
            this.deps.logger.warn('local.run.compaction.queued_notice_failed', {
              runId: this.deps.runId,
              error,
            });
          });
      }
    });
  }

  private runExclusive(silent: boolean): Promise<void> {
    const execution = this.execute(silent).finally(() => {
      this.inFlight = null;
    });
    this.inFlight = execution;
    return execution;
  }

  private async execute(silent: boolean): Promise<void> {
    const session = this.deps.session();
    const runner = this.deps.runner();
    if (!runner?.compact) {
      const error = new AgentSessionRunnerError(
        'NOT_SUPPORTED',
        'No active runner supports compaction.',
      );
      if (!silent) {
        await this.deps.postRuntimeNotice(`Compact failed: ${error.message}`, 'warning', session, {
          phase: 'failed',
          code: error.code,
        });
      }
      throw error;
    }

    if (!silent) {
      await this.deps.postRuntimeNotice('Starting compact…', 'info', session, { phase: 'started' });
    }
    try {
      await runner.compact();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (!silent) {
        await this.deps.postRuntimeNotice(`Compact failed: ${reason}`, 'warning', session, {
          phase: 'failed',
          code: compactErrorCode(error),
        });
      }
      throw error;
    }
    if (!silent) {
      await this.deps.postRuntimeNotice('Finished compact…', 'info', session, {
        phase: 'completed',
      });
    }
  }

  /**
   * Keep a finished subagent's pre-disconnect context reading for the turn-end
   * gauge. Accepted only from the active Turn and only for the session that
   * Turn's events identified.
   */
  recordSubagentContextReading(turnId: string, reading: SubAgentContextReading): void {
    const turn = this.deps.activeTurn();
    if (turn?.turnId !== turnId || turn.subagentProviderSessionId !== reading.providerSessionId) {
      this.deps.logger.debug('local.run.subagent_context_reading.rejected', {
        runId: this.deps.runId,
        turnId,
        activeTurnId: turn?.turnId ?? null,
        expectedProviderSessionId: turn?.subagentProviderSessionId ?? null,
        providerSessionId: reading.providerSessionId,
      });
      return;
    }
    this.subagentContextReading = reading;
  }

  /**
   * Turn-end compaction work: the deferred compact if one is pending, else the
   * automatic compact check, then the context-size publish — after compaction
   * so the Context capsule never shows a pre-compact figure.
   */
  async afterTurnEnd(): Promise<void> {
    let deferredCompactFired = false;
    if (this.pendingCompact !== null) {
      const pending = this.pendingCompact;
      this.pendingCompact = null;
      deferredCompactFired = true;
      // The Run stays held from Turn end until `drainQueue()`, so this
      // runs directly; `onTurnEnded` drains the queue afterwards.
      try {
        await this.runExclusive(pending.silent);
        for (const { resolve } of pending.resolvers) resolve();
      } catch (error) {
        for (const { reject } of pending.resolvers) reject(error);
      }
    }

    if (this.deps.autoCompact !== null && !deferredCompactFired) {
      await this.maybeAutoCompact();
    }

    await this.publishContextSize();
  }

  /** Reject every compact request still waiting for turn-end. */
  cancelPending(error: Error): void {
    if (this.pendingCompact === null) return;
    const pending = this.pendingCompact;
    this.pendingCompact = null;
    for (const { reject } of pending.resolvers) reject(error);
  }

  private async maybeAutoCompact(): Promise<void> {
    if (this.pendingCompact !== null) return; // defense-in-depth: coalescing guard
    if (this.deps.autoCompact === null) return;
    const { threshold: fixedThreshold, windowFraction } = this.deps.autoCompact;
    let usage: LocalContextData | undefined;
    try {
      usage = await this.deps.runner()?.getContextUsage();
    } catch (error) {
      this.deps.logger.warn('local.run.auto_compact.context_read_failed', {
        runId: this.deps.runId,
        error,
      });
      return;
    }
    if (!usage) return;
    const threshold =
      windowFraction !== undefined && usage.maxTokens > 0
        ? Math.floor(usage.maxTokens * windowFraction)
        : fixedThreshold;
    if (usage.totalTokens <= threshold) return;
    try {
      await this.runExclusive(true);
    } catch (error) {
      if (error instanceof AgentSessionRunnerError && error.code === 'NOT_SUPPORTED') {
        return;
      }
      this.deps.logger.warn('local.run.auto_compact.failed', {
        runId: this.deps.runId,
        error,
      });
    }
  }

  /**
   * Publish the context session's context-window size at turn end so the
   * Context capsule shows a live figure. The context session is the latest one
   * whose handler counts for context; a finished subagent's session uses the
   * reading it took before disconnecting. Otherwise only the live runner is
   * read — never the resume path — so the read cannot start a provider or
   * enqueue a Turn. A runner that cannot report (NOT_SUPPORTED /
   * NO_ACTIVE_SESSION) publishes nothing.
   */
  private async publishContextSize(): Promise<void> {
    const runner = this.deps.runner();
    const providerSessionId = this.deps.contextProviderSessionId();
    if (!providerSessionId) return;
    const captured =
      this.subagentContextReading?.providerSessionId === providerSessionId
        ? this.subagentContextReading.usage
        : null;
    // Best-effort: a failed reading must never block drainQueue() at turn end.
    try {
      const usage = captured ?? (runner ? await runner.getContextUsage(providerSessionId) : null);
      if (!usage) return;
      this.deps.broadcaster.emitAgentSessionContextSizeObservation({
        agentSessionId: this.deps.agentSessionId,
        runId: this.deps.runId,
        providerSessionId,
        totalTokens: usage.totalTokens,
        ...(usage.maxTokens > 0 ? { maxTokens: usage.maxTokens } : {}),
        observedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (
        error instanceof AgentSessionRunnerError &&
        (error.code === 'NOT_SUPPORTED' || error.code === 'NO_ACTIVE_SESSION')
      ) {
        this.deps.logger.debug('local.run.context_size.unavailable', {
          runId: this.deps.runId,
          providerSessionId,
          code: error.code,
          reason: error.message,
        });
        return;
      }
      this.deps.logger.warn('local.run.context_size.read_failed', {
        runId: this.deps.runId,
        error,
      });
    }
  }
}

function compactErrorCode(error: unknown): string {
  return error instanceof AgentSessionRunnerError ? error.code : 'FAILED';
}
