import { and, stateIn } from 'xstate';

import type { TaskMonitorMachineContext } from './context';
import { taskMonitorCoordinationLocalStateFromContext } from '../task-monitor-coordination';
import {
  admitTaskMonitorLaunchRetryEffect,
  coordinateTaskMonitorWorkEffect,
  coordinateTaskMonitorWorkFromContext,
  deliverTaskMonitorReviewEffect,
  projectTaskMonitorOutcomeJudgmentEffect,
  createTaskMonitorAgentSessionEffectFromContext,
  createTaskMonitorConversationEffectFromContext,
  persistTaskMonitorLaunchEffectFromContext,
  projectTaskMonitorLaunchRecoveryEffect,
  projectTaskMonitorStartedEffectFromContext,
  reconcileTaskMonitorLaunchEffect,
  startTaskMonitorRunEffectFromContext,
  retryTaskMonitorLaunchEffect,
  validateTaskMonitorLaunchEffect,
} from './effects';
import type { TaskMonitorMachineEvent } from './events';
import {
  coordinatorInvalidTransitions,
  matchesCoordinationOutcome,
  taskMonitorSupervisionStates,
} from './supervision';

interface ActionParameters {
  readonly context: TaskMonitorMachineContext;
  readonly event: TaskMonitorMachineEvent;
}

const coordinateParameters = ({ context, event }: ActionParameters) => {
  if (event.type !== 'MONITOR_LOADED') throw new Error('Expected MONITOR_LOADED.');
  return coordinateTaskMonitorWorkEffect(event, {
    cause: 'START',
    ...(context.authorityCommandId ? { correlationId: context.authorityCommandId } : {}),
    ...(context.authorityCommandId ? { authorityCommandId: context.authorityCommandId } : {}),
    coordination: taskMonitorCoordinationLocalStateFromContext(context, 'ACTIVE', 'COORDINATING'),
  });
};

const validateParameters = ({ context, event }: ActionParameters) => {
  if (event.type !== 'WORK_SELECTED') throw new Error('Expected WORK_SELECTED.');
  return validateTaskMonitorLaunchEffect(context, event);
};

const taskActivationReconciliationParameters = ({ context }: ActionParameters) =>
  reconcileTaskMonitorLaunchEffect(context, 'TASK_ACTIVATION');

const monitorProjectionReconciliationParameters = ({ context }: ActionParameters) =>
  reconcileTaskMonitorLaunchEffect(context, 'MONITOR_PROJECTION');

const agentSessionReconciliationParameters = ({ context }: ActionParameters) =>
  reconcileTaskMonitorLaunchEffect(context, 'AGENT_SESSION_CREATION');

const conversationReconciliationParameters = ({ context }: ActionParameters) =>
  reconcileTaskMonitorLaunchEffect(context, 'CONVERSATION_CREATION');

const runReconciliationParameters = ({ context }: ActionParameters) =>
  reconcileTaskMonitorLaunchEffect(context, 'RUN_START');

const validationRetryParameters = ({ context }: ActionParameters) =>
  retryTaskMonitorLaunchEffect(context);

const createSessionFromContextParameters = ({ context }: ActionParameters) =>
  createTaskMonitorAgentSessionEffectFromContext(context);

const createConversationFromContextParameters = ({ context }: ActionParameters) =>
  createTaskMonitorConversationEffectFromContext(context);

const startRunFromContextParameters = ({ context }: ActionParameters) =>
  startTaskMonitorRunEffectFromContext(context);

const projectStartedFromContextParameters = ({ context }: ActionParameters) =>
  projectTaskMonitorStartedEffectFromContext(context);

const persistLaunchFromContextParameters = ({ context }: ActionParameters) =>
  persistTaskMonitorLaunchEffectFromContext(context);

const retryAdmissionParameters = ({ context }: ActionParameters) =>
  admitTaskMonitorLaunchRetryEffect(context);

const launchRecoveryProjectionParameters = ({ context, event }: ActionParameters) => {
  if (event.type !== 'LAUNCH_FAILURE_REPORTED') {
    throw new Error('Expected LAUNCH_FAILURE_REPORTED.');
  }
  return projectTaskMonitorLaunchRecoveryEffect(context, event);
};

