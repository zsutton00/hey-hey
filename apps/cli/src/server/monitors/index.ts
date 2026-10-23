import { LocalPromptType } from '../../shared/agent-bridge-contract/generated';
import { DAILY_SESSION_MONITOR_LOG_EVENT } from '../../shared/logging/daily-session';
import type { ServerLogger } from '../logger';
import { DailySessionMonitor } from './declarations/daily-session';
import type { DailySessionSettings } from './daily-session-settings';
import type { Monitor } from './declarations/types';
import type { CanonicalMonitorEvent } from './normalizer';
import { MonitorPreSubscribeFilter } from './pre-filter';
import { MonitorRunner, type MonitorRunnerDependencies } from './runner';
import type { TurnSupervisor } from './turn-supervision-chain';
import type { TriggerConfig } from './trigger-config';

/** Per-monitor accumulation state surfaced in the /debug snapshot. */
interface MonitorDebugEntry {
  id: string;
  route: LocalPromptType;
  pending: number;
  threshold: number | null;
}

/** The /debug snapshot the triggers route reads from the composed pipeline. */
export interface MonitorPipelineDebug {
  eventThreshold: number | null;
  queuedSignalCount: number;
  signalsUntilThreshold: number;
  willTriggerOnNextSignal: boolean;
  monitors: MonitorDebugEntry[];
}

export interface MonitorPipelineDependencies extends MonitorRunnerDependencies {
  monitors: readonly Monitor[];
  triggerConfig: Pick<TriggerConfig, 'quietHours' | 'debounceMs'>;
  logger: ServerLogger;
}

/**
 * Compose the inbound monitor pipeline. `MonitorApplicationRuntime` owns this
 * entry point: both source lanes (platform events and the agent-events lane's
 * report emissions) feed {@link MonitorPipeline.ingest}; everything downstream
 * — subscribe, gate, route, fire — lives here as declared data.
 *
 * Replaces the deleted trigger engine + signal accumulator + session
 * coordinator: the gate now owns all accumulation state, and a firing builds a
 * fresh turn-lived Run via the runner rather than resuming one long-lived
 * session.
 */
export class MonitorPipeline {
  private readonly dailySessionMonitor: DailySessionMonitor | undefined;
  private readonly preFilter: MonitorPreSubscribeFilter;
  private readonly runner: MonitorRunner;

  public constructor(private readonly dependencies: MonitorPipelineDependencies) {
    this.dailySessionMonitor = dependencies.monitors.find(
      (monitor): monitor is DailySessionMonitor => monitor instanceof DailySessionMonitor,
    );
    this.preFilter = new MonitorPreSubscribeFilter({
      config: dependencies.triggerConfig,
      logger: dependencies.logger.child({ component: 'monitors.pre-filter' }),
    });
    this.runner = new MonitorRunner({
      authProvider: dependencies.authProvider,
      agentService: dependencies.agentService,
      runStore: dependencies.runStore,
      platformWebSocketManager: dependencies.platformWebSocketManager,
      agentSessionReader: dependencies.agentSessionReader,
      taskMonitorDecisionStore: dependencies.taskMonitorDecisionStore,
      sessionMonitorEvaluationStore: dependencies.sessionMonitorEvaluationStore,
      turnSupervisionReceiptStorePath: dependencies.turnSupervisionReceiptStorePath,
      apiBaseUrl: dependencies.apiBaseUrl,
      ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
      logger: dependencies.logger.child({ component: 'monitors.runner' }),
      keyPairStore: dependencies.keyPairStore,
    });
  }

  public registerTaskMonitorTurnSupervisor(supervisor: TurnSupervisor): void {
    this.runner.registerTaskMonitorTurnSupervisor(supervisor);
  }

  public async ensureDailySessionIdentity(): Promise<void> {
    if (!this.dailySessionMonitor) return;
    const auth = await this.dependencies.authProvider.resolve();
    if (!auth) {
      this.dependencies.logger.warn(DAILY_SESSION_MONITOR_LOG_EVENT, {
        stage: 'startup_identity_recovery_skipped',
        reason: 'auth_unavailable',
      });
      return;
    }
    await this.runner.ensureDailySessionIdentity(auth, this.dailySessionMonitor.settings);
  }

