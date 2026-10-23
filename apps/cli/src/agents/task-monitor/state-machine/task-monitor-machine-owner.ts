import { TaskMonitorStatePublication } from '../../../server/task-monitor-state-publication';
import type { PlatformWebSocketManager } from '../../../server/platform-ws';
import type { TaskMonitorMachineRuntime, TaskMonitorStateStore } from './machine';
import { TaskMonitorOutcomeJudgmentEffectHandler } from './outcome-judgment-effect-handlers';
import type { ApiRuntime } from '../../../../../../packages/ui-common/src/clients/shared';
import type { KeyPairStore } from '../../../credentials';
import type { MessagePoster } from '../../../run/message-poster';
import type { RunRegistry } from '../../../run/run-registry';
import type { RunStore } from '../../../run-store';
import type { LocalAgentService } from '../../../server/local-agent-service';
import type { ServerLogger } from '../../../server/logger';
import type { TaskMonitorLaunchFailureRuntime } from '../../../server/task-monitor-launch-failure-runtime';
import { TaskMonitorCoordinatorConversation } from '../../../server/task-monitor-coordinator-conversation';
import { TaskMonitorCoordinatorRunner } from '../../../server/monitors/runner';
import type { AgentSessionReader } from '../../../server/monitors/agent-session-reader';
import type { PlatformAuthContext } from '../../../server/platform-auth-context';
import { TaskMonitorStartRuntime } from '../../../server/task-monitor-start';
import type { EffectHandler } from '../../../state-machine';
import type { TaskMonitorDecisionStore } from '../task-monitor-decision-store';
import {
  TaskMonitorControlEffectHandler,
  TaskMonitorControlStatusProjectionEffectHandler,
} from './control-effect-handlers';
import type { TaskMonitorMachineEffect } from './effects';
import type { TaskMonitorMachineEffectOutcome } from './events';
import {
  TaskMonitorDecisionApplicationEffectHandler,
  TaskMonitorInterventionProjectionEffectHandler,
} from './intervention-effect-handlers';
import { TaskMonitorLaunchRecoveryEffectHandler } from './launch-recovery-effect-handlers';
import {
  TaskMonitorAgentSessionEffectHandler,
  TaskMonitorConversationEffectHandler,
  TaskMonitorRunEffectHandler,
} from './launch-effect-handlers';
import {
  TaskMonitorCoordinationEffectHandler,
  TaskMonitorLaunchPersistenceEffectHandler,
  TaskMonitorLaunchReconciliationEffectHandler,
  TaskMonitorLaunchValidationEffectHandler,
  TaskMonitorLoadEffectHandler,
  TaskMonitorMachineEffectHandler,
  TaskMonitorStartedProjectionEffectHandler,
} from './monitor-effect-handlers';
import {
  TaskMonitorReviewDeliveryEffectHandler,
  TaskMonitorSettledRunEvaluationEffectHandler,
} from './supervision-effect-handlers';
import { TaskMonitorConversationInputEffectHandler } from './conversation-input-effect-handlers';

export type TaskMonitorEffectHandlers = Readonly<
  Record<
    TaskMonitorMachineEffect['type'],
    EffectHandler<TaskMonitorMachineEffect, TaskMonitorMachineEffectOutcome>
  >
>;

export interface TaskMonitorMachineOwnerDependencies {
  readonly apiBaseUrl: string;
  readonly apiRuntime: ApiRuntime;
  readonly authContext: PlatformAuthContext;
  readonly agentService: LocalAgentService;
  readonly runStore: RunStore;
  readonly runRegistry: RunRegistry;
  readonly keyPairStore: KeyPairStore;
  readonly agentSessionReader: AgentSessionReader;
  readonly messagePoster: MessagePoster;
  readonly decisionStore: TaskMonitorDecisionStore;
  readonly fetchImpl: typeof fetch;
  readonly logger: ServerLogger;
  readonly taskMonitorLaunchFailureRuntime?: TaskMonitorLaunchFailureRuntime;
}

/** Owns the cohesive Task Monitor machine handler graph and its private leaves. */
export class TaskMonitorMachineOwner {
  public statePublication: TaskMonitorStatePublication | null = null;
  public readonly runtime: TaskMonitorStartRuntime;
  public readonly launchValidationEffectHandler: TaskMonitorLaunchValidationEffectHandler;
  public readonly settledRunEvaluationEffectHandler: TaskMonitorSettledRunEvaluationEffectHandler;
  public readonly reviewDeliveryEffectHandler: TaskMonitorReviewDeliveryEffectHandler;
  public readonly effectHandler: TaskMonitorMachineEffectHandler;
  public readonly effectHandlers: TaskMonitorEffectHandlers;

