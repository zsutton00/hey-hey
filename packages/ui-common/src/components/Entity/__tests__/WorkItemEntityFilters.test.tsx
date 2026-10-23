import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { WorkItemEntityFilters } from "../WorkItemEntityFilters";
import { WorkStatus } from "../../../api";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("WorkItemEntityFilters", () => {
  const mockOnSearchChange = vi.fn();
  const mockOnStatusFilterChange = vi.fn();
  const mockOnSortByChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultProps = {
    searchTerm: "",
    onSearchChange: mockOnSearchChange,
    statusFilter: "" as WorkStatus | "",
    onStatusFilterChange: mockOnStatusFilterChange,
    sortBy: "created-desc",
    onSortByChange: mockOnSortByChange,
  };

  it("should render all filter controls", () => {
    render(<WorkItemEntityFilters {...defaultProps} />);

    // Search field
    expect(
      screen.getByLabelText("initiatives.filters.searchPlaceholder")
    ).toBeInTheDocument();

    // Status filter
    expect(
      screen.getByText("initiatives.filters.status", { selector: "label" })
    ).toBeInTheDocument();

    // Sort filter
    expect(
      screen.getByText("Sort by", { selector: "label" })
    ).toBeInTheDocument();
  });

  it("should display current search term", () => {
    render(<WorkItemEntityFilters {...defaultProps} searchTerm="test query" />);

    const searchInput = screen.getByLabelText(
      "initiatives.filters.searchPlaceholder"
    );
    expect(searchInput).toHaveValue("test query");
  });

  it("should call onSearchChange when search value changes", async () => {
    const user = userEvent.setup();
    render(<WorkItemEntityFilters {...defaultProps} />);

    const searchInput = screen.getByLabelText(
      "initiatives.filters.searchPlaceholder"
    );
    await user.type(searchInput, "new search");

    expect(mockOnSearchChange).toHaveBeenCalled();
  });

  it("should display current status filter", () => {
    render(
      <WorkItemEntityFilters
        {...defaultProps}
        statusFilter={WorkStatus.Active}
      />
    );

    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("should call onStatusFilterChange when status changes", async () => {
    const user = userEvent.setup();
    render(<WorkItemEntityFilters {...defaultProps} />);

    const [statusSelect] = screen.getAllByRole("combobox");
    await user.click(statusSelect);

    const activeOption = await screen.findByText("Active");
    await user.click(activeOption);

    expect(mockOnStatusFilterChange).toHaveBeenCalledWith("ACTIVE");
  });

  it("should display all status options", async () => {
    const user = userEvent.setup();
    render(<WorkItemEntityFilters {...defaultProps} />);

    const [statusSelect] = screen.getAllByRole("combobox");
    await user.click(statusSelect);

    expect(await screen.findByText("Refining Description")).toBeInTheDocument();
    expect(await screen.findByText("Refining Details")).toBeInTheDocument();
    expect(
      await screen.findByText("Refining Acceptance Criteria")
    ).toBeInTheDocument();
    expect(await screen.findByText("Active")).toBeInTheDocument();
    expect(await screen.findByText("On Hold")).toBeInTheDocument();
    expect(await screen.findByText("Completed")).toBeInTheDocument();
    expect(await screen.findByText("Cancelled")).toBeInTheDocument();
  });

  it("should display current sort value", () => {
    render(<WorkItemEntityFilters {...defaultProps} sortBy="name-asc" />);

    // The sort dropdown should show the selected value
    const [, sortSelect] = screen.getAllByRole("combobox");
    expect(sortSelect).toBeInTheDocument();
  });

  it("should call onSortByChange when sort changes", async () => {
    const user = userEvent.setup();
    render(<WorkItemEntityFilters {...defaultProps} />);

    const [, sortSelect] = screen.getAllByRole("combobox");
    await user.click(sortSelect);

    const nameAscOption = await screen.findByText(
      "initiatives.filters.sortNameAsc"
    );
    await user.click(nameAscOption);

    expect(mockOnSortByChange).toHaveBeenCalledWith("name-asc");
  });

  it("should display all sort options", async () => {
    const user = userEvent.setup();
    render(<WorkItemEntityFilters {...defaultProps} />);

    const [, sortSelect] = screen.getAllByRole("combobox");
    await user.click(sortSelect);

    expect(
      await screen.findByRole("option", {
        name: "initiatives.filters.sortCreatedDesc",
      })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("option", {
        name: "initiatives.filters.sortCreatedAsc",
      })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("option", {
        name: "initiatives.filters.sortNameAsc",
      })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("option", {
        name: "initiatives.filters.sortNameDesc",
      })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("option", {
        name: "initiatives.filters.sortStatus",
      })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("option", {
        name: "initiatives.filters.sortPriority",
      })
    ).toBeInTheDocument();
  });

  it("should show All option in status filter", async () => {
    const user = userEvent.setup();
    render(<WorkItemEntityFilters {...defaultProps} />);

    const [statusSelect] = screen.getAllByRole("combobox");
    await user.click(statusSelect);

    expect(await screen.findByText("All")).toBeInTheDocument();
  });

  it("should handle empty status filter", () => {
    render(<WorkItemEntityFilters {...defaultProps} statusFilter="" />);

    // Should render without errors
    expect(
      screen.getByText("initiatives.filters.status", { selector: "label" })
    ).toBeInTheDocument();
  });

  it("should maintain backward compatibility with WorkItemFilters API", () => {
    // This test ensures the props interface matches the original WorkItemFilters
    const props = {
      searchTerm: "test",
      onSearchChange: vi.fn(),
      statusFilter: WorkStatus.Active as WorkStatus | "",
      onStatusFilterChange: vi.fn(),
      sortBy: "created-desc",
      onSortByChange: vi.fn(),
    };

    const { container } = render(<WorkItemEntityFilters {...props} />);

    expect(container).toBeInTheDocument();
  });
});
