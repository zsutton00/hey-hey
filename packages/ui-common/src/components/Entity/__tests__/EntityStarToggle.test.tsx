import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { EntityType } from "../../../api";

const toggle = vi.fn();
const { useEntityStar } = vi.hoisted(() => ({ useEntityStar: vi.fn() }));

vi.mock("../../../data/hooks/useEntityStars", () => ({
  useEntityStar,
}));

import { EntityStarToggle } from "../EntityStarToggle";

const defaultState = () => ({
  isStarred: false,
  isLoading: false,
  isMutating: false,
  error: null,
  mutationError: null,
  toggle,
});

describe("EntityStarToggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEntityStar.mockReturnValue(defaultState());
    toggle.mockResolvedValue(undefined);
  });

  it("renders an accessible unstar control from the shared star state", () => {
    useEntityStar.mockReturnValue({
      ...defaultState(),
      isStarred: true,
    });

    render(
      <EntityStarToggle
        organizationId="org-1"
        entityType={EntityType.Project}
        entityId="project-1"
      />,
    );

    const button = screen.getByRole("button", { name: "Unstar" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(useEntityStar).toHaveBeenCalledWith(
      "org-1",
      EntityType.Project,
      "project-1",
    );
  });

  it("uses the shared mutation and prevents activation while pending", async () => {
    useEntityStar.mockReturnValue({
      ...defaultState(),
      isMutating: true,
    });

    const rendered = render(
      <EntityStarToggle
        organizationId="org-1"
        entityType={EntityType.Project}
        entityId="project-1"
      />,
    );

    const button = screen.getByRole("button", { name: "Star" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(toggle).not.toHaveBeenCalled();

    useEntityStar.mockReturnValue(defaultState());
    rendered.rerender(
      <EntityStarToggle
        organizationId="org-1"
        entityType={EntityType.Project}
        entityId="project-1"
      />,
    );
    fireEvent.click(rendered.getByRole("button", { name: "Star" }));
    await waitFor(() => expect(toggle).toHaveBeenCalledTimes(1));
  });

  it("reflects refreshed star state after a successful mutation", async () => {
    const userState = defaultState();
    useEntityStar.mockReturnValue(userState);
    const rendered = render(
      <EntityStarToggle
        organizationId="org-1"
        entityType={EntityType.Project}
        entityId="project-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Star" }));
    await waitFor(() => expect(toggle).toHaveBeenCalledTimes(1));

    useEntityStar.mockReturnValue({ ...userState, isStarred: true });
    rendered.rerender(
      <EntityStarToggle
        organizationId="org-1"
        entityType={EntityType.Project}
        entityId="project-1"
      />,
    );

    expect(screen.getByRole("button", { name: "Unstar" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("exposes a failed shared mutation to the surface", () => {
    const mutationError = new Error("write failed");
    useEntityStar.mockReturnValue({
      ...defaultState(),
      error: mutationError,
      mutationError,
    });

    render(
      <EntityStarToggle
        organizationId="org-1"
        entityType={EntityType.Project}
        entityId="project-1"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Unable to update star",
    );
  });
});
