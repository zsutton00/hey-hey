import { z } from 'zod';
import type { ServerLogger } from '../logger';
import type { PlatformAuth } from '../platform-auth-context';
import type { CanonicalSettledTurnMonitorEvent } from './normalizer';

const turnSupervisorIdSchema = z.enum(['SESSION_MONITOR', 'TASK_MONITOR']);
type TurnSupervisorId = z.infer<typeof turnSupervisorIdSchema>;

export const completedTurnSupervisionDispositionSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('HANDLED'),
    supervisor: turnSupervisorIdSchema,
  }),
  z.object({
    status: z.literal('RELEASED'),
    supervisor: turnSupervisorIdSchema,
    reason: z.string().min(1),
  }),
]);

const failedTurnSupervisionDispositionSchema = z.object({
  status: z.literal('FAILED'),
  supervisor: turnSupervisorIdSchema,
  reason: z.string().min(1),
});

export const turnSupervisionDispositionSchema = z.union([
  completedTurnSupervisionDispositionSchema,
  failedTurnSupervisionDispositionSchema,
]);

export type TurnSupervisionDisposition = z.infer<typeof turnSupervisionDispositionSchema>;
export type CompletedTurnSupervisionDisposition = z.infer<
  typeof completedTurnSupervisionDispositionSchema
>;

export interface TurnSupervisor {
  readonly id: TurnSupervisorId;
  invoke(
    event: CanonicalSettledTurnMonitorEvent,
    auth: PlatformAuth,
  ): Promise<TurnSupervisionDisposition>;
}

export interface TurnSupervisorResolver {
  resolve(event: CanonicalSettledTurnMonitorEvent): Promise<readonly TurnSupervisor[]>;
}

export type TurnSupervisionClaim =
  | { status: 'CLAIMED' }
  | { status: 'RECORDED'; disposition: CompletedTurnSupervisionDisposition };

export interface TurnSupervisionReceiptStore {
  claim(turnId: string): Promise<TurnSupervisionClaim>;
  record(
    turnId: string,
    disposition: CompletedTurnSupervisionDisposition,
  ): Promise<CompletedTurnSupervisionDisposition>;
  releaseClaim(turnId: string): Promise<void>;
}

export interface TurnSupervisionChainDependencies {
  resolver: TurnSupervisorResolver;
  receipts: TurnSupervisionReceiptStore;
  logger: ServerLogger;
}

/** Owns replay suppression and ordered settled-Turn supervision per Agent Session. */
export class TurnSupervisionChain {
  private readonly tailsByAgentSession = new Map<string, Promise<void>>();
  private readonly inFlightByTurn = new Map<string, Promise<TurnSupervisionDisposition>>();

  public constructor(private readonly dependencies: TurnSupervisionChainDependencies) {}

  public dispatch(
    event: CanonicalSettledTurnMonitorEvent,
    auth: PlatformAuth,
  ): Promise<TurnSupervisionDisposition> {
    const active = this.inFlightByTurn.get(event.turnId);
    if (active) {
      this.dependencies.logger.debug('turn_supervision.dispatch.coalesced', {
        agentSessionId: event.agentSessionId,
        turnId: event.turnId,
      });
      return active;
    }

    const dispatch = this.enqueue(event.agentSessionId, () => this.dispatchOnce(event, auth));
    this.inFlightByTurn.set(event.turnId, dispatch);
    const clear = (): void => {
      if (this.inFlightByTurn.get(event.turnId) === dispatch) {
        this.inFlightByTurn.delete(event.turnId);
      }
    };
    void dispatch.then(clear, clear);
    return dispatch;
  }

