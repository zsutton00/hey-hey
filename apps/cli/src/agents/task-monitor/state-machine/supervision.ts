import { and, or, stateIn } from 'xstate';
import type { TaskMonitorMachineContext } from './context';
import { taskMonitorCoordinationLocalStateFromContext } from '../task-monitor-coordination';
import {
  coordinateTaskMonitorWorkFromContext,
  deliverTaskMonitorReviewEffect,
  evaluateTaskMonitorResolvedJudgmentEffect,
  evaluateTaskMonitorSettledRunEffect,
  projectTaskMonitorLaunchRecoveryEffect,
  projectTaskMonitorOutcomeJudgmentEffect,
} from './effects';
import { coordinatorValidationRecovery } from '../task-monitor-coordinator-recovery';
import type { TaskMonitorMachineEvent } from './events';

interface SupervisionArguments {
  readonly context: TaskMonitorMachineContext;
  readonly event: TaskMonitorMachineEvent;
}

export const matchesActiveSettledRun = ({ context, event }: SupervisionArguments): boolean =>
  event.type === 'RUN_SETTLED' &&
  event.taskMonitorId === context.taskMonitorId &&
  event.agentSessionId === context.activeRunAgentSessionId;

export const matchesSettledRunEvaluation = ({ context, event }: SupervisionArguments): boolean => {
  const settledRun = context.settledRun;
  return (
    settledRun !== null &&
    (event.type === 'SUPERVISION_CONTINUES_OBSERVING' ||
      event.type === 'COORDINATION_CONTINUES' ||
      event.type === 'LAUNCH_JUDGMENT_REQUIRED' ||
      event.type === 'OUTCOME_JUDGMENT_REQUIRED' ||
      event.type === 'SUPERVISION_HALTED' ||
      event.type === 'SUPERVISION_COMPLETED') &&
    event.taskMonitorId === context.taskMonitorId &&
    event.runId === settledRun.runId &&
    event.agentSessionId === settledRun.agentSessionId
  );
};

export const matchesCoordinationOutcome = ({ context, event }: SupervisionArguments): boolean => {
  if (
    event.type !== 'SUPERVISION_CONTINUES_OBSERVING' &&
    event.type !== 'COORDINATION_CONTINUES' &&
    event.type !== 'REVIEW_REQUEST_COMMITTED' &&
    event.type !== 'OUTCOME_JUDGMENT_REQUIRED' &&
    event.type !== 'SUPERVISION_HALTED' &&
    event.type !== 'SUPERVISION_COMPLETED'
  ) {
    return false;
  }
  const expectedAgentSessionId =
    context.settledRun?.agentSessionId ?? context.activeRunAgentSessionId;
  return (
    event.taskMonitorId === context.taskMonitorId &&
    expectedAgentSessionId !== null &&
    event.agentSessionId === expectedAgentSessionId &&
    (context.settledRun === null || event.runId === context.settledRun.runId)
  );
};

export const matchesCommittedReviewRequest = ({ context, event }: SupervisionArguments): boolean =>
  event.type === 'REVIEW_REQUEST_COMMITTED' &&
  context.settledRun !== null &&
  event.taskMonitorId === context.taskMonitorId &&
  event.runId === context.settledRun.runId &&
  event.agentSessionId === context.settledRun.agentSessionId;

export const matchesActiveReviewRequest = ({ context, event }: SupervisionArguments): boolean =>
  (event.type === 'REVIEW_REQUEST_ACCEPTED' || event.type === 'REVIEW_REQUEST_FAILED') &&
  context.settledRun !== null &&
  context.reviewRequest !== null &&
  event.taskMonitorId === context.taskMonitorId &&
  event.runId === context.settledRun.runId &&
  event.agentSessionId === context.reviewRequest.agentSessionId &&
  event.requestId === context.reviewRequest.requestId;

export const matchesResolvedJudgment = ({ context, event }: SupervisionArguments): boolean =>
  event.type === 'JUDGMENT_RESOLVED' &&
  event.taskMonitorId === context.taskMonitorId &&
  context.settledRun !== null &&
  (!context.coordinatorRecovery ||
    context.coordinatorRecovery.requestMessageId === event.judgment.requestMessageId);

export const matchesResolvedCoordinationJudgment = ({
  context,
  event,
}: SupervisionArguments): boolean =>
  event.type === 'JUDGMENT_RESOLVED' &&
  event.taskMonitorId === context.taskMonitorId &&
  context.settledRun === null &&
  (context.coordinationCause === 'RESUME' || context.coordinationCause === 'JUDGMENT_RESOLVED') &&
  context.activeRunAgentSessionId !== null &&
  (!context.coordinatorRecovery ||
    context.coordinatorRecovery.requestMessageId === event.judgment.requestMessageId);

const evaluationParameters = ({ context, event }: SupervisionArguments) => {
  if (event.type !== 'RUN_SETTLED') throw new Error('Expected RUN_SETTLED.');
  return evaluateTaskMonitorSettledRunEffect(context, event);
};

