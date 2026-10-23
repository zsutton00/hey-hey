import type { RunStore } from '../../../run-store';
import { SessionValidationError } from '../../../session/errors';
import type { LocalAgentService } from '../../../server/local-agent-service';
import type { ServerLogger } from '../../../server/logger';
import type { TaskMonitorStartRuntime } from '../../../server/task-monitor-start';
import { WorkStatus } from '../../../shared/api/generated/api';
import type { EffectHandler, EffectSettlement } from '../../../state-machine';
import type {
  HaltTaskMonitorControlEffect,
  ProjectTaskMonitorControlStatusEffect,
} from './effects';
import type { TaskMonitorMachineEffectOutcome } from './events';

const responseStatus = (error: Error): number | null => {
  if (!('response' in error)) return null;
  const response = error.response;
  if (typeof response !== 'object' || response === null || !('status' in response)) return null;
  return typeof response.status === 'number' ? response.status : null;
};

const isCancelled = (error: Error): boolean =>
  error.name === 'AbortError' || error.name === 'CanceledError';

const isSettledFailure = (error: Error): boolean => {
  if (error instanceof SessionValidationError) return true;
  const status = responseStatus(error);
  return status !== null && status >= 400 && status < 500 && ![408, 409, 429].includes(status);
};

const failedSettlement = (
  effect: HaltTaskMonitorControlEffect,
  error: Error,
): EffectSettlement<TaskMonitorMachineEffectOutcome> => {
  const common = { taskMonitorId: effect.taskMonitorId, reason: error.message } as const;
  if (isCancelled(error)) {
    return {
      status: 'cancelled',
      outcome: { type: 'TASK_MONITOR_STOP_CANCELLED', ...common },
    };
  }
  if (isSettledFailure(error)) {
    return {
      status: 'failed',
      outcome: { type: 'TASK_MONITOR_STOP_FAILED', ...common },
    };
  }
  return {
    status: 'uncertain',
    outcome: { type: 'TASK_MONITOR_STOP_UNCERTAIN', ...common },
  };
};

