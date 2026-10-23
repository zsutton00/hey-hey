import {
  AdrStatus,
  BrainstormStatus,
  AgentSessionStatus,
  DecisionStatus,
  WorkStatus,
  type EntityType,
} from "../../api";
import { formatStatus } from "../../utils/statusUtils";

type Brand<T, TBrand extends string> = T & { readonly __brand: TBrand };

export type ActivityGanttEntityId = Brand<string, "ActivityGanttEntityId">;

export const toActivityGanttEntityId = (
  value: string,
): ActivityGanttEntityId => {
  return value as ActivityGanttEntityId;
};

export const ActivityGanttViewMode = {
  Compact: "compact",
  Full: "full",
  MinimalGantt: "minimal_gantt",
} as const;

export type ActivityGanttViewMode =
  (typeof ActivityGanttViewMode)[keyof typeof ActivityGanttViewMode];

export const ActivityGanttEntityStatus = {
  NotStarted: "NOT_STARTED",
  Active: "ACTIVE",
  InProgress: "IN_PROGRESS",
  Completed: "COMPLETED",
  Blocked: "BLOCKED",
} as const;

const ACTIVITY_GANTT_SERVICE_STATUS_VALUES = [
  "ACTIVE",
  "ARCHIVED",
  "DEPRECATED",
] as const;

export type ActivityGanttEntityStatus =
  | (typeof ActivityGanttEntityStatus)[keyof typeof ActivityGanttEntityStatus]
  | WorkStatus
  | AgentSessionStatus
  | BrainstormStatus
  | DecisionStatus
  | AdrStatus
  | (typeof ACTIVITY_GANTT_SERVICE_STATUS_VALUES)[number];

const ACTIVITY_GANTT_ENTITY_STATUS_VALUES = new Set<ActivityGanttEntityStatus>([
  ...Object.values(ActivityGanttEntityStatus),
  ...Object.values(WorkStatus),
  ...Object.values(AgentSessionStatus),
  ...Object.values(BrainstormStatus),
  ...Object.values(DecisionStatus),
  ...Object.values(AdrStatus),
  ...ACTIVITY_GANTT_SERVICE_STATUS_VALUES,
]);

export const isActivityGanttEntityStatus = (
  value: string,
): value is ActivityGanttEntityStatus => {
  return ACTIVITY_GANTT_ENTITY_STATUS_VALUES.has(
    value as ActivityGanttEntityStatus,
  );
};

export const ActivityGanttOverallStatus = {
  Ready: "READY",
  AttentionRequired: "ATTENTION_REQUIRED",
  InFlight: "IN_FLIGHT",
  Completed: "COMPLETED",
} as const;

export type ActivityGanttOverallStatus =
  (typeof ActivityGanttOverallStatus)[keyof typeof ActivityGanttOverallStatus];

export const ActivityGanttLaneRole = {
  ParentTasks: "parent_tasks",
  CurrentWork: "current_work",
  ActiveSessions: "active_sessions",
  Subtasks: "subtasks",
  Reports: "reports",
  Verification: "verification",
} as const;

export type ActivityGanttLaneRole =
  (typeof ActivityGanttLaneRole)[keyof typeof ActivityGanttLaneRole];

export const ActivityGanttDerivedEntityType = {
  Report: "REPORT",
  VerificationRecommendation: "VERIFICATION_RECOMMENDATION",
} as const;

export type ActivityGanttEntityType =
  | EntityType
  | typeof ActivityGanttDerivedEntityType.Report
  | typeof ActivityGanttDerivedEntityType.VerificationRecommendation;

export interface ActivityGanttProgressRatio {
  completedUnits: number;
  totalUnits: number;
}

interface ActivityGanttEntityNodeBase {
  id: ActivityGanttEntityId;
  entityType: ActivityGanttEntityType;
  displayIconEntityType?: EntityType;
  entityId: string;
  title: string;
  status: ActivityGanttEntityStatus;
  timeContext: string;
  durationLabel: string;
  detailText: string | null;
}

interface ActivityGanttParentTaskNode extends ActivityGanttEntityNodeBase {
  laneRole: typeof ActivityGanttLaneRole.ParentTasks;
  progress: null;
}

export interface ActivityGanttCurrentWorkNode extends ActivityGanttEntityNodeBase {
  laneRole: typeof ActivityGanttLaneRole.CurrentWork;
  progress: ActivityGanttProgressRatio | null;
}

interface ActivityGanttActiveSessionNode extends ActivityGanttEntityNodeBase {
  laneRole: typeof ActivityGanttLaneRole.ActiveSessions;
  progress: null;
}

