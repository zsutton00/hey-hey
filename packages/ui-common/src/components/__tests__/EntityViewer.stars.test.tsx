import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EntityType,
  TaskSource,
  WorkStatus,
  type TaskResponseDto,
} from "../../api";

const { useEntityStar } = vi.hoisted(() => ({ useEntityStar: vi.fn() }));

vi.mock("../../data/hooks/useEntityStars", () => ({
  useEntityStar,
}));

vi.mock("../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeByKey: vi.fn(() => ({
    workItemTypeDefinition: undefined,
    isFetched: false,
  })),
}));

vi.mock("../InteractionComponent/InteractionComponent", () => ({
  InteractionComponent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("../shared/WorkItemReadView", () => ({
  WorkItemReadView: (props: {
    htmlCssRenderingContext?: "inline" | "page";
  }) => (
    <div
      data-testid="work-item-read-view"
      data-rendering-context={props.htmlCssRenderingContext}
    />
  ),
}));

import { EntityViewer } from "../EntityViewer";

const task = {
  id: "task-1",
  name: "Task One",
  type: "STANDARD",
  organizationId: "org-1",
  projectId: "project-1",
  status: WorkStatus.Backlog,
  source: TaskSource.User,
  sections: [],
} satisfies TaskResponseDto;

describe("EntityViewer star title control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEntityStar.mockReturnValue({
      isStarred: true,
      isLoading: false,
      isMutating: false,
      error: null,
      mutationError: null,
      toggle: vi.fn(),
    });
  });

  it("uses the organization and generated entity type for the page title", () => {
    render(
      <EntityViewer
        entityType={EntityType.Task}
        entity={task}
        organizationId="org-1"
        projectId="project-1"
      />
    );

    expect(screen.getByTestId("entity-page-title")).toHaveTextContent(
      "Task One"
    );
    expect(screen.getByRole("button", { name: "Unstar" })).toBeInTheDocument();
    expect(useEntityStar).toHaveBeenCalledWith(
      "org-1",
      EntityType.Task,
      "task-1"
    );
    expect(screen.getByTestId("work-item-read-view")).toHaveAttribute(
      "data-rendering-context",
      "page"
    );
  });
});
