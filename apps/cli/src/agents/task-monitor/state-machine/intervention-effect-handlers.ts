import { randomUUID } from 'node:crypto';
import type { MessagePoster } from '../../../run/message-poster';
import type { Run } from '../../../run/run';
import type { PermissionDecisionDeliveryOutcome, RunRegistry } from '../../../run/run-registry';
import type { ServerLogger } from '../../../server/logger';
import type {
  EffectExecutionIdentity,
  EffectHandler,
  EffectSettlement,
} from '../../../state-machine';
import type { TaskMonitorCoordinatorRunner } from '../../../server/monitors/runner';
import {
  toTaskMonitorPermissionDecidedMessage,
  type TaskMonitorPermissionDecisionRecord,
} from '../task-monitor-decision-message';
import type { TaskMonitorDecisionStore } from '../task-monitor-decision-store';
import { toTaskMonitorInterventionMessage } from '../task-monitor-intervention-message';
import {
  isTaskMonitorPermissionDecision,
  type TaskMonitorPermissionDecision,
} from '../task-monitor-permission-decision';
import {
  MONITOR_PERMISSION_DECISION_DEADLINE_MS,
  monitorDecisionDueAt,
  type ApplyTaskMonitorDecisionEffect,
  type DecideTaskMonitorPermissionEffect,
  type ProjectTaskMonitorInterventionEffect,
  type RecordTaskMonitorPermissionDecisionEffect,
  type WatchTaskMonitorPermissionDeadlineEffect,
} from './effects';
import type { TaskMonitorMachineEffectOutcome } from './events';
import type {
  TaskMonitorMachineContext,
  TaskMonitorPendingIntervention,
  TaskMonitorQueuedIntervention,
} from './context';
import type { TaskMonitorStateStore } from './machine';
import type { TaskMonitorStateMachineInputAdapter } from '../../../server/state-machine-input-adapter';

const reasonFrom = (error: unknown): string =>
  error instanceof Error ? error.message : 'Task Monitor intervention delivery failed.';

/** Projects the pending intervention without making the Message authoritative. */
export class TaskMonitorInterventionProjectionEffectHandler implements EffectHandler<
  ProjectTaskMonitorInterventionEffect,
  TaskMonitorMachineEffectOutcome
