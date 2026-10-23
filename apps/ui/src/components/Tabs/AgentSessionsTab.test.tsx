import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionsTab } from "./AgentSessionsTab";

const paginatedFeedMock = vi.fn();
const legacyListMock = vi.fn();

vi.mock("@hey-hey/ui-common/components", () => ({
  AgentSessionsList: (props: { serviceId?: string }) => {
    legacyListMock(props);
    return <div data-testid="legacy-agent-sessions-list" />;
  },
  EntityFilters: (props: {
    onChange: (key: string, value: unknown) => void;
    onSortChange: (value: string) => void;
  }) => (
    <div>
      <input
        aria-label="search"
        onChange={(event) => props.onChange("search", event.target.value)}
      />
      <button onClick={() => props.onSortChange("name-asc")} type="button">
        Sort
      </button>
    </div>
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("../Activity/PaginatedCodingSessionsFeed", () => ({
  PaginatedCodingSessionsFeed: (props: Record<string, unknown>) => {
    paginatedFeedMock(props);
    return <div data-testid="paginated-coding-sessions-feed" />;
  },
}));

describe("AgentSessionsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the paginated, service-scoped feed while preserving filters", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <AgentSessionsTab
        enableFilters
        organizationId="org-1"
        projectId="project-1"
        serviceId="service-1"
      />,
    );

    await user.type(screen.getByRole("textbox", { name: "search" }), "UI");
    await user.click(screen.getByRole("button", { name: "Sort" }));

    expect(paginatedFeedMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        search: "UI",
        serviceId: "service-1",
        sortBy: "name-asc",
      }),
    );
    expect(
      screen.getByTestId("paginated-coding-sessions-feed"),
    ).toBeInTheDocument();

    rerender(
      <AgentSessionsTab
        enableFilters
        organizationId="org-1"
        projectId="project-1"
      />,
    );

    expect(
      screen.getByTestId("legacy-agent-sessions-list"),
    ).toBeInTheDocument();
    expect(legacyListMock).toHaveBeenCalled();
  });
});
