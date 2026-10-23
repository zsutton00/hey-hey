import type { ReportChainEntry } from '../run/types';
import type { ManagedTurnTerminalOutcome } from '../turn/turn';
import type { ServerLogger } from './logger';

export const SETTLED_TURN_EVENT_KIND = 'settled_turn' as const;

export interface SettledTurnReportReference {
  readonly reportId: string;
  readonly reportType: ReportChainEntry['reportType'];
}

/** Canonical process-local liveness event emitted once when a Turn settles. */
export interface SettledTurnMonitorEvent {
  readonly kind: typeof SETTLED_TURN_EVENT_KIND;
  readonly agentSessionId: string;
  readonly turnId: string;
  readonly promptType: string;
  readonly terminalOutcome: ManagedTurnTerminalOutcome;
  readonly completedAssistantMessageId: string | null;
  readonly reports: readonly SettledTurnReportReference[];
  readonly settledAt: string;
}

type SettledTurnListener = (event: SettledTurnMonitorEvent) => void | Promise<void>;

const MAX_RECENT_SETTLED_TURNS = 256;

/** Owns stable, process-local settled-Turn publication and replay deduplication. */
export class TaskMonitorManagedTurnRuntime {
  private readonly publishedByTurn = new Map<string, SettledTurnMonitorEvent>();
  private readonly publicationByTurn = new Map<string, Promise<SettledTurnMonitorEvent>>();
  private readonly listeners = new Set<SettledTurnListener>();

  public constructor(private readonly logger: ServerLogger) {}

  public async publishSettledTurn(input: {
    agentSessionId: string;
    turnId: string;
    promptType: string;
    terminalOutcome: ManagedTurnTerminalOutcome;
    completedAssistantMessageId: string | null;
    reports: readonly SettledTurnReportReference[];
    settledAt: string;
  }): Promise<SettledTurnMonitorEvent> {
    const prior = this.publishedByTurn.get(input.turnId);
    if (prior) {
      this.logger.debug('monitors.settled_turn.publication_replayed', {
        agentSessionId: prior.agentSessionId,
        turnId: prior.turnId,
      });
      return prior;
    }
    const activePublication = this.publicationByTurn.get(input.turnId);
    if (activePublication) {
      this.logger.debug('monitors.settled_turn.publication_joined', {
        agentSessionId: input.agentSessionId,
        turnId: input.turnId,
      });
      return activePublication;
    }

    const event = Object.freeze({
      kind: SETTLED_TURN_EVENT_KIND,
      agentSessionId: input.agentSessionId,
      turnId: input.turnId,
      promptType: input.promptType,
      terminalOutcome: input.terminalOutcome,
      completedAssistantMessageId: input.completedAssistantMessageId,
      reports: Object.freeze(input.reports.map((report) => Object.freeze({ ...report }))),
      settledAt: input.settledAt,
    }) satisfies SettledTurnMonitorEvent;
    const publication = (async (): Promise<SettledTurnMonitorEvent> => {
      try {
        await Promise.all([...this.listeners].map((listener) => listener(event)));
      } catch (error) {
        this.logger.error('monitors.settled_turn.listener_failed', {
          agentSessionId: event.agentSessionId,
          turnId: event.turnId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      this.publishedByTurn.set(input.turnId, event);
      while (this.publishedByTurn.size > MAX_RECENT_SETTLED_TURNS) {
        const oldestTurnId = this.publishedByTurn.keys().next().value;
        if (oldestTurnId === undefined) break;
        this.publishedByTurn.delete(oldestTurnId);
      }
      this.logger.info('monitors.settled_turn.published', {
        agentSessionId: event.agentSessionId,
        turnId: event.turnId,
        promptType: event.promptType,
        terminalOutcome: event.terminalOutcome,
        completedAssistantMessageId: event.completedAssistantMessageId,
        reportCount: event.reports.length,
      });
      return event;
    })();
    this.publicationByTurn.set(input.turnId, publication);
    try {
      return await publication;
    } finally {
      this.publicationByTurn.delete(input.turnId);
    }
  }

  public subscribe(listener: SettledTurnListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
