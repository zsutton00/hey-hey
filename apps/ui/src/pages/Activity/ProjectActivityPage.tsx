import { ActivityHistoryFilters } from "../../components/Activity/ActivityHistoryFilters";
import { parseOrganizationActivityQuery } from "./activityHistoryRoute";
import type {
  CorrelatedActivityDisplayRecord,
  UseCorrelatedActivityOptions,
  UseCorrelatedActivityReturn,
} from "@hey-hey/ui-common/data";
import {
  useAgentSessions,
  useCorrelatedActivity,
  useProject,
  useTaskHierarchy,
} from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import {
  CrossProjectActivityFeed,
  CorrelatedActivityFeed,
  ReportSummaryCard,
} from "@hey-hey/ui-common/components";
import type { ActivityExpandPayload } from "@hey-hey/ui-common/components";
import { unifiedApiClient } from "@hey-hey/ui-common/clients";
import type { ReportDto, TaskResponseDto } from "@hey-hey/ui-common/api";
import {
  ActivityCorrelationLinkType,
  EntityType,
  ProjectMetricIdentity,
  RecentActivityCorrelationMode,
  ReportType,
} from "@hey-hey/ui-common/api";
import { WebPathService } from "@hey-hey/ui-common/services";
import { useQueries } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import React, { useCallback, useMemo, useState } from "react";
import {
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  DetailPageContainer,
  DetailPageHeader,
  PageBreadcrumbs,
} from "../../components/Layout";
import { normalizeInternalReturnTarget } from "../../utils/authReturnTarget";
import { getStatusLabel } from "../../utils/statusUtils";
import {
  PaginatedCodingSessionsFeed,
  PaginatedSessionFeed,
} from "../../components/Activity";
import {
  SegmentedToggle,
  type Segment,
} from "../../components/SegmentedToggle";

const ACTIVITY_DETAIL_LIMIT = 200;
const ACTIVITY_LIST_MODE_KEY = "activity-mode";
type ActivityListMode = "tasks" | "coding" | "conversations";

const ACTIVITY_LIST_SEGMENTS: readonly Segment<ActivityListMode>[] = [
  { value: "tasks", label: "Tasks" },
  { value: "coding", label: "Coding Sessions" },
  { value: "conversations", label: "Conversations" },
];

const readInitialActivityListMode = (): ActivityListMode => {
  try {
    const stored = localStorage.getItem(ACTIVITY_LIST_MODE_KEY);
    if (stored === RecentActivityCorrelationMode.CodingSession) return "coding";
    if (stored === RecentActivityCorrelationMode.AgentSession) {
      return "conversations";
    }
  } catch {
    // localStorage unavailable
  }
  return "tasks";
};

const ProjectActivityList: React.FC<{
  organizationId: string;
  projectId: string;
  userId?: string;
  onExpandActivity: (payload: ActivityExpandPayload) => void;
}> = ({ organizationId, projectId, userId, onExpandActivity }) => {
  const [mode, setMode] = useState<ActivityListMode>(
    readInitialActivityListMode,
  );
  const handleModeChange = useCallback((nextMode: ActivityListMode) => {
    setMode(nextMode);
    const persistedMode =
      nextMode === "coding"
        ? RecentActivityCorrelationMode.CodingSession
        : nextMode === "conversations"
          ? RecentActivityCorrelationMode.AgentSession
          : RecentActivityCorrelationMode.Task;
    try {
      localStorage.setItem(ACTIVITY_LIST_MODE_KEY, persistedMode);
    } catch {
      // localStorage unavailable
    }
  }, []);
  return (
    <Stack spacing={2}>
      <SegmentedToggle
        onChange={handleModeChange}
        segments={ACTIVITY_LIST_SEGMENTS}
        value={mode}
      />
      {mode === "coding" ? (
        <PaginatedCodingSessionsFeed
          limit={10}
          organizationId={organizationId}
          projectId={projectId}
        />
      ) : mode === "conversations" ? (
        <PaginatedSessionFeed
          limit={10}
          organizationId={organizationId}
          projectId={projectId}
          variant="conversations"
        />
      ) : (
        <CorrelatedActivityFeed
          limit={10}
          modeOptions={[RecentActivityCorrelationMode.Task]}
          onExpandActivity={onExpandActivity}
          organizationId={organizationId}
          projectId={projectId}
          showModeSelector={false}
          userId={userId}
          view="full"
        />
      )}
    </Stack>
  );
};

