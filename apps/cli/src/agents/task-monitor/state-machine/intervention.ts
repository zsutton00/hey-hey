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
  watchTaskMonitorPermissionDeadlineEffect,
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
  owner: request.userRequired === true ? 'HUMAN' : (request.owner ?? 'MONITOR'),
  escalationReason:
    request.userRequired === true
      ? 'The request is marked USER_REQUIRED, so only a person can decide it.'
      : (request.escalationReason ?? null),
  escalatedAt: request.userRequired === true ? request.createdAt : (request.escalatedAt ?? null),
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

export const isMonitorOwnedExactAction = ({ event }: InterventionArguments): boolean =>
  event.type === 'EXACT_ACTION_REQUIRED' && event.userRequired !== true;

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

const isHumanHeldQueued = (request: TaskMonitorQueuedIntervention): boolean =>
  request.userRequired !== true && request.owner === 'HUMAN';

export const hasQueuedMonitorOwnedIntervention = ({ context }: InterventionArguments): boolean => {
  const next = nextQueuedIntervention(context);
  return (
    context.pendingIntervention === null &&
    next !== null &&
    next.userRequired !== true &&
    !isHumanHeldQueued(next)
  );
};

/** A queued request already handed to a person is shown to them, so reaching the front asks nothing more. */
export const hasQueuedHumanHeldIntervention = ({ context }: InterventionArguments): boolean => {
  const next = nextQueuedIntervention(context);
  return context.pendingIntervention === null && next !== null && isHumanHeldQueued(next);
};

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

export const STOP_ESCALATION_REASON =
  'The Task Monitor was stopped, so this request is waiting for a person.';

const isMonitorHeldProviderRequest = (
  request: Pick<TaskMonitorQueuedIntervention, 'owner' | 'userRequired' | 'requestKind'>,
): boolean =>
  request.userRequired !== true &&
  request.owner !== 'HUMAN' &&
  request.requestKind !== 'SERVICE_SCOPE';

/**
 * Stopping the monitor leaves the Running state that answers requests, so every provider request it
 * still holds, the front one and those queued behind it, would have no answerer. The Run already
 * owns a Service scope request's card, and its wait is handed over when the decision turn ends, so
 * only provider permission requests move here.
 */
export const monitorHeldRequestsOnStop = (
  context: TaskMonitorMachineContext,
): readonly (TaskMonitorPendingIntervention | TaskMonitorQueuedIntervention)[] => {
  const pending = context.pendingIntervention;
  const front =
    pending !== null && pending.decision === null && isMonitorHeldProviderRequest(pending)
      ? [pending]
      : [];

  return [...front, ...queuedInterventions(context).filter(isMonitorHeldProviderRequest)];
};

export const hasMonitorHeldProviderRequest = ({ context }: InterventionArguments): boolean =>
  monitorHeldRequestsOnStop(context).length > 0;

/** One projection hands over every request the stop moves to the person, each on its own card. */
export const stopProjectionParameters = ({ context }: InterventionArguments) => {
  const [first, ...rest] = monitorHeldRequestsOnStop(context);
  if (first === undefined) {
    throw new Error('Expected a request to hand to a person on stop.');
  }

  return projectTaskMonitorInterventionEffect(context, first, rest);
};

export const handQueuedRequestsToHumanOnStop = (
  context: TaskMonitorMachineContext,
): readonly TaskMonitorQueuedIntervention[] =>
  queuedInterventions(context).map((request) =>
    isMonitorHeldProviderRequest(request)
      ? {
          ...request,
          owner: 'HUMAN' as const,
          escalationReason: STOP_ESCALATION_REASON,
          escalatedAt: null,
        }
      : request,
  );

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

