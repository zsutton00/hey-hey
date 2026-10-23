import {
  ControllerAuthorizationCadence,
  CurrentAgentOperation,
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
} from '../../generated';
import {
  ControllerAuthorizationCadence as PrismaControllerAuthorizationCadence,
  HostAffectingActionType as PrismaHostAffectingActionType,
} from '@prisma/client';

export const CONTROLLER_DEVICE_POLICY_REVISION = 1;
export const CONTROLLER_DEVICE_GRANT_TTL_MS = {
  FIVE_MINUTES: 5 * 60 * 1000,
  EIGHT_HOURS: 8 * 60 * 60 * 1000,
  ONE_DAY: 24 * 60 * 60 * 1000,
  ONE_WEEK: 7 * 24 * 60 * 60 * 1000,
  ONE_MONTH: 30 * 24 * 60 * 60 * 1000,
} as const satisfies Record<ControllerAuthorizationCadence, number>;

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
    case PrismaControllerAuthorizationCadence.EVERY_ACTION:
    case PrismaControllerAuthorizationCadence.CURRENT_BROWSER_SESSION:
      return null;
  }
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
