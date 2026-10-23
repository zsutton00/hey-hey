import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { EntityType } from "../../../api";
import { ContextMenu } from "../ContextMenu";

const toggle = vi.fn();
const { useEntityStar } = vi.hoisted(() => ({ useEntityStar: vi.fn() }));

vi.mock("../../../data/hooks/useEntityStars", () => ({
  useEntityStar,
}));

const baseProps = {
  position: { x: 10, y: 10 },
  contributions: [{
    id: "test-star",
    section: "shared" as const,
    order: 0,
    controller: "star" as const,
  }],
  onAction: vi.fn(),
  onViewHistory: vi.fn(),
  onNavigateToEntity: vi.fn(),
  onNavigateToConversation: vi.fn(),
  onClose: vi.fn(),
  star: {
    organizationId: "org-1",
    entityType: EntityType.Project,
    entityId: "project-1",
  },
};

describe("ContextMenu star action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toggle.mockResolvedValue(undefined);
    useEntityStar.mockReturnValue({
      isStarred: false,
      isLoading: false,
      isMutating: false,
      error: null,
      mutationError: null,
      toggle,
    });
  });

  it("uses the same generated entity scope and closes after a successful star", async () => {
    render(<ContextMenu {...baseProps} />);

    expect(screen.getByTestId("interaction-menu-star")).toHaveTextContent(
      "Star",
    );
    expect(
      screen.getByTestId("interaction-menu-star-outline-icon"),
    ).toBeInTheDocument();
    expect(useEntityStar).toHaveBeenCalledWith(
      "org-1",
      EntityType.Project,
      "project-1",
      { enabled: true },
    );

    fireEvent.click(screen.getByTestId("interaction-menu-star"));
    await waitFor(() => expect(toggle).toHaveBeenCalledTimes(1));
    expect(baseProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the shared unstar state and leaves the menu open on failure", async () => {
    toggle.mockRejectedValue(new Error("write failed"));
    useEntityStar.mockReturnValue({
      isStarred: true,
      isLoading: false,
      isMutating: false,
      error: new Error("write failed"),
      mutationError: new Error("write failed"),
      toggle,
    });

    render(<ContextMenu {...baseProps} />);

    expect(screen.getByTestId("interaction-menu-star")).toHaveTextContent(
      "Unstar",
    );
    expect(
      screen.getByTestId("interaction-menu-star-filled-icon"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("interaction-menu-star-error")).toHaveTextContent(
      "Unable to update star",
    );

    fireEvent.click(screen.getByTestId("interaction-menu-star"));
    await waitFor(() => expect(toggle).toHaveBeenCalledTimes(1));
    expect(baseProps.onClose).not.toHaveBeenCalled();
  });

  it("keeps the pending spinner, label, and disabled state while loading", () => {
    useEntityStar.mockReturnValue({
      isStarred: false,
      isLoading: true,
      isMutating: false,
      error: null,
      mutationError: null,
      toggle,
    });

    render(<ContextMenu {...baseProps} />);

    const starMenuItem = screen.getByTestId("interaction-menu-star");
    expect(starMenuItem).toHaveAttribute("aria-disabled", "true");
    expect(starMenuItem).toHaveTextContent("Loading star state...");
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });
});
