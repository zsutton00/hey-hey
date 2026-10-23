import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgenticAgentSessionBreadcrumbs } from "./AgenticAgentSessionBreadcrumbs";

const mockUseTaskHierarchy = vi.fn();
const mockUseFullEntityContext = vi.fn();
const cachedFeatures = new Map<
  string,
  { name: string; parentTaskId: string | null }
>([["feature-1", { name: "Cached Feature", parentTaskId: null }]]);

vi.mock("@hey-hey/ui-common/data", () => ({
  useService: () => ({
    data: { name: "Service Name" },
  }),
  useTaskHierarchy: (...args: unknown[]) => mockUseTaskHierarchy(...args),
  useFullEntityContext: (...args: unknown[]) =>
    mockUseFullEntityContext(...args),
  useFeatureLookup: () => ({
    isReady: true,
    isLoading: false,
    resolveAncestry: (startId: string | null) => {
      const ancestors: { id: string; name: string }[] = [];
      let currentId = startId;
      while (currentId) {
        const feature = cachedFeatures.get(currentId);
        if (!feature) return { ancestors: [], complete: false };
        ancestors.unshift({ id: currentId, name: feature.name });
        currentId = feature.parentTaskId;
      }
      return { ancestors, complete: true };
    },
  }),
}));

vi.mock("@hey-hey/ui-common/i18n", () => ({
  compose: (value: string) => value,
}));

vi.mock("@hey-hey/ui-common/services", () => ({
  WebPathService: {
    initiativeDetail: ({
      projectId,
      initiativeId,
    }: {
      projectId: string;
      initiativeId: string;
    }) => `/projects/${projectId}/initiatives/${initiativeId}`,
    task: ({ projectId, taskId }: { projectId: string; taskId: string }) =>
      `/projects/${projectId}/tasks/${taskId}`,
    feature: ({
      projectId,
      featureId,
    }: {
      projectId: string;
      featureId: string;
    }) => `/projects/${projectId}/features/${featureId}`,
  },
}));

interface MockBreadcrumbItem {
  kind?: string;
  label: string;
  to?: string;
  type?: string;
  typeLabel?: string;
  isCurrent?: boolean;
}

vi.mock("../../../components/Layout", () => ({
  PageBreadcrumbs: ({ items }: { items: MockBreadcrumbItem[] }) => (
    <nav>
      {items.map((item, index) => (
        <span
          key={`${item.label}-${index}`}
          data-testid={`breadcrumb-${item.type ?? "untyped"}`}
          data-kind={item.kind}
        >
          {item.label}
        </span>
      ))}
    </nav>
  ),
}));

const renderTaskRouteBreadcrumbs = () =>
  render(
    <AgenticAgentSessionBreadcrumbs
      routeFamily="task"
      organizationId="org-1"
      projectId="project-1"
      projectName="Project Name"
      planPath=""
      stepPath=""
      stepCrumbTitle="Step"
      taskData={{ id: "task-1", name: "Task Name" }}
      taskCodingTabPath={null}
      agentSession={{ title: "Session Title" }}
      serviceId={null}
    />
  );

describe("AgenticAgentSessionBreadcrumbs", () => {
  beforeEach(() => {
    mockUseFullEntityContext.mockReset();
    mockUseFullEntityContext.mockReturnValue({ data: null });
  });

  it("renders cached feature ancestors without the context read", () => {
    mockUseTaskHierarchy.mockReturnValue({
      hierarchy: {
        task: {
          id: "task-1",
          name: "Task Name",
          type: "STANDARD",
          parentTaskId: "feature-1",
        },
      },
    });

    renderTaskRouteBreadcrumbs();

    expect(screen.getByTestId("breadcrumb-feature")).toHaveTextContent(
      "Cached Feature"
    );
    expect(screen.getByTestId("breadcrumb-feature")).toHaveAttribute(
      "data-kind",
      "feature"
    );
    expect(mockUseFullEntityContext).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });

  it("falls back to server ancestry when the chain leaves the cache", () => {
    mockUseTaskHierarchy.mockReturnValue({
      hierarchy: {
        task: {
          id: "task-1",
          name: "Task Name",
          type: "STANDARD",
          parentTaskId: "task-parent",
        },
        parent: {
          id: "task-parent",
          name: "Parent Task",
          type: "STANDARD",
          parentTaskId: "task-grandparent",
        },
      },
    });
    mockUseFullEntityContext.mockReturnValue({
      data: {
        featureHierarchy: [
          {
            id: "server-feature",
            name: "Server Feature",
            relationshipType: "structural",
            relationship: "ancestor",
            distance: 3,
          },
        ],
      },
    });

    renderTaskRouteBreadcrumbs();

    expect(mockUseFullEntityContext).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true, entityId: "task-1" })
    );
    expect(screen.getByTestId("breadcrumb-feature")).toHaveTextContent(
      "Server Feature"
    );
  });

  it("renders the full task breadcrumb trail for task routes", () => {
    mockUseTaskHierarchy.mockReturnValue({
      hierarchy: {
        task: { id: "task-1", name: "Task Name", type: "TASK" },
        parent: {
          id: "task-parent-1",
          name: "Parent Task",
          type: "FEATURE",
        },
      },
    });

    render(
      <AgenticAgentSessionBreadcrumbs
        routeFamily="task"
        organizationId="org-1"
        projectId="project-1"
        projectName="Project Name"
        planPath=""
        stepPath=""
        stepCrumbTitle="Step"
        initiativeName="Initiative Name"
        taskData={{
          id: "task-1",
          name: "Task Name",
          initiativeId: "initiative-1",
        }}
        taskCodingTabPath="/projects/project-1/initiatives/initiative-1/tasks/task-1?tab=agent-sessions"
        agentSession={{
          initiativeId: "initiative-1",
          title: "Session Title",
          service: {
            name: "Service Name",
          },
        }}
        serviceId="service-1"
      />
    );

    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("Project Name")).toBeInTheDocument();
    expect(screen.getByText("Parent Task")).toBeInTheDocument();
    expect(screen.getByText("Task Name")).toBeInTheDocument();
    expect(
      screen.getByText("Service Name - Session Title")
    ).toBeInTheDocument();
  });
});
