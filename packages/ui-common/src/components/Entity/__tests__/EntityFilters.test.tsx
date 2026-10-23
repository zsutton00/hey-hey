import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { EntityFilters, type FilterConfig } from "../EntityFilters";
import userEvent from "@testing-library/user-event";

describe("EntityFilters", () => {
  const mockOnChange = vi.fn();
  const mockOnSortChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("search filter", () => {
    it("should render search filter", () => {
      const filters: FilterConfig[] = [
        {
          type: "search",
          key: "search",
          label: "Search",
          placeholder: "Search items",
        },
      ];

      render(
        <EntityFilters
          filters={filters}
          values={{ search: "" }}
          onChange={mockOnChange}
        />
      );

      const searchInput = screen.getByLabelText("Search");
      expect(searchInput).toBeInTheDocument();
      expect(searchInput).toHaveAttribute("placeholder", "Search items");
    });

    it("should call onChange when search value changes", async () => {
      const user = userEvent.setup();
      const filters: FilterConfig[] = [
        {
          type: "search",
          key: "search",
          label: "Search",
        },
      ];

      render(
        <EntityFilters
          filters={filters}
          values={{ search: "" }}
          onChange={mockOnChange}
        />
      );

      const searchInput = screen.getByLabelText("Search");
      await user.type(searchInput, "test");

      expect(mockOnChange).toHaveBeenCalled();
      expect(mockOnChange).toHaveBeenCalledWith("search", expect.any(String));
    });

    it("should display current search value", () => {
      const filters: FilterConfig[] = [
        {
          type: "search",
          key: "search",
          label: "Search",
        },
      ];

      render(
        <EntityFilters
          filters={filters}
          values={{ search: "existing value" }}
          onChange={mockOnChange}
        />
      );

      const searchInput = screen.getByDisplayValue("existing value");
      expect(searchInput).toBeInTheDocument();
    });
  });

  describe("select filter", () => {
    it("should render select filter with options", () => {
      const filters: FilterConfig[] = [
        {
          type: "select",
          key: "status",
          label: "Status",
          options: [
            { value: "active", label: "Active" },
            { value: "completed", label: "Completed" },
          ],
        },
      ];

      render(
        <EntityFilters
          filters={filters}
          values={{ status: "" }}
          onChange={mockOnChange}
        />
      );

      expect(
        screen.getByText("Status", { selector: "label" })
      ).toBeInTheDocument();
    });

    it("should call onChange when select value changes", async () => {
      const user = userEvent.setup();
      const filters: FilterConfig[] = [
        {
          type: "select",
          key: "status",
          label: "Status",
          options: [
            { value: "active", label: "Active" },
            { value: "completed", label: "Completed" },
          ],
        },
      ];

      render(
        <EntityFilters
          filters={filters}
          values={{ status: "" }}
          onChange={mockOnChange}
        />
      );

      const selectButton = screen.getByRole("combobox");
      await user.click(selectButton);

      const activeOption = await screen.findByText("Active");
      await user.click(activeOption);

      expect(mockOnChange).toHaveBeenCalledWith("status", "active");
    });

    it("should display selected value", async () => {
      const filters: FilterConfig[] = [
        {
          type: "select",
          key: "status",
          label: "Status",
          options: [
            { value: "active", label: "Active" },
            { value: "completed", label: "Completed" },
          ],
        },
      ];

      render(
        <EntityFilters
          filters={filters}
          values={{ status: "active" }}
          onChange={mockOnChange}
        />
      );

      expect(screen.getByText("Active")).toBeInTheDocument();
    });

    it("should show All option by default", async () => {
      const user = userEvent.setup();
      const filters: FilterConfig[] = [
        {
          type: "select",
          key: "status",
          label: "Status",
          options: [{ value: "active", label: "Active" }],
        },
      ];

      render(
        <EntityFilters
          filters={filters}
          values={{ status: "" }}
          onChange={mockOnChange}
        />
      );

      const selectButton = screen.getByRole("combobox");
      await user.click(selectButton);

      expect(await screen.findByText("All")).toBeInTheDocument();
    });
  });

  describe("multiselect filter", () => {
    it("should render multiselect filter", () => {
      const filters: FilterConfig[] = [
        {
          type: "multiselect",
          key: "tags",
          label: "Tags",
          options: [
            { value: "urgent", label: "Urgent" },
            { value: "bug", label: "Bug" },
          ],
        },
      ];

      render(
        <EntityFilters
          filters={filters}
          values={{ tags: [] }}
          onChange={mockOnChange}
        />
      );

      expect(
        screen.getByText("Tags", { selector: "label" })
      ).toBeInTheDocument();
    });

    it("should display selected values as chips", () => {
      const filters: FilterConfig[] = [
        {
          type: "multiselect",
          key: "tags",
          label: "Tags",
          options: [
            { value: "urgent", label: "Urgent" },
            { value: "bug", label: "Bug" },
          ],
        },
      ];

      render(
        <EntityFilters
          filters={filters}
          values={{ tags: ["urgent", "bug"] }}
          onChange={mockOnChange}
        />
      );

      expect(screen.getByText("urgent")).toBeInTheDocument();
      expect(screen.getByText("bug")).toBeInTheDocument();
    });
  });

  describe("daterange filter", () => {
    it("should render daterange filter placeholder", () => {
      const filters: FilterConfig[] = [
        {
          type: "daterange",
          key: "createdAt",
          label: "Created Date",
        },
      ];

      render(
        <EntityFilters
          filters={filters}
          values={{ createdAt: null }}
          onChange={mockOnChange}
        />
      );

      const dateInput = screen.getByPlaceholderText("Date range (coming soon)");
      expect(dateInput).toBeInTheDocument();
      expect(dateInput).toBeDisabled();
    });
  });

  describe("sort options", () => {
    it("should render sort dropdown when sortOptions provided", () => {
      const filters: FilterConfig[] = [];
      const sortOptions = [
        { value: "created-desc", label: "Newest first" },
        { value: "created-asc", label: "Oldest first" },
      ];

      render(
        <EntityFilters
          filters={filters}
          values={{}}
          onChange={mockOnChange}
          sortOptions={sortOptions}
          sortBy="created-desc"
          onSortChange={mockOnSortChange}
        />
      );

      expect(
        screen.getByText("Sort by", { selector: "label" })
      ).toBeInTheDocument();
    });

    it("should not render sort dropdown when sortOptions not provided", () => {
      const filters: FilterConfig[] = [];

      render(
        <EntityFilters filters={filters} values={{}} onChange={mockOnChange} />
      );

      expect(
        screen.queryByText("Sort by", { selector: "label" })
      ).not.toBeInTheDocument();
    });

    it("should call onSortChange when sort value changes", async () => {
      const user = userEvent.setup();
      const filters: FilterConfig[] = [];
      const sortOptions = [
        { value: "created-desc", label: "Newest first" },
        { value: "created-asc", label: "Oldest first" },
      ];

      render(
        <EntityFilters
          filters={filters}
          values={{}}
          onChange={mockOnChange}
          sortOptions={sortOptions}
          sortBy="created-desc"
          onSortChange={mockOnSortChange}
        />
      );

      const sortButton = screen.getByRole("combobox");
      await user.click(sortButton);

      const oldestOption = await screen.findByText("Oldest first");
      await user.click(oldestOption);

      expect(mockOnSortChange).toHaveBeenCalledWith("created-asc");
    });

    it("should display current sort value", () => {
      const filters: FilterConfig[] = [];
      const sortOptions = [
        { value: "created-desc", label: "Newest first" },
        { value: "created-asc", label: "Oldest first" },
      ];

      render(
        <EntityFilters
          filters={filters}
          values={{}}
          onChange={mockOnChange}
          sortOptions={sortOptions}
          sortBy="created-desc"
          onSortChange={mockOnSortChange}
        />
      );

      expect(screen.getByText("Newest first")).toBeInTheDocument();
    });
  });

  describe("multiple filters", () => {
    it("should render multiple filters together", () => {
      const filters: FilterConfig[] = [
        {
          type: "search",
          key: "search",
          label: "Search",
        },
        {
          type: "select",
          key: "status",
          label: "Status",
          options: [{ value: "active", label: "Active" }],
        },
        {
          type: "select",
          key: "priority",
          label: "Priority",
          options: [{ value: "high", label: "High" }],
        },
      ];

      render(
        <EntityFilters
          filters={filters}
          values={{ search: "", status: "", priority: "" }}
          onChange={mockOnChange}
        />
      );

      expect(screen.getByLabelText("Search")).toBeInTheDocument();
      expect(
        screen.getByText("Status", { selector: "label" })
      ).toBeInTheDocument();
      expect(
        screen.getByText("Priority", { selector: "label" })
      ).toBeInTheDocument();
    });

    it("should handle changes to different filters independently", async () => {
      const user = userEvent.setup();
      const filters: FilterConfig[] = [
        {
          type: "search",
          key: "search",
          label: "Search",
        },
        {
          type: "select",
          key: "status",
          label: "Status",
          options: [{ value: "active", label: "Active" }],
        },
      ];

      render(
        <EntityFilters
          filters={filters}
          values={{ search: "", status: "" }}
          onChange={mockOnChange}
        />
      );

      // Change search
      const searchInput = screen.getByLabelText("Search");
      await user.type(searchInput, "test");

      expect(mockOnChange).toHaveBeenCalledWith("search", expect.any(String));

      mockOnChange.mockClear();

      // Change status
      const statusButton = screen.getByRole("combobox");
      await user.click(statusButton);

      const activeOption = await screen.findByText("Active");
      await user.click(activeOption);

      expect(mockOnChange).toHaveBeenCalledWith("status", "active");
    });
  });

  describe("layout", () => {
    it("should apply row layout by default", () => {
      const filters: FilterConfig[] = [
        {
          type: "search",
          key: "search",
          label: "Search",
        },
      ];

      const { container } = render(
        <EntityFilters
          filters={filters}
          values={{ search: "" }}
          onChange={mockOnChange}
        />
      );

      // Check Paper component exists
      expect(container.querySelector(".MuiPaper-root")).toBeInTheDocument();
    });

    it("should apply column layout when specified", () => {
      const filters: FilterConfig[] = [
        {
          type: "search",
          key: "search",
          label: "Search",
        },
      ];

      render(
        <EntityFilters
          filters={filters}
          values={{ search: "" }}
          onChange={mockOnChange}
          layout="column"
        />
      );

      expect(screen.getByLabelText("Search")).toBeInTheDocument();
    });
  });

  describe("compact filter controls", () => {
    it("opens filter options, applies selections, and marks active filters and sort", async () => {
      const user = userEvent.setup();
      const filters: FilterConfig[] = [
        {
          type: "select",
          key: "status",
          label: "Status",
          options: [
            { value: "active", label: "Active" },
            { value: "completed", label: "Completed" },
          ],
        },
      ];

      render(
        <EntityFilters
          filters={filters}
          values={{ status: "active" }}
          onChange={mockOnChange}
          sortOptions={[
            { value: "newest", label: "Newest" },
            { value: "oldest", label: "Oldest" },
          ]}
          sortBy="oldest"
          onSortChange={mockOnSortChange}
        />
      );

      const statusButton = screen.getByRole("button", { name: "Status" });
      const sortButton = screen.getByRole("button", { name: "Sort by" });
      expect(statusButton).toHaveAttribute("aria-haspopup", "dialog");
      expect(statusButton.querySelector(".MuiBadge-badge")).not.toHaveClass(
        "MuiBadge-invisible"
      );
      expect(sortButton.querySelector(".MuiBadge-badge")).not.toHaveClass(
        "MuiBadge-invisible"
      );

      await user.click(statusButton);
      expect(
        await screen.findByRole("dialog", { name: "Status" })
      ).toBeInTheDocument();
      await user.click(
        screen.getByRole("menuitemradio", { name: "Completed" })
      );

      expect(mockOnChange).toHaveBeenCalledWith("status", "completed");
      expect(
        screen.queryByRole("dialog", { name: "Status" })
      ).not.toBeInTheDocument();

      await user.click(sortButton);
      await user.click(
        await screen.findByRole("menuitemradio", { name: "Newest" })
      );

      expect(mockOnSortChange).toHaveBeenCalledWith("newest");
      expect(
        screen.queryByRole("dialog", { name: "Sort by" })
      ).not.toBeInTheDocument();
    });

    it("toggles multiselect options without closing the compact popover", async () => {
      const user = userEvent.setup();
      const filters: FilterConfig[] = [
        {
          type: "multiselect",
          key: "tags",
          label: "Tags",
          options: [
            { value: "frontend", label: "Frontend" },
            { value: "backend", label: "Backend" },
          ],
        },
      ];

      render(
        <EntityFilters
          filters={filters}
          values={{ tags: ["frontend"] }}
          onChange={mockOnChange}
        />
      );

      await user.click(screen.getByRole("button", { name: "Tags" }));
      await user.click(
        await screen.findByRole("menuitemcheckbox", { name: "Backend" })
      );

      expect(mockOnChange).toHaveBeenCalledWith("tags", [
        "frontend",
        "backend",
      ]);
      expect(screen.getByRole("dialog", { name: "Tags" })).toBeInTheDocument();
    });

    it("renders custom filter content inside its compact popover", async () => {
      const user = userEvent.setup();
      const filters: FilterConfig[] = [
        {
          type: "custom",
          key: "feature",
          label: "Feature",
          customRender: (_value, onChange) => (
            <button onClick={() => onChange("feature-1")}>
              Choose feature
            </button>
          ),
        },
      ];

      render(
        <EntityFilters
          filters={filters}
          values={{ feature: "" }}
          onChange={mockOnChange}
        />
      );

      await user.click(screen.getByRole("button", { name: "Feature" }));
      await user.click(
        await screen.findByRole("button", { name: "Choose feature" })
      );

      expect(mockOnChange).toHaveBeenCalledWith("feature", "feature-1");
    });
  });

  describe("spacing", () => {
    it("should apply default spacing", () => {
      const filters: FilterConfig[] = [
        {
          type: "search",
          key: "search",
          label: "Search",
        },
      ];

      render(
        <EntityFilters
          filters={filters}
          values={{ search: "" }}
          onChange={mockOnChange}
        />
      );

      expect(screen.getByLabelText("Search")).toBeInTheDocument();
    });

    it("should apply custom spacing", () => {
      const filters: FilterConfig[] = [
        {
          type: "search",
          key: "search",
          label: "Search",
        },
      ];

      render(
        <EntityFilters
          filters={filters}
          values={{ search: "" }}
          onChange={mockOnChange}
          spacing={4}
        />
      );

      expect(screen.getByLabelText("Search")).toBeInTheDocument();
    });
  });

  describe("edge cases", () => {
    it("should handle empty filters array", () => {
      render(
        <EntityFilters filters={[]} values={{}} onChange={mockOnChange} />
      );

      // Should render Paper wrapper but no filter controls
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });

    it("should handle filter with no options", () => {
      const filters: FilterConfig[] = [
        {
          type: "select",
          key: "status",
          label: "Status",
          options: [],
        },
      ];

      render(
        <EntityFilters
          filters={filters}
          values={{ status: "" }}
          onChange={mockOnChange}
        />
      );

      // Should still render the select
      expect(
        screen.getByText("Status", { selector: "label" })
      ).toBeInTheDocument();
    });

    it("should handle undefined value gracefully", () => {
      const filters: FilterConfig[] = [
        {
          type: "search",
          key: "search",
          label: "Search",
        },
      ];

      render(
        <EntityFilters
          filters={filters}
          values={{ search: undefined }}
          onChange={mockOnChange}
        />
      );

      const searchInput = screen.getByLabelText("Search");
      expect(searchInput).toHaveValue("");
    });
  });
});
