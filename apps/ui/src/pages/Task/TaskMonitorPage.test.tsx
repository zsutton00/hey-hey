import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContextRelatedEntityDto, FeatureHierarchyEntryDto } from "@hey-hey/ui-common/api";

const mockUseProject = vi.fn();
const mockUseFullEntityContext = vi.fn();
const mockSuppressLayoutMainBottomSpacing = vi.fn();

vi.mock("@hey-hey/ui-common/data", () => ({
  // Cached hierarchy unavailable, so pages use the server-derived ancestry.
  useFeatureLookup: () => ({
    isReady: false,
    isLoading: false,
    get: () => undefined,
    resolveAncestry: () => ({ ancestors: [], complete: false }),
  }),
  useProject: (...args: unknown[]) => mockUseProject(...args),
  useFullEntityContext: (...args: unknown[]) => mockUseFullEntityContext(...args),
}));

vi.mock("../../components/TaskMonitorResponsiveWorkspace", () => ({
  TaskMonitorResponsiveWorkspace: (props: {
    organizationId: string;
    projectId: string;
    monitorId: string;
  }) => (
    <div
      data-testid="task-monitor"
      data-organization-id={props.organizationId}
      data-project-id={props.projectId}
      data-monitor-id={props.monitorId}
    />
  ),
}));

vi.mock("../../components/Layout", () => ({
  PageBreadcrumbs: ({
    items,
  }: {
    items: Array<{ label: string; to?: string; isCurrent?: boolean }>;
  }) => (
    <nav data-testid="task-monitor-breadcrumbs">
      {items.map((item) => (
        <a key={item.label} href={item.to} data-current={item.isCurrent || undefined}>
          {item.label}
        </a>
      ))}
    </nav>
  ),
}));

vi.mock("../../components/Layout/LayoutMainBottomSpacingContext", () => ({
  useSuppressLayoutMainBottomSpacing: (shouldSuppress: boolean) => {
    mockSuppressLayoutMainBottomSpacing(shouldSuppress);
  },
}));

vi.mock("../../hooks/useRemainingViewportHeight", () => ({
  useRemainingViewportHeight: () => ({
    containerRef: () => undefined,
    height: 640,
  }),
}));

import { TaskMonitorPage } from "./TaskMonitorPage";

const featureHierarchy = [
  {
    id: "feature-root",
    name: "Project Chrome",
    relationshipType: "structural",
    relationship: "ancestor",
    distance: 2,
  },
  {
    id: "feature-leaf",
    name: "Task Monitoring",
    relationshipType: "structural",
    relationship: "ancestor",
    distance: 1,
  },
] as unknown as FeatureHierarchyEntryDto[];

describe("TaskMonitorPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseProject.mockReturnValue({ data: { name: "Hey Hey" } });
    mockUseFullEntityContext.mockReturnValue({
      data: {
        featureHierarchy,
        relatedEntities: [
          {
            entityId: "plan-1",
            entityType: "TASK",
            taskType: "PLAN",
            displayName: "Q2 Rollout",
            relationship: "related-to",
          } satisfies ContextRelatedEntityDto,
        ],
      },
    });
  });

  it("renders the full task breadcrumb chain and bounded monitor shell", () => {
    render(
      <TaskMonitorPage
        organizationId="org-1"
        projectId="project-1"
        monitorId="monitor-1"
        task={{
          id: "monitor-1",
          name: "Release monitor",
          type: "TASK_MONITOR",
        } as never}
      />,
    );

    expect(screen.getByTestId("task-monitor-breadcrumbs")).toHaveTextContent(
      "ProjectsHey HeyProject ChromeTask MonitoringQ2 RolloutRelease monitor",
    );
    expect(screen.getByText("Q2 Rollout")).not.toHaveAttribute(
      "data-current",
    );
    expect(screen.getByRole("link", { name: "Q2 Rollout" })).toHaveAttribute(
      "href",
      "/projects/project-1/plans/plan-1",
    );
    expect(screen.getByText("Release monitor")).toHaveAttribute(
      "data-current",
      "true",
    );
    expect(screen.getByTestId("task-monitor-page")).toHaveStyle({
      height: "640px",
      overflow: "hidden",
    });
    expect(screen.getByTestId("task-monitor")).toHaveAttribute(
      "data-monitor-id",
      "monitor-1",
    );
    expect(mockSuppressLayoutMainBottomSpacing).toHaveBeenCalledWith(true);
    expect(mockUseFullEntityContext).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "monitor-1",
        includeRelatedEntities: true,
        includeFeatureHierarchy: true,
      }),
    );
  });

  it("does not infer a Plan breadcrumb from generic related entities", () => {
    mockUseFullEntityContext.mockReturnValue({
      data: {
        relatedEntities: [
          {
            entityId: "indirect-plan",
            entityType: "TASK",
            taskType: "PLAN",
            displayName: "Indirect Plan",
            relationship: "related-to",
            via: [
              {
                entityId: "feature-1",
                entityType: "TASK",
                displayName: "Feature",
                relationship: "related-to",
              },
            ],
          },
          {
            entityId: "related-task",
            entityType: "TASK",
            taskType: "STANDARD",
            displayName: "Related task",
            relationship: "related-to",
          },
          {
            entityId: "unrelated-plan",
            entityType: "TASK",
            taskType: "PLAN",
            displayName: "Unrelated Plan",
            relationship: "depends-on",
          },
        ] satisfies ContextRelatedEntityDto[],
      },
    });

    render(
      <TaskMonitorPage
        organizationId="org-1"
        projectId="project-1"
        monitorId="monitor-1"
        task={{
          id: "monitor-1",
          name: "Release monitor",
          type: "TASK_MONITOR",
        } as never}
      />,
    );

    expect(screen.getByTestId("task-monitor-breadcrumbs")).toHaveTextContent(
      "ProjectsHey HeyRelease monitor",
    );
    expect(screen.queryByText("Indirect Plan")).not.toBeInTheDocument();
    expect(screen.queryByText("Unrelated Plan")).not.toBeInTheDocument();
  });

  it.each([undefined, []])("keeps the monitor current without a related Plan (%s)", (relatedEntities) => {
    mockUseFullEntityContext.mockReturnValue({
      data: { featureHierarchy, relatedEntities },
    });

    render(
      <TaskMonitorPage
        organizationId="org-1"
        projectId="project-1"
        monitorId="monitor-1"
        task={{ id: "monitor-1", name: "Release monitor", type: "TASK_MONITOR" } as never}
      />,
    );

    expect(screen.getByTestId("task-monitor-breadcrumbs")).toHaveTextContent(
      "ProjectsHey HeyProject ChromeTask MonitoringRelease monitor",
    );
    expect(screen.getByText("Release monitor")).toHaveAttribute("data-current", "true");
  });
});
