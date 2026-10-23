import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { IntegrationSearch } from "../IntegrationSearch";

describe("IntegrationSearch", () => {
  const mockOnSearchChange = vi.fn();

  beforeEach(() => {
    mockOnSearchChange.mockClear();
  });

  it("should render search input", () => {
    render(
      <IntegrationSearch searchTerm="" onSearchChange={mockOnSearchChange} />
    );

    expect(
      screen.getByPlaceholderText("Search integrations...")
    ).toBeInTheDocument();
  });

  it("should display current search term", () => {
    render(
      <IntegrationSearch
        searchTerm="github"
        onSearchChange={mockOnSearchChange}
      />
    );

    const input = screen.getByDisplayValue("github");
    expect(input).toBeInTheDocument();
  });

  it("should call onSearchChange when input changes", () => {
    render(
      <IntegrationSearch searchTerm="" onSearchChange={mockOnSearchChange} />
    );

    const input = screen.getByPlaceholderText("Search integrations...");
    fireEvent.change(input, { target: { value: "test" } });

    expect(mockOnSearchChange).toHaveBeenCalledWith("test");
  });

  it("should be disabled when disabled prop is true", () => {
    render(
      <IntegrationSearch
        searchTerm=""
        onSearchChange={mockOnSearchChange}
        disabled={true}
      />
    );

    const input = screen.getByPlaceholderText("Search integrations...");
    expect(input).toBeDisabled();
  });

  it("should display search icon", () => {
    render(
      <IntegrationSearch searchTerm="" onSearchChange={mockOnSearchChange} />
    );

    expect(screen.getByTestId("SearchIcon")).toBeInTheDocument();
  });
});
