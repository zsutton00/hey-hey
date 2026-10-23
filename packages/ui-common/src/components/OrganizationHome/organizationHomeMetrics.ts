import { ProjectMetricIdentity } from "../../api";
import type { ProjectMetricDto, ProjectMetricsResponseDto } from "../../api";

export interface MetricDefinition {
  identity: ProjectMetricIdentity;
  label: string;
}

export interface MetricGroupDefinition {
  key: string;
  label: string;
  metrics: readonly MetricDefinition[];
}

export const THROUGHPUT_METRIC_GROUPS = [
  {
    key: "agent-sessions",
    label: "Agent Sessions",
    metrics: [
      {
        identity: ProjectMetricIdentity.AgentSessionCreated,
        label: "Created",
      },
    ],
  },
  {
    key: "tasks",
    label: "Tasks",
    metrics: [
      { identity: ProjectMetricIdentity.TaskCreated, label: "Created" },
      { identity: ProjectMetricIdentity.TaskCompleted, label: "Completed" },
      { identity: ProjectMetricIdentity.TaskVerifying, label: "Verifying" },
    ],
  },
  {
    key: "plans",
    label: "Plans",
    metrics: [
      { identity: ProjectMetricIdentity.PlanCreated, label: "Created" },
      { identity: ProjectMetricIdentity.PlanCompleted, label: "Completed" },
      { identity: ProjectMetricIdentity.PlanVerifying, label: "Verifying" },
    ],
  },
  {
    key: "bugs",
    label: "Bugs",
    metrics: [
      { identity: ProjectMetricIdentity.BugCreated, label: "Created" },
      { identity: ProjectMetricIdentity.BugCompleted, label: "Completed" },
      { identity: ProjectMetricIdentity.BugVerifying, label: "Verifying" },
    ],
  },
] as const satisfies readonly MetricGroupDefinition[];

export const PROJECT_INFO_METRIC_GROUPS = [
  {
    key: "project-info",
    label: "Project Info",
    metrics: [
      {
        identity: ProjectMetricIdentity.ProjectInfoCreated,
        label: "Created",
      },
      {
        identity: ProjectMetricIdentity.ProjectInfoUpdated,
        label: "Updated",
      },
    ],
  },
] as const satisfies readonly MetricGroupDefinition[];

export const PROJECT_METRIC_IDENTITIES = [
  ...THROUGHPUT_METRIC_GROUPS.flatMap((group) =>
    group.metrics.map((metric) => metric.identity)
  ),
  ...PROJECT_INFO_METRIC_GROUPS.flatMap((group) =>
    group.metrics.map((metric) => metric.identity)
  ),
] as const satisfies readonly ProjectMetricIdentity[];

export interface GroupedProjectMetric {
  identity: ProjectMetricIdentity;
  label: string;
  metric: ProjectMetricDto | undefined;
}

export interface GroupedProjectMetricGroup {
  key: string;
  label: string;
  metrics: GroupedProjectMetric[];
}

export interface GroupedProjectMetrics {
  throughput: GroupedProjectMetricGroup[];
  updates: GroupedProjectMetricGroup[];
}

const groupProjectMetricsByDefinition = (
  metrics: readonly ProjectMetricDto[],
  definitions: readonly MetricGroupDefinition[]
): GroupedProjectMetricGroup[] => {
  const metricsByIdentity = new Map<ProjectMetricIdentity, ProjectMetricDto>();
  metrics.forEach((metric) => metricsByIdentity.set(metric.metric, metric));

  return definitions.map((group) => ({
    key: group.key,
    label: group.label,
    metrics: group.metrics.map(({ identity, label }) => ({
      identity,
      label,
      metric: metricsByIdentity.get(identity),
    })),
  }));
};

export const groupProjectMetrics = (
  metrics: readonly ProjectMetricDto[]
): GroupedProjectMetrics => ({
  throughput: groupProjectMetricsByDefinition(
    metrics,
    THROUGHPUT_METRIC_GROUPS
  ),
  updates: groupProjectMetricsByDefinition(metrics, PROJECT_INFO_METRIC_GROUPS),
});

export const hasCompleteProjectMetrics = (
  metrics: readonly ProjectMetricDto[],
  includeProjectInfo = true
): boolean =>
  (includeProjectInfo
    ? PROJECT_METRIC_IDENTITIES
    : THROUGHPUT_METRIC_GROUPS.flatMap((group) =>
        group.metrics.map((metric) => metric.identity)
      )
  ).every((identity) =>
    metrics.some((metric) => metric.metric === identity)
  );

export const areAllProjectMetricsZero = (
  metrics: readonly ProjectMetricDto[]
): boolean =>
  metrics.length > 0 && metrics.every((metric) => metric.value === 0);

export const formatProjectMetricsWindow = (
  data: Pick<ProjectMetricsResponseDto, "windowStart" | "windowEnd">
): string => `Rolling 24 hours: ${data.windowStart} – ${data.windowEnd}`;