  public ingest(event: CanonicalMonitorEvent): void {
    const { logger, monitors } = this.dependencies;
    logger.debug('monitors.pipeline.event.received', {
      eventType: event.eventType,
      origin: event.origin,
      projectId: event.projectId,
      entityId: event.entityId,
    });
    if (event.origin === 'platform') {
      logger.info(DAILY_SESSION_MONITOR_LOG_EVENT, {
        stage: 'pipeline_event_received',
        eventType: event.eventType,
        projectId: event.projectId,
        entityId: event.entityId,
      });
    }
    // Quiet-hours and debounce apply only to platform activity.
    const platformPreFilterAccepted = event.origin !== 'platform' || this.preFilter.accept(event);
    if (!platformPreFilterAccepted) {
      logger.info(DAILY_SESSION_MONITOR_LOG_EVENT, {
        stage: 'pre_filter_rejected',
        eventType: event.eventType,
        projectId: event.projectId,
        entityId: event.entityId,
      });
    }
    // Admission can consult external state, while ingest remains
    // fire-and-forget for both platform and agent-source callers.
    void (async () => {
      for (const monitor of monitors) {
        // Quiet-hours/debounce policy belongs to Daily Session activity. Task
        // Monitor lifecycle admission must still see canonical session events.
        if (
          event.origin === 'platform' &&
          !platformPreFilterAccepted &&
          monitor.route === LocalPromptType.DailySession
        ) {
          continue;
        }
        const subscribed = monitor.subscribes(event);
        logger.debug('monitors.pipeline.subscription.evaluated', {
          declarationId: monitor.id,
          eventType: event.eventType,
          origin: event.origin,
          subscribed,
        });
        if (monitor.route === LocalPromptType.DailySession) {
          logger.info(DAILY_SESSION_MONITOR_LOG_EVENT, {
            stage: 'subscription_evaluated',
            eventType: event.eventType,
            origin: event.origin,
            subscribed,
          });
        }
        if (!subscribed) {
          continue;
        }
        let admitted: boolean;
        try {
          admitted = await monitor.admits(event);
        } catch (error) {
          logger.error('monitors.pipeline.opt-in-failed', {
            declarationId: monitor.id,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
        if (!admitted) {
          logger.info('monitors.pipeline.opt-in-rejected', {
            declarationId: monitor.id,
            eventType: event.eventType,
          });
          if (monitor.route === LocalPromptType.DailySession) {
            logger.info(DAILY_SESSION_MONITOR_LOG_EVENT, {
              stage: 'admission_rejected',
              reason: 'automatic_firing_disabled',
              eventType: event.eventType,
              projectId: event.projectId,
            });
          }
          continue;
        }
        const result = monitor.gate.accept(event);
        const gateState = monitor.gate.inspect();
        logger.debug('monitors.pipeline.gate.accepted', {
          declarationId: monitor.id,
          route: monitor.route,
          eventType: event.eventType,
          pending: gateState.pending,
          threshold: gateState.threshold,
          fired: result.fired,
          batchSize: result.batch.length,
        });
        if (monitor.route === LocalPromptType.DailySession) {
          logger.info(DAILY_SESSION_MONITOR_LOG_EVENT, {
            stage: 'gate_evaluated',
            eventType: event.eventType,
            pending: gateState.pending,
            threshold: gateState.threshold,
            fired: result.fired,
            batchSize: result.batch.length,
          });
        }
        if (!result.fired) {
          continue;
        }
        logger.debug('monitors.pipeline.gate-fired', {
          declarationId: monitor.id,
          route: monitor.route,
          batchSize: result.batch.length,
        });
        try {
          logger.debug('monitors.pipeline.run.started', {
            declarationId: monitor.id,
            route: monitor.route,
            batchSize: result.batch.length,
          });
          if (monitor.route === LocalPromptType.DailySession) {
            logger.info(DAILY_SESSION_MONITOR_LOG_EVENT, {
              stage: 'runner_started',
              batchSize: result.batch.length,
            });
          }
          await this.runner.run(monitor, result.batch);
          logger.debug('monitors.pipeline.run.completed', {
            declarationId: monitor.id,
            route: monitor.route,
            batchSize: result.batch.length,
          });
          if (monitor.route === LocalPromptType.DailySession) {
            logger.info(DAILY_SESSION_MONITOR_LOG_EVENT, {
              stage: 'runner_completed',
              batchSize: result.batch.length,
            });
          }
        } catch (error) {
          logger.error('monitors.pipeline.run-failed', {
            declarationId: monitor.id,
            error: error instanceof Error ? error.message : String(error),
          });
          if (monitor.route === LocalPromptType.DailySession) {
            logger.error(DAILY_SESSION_MONITOR_LOG_EVENT, {
              stage: 'runner_failed',
              batchSize: result.batch.length,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    })();
  }

  public queuedSignalCount(): number {
    return this.dailySessionMonitor?.gate.inspect().pending ?? 0;
  }

  public watchesDailySessionEventType(eventType: string): boolean {
    return this.dailySessionMonitor?.watchesEventType(eventType) ?? false;
  }

  public applyDailySessionSettings(settings: DailySessionSettings): void {
    if (!this.dailySessionMonitor) {
      throw new Error('Daily Session monitor is not declared in the monitor pipeline.');
    }
    this.dailySessionMonitor.applySettings(settings);
    this.dependencies.logger.info('monitors.daily_session.settings_applied', {
      enabled: settings.enabled,
      countThreshold: settings.countThreshold,
      eventTypeCount: settings.eventTypes.length,
      provider: settings.provider,
      model: settings.model,
      reasoningEffort: settings.reasoningEffort,
      gatePending: this.dailySessionMonitor.gate.inspect().pending,
    });
  }

  public getDebug(): MonitorPipelineDebug {
    const dailyState = this.dailySessionMonitor?.gate.inspect() ?? {
      pending: 0,
      threshold: null,
    };
    const pending = dailyState.pending;
    const threshold = dailyState.threshold;
    const signalsUntilThreshold = threshold === null ? 0 : Math.max(0, threshold - pending);
    return {
      eventThreshold: threshold,
      queuedSignalCount: pending,
      signalsUntilThreshold,
      willTriggerOnNextSignal: threshold !== null && pending + 1 >= threshold,
      monitors: this.dependencies.monitors.map((monitor) => {
        const state = monitor.gate.inspect();
        return {
          id: monitor.id,
          route: monitor.route,
          pending: state.pending,
          threshold: state.threshold,
        };
      }),
    };
  }

  public dispose(): void {
    this.preFilter.dispose();
  }
}
