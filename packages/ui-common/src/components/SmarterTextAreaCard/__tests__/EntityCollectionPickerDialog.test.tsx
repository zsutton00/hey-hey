import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EntityCollectionPickerDialog } from "../slashCommands/EntityCollectionPickerDialog";

vi.mock("../EntityHoverCard", () => ({
  EntityHoverCard: ({ entityId }: { entityId: string }) => (
    <div data-testid="entity-collection-hover">{entityId}</div>
  ),
}));

const row = {
  entityId: "plan-1",
  entityType: "plan",
  entityName: "Launch plan",
  listItemProps: { title: "Launch plan" },
};

describe("EntityCollectionPickerDialog", () => {
  it("owns shared search, sort, paging, selection, and Preview presentation", () => {
    const onFilterChange = vi.fn();
    const onSortChange = vi.fn();
    const onPageChange = vi.fn();
    const onSelect = vi.fn();
    const onPreview = vi.fn();
    render(
      <EntityCollectionPickerDialog
        testIdPrefix="entity-collection"
        organizationId="org-1"
        projectId="project-1"
        title="Choose a plan"
        searchLabel="Search plans"
        errorMessage="Unable to load plans."
        rows={[row]}
        status="ready"
        filter=""
        sort="name-asc"
        page={1}
        totalPages={2}
        onFilterChange={onFilterChange}
        onSortChange={onSortChange}
        onPageChange={onPageChange}
        onClose={vi.fn()}
        onSelect={onSelect}
        onPreview={onPreview}
      />
    );

    fireEvent.change(screen.getByTestId("entity-collection-filter"), {
      target: { value: "launch" },
    });
    fireEvent.click(screen.getByText("Launch plan"));
    fireEvent.click(
      screen.getByRole("button", { name: "Preview Launch plan" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Go to page 2" }));

    expect(onFilterChange).toHaveBeenCalledWith("launch");
    expect(onSelect).toHaveBeenCalledWith(row);
    expect(onPreview).toHaveBeenCalledWith(row);
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it.each(["loading", "error", "empty", "updating"] as const)(
    "renders the explicit %s state",
    (status) => {
      render(
        <EntityCollectionPickerDialog
          testIdPrefix="entity-state"
          organizationId="org-1"
          projectId="project-1"
          title="Choose an entity"
          searchLabel="Search entities"
          errorMessage="Unable to load entities."
          rows={[]}
          status={status}
          filter=""
          sort="name-asc"
          page={1}
          totalPages={1}
          onFilterChange={vi.fn()}
          onSortChange={vi.fn()}
          onPageChange={vi.fn()}
          onClose={vi.fn()}
          onSelect={vi.fn()}
        />
      );

      if (status !== "updating") {
        expect(screen.getByTestId(`entity-state-${status}`)).toBeVisible();
      } else {
        expect(
          screen.getByRole("progressbar", { name: "Updating choose an entity" })
        ).toBeVisible();
      }
    }
  );

  it("dismisses with Escape", () => {
    const onClose = vi.fn();
    render(
      <EntityCollectionPickerDialog
        testIdPrefix="entity-dismiss"
        organizationId="org-1"
        projectId="project-1"
        title="Choose an entity"
        searchLabel="Search entities"
        errorMessage="Unable to load entities."
        rows={[row]}
        status="ready"
        filter=""
        sort="name-asc"
        page={1}
        totalPages={1}
        onFilterChange={vi.fn()}
        onSortChange={vi.fn()}
        onPageChange={vi.fn()}
        onClose={onClose}
        onSelect={vi.fn()}
      />
    );

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
