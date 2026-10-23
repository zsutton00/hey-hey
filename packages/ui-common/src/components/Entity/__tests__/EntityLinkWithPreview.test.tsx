import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntityLinkWithPreview } from "../EntityLinkWithPreview";

vi.mock("../../SmarterTextAreaCard/EntityHoverCard", () => ({
  EntityHoverCard: ({
    anchorEl,
    entityId,
    entityType,
    onPopoverMouseEnter,
    onPopoverMouseLeave,
    projectId,
  }: {
    anchorEl: HTMLElement | null;
    entityId: string;
    entityType: string;
    onPopoverMouseEnter?: () => void;
    onPopoverMouseLeave?: () => void;
    projectId?: string;
  }) =>
    anchorEl ? (
      <div
        data-testid="entity-hover-card"
        data-entity-id={entityId}
        data-entity-type={entityType}
        data-project-id={projectId}
        onMouseEnter={onPopoverMouseEnter}
        onMouseLeave={onPopoverMouseLeave}
      >
        Entity preview
      </div>
    ) : null,
}));

describe("EntityLinkWithPreview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the entity preview and keeps it open while moving from the title to the card", () => {
    render(
      <MemoryRouter>
        <EntityLinkWithPreview
          label="Preview target"
          entityId="task-target-1"
          entityType="TASK"
          organizationId="org-1"
          projectId="project-1"
        />
      </MemoryRouter>
    );

    const link = screen.getByRole("link", { name: "Preview target" });
    fireEvent.mouseEnter(link);
    act(() => {
      vi.advanceTimersByTime(300);
    });

    const card = screen.getByTestId("entity-hover-card");
    expect(card).toHaveAttribute("data-entity-id", "task-target-1");
    expect(card).toHaveAttribute("data-entity-type", "task");
    expect(card).toHaveAttribute("data-project-id", "project-1");

    fireEvent.mouseLeave(link);
    fireEvent.mouseEnter(card);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByTestId("entity-hover-card")).toBeInTheDocument();

    fireEvent.mouseLeave(card);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.queryByTestId("entity-hover-card")).not.toBeInTheDocument();
  });

  it("routes an arbitrary custom work-item key through the task preview", () => {
    render(
      <MemoryRouter>
        <EntityLinkWithPreview
          label="Research insight"
          entityId="finding-1"
          entityType="research_finding"
          organizationId="org-1"
          projectId="project-1"
        />
      </MemoryRouter>
    );

    const link = screen.getByRole("link", { name: "Research insight" });
    expect(link).toHaveAttribute("href", "/projects/project-1/tasks/finding-1");

    fireEvent.mouseEnter(link);
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByTestId("entity-hover-card")).toHaveAttribute(
      "data-entity-type",
      "task"
    );
    expect(screen.getByTestId("entity-hover-card")).toHaveAttribute(
      "data-project-id",
      "project-1"
    );
  });
});
