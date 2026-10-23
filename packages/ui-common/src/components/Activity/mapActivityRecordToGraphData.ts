import {
  ActivityCorrelationActivityType,
  ActivityCorrelationLinkType,
  EntityType,
  RecentActivityCorrelationMode,
  type ActivityCorrelationLinkedEntityDto,
  type ReportDto,
} from "../../api";
import type { CorrelatedActivityDisplayRecord } from "../../data/hooks/useCorrelatedActivity";
import {
  formatActivityTimestamp,
  resolveAgentSessionDisplayTitle,
} from "./activityFormatting";
import {
  ActivityGanttDerivedEntityType,
  ActivityGanttEntityStatus,
  ActivityGanttLaneRole,
  ActivityGanttOverallStatus,
  ActivityGanttRelationshipType,
  isActivityGanttEntityStatus,
  toActivityGanttEntityId,
  type ActivityGanttBreadcrumbSegment,
  type ActivityGanttChartData,
  type ActivityGanttEntityId,
  type ActivityGanttEntityStatus as ActivityGanttEntityStatusType,
  type ActivityGanttRelationship,
} from "./activityGanttPrimitives";

const getEntityActivityOverallStatus = (
  activityType: ActivityCorrelationActivityType,
): ActivityGanttChartData["status"] => {
  switch (activityType) {
    case ActivityCorrelationActivityType.Unblocked:
      return ActivityGanttOverallStatus.Ready;
    case ActivityCorrelationActivityType.AgentSessionCompleted:
      return ActivityGanttOverallStatus.Completed;
    case ActivityCorrelationActivityType.Viewed:
    case ActivityCorrelationActivityType.Notification:
      return ActivityGanttOverallStatus.InFlight;
    default:
      return ActivityGanttOverallStatus.AttentionRequired;
  }
};

const getEntityActivityOriginStatus = (
  activityType: ActivityCorrelationActivityType,
): ActivityGanttEntityStatusType => {
  switch (activityType) {
    case ActivityCorrelationActivityType.AgentSessionCompleted:
      return ActivityGanttEntityStatus.Completed;
    case ActivityCorrelationActivityType.Unblocked:
      return ActivityGanttEntityStatus.Active;
    case ActivityCorrelationActivityType.Viewed:
    case ActivityCorrelationActivityType.Notification:
      return ActivityGanttEntityStatus.InProgress;
    default:
      return ActivityGanttEntityStatus.InProgress;
  }
};

const mapOriginStatusToOverallStatus = (
  status: ActivityGanttEntityStatusType,
): ActivityGanttChartData["status"] => {
  const normalizedStatus = status.toUpperCase();

  if (normalizedStatus === "COMPLETED" || normalizedStatus === "COMPLETE") {
    return ActivityGanttOverallStatus.Completed;
  }

  if (
    normalizedStatus === "BLOCKED" ||
    normalizedStatus === "ON_HOLD" ||
    normalizedStatus === "CANCELLED" ||
    normalizedStatus === "FAILED"
  ) {
    return ActivityGanttOverallStatus.AttentionRequired;
  }

  if (normalizedStatus === "BACKLOG" || normalizedStatus === "NOT_STARTED") {
    return ActivityGanttOverallStatus.Ready;
  }

  return ActivityGanttOverallStatus.InFlight;
};

const resolveEntityStatus = (input: {
  status?: string | null;
  fallback: ActivityGanttEntityStatusType;
}): ActivityGanttEntityStatusType => {
  const status = input.status?.trim();
  if (!status) {
    return input.fallback;
  }

  return isActivityGanttEntityStatus(status) ? status : input.fallback;
};

const getFallbackOriginStatus = (
  activity: CorrelatedActivityDisplayRecord,
): ActivityGanttEntityStatusType => {
  if (activity.kind === "entity") {
    return getEntityActivityOriginStatus(activity.activityType);
  }

  return activity.entityType === EntityType.AgentSession
    ? ActivityGanttEntityStatus.Active
    : ActivityGanttEntityStatus.InProgress;
};

const getOverallStatus = (
  activity: CorrelatedActivityDisplayRecord,
): ActivityGanttChartData["status"] => {
  if (activity.kind === "entity") {
    return getEntityActivityOverallStatus(activity.activityType);
  }

  return mapOriginStatusToOverallStatus(
    resolveEntityStatus({
      status: activity.status,
      fallback: getFallbackOriginStatus(activity),
    }),
  );
};

