import type { ServerLogger } from '../../logger';
import type { AgentSessionReader } from '../agent-session-reader';
import { isReportEmissionEvent, type CanonicalMonitorEvent } from '../normalizer';

export interface SessionMonitorOptInPolicyDependencies {
  agentSessionReader: AgentSessionReader;
  logger: ServerLogger;
}

/**
 * Session-monitor opt-in predicate. Per the design doc, this is the live,
 * stateless gate that confirms the user has opted the target session into the
 * monitor agent (`autoDecide=true`) — distinct from the per-monitor gate. Run
 * between subscribe and gate.accept so a `false` return drops the event before
 * any side effect.
 *
 * Fail-closed: a missing session, a thrown lookup error, or an event that does
 * not carry a target session id all drop the event and log the reason on
 * `monitors.opt_in.session_monitor.dropped`. The lookup hits the platform on
 * every invocation — no caching — so a mid-session toggle takes effect on the
 * next report.
 */
export class SessionMonitorOptInPolicy {
  public constructor(private readonly dependencies: SessionMonitorOptInPolicyDependencies) {}

  public async handle(event: CanonicalMonitorEvent): Promise<boolean> {
    const { logger } = this.dependencies;
    if (!isReportEmissionEvent(event)) {
      logger.warn('monitors.opt_in.session_monitor.dropped', {
        reason: 'unexpected_event_variant',
        eventType: event.eventType,
      });
      return false;
    }

    const targetSessionId = event.targetSessionId;
    let session;
    try {
      session = await this.dependencies.agentSessionReader.readAgentSession(targetSessionId);
    } catch (error) {
      logger.warn('monitors.opt_in.session_monitor.dropped', {
        reason: 'lookup_error',
        targetSessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }

    if (!session) {
      logger.warn('monitors.opt_in.session_monitor.dropped', {
        reason: 'not_found',
        targetSessionId,
      });
      return false;
    }

    if (session.autoDecide !== true) {
      logger.info('monitors.opt_in.session_monitor.dropped', {
        reason: 'auto_decide_false',
        targetSessionId,
      });
      return false;
    }

    return true;
  }
}