> {
  public readonly recovery = {
    strategy: 'reconcile' as const,
    reconcile: (effect: ProjectTaskMonitorInterventionEffect) =>
      Promise.resolve({
        status: 'uncertain' as const,
        outcome: {
          type: 'INTERVENTION_PROJECTION_FAILED' as const,
          taskMonitorId: effect.taskMonitorId,
          interventionId: effect.interventionId,
          providerActionId: effect.providerActionId,
          reason: 'Intervention projection delivery is uncertain after process recovery.',
        },
      }),
  };

  public constructor(
    private readonly poster: MessagePoster,
    private readonly logger: ServerLogger,
  ) {}

  public async execute(
    effect: ProjectTaskMonitorInterventionEffect,
    execution: EffectExecutionIdentity,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    this.logger.info('task_monitor.intervention.projection.started', {
      taskMonitorId: effect.taskMonitorId,
      interventionId: effect.interventionId,
      providerActionId: effect.providerActionId,
      effectId: execution.effectId,
    });
    try {
      const messageId = await this.poster.createOutOfBand({
        organizationId: effect.organizationId,
        projectId: effect.projectId,
        conversationId: effect.conversationId,
        dto: toTaskMonitorInterventionMessage(effect.projectId, effect),
        stamp: null,
      });
      this.logger.info('task_monitor.intervention.projection.completed', {
        taskMonitorId: effect.taskMonitorId,
        interventionId: effect.interventionId,
        providerActionId: effect.providerActionId,
        effectId: execution.effectId,
        messageId,
      });
      await this.projectAlso(effect, execution);
      return {
        status: 'succeeded',
        outcome: {
          type: 'INTERVENTION_PROJECTED',
          taskMonitorId: effect.taskMonitorId,
          interventionId: effect.interventionId,
          providerActionId: effect.providerActionId,
          messageId,
        },
      };
    } catch (error) {
      const reason = reasonFrom(error);
      this.logger.error('task_monitor.intervention.projection.failed', {
        taskMonitorId: effect.taskMonitorId,
        interventionId: effect.interventionId,
        providerActionId: effect.providerActionId,
        effectId: execution.effectId,
        reason,
      });
      return {
        status: 'failed',
        outcome: {
          type: 'INTERVENTION_PROJECTION_FAILED',
          taskMonitorId: effect.taskMonitorId,
          interventionId: effect.interventionId,
          providerActionId: effect.providerActionId,
          reason,
        },
      };
    }
  }

  /** Each request handed over together gets its own card; one that fails to post does not hide the rest. */
  private async projectAlso(
    effect: ProjectTaskMonitorInterventionEffect,
    execution: EffectExecutionIdentity,
  ): Promise<void> {
    for (const request of effect.alsoProject ?? []) {
      try {
        const messageId = await this.poster.createOutOfBand({
          organizationId: effect.organizationId,
          projectId: effect.projectId,
          conversationId: effect.conversationId,
          dto: toTaskMonitorInterventionMessage(effect.projectId, { ...effect, ...request }),
          stamp: null,
        });
        this.logger.info('task_monitor.intervention.projection.completed', {
          taskMonitorId: effect.taskMonitorId,
          interventionId: request.interventionId,
          providerActionId: request.providerActionId,
          effectId: execution.effectId,
          messageId,
        });
      } catch (error) {
        this.logger.error('task_monitor.intervention.projection.failed', {
          taskMonitorId: effect.taskMonitorId,
          interventionId: request.interventionId,
          providerActionId: request.providerActionId,
          effectId: execution.effectId,
          reason: reasonFrom(error),
        });
      }
    }
  }
}

const deliveryClassification = (reason: string): 'stale' | 'failed' | 'cancelled' | 'uncertain' => {
  if (
    /no_run_registered|No pending .* permission request|does not match pending request|service_scope_request_not_found/u.test(
      reason,
    )
  ) {
    return 'stale';
  }
  if (/abort|cancel/u.test(reason.toLowerCase())) return 'cancelled';
  if (/no_runner_bound|timeout|transport|connection|socket|closed/u.test(reason.toLowerCase())) {
    return 'uncertain';
  }
  return 'failed';
};

/** Delivers one committed human decision through the provider-owning Run. */
export class TaskMonitorDecisionApplicationEffectHandler implements EffectHandler<
  ApplyTaskMonitorDecisionEffect,
  TaskMonitorMachineEffectOutcome