const continuedCoordinationParameters = ({ context }: ActionParameters) =>
  coordinateTaskMonitorWorkFromContext(context);

const coordinationReviewDeliveryParameters = ({ context, event }: ActionParameters) => {
  if (event.type !== 'REVIEW_REQUEST_COMMITTED') {
    throw new Error('Expected REVIEW_REQUEST_COMMITTED.');
  }
  return deliverTaskMonitorReviewEffect(context, event);
};

/** Task Monitor-owned work-region policy consumed by the top-level parallel machine. */
export const taskMonitorWorkStates = {
  initial: 'LOADING_MONITOR',
  states: {
    LOADING_MONITOR: {
      on: {
        MONITOR_LOADED: {
          guard: 'matchesLoadedTaskMonitor',
          target: 'COORDINATING',
          actions: [
            'storeLoadedMonitor',
            { type: 'coordinateTaskMonitorWork', params: coordinateParameters },
          ],
        },
        MONITOR_LOAD_FAILED: {
          guard: 'matchesTaskMonitor',
          target: 'MONITOR_LOAD_FAILED',
          actions: 'storeFailure',
        },
      },
    },
    COORDINATING: {
      always: {
        guard: and([
          'canDeliverCoordinationCorrection',
          stateIn({ RUNNING: { control: 'ACTIVE' } }),
        ]),
        actions: [
          {
            type: 'coordinateTaskMonitorWork',
            params: ({ context }: ActionParameters) => context.coordinatorRecovery!.evaluation,
          },
          'clearPendingCorrection',
        ],
      },
      on: {
        COORDINATOR_DECISION_INVALID: coordinatorInvalidTransitions,
        COORDINATOR_CORRECTION_DEFERRED: {
          guard: 'matchesTaskMonitor',
          actions: 'storeDeferredCorrection',
        },
        SUPERVISION_CONTINUES_OBSERVING: {
          guard: 'matchesCoordinationOutcome',
          target: 'OBSERVING_RUN',
          actions: 'storeContinuedSupervision',
        },
        REVIEW_REQUEST_COMMITTED: {
          guard: 'matchesCoordinationOutcome',
          target: 'REQUESTING_REVIEW',
          actions: [
            'storeReviewRequest',
            { type: 'deliverTaskMonitorReview', params: coordinationReviewDeliveryParameters },
          ],
        },
        COORDINATION_CONTINUES: {
          guard: 'matchesCoordinationOutcome',
          target: 'COORDINATING',
          actions: [
            'prepareContinuedCoordination',
            { type: 'coordinateTaskMonitorWork', params: continuedCoordinationParameters },
          ],
        },
        OUTCOME_JUDGMENT_REQUIRED: [
          {
            guard: ({ context, event }: ActionParameters) =>
              context.coordinatorRecovery != null && matchesCoordinationOutcome({ context, event }),
            target: 'OUTCOME_JUDGMENT',
            actions: [
              'storeFailure',
              {
                type: 'projectTaskMonitorOutcomeJudgment',
                params: ({ context }: ActionParameters) =>
                  projectTaskMonitorOutcomeJudgmentEffect(context),
              },
            ],
          },
          {
            guard: 'matchesCoordinationOutcome',
            target: 'OUTCOME_JUDGMENT',
            actions: 'storeFailure',
          },
        ],
        SUPERVISION_HALTED: {
          guard: 'matchesCoordinationOutcome',
          target: '#task-monitor.HALTED',
          actions: 'storeFailure',
        },
        SUPERVISION_COMPLETED: {
          guard: 'matchesCoordinationOutcome',
          target: '#task-monitor.COMPLETED',
        },
        WORK_SELECTED: {
          guard: 'matchesCoordinatedWork',
          target: 'VALIDATING_LAUNCH',
          actions: [
            'storeSelectedWork',
            { type: 'validateTaskMonitorLaunch', params: validateParameters },
          ],
        },
        WORK_EXHAUSTED: {
          guard: 'matchesExhaustedWork',
          target: '#task-monitor.COMPLETED',
          actions: 'storeCursor',
        },
        COORDINATION_FAILED: {
          guard: 'matchesTaskMonitor',
          target: 'LAUNCH_JUDGMENT',
          actions: 'storeFailure',
        },
      },
    },
    VALIDATING_LAUNCH: {
      on: {
        LAUNCH_VALIDATED: {
          guard: 'matchesSelectedWork',
          target: 'LAUNCH_READY',
          actions: 'storeValidatedLaunch',
        },
        LAUNCH_VALIDATION_FAILED: {
          guard: 'matchesSelectedWork',
          target: 'LAUNCH_JUDGMENT',
          actions: 'storeFailure',
        },
        LAUNCH_VALIDATION_UNCERTAIN: [
          {
            guard: 'matchesTaskActivationOperation',
            target: 'RECONCILING_TASK_ACTIVATION',
            actions: {
              type: 'reconcileTaskMonitorLaunch',
              params: taskActivationReconciliationParameters,
            },
          },
          {
            guard: 'matchesMonitorProjectionOperation',
            target: 'RECONCILING_MONITOR_PROJECTION',
            actions: {
              type: 'reconcileTaskMonitorLaunch',
              params: monitorProjectionReconciliationParameters,
            },
          },
        ],
      },
    },
    RECONCILING_TASK_ACTIVATION: {
      on: {
        OPERATION_FOUND: {
          guard: 'matchesTaskActivationOperation',
          target: 'VALIDATING_LAUNCH',
          actions: { type: 'validateTaskMonitorLaunch', params: validationRetryParameters },
        },
        OPERATION_ABSENT: {
          guard: 'matchesTaskActivationOperation',
          target: 'VALIDATING_LAUNCH',
          actions: { type: 'validateTaskMonitorLaunch', params: validationRetryParameters },
        },
        RECONCILIATION_FAILED: {
          guard: 'matchesTaskActivationOperation',
          target: 'LAUNCH_JUDGMENT',
          actions: 'storeFailure',
        },
      },
    },
    RECONCILING_MONITOR_PROJECTION: {
      on: {
        OPERATION_FOUND: {
          guard: 'matchesMonitorProjectionOperation',
          target: 'VALIDATING_LAUNCH',
          actions: { type: 'validateTaskMonitorLaunch', params: validationRetryParameters },
        },
        OPERATION_ABSENT: {
          guard: 'matchesMonitorProjectionOperation',
          target: 'VALIDATING_LAUNCH',
          actions: { type: 'validateTaskMonitorLaunch', params: validationRetryParameters },
        },
        RECONCILIATION_FAILED: {
          guard: 'matchesMonitorProjectionOperation',
          target: 'LAUNCH_JUDGMENT',
          actions: 'storeFailure',
        },
      },
    },
    LAUNCH_READY: {
      always: {
        guard: stateIn({ RUNNING: { control: 'ACTIVE' } }),
        target: 'CREATING_AGENT_SESSION',
        actions: {
          type: 'createTaskMonitorAgentSession',
          params: createSessionFromContextParameters,
        },
      },
    },
    CREATING_AGENT_SESSION: {
      on: {
        AGENT_SESSION_CREATED: {
          guard: 'matchesSelectedLaunch',
          target: 'CREATING_CONVERSATION',
          actions: [
            'storeAgentSession',
            {
              type: 'createTaskMonitorConversation',
              params: createConversationFromContextParameters,
            },
          ],
        },
        LAUNCH_OPERATION_UNCERTAIN: {
          guard: 'matchesAgentSessionCreationOperation',
          target: 'RECONCILING_AGENT_SESSION_CREATION',
          actions: [
            'storeAgentSession',
            {
              type: 'reconcileTaskMonitorLaunch',
              params: agentSessionReconciliationParameters,
            },
          ],
        },
        LAUNCH_OPERATION_FAILED: {
          guard: 'matchesSelectedLaunch',
          target: 'LAUNCH_JUDGMENT',
          actions: 'storeFailure',
        },
        LAUNCH_OPERATION_CANCELLED: {
          guard: 'matchesSelectedLaunch',
          target: 'LAUNCH_JUDGMENT',
          actions: 'storeFailure',
        },
      },
    },
    RECONCILING_AGENT_SESSION_CREATION: {
      on: {
        OPERATION_FOUND: {
          guard: 'matchesAgentSessionCreationOperation',
          target: 'CREATING_CONVERSATION',
          actions: [
            'storeAgentSession',
            {
              type: 'createTaskMonitorConversation',
              params: createConversationFromContextParameters,
            },
          ],
        },
        OPERATION_ABSENT: {
          guard: 'matchesAgentSessionCreationOperation',
          target: 'CREATING_AGENT_SESSION',
          actions: {
            type: 'createTaskMonitorAgentSession',
            params: createSessionFromContextParameters,
          },
        },
        RECONCILIATION_FAILED: {
          guard: 'matchesAgentSessionCreationOperation',
          target: 'LAUNCH_JUDGMENT',
          actions: 'storeFailure',
        },
      },
    },
    CREATING_CONVERSATION: {
      on: {
        CONVERSATION_CREATED: {
          guard: 'matchesSelectedLaunch',
          target: 'PERSISTING_LAUNCH',
          actions: [
            'storeConversation',
            { type: 'persistTaskMonitorLaunch', params: persistLaunchFromContextParameters },
          ],
        },
        LAUNCH_OPERATION_UNCERTAIN: {
          guard: 'matchesConversationCreationOperation',
          target: 'RECONCILING_CONVERSATION_CREATION',
          actions: {
            type: 'reconcileTaskMonitorLaunch',
            params: conversationReconciliationParameters,
          },
        },
        LAUNCH_OPERATION_FAILED: {
          guard: 'matchesSelectedLaunch',
          target: 'LAUNCH_JUDGMENT',
          actions: 'storeFailure',
        },
        LAUNCH_OPERATION_CANCELLED: {
          guard: 'matchesSelectedLaunch',
          target: 'LAUNCH_JUDGMENT',
          actions: 'storeFailure',
        },
      },
    },
    RECONCILING_CONVERSATION_CREATION: {
      on: {
        OPERATION_FOUND: {
          guard: 'matchesConversationCreationOperation',
          target: 'PERSISTING_LAUNCH',
          actions: [
            'storeConversation',
            { type: 'persistTaskMonitorLaunch', params: persistLaunchFromContextParameters },
          ],
        },
        OPERATION_ABSENT: {
          guard: 'matchesConversationCreationOperation',
          target: 'CREATING_CONVERSATION',
          actions: {
            type: 'createTaskMonitorConversation',
            params: createConversationFromContextParameters,
          },
        },
        RECONCILIATION_FAILED: {
          guard: 'matchesConversationCreationOperation',
          target: 'LAUNCH_JUDGMENT',
          actions: 'storeFailure',
        },
      },
    },
    STARTING_RUN: {
      on: {
        LAUNCH_FAILURE_REPORTED: {
          guard: 'matchesLaunchFailure',
          target: 'RETRYABLE_LAUNCH',
          actions: [
            'storeRetryableLaunch',
            {
              type: 'projectTaskMonitorLaunchRecovery',
              params: launchRecoveryProjectionParameters,
            },
          ],
        },
        RUN_STARTED: {
          guard: 'matchesSelectedLaunch',
          target: 'PROJECTING_STARTED',
          actions: [
            'storeActiveRun',
            { type: 'projectTaskMonitorStarted', params: projectStartedFromContextParameters },
          ],
        },
        LAUNCH_OPERATION_UNCERTAIN: {
          guard: 'matchesRunStartOperation',
          target: 'RECONCILING_RUN_START',
          actions: {
            type: 'reconcileTaskMonitorLaunch',
            params: runReconciliationParameters,
          },
        },
        LAUNCH_OPERATION_FAILED: {
          guard: 'matchesRunStartFailure',
          target: 'RETRYABLE_LAUNCH',
          actions: 'storeRetryableLaunch',
        },
        LAUNCH_OPERATION_CANCELLED: {
          guard: 'matchesRunStartFailure',
          target: 'RETRYABLE_LAUNCH',
          actions: 'storeRetryableLaunch',
        },
      },
    },
    RECONCILING_RUN_START: {
      on: {
        LAUNCH_FAILURE_REPORTED: {
          guard: 'matchesLaunchFailure',
          target: 'RETRYABLE_LAUNCH',
          actions: [
            'storeRetryableLaunch',
            {
              type: 'projectTaskMonitorLaunchRecovery',
              params: launchRecoveryProjectionParameters,
            },
          ],
        },
        OPERATION_FOUND: {
          guard: 'matchesRunStartOperation',
          target: 'PROJECTING_STARTED',
          actions: [
            'storeActiveRun',
            { type: 'projectTaskMonitorStarted', params: projectStartedFromContextParameters },
          ],
        },
        OPERATION_ABSENT: {
          guard: 'matchesRunStartOperation',
          target: 'STARTING_RUN',
          actions: { type: 'startTaskMonitorRun', params: startRunFromContextParameters },
        },
        RECONCILIATION_FAILED: {
          guard: 'matchesRunStartOperation',
          target: 'LAUNCH_JUDGMENT',
          actions: 'storeFailure',
        },
      },
    },
    PERSISTING_LAUNCH: {
      on: {
        TASK_MONITOR_LAUNCH_PERSISTED: {
          guard: 'matchesSelectedLaunch',
          target: 'STARTING_RUN',
          actions: {
            type: 'startTaskMonitorRun',
            params: startRunFromContextParameters,
          },
        },
        TASK_MONITOR_LAUNCH_PERSISTENCE_FAILED: {
          guard: 'matchesSelectedLaunch',
          target: 'LAUNCH_JUDGMENT',
          actions: 'storeFailure',
        },
      },
    },
    RETRYABLE_LAUNCH: {
      on: {
        START: {
          guard: 'matchesTaskMonitor',
          target: 'ADMITTING_LAUNCH_RETRY',
          actions: {
            type: 'reconcileTaskMonitorLaunch',
            params: retryAdmissionParameters,
          },
        },
        CONTINUE: {
          guard: 'matchesTaskMonitor',
          target: 'ADMITTING_LAUNCH_RETRY',
          actions: {
            type: 'reconcileTaskMonitorLaunch',
            params: retryAdmissionParameters,
          },
        },
        RESUME: {
          guard: 'matchesTaskMonitor',
          target: 'ADMITTING_LAUNCH_RETRY',
          actions: {
            type: 'reconcileTaskMonitorLaunch',
            params: retryAdmissionParameters,
          },
        },
      },
    },
    ADMITTING_LAUNCH_RETRY: {
      on: {
        LAUNCH_RETRY_ADMITTED: {
          guard: 'matchesRetryableLaunch',
          target: 'STARTING_RUN',
          actions: [
            'clearRetryableLaunch',
            { type: 'startTaskMonitorRun', params: startRunFromContextParameters },
          ],
        },
        LAUNCH_RETRY_REJECTED: {
          guard: 'matchesRetryableLaunch',
          target: 'LAUNCH_JUDGMENT',
          actions: 'storeFailure',
        },
      },
    },
    PROJECTING_STARTED: {
      on: {
        LAUNCH_FAILURE_REPORTED: {
          guard: 'matchesLaunchFailure',
          target: 'RETRYABLE_LAUNCH',
          actions: [
            'storeRetryableLaunch',
            {
              type: 'projectTaskMonitorLaunchRecovery',
              params: launchRecoveryProjectionParameters,
            },
          ],
        },
        TASK_STARTED_PROJECTED: {
          guard: 'matchesSelectedLaunch',
          target: 'OBSERVING_RUN',
        },
        TASK_STARTED_PROJECTION_FAILED: {
          guard: 'matchesSelectedLaunch',
          target: 'LAUNCH_JUDGMENT',
          actions: 'storeFailure',
        },
      },
    },
    ...taskMonitorSupervisionStates,
    MONITOR_LOAD_FAILED: {},
    LAUNCH_JUDGMENT: {},
  },
} as const;
