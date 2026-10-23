import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkItemTypeRole,
  WorkStatus,
  type WorkItemTypeDefinitionDto,
} from "../../../api";
import { PreviewHostProvider } from "../../../contexts/PreviewHostContext";
import type { WorkItemReferencePageState } from "../../../data/hooks/useWorkItemReferences";
import { WorkItemReferencePickerDialog } from "../slashCommands/WorkItemReferencePickerDialog";

const hookState = vi.hoisted(() => ({
  current: null as WorkItemReferencePageState | null,
  inputs: [] as Array<{
    page: number;
    filter?: string;
    statuses?: readonly WorkStatus[];
    sortBy?: string;
    sortOrder?: string;
  }>,
}));

const openPreview = vi.fn();

vi.mock("../EntityHoverCard", () => ({
  EntityHoverCard: ({ entityId }: { entityId: string }) => (
    <div data-testid="work-item-reference-hover-preview">{entityId}</div>
  ),
}));

vi.mock("../../../data/hooks/useWorkItemReferences", () => ({
  useWorkItemReferencePage: (input: { page: number; filter?: string }) => {
    hookState.inputs.push(input);
    return hookState.current;
  },
}));

const definition = {
  key: "CONTRACT",
  name: "Contract",
  role: WorkItemTypeRole.ProjectInfo,
  sections: [],
  allowedStatuses: [WorkStatus.Active, WorkStatus.Completed],
} satisfies WorkItemTypeDefinitionDto;

const page = {
  items: [
    {
      id: "contract-1",
      name: "Reference promise",
      type: "CONTRACT",
      parentTaskId: null,
    },
  ],
  pagination: {
    page: 1,
    limit: 20,
    total: 21,
    totalPages: 2,
    hasNext: true,
    hasPrevious: false,
  },
};

describe("WorkItemReferencePickerDialog", () => {
  beforeEach(() => {
    hookState.inputs.length = 0;
    openPreview.mockReset();
    hookState.current = { status: "ready", page, isFetching: false };
  });

  it("filters, pages, and returns the selected source-backed reference", async () => {
    const onSelect = vi.fn();
    renderDialog(onSelect);

    expect(screen.getByTestId("entity-kind-icon")).toHaveStyle({
      alignSelf: "center",
    });
    expect(screen.getByText("Reference promise")).toHaveStyle({
      fontSize: "1.125rem",
    });
    expect(screen.getByTestId("entity-kind-icon").parentElement).toHaveStyle({
      gap: "6px",
    });
    expect(screen.getByText("Reference promise").closest("li")).toHaveStyle({
      borderWidth: "0px",
    });

    fireEvent.click(screen.getByText("Reference promise"));
    expect(onSelect).toHaveBeenCalledWith(page.items[0]);

    fireEvent.change(screen.getByTestId("work-item-reference-filter"), {
      target: { value: "promise" },
    });
    expect(hookState.inputs.at(-1)?.filter).toBe("");
    await waitFor(() =>
      expect(hookState.inputs.at(-1)).toEqual(
        expect.objectContaining({ page: 1, filter: "promise" })
      )
    );

    fireEvent.click(screen.getByRole("button", { name: "Go to page 2" }));
    await waitFor(() =>
      expect(hookState.inputs.at(-1)).toEqual(
        expect.objectContaining({ page: 2 })
      )
    );
  });

  it("derives status filters from the type definition and sends deterministic sort", async () => {
    renderDialog();

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Status" }));
    fireEvent.click(screen.getByRole("option", { name: "In progress" }));
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });

    await waitFor(() =>
      expect(hookState.inputs.at(-1)).toEqual(
        expect.objectContaining({
          page: 1,
          statuses: [WorkStatus.Active],
          sortBy: "name",
          sortOrder: "asc",
        })
      )
    );

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Sort" }));
    fireEvent.click(screen.getByRole("option", { name: "Newest first" }));
    await waitFor(() =>
      expect(hookState.inputs.at(-1)).toEqual(
        expect.objectContaining({ sortBy: "createdAt", sortOrder: "desc" })
      )
    );
  });

  it("shows the shared hover preview and opens the canonical Preview action", async () => {
    renderDialog();

    const row = screen.getByTestId("work-item-reference-row");
    fireEvent.mouseEnter(row);
    expect(
      await screen.findByTestId(
        "work-item-reference-hover-preview",
        {},
        {
          timeout: 700,
        }
      )
    ).toHaveTextContent("contract-1");

    fireEvent.click(
      screen.getByRole("button", { name: "Preview Reference promise" })
    );
    expect(openPreview).toHaveBeenCalledWith({
      entityType: "task",
      entityId: "contract-1",
    });
  });

  it("keeps a fixed update-progress slot below the result list", () => {
    hookState.current = { status: "updating", page, isFetching: true };
    const { rerender } = renderDialog();

    const results = screen.getByTestId("work-item-reference-results");
    const progressSlot = screen.getByTestId(
      "work-item-reference-update-progress-slot"
    );
    expect(
      results.compareDocumentPosition(progressSlot) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0);
    expect(
      screen.getByRole("progressbar", {
        name: "Updating work-item references",
      })
    ).toBeVisible();

    hookState.current = { status: "ready", page, isFetching: false };
    rerender(renderDialogContent());

    const settledProgressSlot = screen.getByTestId(
      "work-item-reference-update-progress-slot"
    );
    expect(settledProgressSlot).toBeInTheDocument();
    expect(
      settledProgressSlot.querySelector('[role="progressbar"]')
    ).not.toBeVisible();
  });

  it.each([
    [
      "loading",
      { status: "loading", page: null, isFetching: true } as const,
      "work-item-reference-loading",
    ],
    [
      "empty",
      {
        status: "empty",
        page: { ...page, items: [] },
        isFetching: false,
      } as const,
      "work-item-reference-empty",
    ],
    [
      "error",
      {
        status: "error",
        page: null,
        isFetching: false,
        error: new Error("failed"),
      } as const,
      "work-item-reference-error",
    ],
  ])("renders the %s state", (_name, state, testId) => {
    hookState.current = state;
    renderDialog();

    expect(screen.getByTestId(testId)).toBeVisible();
  });
});

const renderDialogContent = (onSelect = vi.fn()) => (
  <PreviewHostProvider host={{ openPreview }}>
    <WorkItemReferencePickerDialog
      organizationId="org-1"
      projectId="project-1"
      definition={definition}
      onClose={vi.fn()}
      onSelect={onSelect}
    />
  </PreviewHostProvider>
);

const renderDialog = (onSelect = vi.fn()) =>
  render(renderDialogContent(onSelect));
