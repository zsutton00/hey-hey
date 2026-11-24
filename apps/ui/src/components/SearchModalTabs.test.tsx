import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SearchModalTabs } from "./SearchModalTabs";

const { useExplorerSectionsMock, useWorkItemsMock, useServicesMock } =
  vi.hoisted(() => ({
    useExplorerSectionsMock: vi.fn(),
    useWorkItemsMock: vi.fn(),
    useServicesMock: vi.fn(),
  }));

vi.mock("../hooks/useExplorerSections", () => ({
  useExplorerSections: useExplorerSectionsMock,
}));

vi.mock("@hey-hey/ui-common/data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hey-hey/ui-common/data")>()),
  useWorkItems: useWorkItemsMock,
  useServices: useServicesMock,
}));

vi.mock("@hey-hey/ui-common/components/AdvancedSearch", () => ({
  AdvancedSearch: ({
    onHasContent,
  }: {
    onHasContent: (v: boolean) => void;
  }) => (
    <div data-testid="advanced-search">
      <button type="button" onClick={() => onHasContent(true)}>
        fake-result
      </button>
    </div>
  ),
}));

vi.mock("@hey-hey/ui-common/components", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hey-hey/ui-common/components")>()),
  FeaturePicker: ({
    inline,
    onChange,
  }: {
    inline?: boolean;
    onChange: (id: string, feature: { id: string }) => void;
  }) => (
    <button
      type="button"
      data-testid="inline-feature-picker"
      data-inline={String(inline)}
      onClick={() => onChange("feat-1", { id: "feat-1" })}
    >
      pick
    </button>
  ),
}));

const section = (key: string, label: string) => ({
  key,
  label,
  summary: {} as never,
});

const LocationProbe = () => (
  <div data-testid="path">{useLocation().pathname}</div>
);

const renderTabs = (onClose = vi.fn(), onHasContent = vi.fn()) => {
  render(
    <MemoryRouter>
      <SearchModalTabs
        config={{ organizationId: "org-1", onSelect: vi.fn() }}
        projectId="p1"
        onClose={onClose}
        onHasContent={onHasContent}
      />
      <Routes>
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
  return { onClose, onHasContent };
};

describe("SearchModalTabs", () => {
  beforeEach(() => {
    localStorage.clear();
    useExplorerSectionsMock.mockReturnValue({
      isReady: true,
      isLoading: false,
      workItemSections: [
        section("FEATURE", "Features"),
        section("RISK", "Risks"),
      ],
    });
    useWorkItemsMock.mockReturnValue({
      workItems: [
        { id: "r2", name: "Zeta risk", type: "RISK" },
        { id: "r1", name: "Alpha risk", type: "RISK" },
      ],
      isLoading: false,
      error: null,
    });
    useServicesMock.mockReturnValue({
      services: [{ id: "s1", name: "API" }],
      isLoading: false,
      error: null,
    });
  });

  const tabIds = () =>
    screen
      .getAllByTestId("search-modal-tab")
      .map((tab) => tab.getAttribute("data-tab-id"));

  it("lists Search, registry sections in Explorer order (including custom types), then Services", () => {
    renderTabs();

    expect(tabIds()).toEqual([
      "search",
      "work-item:FEATURE",
      "work-item:RISK",
      "services",
    ]);
  });

  it("shows only Search with a loading indicator until the registry is ready", () => {
    useExplorerSectionsMock.mockReturnValue({
      isReady: false,
      isLoading: true,
      workItemSections: [],
    });
    renderTabs();

    expect(tabIds()).toEqual(["search"]);
    expect(screen.getByTestId("search-modal-tabs-loading")).toBeInTheDocument();
  });

  it("restores the last-used tab per project and falls back to Search when it is gone", () => {
    localStorage.setItem("search_modal_last_tab:p1", "work-item:RISK");
    renderTabs();
    expect(screen.getByTestId("search-browse-list")).toBeInTheDocument();
  });

  it("falls back to Search when the remembered tab no longer exists", () => {
    localStorage.setItem("search_modal_last_tab:p1", "work-item:GONE");
    renderTabs();
    expect(screen.queryByTestId("search-browse-list")).not.toBeInTheDocument();
    expect(screen.getByTestId("advanced-search")).toBeVisible();
  });

  it("remembers the chosen tab", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("tab", { name: "Services" }));
    expect(localStorage.getItem("search_modal_last_tab:p1")).toBe("services");
  });

  it("browses a type tab sorted by name, filters by title, and navigates and closes on choose", () => {
    const { onClose } = renderTabs();
    fireEvent.click(screen.getByRole("tab", { name: "Risks" }));

    const rows = screen.getAllByTestId("search-browse-row");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Alpha risk",
      "Zeta risk",
    ]);

    fireEvent.change(screen.getByTestId("search-browse-filter"), {
      target: { value: "zeta" },
    });
    expect(screen.getAllByTestId("search-browse-row")).toHaveLength(1);

    fireEvent.change(screen.getByTestId("search-browse-filter"), {
      target: { value: "" },
    });
    expect(screen.getAllByTestId("search-browse-row")).toHaveLength(2);

    fireEvent.click(screen.getAllByTestId("search-browse-row")[0]);
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByTestId("path").textContent).toContain("r1");
  });

  it("shows the feature tree inline on the Features tab and opens the chosen feature", () => {
    const { onClose } = renderTabs();
    fireEvent.click(screen.getByRole("tab", { name: "Features" }));

    const picker = screen.getByTestId("inline-feature-picker");
    expect(picker).toHaveAttribute("data-inline", "true");

    fireEvent.click(picker);
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByTestId("path").textContent).toContain("feat-1");
  });

  it("grows the modal for a browse tab and drops back on an empty Search tab", () => {
    const { onHasContent } = renderTabs();
    expect(onHasContent).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByRole("tab", { name: "Risks" }));
    expect(onHasContent).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByRole("tab", { name: "Search" }));
    expect(onHasContent).toHaveBeenLastCalledWith(false);
  });
});
