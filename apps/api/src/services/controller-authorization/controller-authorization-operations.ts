import {
  ControllerAuthorizationCadence,
  ControllerDeviceGrantCadence,
  CurrentAgentOperation,
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
} from '@hey-hey/contracts/api/models';
import {
  ControllerAuthorizationCadence as PrismaControllerAuthorizationCadence,
  HostAffectingActionType as PrismaHostAffectingActionType,
  Prisma,
} from '@prisma/client';

export const CONTROLLER_DEVICE_POLICY_REVISION = 1;
export const CONTROLLER_DEVICE_GRANT_TTL_MS = {
  FIVE_MINUTES: 5 * 60 * 1000,
  EIGHT_HOURS: 8 * 60 * 60 * 1000,
  ONE_DAY: 24 * 60 * 60 * 1000,
  ONE_WEEK: 7 * 24 * 60 * 60 * 1000,
  ONE_MONTH: 30 * 24 * 60 * 60 * 1000,
} as const satisfies Record<ControllerAuthorizationCadence, number>;

/** The bounded cadences a browser authorization request may select. */
export function toControllerAuthorizationCadence(
  cadence: PrismaControllerAuthorizationCadence,
): ControllerAuthorizationCadence | null {
  switch (cadence) {
    case PrismaControllerAuthorizationCadence.FIVE_MINUTES:
      return ControllerAuthorizationCadence.FiveMinutes;
    case PrismaControllerAuthorizationCadence.EIGHT_HOURS:
      return ControllerAuthorizationCadence.EightHours;
    case PrismaControllerAuthorizationCadence.ONE_DAY:
      return ControllerAuthorizationCadence.OneDay;
    case PrismaControllerAuthorizationCadence.ONE_WEEK:
      return ControllerAuthorizationCadence.OneWeek;
    case PrismaControllerAuthorizationCadence.ONE_MONTH:
      return ControllerAuthorizationCadence.OneMonth;
    case PrismaControllerAuthorizationCadence.UNTIL_REVOKED:
    case PrismaControllerAuthorizationCadence.EVERY_ACTION:
    case PrismaControllerAuthorizationCadence.CURRENT_BROWSER_SESSION:
      return null;
  }
}

/** Every cadence an issued controller-device grant may carry. */
export function toControllerDeviceGrantCadence(
  cadence: PrismaControllerAuthorizationCadence,
): ControllerDeviceGrantCadence | null {
  if (cadence === PrismaControllerAuthorizationCadence.UNTIL_REVOKED) {
    return ControllerDeviceGrantCadence.UntilRevoked;
  }
  return toControllerAuthorizationCadence(cadence);
}

export const CURRENT_AGENT_OPERATIONS = [
  CurrentAgentOperation.ConversationTrigger,
  CurrentAgentOperation.PlatformEventTrigger,
  CurrentAgentOperation.ConversationControlCompactRun,
  CurrentAgentOperation.ConversationControlPermissionDecision,
  CurrentAgentOperation.TaskMonitorStart,
  CurrentAgentOperation.TaskMonitorResume,
  CurrentAgentOperation.TaskMonitorJudgmentResolved,
  CurrentAgentOperation.TaskMonitorContinue,
  CurrentAgentOperation.TaskMonitorComplete,
  CurrentAgentOperation.CliRead,
  CurrentAgentOperation.ApplicationEffectLaunch,
  CurrentAgentOperation.ExactActionDelivery,
] as const satisfies readonly CurrentAgentOperation[];

export const PRISMA_CURRENT_AGENT_OPERATIONS = CURRENT_AGENT_OPERATIONS.map(
  (action) => PrismaHostAffectingActionType[action],
);

const CURRENT_AGENT_OPERATION_SET = new Set<string>(CURRENT_AGENT_OPERATIONS);

export function isCurrentAgentOperation(
  actionType: HostAffectingActionType,
): actionType is CurrentAgentOperation {
  return CURRENT_AGENT_OPERATION_SET.has(actionType);
}