const getLinkedStatus = (
  entity: ActivityCorrelationLinkedEntityDto,
): ActivityGanttEntityStatusType => {
  switch (entity.linkType) {
    case ActivityCorrelationLinkType.Parent:
      return ActivityGanttEntityStatus.Completed;
    case ActivityCorrelationLinkType.DependsOn:
      return ActivityGanttEntityStatus.Completed;
    case ActivityCorrelationLinkType.Blocks:
      return ActivityGanttEntityStatus.Active;
    case ActivityCorrelationLinkType.Child:
      return ActivityGanttEntityStatus.InProgress;
    case ActivityCorrelationLinkType.Sibling:
    case ActivityCorrelationLinkType.Related:
    case ActivityCorrelationLinkType.Self:
      return ActivityGanttEntityStatus.NotStarted;
    default:
      return ActivityGanttEntityStatus.NotStarted;
  }
};

const buildDurationLabel = (prefix: string, timestamp: string): string => {
  return `${prefix} ${formatActivityTimestamp(timestamp)}`;
};

const buildLinkedNodeId = (
  entity: ActivityCorrelationLinkedEntityDto,
  index: number,
): ActivityGanttEntityId => {
  return toActivityGanttEntityId(
    `linked:${index}:${entity.entityType}:${entity.entityId}:${entity.linkType}`,
  );
};

const buildEntityIdentityKey = (
  entityType: string,
  entityId: string,
): string => {
  return `${entityType}:${entityId}`;
};

const LINKED_HIERARCHY_BREADCRUMB_ENTITY_TYPES: Set<string> = new Set([
  EntityType.Initiative,
  EntityType.Task,
]);

const LINKED_HIERARCHY_BREADCRUMB_ORDER: Record<string, number> = {
  [EntityType.Initiative]: 0,
  [EntityType.Task]: 1,
};

const isLinkedHierarchyBreadcrumb = (
  entity: ActivityCorrelationLinkedEntityDto,
): boolean => {
  return (
    LINKED_HIERARCHY_BREADCRUMB_ENTITY_TYPES.has(entity.entityType) &&
    entity.linkType === ActivityCorrelationLinkType.Parent
  );
};

const mapBlockingRelationship = (input: {
  entity: ActivityCorrelationLinkedEntityDto;
  linkedId: ActivityGanttEntityId;
  originId: ActivityGanttEntityId;
}): ActivityGanttRelationship | null => {
  switch (input.entity.linkType) {
    case ActivityCorrelationLinkType.Blocks:
      return {
        sourceId: input.originId,
        targetId: input.linkedId,
        type: ActivityGanttRelationshipType.Blocking,
      };
    case ActivityCorrelationLinkType.DependsOn:
      return {
        sourceId: input.linkedId,
        targetId: input.originId,
        type: ActivityGanttRelationshipType.Blocking,
      };
    default:
      return null;
  }
};

const mapReportNodes = (
  reports: ReportDto[],
): ActivityGanttChartData["reports"] => {
  return reports.map((report) => ({
    id: toActivityGanttEntityId(`report:${report.id}`),
    entityType: ActivityGanttDerivedEntityType.Report,
    entityId: report.id,
    title: report.title,
    status: ActivityGanttEntityStatus.Completed,
    timeContext: formatActivityTimestamp(report.createdAt),
    durationLabel: buildDurationLabel("Created", report.createdAt),
    detailText: null,
    laneRole: ActivityGanttLaneRole.Reports,
    progress: null,
  }));
};

const buildReportRelationships = (input: {
  sourceId: ActivityGanttEntityId | null;
  reportIds: ActivityGanttEntityId[];
}): ActivityGanttRelationship[] => {
  const sourceId = input.sourceId;
  if (!sourceId) {
    return [];
  }

  return input.reportIds.map((reportId) => ({
    sourceId,
    targetId: reportId,
    type: ActivityGanttRelationshipType.Report,
  }));
};

const buildConcurrentRelationships = (input: {
  currentWork: ActivityGanttChartData["currentWork"];
  activeSessions: ActivityGanttChartData["activeSessions"];
  concurrentSessionIds: Set<ActivityGanttEntityId>;
}): ActivityGanttRelationship[] => {
  const primaryCurrentWork = input.currentWork[0];
  if (!primaryCurrentWork || input.activeSessions.length === 0) {
    return [];
  }

  return input.activeSessions
    .filter((activeSession) => input.concurrentSessionIds.has(activeSession.id))
    .map((activeSession) => ({
      sourceId: primaryCurrentWork.id,
      targetId: activeSession.id,
      type: ActivityGanttRelationshipType.Concurrent,
    }));
};

