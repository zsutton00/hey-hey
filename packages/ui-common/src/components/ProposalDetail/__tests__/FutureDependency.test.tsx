import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { FutureDependency } from "../FutureDependency";

const reads = vi.hoisted(() => vi.fn(() => ({ workItem: undefined })));
vi.mock("../../../data/hooks/useWorkItem", () => ({ useWorkItem: reads }));
vi.mock("../../../data/hooks", async (original) => ({
  ...(await original<object>()),
  useWorkItem: reads,
}));
vi.mock("../../../data/hooks/useWorkItemTypes", async (original) => ({
  ...(await original<object>()),
  useMentionWorkItemTypeKey: (
    _org: string,
    _project: string,
    kind: string,
  ) => ({ typeKey: kind?.toUpperCase(), isResolved: true }),
  useWorkItemTypeByKey: () => ({ isFetched: false, error: null }),
}));
vi.mock("../../SmarterTextAreaCard/EntityHoverCard", () => ({
  EntityHoverCard: () => null,
}));
function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

describe("future dependency mention", () => {
  it.each(["STANDARD", "BUG", "PLAN"])(
    "renders and navigates supplied %s identity without entity reads",
    async (workItemType) => {
      reads.mockClear();
      render(
        <MemoryRouter>
          <Location />
          <FutureDependency
            organizationId="org"
            projectId="project"
            dependency={{
              availability: "AVAILABLE",
              targetEntityId: "work",
              title:
                "A deliberately long linked work title that still retains its full identity",
              workItemType,
            }}
          />
        </MemoryRouter>,
      );
      const badge = screen.getByTestId("mention-badge");
      expect(badge).toHaveAttribute(
        "data-mention-token",
        `@[${workItemType.toLowerCase()}:work|A deliberately long linked work title that still retains its full identity]`,
      );
      expect(reads).not.toHaveBeenCalled();
      fireEvent.click(badge);
      await waitFor(() =>
        expect(screen.getByTestId("location").textContent).toContain("work"),
      );
      expect(reads).not.toHaveBeenCalled();
    },
  );

  it("shows unavailability without fabricating a badge or loading the entity", () => {
    reads.mockClear();
    render(
      <MemoryRouter>
        <FutureDependency
          organizationId="org"
          projectId="project"
          dependency={{ availability: "UNAVAILABLE", targetEntityId: "hidden" }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Linked work unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("mention-badge")).not.toBeInTheDocument();
    expect(reads).not.toHaveBeenCalled();
  });
});