  private async dispatchOnce(
    event: CanonicalSettledTurnMonitorEvent,
    auth: PlatformAuth,
  ): Promise<TurnSupervisionDisposition> {
    this.dependencies.logger.debug('turn_supervision.receipt.claim.started', {
      agentSessionId: event.agentSessionId,
      turnId: event.turnId,
    });
    const claim = await this.dependencies.receipts.claim(event.turnId);
    if (claim.status === 'RECORDED') {
      this.dependencies.logger.info('turn_supervision.dispatch.replayed', {
        agentSessionId: event.agentSessionId,
        turnId: event.turnId,
        disposition: claim.disposition.status,
        supervisor: claim.disposition.supervisor,
      });
      return claim.disposition;
    }
    this.dependencies.logger.debug('turn_supervision.receipt.claimed', {
      agentSessionId: event.agentSessionId,
      turnId: event.turnId,
    });

    let supervisors: readonly TurnSupervisor[];
    try {
      supervisors = await this.dependencies.resolver.resolve(event);
    } catch (error) {
      const disposition: TurnSupervisionDisposition = {
        status: 'FAILED',
        supervisor: 'SESSION_MONITOR',
        reason: error instanceof Error ? error.message : String(error),
      };
      this.dependencies.logger.error('turn_supervision.resolution.failed', {
        agentSessionId: event.agentSessionId,
        turnId: event.turnId,
        error,
      });
      await this.dependencies.receipts.releaseClaim(event.turnId);
      return disposition;
    }

    let lastRelease: TurnSupervisionDisposition = {
      status: 'RELEASED',
      supervisor: 'SESSION_MONITOR',
      reason: 'NO_APPLICABLE_SUPERVISOR',
    };
    for (const supervisor of supervisors) {
      this.dependencies.logger.info('turn_supervision.supervisor.started', {
        agentSessionId: event.agentSessionId,
        turnId: event.turnId,
        supervisor: supervisor.id,
      });
      let disposition: TurnSupervisionDisposition;
      try {
        disposition = await supervisor.invoke(event, auth);
        if (disposition.supervisor !== supervisor.id) {
          throw new Error(
            `Supervisor ${supervisor.id} returned disposition for ${disposition.supervisor}.`,
          );
        }
      } catch (error) {
        disposition = {
          status: 'FAILED',
          supervisor: supervisor.id,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      this.dependencies.logger.info('turn_supervision.supervisor.completed', {
        agentSessionId: event.agentSessionId,
        turnId: event.turnId,
        supervisor: supervisor.id,
        disposition: disposition.status,
      });

      if (disposition.status === 'RELEASED') {
        lastRelease = disposition;
        continue;
      }
      if (disposition.status === 'FAILED') {
        this.dependencies.logger.error('turn_supervision.dispatch.halted', {
          agentSessionId: event.agentSessionId,
          turnId: event.turnId,
          supervisor: disposition.supervisor,
          reason: disposition.reason,
        });
        await this.dependencies.receipts.releaseClaim(event.turnId);
        return disposition;
      }
      return this.record(event, disposition);
    }

    this.dependencies.logger.info('turn_supervision.dispatch.released', {
      agentSessionId: event.agentSessionId,
      turnId: event.turnId,
      supervisor: lastRelease.supervisor,
      reason: lastRelease.status === 'RELEASED' ? lastRelease.reason : undefined,
    });
    return this.record(event, lastRelease);
  }

  private async record(
    event: CanonicalSettledTurnMonitorEvent,
    disposition: CompletedTurnSupervisionDisposition,
  ): Promise<CompletedTurnSupervisionDisposition> {
    this.dependencies.logger.debug('turn_supervision.receipt.record.started', {
      agentSessionId: event.agentSessionId,
      turnId: event.turnId,
      disposition: disposition.status,
      supervisor: disposition.supervisor,
    });
    try {
      const recorded = await this.dependencies.receipts.record(event.turnId, disposition);
      this.dependencies.logger.info('turn_supervision.receipt.recorded', {
        agentSessionId: event.agentSessionId,
        turnId: event.turnId,
        disposition: recorded.status,
        supervisor: recorded.supervisor,
      });
      return recorded;
    } catch (error) {
      await this.dependencies.receipts.releaseClaim(event.turnId);
      this.dependencies.logger.error('turn_supervision.receipt.record.failed', {
        agentSessionId: event.agentSessionId,
        turnId: event.turnId,
        disposition: disposition.status,
        supervisor: disposition.supervisor,
        error,
      });
      throw error;
    }
  }

  private enqueue<T>(agentSessionId: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.tailsByAgentSession.get(agentSessionId) ?? Promise.resolve();
    const result = prior.catch(() => undefined).then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tailsByAgentSession.set(agentSessionId, tail);
    void tail.then(() => {
      if (this.tailsByAgentSession.get(agentSessionId) === tail) {
        this.tailsByAgentSession.delete(agentSessionId);
      }
    });
    return result;
  }
}