interface ActivityTarget {
  entityId: string;
  entityType: string;
}

const isEntityType = (value: string): value is EntityType =>
  Object.values(EntityType).includes(value as EntityType);

const parseActivityTargetFromRoute = (
  value: string | undefined,
): ActivityTarget | null => {
  if (!value) {
    return null;
  }

  const delimiterIndex = value.indexOf("-");
  if (delimiterIndex <= 0 || delimiterIndex >= value.length - 1) {
    return null;
  }

  return {
    entityType: value.slice(0, delimiterIndex).toUpperCase(),
    entityId: value.slice(delimiterIndex + 1),
  };
};

const parseActivityTargetFromSearchParams = (
  searchParams: URLSearchParams,
): ActivityTarget | null => {
  const entityId = searchParams.get("entityId")?.trim();
  const entityType = searchParams.get("entityType")?.trim().toUpperCase();

  if (!entityId || !entityType) {
    return null;
  }

  return {
    entityId,
    entityType,
  };
};

const getMetricIdentityLabel = (metric: ProjectMetricIdentity): string => {
  const labels: Record<ProjectMetricIdentity, string> = {
    [ProjectMetricIdentity.TaskCreated]: "Tasks created",
    [ProjectMetricIdentity.TaskCompleted]: "Tasks completed",
    [ProjectMetricIdentity.TaskVerifying]: "Tasks verifying",
    [ProjectMetricIdentity.BugCreated]: "Bugs created",
    [ProjectMetricIdentity.BugCompleted]: "Bugs completed",
    [ProjectMetricIdentity.BugVerifying]: "Bugs verifying",
    [ProjectMetricIdentity.PlanCreated]: "Plans created",
    [ProjectMetricIdentity.PlanCompleted]: "Plans completed",
    [ProjectMetricIdentity.PlanVerifying]: "Plans verifying",
    [ProjectMetricIdentity.AgentSessionCreated]: "Agent sessions created",
    [ProjectMetricIdentity.ProjectInfoCreated]: "Project information created",
    [ProjectMetricIdentity.ProjectInfoUpdated]: "Project information updated",
  };
  return labels[metric]
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const toUniqueEntityIds = (
  activity: CorrelatedActivityDisplayRecord | null,
  entityType: string,
): string[] => {
  if (!activity) {
    return [];
  }

  const ids = new Set<string>();

  if (activity.entityType === entityType) {
    ids.add(activity.entityId);
  }

  activity.linkedEntities.forEach((entity) => {
    if (entity.entityType === entityType) {
      ids.add(entity.entityId);
    }
  });

  return [...ids];
};

const isRenderableReport = (report: Pick<ReportDto, "reportType">): boolean =>
  report.reportType !== ReportType.CodingResearch;

const getPrimaryTaskIdFromReports = (reports: ReportDto[]): string | null => {
  for (const report of reports) {
    if (!isRenderableReport(report)) {
      continue;
    }

    const primaryTask = report.entities.find(
      (entity) =>
        entity.entityType === EntityType.Task && entity.relation === "PRIMARY",
    );

    if (primaryTask) {
      return primaryTask.entityId;
    }
  }

  return null;
};

const getTaskSectionMarkdown = (
  task: TaskResponseDto,
  sectionKey: "description" | "acceptanceCriteria",
): string => {
  const normalizedSectionKey =
    sectionKey === "acceptanceCriteria" ? "acceptanceCriteria" : "description";
  const section = task.sections?.find(
    (candidate) => candidate.key === normalizedSectionKey,
  );

  return section?.materializedMarkdown?.trim() ?? "";
};

const formatDurationMs = (durationMs: number): string => {
  if (durationMs < 60000) {
    return `${Math.max(1, Math.round(durationMs / 1000))}s`;
  }

  if (durationMs < 3600000) {
    return `${Math.round(durationMs / 60000)}m`;
  }

  const hours = Math.floor(durationMs / 3600000);
  const minutes = Math.round((durationMs % 3600000) / 60000);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
};

const getAgentSessionDurationLabel = (
  startedAtRaw: string | undefined,
  endedAtRaw: string | undefined,
): string => {
  const startedAt = startedAtRaw ? new Date(startedAtRaw) : null;
  const endedAt = endedAtRaw ? new Date(endedAtRaw) : null;

  if (
    !startedAt ||
    Number.isNaN(startedAt.getTime()) ||
    !endedAt ||
    Number.isNaN(endedAt.getTime())
  ) {
    return "Duration unavailable";
  }

  const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
  return formatDurationMs(durationMs);
};

const toActivityTimestampLabel = (timestamp: string): string => {
  const parsedTimestamp = new Date(timestamp);
  if (Number.isNaN(parsedTimestamp.getTime())) {
    return "Unknown time";
  }

  return formatDistanceToNow(parsedTimestamp, { addSuffix: true });
};

export const ProjectActivityPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    activityEntityRef,
    organizationId: routeOrganizationId,
    projectId = "",
  } = useParams<{
    organizationId?: string;
    projectId: string;
    activityEntityRef?: string;
  }>();
  const { currentOrgId, userId } = useUserIdentity() || {};
  const detailReturnPath = useMemo(
    () => normalizeInternalReturnTarget(searchParams.get("returnTo")),
    [searchParams],
  );
  const isOrganizationActivityRoute = Boolean(routeOrganizationId);
  const isOrganizationRouteAuthorized =
    isOrganizationActivityRoute && routeOrganizationId === currentOrgId;
  const organizationActivityQuery = useMemo(
    () => parseOrganizationActivityQuery(searchParams),
    [searchParams],
  );
  const selectedActivityQuery =
    organizationActivityQuery.kind === "valid"
      ? organizationActivityQuery.query
      : undefined;
  const selectedMetric =
    selectedActivityQuery?.metricContinuation?.metric ??
    selectedActivityQuery?.historyFilter?.metric;
  const isProjectActivity = Boolean(
    organizationActivityQuery.kind === "valid" &&
      (organizationActivityQuery.viewScope === "project" ||
        selectedActivityQuery?.projectId),
  );
  const activityTitle = `${isProjectActivity ? "Project" : "Organization"} Activity${
    selectedMetric ? ` · ${getMetricIdentityLabel(selectedMetric)}` : ""
  }`;
  const activityTargetFromRoute = useMemo(
    () => parseActivityTargetFromRoute(activityEntityRef),
    [activityEntityRef],
  );
  const activityTargetFromSearch = useMemo(
    () => parseActivityTargetFromSearchParams(searchParams),
    [searchParams],
  );
  const activeTarget = isOrganizationActivityRoute
    ? null
    : (activityTargetFromRoute ?? activityTargetFromSearch);
  const isDetailMode = Boolean(activeTarget);
  const activityQueryOptions: UseCorrelatedActivityOptions =
    isOrganizationActivityRoute
      ? organizationActivityQuery.kind === "valid"
        ? {
            ...organizationActivityQuery.query,
            activityScope: "organization",
            enabled: isOrganizationRouteAuthorized,
            view: "full",
          }
        : {
            activityScope: "organization",
            enabled: false,
            limit: ACTIVITY_DETAIL_LIMIT,
            view: "full",
          }
      : activeTarget && isEntityType(activeTarget.entityType)
        ? {
            enabled: !!currentOrgId,
            entityId: activeTarget.entityId,
            entityType: activeTarget.entityType,
            limit: ACTIVITY_DETAIL_LIMIT,
            view: "full",
          }
        : {
            enabled: false,
            limit: ACTIVITY_DETAIL_LIMIT,
            view: "full",
          };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { data: project } = useProject(currentOrgId || "", projectId, {
    enabled: !!currentOrgId && !!projectId,
    preferStale: true,
  });

  const {
    records,
    error: activityError,
    isLoading: isActivityLoading,
  }: UseCorrelatedActivityReturn = useCorrelatedActivity(
    currentOrgId,
    activityQueryOptions,
  );

  const selectedActivity = useMemo(() => {
    if (!activeTarget) {
      return null;
    }

    return (
      records.find(
        (record) =>
          record.entityId === activeTarget.entityId &&
          record.entityType === activeTarget.entityType,
      ) ?? null
    );
  }, [activeTarget, records]);

  const taskIds = useMemo(
    () => toUniqueEntityIds(selectedActivity, EntityType.Task),
    [selectedActivity],
  );
  const agentSessionIds = useMemo(
    () => toUniqueEntityIds(selectedActivity, EntityType.AgentSession),
    [selectedActivity],
  );
  const reportIds = useMemo(() => {
    if (!selectedActivity) {
      return [];
    }

    const ids = new Set<string>();

    if (selectedActivity.entityType === EntityType.Report) {
      ids.add(selectedActivity.entityId);
    }

    selectedActivity.reports.filter(isRenderableReport).forEach((report) => {
      ids.add(report.id);
    });

    selectedActivity.linkedEntities.forEach((entity) => {
      if (entity.entityType === EntityType.Report) {
        ids.add(entity.entityId);
      }
    });
    return [...ids];
  }, [selectedActivity]);

  const taskQueries = useQueries({
    queries: taskIds.map((taskId) => ({
      enabled: isDetailMode && !!currentOrgId,
      queryFn: async (): Promise<TaskResponseDto | null> => {
        const response = await unifiedApiClient.getTask({
          organizationId: currentOrgId || "",
          taskId,
          projectId,
          includeServiceRelations: true,
        });
        return (
          (response as { data?: { data?: TaskResponseDto | null } })?.data
            ?.data ?? null
        );
      },
      queryKey: ["activity-detail", "task", currentOrgId, taskId],
    })),
  });

  const reportQueries = useQueries({
    queries: reportIds.map((reportId) => ({
      enabled: isDetailMode && !!currentOrgId,
      queryFn: async (): Promise<ReportDto | null> => {
        const response = await unifiedApiClient.getReport({
          organizationId: currentOrgId || "",
          reportId,
        });
        return response.data?.data ?? null;
      },
      queryKey: ["activity-detail", "report", currentOrgId, reportId],
    })),
  });

  const {
    agentSessions,
    error: agentSessionsError,
    isLoading: isAgentSessionsLoading,
  } = useAgentSessions(currentOrgId, projectId, {
    enabled: isDetailMode && agentSessionIds.length > 0,
    ids: agentSessionIds.length > 0 ? agentSessionIds : undefined,
  });

  const agentSessionIdSet = useMemo(
    () => new Set(agentSessionIds),
    [agentSessionIds],
  );

  const linkedAgentSessions = useMemo(
    () => agentSessions.filter((session) => agentSessionIdSet.has(session.id)),
    [agentSessionIdSet, agentSessions],
  );

  const hydratedTasks = useMemo(() => {
    const items = taskQueries
      .map((query) => query.data)
      .filter((task): task is TaskResponseDto => Boolean(task));
    const uniqueById = new Map<string, TaskResponseDto>();
    items.forEach((task) => {
      uniqueById.set(task.id, task);
    });
    return [...uniqueById.values()];
  }, [taskQueries]);

  const hydratedReports = useMemo(() => {
    const items = reportQueries
      .map((query) => query.data)
      .filter((report): report is ReportDto => Boolean(report));
    const uniqueById = new Map<string, ReportDto>();
    items.forEach((report) => {
      uniqueById.set(report.id, report);
    });
    return [...uniqueById.values()];
  }, [reportQueries]);

  const renderableReports = useMemo(
    () => hydratedReports.filter(isRenderableReport),
    [hydratedReports],
  );

  const primaryTask = useMemo(() => {
    if (!selectedActivity) {
      return null;
    }

    const taskIdFromActivityOrLinks =
      selectedActivity.entityType === EntityType.Task
        ? selectedActivity.entityId
        : selectedActivity.linkedEntities.find(
            (entity) =>
              entity.entityType === EntityType.Task &&
              entity.linkType !== ActivityCorrelationLinkType.Self,
          )?.entityId;

    const taskIdFromReport = getPrimaryTaskIdFromReports(renderableReports);
    const resolvedTaskId = taskIdFromActivityOrLinks ?? taskIdFromReport;

    if (!resolvedTaskId) {
      return null;
    }

    return hydratedTasks.find((task) => task.id === resolvedTaskId) ?? null;
  }, [hydratedTasks, renderableReports, selectedActivity]);

  const relatedTasks = useMemo(
    () => hydratedTasks.filter((task) => task.id !== primaryTask?.id),
    [hydratedTasks, primaryTask?.id],
  );

  const {
    children: taskChildren,
    error: hierarchyError,
    isLoading: isHierarchyLoading,
    parent: taskParent,
  } = useTaskHierarchy(currentOrgId || "", projectId, primaryTask?.id || "", {
    enabled: isDetailMode && !!currentOrgId && !!primaryTask?.id,
    includeAgentSessionCounts: true,
    includeDesignDocCounts: true,
  });

  const blockingTaskLinks = useMemo(() => {
    if (!selectedActivity) {
      return [];
    }

    return selectedActivity.linkedEntities.filter((entity) => {
      if (entity.entityType !== EntityType.Task) {
        return false;
      }
      return (
        entity.linkType === ActivityCorrelationLinkType.Blocks ||
        entity.linkType === ActivityCorrelationLinkType.DependsOn
      );
    });
  }, [selectedActivity]);

  const taskHydrationError = useMemo(
    () => taskQueries.find((query) => query.error)?.error ?? null,
    [taskQueries],
  );
  const reportHydrationError = useMemo(
    () => reportQueries.find((query) => query.error)?.error ?? null,
    [reportQueries],
  );
  const isHydratingDetails =
    isDetailMode &&
    (taskQueries.some((query) => query.isLoading || query.isFetching) ||
      reportQueries.some((query) => query.isLoading || query.isFetching) ||
      (agentSessionIds.length > 0 && isAgentSessionsLoading) ||
      isHierarchyLoading);

  if (!currentOrgId) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (isOrganizationActivityRoute && !isOrganizationRouteAuthorized) {
    return (
      <Alert severity="error">
        This Activity link does not belong to the current organization.
      </Alert>
    );
  }

  if (!isOrganizationActivityRoute && !projectId) {
    return <Alert severity="error">Project ID is required</Alert>;
  }

  return (
    <>
      <PageBreadcrumbs
        sx={{ mb: 2 }}
        items={
          isOrganizationActivityRoute
            ? [
                { label: "Home", to: "/home" },
                {
                  label: "Activity",
                  to: WebPathService.organizationActivity({
                    organizationId: routeOrganizationId ?? currentOrgId,
                  }),
                  isCurrent: true,
                },
              ]
            : [
                { label: "Projects", to: "/projects" },
                {
                  label: project?.name ?? "Project",
                  to: `/projects/${projectId}`,
                  type: "project",
                },
                {
                  label: "Recent Activity",
                  to: `/projects/${projectId}/activity`,
                  isCurrent: true,
                },
              ]
        }
      />

      <DetailPageContainer>
        <DetailPageHeader
          title={
            isOrganizationActivityRoute
              ? activityTitle
              : isDetailMode
                ? "Activity Detail"
                : "Project Activity"
          }
        />

        {isOrganizationActivityRoute ? (
          <Box sx={{ px: 1.5, pb: 3 }}>
            {organizationActivityQuery.kind === "invalid" ? (
              <Alert
                data-testid="organization-activity-invalid-query"
                severity="error"
              >
                {organizationActivityQuery.message}
              </Alert>
            ) : (
              <>
                <ActivityHistoryFilters
                  key={searchParams.toString()}
                  organizationId={currentOrgId}
                  query={organizationActivityQuery.query}
                  onChange={(query) =>
                    navigate(
                      WebPathService.organizationActivity({
                        organizationId: currentOrgId,
                        viewScope: organizationActivityQuery.viewScope,
                        ...query,
                      }),
                    )
                  }
                />
                {organizationActivityQuery.query.historyFilter ? (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    Filtered history:{" "}
                    {getMetricIdentityLabel(
                      organizationActivityQuery.query.historyFilter.metric,
                    )}
                    . These results use the selected filters and do not
                    represent the original chart count.
                  </Alert>
                ) : null}
                <CrossProjectActivityFeed
                  enabled={isOrganizationRouteAuthorized}
                  onExpandActivity={(payload) => {
                    if (payload.href) {
                      navigate(payload.href);
                    }
                  }}
                  onPageChange={(nextOffset) => {
                    if (organizationActivityQuery.kind !== "valid") {
                      return;
                    }

                    const query = organizationActivityQuery.query;
                    navigate(
                      query.metricContinuation
                        ? WebPathService.organizationActivity({
                            organizationId: routeOrganizationId ?? currentOrgId,
                            viewScope: organizationActivityQuery.viewScope,
                            metricContinuation: query.metricContinuation,
                            limit: query.limit,
                            offset: nextOffset,
                          })
                        : WebPathService.organizationActivity({
                            organizationId: routeOrganizationId ?? currentOrgId,
                            viewScope: organizationActivityQuery.viewScope,
                            ...query,
                            offset: nextOffset,
                          }),
                    );
                  }}
                  organizationId={currentOrgId}
                  query={organizationActivityQuery.query}
                />
              </>
            )}
          </Box>
        ) : !isDetailMode ? (
          <Box sx={{ px: 1.5, pb: 3 }}>
            <ProjectActivityList
              onExpandActivity={(payload) => {
                if (payload.href) navigate(payload.href);
              }}
              organizationId={currentOrgId}
              projectId={projectId}
              userId={userId}
            />
          </Box>
        ) : (
          <Stack spacing={2} sx={{ px: 1.5, pb: 3 }}>
            <Box sx={{ display: "flex", justifyContent: "space-between" }}>
              <Button
                onClick={() => {
                  navigate(
                    detailReturnPath ?? `/projects/${projectId}/activity`,
                  );
                }}
                size="small"
              >
                Back to Activity List
              </Button>
            </Box>

            {activityError ? (
              <Alert severity="error">{activityError.message}</Alert>
            ) : null}

            {isActivityLoading || isHydratingDetails ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
                <CircularProgress size={24} />
              </Box>
            ) : null}

            {!isActivityLoading && !selectedActivity ? (
              <Alert severity="warning">
                No activity snapshot found for entity {activeTarget?.entityType}
                :{activeTarget?.entityId}.
              </Alert>
            ) : null}

            {taskHydrationError instanceof Error ? (
              <Alert severity="error">{taskHydrationError.message}</Alert>
            ) : null}
            {reportHydrationError instanceof Error ? (
              <Alert severity="error">{reportHydrationError.message}</Alert>
            ) : null}
            {agentSessionsError ? (
              <Alert severity="error">{agentSessionsError.message}</Alert>
            ) : null}
            {hierarchyError ? (
              <Alert severity="error">{hierarchyError.message}</Alert>
            ) : null}

            {!isActivityLoading && selectedActivity ? (
              <>
                <Paper sx={{ p: 2 }} variant="outlined">
                  <Stack spacing={1}>
                    <Typography variant="h6">Originating Entity</Typography>
                    <Typography variant="subtitle1">
                      {selectedActivity.title}
                    </Typography>
                    <Stack direction="row" flexWrap="wrap" gap={1}>
                      <Chip
                        label={selectedActivity.entityType}
                        size="small"
                        variant="outlined"
                      />
                      {selectedActivity.kind === "entity" ? (
                        <>
                          <Chip
                            label={selectedActivity.activityType}
                            size="small"
                            variant="outlined"
                          />
                          <Chip
                            label={selectedActivity.source}
                            size="small"
                            variant="outlined"
                          />
                        </>
                      ) : null}
                      <Chip
                        label={toActivityTimestampLabel(
                          selectedActivity.timestamp,
                        )}
                        size="small"
                        variant="outlined"
                      />
                    </Stack>
                    <Typography color="text.secondary" variant="body2">
                      {selectedActivity.previewText}
                    </Typography>
                  </Stack>
                </Paper>

                {primaryTask ? (
                  <Paper sx={{ p: 2 }} variant="outlined">
                    <Stack spacing={1.25}>
                      <Typography variant="h6">Task Details</Typography>
                      <Typography variant="subtitle1">
                        {primaryTask.name}
                      </Typography>
                      <Stack direction="row" flexWrap="wrap" gap={1}>
                        <Chip
                          label={`Status: ${getStatusLabel(primaryTask.status)}`}
                          size="small"
                          variant="outlined"
                        />
                        <Chip
                          label={`Type: ${primaryTask.type}`}
                          size="small"
                          variant="outlined"
                        />
                        {primaryTask.dueDate ? (
                          <Chip
                            label={`Due: ${new Date(primaryTask.dueDate).toLocaleDateString()}`}
                            size="small"
                            variant="outlined"
                          />
                        ) : null}
                        <Chip
                          label={`Subtasks: ${primaryTask.childCounts?.total ?? taskChildren.length}`}
                          size="small"
                          variant="outlined"
                        />
                      </Stack>
                      {getTaskSectionMarkdown(primaryTask, "description") ? (
                        <Typography
                          sx={{ whiteSpace: "pre-wrap" }}
                          variant="body2"
                        >
                          {getTaskSectionMarkdown(primaryTask, "description")}
                        </Typography>
                      ) : (
                        <Typography color="text.secondary" variant="body2">
                          No task description provided.
                        </Typography>
                      )}
                      {getTaskSectionMarkdown(
                        primaryTask,
                        "acceptanceCriteria",
                      ) ? (
                        <>
                          <Typography variant="subtitle2">
                            Acceptance Criteria
                          </Typography>
                          <Typography
                            sx={{ whiteSpace: "pre-wrap" }}
                            variant="body2"
                          >
                            {getTaskSectionMarkdown(
                              primaryTask,
                              "acceptanceCriteria",
                            )}
                          </Typography>
                        </>
                      ) : null}
                    </Stack>
                  </Paper>
                ) : null}

                {taskParent ||
                taskChildren.length > 0 ||
                blockingTaskLinks.length > 0 ? (
                  <Paper sx={{ p: 2 }} variant="outlined">
                    <Stack spacing={1.25}>
                      <Typography variant="h6">Task Relationships</Typography>

                      {taskParent ? (
                        <>
                          <Typography variant="subtitle2">
                            Parent Task
                          </Typography>
                          <Typography variant="body2">
                            {taskParent.name}
                          </Typography>
                          <Typography color="text.secondary" variant="body2">
                            Status: {getStatusLabel(taskParent.status)}
                          </Typography>
                        </>
                      ) : null}

                      {taskChildren.length > 0 ? (
                        <>
                          <Divider />
                          <Typography variant="subtitle2">Subtasks</Typography>
                          <Stack spacing={0.75}>
                            {taskChildren.map((childTask) => (
                              <Paper
                                key={childTask.id}
                                sx={{ p: 1.25 }}
                                variant="outlined"
                              >
                                <Typography variant="body2">
                                  {childTask.name}
                                </Typography>
                                <Typography
                                  color="text.secondary"
                                  variant="caption"
                                >
                                  Status: {getStatusLabel(childTask.status)}
                                </Typography>
                              </Paper>
                            ))}
                          </Stack>
                        </>
                      ) : null}

                      {blockingTaskLinks.length > 0 ? (
                        <>
                          <Divider />
                          <Typography variant="subtitle2">
                            Blocking Dependencies
                          </Typography>
                          <Stack spacing={0.75}>
                            {blockingTaskLinks.map((entity) => (
                              <Typography
                                key={`${entity.linkType}-${entity.entityId}`}
                                variant="body2"
                              >
                                {entity.linkType ===
                                ActivityCorrelationLinkType.Blocks
                                  ? "Blocks"
                                  : "Blocked by"}
                                : {entity.title}
                              </Typography>
                            ))}
                          </Stack>
                        </>
                      ) : null}
                    </Stack>
                  </Paper>
                ) : null}

                {relatedTasks.length > 0 ? (
                  <Paper sx={{ p: 2 }} variant="outlined">
                    <Stack spacing={1.5}>
                      <Typography variant="h6">Related Tasks</Typography>
                      {relatedTasks.map((task) => (
                        <Paper key={task.id} sx={{ p: 1.5 }} variant="outlined">
                          <Stack spacing={1}>
                            <Typography variant="subtitle1">
                              {task.name}
                            </Typography>
                            <Stack direction="row" flexWrap="wrap" gap={1}>
                              <Chip
                                label={`Status: ${getStatusLabel(task.status)}`}
                                size="small"
                                variant="outlined"
                              />
                              <Chip
                                label={`Type: ${task.type}`}
                                size="small"
                                variant="outlined"
                              />
                              {task.dueDate ? (
                                <Chip
                                  label={`Due: ${new Date(task.dueDate).toLocaleDateString()}`}
                                  size="small"
                                  variant="outlined"
                                />
                              ) : null}
                            </Stack>
                            {getTaskSectionMarkdown(task, "description") ? (
                              <Typography
                                sx={{ whiteSpace: "pre-wrap" }}
                                variant="body2"
                              >
                                {getTaskSectionMarkdown(task, "description")}
                              </Typography>
                            ) : (
                              <Typography
                                color="text.secondary"
                                variant="body2"
                              >
                                No task description provided.
                              </Typography>
                            )}
                            {getTaskSectionMarkdown(
                              task,
                              "acceptanceCriteria",
                            ) ? (
                              <>
                                <Typography variant="subtitle2">
                                  Acceptance Criteria
                                </Typography>
                                <Typography
                                  sx={{ whiteSpace: "pre-wrap" }}
                                  variant="body2"
                                >
                                  {getTaskSectionMarkdown(
                                    task,
                                    "acceptanceCriteria",
                                  )}
                                </Typography>
                              </>
                            ) : null}
                          </Stack>
                        </Paper>
                      ))}
                    </Stack>
                  </Paper>
                ) : null}

                {linkedAgentSessions.length > 0 ? (
                  <Paper sx={{ p: 2 }} variant="outlined">
                    <Stack spacing={1.5}>
                      <Typography variant="h6">Coding Sessions</Typography>
                      {linkedAgentSessions.map((session) => (
                        <Paper
                          key={session.id}
                          sx={{ p: 1.5 }}
                          variant="outlined"
                        >
                          <Stack spacing={0.75}>
                            <Typography variant="subtitle1">
                              {session.title}
                            </Typography>
                            <Stack direction="row" flexWrap="wrap" gap={1}>
                              <Chip
                                label={session.status}
                                size="small"
                                variant="outlined"
                              />
                              <Chip
                                label={`Service: ${
                                  session.service?.name ||
                                  (session.launchServiceId
                                    ? `Service ${session.launchServiceId}`
                                    : "Unknown")
                                }`}
                                size="small"
                                variant="outlined"
                              />
                              <Chip
                                label={`Duration: ${getAgentSessionDurationLabel(
                                  session.sessionDate || session.createdAt,
                                  session.status === "IN_PROGRESS"
                                    ? new Date().toISOString()
                                    : session.updatedAt || session.createdAt,
                                )}`}
                                size="small"
                                variant="outlined"
                              />
                              <Chip
                                label={`Started ${toActivityTimestampLabel(
                                  session.sessionDate ||
                                    session.createdAt ||
                                    "",
                                )}`}
                                size="small"
                                variant="outlined"
                              />
                            </Stack>
                          </Stack>
                        </Paper>
                      ))}
                    </Stack>
                  </Paper>
                ) : null}

                {renderableReports.length > 0 ? (
                  <Paper sx={{ p: 2 }} variant="outlined">
                    <Stack spacing={1.5}>
                      <Typography variant="h6">Reports & Insights</Typography>
                      {renderableReports.map((report) => (
                        <ReportSummaryCard key={report.id} report={report} />
                      ))}
                    </Stack>
                  </Paper>
                ) : null}
              </>
            ) : null}
          </Stack>
        )}
      </DetailPageContainer>
    </>
  );
};
