import type { TaskMonitorMachineContext } from './context';
import { applyTaskMonitorDecisionEffect, projectTaskMonitorInterventionEffect } from './effects';
import type { TaskMonitorMachineEvent } from './events';

interface InterventionArguments {
  readonly context: TaskMonitorMachineContext;
  readonly event: TaskMonitorMachineEvent;
}

const timestamp = (value: string): number | null => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const canOpenExactActionIntervention = ({
  context,
  event,
}: InterventionArguments): boolean => {
  if (event.type !== 'EXACT_ACTION_REQUIRED') return false;
  const createdAt = timestamp(event.createdAt);
  const expiresAt = timestamp(event.expiresAt);
  return (
    event.taskMonitorId === context.taskMonitorId &&
    event.agentSessionId === context.activeRunAgentSessionId &&
    createdAt !== null &&
    expiresAt !== null &&
    expiresAt > createdAt
  );
};

export const matchesPendingHumanDecision = ({ context, event }: InterventionArguments): boolean => {
  const pending = context.pendingIntervention;
  if (
    event.type !== 'HUMAN_DECISION' ||
    pending === null ||
    pending.decision !== null ||
    context.settledRun !== null
  ) {
    return false;
  }

  const createdAt = timestamp(pending.createdAt);
  const expiresAt = timestamp(pending.expiresAt);
  const decidedAt = timestamp(event.decidedAt);
  const authenticatedAt = timestamp(event.human.authenticatedAt);
  return (
    event.taskMonitorId === context.taskMonitorId &&
    event.interventionId === pending.interventionId &&
    event.providerActionId === pending.providerActionId &&
    event.runId === pending.runId &&
    event.agentSessionId === pending.agentSessionId &&
    event.fingerprint === pending.fingerprint &&
    createdAt !== null &&
    expiresAt !== null &&
    decidedAt !== null &&
    authenticatedAt !== null &&
    decidedAt >= createdAt &&
    decidedAt <= expiresAt &&
    authenticatedAt >= createdAt &&
    authenticatedAt <= decidedAt
  );
};

export const matchesApplyingDecision = ({ context, event }: InterventionArguments): boolean => {
  const pending = context.pendingIntervention;
  return (
    pending !== null &&
    (event.type === 'DECISION_APPLIED' ||
      event.type === 'DECISION_APPLICATION_STALE' ||
      event.type === 'DECISION_APPLICATION_FAILED' ||
      event.type === 'DECISION_APPLICATION_CANCELLED' ||
      event.type === 'DECISION_APPLICATION_UNCERTAIN') &&
    event.taskMonitorId === context.taskMonitorId &&
    event.interventionId === pending.interventionId &&
    event.providerActionId === pending.providerActionId
  );
};

export const matchesPendingInterventionProjection = ({
  context,
  event,
}: InterventionArguments): boolean => {
  const pending = context.pendingIntervention;
  return (
    pending !== null &&
    (event.type === 'INTERVENTION_PROJECTED' || event.type === 'INTERVENTION_PROJECTION_FAILED') &&
    event.taskMonitorId === context.taskMonitorId &&
    event.interventionId === pending.interventionId &&
    event.providerActionId === pending.providerActionId
  );
};

const applicationParameters = ({ context, event }: InterventionArguments) => {
  if (event.type !== 'HUMAN_DECISION') throw new Error('Expected HUMAN_DECISION.');
  return applyTaskMonitorDecisionEffect(context, event);
};

const projectionParameters = ({ context, event }: InterventionArguments) => {
  if (event.type !== 'EXACT_ACTION_REQUIRED') throw new Error('Expected EXACT_ACTION_REQUIRED.');
  return projectTaskMonitorInterventionEffect(context, event);
};

/** Independent intervention-region policy composed by the Task Monitor machine. */
export const taskMonitorInterventionStates = {
  initial: 'CLEAR',
  states: {
    CLEAR: {
      on: {
        EXACT_ACTION_REQUIRED: {
          guard: 'canOpenExactActionIntervention',
          target: 'PENDING',
          actions: [
            'storePendingIntervention',
            { type: 'projectTaskMonitorIntervention', params: projectionParameters },
          ],
        },
      },
    },
    PENDING: {
      on: {
        INTERVENTION_PROJECTED: {
          guard: 'matchesPendingInterventionProjection',
        },
        INTERVENTION_PROJECTION_FAILED: {
          guard: 'matchesPendingInterventionProjection',
          actions: 'storeInterventionApplicationFailure',
        },
        HUMAN_DECISION: {
          guard: 'matchesPendingHumanDecision',
          target: 'APPLYING_DECISION',
          actions: [
            'storeInterventionDecision',
            { type: 'applyTaskMonitorDecision', params: applicationParameters },
          ],
        },
      },
    },
    APPLYING_DECISION: {
      on: {
        DECISION_APPLIED: {
          guard: 'matchesApplyingDecision',
          target: 'CLEAR',
          actions: 'clearPendingIntervention',
        },
        DECISION_APPLICATION_FAILED: {
          guard: 'matchesApplyingDecision',
          target: 'APPLICATION_FAILED',
          actions: 'storeInterventionApplicationFailure',
        },
        DECISION_APPLICATION_STALE: {
          guard: 'matchesApplyingDecision',
          target: 'APPLICATION_STALE',
          actions: 'storeInterventionApplicationFailure',
        },
        DECISION_APPLICATION_CANCELLED: {
          guard: 'matchesApplyingDecision',
          target: 'APPLICATION_CANCELLED',
          actions: 'storeInterventionApplicationFailure',
        },
        DECISION_APPLICATION_UNCERTAIN: {
          guard: 'matchesApplyingDecision',
          target: 'APPLICATION_UNCERTAIN',
          actions: 'storeInterventionApplicationFailure',
        },
      },
    },
    APPLICATION_FAILED: {},
    APPLICATION_STALE: {},
    APPLICATION_CANCELLED: {},
    APPLICATION_UNCERTAIN: {},
  },
} as const;