const humanDecisionMatches = (
  { context, event }: InterventionArguments,
  candidate: TaskMonitorPendingIntervention,
): boolean => {
  if (event.type !== 'HUMAN_DECISION' || context.settledRun !== null) {
    return false;
  }

  const createdAt = timestamp(candidate.createdAt);
  const decidedAt = timestamp(event.decidedAt);
  const authenticatedAt = timestamp(event.human.authenticatedAt);
  return (
    event.taskMonitorId === context.taskMonitorId &&
    event.interventionId === candidate.interventionId &&
    event.providerActionId === candidate.providerActionId &&
    event.runId === candidate.runId &&
    event.agentSessionId === candidate.agentSessionId &&
    event.fingerprint === candidate.fingerprint &&
    createdAt !== null &&
    decidedAt !== null &&
    authenticatedAt !== null &&
    isDecidedAfterCreation(candidate, event.decidedAt) &&
    authenticatedAt >= createdAt &&
    authenticatedAt <= decidedAt
  );
};

export const matchesPendingHumanDecision = (arguments_: InterventionArguments): boolean => {
  const pending = arguments_.context.pendingIntervention;
  if (pending === null || pending.decision !== null || pending.owner === 'MONITOR') {
    return false;
  }

  return humanDecisionMatches(arguments_, pending);
};

const queuedHumanHeldFor = ({
  context,
  event,
}: InterventionArguments): TaskMonitorQueuedIntervention | null => {
  if (event.type !== 'HUMAN_DECISION') {
    return null;
  }

  return (
    queuedInterventions(context).find(
      (request) =>
        isHumanHeldQueued(request) &&
        request.interventionId === event.interventionId &&
        request.providerActionId === event.providerActionId,
    ) ?? null
  );
};

export const matchesQueuedHumanDecision = (arguments_: InterventionArguments): boolean => {
  const pending = arguments_.context.pendingIntervention;
  const queued = queuedHumanHeldFor(arguments_);
  if (pending === null || pending.decision !== null || queued === null) {
    return false;
  }

  return humanDecisionMatches(arguments_, pendingInterventionFromRequest(queued));
};

const matchingQueuedMonitorHeld = ({
  context,
  event,
}: InterventionArguments): TaskMonitorQueuedIntervention | null => {
  if (
    event.type !== 'MONITOR_PERMISSION_ESCALATED' ||
    event.taskMonitorId !== context.taskMonitorId ||
    context.settledRun !== null
  ) {
    return null;
  }

  return (
    queuedInterventions(context).find(
      (request) =>
        request.userRequired !== true &&
        !isHumanHeldQueued(request) &&
        request.interventionId === event.interventionId &&
        request.providerActionId === event.providerActionId,
    ) ?? null
  );
};

/** A queued request the monitor never got to decide reaches its due time and goes to the person. */
export const matchesQueuedMonitorEscalation = (arguments_: InterventionArguments): boolean =>
  matchingQueuedMonitorHeld(arguments_) !== null;

/** The Run already shows a Service scope request to the person, so the machine only drops its copy. */
export const matchesQueuedServiceScopeEscalation = (arguments_: InterventionArguments): boolean =>
  matchingQueuedMonitorHeld(arguments_)?.requestKind === 'SERVICE_SCOPE';

const withoutQueued = (
  context: TaskMonitorMachineContext,
  request: TaskMonitorQueuedIntervention,
): readonly TaskMonitorQueuedIntervention[] =>
  queuedInterventions(context).filter((queued) => queued.interventionId !== request.interventionId);

export const escalateQueuedRequest = (arguments_: InterventionArguments) => {
  const { context, event } = arguments_;
  const request = matchingQueuedMonitorHeld(arguments_);
  if (request === null || event.type !== 'MONITOR_PERMISSION_ESCALATED') {
    return {};
  }

  return {
    queuedInterventions: queuedInterventions(context).map((queued) =>
      queued.interventionId === request.interventionId
        ? {
            ...queued,
            owner: 'HUMAN' as const,
            escalationReason: event.reason,
            escalatedAt: event.escalatedAt ?? null,
          }
        : queued,
    ),
  };
};

export const dropQueuedRequest = (arguments_: InterventionArguments) => {
  const request = matchingQueuedMonitorHeld(arguments_);

  return request === null
    ? {}
    : { queuedInterventions: withoutQueued(arguments_.context, request) };
};

