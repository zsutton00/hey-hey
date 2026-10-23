import { DAILY_SESSION_MONITOR_LOG_EVENT } from '../shared/logging/daily-session';
import type { ServerLogger } from './logger';
import type { MonitorPipeline } from './monitors';
import { fromPlatformWebSocketEvent, type AgentSource } from './monitors/normalizer';
import { isDailySessionActivityEventType } from './monitors/rules/subscribe';
import type {
  PlatformDeliveryContext,
  PlatformWebSocketEvent,
  PlatformWebSocketManager,
} from './platform-ws';
import type { ReportInfluenceRuntime } from './reports/report-influence-runtime';
import type { TriggerVerificationRuntime } from './trigger-verification/trigger-verification-runtime';
import type { AgentOperationDispatchAcknowledgement } from '../shared/api/generated/api';

export interface PlatformEventDispatcherDependencies {
  platformWebSocketManager: PlatformWebSocketManager;
  triggerVerificationRuntime: TriggerVerificationRuntime;
  agentSource: AgentSource;
  monitorPipeline: MonitorPipeline;
  reportInfluenceRuntime: ReportInfluenceRuntime;
  logger: ServerLogger;
}

/** Owns upstream event subscriptions and routes each frame to its named domain owner. */
export class PlatformEventDispatcher {
  private unsubscribeEvent: (() => void) | null = null;
  private unsubscribeMonitorCommand: (() => void) | null = null;
  private unsubscribeAuthorityReduction: (() => void) | null = null;

  public constructor(private readonly dependencies: PlatformEventDispatcherDependencies) {}

  public start(): void {
    if (
      this.unsubscribeEvent ||
      this.unsubscribeMonitorCommand ||
      this.unsubscribeAuthorityReduction
    ) {
      return;
    }
    this.unsubscribeMonitorCommand = this.dependencies.platformWebSocketManager.onMonitorCommand(
      this.handleMonitorCommand,
    );
    this.unsubscribeAuthorityReduction =
      this.dependencies.platformWebSocketManager.onAuthorityReduction(
        this.handleAuthorityReduction,
      );
    this.unsubscribeEvent = this.dependencies.platformWebSocketManager.onEvent(this.handleEvent);
    this.dependencies.logger.debug('platform-events.dispatcher.started');
  }

  public dispose(): void {
    this.unsubscribeEvent?.();
    this.unsubscribeMonitorCommand?.();
    this.unsubscribeAuthorityReduction?.();
    this.unsubscribeEvent = null;
    this.unsubscribeMonitorCommand = null;
    this.unsubscribeAuthorityReduction = null;
    this.dependencies.logger.debug('platform-events.dispatcher.stopped');
  }

  private readonly handleMonitorCommand = (
    event: PlatformWebSocketEvent,
  ): ReturnType<TriggerVerificationRuntime['handleMonitorCommand']> =>
    this.dependencies.triggerVerificationRuntime.handleMonitorCommand(event);

  private readonly handleAuthorityReduction = (
    event: PlatformWebSocketEvent,
  ): ReturnType<TriggerVerificationRuntime['handleAuthorityReduction']> =>
    this.dependencies.triggerVerificationRuntime.handleAuthorityReduction(event);

  private readonly handleEvent = async (
    event: PlatformWebSocketEvent,
    context?: PlatformDeliveryContext,
  ): Promise<AgentOperationDispatchAcknowledgement | void> => {
    const { logger } = this.dependencies;
    logger.trace('platform-ws.incoming', {
      type: event.type,
      projectId: event.projectId,
      userId: event.userId,
    });

    if (
      event.type === 'trigger.conversation' ||
      event.type === 'trigger.control' ||
      event.type === 'trigger.control_reduction' ||
      event.type === 'trigger.application_effect' ||
      event.type === 'trigger.exact_action' ||
      event.type === 'trigger.monitor_reduction'
    ) {
      return context
        ? this.dependencies.triggerVerificationRuntime.handlePlatformEvent(event, context)
        : this.dependencies.triggerVerificationRuntime.handlePlatformEvent(event);
    }

    const configuredDailySessionActivity =
      typeof this.dependencies.monitorPipeline.watchesDailySessionEventType === 'function'
        ? this.dependencies.monitorPipeline.watchesDailySessionEventType(event.type)
        : false;
    const isDailySessionActivity =
      configuredDailySessionActivity || isDailySessionActivityEventType(event.type);
    if (isDailySessionActivity) {
      const entityId = [event['entityId'], event['taskId'], event['agentSessionId']].find(
        (value): value is string => typeof value === 'string',
      );
      logger.info(DAILY_SESSION_MONITOR_LOG_EVENT, {
        stage: 'platform_event_received',
        eventType: event.type,
        projectId: event.projectId,
        entityId,
        eventUserId: event.userId,
      });
    }

    if (isDailySessionActivity) {
      logger.debug('platform-ws.incoming.monitor_activity.accepted', {
        eventType: event.type,
        projectId: event.projectId,
        eventUserId: event.userId,
      });
      const canonical = this.dependencies.agentSource.normalizePlatformEvent(
        fromPlatformWebSocketEvent(event),
      );
      this.dependencies.monitorPipeline.ingest(canonical);
    } else {
      logger.trace('monitors.platform_event.excluded', {
        eventType: event.type,
        projectId: event.projectId,
      });
    }

    this.dependencies.reportInfluenceRuntime.handlePlatformEvent(event);

    return context
      ? this.dependencies.triggerVerificationRuntime.handlePlatformEvent(event, context)
      : this.dependencies.triggerVerificationRuntime.handlePlatformEvent(event);
  };
}
