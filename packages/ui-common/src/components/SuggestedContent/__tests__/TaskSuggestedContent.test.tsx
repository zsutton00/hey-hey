import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItemTypeDefinitionDto } from "../../../api";
import type { ContentItem } from "../SuggestedContent";
import { TaskSuggestedContent } from "../TaskSuggestedContent";

const mockUpdateTask = vi.fn();
const mockPublishSuggestionAppliedEvent = vi.fn();
const mockOnDecision = vi.fn();
let mockDefinition: WorkItemTypeDefinitionDto | undefined;
let mockDefinitionFetched = true;

vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: () => ({
    workItem: {
      id: "research-1",
      name: "Research item",
      type: "RESEARCH",
      status: "BACKLOG",
      organizationId: "org-1",
      projectId: "project-1",
      sections: [
        {
          id: "section-findings",
          key: "findings",
          order: 1,
          materializedMarkdown: "Old finding",
          crdtSnapshotSeq: null,
        },
      ],
    },
  }),
}));

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeTrackingEligibility: () => ({
    isAllowed: true,
    isReady: true,
    isLoading: false,
    error: null,
  }),
  useWorkItemTypeByKey: () => ({
    workItemTypeDefinition: mockDefinition,
    isFetched: mockDefinitionFetched,
    isLoading: !mockDefinitionFetched,
    error: null,
  }),
}));

vi.mock("../../../data", () => ({
  useWorkItemUpdateMethods: () => ({
    updateTask: (...args: unknown[]) => mockUpdateTask(...args),
  }),
}));

vi.mock("../../../services/editorSync/suggestionAppliedBus", () => ({
  publishSuggestionAppliedEvent: (...args: unknown[]) =>
    mockPublishSuggestionAppliedEvent(...args),
}));

vi.mock("../SuggestedContent", async () => {
  const actual = await vi.importActual<typeof import("../SuggestedContent")>(
    "../SuggestedContent"
  );
  return {
    ...actual,
    SuggestedContent: ({
      onAccept,
      getCurrentContent,
    }: {
      onAccept?: (items: ContentItem[]) => Promise<boolean | void>;
      getCurrentContent?: (key: string) => string;
    }) => (
      <div>
        <div data-testid="current-findings">
          {getCurrentContent?.("findings")}
        </div>
        <button
          type="button"
          data-testid="accept-custom-section"
          onClick={() => {
            void onAccept?.([{ key: "findings", content: "New finding" }]);
          }}
        >
          Accept
        </button>
      </div>
    ),
  };
});

const renderSuggestion = (): void => {
  render(
    <TaskSuggestedContent
      organizationId="org-1"
      projectId="project-1"
      taskId="research-1"
      onDecision={mockOnDecision}
    />
  );
};

describe("TaskSuggestedContent registry section selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefinitionFetched = true;
    mockDefinition = {
      key: "RESEARCH",
      name: "Research",
      sections: [
        { key: "sources", label: "Sources" },
        { key: "findings", label: "Findings" },
      ],
      allowedStatuses: [],
    };
    mockUpdateTask.mockImplementation(
      async (
        _taskId: unknown,
        _updates: unknown,
        callbacks?: { onSuccess?: () => void }
      ) => {
        callbacks?.onSuccess?.();
      }
    );
  });

  it("applies a custom declared key with its registry order", async () => {
    renderSuggestion();

    expect(screen.getByTestId("current-findings")).toHaveTextContent(
      "Old finding"
    );
    await userEvent.click(screen.getByTestId("accept-custom-section"));

    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledTimes(1));
    expect(mockUpdateTask.mock.calls[0][1].sections).toEqual([
      { key: "findings", content: "New finding", order: 1 },
    ]);
    expect(mockUpdateTask.mock.calls[0][2].sectionSelection).toMatchObject({
      status: "resolved",
      typeKey: "RESEARCH",
    });
    expect(mockPublishSuggestionAppliedEvent).toHaveBeenCalledWith({
      target: "work-item",
      entityType: "task",
      workItemId: "research-1",
      sections: [{ key: "findings", content: "New finding" }],
    });
  });

  it("does not apply suggestions while the definition is unresolved", async () => {
    mockDefinition = undefined;
    renderSuggestion();

    await userEvent.click(screen.getByTestId("accept-custom-section"));

    await waitFor(() => expect(mockUpdateTask).not.toHaveBeenCalled());
    expect(mockOnDecision).not.toHaveBeenCalled();
  });
});