const statusProjectionFailure = (
  effect: ProjectTaskMonitorControlStatusEffect,
  error: Error,
): EffectSettlement<TaskMonitorMachineEffectOutcome> => {
  const common = {
    taskMonitorId: effect.taskMonitorId,
    status: effect.status,
    reason: error.message,
  } as const;
  if (isCancelled(error)) {
    return {
      status: 'cancelled',
      outcome: { type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTION_CANCELLED', ...common },
    };
  }
  if (isSettledFailure(error)) {
    return {
      status: 'failed',
      outcome: { type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTION_FAILED', ...common },
    };
  }
  return {
    status: 'uncertain',
    outcome: { type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTION_UNCERTAIN', ...common },
  };
};

/** Reconciles one committed control transition with the canonical Task Monitor work item. */
export class TaskMonitorControlStatusProjectionEffectHandler implements EffectHandler<
  ProjectTaskMonitorControlStatusEffect,
  TaskMonitorMachineEffectOutcome
> {
  public readonly recovery = {
    strategy: 'reconcile' as const,
    reconcile: (effect: ProjectTaskMonitorControlStatusEffect) => this.execute(effect),
  };

  public constructor(
    private readonly runtime: TaskMonitorStartRuntime,
    private readonly logger: ServerLogger,
  ) {}

  public async execute(
    effect: ProjectTaskMonitorControlStatusEffect,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    this.logger.debug('task_monitor.machine.control.status_projection.started', {
      monitorId: effect.taskMonitorId,
      targetStatus: effect.status,
    });
    try {
      const monitor = await this.runtime.readMonitor({
        monitorId: effect.taskMonitorId,
        organizationId: effect.organizationId,
        projectId: effect.projectId,
      });
      if (monitor.status === effect.status) {
        this.logger.info('task_monitor.machine.control.status_projection.reconciled', {
          monitorId: effect.taskMonitorId,
          targetStatus: effect.status,
          mutationRequired: false,
        });
        return this.succeeded(effect);
      }
      if (monitor.status === WorkStatus.Completed) {
        throw new SessionValidationError(
          'Task Monitor control status projection cannot replace canonical completion.',
        );
      }
      this.logger.debug('task_monitor.machine.control.status_projection.mutation_started', {
        monitorId: effect.taskMonitorId,
        priorStatus: monitor.status,
        targetStatus: effect.status,
      });
      await this.runtime.persistMonitorStatus({
        monitor,
        status: effect.status,
        reason:
          effect.status === WorkStatus.OnHold
            ? 'Project committed Task Monitor PAUSE control to canonical lifecycle status.'
            : 'Project committed Task Monitor RESUME control to canonical lifecycle status.',
      });
      this.logger.info('task_monitor.machine.control.status_projection.reconciled', {
        monitorId: effect.taskMonitorId,
        priorStatus: monitor.status,
        targetStatus: effect.status,
        mutationRequired: true,
      });
      return this.succeeded(effect);
    } catch (caught) {
      const error =
        caught instanceof Error
          ? caught
          : new Error('Task Monitor control status projection failed.');
      const settlement = statusProjectionFailure(effect, error);
      this.logger.error('task_monitor.machine.control.status_projection.failed', {
        monitorId: effect.taskMonitorId,
        targetStatus: effect.status,
        settlementStatus: settlement.status,
        error,
      });
      return settlement;
    }
  }

  private succeeded(
    effect: ProjectTaskMonitorControlStatusEffect,
  ): EffectSettlement<TaskMonitorMachineEffectOutcome> {
    return {
      status: 'succeeded',
      outcome: {
        type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTED',
        taskMonitorId: effect.taskMonitorId,
        status: effect.status,
      },
    };
  }
}

/** Projects the committed halt, then delegates interruption to the existing Run owner. */
export class TaskMonitorControlEffectHandler implements EffectHandler<
  HaltTaskMonitorControlEffect,
  TaskMonitorMachineEffectOutcome
> {
  public readonly recovery = {
    strategy: 'reconcile' as const,
    reconcile: (effect: HaltTaskMonitorControlEffect) =>
      Promise.resolve({
        status: 'uncertain' as const,
        outcome: {
          type: 'TASK_MONITOR_STOP_UNCERTAIN' as const,
          taskMonitorId: effect.taskMonitorId,
          reason: 'Task Monitor stop settlement is uncertain after process recovery.',
        },
      }),
  };

  public constructor(
    private readonly taskMonitorRuntime: TaskMonitorStartRuntime,
    private readonly runStore: RunStore,
    private readonly agentService: LocalAgentService,
    private readonly logger: ServerLogger,
  ) {}

  public async execute(
    effect: HaltTaskMonitorControlEffect,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    this.logger.debug('task_monitor.machine.control.stop.started', {
      monitorId: effect.taskMonitorId,
      activeRunAgentSessionId: effect.activeRunAgentSessionId,
    });
    try {
      this.logger.debug('task_monitor.machine.control.halt_projection.started', {
        monitorId: effect.taskMonitorId,
      });
      await this.taskMonitorRuntime.haltMonitor({
        monitorId: effect.taskMonitorId,
        organizationId: effect.organizationId,
        projectId: effect.projectId,
        failureContext: effect.failureContext,
      });
      this.logger.info('task_monitor.machine.control.halt_projection.completed', {
        monitorId: effect.taskMonitorId,
      });

      if (effect.activeRunAgentSessionId === null) {
        this.logger.debug('task_monitor.machine.control.interruption.not_required', {
          monitorId: effect.taskMonitorId,
          reason: 'no_recorded_active_run',
        });
        return this.succeeded(effect);
      }

      this.logger.debug('task_monitor.machine.control.active_run_resolution.started', {
        monitorId: effect.taskMonitorId,
        agentSessionId: effect.activeRunAgentSessionId,
      });
      const runId = this.runStore.lookupByAgentSessionId(effect.activeRunAgentSessionId);
      if (runId === null) {
        this.logger.debug('task_monitor.machine.control.interruption.not_required', {
          monitorId: effect.taskMonitorId,
          agentSessionId: effect.activeRunAgentSessionId,
          reason: 'recorded_run_no_longer_present',
        });
        return this.succeeded(effect);
      }

      this.logger.info('task_monitor.machine.control.interruption.started', {
        monitorId: effect.taskMonitorId,
        agentSessionId: effect.activeRunAgentSessionId,
        runId,
      });
      await this.agentService.stopRun(runId);
      this.logger.info('task_monitor.machine.control.interruption.completed', {
        monitorId: effect.taskMonitorId,
        agentSessionId: effect.activeRunAgentSessionId,
        runId,
      });
      return this.succeeded(effect);
    } catch (caught) {
      const error =
        caught instanceof Error ? caught : new Error('Task Monitor stop operation failed.');
      const settlement = failedSettlement(effect, error);
      this.logger.error('task_monitor.machine.control.stop.failed', {
        monitorId: effect.taskMonitorId,
        activeRunAgentSessionId: effect.activeRunAgentSessionId,
        settlementStatus: settlement.status,
        error,
      });
      return settlement;
    }
  }

  private succeeded(
    effect: HaltTaskMonitorControlEffect,
  ): EffectSettlement<TaskMonitorMachineEffectOutcome> {
    this.logger.info('task_monitor.machine.control.stop.completed', {
      monitorId: effect.taskMonitorId,
      activeRunAgentSessionId: effect.activeRunAgentSessionId,
    });
    return {
      status: 'succeeded',
      outcome: {
        type: 'TASK_MONITOR_STOP_SUCCEEDED',
        taskMonitorId: effect.taskMonitorId,
      },
    };
  }
}