  public constructor(private readonly dependencies: TaskMonitorMachineOwnerDependencies) {
    this.runtime = new TaskMonitorStartRuntime({
      apiBaseUrl: dependencies.apiBaseUrl,
      fetchImpl: dependencies.fetchImpl,
      authContext: dependencies.authContext,
      logger: dependencies.logger.child({ component: 'task-monitor.start.runtime' }),
    });
    const load = new TaskMonitorLoadEffectHandler(
      this.runtime,
      dependencies.logger.child({ component: 'task-monitor.machine.load' }),
    );
    this.launchValidationEffectHandler = new TaskMonitorLaunchValidationEffectHandler(
      this.runtime,
      dependencies.logger.child({ component: 'task-monitor.machine.launch-validation' }),
    );
    const launchReconciliation = new TaskMonitorLaunchReconciliationEffectHandler(
      this.runtime,
      dependencies.apiRuntime,
      dependencies.runStore,
      dependencies.logger.child({ component: 'task-monitor.machine.launch-reconciliation' }),
      dependencies.taskMonitorLaunchFailureRuntime,
    );
    const coordinatorConversation = new TaskMonitorCoordinatorConversation(
      dependencies.apiRuntime,
      dependencies.logger.child({ component: 'task-monitor.coordinator-conversation' }),
    );
    const coordinatorRunner = new TaskMonitorCoordinatorRunner({
      authProvider: dependencies.authContext,
      agentService: dependencies.agentService,
      runStore: dependencies.runStore,
      decisionStore: dependencies.decisionStore,
      logger: dependencies.logger.child({ component: 'task-monitor.coordinator' }),
    });
    const launchPersistence = new TaskMonitorLaunchPersistenceEffectHandler(
      this.runtime,
      coordinatorRunner,
      dependencies.logger.child({ component: 'task-monitor.machine.launch-persistence' }),
    );
    const startedProjection = new TaskMonitorStartedProjectionEffectHandler(
      dependencies.apiRuntime,
      coordinatorConversation,
      dependencies.logger.child({ component: 'task-monitor.machine.started-projection' }),
    );
    const launchRecovery = new TaskMonitorLaunchRecoveryEffectHandler(
      dependencies.apiRuntime,
      dependencies.messagePoster,
      coordinatorConversation,
      dependencies.logger.child({ component: 'task-monitor.machine.launch-recovery' }),
    );
    const agentSession = new TaskMonitorAgentSessionEffectHandler(
      dependencies.apiRuntime,
      dependencies.logger.child({ component: 'task-monitor.machine.agent-session' }),
    );
    const conversation = new TaskMonitorConversationEffectHandler(
      dependencies.apiRuntime,
      dependencies.logger.child({ component: 'task-monitor.machine.conversation' }),
    );
    const run = new TaskMonitorRunEffectHandler(
      dependencies.apiRuntime,
      dependencies.fetchImpl,
      dependencies.keyPairStore,
      dependencies.runStore,
      dependencies.logger.child({ component: 'task-monitor.machine.run' }),
    );
    const control = new TaskMonitorControlEffectHandler(
      this.runtime,
      dependencies.runStore,
      dependencies.agentService,
      dependencies.logger.child({ component: 'task-monitor.machine.control' }),
    );
    const controlStatusProjection = new TaskMonitorControlStatusProjectionEffectHandler(
      this.runtime,
      dependencies.logger.child({
        component: 'task-monitor.machine.control-status-projection',
      }),
    );
    const interventionProjection = new TaskMonitorInterventionProjectionEffectHandler(
      dependencies.messagePoster,
      dependencies.logger.child({ component: 'task-monitor.machine.intervention-projection' }),
    );
    const decisionApplication = new TaskMonitorDecisionApplicationEffectHandler(
      dependencies.runRegistry,
      dependencies.logger.child({ component: 'task-monitor.machine.intervention' }),
    );
    const conversationInput = new TaskMonitorConversationInputEffectHandler(
      dependencies.agentService,
      coordinatorRunner,
      dependencies.runStore,
      dependencies.logger.child({ component: 'task-monitor.machine.conversation-input' }),
    );
    this.settledRunEvaluationEffectHandler = new TaskMonitorSettledRunEvaluationEffectHandler({
      apiBaseUrl: dependencies.apiBaseUrl,
      fetchImpl: dependencies.fetchImpl,
      authContext: dependencies.authContext,
      agentSessionReader: dependencies.agentSessionReader,
      agentService: dependencies.agentService,
      runStore: dependencies.runStore,
      messagePoster: dependencies.messagePoster,
      keyPairStore: dependencies.keyPairStore,
      decisionStore: dependencies.decisionStore,
      taskMonitorStartRuntime: this.runtime,
      coordinatorRunner,
      logger: dependencies.logger.child({ component: 'task-monitor.machine.supervision' }),
    });
    const coordination = new TaskMonitorCoordinationEffectHandler(
      this.runtime,
      dependencies.logger.child({ component: 'task-monitor.machine.coordination' }),
      {
        coordinatorRunner,
        supervision: this.settledRunEvaluationEffectHandler,
        agentService: dependencies.agentService,
        authContext: dependencies.authContext,
        runStore: dependencies.runStore,
        fetchImpl: dependencies.fetchImpl,
        apiBaseUrl: dependencies.apiBaseUrl,
        decisionStore: dependencies.decisionStore,
      },
    );
    this.reviewDeliveryEffectHandler = new TaskMonitorReviewDeliveryEffectHandler({
      apiBaseUrl: dependencies.apiBaseUrl,
      fetchImpl: dependencies.fetchImpl,
      authContext: dependencies.authContext,
      agentSessionReader: dependencies.agentSessionReader,
      agentService: dependencies.agentService,
      runStore: dependencies.runStore,
      messagePoster: dependencies.messagePoster,
      keyPairStore: dependencies.keyPairStore,
      decisionStore: dependencies.decisionStore,
      taskMonitorStartRuntime: this.runtime,
      coordinatorRunner,
      logger: dependencies.logger.child({ component: 'task-monitor.machine.review-delivery' }),
    });

    this.effectHandler = new TaskMonitorMachineEffectHandler(
      load,
      coordination,
      this.launchValidationEffectHandler,
      launchReconciliation,
      launchPersistence,
      startedProjection,
      agentSession,
      conversation,
      run,
      control,
      controlStatusProjection,
      conversationInput,
      interventionProjection,
      decisionApplication,
      this.settledRunEvaluationEffectHandler,
      this.reviewDeliveryEffectHandler,
      launchRecovery,
      new TaskMonitorOutcomeJudgmentEffectHandler(
        dependencies.apiRuntime,
        dependencies.messagePoster,
        coordinatorConversation,
        dependencies.logger.child({ component: 'task-monitor.recovery-judgment' }),
      ),
    );
    this.effectHandlers = {
      PROJECT_TASK_MONITOR_OUTCOME_JUDGMENT: this.effectHandler,
      LOAD_TASK_MONITOR: this.effectHandler,
      COORDINATE_TASK_MONITOR_WORK: this.effectHandler,
      VALIDATE_TASK_MONITOR_LAUNCH: this.effectHandler,
      RECONCILE_TASK_MONITOR_LAUNCH: this.effectHandler,
      CREATE_TASK_MONITOR_AGENT_SESSION: this.effectHandler,
      CREATE_TASK_MONITOR_CONVERSATION: this.effectHandler,
      START_TASK_MONITOR_RUN: this.effectHandler,
      PERSIST_TASK_MONITOR_LAUNCH: this.effectHandler,
      PROJECT_TASK_MONITOR_STARTED: this.effectHandler,
      PROJECT_TASK_MONITOR_LAUNCH_RECOVERY: this.effectHandler,
      PROJECT_TASK_MONITOR_CONTROL_STATUS: this.effectHandler,
      DELIVER_TASK_MONITOR_CONVERSATION_MESSAGE: this.effectHandler,
      RECONCILE_TASK_MONITOR_CONVERSATION_RESPONSE: this.effectHandler,
      HALT_TASK_MONITOR_CONTROL: this.effectHandler,
      PROJECT_TASK_MONITOR_INTERVENTION: this.effectHandler,
      EVALUATE_TASK_MONITOR_SETTLED_RUN: this.effectHandler,
      DELIVER_TASK_MONITOR_REVIEW: this.effectHandler,
      APPLY_TASK_MONITOR_DECISION: this.effectHandler,
    };
  }
  public connectStatePublication(
    runtime: TaskMonitorMachineRuntime,
    store: TaskMonitorStateStore,
    websocket: PlatformWebSocketManager,
  ): TaskMonitorStatePublication {
    this.effectHandler.connectStateStore(store);
    this.statePublication ??= new TaskMonitorStatePublication(
      runtime,
      store,
      websocket,
      this.dependencies.keyPairStore,
      this.dependencies.logger.child({ component: 'task-monitor.state' }),
    );
    return this.statePublication;
  }
}
