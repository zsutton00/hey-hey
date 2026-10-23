import type { ContextRelatedEntityDto } from "@hey-hey/ui-common/api";
import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ContextRailCards } from "./ContextRailCards";

const mockUseWorkItems = vi.fn();

vi.mock("@hey-hey/ui-common/data", () => ({
  useWorkItems: (...args: unknown[]) => mockUseWorkItems(...args),
}));

vi.mock("../HistoryCard", () => ({
  HistoryCard: ({ dataTestId }: { dataTestId: string }) => (
    <div data-testid={dataTestId} />
  ),
}));

vi.mock("../RelatedCard", () => ({
  RelatedCard: ({
    dataTestId,
    loading,
  }: {
    dataTestId: string;
    loading: boolean;
  }) => <div data-testid={dataTestId} data-loading={String(loading)} />,
}));

vi.mock("@hey-hey/ui-common/components", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hey-hey/ui-common/components")>()),
  VisualArtifactCard: ({
    artifact,
  }: {
    artifact: { entityId: string; typeKey: string };
  }) => (
    <div
      data-testid={`visual-artifact-card-${artifact.entityId}`}
      data-type-key={artifact.typeKey}
    />
  ),
}));

const related = (
  entityId: string,
  taskType: string,
  relationship = "related-to",
  entityType = "TASK"
): ContextRelatedEntityDto =>
  ({
    entityId,
    entityType,
    displayName: entityId,
    relationship,
    taskType,
  } as ContextRelatedEntityDto);

describe("ContextRailCards", () => {
  beforeEach(() => {
    mockUseWorkItems.mockReset();
    mockUseWorkItems.mockImplementation(
      (
        _org: string,
        _kind: string,
        _project: string,
        _initiative: undefined,
        options: { taskType: string; parentTaskId?: string }
      ) => ({
        workItems:
          options.taskType === "DIAGRAM" && options.parentTaskId
            ? [
                {
                  id: "child-diagram",
                  type: "DIAGRAM",
                  name: "Child Diagram",
                  parentTaskId: options.parentTaskId,
                },
              ]
            : [],
        isLoading: false,
      })
    );
  });

  const renderCards = (relatedLoading = false) =>
    render(
      <MemoryRouter>
        <ContextRailCards
          proposals={[]}
          relatedEntities={[related("linked-mockup", "mockup")]}
          organizationId="org-1"
          projectId="project-1"
          conversationPathForId={(id) => `/c/${id}`}
          parentWorkItemId="task-1"
          dataTestIdPrefix="rail"
          relatedLoading={relatedLoading}
        />
      </MemoryRouter>
    );

  it("renders History, then visual cards, then Related", () => {
    const { container } = renderCards();

    const order = Array.from(container.querySelectorAll("[data-testid]")).map(
      (element) => element.getAttribute("data-testid")
    );
    expect(order).toEqual([
      "rail-history-card",
      "visual-artifact-card-child-diagram",
      "visual-artifact-card-linked-mockup",
      "rail-related-card",
    ]);
  });

  it("lists the page's children by parent for Mockup and Diagram types", () => {
    renderCards();
    const requestedTypes = mockUseWorkItems.mock.calls.map(
      (call) => call[4] as { taskType: string; parentTaskId: string }
    );
    expect(requestedTypes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskType: "mockup", parentTaskId: "task-1" }),
        expect.objectContaining({
          taskType: "DIAGRAM",
          parentTaskId: "task-1",
        }),
      ])
    );
  });

  it("holds only Related while the host settles", () => {
    renderCards(true);
    expect(screen.getByTestId("rail-history-card")).toBeInTheDocument();
    expect(screen.getByTestId("rail-related-card")).toHaveAttribute(
      "data-loading",
      "true"
    );
    expect(
      screen.getByTestId("visual-artifact-card-linked-mockup")
    ).toBeInTheDocument();
  });
});