export function getControllerDeviceGrantExpiry(
  issuedAt: Date,
  cadence: ControllerAuthorizationCadence,
): Date {
  return new Date(issuedAt.getTime() + CONTROLLER_DEVICE_GRANT_TTL_MS[cadence]);
}

/** The expiry a grant of this cadence carries; null for UNTIL_REVOKED. */
export function getControllerDeviceGrantWindowExpiry(
  issuedAt: Date,
  cadence: ControllerDeviceGrantCadence,
): Date | null {
  if (cadence === ControllerDeviceGrantCadence.UntilRevoked) {
    return null;
  }
  return getControllerDeviceGrantExpiry(issuedAt, cadence);
}

/** A grant with no expiry never expires; revocation is its only bound. */
export function isExecutionGrantExpired(
  expiresAt: Date | null,
  nowMs: number,
): boolean {
  return expiresAt !== null && expiresAt.getTime() <= nowMs;
}

/** Prisma filter for grants that have not expired; a null expiry never does. */
export function executionGrantNotExpired(
  now: Date,
): Prisma.ExecutionGrantWhereInput {
  return { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
}

export function executionGrantExpiryEquals(
  actual: Date | null,
  expected: Date | null,
): boolean {
  return actual?.getTime() === expected?.getTime();
}

export const ACTION_BINDINGS: Record<
  HostAffectingActionType,
  { category: HostActionCategory; targetKind: HostActionTargetKind }
> = {
  CONVERSATION_TRIGGER: {
    category: HostActionCategory.Conversation,
    targetKind: HostActionTargetKind.AgentSession,
  },
  PLATFORM_EVENT_TRIGGER: {
    category: HostActionCategory.PlatformEvent,
    targetKind: HostActionTargetKind.PlatformEvent,
  },
  CONVERSATION_CONTROL_COMPACT_RUN: {
    category: HostActionCategory.AuthorityIncreasingControl,
    targetKind: HostActionTargetKind.AgentSession,
  },
  CONVERSATION_CONTROL_PERMISSION_DECISION: {
    category: HostActionCategory.AuthorityIncreasingControl,
    targetKind: HostActionTargetKind.AgentSession,
  },
  TASK_MONITOR_START: {
    category: HostActionCategory.TaskMonitor,
    targetKind: HostActionTargetKind.TaskMonitor,
  },
  TASK_MONITOR_RESUME: {
    category: HostActionCategory.TaskMonitor,
    targetKind: HostActionTargetKind.TaskMonitor,
  },
  TASK_MONITOR_JUDGMENT_RESOLVED: {
    category: HostActionCategory.TaskMonitor,
    targetKind: HostActionTargetKind.TaskMonitor,
  },
  TASK_MONITOR_CONTINUE: {
    category: HostActionCategory.TaskMonitor,
    targetKind: HostActionTargetKind.TaskMonitor,
  },
  TASK_MONITOR_COMPLETE: {
    category: HostActionCategory.TaskMonitor,
    targetKind: HostActionTargetKind.TaskMonitor,
  },
  CLI_READ: {
    category: HostActionCategory.CliRead,
    targetKind: HostActionTargetKind.AgentSession,
  },
  APPLICATION_EFFECT_LAUNCH: {
    category: HostActionCategory.ApplicationEffect,
    targetKind: HostActionTargetKind.ApplicationEffect,
  },
  EXACT_ACTION_DELIVERY: {
    category: HostActionCategory.ExactAction,
    targetKind: HostActionTargetKind.ExactAction,
  },
};

export function getCurrentAgentOperationCategory(
  actionType: CurrentAgentOperation,
): HostActionCategory {
  return ACTION_BINDINGS[actionType].category;
}

export const CURRENT_AGENT_OPERATION_CATEGORIES = [
  ...new Set(
    CURRENT_AGENT_OPERATIONS.map((action) => ACTION_BINDINGS[action].category),
  ),
];
