import type { TaskMonitorStateStore } from './machine';
import type { TaskMonitorOutcomeJudgmentEffectHandler } from './outcome-judgment-effect-handlers';
import { listEfforts, listModels, supportsFastMode } from '@hey-hey/ui-common/capability-catalog';
import type { ApiRuntime } from '@hey-hey/ui-common/clients';

import type {
  EffectExecutionIdentity,
  EffectHandler,
  EffectSettlement,
} from '../../../state-machine';
import {
  MessageStatus,
  MessageType,
  AgentSessionStatus,
  SystemMessageDataTypeEnum,
  TaskMonitorTaskActivityState,
  TaskMonitorTaskActivitySystemMessageDataAgentIdentityEnum,
  WorkStatus,
  type CreateSystemMessage,
  type TaskMonitorTaskActivitySystemMessageData,
} from '../../../shared/api/generated/api';
import type { ServerLogger } from '../../../server/logger';
import type { TaskMonitorCoordinatorConversation } from '../../../server/task-monitor-coordinator-conversation';
import type { TaskMonitorCoordinatorRunner } from '../../../server/monitors/runner';
import type { RunStore } from '../../../run-store';
import type { PlatformAuthContext } from '../../../server/platform-auth-context';
import type { LocalAgentService } from '../../../server/local-agent-service';
import type {
  TaskMonitorStartMonitor,
  TaskMonitorStartRuntime,
} from '../../../server/task-monitor-start';
import type { TaskMonitorLaunchFailureRuntime } from '../../../server/task-monitor-launch-failure-runtime';
import type {
  TaskMonitorExecutionNode,
  TaskMonitorLaunchDeclaration,
  TaskMonitorPlanGuidanceProjection,
  TaskMonitorWorktree,
} from './context';
import type {
  CoordinateTaskMonitorWorkEffect,
  LoadTaskMonitorEffect,
  PersistTaskMonitorLaunchEffect,
  ProjectTaskMonitorStartedEffect,
  ReconcileTaskMonitorLaunchEffect,
  ValidateTaskMonitorLaunchEffect,
  TaskMonitorMachineEffect,
} from './effects';
import type { TaskMonitorConversationInputEffectHandler } from './conversation-input-effect-handlers';
import type { TaskMonitorMachineEffectOutcome } from './events';
import type {
  TaskMonitorAgentSessionEffectHandler,
  TaskMonitorConversationEffectHandler,
  TaskMonitorRunEffectHandler,
} from './launch-effect-handlers';
import type {
  TaskMonitorControlEffectHandler,
  TaskMonitorControlStatusProjectionEffectHandler,
} from './control-effect-handlers';
import type {
  TaskMonitorDecisionApplicationEffectHandler,
  TaskMonitorInterventionProjectionEffectHandler,
} from './intervention-effect-handlers';
import type { TaskMonitorLaunchRecoveryEffectHandler } from './launch-recovery-effect-handlers';
import { loadTaskMonitorCanonicalEvidence } from '../task-monitor-evidence';
import {
  validateTaskMonitorDecision,
  type TaskMonitorCoordinationSnapshot,
} from '../task-monitor-coordination';
import type { TaskMonitorDecisionStore } from '../task-monitor-decision-store';
import type {
  TaskMonitorReviewDeliveryEffectHandler,
  TaskMonitorSettledRunEvaluationEffectHandler,
} from './supervision-effect-handlers';

const reasonFrom = (error: unknown): string =>
  error instanceof Error ? error.message : 'Task Monitor operation failed.';

const responseStatus = (error: unknown): number | null => {
  if (typeof error !== 'object' || error === null || !('response' in error)) return null;
  const response = error.response;
  if (typeof response !== 'object' || response === null || !('status' in response)) return null;
  return typeof response.status === 'number' ? response.status : null;
};

const normalizeFastMode = (
  provider: TaskMonitorExecutionNode['provider'],
  model: string,
  fastMode: boolean | undefined,
): boolean | undefined =>
  fastMode === undefined && supportsFastMode(provider, model) ? false : fastMode;

const toExecutionPlan = (monitor: TaskMonitorStartMonitor): readonly TaskMonitorExecutionNode[] =>
  monitor.definition.executionPlan.map((entry) => {
    const fastMode = normalizeFastMode(
      entry.launchConfiguration.provider,
      entry.launchConfiguration.model,
      entry.launchConfiguration.fastMode,
    );
    return {
      taskId: entry.taskId,
      dependsOnTaskIds: entry.dependsOnTaskIds,
      method: entry.launchConfiguration.method,
      provider: entry.launchConfiguration.provider,
      model: entry.launchConfiguration.model,
      reasoningEffort: entry.launchConfiguration.reasoningEffort,
      ...(fastMode === undefined ? {} : { fastMode }),
      agentSessionId: entry.agentSessionId ?? null,
    };
  });

const worktreeMatches = (
  requested: TaskMonitorWorktree | undefined,
  persisted: TaskMonitorWorktree | null,
): boolean => requested?.enabled === persisted?.enabled && requested?.branch === persisted?.branch;

const isSettledMutationFailure = (reason: string): boolean =>
  reason.includes('remained pending') ||
  reason.includes('did not match the authorized target scope') ||
  reason.includes('returned an empty response') ||
  reason.includes('did not match the generated task boundary') ||
  reason.includes('failed (') ||
  reason.includes('Refusing to persist an invalid');

const isLaunchPersistenceRejection = (reason: string): boolean =>
  reason.startsWith('Task Monitor launch persistence ');

const validationFailure = (
  effect: ValidateTaskMonitorLaunchEffect,
  reason: string,
  logger: ServerLogger,
): EffectSettlement<TaskMonitorMachineEffectOutcome> => {
  logger.error('task_monitor.machine.launch_validation.failed', {
    monitorId: effect.taskMonitorId,
    taskId: effect.taskId,
    cursor: effect.cursor,
    reason,
  });
  return {
    status: 'failed',
    outcome: {
      type: 'LAUNCH_VALIDATION_FAILED',
      taskMonitorId: effect.taskMonitorId,
      taskId: effect.taskId,
      cursor: effect.cursor,
      reason,
    },
  };
};

const validationUncertain = (
  effect: ValidateTaskMonitorLaunchEffect,
  operation: 'TASK_ACTIVATION' | 'MONITOR_PROJECTION',
  reason: string,
  logger: ServerLogger,
): EffectSettlement<TaskMonitorMachineEffectOutcome> => {
  logger.error('task_monitor.machine.launch_validation.uncertain', {
    monitorId: effect.taskMonitorId,
    taskId: effect.taskId,
    cursor: effect.cursor,
    operation,
    reason,
  });
  return {
    status: 'uncertain',
    outcome: {
      type: 'LAUNCH_VALIDATION_UNCERTAIN',
      taskMonitorId: effect.taskMonitorId,
      taskId: effect.taskId,
      cursor: effect.cursor,
      operation,
      reason,
    },
  };
};