const queuedFromPending = (
  pending: TaskMonitorPendingIntervention,
): TaskMonitorQueuedIntervention => ({
  interventionId: pending.interventionId,
  providerActionId: pending.providerActionId,
  providerSessionId: pending.providerSessionId,
  runId: pending.runId,
  agentSessionId: pending.agentSessionId,
  action: pending.action,
  target: pending.target,
  fingerprint: pending.fingerprint,
  createdAt: pending.createdAt,
  expiresAt: pending.expiresAt,
  userRequired: pending.userRequired === true,
  ...(pending.requestKind ? { requestKind: pending.requestKind } : {}),
  owner: pending.owner ?? 'HUMAN',
  escalationReason: pending.escalationReason ?? null,
  escalatedAt: pending.escalatedAt ?? null,
});

/** The answered request becomes the front one; the request it displaces goes first in the queue. */
export const swapInAnsweredQueuedRequest = (arguments_: InterventionArguments) => {
  const { context } = arguments_;
  const queued = queuedHumanHeldFor(arguments_);
  const pending = context.pendingIntervention;
  if (queued === null || pending === null) {
    return {};
  }

  return {
    pendingIntervention: pendingInterventionFromRequest(queued),
    queuedInterventions: [queuedFromPending(pending), ...withoutQueued(context, queued)],
  };
};

/** Enough undelivered records to explain recent failures without growing the state forever. */
const UNDELIVERED_RECORD_LIMIT = 50;

/**
 * A decided request whose answer could not be delivered stays settled with its decision and its
 * specific delivery outcome, so it is never delivered again. It leaves the front, so the requests
 * behind it can still be decided and answered.
 */