const coordinationParameters = ({ context }: SupervisionArguments) => {
  const correlationId = context.settledRun?.turnId ?? context.authorityCommandId;
  if (!correlationId) throw new Error('Task Monitor continuation has no canonical correlation.');
  return coordinateTaskMonitorWorkFromContext(context, {
    cause: 'CONTINUE',
    correlationId,
    coordination: taskMonitorCoordinationLocalStateFromContext(context, 'ACTIVE', 'COORDINATING'),
  });
};

const resolvedJudgmentParameters = ({ context, event }: SupervisionArguments) => {
  if (event.type !== 'JUDGMENT_RESOLVED') throw new Error('Expected JUDGMENT_RESOLVED.');
  return evaluateTaskMonitorResolvedJudgmentEffect(context, event);
};

const resolvedCoordinationJudgmentParameters = ({ context, event }: SupervisionArguments) => {
  if (event.type !== 'JUDGMENT_RESOLVED') throw new Error('Expected JUDGMENT_RESOLVED.');
  return coordinateTaskMonitorWorkFromContext(context, {
    cause: 'JUDGMENT_RESOLVED',
    cursor: context.cursor ?? 0,
    correlationId: event.judgment.requestMessageId,
    coordination: taskMonitorCoordinationLocalStateFromContext(context, 'ACTIVE', 'COORDINATING'),
    judgment: event.judgment,
  });
};

const reviewDeliveryParameters = ({ context, event }: SupervisionArguments) => {
  if (event.type !== 'REVIEW_REQUEST_COMMITTED') {
    throw new Error('Expected REVIEW_REQUEST_COMMITTED.');
  }
  return deliverTaskMonitorReviewEffect(context, event);
};

const launchRecoveryProjectionParameters = ({ context, event }: SupervisionArguments) => {
  if (event.type !== 'LAUNCH_FAILURE_REPORTED') {
    throw new Error('Expected LAUNCH_FAILURE_REPORTED.');
  }
  return projectTaskMonitorLaunchRecoveryEffect(context, event);
};

const matchesInvalidCoordinatorDecision = ({ context, event }: SupervisionArguments): boolean =>
  event.type === 'COORDINATOR_DECISION_INVALID' &&
  event.taskMonitorId === context.taskMonitorId &&
  event.agentSessionId ===
    (context.settledRun?.agentSessionId ?? context.activeRunAgentSessionId) &&
  (context.settledRun === null
    ? event.evaluation.type === 'COORDINATE_TASK_MONITOR_WORK' &&
      event.evaluation.correlationId === context.coordinationCorrelationId
    : event.runId === context.settledRun.runId &&
      event.evaluation.type === 'EVALUATE_TASK_MONITOR_SETTLED_RUN' &&
      event.evaluation.turnId === context.settledRun.turnId) &&
  (event.evaluation.correction?.attempt ?? 0) ===
    (context.coordinatorRecovery?.correctionAttempt ?? 0);

export const coordinatorInvalidTransitions = [
  {
    guard: ({ context, event }: SupervisionArguments) =>
      matchesInvalidCoordinatorDecision({ context, event }) &&
      event.type === 'COORDINATOR_DECISION_INVALID' &&
      coordinatorValidationRecovery(event.evaluation.correction?.attempt ?? 0, event.failure)
        .kind === 'CORRECT',
    actions: 'storeCoordinatorRecovery',
  },
  {
    guard: matchesInvalidCoordinatorDecision,
    target: 'OUTCOME_JUDGMENT',
    actions: [
      'storeCoordinatorRecovery',
      {
        type: 'projectTaskMonitorOutcomeJudgment',
        params: ({ context }: SupervisionArguments) =>
          projectTaskMonitorOutcomeJudgmentEffect(context),
      },
    ],
  },
] as const;

const pendingCoordinatorCorrection = {
  guard: ({ context }: SupervisionArguments) =>
    context.coordinatorRecovery?.pendingCorrection === true &&
    context.coordinatorRecovery.evaluation.type === 'EVALUATE_TASK_MONITOR_SETTLED_RUN',
  actions: [
    {
      type: 'evaluateTaskMonitorSettledRun',
      params: ({ context }: SupervisionArguments) => context.coordinatorRecovery!.evaluation,
    },
    'clearPendingCorrection',
  ],
} as const;

