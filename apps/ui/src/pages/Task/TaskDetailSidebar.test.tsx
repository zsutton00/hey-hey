import type {
  ContextRelatedEntityDto,
  ProposalResponseDto,
} from "@hey-hey/ui-common/api";
import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { BreadcrumbFeatureAncestor } from "../../components/TaskBreadcrumbs";
import { TaskDetailSidebar } from "./TaskDetailSidebar";

vi.mock("@hey-hey/ui-common/components", async () => {
  const actual = await vi.importActual<
    typeof import("@hey-hey/ui-common/components")
  >("@hey-hey/ui-common/components");
  return {
    Card: actual.Card,
    EntityIcon: ({ entityType }: { entityType: string }) => (
      <span data-testid="entity-icon">{entityType}</span>
    ),
    EntityNodeStatusChip: ({ status }: { status?: string }) =>
      status ? <span data-testid="entity-status">{status}</span> : null,
  };
});

vi.mock("@hey-hey/ui-common/data", () => ({
  useWorkItemTypes: () => ({
    workItemTypes: [
      { definition: { key: "STANDARD", name: "Tasks" }, isSystem: true },
    ],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@hey-hey/ui-common/feature-tree-visualization", () => ({
  default: ({
    focusedFeatureId,
    activeFeatureId,
    dataSource,
  }: {
    focusedFeatureId?: string;
    activeFeatureId?: string;
    dataSource?: string;
  }) => (
    <div
      data-testid="feature-tree-visualization"
      data-focused-feature-id={focusedFeatureId}
      data-active-feature-id={activeFeatureId}
      data-source={dataSource}
    />
  ),
}));

vi.mock("@hey-hey/ui-common/services", () => ({
  WebPathService: {
    task: ({ projectId, taskId }: { projectId: string; taskId: string }) =>
      `/projects/${projectId}/tasks/${taskId}`,
    designDoc: ({
      projectId,
      designDocId,
    }: {
      projectId: string;
      designDocId: string;
    }) => `/projects/${projectId}/documents/${designDocId}`,
    agentSession: ({
      projectId,
      agentSessionId,
    }: {
      projectId: string;
      agentSessionId: string;
    }) => `/projects/${projectId}/sessions/${agentSessionId}`,
    plan: ({ projectId, planId }: { projectId: string; planId: string }) =>
      `/projects/${projectId}/plans/${planId}`,
    service: ({
      projectId,
      serviceId,
    }: {
      projectId: string;
      serviceId: string;
    }) => `/projects/${projectId}/services/${serviceId}`,
    user: ({ projectId, userId }: { projectId: string; userId: string }) =>
      `/projects/${projectId}/users/${userId}`,
  },
}));

const mockContextRailCards = vi.fn();
vi.mock("../../components/ContextRailCards", () => ({
  ContextRailCards: (props: {
    dataTestIdPrefix: string;
    parentWorkItemId?: string;
  }) => {
    mockContextRailCards(props);
    return (
      <>
        <div data-testid={`${props.dataTestIdPrefix}-history-card`} />
        <div data-testid={`${props.dataTestIdPrefix}-related-card`} />
      </>
    );
  },
}));

const renderSidebar = (
  featureAncestors: BreadcrumbFeatureAncestor[],
  relatedEntities: ContextRelatedEntityDto[] = [],
  proposals: ProposalResponseDto[] = []
): void => {
  render(
    <MemoryRouter>
      <TaskDetailSidebar
        organizationId="org-1"
        projectId="project-1"
        workItemId="task-1"
        featureAncestors={featureAncestors}
        relatedEntities={relatedEntities}
        proposals={proposals}
      />
    </MemoryRouter>
  );
};

describe("TaskDetailSidebar", () => {
  it("renders the feature tree focused on the nearest ancestor feature", async () => {
    renderSidebar([
      { id: "feature-root", name: "Root" },
      { id: "feature-mid", name: "Mid" },
      { id: "feature-direct-parent", name: "Direct Parent" },
    ]);

    const tree = await screen.findByTestId("feature-tree-visualization");
    expect(tree).toHaveAttribute(
      "data-focused-feature-id",
      "feature-direct-parent"
    );
    expect(tree).toHaveAttribute(
      "data-active-feature-id",
      "feature-direct-parent"
    );
    expect(tree).toHaveAttribute("data-source", "local-neighborhood");
  });

  it("renders the feature tree card", () => {
    renderSidebar([]);
    expect(
      screen.getByTestId("task-sidebar-feature-tree-card")
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Feature Tree" })).toBeVisible();
  });

  it("shows a fallback when there are no parent features", () => {
    renderSidebar([]);
    expect(screen.getByText("No parent features.")).toBeInTheDocument();
  });

  it("renders the shared rail cards below Feature Tree for the page's work item", () => {
    renderSidebar([]);
    const featureTree = screen.getByTestId("task-sidebar-feature-tree-card");
    const history = screen.getByTestId("task-sidebar-history-card");
    expect(
      featureTree.compareDocumentPosition(history) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getByTestId("task-sidebar-related-card")).toBeInTheDocument();
    expect(mockContextRailCards).toHaveBeenCalledWith(
      expect.objectContaining({
        dataTestIdPrefix: "task-sidebar",
        parentWorkItemId: "task-1",
      })
    );
  });
});
