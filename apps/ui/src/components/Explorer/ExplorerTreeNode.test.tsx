import { TargetEntityType } from "@hey-hey/ui-common/api";
import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ExplorerTreeNode } from "./ExplorerTreeNode";
import type { ExplorerNode } from "./types";

vi.mock("@hey-hey/ui-common", () => ({
  getStatusColorMapping: () => "primary",
}));

vi.mock("@hey-hey/ui-common/services", () => ({
  WebPathService: {
    feature: ({
      featureId,
      projectId,
    }: {
      featureId: string;
      projectId: string;
    }) => `/projects/${projectId}/features/${featureId}`,
    task: ({ taskId, projectId }: { taskId: string; projectId: string }) =>
      `/projects/${projectId}/tasks/${taskId}`,
  },
}));

vi.mock("@hey-hey/ui-common/components/Entity", () => ({
  EntityIcon: ({ entityType }: { entityType: string }) => (
    <span data-icon-type={entityType}>icon</span>
  ),
}));

vi.mock("@hey-hey/ui-common/components/InteractionComponent", () => ({
  InteractionComponent: ({
    entityType,
    entitySubtype,
    children,
  }: {
    entityType: string;
    entitySubtype?: string;
    children: React.ReactNode;
  }) => (
    <div
      data-testid="interaction-component"
      data-entity-type={entityType}
      data-entity-subtype={entitySubtype ?? ""}
    >
      {children}
    </div>
  ),
}));

function makeNode(type: ExplorerNode["type"], id: string): ExplorerNode {
  return {
    id,
    type,
    name: `${type} node`,
    hasChildren: false,
    depth: 0,
  };
}

function renderNode(node: ExplorerNode): void {
  render(
    <MemoryRouter initialEntries={["/projects/project-1"]}>
      <ExplorerTreeNode
        isExpanded={false}
        isSelected={false}
        node={node}
        onSelect={vi.fn()}
        onToggle={vi.fn()}
        organizationId="org-1"
        projectId="project-1"
      />
    </MemoryRouter>,
  );
}

describe("ExplorerTreeNode interaction target type", () => {
  it("maps a plan node to TargetEntityType.Plan, not PlanStage", () => {
    renderNode(makeNode("plan", "plan-1"));

    expect(screen.getByTestId("interaction-component")).toHaveAttribute(
      "data-entity-type",
      TargetEntityType.Plan,
    );
  });

  it("maps a feature node to TargetEntityType.Task", () => {
    renderNode(makeNode("feature", "feature-1"));

    expect(screen.getByTestId("interaction-component")).toHaveAttribute(
      "data-entity-type",
      TargetEntityType.Task,
    );
  });

  it("maps a goal node to the goal interaction registry key", () => {
    renderNode(makeNode("goal", "goal-1"));

    expect(screen.getByTestId("interaction-component")).toHaveAttribute(
      "data-entity-type",
      "GOAL",
    );
  });

  it("links a goal node through the canonical project task route", () => {
    renderNode(makeNode("goal", "goal-1"));

    expect(screen.getByRole("link", { name: /goal node/ })).toHaveAttribute(
      "href",
      "/projects/project-1/tasks/goal-1",
    );
  });

  it("maps a service node to the SERVICE target type", () => {
    renderNode(makeNode("service", "service-1"));

    expect(screen.getByTestId("interaction-component")).toHaveAttribute(
      "data-entity-type",
      TargetEntityType.Service,
    );
  });

  it("does not expose selected state on explorer tree rows", () => {
    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <ExplorerTreeNode
          isExpanded={false}
          isSelected={true}
          node={makeNode("feature", "feature-1")}
          onSelect={vi.fn()}
          onToggle={vi.fn()}
          organizationId="org-1"
          projectId="project-1"
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("treeitem")).not.toHaveAttribute(
      "aria-selected",
    );
  });
});