/** Restores and projects the generated, boundary-validated Task Monitor definition. */
export class TaskMonitorLoadEffectHandler implements EffectHandler<
  LoadTaskMonitorEffect,
  TaskMonitorMachineEffectOutcome
> {
  public readonly recovery = { strategy: 'retry' as const };

  public constructor(
    private readonly runtime: TaskMonitorStartRuntime,
    private readonly logger: ServerLogger,
  ) {}

  public async execute(
    effect: LoadTaskMonitorEffect,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    this.logger.debug('task_monitor.machine.load.started', {
      monitorId: effect.taskMonitorId,
      organizationId: effect.organizationId,
      projectId: effect.projectId,
    });
    try {
      const loaded = await this.runtime.readMonitor({
        monitorId: effect.taskMonitorId,
        organizationId: effect.organizationId,
        projectId: effect.projectId,
      });
      if (
        loaded.id !== effect.taskMonitorId ||
        loaded.organizationId !== effect.organizationId ||
        loaded.projectId !== effect.projectId
      ) {
        throw new Error('Loaded Task Monitor identity or ownership did not match the machine.');
      }
      if (loaded.status === WorkStatus.OnHold) {
        throw new Error('Task Monitor is paused and cannot admit new work until it is resumed.');
      }
      if (loaded.status === WorkStatus.Completed) {
        throw new Error('Task Monitor is already completed and cannot admit new work.');
      }
      if (loaded.status !== WorkStatus.Backlog && loaded.status !== WorkStatus.Active) {
        throw new Error(`Task Monitor cannot admit new work from status ${loaded.status}.`);
      }
      if (loaded.definition.cursor > loaded.definition.executionPlan.length) {
        throw new Error('Task Monitor cursor exceeds its executionPlan length.');
      }
      const executionPlan = toExecutionPlan(loaded);
      const requestedEntry = executionPlan[loaded.definition.cursor];
      const requestedFastMode = normalizeFastMode(
        effect.requestedLaunchConfig.provider,
        effect.requestedLaunchConfig.model,
        effect.requestedLaunchConfig.fastMode,
      );
      const persistedEntry = loaded.definition.executionPlan[loaded.definition.cursor];
      if (
        persistedEntry !== undefined &&
        persistedEntry.launchConfiguration.fastMode === undefined &&
        requestedEntry?.fastMode === false &&
        requestedFastMode === false
      ) {
        this.logger.warn('task_monitor.machine.fast_mode.missing_defaulted', {
          monitorId: effect.taskMonitorId,
          taskId: persistedEntry.taskId,
          cursor: loaded.definition.cursor,
          provider: persistedEntry.launchConfiguration.provider,
          model: persistedEntry.launchConfiguration.model,
          defaultFastMode: false,
        });
      }
      if (
        requestedEntry &&
        (requestedEntry.taskId !== effect.requestedLaunchConfig.taskId ||
          requestedEntry.method !== effect.requestedLaunchConfig.method ||
          requestedEntry.provider !== effect.requestedLaunchConfig.provider ||
          requestedEntry.model !== effect.requestedLaunchConfig.model ||
          requestedEntry.reasoningEffort !== effect.requestedLaunchConfig.reasoningEffort ||
          requestedEntry.fastMode !== requestedFastMode ||
          !worktreeMatches(
            effect.requestedLaunchConfig.worktree,
            loaded.definition.launchPolicy.worktree ?? null,
          ))
      ) {
        throw new Error(
          'Task Monitor START launch configuration does not match the persisted cursor work.',
        );
      }
      this.logger.info('task_monitor.machine.load.completed', {
        monitorId: effect.taskMonitorId,
        cursor: loaded.definition.cursor,
        executionPlanLength: executionPlan.length,
      });
      return {
        status: 'succeeded',
        outcome: {
          type: 'MONITOR_LOADED',
          taskMonitorId: loaded.id,
          organizationId: loaded.organizationId,
          projectId: loaded.projectId,
          executionPlan,
          cursor: loaded.definition.cursor,
          worktree: loaded.definition.launchPolicy.worktree ?? null,
          terminalPolicy: loaded.definition.launchPolicy.terminalSupervision,
        },
      };
    } catch (error) {
      const reason = reasonFrom(error);
      this.logger.error('task_monitor.machine.load.failed', {
        monitorId: effect.taskMonitorId,
        reason,
      });
      return {
        status: 'failed',
        outcome: { type: 'MONITOR_LOAD_FAILED', taskMonitorId: effect.taskMonitorId, reason },
      };
    }
  }
}

/** Selects one canonical, dependency-ready Task without mutating product state. */
export class TaskMonitorCoordinationEffectHandler implements EffectHandler<
  CoordinateTaskMonitorWorkEffect,
  TaskMonitorMachineEffectOutcome