/** Settled-Run evaluation policy embedded in the work region. */
export const taskMonitorSupervisionStates = {
  OBSERVING_RUN: {
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
      RUN_SETTLED: {
        guard: 'matchesActiveSettledRun',
        target: 'EVALUATING_RUN',
        actions: [
          'storeSettledRun',
          { type: 'evaluateTaskMonitorSettledRun', params: evaluationParameters },
        ],
      },
    },
  },
  EVALUATING_RUN: {
    always: {
      ...pendingCoordinatorCorrection,
      guard: and(['canDeliverSettledCorrection', stateIn({ RUNNING: { control: 'ACTIVE' } })]),
    },
    on: {
      COORDINATOR_DECISION_INVALID: coordinatorInvalidTransitions,
      COORDINATOR_CORRECTION_DEFERRED: {
        guard: 'matchesTaskMonitor',
        actions: 'storeDeferredCorrection',
      },
      REVIEW_REQUEST_COMMITTED: {
        guard: 'matchesCommittedReviewRequest',
        target: 'REQUESTING_REVIEW',
        actions: [
          'storeReviewRequest',
          { type: 'deliverTaskMonitorReview', params: reviewDeliveryParameters },
        ],
      },
      SUPERVISION_CONTINUES_OBSERVING: {
        guard: 'matchesSettledRunEvaluation',
        target: 'OBSERVING_RUN',
        actions: 'storeContinuedSupervision',
      },
      COORDINATION_CONTINUES: {
        guard: 'matchesSettledRunEvaluation',
        target: 'COORDINATING',
        actions: [
          'prepareContinuedCoordination',
          { type: 'coordinateTaskMonitorWork', params: coordinationParameters },
        ],
      },
      LAUNCH_JUDGMENT_REQUIRED: {
        guard: 'matchesSettledRunEvaluation',
        target: 'LAUNCH_JUDGMENT',
        actions: 'storeFailure',
      },
      OUTCOME_JUDGMENT_REQUIRED: [
        {
          guard: ({ context, event }: SupervisionArguments) =>
            context.coordinatorRecovery != null && matchesSettledRunEvaluation({ context, event }),
          target: 'OUTCOME_JUDGMENT',
          actions: [
            'storeFailure',
            {
              type: 'projectTaskMonitorOutcomeJudgment',
              params: ({ context }: SupervisionArguments) =>
                projectTaskMonitorOutcomeJudgmentEffect(context),
            },
          ],
        },
        {
          guard: 'matchesSettledRunEvaluation',
          target: 'OUTCOME_JUDGMENT',
          actions: 'storeFailure',
        },
      ],
      SUPERVISION_HALTED: {
        guard: 'matchesSettledRunEvaluation',
        target: '#task-monitor.HALTED',
        actions: 'storeFailure',
      },
      SUPERVISION_COMPLETED: {
        guard: 'matchesSettledRunEvaluation',
        target: '#task-monitor.COMPLETED',
      },
    },
  },
  REQUESTING_REVIEW: {
    on: {
      REVIEW_REQUEST_ACCEPTED: {
        guard: 'matchesActiveReviewRequest',
        target: 'AWAITING_REVIEW',
        actions: 'storeReviewRequestAccepted',
      },
      REVIEW_REQUEST_FAILED: [
        {
          guard: ({ context, event }: SupervisionArguments) =>
            event.type === 'REVIEW_REQUEST_FAILED' &&
            matchesActiveReviewRequest({ context, event }) &&
            event.ambiguous,
          target: 'OUTCOME_JUDGMENT',
          actions: 'storeReviewRequestFailure',
        },
        {
          guard: 'matchesActiveReviewRequest',
          target: 'REVIEW_REQUEST_FAILED',
          actions: 'storeReviewRequestFailure',
        },
      ],
    },
  },
  AWAITING_REVIEW: {
    on: {
      RUN_SETTLED: {
        guard: 'matchesActiveSettledRun',
        target: 'EVALUATING_RUN',
        actions: [
          'storeSettledRun',
          'clearReviewRequest',
          { type: 'evaluateTaskMonitorSettledRun', params: evaluationParameters },
        ],
      },
    },
  },
  REVIEW_REQUEST_FAILED: {},
  OUTCOME_JUDGMENT: {
    on: {
      OUTCOME_JUDGMENT_PROJECTED: {
        guard: 'matchesRecoveryProjection',
        actions: 'storeRecoveryProjection',
      },
      OUTCOME_JUDGMENT_PROJECTION_FAILED: {
        guard: 'matchesRecoveryProjection',
        actions: 'storeRecoveryProjectionFailure',
      },
      JUDGMENT_RESOLVED: [
        {
          guard: and([
            'matchesResolvedCoordinationJudgment',
            or(['notRecoveringCoordinator', stateIn({ RUNNING: { control: 'ACTIVE' } })]),
          ]),
          target: 'COORDINATING',
          actions: [
            'clearCoordinatorRecovery',
            {
              type: 'coordinateTaskMonitorWork',
              params: resolvedCoordinationJudgmentParameters,
            },
          ],
        },
        {
          guard: and([
            'matchesResolvedJudgment',
            or(['notRecoveringCoordinator', stateIn({ RUNNING: { control: 'ACTIVE' } })]),
          ]),
          target: 'EVALUATING_RUN',
          actions: [
            'clearCoordinatorRecovery',
            {
              type: 'evaluateTaskMonitorSettledRun',
              params: resolvedJudgmentParameters,
            },
          ],
        },
      ],
    },
  },
} as const;