> {
  public readonly recovery = {
    strategy: 'reconcile' as const,
    reconcile: (effect: ApplyTaskMonitorDecisionEffect) =>
      Promise.resolve({
        status: 'uncertain' as const,
        outcome: {
          type: 'DECISION_APPLICATION_UNCERTAIN' as const,
          taskMonitorId: effect.taskMonitorId,
          interventionId: effect.interventionId,
          providerActionId: effect.providerActionId,
          reason: 'Provider decision delivery is uncertain after process recovery.',
        },
      }),
  };
  private readonly deliveries = new Map<
    string,
    Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>>
  >();

  public constructor(
    private readonly runRegistry: RunRegistry,
    private readonly logger: ServerLogger,
  ) {}

  public execute(
    effect: ApplyTaskMonitorDecisionEffect,
    execution: EffectExecutionIdentity,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    const replay = this.deliveries.get(execution.effectId);
    if (replay) {
      this.logger.info('task_monitor.intervention.decision.replayed', {
        taskMonitorId: effect.taskMonitorId,
        interventionId: effect.interventionId,
        providerActionId: effect.providerActionId,
        effectId: execution.effectId,
      });
      return replay;
    }
    const delivery = this.deliver(effect, execution).finally(() => {
      this.deliveries.delete(execution.effectId);
      this.logger.debug('task_monitor.intervention.decision.delivery_released', {
        taskMonitorId: effect.taskMonitorId,
        interventionId: effect.interventionId,
        providerActionId: effect.providerActionId,
        effectId: execution.effectId,
      });
    });
    this.deliveries.set(execution.effectId, delivery);
    return delivery;
  }

  private async deliver(
    effect: ApplyTaskMonitorDecisionEffect,
    execution: EffectExecutionIdentity,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    const logContext = {
      taskMonitorId: effect.taskMonitorId,
      interventionId: effect.interventionId,
      providerActionId: effect.providerActionId,
      runId: effect.runId,
      agentSessionId: effect.agentSessionId,
      operation: effect.operation,
      effectId: execution.effectId,
    };
    this.logger.info('task_monitor.intervention.decision.started', logContext);
    const run = this.runRegistry.get(effect.runId);
    this.logger.debug('task_monitor.intervention.decision.owner_lookup.completed', {
      ...logContext,
      ownerFound: run !== null,
    });
    if (!run || run.agentSessionId !== effect.agentSessionId) {
      return this.classified(effect, execution, 'stale', 'provider-action-owner-stale');
    }

    this.logger.debug('task_monitor.intervention.decision.owner_call.started', {
      ...logContext,
      provider: run.provider,
    });
    const delivery = await this.submit(effect, run, execution);
    this.logger.debug('task_monitor.intervention.decision.owner_call.completed', {
      ...logContext,
      provider: run.provider,
      deliveryOutcome: delivery.outcome,
    });
    if (delivery.outcome === 'delivered') {
      this.logger.info('task_monitor.intervention.decision.delivered', {
        ...logContext,
        owner: 'SETTLED',
        decidedBy: effect.human ? 'HUMAN' : 'MONITOR',
        callbackType: delivery.callbackType,
      });
      return {
        status: 'succeeded',
        outcome: {
          type: 'DECISION_APPLIED',
          taskMonitorId: effect.taskMonitorId,
          interventionId: effect.interventionId,
          providerActionId: effect.providerActionId,
        },
      };
    }
    return this.classified(
      effect,
      execution,
      deliveryClassification(delivery.reason),
      delivery.reason,
    );
  }

  /** Each request kind is answered by its own owner; neither is ever decided through the other. */
  private async submit(
    effect: ApplyTaskMonitorDecisionEffect,
    run: Run,
    execution: EffectExecutionIdentity,
  ): Promise<PermissionDecisionDeliveryOutcome> {
    const reason = this.denialReason(effect);
    if (effect.requestKind === 'SERVICE_SCOPE') {
      try {
        return await run.serviceScopeCoordinator.decideByMonitor({
          requestId: effect.providerActionId,
          decision: effect.providerDecision === 'approve' ? 'approve' : 'deny',
          reason,
        });
      } catch (error) {
        return { outcome: 'failed', reason: reasonFrom(error) };
      }
    }

    return this.runRegistry.submitPermissionDecision(effect.runId, {
      runId: effect.runId,
      sessionId: effect.providerSessionId,
      requestId: effect.providerActionId,
      agentType: run.provider,
      decision: effect.providerDecision,
      reason,
      idempotencyToken: execution.effectId,
      ...(effect.human ? { userId: effect.human.userId, deciderUserId: effect.human.userId } : {}),
    });
  }

  private denialReason(effect: ApplyTaskMonitorDecisionEffect): string | null {
    if (effect.operation !== 'REJECT_EXACT_ACTION') {
      return null;
    }

    return effect.human ? 'Denied by user.' : `Denied by Task Monitor: ${effect.monitorRationale}`;
  }

  private classified(
    effect: ApplyTaskMonitorDecisionEffect,
    execution: EffectExecutionIdentity,
    classification: 'stale' | 'failed' | 'cancelled' | 'uncertain',
    reason: string,
  ): EffectSettlement<TaskMonitorMachineEffectOutcome> {
    const common = {
      taskMonitorId: effect.taskMonitorId,
      interventionId: effect.interventionId,
      providerActionId: effect.providerActionId,
      reason,
    } as const;
    this.logger[classification === 'failed' ? 'error' : 'warn'](
      `task_monitor.intervention.decision.${classification}`,
      { ...common, runId: effect.runId, effectId: execution.effectId },
    );
    switch (classification) {
      case 'stale':
        return { status: 'failed', outcome: { type: 'DECISION_APPLICATION_STALE', ...common } };
      case 'failed':
        return { status: 'failed', outcome: { type: 'DECISION_APPLICATION_FAILED', ...common } };
      case 'cancelled':
        return {
          status: 'cancelled',
          outcome: { type: 'DECISION_APPLICATION_CANCELLED', ...common },
        };
      case 'uncertain':
        return {
          status: 'uncertain',
          outcome: { type: 'DECISION_APPLICATION_UNCERTAIN', ...common },
        };
    }
  }
}