export const retireUndeliveredIntervention = ({ context }: InterventionArguments) => {
  const pending = context.pendingIntervention;
  if (pending === null) {
    return {};
  }

  return {
    pendingIntervention: null,
    undeliveredInterventions: [...(context.undeliveredInterventions ?? []), pending].slice(
      -UNDELIVERED_RECORD_LIMIT,
    ),
  };
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

const watchOpenedParameters = ({ context, event }: InterventionArguments) => {
  if (event.type !== 'EXACT_ACTION_REQUIRED') throw new Error('Expected EXACT_ACTION_REQUIRED.');
  return watchTaskMonitorPermissionDeadlineEffect(context, event);
};

const queuedEscalationRecordParameters = (arguments_: InterventionArguments) => {
  const { context, event } = arguments_;
  if (event.type !== 'MONITOR_PERMISSION_ESCALATED') {
    throw new Error('Expected MONITOR_PERMISSION_ESCALATED.');
  }

  return recordTaskMonitorPermissionDecisionEffect(
    context,
    event,
    matchingQueuedMonitorHeld(arguments_),
  );
};

const queuedEscalationProjectionParameters = (arguments_: InterventionArguments) => {
  const request = matchingQueuedMonitorHeld(arguments_);
  if (request === null) {
    throw new Error('Expected a queued request to hand to a person.');
  }

  return projectTaskMonitorInterventionEffect(arguments_.context, request);
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

/** A request the monitor holds is watched from the moment it is admitted, even while it is queued. */
const queueExactAction = [
  {
    guard: and(['canQueueExactActionIntervention', 'isMonitorOwnedExactAction']),
    actions: [
      'queueExactActionIntervention',
      { type: 'watchTaskMonitorPermissionDeadline', params: watchOpenedParameters },
    ],
  },
  { guard: 'canQueueExactActionIntervention', actions: 'queueExactActionIntervention' },
] as const;

/** A queued request reaches its due time wherever the front request is, so every state accepts it. */
const escalateQueuedRequestTransitions = [
  {
    guard: 'matchesQueuedServiceScopeEscalation',
    actions: [
      { type: 'recordTaskMonitorPermissionDecision', params: queuedEscalationRecordParameters },
      'dropQueuedRequest',
    ],
  },
  {
    guard: 'matchesQueuedMonitorEscalation',
    actions: [
      { type: 'recordTaskMonitorPermissionDecision', params: queuedEscalationRecordParameters },
      {
        type: 'projectTaskMonitorIntervention',
        params: queuedEscalationProjectionParameters,
      },
      'escalateQueuedRequest',
    ],
  },
] as const;

/** Keeps the undelivered request's specific outcome, then frees the front for the next request. */
const retireUndelivered = [
  'storeInterventionApplicationFailure',
  'retireUndeliveredIntervention',
  'promoteQueuedIntervention',
] as const;

/** In the Running region CLEAR promotes the next request itself. */
const undeliveredToClear = [
  'storeInterventionApplicationFailure',
  'retireUndeliveredIntervention',
] as const;

/**
 * A stopped monitor has no intervention region, but a request it handed to a person is still
 * answered through the machine: the answer is recorded before it reaches the provider, so the first
 * answer settles the request and a second one is refused instead of being delivered again.
 */
export const taskMonitorHaltedInterventionEvents = {
  HUMAN_DECISION: [
    {
      guard: 'matchesPendingHumanDecision',
      actions: [
        'storeInterventionDecision',
        { type: 'applyTaskMonitorDecision', params: applicationParameters },
      ],
    },
    {
      guard: 'matchesQueuedHumanDecision',
      actions: [
        'swapInAnsweredQueuedRequest',
        'storeInterventionDecision',
        { type: 'applyTaskMonitorDecision', params: applicationParameters },
      ],
    },
  ],
  DECISION_APPLIED: {
    guard: 'matchesApplyingDecision',
    actions: ['clearPendingIntervention', 'promoteQueuedIntervention'],
  },
  DECISION_APPLICATION_FAILED: { guard: 'matchesApplyingDecision', actions: retireUndelivered },
  DECISION_APPLICATION_STALE: { guard: 'matchesApplyingDecision', actions: retireUndelivered },
  DECISION_APPLICATION_CANCELLED: { guard: 'matchesApplyingDecision', actions: retireUndelivered },
  DECISION_APPLICATION_UNCERTAIN: { guard: 'matchesApplyingDecision', actions: retireUndelivered },
} as const;

/**
 * Earlier state parked an undelivered request at the front in one of these states, which left the
 * requests behind it unanswerable. Such state now retires the request at once and moves on.
 */
const retiredOnEntry = {
  always: { target: 'CLEAR', actions: 'retireUndeliveredIntervention' },
} as const;

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
        // Already handed to a person and shown to them, so promotion only makes it the front request.
        {
          guard: 'hasQueuedHumanHeldIntervention',
          target: 'PENDING',
          actions: 'promoteQueuedIntervention',
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
              { type: 'watchTaskMonitorPermissionDeadline', params: watchOpenedParameters },
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
        EXACT_ACTION_REQUIRED: queueExactAction,
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
          ...escalateQueuedRequestTransitions,
        ],
        HUMAN_DECISION: [
          {
            guard: 'matchesPendingHumanDecision',
            target: 'APPLYING_DECISION',
            actions: [
              'storeInterventionDecision',
              { type: 'applyTaskMonitorDecision', params: applicationParameters },
            ],
          },
          {
            guard: 'matchesQueuedHumanDecision',
            target: 'APPLYING_DECISION',
            actions: [
              'swapInAnsweredQueuedRequest',
              'storeInterventionDecision',
              { type: 'applyTaskMonitorDecision', params: applicationParameters },
            ],
          },
        ],
      },
    },
    APPLYING_DECISION: {
      on: {
        EXACT_ACTION_REQUIRED: queueExactAction,
        MONITOR_PERMISSION_ESCALATED: escalateQueuedRequestTransitions,
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
          { guard: 'matchesApplyingDecision', target: 'CLEAR', actions: undeliveredToClear },
        ],
        DECISION_APPLICATION_STALE: {
          guard: 'matchesApplyingDecision',
          target: 'CLEAR',
          actions: undeliveredToClear,
        },
        DECISION_APPLICATION_CANCELLED: {
          guard: 'matchesApplyingDecision',
          target: 'CLEAR',
          actions: undeliveredToClear,
        },
        // An uncertain delivery may have reached the provider, so it is never sent again.
        DECISION_APPLICATION_UNCERTAIN: {
          guard: 'matchesApplyingDecision',
          target: 'CLEAR',
          actions: undeliveredToClear,
        },
      },
    },
    APPLICATION_FAILED: retiredOnEntry,
    APPLICATION_STALE: retiredOnEntry,
    APPLICATION_CANCELLED: retiredOnEntry,
    APPLICATION_UNCERTAIN: retiredOnEntry,
  },
} as const;
