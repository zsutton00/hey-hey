import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReconciliationReference } from "../ReconciliationReference";
const mocks = vi.hoisted(() => ({ details: vi.fn() }));
vi.mock("../../../data/hooks/useEntityDetails", () => ({
  useEntityDetails: mocks.details,
}));
vi.mock("../../../data/hooks/useUsers", () => ({
  useUsers: () => ({ data: [], isLoading: false }),
}));
vi.mock("../../Entity/EntityLinkWithPreview", () => ({
  EntityLinkWithPreview: ({
    entityId,
    label,
  }: {
    entityId: string;
    label: string;
  }) => <a href={`/items/${entityId}`}>{label}</a>,
}));
describe("reconciliation references", () => {
  it("links a resolved name without displaying the identifier", () => {
    mocks.details.mockReturnValue({
      data: { name: "Parent capability" },
      isLoading: false,
    });
    render(
      <ReconciliationReference
        entityId="parent-id"
        entityType="task"
        organizationId="org"
        projectId="project"
      />,
    );
    expect(
      screen.getByRole("link", { name: "Parent capability" }),
    ).toHaveAttribute("href", "/items/parent-id");
    expect(screen.queryByText("parent-id")).toBeNull();
  });
  it("states unavailable evidence instead of using an identifier as a title", () => {
    mocks.details.mockReturnValue({ data: null, isLoading: false });
    render(
      <ReconciliationReference
        entityId="missing-id"
        entityType="task"
        organizationId="org"
        projectId="project"
      />,
    );
    expect(
      screen.getByText("Reference details are unavailable."),
    ).toBeVisible();
    expect(screen.queryByText("missing-id")).toBeNull();
  });
});
