import {
  AgentSessionRunnerError,
  type AgentSessionRunner,
} from '../agents/providers/session-runner';
import type { ServerLogger } from '../server/logger';
import type { RunEventPublisher } from '../server/run-event-publisher';
import type { AgenticSession } from '../session/types';
import type { LocalContextData } from '../shared/agent-bridge-contract/runtime-types';
import type { SubAgentContextReading } from './subagent';
import type { Turn } from '../turn/turn';

/** The only way `RunCompaction` sees the Run that owns it. */
export interface RunCompactionDeps {
  runId: string;
  agentSessionId: string;
  logger: ServerLogger;
  broadcaster: RunEventPublisher;
  /** Resolved auto-compact policy. Null when disabled or absent. */
  autoCompact: { threshold: number } | null;
  runner(): AgentSessionRunner | undefined;
  isProcessing(): boolean;
  session(): AgenticSession;
  activeTurn(): Pick<Turn, 'turnId' | 'subagentProviderSessionId'> | null;
  contextProviderSessionId(): string | null;
  postAgentSystemMessage(response: string, session: AgenticSession): Promise<void>;
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

  /**
   * Compact the provider context. While a Turn is processing the request is
   * deferred to `afterTurnEnd`; concurrent callers coalesce onto one deferred
   * compact that posts notes unless every caller was silent.
   */
  async compact(options?: { silent?: boolean }): Promise<void> {
    if (this.deps.isProcessing()) {
      return new Promise<void>((resolve, reject) => {
        if (this.pendingCompact === null) {
          this.pendingCompact = {
            silent: options?.silent ?? false,
            resolvers: [{ resolve, reject }],
          };
        } else {
          // AND the silent flags: once any non-silent caller joins the deferred
          // run posts notes.
          this.pendingCompact.silent = this.pendingCompact.silent && (options?.silent ?? false);
          this.pendingCompact.resolvers.push({ resolve, reject });
        }
      });
    }
    const runner = this.deps.runner();
    if (!runner?.compact) {
      throw new AgentSessionRunnerError('NOT_SUPPORTED', 'No active runner supports compaction.');
    }
    const session = this.deps.session();

    if (!options?.silent) await this.deps.postAgentSystemMessage('Starting compact…', session);
    try {
      await runner.compact();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (!options?.silent) {
        await this.deps.postAgentSystemMessage(`Compact failed: ${reason}`, session);
      }
      throw error;
    }
    if (!options?.silent) await this.deps.postAgentSystemMessage('Finished compact…', session);
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
      try {
        await this.compact({ silent: pending.silent });
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
    const { threshold } = this.deps.autoCompact;
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
    if (!usage || usage.totalTokens <= threshold) return;
    try {
      await this.compact({ silent: true });
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
