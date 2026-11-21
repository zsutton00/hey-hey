import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CanonicalPageProvider,
  EntityActivationProvider,
} from "@hey-hey/ui-common/context";
import type {
  ContextRelatedEntityDto,
  FeatureHierarchyEntryDto,
} from "@hey-hey/contracts/api";

// The real ui-common barrel builds a logger that reads localStorage on import.
vi.hoisted(() => {
  vi.stubGlobal("localStorage", { getItem: () => null });
});

const onEntityActivated = vi.fn();

const render = (ui: ReactElement) =>
  rtlRender(
    <EntityActivationProvider sink={{ onEntityActivated }}>
      <CanonicalPageProvider>{ui}</CanonicalPageProvider>
    </EntityActivationProvider>,
  );

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
  useFullEntityContext: (...args: unknown[]) =>
    mockUseFullEntityContext(...args),
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
        <a
          key={item.label}
          href={item.to}
          data-current={item.isCurrent || undefined}
        >
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
      isFetched: true,
      error: null,
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
        task={
          {
            id: "monitor-1",
            name: "Release monitor",
            type: "TASK_MONITOR",
          } as never
        }
      />,
    );

    expect(screen.getByTestId("task-monitor-breadcrumbs")).toHaveTextContent(
      "ProjectsHey HeyProject ChromeTask MonitoringQ2 RolloutRelease monitor",
    );
    expect(screen.getByText("Q2 Rollout")).not.toHaveAttribute("data-current");
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
      isFetched: true,
      error: null,
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
        task={
          {
            id: "monitor-1",
            name: "Release monitor",
            type: "TASK_MONITOR",
          } as never
        }
      />,
    );

    expect(screen.getByTestId("task-monitor-breadcrumbs")).toHaveTextContent(
      "ProjectsHey HeyRelease monitor",
    );
    expect(screen.queryByText("Indirect Plan")).not.toBeInTheDocument();
    expect(screen.queryByText("Unrelated Plan")).not.toBeInTheDocument();
  });

  it.each([undefined, []])(
    "keeps the monitor current without a related Plan (%s)",
    (relatedEntities) => {
      mockUseFullEntityContext.mockReturnValue({
        isFetched: true,
        error: null,
        data: { featureHierarchy, relatedEntities },
      });

      render(
        <TaskMonitorPage
          organizationId="org-1"
          projectId="project-1"
          monitorId="monitor-1"
          task={
            {
              id: "monitor-1",
              name: "Release monitor",
              type: "TASK_MONITOR",
            } as never
          }
        />,
      );

      expect(screen.getByTestId("task-monitor-breadcrumbs")).toHaveTextContent(
        "ProjectsHey HeyProject ChromeTask MonitoringRelease monitor",
      );
      expect(screen.getByText("Release monitor")).toHaveAttribute(
        "data-current",
        "true",
      );
    },
  );

  describe("Open Items activation lineage", () => {
    const monitorTask = {
      id: "monitor-1",
      name: "Release monitor",
      type: "TASK_MONITOR",
    } as never;
    const renderPage = () =>
      render(
        <TaskMonitorPage
          organizationId="org-1"
          projectId="project-1"
          monitorId="monitor-1"
          task={monitorTask}
        />,
      );

    it("activates the monitor beneath its Plan", () => {
      renderPage();

      expect(onEntityActivated).toHaveBeenCalledTimes(1);
      const activation = onEntityActivated.mock.calls[0][0];
      expect(activation.entityId).toBe("monitor-1");
      expect(activation.lineage).toEqual([
        { entityType: "plan", entityId: "plan-1" },
      ]);
    });

    it("activates a stage-linked monitor beneath its Plan and Stage", () => {
      mockUseFullEntityContext.mockReturnValue({
        isFetched: true,
        error: null,
        data: {
          relatedEntities: [
            {
              entityId: "plan-1",
              entityType: "TASK",
              taskType: "PLAN",
              displayName: "Q2 Rollout",
              relationship: "related-to",
            },
            {
              entityId: "stage-1",
              entityType: "TASK",
              taskType: "PLAN_STAGE",
              displayName: "Stage 1",
              relationship: "related-to",
            },
          ],
        },
      });
      renderPage();

      expect(onEntityActivated.mock.calls[0][0].lineage).toEqual([
        { entityType: "plan", entityId: "plan-1" },
        { entityType: "plan_stage", entityId: "stage-1" },
      ]);
    });

    it("does not activate while the Plan lookup is unsettled, then activates once with the Plan", () => {
      mockUseFullEntityContext.mockReturnValue({
        isFetched: false,
        error: null,
        data: null,
      });
      const view = renderPage();
      expect(onEntityActivated).not.toHaveBeenCalled();

      mockUseFullEntityContext.mockReturnValue({
        isFetched: true,
        error: null,
        data: {
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
      view.rerender(
        <EntityActivationProvider sink={{ onEntityActivated }}>
          <CanonicalPageProvider>
            <TaskMonitorPage
              organizationId="org-1"
              projectId="project-1"
              monitorId="monitor-1"
              task={monitorTask}
            />
          </CanonicalPageProvider>
        </EntityActivationProvider>,
      );

      expect(onEntityActivated).toHaveBeenCalledTimes(1);
      expect(onEntityActivated.mock.calls[0][0].lineage).toHaveLength(1);
    });

    it("still activates a monitor whose Plan lookup failed, without lineage", () => {
      mockUseFullEntityContext.mockReturnValue({
        isFetched: false,
        error: "boom",
        data: null,
      });
      renderPage();

      expect(onEntityActivated).toHaveBeenCalledTimes(1);
      expect(onEntityActivated.mock.calls[0][0].lineage ?? []).toEqual([]);
    });

    it("activates a monitor with no Plan without lineage", () => {
      mockUseFullEntityContext.mockReturnValue({
        isFetched: true,
        error: null,
        data: { relatedEntities: [] },
      });
      renderPage();

      expect(onEntityActivated).toHaveBeenCalledTimes(1);
      expect(onEntityActivated.mock.calls[0][0].lineage ?? []).toEqual([]);
    });
  });
});
