import { and, not, or, stateIn } from 'xstate';
import type {
  TaskMonitorMachineContext,
  TaskMonitorPendingIntervention,
  TaskMonitorQueuedIntervention,
} from './context';
import {
  applyTaskMonitorDecisionEffect,
  decideTaskMonitorPermissionEffect,
  projectTaskMonitorInterventionEffect,
  recordTaskMonitorPermissionDecisionEffect,
} from './effects';
import type { TaskMonitorMachineEvent } from './events';

interface InterventionArguments {
  readonly context: TaskMonitorMachineContext;
  readonly event: TaskMonitorMachineEvent;
}

const timestamp = (value: string | null): number | null => {
  if (value === null) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const canOpenExactActionIntervention = ({
  context,
  event,
}: InterventionArguments): boolean => {
  if (event.type !== 'EXACT_ACTION_REQUIRED') return false;
  return (
    event.taskMonitorId === context.taskMonitorId &&
    event.agentSessionId === context.activeRunAgentSessionId &&
    timestamp(event.createdAt) !== null
  );
};

export const canOpenMonitorOwnedIntervention = (arguments_: InterventionArguments): boolean =>
  canOpenExactActionIntervention(arguments_) &&
  arguments_.event.type === 'EXACT_ACTION_REQUIRED' &&
  arguments_.event.userRequired !== true;

export const canOpenUserRequiredIntervention = (arguments_: InterventionArguments): boolean =>
  canOpenExactActionIntervention(arguments_) &&
  arguments_.event.type === 'EXACT_ACTION_REQUIRED' &&
  arguments_.event.userRequired === true;

/** A request stays open until it is answered: a decision only has to follow its creation. */
const isDecidedAfterCreation = (
  pending: TaskMonitorPendingIntervention,
  decidedAtValue: string,
): boolean => {
  const createdAt = timestamp(pending.createdAt);
  const decidedAt = timestamp(decidedAtValue);

  return createdAt !== null && decidedAt !== null && decidedAt >= createdAt;
};

export const queuedInterventions = (
  context: TaskMonitorMachineContext,
): readonly TaskMonitorQueuedIntervention[] => context.queuedInterventions ?? [];

const nextQueuedIntervention = (
  context: TaskMonitorMachineContext,
): TaskMonitorQueuedIntervention | null => queuedInterventions(context)[0] ?? null;

export const pendingInterventionFromRequest = (
  request: TaskMonitorQueuedIntervention,
): TaskMonitorPendingIntervention => ({
  interventionId: request.interventionId,
  providerActionId: request.providerActionId,
  providerSessionId: request.providerSessionId,
  runId: request.runId,
  agentSessionId: request.agentSessionId,
  action: request.action,
  target: request.target,
  fingerprint: request.fingerprint,
  createdAt: request.createdAt,
  expiresAt: request.expiresAt,
  userRequired: request.userRequired === true,
  ...(request.requestKind ? { requestKind: request.requestKind } : {}),
  owner: request.userRequired === true ? 'HUMAN' : 'MONITOR',
  escalationReason:
    request.userRequired === true
      ? 'The request is marked USER_REQUIRED, so only a person can decide it.'
      : null,
  escalatedAt: request.userRequired === true ? request.createdAt : null,
  decision: null,
  applicationFailure: null,
});

/** A distinct request arriving while another is being decided waits behind it, once. */
export const canQueueExactActionIntervention = (arguments_: InterventionArguments): boolean => {
  const { context, event } = arguments_;
  if (!canOpenExactActionIntervention(arguments_) || event.type !== 'EXACT_ACTION_REQUIRED') {
    return false;
  }

  const known = [context.pendingIntervention, ...queuedInterventions(context)];
  return !known.some(
    (request) =>
      request !== null &&
      (request.interventionId === event.interventionId ||
        request.providerActionId === event.providerActionId),
  );
};

export const isServiceScopeExactAction = ({ event }: InterventionArguments): boolean =>
  event.type === 'EXACT_ACTION_REQUIRED' && event.requestKind === 'SERVICE_SCOPE';

export const nextQueuedIsServiceScope = ({ context }: InterventionArguments): boolean =>
  nextQueuedIntervention(context)?.requestKind === 'SERVICE_SCOPE';

/**
 * A paused monitor decides nothing: a Service scope request it is given goes to the person on the
 * card already shown. Other request kinds keep their existing admission.
 */
const monitorMayDecideServiceScope = (
  isServiceScope: 'isServiceScopeExactAction' | 'nextQueuedIsServiceScope',
) => or([not(isServiceScope), stateIn({ RUNNING: { control: 'ACTIVE' } })]);

export const hasQueuedMonitorOwnedIntervention = ({ context }: InterventionArguments): boolean =>
  context.pendingIntervention === null &&
  nextQueuedIntervention(context) !== null &&
  nextQueuedIntervention(context)?.userRequired !== true;

export const hasQueuedUserRequiredIntervention = ({ context }: InterventionArguments): boolean =>
  context.pendingIntervention === null && nextQueuedIntervention(context)?.userRequired === true;

const matchesMonitorPermissionOutcome = ({ context, event }: InterventionArguments): boolean => {
  const pending = context.pendingIntervention;
  return (
    pending !== null &&
    pending.decision === null &&
    pending.owner === 'MONITOR' &&
    pending.userRequired !== true &&
    context.settledRun === null &&
    (event.type === 'MONITOR_PERMISSION_DECIDED' ||
      event.type === 'MONITOR_PERMISSION_ESCALATED') &&
    event.taskMonitorId === context.taskMonitorId &&
    event.interventionId === pending.interventionId &&
    event.providerActionId === pending.providerActionId
  );
};

/** The monitor may only decide a request it still owns and that is not USER_REQUIRED. */
export const matchesPendingMonitorDecision = ({ context, event }: InterventionArguments): boolean =>
  event.type === 'MONITOR_PERMISSION_DECIDED' &&
  matchesMonitorPermissionOutcome({ context, event }) &&
  event.fingerprint === context.pendingIntervention?.fingerprint;

/**
 * Stopping the monitor leaves the Running state that answers requests, so a provider request it
 * still holds would have no answerer. The Run already owns a Service scope request's card, and its
 * wait is handed over when the decision turn ends, so only provider permission requests move here.
 */
export const hasMonitorHeldProviderRequest = ({ context }: InterventionArguments): boolean => {
  const pending = context.pendingIntervention;
  return (
    pending !== null &&
    pending.decision === null &&
    pending.owner === 'MONITOR' &&
    pending.requestKind !== 'SERVICE_SCOPE'
  );
};

export const stopProjectionParameters = ({ context }: InterventionArguments) => {
  const pending = context.pendingIntervention;
  if (pending === null) {
    throw new Error('Expected a pending request to hand to a person on stop.');
  }

  return projectTaskMonitorInterventionEffect(context, pending);
};

export const matchesPendingMonitorEscalation = (arguments_: InterventionArguments): boolean =>
  arguments_.event.type === 'MONITOR_PERMISSION_ESCALATED' &&
  matchesMonitorPermissionOutcome(arguments_);

/**
 * A Service scope request is already shown to the person on the Run-owned card, so an escalation
 * only hands the Run's wait to them; the machine drops its copy instead of projecting a second one.
 */
export const matchesPendingServiceScopeEscalation = (arguments_: InterventionArguments): boolean =>
  matchesPendingMonitorEscalation(arguments_) &&
  arguments_.context.pendingIntervention?.requestKind === 'SERVICE_SCOPE';

/** A Service scope decision the Run could not finish applying goes back to the person, who retries on the card. */
export const matchesFailedServiceScopeApplication = (arguments_: InterventionArguments): boolean =>
  arguments_.event.type === 'DECISION_APPLICATION_FAILED' &&
  matchesApplyingDecision(arguments_) &&
  arguments_.context.pendingIntervention?.requestKind === 'SERVICE_SCOPE';

export const matchesPendingHumanDecision = ({ context, event }: InterventionArguments): boolean => {
  const pending = context.pendingIntervention;
  if (
    event.type !== 'HUMAN_DECISION' ||
    pending === null ||
    pending.decision !== null ||
    pending.owner === 'MONITOR' ||
    context.settledRun !== null
  ) {
    return false;
  }

  const createdAt = timestamp(pending.createdAt);
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
    decidedAt !== null &&
    authenticatedAt !== null &&
    isDecidedAfterCreation(pending, event.decidedAt) &&
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
  if (event.type !== 'HUMAN_DECISION' && event.type !== 'MONITOR_PERMISSION_DECIDED') {
    throw new Error('Expected a decision event.');
  }
  return applyTaskMonitorDecisionEffect(context, event);
};

const projectionParameters = ({ context, event }: InterventionArguments) => {
  if (event.type === 'EXACT_ACTION_REQUIRED') {
    return projectTaskMonitorInterventionEffect(context, event);
  }
  const pending = context.pendingIntervention;
  if (event.type !== 'MONITOR_PERMISSION_ESCALATED' || pending === null) {
    throw new Error('Expected EXACT_ACTION_REQUIRED or MONITOR_PERMISSION_ESCALATED.');
  }
  return projectTaskMonitorInterventionEffect(context, pending);
};

const decisionRequestParameters = ({ context, event }: InterventionArguments) => {
  if (event.type !== 'EXACT_ACTION_REQUIRED') throw new Error('Expected EXACT_ACTION_REQUIRED.');
  return decideTaskMonitorPermissionEffect(context, event);
};

const queuedDecisionRequestParameters = ({ context }: InterventionArguments) => {
  const next = nextQueuedIntervention(context);
  if (next === null) throw new Error('Expected a queued request.');
  return decideTaskMonitorPermissionEffect(context, next);
};

const pausedQueuedDecisionRequestParameters = ({ context }: InterventionArguments) => {
  const next = nextQueuedIntervention(context);
  if (next === null) throw new Error('Expected a queued request.');
  return decideTaskMonitorPermissionEffect(context, next, { monitorPaused: true });
};

const queuedProjectionParameters = ({ context }: InterventionArguments) => {
  const next = nextQueuedIntervention(context);
  if (next === null) throw new Error('Expected a queued request.');
  return projectTaskMonitorInterventionEffect(context, next);
};

const recordParameters = ({ context, event }: InterventionArguments) => {
  if (
    event.type !== 'MONITOR_PERMISSION_DECIDED' &&
    event.type !== 'MONITOR_PERMISSION_ESCALATED'
  ) {
    throw new Error('Expected a monitor permission outcome.');
  }
  return recordTaskMonitorPermissionDecisionEffect(context, event);
};

/** Independent intervention-region policy composed by the Task Monitor machine. */
export const taskMonitorInterventionStates = {
  initial: 'CLEAR',
  states: {
    CLEAR: {
      // The next queued request opens once the previous one is answered.
      always: [
        {
          guard: and([
            'hasQueuedMonitorOwnedIntervention',
            monitorMayDecideServiceScope('nextQueuedIsServiceScope'),
          ]),
          target: 'PENDING',
          actions: [
            { type: 'decideTaskMonitorPermission', params: queuedDecisionRequestParameters },
            'promoteQueuedIntervention',
          ],
        },
        // A Service scope request queued while the monitor was active may reach the front after it
        // was paused. The monitor is not asked: the request is handed to the person's card.
        {
          guard: 'hasQueuedMonitorOwnedIntervention',
          target: 'PENDING',
          actions: [
            { type: 'decideTaskMonitorPermission', params: pausedQueuedDecisionRequestParameters },
            'promoteQueuedIntervention',
          ],
        },
        {
          guard: 'hasQueuedUserRequiredIntervention',
          target: 'PENDING',
          actions: [
            { type: 'projectTaskMonitorIntervention', params: queuedProjectionParameters },
            'promoteQueuedIntervention',
          ],
        },
      ],
      on: {
        // Every request reaches the monitor first; only USER_REQUIRED goes straight to the human.
        EXACT_ACTION_REQUIRED: [
          {
            guard: and([
              'canOpenMonitorOwnedIntervention',
              monitorMayDecideServiceScope('isServiceScopeExactAction'),
            ]),
            target: 'PENDING',
            actions: [
              'storePendingIntervention',
              { type: 'decideTaskMonitorPermission', params: decisionRequestParameters },
            ],
          },
          {
            guard: 'canOpenUserRequiredIntervention',
            target: 'PENDING',
            actions: [
              'storePendingIntervention',
              { type: 'projectTaskMonitorIntervention', params: projectionParameters },
            ],
          },
        ],
      },
    },
    PENDING: {
      on: {
        EXACT_ACTION_REQUIRED: {
          guard: 'canQueueExactActionIntervention',
          actions: 'queueExactActionIntervention',
        },
        INTERVENTION_PROJECTED: {
          guard: 'matchesPendingInterventionProjection',
        },
        INTERVENTION_PROJECTION_FAILED: {
          guard: 'matchesPendingInterventionProjection',
          actions: 'storeInterventionApplicationFailure',
        },
        MONITOR_PERMISSION_DECIDED: {
          guard: 'matchesPendingMonitorDecision',
          target: 'APPLYING_DECISION',
          actions: [
            'storeMonitorInterventionDecision',
            { type: 'recordTaskMonitorPermissionDecision', params: recordParameters },
            { type: 'applyTaskMonitorDecision', params: applicationParameters },
          ],
        },
        MONITOR_PERMISSION_ESCALATED: [
          {
            guard: 'matchesPendingServiceScopeEscalation',
            target: 'CLEAR',
            actions: [
              { type: 'recordTaskMonitorPermissionDecision', params: recordParameters },
              'clearPendingIntervention',
            ],
          },
          {
            guard: 'matchesPendingMonitorEscalation',
            actions: [
              'storeInterventionEscalation',
              { type: 'recordTaskMonitorPermissionDecision', params: recordParameters },
              { type: 'projectTaskMonitorIntervention', params: projectionParameters },
            ],
          },
        ],
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
        EXACT_ACTION_REQUIRED: {
          guard: 'canQueueExactActionIntervention',
          actions: 'queueExactActionIntervention',
        },
        DECISION_APPLIED: {
          guard: 'matchesApplyingDecision',
          target: 'CLEAR',
          actions: 'clearPendingIntervention',
        },
        DECISION_APPLICATION_FAILED: [
          {
            guard: 'matchesFailedServiceScopeApplication',
            target: 'CLEAR',
            actions: 'clearPendingIntervention',
          },
          {
            guard: 'matchesApplyingDecision',
            target: 'APPLICATION_FAILED',
            actions: 'storeInterventionApplicationFailure',
          },
        ],
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