const mapOriginNode = (
  activity: CorrelatedActivityDisplayRecord,
): {
  currentWork: ActivityGanttChartData["currentWork"];
  activeSessions: ActivityGanttChartData["activeSessions"];
  originId: ActivityGanttEntityId;
} => {
  const originStatus = resolveEntityStatus({
    status: activity.status,
    fallback: getFallbackOriginStatus(activity),
  });
  const originId = toActivityGanttEntityId(
    `origin:${activity.entityType}:${activity.entityId}`,
  );
  const timeContext = formatActivityTimestamp(activity.timestamp);

  if (activity.entityType === EntityType.AgentSession) {
    const sessionTitle = resolveAgentSessionDisplayTitle(
      activity.entityType,
      activity.title,
      activity.linkedEntities,
    );

    return {
      currentWork: [],
      activeSessions: [
        {
          id: originId,
          entityType: activity.entityType,
          entityId: activity.entityId,
          title: sessionTitle,
          status: originStatus,
          timeContext,
          durationLabel: buildDurationLabel("Updated", activity.timestamp),
          detailText: null,
          laneRole: ActivityGanttLaneRole.ActiveSessions,
          progress: null,
        },
      ],
      originId,
    };
  }

  const currentWorkNode: ActivityGanttChartData["currentWork"][number] = {
    id: originId,
    entityType: activity.entityType,
    entityId: activity.entityId,
    title: activity.title,
    status: originStatus,
    timeContext,
    durationLabel: buildDurationLabel("Updated", activity.timestamp),
    detailText: null,
    laneRole: ActivityGanttLaneRole.CurrentWork,
    progress: null,
  };

  return {
    currentWork: [currentWorkNode],
    activeSessions: [],
    originId,
  };
};

const filterLinkedEntitiesForViewMode = (
  activity: CorrelatedActivityDisplayRecord,
  viewMode?: RecentActivityCorrelationMode,
): CorrelatedActivityDisplayRecord["linkedEntities"] => {
  if (viewMode !== RecentActivityCorrelationMode.CodingSession) {
    return activity.linkedEntities;
  }

  return activity.linkedEntities.filter(
    (entity) => entity.entityType === EntityType.AgentSession,
  );
};

