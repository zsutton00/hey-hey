import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SearchInputs } from "../SearchInputs";
import { EntityType } from "../../../api";

const mediaQueryState = { matches: false };

vi.mock("@mui/material", async () => {
  const actual = await vi.importActual<typeof import("@mui/material")>(
    "@mui/material"
  );
  return {
    ...actual,
    useMediaQuery: () => mediaQueryState.matches,
  };
});

describe("SearchInputs", () => {
  const mockOnTitleQueryChange = vi.fn<[string], void>();
  const mockOnSearchModeChange = vi.fn();

  const defaultProps = {
    titleQuery: "",
    onTitleQueryChange: mockOnTitleQueryChange,
    searchMode: "title" as const,
    onSearchModeChange: mockOnSearchModeChange,
  };

  beforeEach(() => {
    mediaQueryState.matches = false;
    mockOnTitleQueryChange.mockClear();
    mockOnSearchModeChange.mockClear();
  });

  it("should render title search input by default", () => {
    render(<SearchInputs {...defaultProps} />);
    expect(screen.getByLabelText("Title Search")).toBeInTheDocument();
  });

  it("should render agent search label when mode is agent", () => {
    render(<SearchInputs {...defaultProps} searchMode="agent" />);
    expect(screen.getByLabelText("Agent Search")).toBeInTheDocument();
  });

  it("should render content search label when mode is content", () => {
    render(<SearchInputs {...defaultProps} searchMode="content" />);
    expect(screen.getByLabelText("Content Search")).toBeInTheDocument();
  });

  it("should display current query values", () => {
    render(<SearchInputs {...defaultProps} titleQuery="test title" />);
    expect(screen.getByDisplayValue("test title")).toBeInTheDocument();
  });

  it("should call onTitleQueryChange when input changes", () => {
    render(<SearchInputs {...defaultProps} />);

    const titleInput = screen.getByLabelText("Title Search");
    fireEvent.change(titleInput, { target: { value: "new title" } });

    expect(mockOnTitleQueryChange).toHaveBeenCalledWith("new title");
  });

  it("should disable inputs when isLoading is true", () => {
    render(<SearchInputs {...defaultProps} isLoading={true} />);
    expect(screen.getByLabelText("Title Search")).toBeDisabled();
  });

  it("should show search icon in input", () => {
    render(<SearchInputs {...defaultProps} />);

    const icon = screen.getByTestId("SearchIcon");
    expect(icon).toBeInTheDocument();

    const titleInput = screen.getByLabelText("Title Search");
    const titleInputContainer = titleInput.closest(".MuiTextField-root");
    expect(titleInputContainer).toContainElement(icon);
  });

  it("should not render an entity type selector", () => {
    render(<SearchInputs {...defaultProps} onSearch={vi.fn()} />);

    expect(screen.queryByText("Types")).not.toBeInTheDocument();
  });

  it("should show scoped entity indicator and clear it", () => {
    const mockOnClearScopedEntity = vi.fn<[], void>();

    render(
      <SearchInputs
        {...defaultProps}
        scopedEntity={{
          entityId: "initiative-123",
          entityType: EntityType.Initiative,
        }}
        onClearScopedEntity={mockOnClearScopedEntity}
      />
    );

    expect(
      screen.getByText("Searching within initiative (initiative-123)")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("CancelIcon"));
    expect(mockOnClearScopedEntity).toHaveBeenCalledTimes(1);
  });

  it("should render all three search mode buttons when onSearch is provided", () => {
    render(<SearchInputs {...defaultProps} onSearch={vi.fn()} />);

    expect(screen.getByTestId("search-mode-title")).toBeInTheDocument();
    expect(screen.getByTestId("search-mode-content")).toBeInTheDocument();
    expect(screen.getByTestId("search-mode-agent")).toBeInTheDocument();
  });

  it("should render a compact mode selector on narrow screens", () => {
    mediaQueryState.matches = true;

    render(<SearchInputs {...defaultProps} onSearch={vi.fn()} />);

    expect(screen.getByTestId("search-mode-mobile")).toBeInTheDocument();
    expect(screen.getByTestId("TitleIcon")).toBeInTheDocument();
    expect(screen.getByTestId("search-input-mode-row")).toContainElement(
      screen.getByLabelText("Title Search")
    );
    expect(screen.getByTestId("search-input-mode-row")).toContainElement(
      screen.getByTestId("search-mode-mobile")
    );
    expect(screen.queryByTestId("search-mode-title")).not.toBeInTheDocument();
  });

  it("should switch mode and fire search from the compact selector", () => {
    mediaQueryState.matches = true;
    const mockOnSearch = vi.fn();

    render(
      <SearchInputs
        {...defaultProps}
        searchMode="title"
        onSearch={mockOnSearch}
      />
    );

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Search mode" }));
    fireEvent.click(screen.getByRole("option", { name: "Agent" }));

    expect(mockOnSearchModeChange).toHaveBeenCalledWith("agent");
    expect(mockOnSearch).toHaveBeenCalledWith("agent");
  });

  it("should order the mode buttons title, content, agent", () => {
    const { container } = render(
      <SearchInputs {...defaultProps} onSearch={vi.fn()} />
    );

    const modeButtons = Array.from(
      container.querySelectorAll('[data-testid^="search-mode-"]')
    ).map((el) => el.getAttribute("data-testid"));

    expect(modeButtons).toEqual([
      "search-mode-title",
      "search-mode-content",
      "search-mode-agent",
    ]);
  });

  it("should use the plain text field (not the freeSolo autocomplete) in content mode", () => {
    const { container } = render(
      <SearchInputs
        {...defaultProps}
        searchMode="content"
        onSearch={vi.fn()}
        pastSearchOptions={[]}
        onPastSearchSelect={vi.fn()}
      />
    );

    // The freeSolo past-searches Autocomplete is gated to agent mode only.
    expect(container.querySelector(".MuiAutocomplete-root")).toBeNull();
    expect(screen.getByLabelText("Content Search")).toBeInTheDocument();
  });

  it("should use the freeSolo autocomplete only in agent mode", () => {
    const { container } = render(
      <SearchInputs
        {...defaultProps}
        searchMode="agent"
        onSearch={vi.fn()}
        pastSearchOptions={[]}
        onPastSearchSelect={vi.fn()}
      />
    );

    expect(container.querySelector(".MuiAutocomplete-root")).not.toBeNull();
  });

  it("should mark the active mode button as pressed", () => {
    render(
      <SearchInputs {...defaultProps} searchMode="agent" onSearch={vi.fn()} />
    );

    expect(screen.getByTestId("search-mode-agent")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByTestId("search-mode-title")).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("should switch mode and fire search in the clicked mode", () => {
    const mockOnSearch = vi.fn();
    render(
      <SearchInputs
        {...defaultProps}
        searchMode="title"
        onSearch={mockOnSearch}
      />
    );

    fireEvent.click(screen.getByTestId("search-mode-agent"));

    expect(mockOnSearchModeChange).toHaveBeenCalledWith("agent");
    expect(mockOnSearch).toHaveBeenCalledWith("agent");
  });

  it("should fire search in the current mode on Enter (no explicit override)", () => {
    const mockOnSearch = vi.fn();
    render(
      <SearchInputs
        {...defaultProps}
        searchMode="title"
        onSearch={mockOnSearch}
      />
    );

    fireEvent.keyDown(screen.getByLabelText("Title Search"), { key: "Enter" });

    expect(mockOnSearch).toHaveBeenCalledWith();
  });

  it("should show the enter-to-search hint", () => {
    render(<SearchInputs {...defaultProps} onSearch={vi.fn()} />);

    expect(screen.getByText("Press ↵ to search")).toBeInTheDocument();
  });
});