> {
  public readonly recovery = {
    strategy: 'reconcile' as const,
    reconcile: async (
      effect: CoordinateTaskMonitorWorkEffect,
      execution: EffectExecutionIdentity,
    ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> => {
      const prior = await this.resumeDependencies?.coordinatorRunner.reconcileRejectedAttempt(
        effect.taskMonitorId,
        effect.projectId,
        execution.effectId,
      );
      const sessionId = effect.coordination?.activeRunAgentSessionId;
      const runId =
        effect.coordination?.activeRunId ??
        (sessionId ? this.resumeDependencies?.runStore.lookupByAgentSessionId(sessionId) : null);
      if (prior && sessionId && runId)
        return {
          status: 'succeeded',
          outcome: {
            type: 'COORDINATOR_DECISION_INVALID',
            taskMonitorId: effect.taskMonitorId,
            runId,
            agentSessionId: sessionId,
            attemptId: execution.effectId,
            evaluation: effect,
            failure: { ...prior.error, issues: [...(prior.error.issues ?? [])] },
          },
        };
      if (effect.cause !== 'RESUME' && effect.cause !== 'JUDGMENT_RESOLVED') {
        return this.execute(effect, execution);
      }
      const coordination = effect.coordination;
      const activeRunId =
        coordination?.activeRunId ??
        (coordination?.activeRunAgentSessionId
          ? this.resumeDependencies?.runStore.lookupByAgentSessionId(
              coordination.activeRunAgentSessionId,
            )
          : null);
      if (!activeRunId || !coordination?.activeRunAgentSessionId) {
        return Promise.resolve(
          this.failed(
            effect,
            `${effect.cause} coordination was interrupted without enough durable Run evidence to reconcile.`,
          ),
        );
      }
      return Promise.resolve({
        status: 'uncertain' as const,
        outcome: {
          type: 'OUTCOME_JUDGMENT_REQUIRED' as const,
          taskMonitorId: effect.taskMonitorId,
          runId: activeRunId,
          agentSessionId: coordination.activeRunAgentSessionId,
          reason: `${effect.cause} coordination was interrupted after its committed effect began delivery; human judgment is required before retrying external work.`,
        },
      });
    },
  };

  private readonly resumeDependencies: {
    readonly coordinatorRunner: TaskMonitorCoordinatorRunner;
    readonly supervision: TaskMonitorSettledRunEvaluationEffectHandler;
    readonly agentService: LocalAgentService;
    readonly authContext: PlatformAuthContext;
    readonly runStore: RunStore;
    readonly fetchImpl: typeof fetch;
    readonly apiBaseUrl: string;
    readonly decisionStore: TaskMonitorDecisionStore;
  } | null;

  public constructor(
    private readonly runtime: TaskMonitorStartRuntime,
    private readonly logger: ServerLogger,
    resumeDependencies?: {
      readonly coordinatorRunner: TaskMonitorCoordinatorRunner;
      readonly supervision: TaskMonitorSettledRunEvaluationEffectHandler;
      readonly agentService: LocalAgentService;
      readonly authContext: PlatformAuthContext;
      readonly runStore: RunStore;
      readonly fetchImpl: typeof fetch;
      readonly apiBaseUrl: string;
      readonly decisionStore: TaskMonitorDecisionStore;
    },
  ) {
    this.resumeDependencies = resumeDependencies ?? null;
  }

  public async execute(
    effect: CoordinateTaskMonitorWorkEffect,
    execution?: EffectExecutionIdentity,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    this.logger.debug('task_monitor.machine.coordination.started', {
      monitorId: effect.taskMonitorId,
      cursor: effect.cursor,
    });
    try {
      if (
        (effect.cause === 'RESUME' || effect.cause === 'JUDGMENT_RESOLVED') &&
        this.resumeDependencies !== null
      ) {
        if (!execution) return this.failed(effect, `${effect.cause} has no effect identity.`);
        return await this.executeAgentCoordination(effect, this.resumeDependencies, execution);
      }
      if (effect.cursor > effect.executionPlan.length) {
        throw new Error('Task Monitor cursor exceeds its executionPlan length.');
      }
      for (let cursor = effect.cursor; cursor < effect.executionPlan.length; cursor += 1) {
        const entry = effect.executionPlan[cursor];
        if (!entry) break;
        const task = await this.runtime.readTask({
          organizationId: effect.organizationId,
          projectId: effect.projectId,
          taskId: entry.taskId,
        });
        this.logger.debug('task_monitor.machine.coordination.task_read', {
          monitorId: effect.taskMonitorId,
          taskId: entry.taskId,
          cursor,
          status: task.status ?? null,
        });
        if (task.status === WorkStatus.Completed) continue;
        if (entry.agentSessionId !== null) {
          throw new Error('Task Monitor selected work already has a recorded Agent Session.');
        }
        const dependencies = await Promise.all(
          entry.dependsOnTaskIds.map((taskId) =>
            this.runtime.readTask({
              organizationId: effect.organizationId,
              projectId: effect.projectId,
              taskId,
            }),
          ),
        );
        const incomplete = dependencies.find(
          (dependency) => dependency.status !== WorkStatus.Completed,
        );
        if (incomplete) {
          throw new Error('Task Monitor current execution node has an incomplete dependency.');
        }
        this.logger.info('task_monitor.machine.coordination.selected', {
          monitorId: effect.taskMonitorId,
          taskId: entry.taskId,
          cursor,
        });
        return {
          status: 'succeeded',
          outcome: {
            type: 'WORK_SELECTED',
            taskMonitorId: effect.taskMonitorId,
            taskId: entry.taskId,
            cursor,
          },
        };
      }
      return {
        status: 'succeeded',
        outcome: {
          type: 'WORK_EXHAUSTED',
          taskMonitorId: effect.taskMonitorId,
          cursor: effect.executionPlan.length,
        },
      };
    } catch (error) {
      const reason = reasonFrom(error);
      this.logger.error('task_monitor.machine.coordination.failed', {
        monitorId: effect.taskMonitorId,
        reason,
      });
      return {
        status: 'failed',
        outcome: { type: 'COORDINATION_FAILED', taskMonitorId: effect.taskMonitorId, reason },
      };
    }
  }

  private async executeAgentCoordination(
    effect: CoordinateTaskMonitorWorkEffect,
    dependencies: NonNullable<TaskMonitorCoordinationEffectHandler['resumeDependencies']>,
    execution: EffectExecutionIdentity,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    const cause = effect.cause;
    if (cause !== 'RESUME' && cause !== 'JUDGMENT_RESOLVED') {
      return this.failed(effect, 'Agent coordination has no supported lifecycle cause.');
    }
    if (!effect.correlationId) {
      return this.failed(effect, `${cause} coordination is missing its correlation.`);
    }
    const activeRunId =
      effect.coordination?.activeRunId ??
      (effect.coordination?.activeRunAgentSessionId
        ? dependencies.runStore.lookupByAgentSessionId(effect.coordination.activeRunAgentSessionId)
        : null);
    const coordination = effect.coordination
      ? { ...effect.coordination, activeRunId, committedEffectId: execution.effectId }
      : undefined;
    const settledTurn = effect.settledTurn
      ? {
          ...effect.settledTurn,
          completedAssistantMessage:
            effect.settledTurn.completedAssistantMessage ??
            (coordination?.settledRun?.completedAssistantMessageId && coordination.conversationId
              ? await dependencies.agentService.readAssistantMessage({
                  organizationId: effect.organizationId,
                  projectId: effect.projectId,
                  conversationId: coordination.conversationId,
                  messageId: coordination.settledRun.completedAssistantMessageId,
                })
              : null),
        }
      : undefined;
    if (
      coordination?.settledRun?.completedAssistantMessageId &&
      settledTurn?.completedAssistantMessage === null
    ) {
      return this.failed(
        effect,
        `Completed assistant Message could not be resolved for ${cause} coordination.`,
      );
    }
    const coordinator = await dependencies.coordinatorRunner.runTaskMonitor(
      {
        monitorId: effect.taskMonitorId,
        cause,
        correlationId: effect.correlationId,
        coordinatorAttemptId: execution.effectId,
        ...(effect.correction ? { correction: effect.correction } : {}),
        ...(settledTurn ? { settledTurn } : {}),
        ...(effect.judgment ? { judgment: effect.judgment } : {}),
      },
      {
        organizationId: effect.organizationId,
        projectId: effect.projectId,
      },
      coordination,
    );
    if (!coordinator) {
      return this.failed(effect, `Task Monitor ${cause} coordinator could not be started.`);
    }
    const result = await dependencies.decisionStore.wait(coordinator.runId);
    if (result.status === 'INVALID') {
      if (!activeRunId || !coordination?.activeRunAgentSessionId)
        return this.failed(effect, result.reason);
      return {
        status: 'succeeded',
        outcome: {
          type: 'COORDINATOR_DECISION_INVALID',
          taskMonitorId: effect.taskMonitorId,
          runId: activeRunId,
          agentSessionId: coordination.activeRunAgentSessionId,
          attemptId: execution.effectId,
          evaluation: effect,
          failure: result.failure ?? {
            code: 'INVALID_DECISION',
            message: result.reason,
            issues: [],
          },
        },
      };
    }
    if (result.status !== 'DECISION') {
      const reason = `Task Monitor ${cause} coordinator settled without a decision (${result.terminalOutcome}).`;
      return this.failed(effect, reason);
    }

    const auth = await dependencies.authContext.resolve(effect.projectId);
    if (
      auth === null ||
      auth.organizationId !== effect.organizationId ||
      auth.projectId !== effect.projectId
    ) {
      return this.failed(effect, `Task Monitor ${cause} owner scope is unavailable or stale.`);
    }
    const evidence = await loadTaskMonitorCanonicalEvidence(
      {
        apiBaseUrl: dependencies.apiBaseUrl,
        fetchImpl: dependencies.fetchImpl,
        logger: this.logger,
      },
      {
        organizationId: effect.organizationId,
        projectId: effect.projectId,
        monitorId: effect.taskMonitorId,
        accessToken: auth.accessToken,
        ...(settledTurn ? { settledTurn } : {}),
        ...(coordination ? { coordination } : {}),
      },
    );
    const snapshot: TaskMonitorCoordinationSnapshot = {
      cause,
      correlationId: effect.correlationId,
      evidence,
      localState: coordination ?? null,
    };
    const validation = validateTaskMonitorDecision(snapshot, result.decision);
    if (!validation.ok) {
      this.logger.warn('task_monitor.machine.coordination.decision_rejected', {
        monitorId: effect.taskMonitorId,
        correlationId: effect.correlationId,
        reason: validation.reason,
        action: result.decision.action,
      });
      return this.failed(effect, validation.reason);
    }
    const selectedSession = evidence.selectedSession;
    const agentSessionId = selectedSession?.id ?? coordination?.activeRunAgentSessionId ?? null;
    if (!agentSessionId) {
      return this.failed(
        effect,
        'Task Monitor Resume decision has no active Agent Session identity.',
      );
    }
    const runId =
      coordination?.activeRunId ?? dependencies.runStore.lookupByAgentSessionId(agentSessionId);
    if (!runId) {
      return this.failed(effect, 'Task Monitor Resume decision has no active Run identity.');
    }
    const conversationId = selectedSession?.conversationId ?? coordination?.conversationId ?? null;
    return dependencies.supervision.applyDecisionForCoordination(
      {
        type: 'TASK_MONITOR_COORDINATION_DECISION',
        taskMonitorId: effect.taskMonitorId,
        organizationId: effect.organizationId,
        projectId: effect.projectId,
        ...(effect.authorityCommandId ? { authorityCommandId: effect.authorityCommandId } : {}),
        runId,
        agentSessionId,
        promptType: evidence.releasedTurn?.promptType ?? null,
        terminalOutcome: evidence.releasedTurn?.terminalOutcome ?? null,
        reviewRequestId: coordination?.reviewRequestId ?? null,
      },
      validation.value,
      coordinator.runId,
      execution,
      auth,
      evidence.selectedTask.id,
      conversationId,
      evidence.monitor.reviewMode,
      selectedSession !== null,
    );
  }

  private failed(
    effect: CoordinateTaskMonitorWorkEffect,
    reason: string,
  ): EffectSettlement<TaskMonitorMachineEffectOutcome> {
    return {
      status: 'failed',
      outcome: {
        type: 'COORDINATION_FAILED',
        taskMonitorId: effect.taskMonitorId,
        reason,
      },
    };
  }
}

/** Validates launch inputs and commits Task then Task Monitor activation before readiness. */
export class TaskMonitorLaunchValidationEffectHandler implements EffectHandler<
  ValidateTaskMonitorLaunchEffect,
  TaskMonitorMachineEffectOutcome
> {
  public readonly recovery = {
    strategy: 'reconcile' as const,
    reconcile: (effect: ValidateTaskMonitorLaunchEffect) => this.execute(effect),
  };

  public constructor(
    private readonly runtime: TaskMonitorStartRuntime,
    private readonly logger: ServerLogger,
  ) {}

  public async execute(
    effect: ValidateTaskMonitorLaunchEffect,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    this.logger.debug('task_monitor.machine.launch_validation.started', {
      monitorId: effect.taskMonitorId,
      taskId: effect.taskId,
      cursor: effect.cursor,
    });
    const entry = effect.executionPlan[effect.cursor];
    if (entry?.taskId !== effect.taskId) {
      return validationFailure(
        effect,
        'Selected Task does not match the execution cursor.',
        this.logger,
      );
    }
    // A model this machine's catalog does not list is the provider's to judge, so
    // a stored launch is only held to the catalog for models the catalog knows.
    const catalogModel = listModels(entry.provider).some((model) => model.id === entry.model);
    if (
      catalogModel &&
      (!listEfforts(entry.provider, entry.model).includes(entry.reasoningEffort) ||
        (entry.fastMode === true && !supportsFastMode(entry.provider, entry.model)))
    ) {
      return validationFailure(
        effect,
        'Task Monitor selected launch configuration is not valid in the runtime catalog.',
        this.logger,
      );
    }

    let task: Awaited<ReturnType<TaskMonitorStartRuntime['readTask']>>;
    let planGuidance: TaskMonitorPlanGuidanceProjection | null;
    try {
      task = await this.runtime.readTask({
        organizationId: effect.organizationId,
        projectId: effect.projectId,
        taskId: effect.taskId,
      });
      if (task.status === WorkStatus.Completed) {
        return validationFailure(
          effect,
          'Selected Task completed after coordination.',
          this.logger,
        );
      }
      const dependencies = await Promise.all(
        entry.dependsOnTaskIds.map((taskId) =>
          this.runtime.readTask({
            organizationId: effect.organizationId,
            projectId: effect.projectId,
            taskId,
          }),
        ),
      );
      if (dependencies.some((dependency) => dependency.status !== WorkStatus.Completed)) {
        return validationFailure(
          effect,
          'Selected Task has an incomplete canonical dependency.',
          this.logger,
        );
      }
      planGuidance = await this.runtime.resolvePlanContext({
        organizationId: effect.organizationId,
        projectId: effect.projectId,
        taskId: effect.taskId,
      });
    } catch (error) {
      return validationFailure(effect, reasonFrom(error), this.logger);
    }

    if (task.status !== WorkStatus.Active) {
      try {
        task = await this.runtime.persistTaskActive({
          organizationId: effect.organizationId,
          projectId: effect.projectId,
          task,
        });
      } catch (error) {
        const reason = reasonFrom(error);
        return isSettledMutationFailure(reason)
          ? validationFailure(effect, reason, this.logger)
          : validationUncertain(effect, 'TASK_ACTIVATION', reason, this.logger);
      }
    }
    if (task.status !== WorkStatus.Active) {
      return validationFailure(
        effect,
        'Selected Task activation did not settle as ACTIVE.',
        this.logger,
      );
    }

    try {
      let monitor = await this.runtime.readMonitor({
        monitorId: effect.taskMonitorId,
        organizationId: effect.organizationId,
        projectId: effect.projectId,
      });
      if (monitor.definition.executionPlan[effect.cursor]?.taskId !== effect.taskId) {
        return validationFailure(
          effect,
          'Canonical Task Monitor cursor target changed.',
          this.logger,
        );
      }
      if (monitor.definition.cursor !== effect.cursor) {
        monitor = await this.runtime.persistCursor({ monitor, cursor: effect.cursor });
      }
      if (monitor.status !== WorkStatus.Active) {
        monitor = await this.runtime.persistMonitorActive({ monitor });
      }
      if (monitor.status !== WorkStatus.Active) {
        return validationFailure(
          effect,
          'Task Monitor projection did not settle as ACTIVE.',
          this.logger,
        );
      }
    } catch (error) {
      const reason = reasonFrom(error);
      return isSettledMutationFailure(reason)
        ? validationFailure(effect, reason, this.logger)
        : validationUncertain(effect, 'MONITOR_PROJECTION', reason, this.logger);
    }

    const launch: TaskMonitorLaunchDeclaration = {
      authorityCommandId: effect.authorityCommandId,
      taskMonitorId: effect.taskMonitorId,
      organizationId: effect.organizationId,
      projectId: effect.projectId,
      taskId: effect.taskId,
      taskTitle: task.name,
      taskType: task.type,
      taskDescription: task.description,
      taskAcceptanceCriteria: task.acceptanceCriteria,
      cursor: effect.cursor,
      method: entry.method,
      provider: entry.provider,
      model: entry.model,
      reasoningEffort: entry.reasoningEffort,
      ...(entry.fastMode === undefined ? {} : { fastMode: entry.fastMode }),
      serviceIds: task.serviceIds,
      ...(effect.worktree === null ? {} : { worktree: effect.worktree }),
      userGuidance: effect.userGuidance,
      planGuidance,
      executionOrder: effect.executionPlan.map((node) => node.taskId),
      dependsOnTaskIds: entry.dependsOnTaskIds,
      terminalPolicy: effect.terminalPolicy,
    };
    this.logger.info('task_monitor.machine.launch_validation.completed', {
      monitorId: effect.taskMonitorId,
      taskId: effect.taskId,
      cursor: effect.cursor,
      serviceCount: launch.serviceIds.length,
    });
    return {
      status: 'succeeded',
      outcome: {
        type: 'LAUNCH_VALIDATED',
        taskMonitorId: effect.taskMonitorId,
        taskId: effect.taskId,
        cursor: effect.cursor,
        launch,
      },
    };
  }
}

/** Reads the canonical owner for the one mutation whose result was uncertain. */
export class TaskMonitorLaunchReconciliationEffectHandler implements EffectHandler<
  ReconcileTaskMonitorLaunchEffect,
  TaskMonitorMachineEffectOutcome
> {
  public readonly recovery = { strategy: 'retry' as const };

  public constructor(
    private readonly runtime: TaskMonitorStartRuntime,
    private readonly apiRuntime: ApiRuntime,
    private readonly runStore: RunStore,
    private readonly logger: ServerLogger,
    private readonly taskMonitorLaunchFailureRuntime?: TaskMonitorLaunchFailureRuntime,
  ) {}

  public async execute(
    effect: ReconcileTaskMonitorLaunchEffect,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    this.logger.debug('task_monitor.machine.launch_reconciliation.started', {
      monitorId: effect.taskMonitorId,
      taskId: effect.taskId,
      cursor: effect.cursor,
      operation: effect.operation,
    });
    try {
      if (effect.retry) {
        return await this.admitRetry(effect);
      }
      const result = await this.readOperation(effect);
      if (!result.found) {
        return {
          status: 'succeeded',
          outcome: {
            type: 'OPERATION_ABSENT',
            taskMonitorId: effect.taskMonitorId,
            taskId: effect.taskId,
            cursor: effect.cursor,
            operation: effect.operation,
          },
        };
      }
      return {
        status: 'succeeded',
        outcome: {
          type: 'OPERATION_FOUND',
          taskMonitorId: effect.taskMonitorId,
          taskId: effect.taskId,
          cursor: effect.cursor,
          operation: effect.operation,
          ...(result.agentSessionId ? { agentSessionId: result.agentSessionId } : {}),
          ...(result.conversationId ? { conversationId: result.conversationId } : {}),
        },
      };
    } catch (error) {
      const reason = reasonFrom(error);
      this.logger.error('task_monitor.machine.launch_reconciliation.failed', {
        ...effect,
        reason,
      });
      return {
        status: 'failed',
        outcome: {
          type: 'RECONCILIATION_FAILED',
          taskMonitorId: effect.taskMonitorId,
          taskId: effect.taskId,
          cursor: effect.cursor,
          operation: effect.operation,
          reason,
        },
      };
    }
  }

  private async admitRetry(
    effect: ReconcileTaskMonitorLaunchEffect,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    const retry = effect.retry;
    if (!retry) throw new Error('Task Monitor retry admission requires retry evidence.');
    const reject = (reason: string): EffectSettlement<TaskMonitorMachineEffectOutcome> => ({
      status: 'failed',
      outcome: {
        type: 'LAUNCH_RETRY_REJECTED',
        taskMonitorId: effect.taskMonitorId,
        taskId: effect.taskId,
        cursor: effect.cursor,
        reason,
      },
    });
    let monitor = await this.runtime.readMonitor({
      monitorId: effect.taskMonitorId,
      organizationId: effect.organizationId,
      projectId: effect.projectId,
    });
    const shouldReactivate = monitor.status === WorkStatus.OnHold && retry.failure !== undefined;
    const entry = monitor.definition.executionPlan[effect.cursor];
    if (monitor.status !== WorkStatus.Active && !shouldReactivate) {
      return reject('Task Monitor is not active for selected-session retry.');
    }
    if (monitor.definition.cursor !== retry.cursor || entry?.taskId !== retry.taskId) {
      return reject('Canonical Task Monitor cursor no longer matches the retryable launch.');
    }
    if (entry.agentSessionId !== retry.agentSessionId) {
      return reject('Canonical Task Monitor Agent Session no longer matches the retryable launch.');
    }
    const response = await this.apiRuntime.clients.agentSessions.getAgentSession({
      organizationId: effect.organizationId,
      projectId: effect.projectId,
      agentSessionId: retry.agentSessionId,
    });
    const session = response.data.data;
    if (!session || session.id !== retry.agentSessionId) {
      return reject('Retryable Agent Session is no longer available.');
    }
    if (session.conversationId !== retry.conversationId) {
      return reject('Retryable Agent Session Conversation no longer matches.');
    }
    const hostRunId = this.runStore.lookupByAgentSessionId(retry.agentSessionId);
    if (hostRunId !== null) {
      let hostRun: Awaited<ReturnType<RunStore['getRun']>> = null;
      try {
        hostRun = await this.runStore.getRun(hostRunId);
      } catch (error) {
        this.logger.warn('task_monitor.machine.launch_retry.host_run_lookup_failed', {
          monitorId: effect.taskMonitorId,
          taskId: retry.taskId,
          agentSessionId: retry.agentSessionId,
          hostRunId,
          error: reasonFrom(error),
        });
        return reject('Retryable Agent Session already owns a running host Run.');
      }
      if (hostRun === null || hostRun.status !== 'idle') {
        return reject('Retryable Agent Session already owns a running host Run.');
      }
      this.logger.info('task_monitor.machine.launch_retry.idle_host_run_reused', {
        monitorId: effect.taskMonitorId,
        taskId: retry.taskId,
        agentSessionId: retry.agentSessionId,
        hostRunId,
      });
    }
    if (
      session.status === AgentSessionStatus.InProgress ||
      session.status === AgentSessionStatus.Completed ||
      session.status === AgentSessionStatus.Errored
    ) {
      return reject(`Agent Session status ${session.status} cannot be retried.`);
    }
    if (shouldReactivate) {
      try {
        monitor = await this.runtime.persistMonitorActive({ monitor });
      } catch (error) {
        return reject(reasonFrom(error));
      }
      if (monitor.status !== WorkStatus.Active) {
        return reject(
          'Task Monitor activation did not settle as ACTIVE for selected-session retry.',
        );
      }
    }
    this.logger.info('task_monitor.machine.launch_retry.admitted', {
      monitorId: effect.taskMonitorId,
      taskId: retry.taskId,
      cursor: retry.cursor,
      agentSessionId: retry.agentSessionId,
      conversationId: retry.conversationId,
    });
    if (retry.failure) {
      this.taskMonitorLaunchFailureRuntime?.clearLaunchFailures({
        taskMonitorId: effect.taskMonitorId,
        agentSessionId: retry.agentSessionId,
      });
    }
    return {
      status: 'succeeded',
      outcome: {
        type: 'LAUNCH_RETRY_ADMITTED',
        taskMonitorId: effect.taskMonitorId,
        taskId: retry.taskId,
        cursor: retry.cursor,
        agentSessionId: retry.agentSessionId,
        conversationId: retry.conversationId,
      },
    };
  }

  private async readOperation(effect: ReconcileTaskMonitorLaunchEffect): Promise<{
    found: boolean;
    agentSessionId?: string;
    conversationId?: string;
  }> {
    switch (effect.operation) {
      case 'TASK_ACTIVATION':
        return {
          found:
            (
              await this.runtime.readTask({
                organizationId: effect.organizationId,
                projectId: effect.projectId,
                taskId: effect.taskId,
              })
            ).status === WorkStatus.Active,
        };
      case 'MONITOR_PROJECTION':
        return { found: await this.monitorProjectionExists(effect) };
      case 'RUN_START': {
        if (!effect.agentSessionId)
          throw new Error('Run reconciliation requires Agent Session ownership.');
        return {
          found: this.runStore.lookupByAgentSessionId(effect.agentSessionId) !== null,
          agentSessionId: effect.agentSessionId,
          ...(effect.conversationId ? { conversationId: effect.conversationId } : {}),
        };
      }
      case 'AGENT_SESSION_CREATION':
      case 'CONVERSATION_CREATION': {
        if (!effect.agentSessionId) {
          throw new Error('Platform launch reconciliation requires Agent Session ownership.');
        }
        try {
          const response = await this.apiRuntime.clients.agentSessions.getAgentSession({
            organizationId: effect.organizationId,
            projectId: effect.projectId,
            agentSessionId: effect.agentSessionId,
          });
          const session = response.data.data;
          if (effect.operation === 'AGENT_SESSION_CREATION') {
            return {
              found: session?.id === effect.agentSessionId,
              agentSessionId: effect.agentSessionId,
            };
          }
          const conversationId = session?.conversationId ?? null;
          return {
            found: conversationId !== null,
            agentSessionId: effect.agentSessionId,
            ...(conversationId ? { conversationId } : {}),
          };
        } catch (error) {
          if (responseStatus(error) === 404) {
            return { found: false, agentSessionId: effect.agentSessionId };
          }
          throw error;
        }
      }
    }
  }

  private async monitorProjectionExists(
    effect: ReconcileTaskMonitorLaunchEffect,
  ): Promise<boolean> {
    const monitor = await this.runtime.readMonitor({
      monitorId: effect.taskMonitorId,
      organizationId: effect.organizationId,
      projectId: effect.projectId,
    });
    return (
      monitor.status === WorkStatus.Active &&
      monitor.definition.cursor === effect.cursor &&
      monitor.definition.executionPlan[effect.cursor]?.taskId === effect.taskId
    );
  }
}

const buildTaskStartedMessage = (
  effect: ProjectTaskMonitorStartedEffect,
  conversationId: string,
) => {
  const data = {
    type: SystemMessageDataTypeEnum.TaskMonitorTaskActivity,
    response: `Started ${effect.taskTitle}.`,
    agentIdentity: TaskMonitorTaskActivitySystemMessageDataAgentIdentityEnum.TaskMonitorCoordinator,
    activity: TaskMonitorTaskActivityState.Started,
    taskId: effect.taskId,
    taskTitle: effect.taskTitle,
  } satisfies TaskMonitorTaskActivitySystemMessageData;
  return {
    projectId: effect.projectId,
    conversationId,
    type: MessageType.System,
    status: MessageStatus.Completed,
    createdAt: new Date().toISOString(),
    data,
  } satisfies CreateSystemMessage;
};

/** Persists the canonical launched Agent Session on the current execution node. */
export class TaskMonitorLaunchPersistenceEffectHandler implements EffectHandler<
  PersistTaskMonitorLaunchEffect,
  TaskMonitorMachineEffectOutcome
> {
  public readonly recovery = {
    strategy: 'reconcile' as const,
    reconcile: (
      effect: PersistTaskMonitorLaunchEffect,
    ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> => this.execute(effect),
  };

  public constructor(
    private readonly runtime: TaskMonitorStartRuntime,
    private readonly coordinatorRunner: TaskMonitorCoordinatorRunner,
    private readonly logger: ServerLogger,
  ) {}

  public async execute(
    effect: PersistTaskMonitorLaunchEffect,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    this.logger.debug('task_monitor.machine.launch_persistence.started', {
      monitorId: effect.taskMonitorId,
      taskId: effect.taskId,
      cursor: effect.cursor,
      agentSessionId: effect.agentSessionId,
    });
    try {
      const monitor = await this.runtime.readMonitor({
        monitorId: effect.taskMonitorId,
        organizationId: effect.organizationId,
        projectId: effect.projectId,
      });
      if (monitor.definition.cursor !== effect.cursor) {
        throw new Error('Task Monitor launch persistence cursor no longer matches.');
      }
      const entry = monitor.definition.executionPlan[effect.cursor];
      if (!entry || entry.taskId !== effect.taskId) {
        throw new Error('Task Monitor launch persistence target no longer matches.');
      }
      const existingAgentSessionId = entry.agentSessionId ?? null;
      if (existingAgentSessionId !== null && existingAgentSessionId !== effect.agentSessionId) {
        throw new Error(
          'Task Monitor launch persistence conflicts with an existing Agent Session.',
        );
      }
      if (existingAgentSessionId === null) {
        await this.runtime.persistLaunch({
          monitor,
          planIndex: effect.cursor,
          agentSessionId: effect.agentSessionId,
        });
      }
      const coordinatorIdentity = await this.coordinatorRunner.ensureTaskMonitorRun(
        {
          monitorId: effect.taskMonitorId,
          launchConfig: {
            taskId: entry.taskId,
            method: entry.launchConfiguration.method,
            provider: entry.launchConfiguration.provider,
            model: entry.launchConfiguration.model,
            reasoningEffort: entry.launchConfiguration.reasoningEffort,
            ...(entry.launchConfiguration.fastMode === undefined
              ? {}
              : { fastMode: entry.launchConfiguration.fastMode }),
            ...(monitor.definition.launchPolicy.worktree
              ? { worktree: monitor.definition.launchPolicy.worktree }
              : {}),
          },
        },
        { organizationId: effect.organizationId, projectId: effect.projectId },
      );
      if (!coordinatorIdentity) {
        throw new Error('Task Monitor coordinator Run identity is unavailable.');
      }
      this.logger.info('task_monitor.machine.launch_persistence.completed', {
        monitorId: effect.taskMonitorId,
        taskId: effect.taskId,
        cursor: effect.cursor,
        agentSessionId: effect.agentSessionId,
        alreadyPersisted: existingAgentSessionId === effect.agentSessionId,
        coordinatorRunId: coordinatorIdentity.runId,
        coordinatorAgentSessionId: coordinatorIdentity.coordinatorAgentSessionId,
      });
      return {
        status: 'succeeded',
        outcome: {
          type: 'TASK_MONITOR_LAUNCH_PERSISTED',
          taskMonitorId: effect.taskMonitorId,
          taskId: effect.taskId,
          agentSessionId: effect.agentSessionId,
        },
      };
    } catch (error) {
      const reason = reasonFrom(error);
      this.logger.error('task_monitor.machine.launch_persistence.failed', {
        monitorId: effect.taskMonitorId,
        taskId: effect.taskId,
        cursor: effect.cursor,
        agentSessionId: effect.agentSessionId,
        reason,
      });
      return {
        status:
          isLaunchPersistenceRejection(reason) || isSettledMutationFailure(reason)
            ? 'failed'
            : 'uncertain',
        outcome: {
          type: 'TASK_MONITOR_LAUNCH_PERSISTENCE_FAILED',
          taskMonitorId: effect.taskMonitorId,
          taskId: effect.taskId,
          reason,
        },
      };
    }
  }
}

/** Posts STARTED once from a committed effect; message history is never reconstruction authority. */
export class TaskMonitorStartedProjectionEffectHandler implements EffectHandler<
  ProjectTaskMonitorStartedEffect,
  TaskMonitorMachineEffectOutcome
> {
  public readonly recovery = {
    strategy: 'reconcile' as const,
    reconcile: (
      effect: ProjectTaskMonitorStartedEffect,
    ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> =>
      Promise.resolve({
        status: 'uncertain',
        outcome: {
          type: 'TASK_STARTED_PROJECTION_FAILED',
          taskMonitorId: effect.taskMonitorId,
          taskId: effect.taskId,
          reason: 'STARTED projection settlement was interrupted and cannot be reconstructed.',
        },
      }),
  };

  public constructor(
    private readonly apiRuntime: ApiRuntime,
    private readonly coordinatorConversation: TaskMonitorCoordinatorConversation,
    private readonly logger: ServerLogger,
  ) {}

  public async execute(
    effect: ProjectTaskMonitorStartedEffect,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    this.logger.debug('task_monitor.machine.started_projection.started', {
      monitorId: effect.taskMonitorId,
      taskId: effect.taskId,
    });
    try {
      const conversationId = await this.coordinatorConversation.resolve({
        organizationId: effect.organizationId,
        projectId: effect.projectId,
        taskMonitorId: effect.taskMonitorId,
      });
      await this.apiRuntime.clients.default.postMessage({
        organizationId: effect.organizationId,
        projectId: effect.projectId,
        postMessageRequest: {
          ...buildTaskStartedMessage(effect, conversationId),
          type: 'SYSTEM',
        },
      });
      return {
        status: 'succeeded',
        outcome: {
          type: 'TASK_STARTED_PROJECTED',
          taskMonitorId: effect.taskMonitorId,
          taskId: effect.taskId,
        },
      };
    } catch (error) {
      const reason = reasonFrom(error);
      this.logger.error('task_monitor.machine.started_projection.uncertain', {
        monitorId: effect.taskMonitorId,
        taskId: effect.taskId,
        reason,
      });
      return {
        status: 'uncertain',
        outcome: {
          type: 'TASK_STARTED_PROJECTION_FAILED',
          taskMonitorId: effect.taskMonitorId,
          taskId: effect.taskId,
          reason,
        },
      };
    }
  }
}

/** Preserves concrete feature owners behind the generic runner's union-shaped registration seam. */
export class TaskMonitorMachineEffectHandler implements EffectHandler<
  TaskMonitorMachineEffect,
  TaskMonitorMachineEffectOutcome
> {
  public readonly recovery = {
    strategy: 'reconcile' as const,
    reconcile: (effect: TaskMonitorMachineEffect, execution: EffectExecutionIdentity) =>
      this.reconcile(effect, execution),
  };

  public constructor(
    public readonly load: TaskMonitorLoadEffectHandler,
    public readonly coordination: TaskMonitorCoordinationEffectHandler,
    public readonly validation: TaskMonitorLaunchValidationEffectHandler,
    public readonly reconciliation: TaskMonitorLaunchReconciliationEffectHandler,
    public readonly launchPersistence: TaskMonitorLaunchPersistenceEffectHandler,
    public readonly startedProjection: TaskMonitorStartedProjectionEffectHandler,
    public readonly agentSession: TaskMonitorAgentSessionEffectHandler,
    public readonly conversation: TaskMonitorConversationEffectHandler,
    public readonly run: TaskMonitorRunEffectHandler,
    public readonly control: TaskMonitorControlEffectHandler,
    public readonly controlStatusProjection: TaskMonitorControlStatusProjectionEffectHandler,
    public readonly conversationInput: TaskMonitorConversationInputEffectHandler,
    public readonly interventionProjection: TaskMonitorInterventionProjectionEffectHandler,
    public readonly intervention: TaskMonitorDecisionApplicationEffectHandler,
    public readonly supervision: TaskMonitorSettledRunEvaluationEffectHandler,
    public readonly reviewDelivery: TaskMonitorReviewDeliveryEffectHandler,
    public readonly launchRecovery: TaskMonitorLaunchRecoveryEffectHandler,
    public readonly outcomeJudgment?: TaskMonitorOutcomeJudgmentEffectHandler,
  ) {}

  private stateStore: TaskMonitorStateStore | null = null;
  public connectStateStore(store: TaskMonitorStateStore): void {
    this.stateStore = store;
  }

  public async execute(
    effect: TaskMonitorMachineEffect,
    execution: EffectExecutionIdentity,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    if (
      (effect.type === 'EVALUATE_TASK_MONITOR_SETTLED_RUN' ||
        effect.type === 'COORDINATE_TASK_MONITOR_WORK') &&
      effect.correction &&
      this.stateStore
    ) {
      const stored = await this.stateStore.findByInstanceId(effect.taskMonitorId);
      if (
        !stored ||
        typeof stored.snapshot.state === 'string' ||
        stored.snapshot.state.RUNNING.control !== 'ACTIVE'
      ) {
        return {
          status: 'cancelled',
          outcome: {
            type: 'COORDINATOR_CORRECTION_DEFERRED',
            taskMonitorId: effect.taskMonitorId,
            evaluation: effect,
          },
        };
      }
    }
    if (effect.type === 'PROJECT_TASK_MONITOR_OUTCOME_JUDGMENT' && this.stateStore) {
      const stored = await this.stateStore.findByInstanceId(effect.taskMonitorId);
      if (
        !stored ||
        typeof stored.snapshot.state === 'string' ||
        stored.snapshot.state.RUNNING.work !== 'OUTCOME_JUDGMENT' ||
        stored.snapshot.context.coordinatorRecovery?.requestId !== effect.requestId
      ) {
        return {
          status: 'cancelled',
          outcome: {
            type: 'OUTCOME_JUDGMENT_PROJECTION_FAILED',
            taskMonitorId: effect.taskMonitorId,
            requestId: effect.requestId,
            reason: 'Recovery request is no longer pending.',
          },
        };
      }
    }
    switch (effect.type) {
      case 'LOAD_TASK_MONITOR':
        return this.load.execute(effect);
      case 'COORDINATE_TASK_MONITOR_WORK':
        return this.coordination.execute(effect, execution);
      case 'VALIDATE_TASK_MONITOR_LAUNCH':
        return this.validation.execute(effect);
      case 'RECONCILE_TASK_MONITOR_LAUNCH':
        return this.reconciliation.execute(effect);
      case 'PERSIST_TASK_MONITOR_LAUNCH':
        return this.launchPersistence.execute(effect);
      case 'PROJECT_TASK_MONITOR_STARTED':
        return this.startedProjection.execute(effect);
      case 'PROJECT_TASK_MONITOR_LAUNCH_RECOVERY':
        return this.launchRecovery.execute(effect, execution);
      case 'CREATE_TASK_MONITOR_AGENT_SESSION':
        return this.agentSession.execute(effect, execution);
      case 'CREATE_TASK_MONITOR_CONVERSATION':
        return this.conversation.execute(effect);
      case 'START_TASK_MONITOR_RUN':
        return this.run.execute(effect, execution);
      case 'HALT_TASK_MONITOR_CONTROL':
        return this.control.execute(effect);
      case 'PROJECT_TASK_MONITOR_CONTROL_STATUS':
        return this.controlStatusProjection.execute(effect);
      case 'DELIVER_TASK_MONITOR_CONVERSATION_MESSAGE':
      case 'RECONCILE_TASK_MONITOR_CONVERSATION_RESPONSE':
        return this.conversationInput.execute(effect, execution);
      case 'APPLY_TASK_MONITOR_DECISION':
        return this.intervention.execute(effect, execution);
      case 'PROJECT_TASK_MONITOR_INTERVENTION':
        return this.interventionProjection.execute(effect, execution);
      case 'PROJECT_TASK_MONITOR_OUTCOME_JUDGMENT':
        if (!this.outcomeJudgment) throw new Error('Missing Task Monitor recovery judgment owner.');
        return this.outcomeJudgment.execute(effect, execution);
      case 'EVALUATE_TASK_MONITOR_SETTLED_RUN':
        return this.supervision.execute(effect, execution);
      case 'DELIVER_TASK_MONITOR_REVIEW':
        return this.reviewDelivery.execute(effect, execution);
    }
  }

  private reconcile(
    effect: TaskMonitorMachineEffect,
    execution: EffectExecutionIdentity,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    switch (effect.type) {
      case 'VALIDATE_TASK_MONITOR_LAUNCH':
        return this.validation.recovery.reconcile(effect);
      case 'PERSIST_TASK_MONITOR_LAUNCH':
        return this.launchPersistence.recovery.reconcile(effect);
      case 'PROJECT_TASK_MONITOR_STARTED':
        return this.startedProjection.recovery.reconcile(effect);
      case 'PROJECT_TASK_MONITOR_LAUNCH_RECOVERY':
        return this.launchRecovery.recovery.reconcile(effect, execution);
      case 'CREATE_TASK_MONITOR_AGENT_SESSION':
        return this.agentSession.recovery.reconcile(effect, execution);
      case 'CREATE_TASK_MONITOR_CONVERSATION':
        return this.conversation.recovery.reconcile(effect);
      case 'START_TASK_MONITOR_RUN':
        return this.run.recovery.reconcile(effect);
      case 'HALT_TASK_MONITOR_CONTROL':
        return this.control.recovery.reconcile(effect);
      case 'PROJECT_TASK_MONITOR_CONTROL_STATUS':
        return this.controlStatusProjection.recovery.reconcile(effect);
      case 'DELIVER_TASK_MONITOR_CONVERSATION_MESSAGE':
      case 'RECONCILE_TASK_MONITOR_CONVERSATION_RESPONSE':
        return this.conversationInput.recovery.reconcile(effect, execution);
      case 'PROJECT_TASK_MONITOR_INTERVENTION':
        return this.interventionProjection.recovery.reconcile(effect);
      case 'APPLY_TASK_MONITOR_DECISION':
        return this.intervention.recovery.reconcile(effect);
      case 'PROJECT_TASK_MONITOR_OUTCOME_JUDGMENT':
        if (!this.outcomeJudgment) throw new Error('Missing Task Monitor recovery judgment owner.');
        return this.outcomeJudgment.recovery.reconcile(effect, execution);
      case 'EVALUATE_TASK_MONITOR_SETTLED_RUN':
        return this.supervision.recovery.reconcile(effect, execution);
      case 'DELIVER_TASK_MONITOR_REVIEW':
        return this.reviewDelivery.recovery.reconcile(effect);
      default:
        return this.execute(effect, execution);
    }
  }
}