const MONITOR_DECISION_FAILED_PREFIX = 'The Task Monitor could not decide this request';

const DEADLINE = Symbol('monitor-decision-deadline');

/**
 * Asks the Task Monitor agent to decide one pending provider permission request.
 * Anything the monitor cannot judge becomes an escalation carrying the reason,
 * never a silent failure. The supervision record is a separate effect the machine
 * emits only once it has accepted the outcome.
 */
export class TaskMonitorPermissionDecisionEffectHandler implements EffectHandler<
  DecideTaskMonitorPermissionEffect,
  TaskMonitorMachineEffectOutcome
> {
  /**
   * A ruling cut off by a restart is only a judgment, never a provider action, so it is resumed at
   * once rather than handed over or left for the due time. It keeps the request's original due time,
   * and runs as a new coordinator attempt because the interrupted one cannot finish.
   */
  public readonly recovery = {
    strategy: 'reconcile' as const,
    reconcile: (effect: DecideTaskMonitorPermissionEffect, execution: EffectExecutionIdentity) => {
      this.logger.info('task_monitor.permission_decision.resumed_after_restart', {
        taskMonitorId: effect.taskMonitorId,
        interventionId: effect.interventionId,
        providerActionId: effect.providerActionId,
        runId: effect.runId,
        effectId: execution.effectId,
      });

      return this.execute(effect, execution, `${execution.effectId}:resumed:${randomUUID()}`);
    },
  };

  public constructor(
    private readonly coordinatorRunner: TaskMonitorCoordinatorRunner,
    private readonly decisionStore: TaskMonitorDecisionStore,
    private readonly runRegistry: RunRegistry,
    private readonly logger: ServerLogger,
    private readonly now: () => number = Date.now,
  ) {}

  public async execute(
    effect: DecideTaskMonitorPermissionEffect,
    execution: EffectExecutionIdentity,
    attemptId: string = execution.effectId,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    const logContext = {
      taskMonitorId: effect.taskMonitorId,
      interventionId: effect.interventionId,
      providerActionId: effect.providerActionId,
      runId: effect.runId,
      effectId: execution.effectId,
      attemptId,
    };
    this.logger.info('task_monitor.permission_decision.started', logContext);

    const outcome = effect.monitorPaused
      ? this.pausedEscalation(effect, logContext)
      : await this.decide(effect, attemptId, logContext);
    if (outcome.type === 'MONITOR_PERMISSION_ESCALATED' && effect.requestKind === 'SERVICE_SCOPE') {
      this.handServiceScopeToHuman(effect, outcome.reason, logContext);
    }

    return { status: 'succeeded', outcome };
  }

  /**
   * The Run owns a Service scope request and already shows it to the person; an escalation moves
   * the Run's wait from the monitor to them. When the Run is gone, restoring it from its persisted
   * request waits on the person, so there is nothing further to hand over.
   */
  private handServiceScopeToHuman(
    effect: DecideTaskMonitorPermissionEffect,
    reason: string,
    logContext: Record<string, string>,
  ): void {
    const run = this.runRegistry.get(effect.runId);
    if (!run || run.agentSessionId !== effect.agentSessionId) {
      this.logger.warn('task_monitor.service_scope.handoff_owner_missing', {
        ...logContext,
        reason,
      });
      return;
    }
    run.serviceScopeCoordinator.handToHuman(effect.providerActionId, reason);
  }

  /** A paused monitor decides nothing: the request goes to the person without asking it. */
  private pausedEscalation(
    effect: DecideTaskMonitorPermissionEffect,
    logContext: Record<string, string>,
  ): TaskMonitorMachineEffectOutcome {
    this.logger.warn('task_monitor.permission_decision.monitor_paused', logContext);

    return this.escalation(
      effect,
      'The Task Monitor is paused, so this request is waiting for a person.',
    );
  }

  private async decide(
    effect: DecideTaskMonitorPermissionEffect,
    attemptId: string,
    logContext: Record<string, string>,
  ): Promise<TaskMonitorMachineEffectOutcome> {
    try {
      const identity = await this.coordinatorRunner.runTaskMonitor(
        {
          monitorId: effect.taskMonitorId,
          cause: 'PERMISSION_REQUEST',
          correlationId: effect.interventionId,
          coordinatorAttemptId: attemptId,
          monitoredPermissionRequest: {
            interventionId: effect.interventionId,
            providerActionId: effect.providerActionId,
            runId: effect.runId,
            agentSessionId: effect.agentSessionId,
            action: effect.action,
            target: effect.target,
            fingerprint: effect.fingerprint,
            createdAt: effect.createdAt,
            expiresAt: effect.expiresAt,
          },
        },
        { organizationId: effect.organizationId, projectId: effect.projectId },
      );
      if (!identity) {
        return this.failed(effect, 'the monitor agent could not be started', logContext);
      }

      const result = await this.waitWithinDeadline(identity.runId, effect);
      if (result === DEADLINE) {
        return this.failed(
          effect,
          `no decision arrived within ${Math.round(MONITOR_PERMISSION_DECISION_DEADLINE_MS / 1000)} seconds`,
          logContext,
        );
      }
      if (result.status === 'INVALID') {
        return this.failed(
          effect,
          `the monitor's answer was invalid (${result.reason})`,
          logContext,
        );
      }
      if (result.status === 'TURN_SETTLED') {
        return this.failed(
          effect,
          `the monitor's turn ended without a decision (${result.terminalOutcome})`,
          logContext,
        );
      }
      if (!isTaskMonitorPermissionDecision(result.decision)) {
        return this.failed(
          effect,
          `the monitor answered with ${result.decision.action}, which does not decide a permission request`,
          logContext,
        );
      }

      return this.outcomeFor(effect, result.decision);
    } catch (error) {
      return this.failed(
        effect,
        error instanceof Error ? error.message : String(error),
        logContext,
      );
    }
  }

  /** Waits only for what is left of the request's due time, so startup and judgment share one budget. */
  private async waitWithinDeadline(
    runId: string,
    effect: DecideTaskMonitorPermissionEffect,
  ): Promise<Awaited<ReturnType<TaskMonitorDecisionStore['wait']>> | typeof DEADLINE> {
    const dueAt = effect.dueAt ?? monitorDecisionDueAt(effect.createdAt);
    const remainingMs = Math.max(0, Date.parse(dueAt) - this.now());
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<typeof DEADLINE>((resolve) => {
      timer = setTimeout(() => resolve(DEADLINE), remainingMs);
    });
    try {
      return await Promise.race([this.decisionStore.wait(runId), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  private outcomeFor(
    effect: DecideTaskMonitorPermissionEffect,
    decision: TaskMonitorPermissionDecision,
  ): TaskMonitorMachineEffectOutcome {
    if (decision.action === 'ESCALATE_PERMISSION') {
      return this.escalation(effect, decision.rationale);
    }

    const decidedAt = this.now();
    const approved = decision.action === 'APPROVE_PERMISSION';
    return {
      type: 'MONITOR_PERMISSION_DECIDED',
      taskMonitorId: effect.taskMonitorId,
      interventionId: effect.interventionId,
      providerActionId: effect.providerActionId,
      fingerprint: effect.fingerprint,
      resolution: approved ? 'APPROVE' : 'DENY',
      providerDecision: approved ? 'approve' : 'deny',
      rationale: decision.rationale,
      decidedAt: new Date(decidedAt).toISOString(),
    };
  }

  private failed(
    effect: DecideTaskMonitorPermissionEffect,
    cause: string,
    logContext: Record<string, string>,
  ): TaskMonitorMachineEffectOutcome {
    this.logger.error('task_monitor.permission_decision.failed', { ...logContext, cause });

    return this.escalation(effect, `${MONITOR_DECISION_FAILED_PREFIX}: ${cause}.`);
  }

  private escalation(
    effect: DecideTaskMonitorPermissionEffect,
    reason: string,
  ): TaskMonitorMachineEffectOutcome {
    this.logger.warn('task_monitor.permission_decision.escalated', {
      taskMonitorId: effect.taskMonitorId,
      interventionId: effect.interventionId,
      providerActionId: effect.providerActionId,
      runId: effect.runId,
      owner: 'HUMAN',
      cause: reason,
    });

    return {
      type: 'MONITOR_PERMISSION_ESCALATED',
      taskMonitorId: effect.taskMonitorId,
      interventionId: effect.interventionId,
      providerActionId: effect.providerActionId,
      reason,
      escalatedAt: new Date(this.now()).toISOString(),
    };
  }
}

/** Requests the monitor holds and has not yet ruled on: the front one and those queued behind it. */
const undecidedMonitorHeldRequests = (
  context: TaskMonitorMachineContext,
): readonly (TaskMonitorPendingIntervention | TaskMonitorQueuedIntervention)[] => {
  const pending = context.pendingIntervention;
  const front =
    pending !== null &&
    pending.decision === null &&
    pending.owner === 'MONITOR' &&
    pending.userRequired !== true
      ? [pending]
      : [];

  return [
    ...front,
    ...(context.queuedInterventions ?? []).filter(
      (request) => request.userRequired !== true && request.owner !== 'HUMAN',
    ),
  ];
};

/** One request whose due time is being watched. */
type WatchedPermissionRequest = Omit<WatchTaskMonitorPermissionDeadlineEffect, 'type'>;

/**
 * Hands a request the monitor still holds to the person once its due time passes. The due time is
 * stamped when the request is admitted, so a request waiting behind another, or one whose monitor
 * never started, reaches a person on the same clock as one being judged.
 *
 * Effects run one at a time, so the wait happens on a timer, not inside the effect: a five-minute
 * sleep there would hold up the ruling it watches and every other monitor's work. The effect only
 * arms the timer. When it fires, the escalation enters the machine as input, and the machine
 * ignores it if the request was answered first. Timers do not survive a restart, so `rearm` rebuilds
 * them from the machine's durable record; a request already overdue goes to the person at once.
 */
export class TaskMonitorPermissionDeadlineEffectHandler implements EffectHandler<
  WatchTaskMonitorPermissionDeadlineEffect,
  TaskMonitorMachineEffectOutcome
> {
  /** Arming is instant and idempotent, so a restart simply arms again. */
  public readonly recovery = { strategy: 'retry' as const };

  private readonly timers = new Map<string, NodeJS.Timeout>();
  private inputAdapter: TaskMonitorStateMachineInputAdapter | null = null;

  public constructor(
    private readonly runRegistry: RunRegistry,
    private readonly logger: ServerLogger,
    private readonly now: () => number = Date.now,
  ) {}

  /** Due times are applied through the machine's input path, connected once the monitor runtime is up. */
  public connectInput(inputAdapter: TaskMonitorStateMachineInputAdapter): void {
    this.inputAdapter = inputAdapter;
  }

  public execute(
    effect: WatchTaskMonitorPermissionDeadlineEffect,
    execution: EffectExecutionIdentity,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    this.arm(effect, execution.effectId);

    return Promise.resolve({
      status: 'succeeded',
      outcome: {
        type: 'PERMISSION_DEADLINE_ARMED',
        taskMonitorId: effect.taskMonitorId,
        interventionId: effect.interventionId,
        providerActionId: effect.providerActionId,
        dueAt: effect.dueAt,
      },
    });
  }

  /** Re-arms every request the monitor still holds, from each machine's durable record. */
  public async rearm(stateStore: TaskMonitorStateStore): Promise<void> {
    const instances = await stateStore.listInstances();
    let armed = 0;
    for (const { snapshot } of instances) {
      for (const request of undecidedMonitorHeldRequests(snapshot.context)) {
        this.arm(
          {
            taskMonitorId: snapshot.context.taskMonitorId,
            interventionId: request.interventionId,
            providerActionId: request.providerActionId,
            runId: request.runId,
            agentSessionId: request.agentSessionId,
            ...(request.requestKind ? { requestKind: request.requestKind } : {}),
            dueAt: monitorDecisionDueAt(request.createdAt),
          },
          'restart',
        );
        armed += 1;
      }
    }
    this.logger.info('task_monitor.permission_decision.deadline_watch.rearmed', {
      instanceCount: instances.length,
      armed,
    });
  }

  public dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  private arm(request: WatchedPermissionRequest, armedBy: string): void {
    const logContext = {
      taskMonitorId: request.taskMonitorId,
      interventionId: request.interventionId,
      providerActionId: request.providerActionId,
      runId: request.runId,
      dueAt: request.dueAt,
      armedBy,
    };
    if (this.timers.has(request.interventionId)) {
      this.logger.debug(
        'task_monitor.permission_decision.deadline_watch.already_armed',
        logContext,
      );
      return;
    }

    const remainingMs = Math.max(0, Date.parse(request.dueAt) - this.now());
    const timer = setTimeout(() => {
      this.timers.delete(request.interventionId);
      void this.fire(request).catch((error: unknown) => {
        this.logger.error('task_monitor.permission_decision.deadline_escalation_failed', {
          ...logContext,
          error,
        });
      });
    }, remainingMs);
    timer.unref();
    this.timers.set(request.interventionId, timer);
    this.logger.debug('task_monitor.permission_decision.deadline_watch.started', {
      ...logContext,
      remainingMs,
    });
  }

  private async fire(request: WatchedPermissionRequest): Promise<void> {
    const reason = `The Task Monitor did not decide this request within ${Math.round(MONITOR_PERMISSION_DECISION_DEADLINE_MS / 60000)} minutes, so it is waiting for a person.`;
    const logContext = {
      taskMonitorId: request.taskMonitorId,
      interventionId: request.interventionId,
      providerActionId: request.providerActionId,
      runId: request.runId,
      dueAt: request.dueAt,
    };
    const inputAdapter = this.inputAdapter;
    if (inputAdapter === null) {
      this.logger.error('task_monitor.permission_decision.deadline_input_unavailable', {
        ...logContext,
        cause: 'The Task Monitor input path is not connected, so the due time cannot be applied.',
      });
      return;
    }

    const result = await inputAdapter.admitVerified({
      source: 'PERMISSION_DEADLINE_REACHED',
      identity: { machineType: 'TASK_MONITOR', instanceId: request.taskMonitorId },
      ingressId: `permission-deadline:${request.interventionId}`,
      taskMonitorId: request.taskMonitorId,
      interventionId: request.interventionId,
      providerActionId: request.providerActionId,
      reason,
      escalatedAt: new Date(this.now()).toISOString(),
    });
    if (result.status === 'rejected') {
      this.logger.error('task_monitor.permission_decision.deadline_rejected', {
        ...logContext,
        code: result.code,
        cause: result.reason,
      });
      return;
    }

    // Only a real hand-over records the escalation; a due time reached after an answer changes nothing.
    const handedOver = result.effects.some(
      (effect) =>
        effect.type === 'RECORD_TASK_MONITOR_PERMISSION_DECISION' &&
        effect.interventionId === request.interventionId,
    );
    if (!handedOver) {
      this.logger.debug('task_monitor.permission_decision.deadline_after_answer', {
        ...logContext,
        admission: result.status,
      });
      return;
    }
    this.logger.warn('task_monitor.permission_decision.deadline_reached', {
      ...logContext,
      admission: result.status,
      owner: 'HUMAN',
      cause: reason,
    });
    // The Run moves its Service scope wait only once the machine has handed the request over, so
    // the Run and the machine never disagree about who holds it.
    if (request.requestKind === 'SERVICE_SCOPE') {
      this.runRegistry
        .get(request.runId)
        ?.serviceScopeCoordinator.handToHuman(request.providerActionId, reason);
    }
  }
}

/**
 * Projects one committed monitor permission outcome as supervision activity.
 * The machine emits it only after accepting the outcome, so the conversation never
 * shows a decision the machine rejected. A failed projection is reported back to the
 * machine with its cause and retried if the process dies before it settles.
 */
export class TaskMonitorPermissionRecordEffectHandler implements EffectHandler<
  RecordTaskMonitorPermissionDecisionEffect,
  TaskMonitorMachineEffectOutcome
> {
  public readonly recovery = { strategy: 'retry' as const };

  public constructor(
    private readonly poster: MessagePoster,
    private readonly logger: ServerLogger,
  ) {}

  public async execute(
    effect: RecordTaskMonitorPermissionDecisionEffect,
    execution: EffectExecutionIdentity,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    const logContext = {
      taskMonitorId: effect.taskMonitorId,
      interventionId: effect.interventionId,
      providerActionId: effect.providerActionId,
      effectId: execution.effectId,
      decision: effect.decision,
    };
    const common = {
      taskMonitorId: effect.taskMonitorId,
      interventionId: effect.interventionId,
      providerActionId: effect.providerActionId,
    };

    if (effect.conversationId === null) {
      const reason = 'the Task Monitor has no conversation to record the decision in';
      this.logger.warn('task_monitor.permission_decision.record_skipped', {
        ...logContext,
        reason,
      });

      return {
        status: 'failed',
        outcome: { type: 'PERMISSION_DECISION_RECORD_FAILED', ...common, reason },
      };
    }

    const record: TaskMonitorPermissionDecisionRecord = {
      providerActionId: effect.providerActionId,
      action: effect.action,
      target: effect.target,
      decision: effect.decision,
      rationale: effect.rationale,
    };
    try {
      await this.poster.createOutOfBand({
        organizationId: effect.organizationId,
        projectId: effect.projectId,
        conversationId: effect.conversationId,
        dto: toTaskMonitorPermissionDecidedMessage(effect.projectId, record),
        stamp: null,
      });
      this.logger.info('task_monitor.permission_decision.recorded', logContext);

      return { status: 'succeeded', outcome: { type: 'PERMISSION_DECISION_RECORDED', ...common } };
    } catch (error) {
      const reason = reasonFrom(error);
      this.logger.error('task_monitor.permission_decision.record_failed', {
        ...logContext,
        reason,
      });

      return {
        status: 'failed',
        outcome: { type: 'PERMISSION_DECISION_RECORD_FAILED', ...common, reason },
      };
    }
  }
}