export const mapActivityRecordToGraphData = (
  activity: CorrelatedActivityDisplayRecord,
  viewMode?: RecentActivityCorrelationMode,
): ActivityGanttChartData => {
  const origin = mapOriginNode(activity);
  const seenEntityIdentities = new Set<string>();
  seenEntityIdentities.add(
    buildEntityIdentityKey(activity.entityType, activity.entityId),
  );

  const parentTasks: ActivityGanttChartData["parentTasks"] = [];
  const activeSessions = [...origin.activeSessions];
  const subtasks: ActivityGanttChartData["subtasks"] = [];
  const blockingRelationships: ActivityGanttRelationship[] = [];
  const concurrentSessionIds = new Set<ActivityGanttEntityId>();
  const breadcrumbs: ActivityGanttBreadcrumbSegment[] = [];

  const visibleLinkedEntities = filterLinkedEntitiesForViewMode(
    activity,
    viewMode,
  );

  visibleLinkedEntities.forEach((entity, index) => {
    const entityIdentity = buildEntityIdentityKey(
      entity.entityType,
      entity.entityId,
    );
    if (seenEntityIdentities.has(entityIdentity)) {
      return;
    }
    seenEntityIdentities.add(entityIdentity);

    if (isLinkedHierarchyBreadcrumb(entity)) {
      breadcrumbs.push({
        entityId: entity.entityId,
        entityType: entity.entityType,
        title: entity.title,
      });
      return;
    }

    const linkedStatus = resolveEntityStatus({
      status: entity.status,
      fallback: getLinkedStatus(entity),
    });
    const linkedId = buildLinkedNodeId(entity, index);
    const linkedTimeContext = formatActivityTimestamp(activity.timestamp);

    if (entity.entityType === EntityType.AgentSession) {
      const sessionTimestamp = entity.updatedAt ?? activity.timestamp;
      activeSessions.push({
        id: linkedId,
        entityType: entity.entityType,
        entityId: entity.entityId,
        title: entity.title,
        status: linkedStatus,
        timeContext: formatActivityTimestamp(sessionTimestamp),
        durationLabel: buildDurationLabel("Updated", sessionTimestamp),
        detailText: null,
        laneRole: ActivityGanttLaneRole.ActiveSessions,
        progress: null,
      });

      if (
        entity.linkType !== ActivityCorrelationLinkType.Blocks &&
        entity.linkType !== ActivityCorrelationLinkType.DependsOn
      ) {
        concurrentSessionIds.add(linkedId);
      }
    } else if (entity.linkType === ActivityCorrelationLinkType.DependsOn) {
      parentTasks.push({
        id: linkedId,
        entityType: entity.entityType,
        entityId: entity.entityId,
        title: entity.title,
        status: linkedStatus,
        timeContext: linkedTimeContext,
        durationLabel: buildDurationLabel("Prerequisite", activity.timestamp),
        detailText: null,
        laneRole: ActivityGanttLaneRole.ParentTasks,
        progress: null,
      });
    } else if (entity.linkType === ActivityCorrelationLinkType.Parent) {
      parentTasks.push({
        id: linkedId,
        entityType: entity.entityType,
        entityId: entity.entityId,
        title: entity.title,
        status: linkedStatus,
        timeContext: linkedTimeContext,
        durationLabel: buildDurationLabel("Reference", activity.timestamp),
        detailText: null,
        laneRole: ActivityGanttLaneRole.ParentTasks,
        progress: null,
      });
    } else if (
      entity.linkType === ActivityCorrelationLinkType.Related &&
      activity.entityType === EntityType.AgentSession
    ) {
      parentTasks.push({
        id: linkedId,
        entityType: entity.entityType,
        entityId: entity.entityId,
        title: entity.title,
        status: linkedStatus,
        timeContext: linkedTimeContext,
        durationLabel: buildDurationLabel("Reference", activity.timestamp),
        detailText: null,
        laneRole: ActivityGanttLaneRole.ParentTasks,
        progress: null,
      });
    } else {
      subtasks.push({
        id: linkedId,
        entityType: entity.entityType,
        entityId: entity.entityId,
        title: entity.title,
        status: linkedStatus,
        timeContext: linkedTimeContext,
        durationLabel: buildDurationLabel("Updated", activity.timestamp),
        detailText: null,
        laneRole: ActivityGanttLaneRole.Subtasks,
        progress: null,
      });
    }

    const blockingRelationship = mapBlockingRelationship({
      entity,
      linkedId,
      originId: origin.originId,
    });

    if (blockingRelationship) {
      blockingRelationships.push(blockingRelationship);
    }
  });

  const reportNodes = mapReportNodes(activity.reports);

  const reportRelationshipSource =
    activeSessions[0]?.id ??
    origin.currentWork[0]?.id ??
    parentTasks[0]?.id ??
    null;
  const reportRelationships = buildReportRelationships({
    sourceId: reportRelationshipSource,
    reportIds: reportNodes.map((node) => node.id),
  });

  const resolvedBreadcrumbs = breadcrumbs;
  const breadcrumbEntityIdentities = new Set(
    resolvedBreadcrumbs.map((segment) =>
      buildEntityIdentityKey(segment.entityType, segment.entityId),
    ),
  );
  const filteredParentTasks = parentTasks.filter(
    (task) =>
      !breadcrumbEntityIdentities.has(
        buildEntityIdentityKey(task.entityType, task.entityId),
      ),
  );

  const sortedBreadcrumbs = resolvedBreadcrumbs.sort(
    (a, b) =>
      (LINKED_HIERARCHY_BREADCRUMB_ORDER[a.entityType] ?? 99) -
      (LINKED_HIERARCHY_BREADCRUMB_ORDER[b.entityType] ?? 99),
  );

  return {
    parentTasks: filteredParentTasks,
    currentWork: origin.currentWork,
    activeSessions,
    subtasks,
    reports: reportNodes,
    verificationRecommendations: [],
    blockingRelationships: [
      ...blockingRelationships,
      ...buildConcurrentRelationships({
        currentWork: origin.currentWork,
        activeSessions,
        concurrentSessionIds,
      }),
      ...reportRelationships,
    ],
    breadcrumbs: sortedBreadcrumbs,
    timeContext: formatActivityTimestamp(activity.timestamp),
    status: getOverallStatus(activity),
  };
};