interface ActivityGanttSubtaskNode extends ActivityGanttEntityNodeBase {
  laneRole: typeof ActivityGanttLaneRole.Subtasks;
  progress: ActivityGanttProgressRatio | null;
}

interface ActivityGanttReportNode extends ActivityGanttEntityNodeBase {
  laneRole: typeof ActivityGanttLaneRole.Reports;
  progress: null;
}

interface ActivityGanttVerificationRecommendationNode extends ActivityGanttEntityNodeBase {
  laneRole: typeof ActivityGanttLaneRole.Verification;
  progress: null;
}

export type ActivityGanttEntityNode =
  | ActivityGanttParentTaskNode
  | ActivityGanttCurrentWorkNode
  | ActivityGanttActiveSessionNode
  | ActivityGanttSubtaskNode
  | ActivityGanttReportNode
  | ActivityGanttVerificationRecommendationNode;

export const ActivityGanttRelationshipType = {
  Blocking: "BLOCKING",
  Concurrent: "CONCURRENT",
  Report: "REPORT",
} as const;

export type ActivityGanttRelationshipType =
  (typeof ActivityGanttRelationshipType)[keyof typeof ActivityGanttRelationshipType];

export interface ActivityGanttRelationship {
  sourceId: ActivityGanttEntityId;
  targetId: ActivityGanttEntityId;
  type: ActivityGanttRelationshipType;
}

export interface ActivityGanttBreadcrumbSegment {
  entityId: string;
  entityType: ActivityGanttEntityType;
  title: string;
}

export interface ActivityGanttPlanScope {
  planId: string;
  stageId?: string;
  stepId?: string;
}

export interface ActivityGanttChartData {
  parentTasks: ActivityGanttParentTaskNode[];
  currentWork: ActivityGanttCurrentWorkNode[];
  activeSessions: ActivityGanttActiveSessionNode[];
  subtasks: ActivityGanttSubtaskNode[];
  reports: ActivityGanttReportNode[];
  verificationRecommendations: ActivityGanttVerificationRecommendationNode[];
  blockingRelationships: ActivityGanttRelationship[];
  breadcrumbs: ActivityGanttBreadcrumbSegment[];
  planScope?: ActivityGanttPlanScope;
  timeContext: string;
  status: ActivityGanttOverallStatus;
}

export const getActivityGanttLaneLabel = (
  laneRole: ActivityGanttLaneRole,
): string => {
  switch (laneRole) {
    case ActivityGanttLaneRole.ParentTasks:
      return "Parent Tasks";
    case ActivityGanttLaneRole.CurrentWork:
      return "Current Work";
    case ActivityGanttLaneRole.ActiveSessions:
      return "Active Sessions";
    case ActivityGanttLaneRole.Subtasks:
      return "Subtasks";
    case ActivityGanttLaneRole.Reports:
      return "Reports";
    case ActivityGanttLaneRole.Verification:
      return "Verification";
    default:
      return laneRole;
  }
};

export const getActivityGanttRelationshipLabel = (
  relationshipType: ActivityGanttRelationshipType,
): string => {
  switch (relationshipType) {
    case ActivityGanttRelationshipType.Blocking:
      return "Blocking";
    case ActivityGanttRelationshipType.Concurrent:
      return "Concurrent";
    case ActivityGanttRelationshipType.Report:
      return "Report";
    default:
      return relationshipType;
  }
};

export const getActivityGanttStatusLabel = (
  status: ActivityGanttEntityStatus,
): string => {
  return formatStatus(status);
};

export const getActivityGanttOverallStatusLabel = (
  status: ActivityGanttOverallStatus,
): string => {
  switch (status) {
    case ActivityGanttOverallStatus.Ready:
      return "Ready";
    case ActivityGanttOverallStatus.AttentionRequired:
      return "Attention Required";
    case ActivityGanttOverallStatus.InFlight:
      return "In Flight";
    case ActivityGanttOverallStatus.Completed:
      return "Completed";
    default:
      return status;
  }
};

export const getActivityGanttProgressPercent = (
  progress: ActivityGanttProgressRatio,
): number => {
  if (progress.totalUnits <= 0) {
    return 0;
  }

  return Math.round((progress.completedUnits / progress.totalUnits) * 100);
};

export const ACTIVITY_GANTT_LANE_ORDER: ActivityGanttLaneRole[] = [
  ActivityGanttLaneRole.ParentTasks,
  ActivityGanttLaneRole.CurrentWork,
  ActivityGanttLaneRole.ActiveSessions,
  ActivityGanttLaneRole.Subtasks,
  ActivityGanttLaneRole.Reports,
  ActivityGanttLaneRole.Verification,
];
