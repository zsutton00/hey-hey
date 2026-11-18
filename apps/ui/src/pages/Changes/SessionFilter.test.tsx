import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionFilter } from "./SessionFilter";

const { titleOptions, sessionById } = vi.hoisted(() => ({
  titleOptions: vi.fn(),
  sessionById: vi.fn(),
}));
vi.mock("@hey-hey/ui-common/data", () => ({
  useAgentSessionTitleOptions: titleOptions,
  useAgentSession: sessionById,
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

const results = (overrides = {}) => ({
  options: [{ id: "a", title: "Alpha" }],
  hasNextPage: false,
  isLoading: false,
  isFetchingNextPage: false,
  initialError: null,
  nextPageError: null,
  loadNextPage: vi.fn(),
  retry: vi.fn(),
  ...overrides,
});

const renderFilter = (value: string | null = null) => {
  const onChange = vi.fn();
  render(
    <SessionFilter
      organizationId="org"
      projectId="project"
      value={value}
      onChange={onChange}
    />,
  );
  return onChange;
};

describe("SessionFilter", () => {
  it("shows a URL-selected session's title even when it is not in the loaded page, and clears it", () => {
    titleOptions.mockReturnValue(results());
    sessionById.mockReturnValue({
      agentSession: { id: "far", title: "Far away session" },
    });
    const onChange = renderFilter("far");

    expect(screen.getByDisplayValue("Far away session")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("changes.clearSession"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("selects a result and offers Load more only when another page exists", () => {
    const loadNextPage = vi.fn();
    titleOptions.mockReturnValue(results({ hasNextPage: true, loadNextPage }));
    sessionById.mockReturnValue({ agentSession: null });
    const onChange = renderFilter();

    fireEvent.mouseDown(screen.getByRole("combobox"));
    fireEvent.click(screen.getByTestId("changes-session-load-more"));
    expect(loadNextPage).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Alpha"));
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("shows retry for a failed first page instead of an empty result", () => {
    const retry = vi.fn();
    titleOptions.mockReturnValue(
      results({ options: [], initialError: new Error("x"), retry }),
    );
    sessionById.mockReturnValue({ agentSession: null });
    renderFilter();

    fireEvent.mouseDown(screen.getByRole("combobox"));
    expect(screen.queryByText("changes.sessionNoResults")).toBeNull();
    fireEvent.click(screen.getByTestId("changes-session-retry"));
    expect(retry).toHaveBeenCalled();
  });

  it("shows the empty-result message when a search matches nothing", () => {
    titleOptions.mockReturnValue(results({ options: [] }));
    sessionById.mockReturnValue({ agentSession: null });
    renderFilter();

    fireEvent.mouseDown(screen.getByRole("combobox"));
    expect(screen.getByText("changes.sessionNoResults")).toBeInTheDocument();
  });
});
