import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SearchResults } from "../SearchResults";
import { createMockSearchEntities } from "./testUtils";
import type { SearchEntity } from "../types";

describe("SearchResults", () => {
  const mockOnSelectionChange = vi.fn<
    [id: string, event: React.MouseEvent, results: SearchEntity[]],
    void
  >();
  const mockOnPreview = vi.fn<[entity: SearchEntity], void>();
  const mockOnGoToEntity = vi.fn<[entity: SearchEntity], void>();
  const mockResults = createMockSearchEntities(3);

  beforeEach(() => {
    mockOnSelectionChange.mockClear();
    mockOnPreview.mockClear();
    mockOnGoToEntity.mockClear();
  });

  it("should render loading state", () => {
    render(
      <SearchResults
        results={[]}
        isLoading={true}
        allowMultiSelect={false}
        selectedIds={new Set()}
        onSelectionChange={mockOnSelectionChange}
        onPreview={mockOnPreview}
        onGoToEntity={mockOnGoToEntity}
      />
    );

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("should render empty state when no results", () => {
    render(
      <SearchResults
        results={[]}
        isLoading={false}
        allowMultiSelect={false}
        selectedIds={new Set()}
        onSelectionChange={mockOnSelectionChange}
        onPreview={mockOnPreview}
        onGoToEntity={mockOnGoToEntity}
      />
    );

    expect(screen.getByText(/no results found/i)).toBeInTheDocument();
  });

  it("should render all results", () => {
    render(
      <SearchResults
        results={mockResults}
        isLoading={false}
        allowMultiSelect={false}
        selectedIds={new Set()}
        onSelectionChange={mockOnSelectionChange}
        onPreview={mockOnPreview}
        onGoToEntity={mockOnGoToEntity}
      />
    );

    mockResults.forEach((entity) => {
      expect(screen.getByText(entity.name)).toBeInTheDocument();
    });
  });

  it("should show checkboxes when allowMultiSelect is true", () => {
    render(
      <SearchResults
        results={mockResults}
        isLoading={false}
        allowMultiSelect={true}
        selectedIds={new Set()}
        onSelectionChange={mockOnSelectionChange}
        onPreview={mockOnPreview}
        onGoToEntity={mockOnGoToEntity}
      />
    );

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(mockResults.length);
  });

  it("should not show checkboxes when allowMultiSelect is false", () => {
    render(
      <SearchResults
        results={mockResults}
        isLoading={false}
        allowMultiSelect={false}
        selectedIds={new Set()}
        onSelectionChange={mockOnSelectionChange}
        onPreview={mockOnPreview}
        onGoToEntity={mockOnGoToEntity}
      />
    );

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("should call onSelectionChange when clicking a result", () => {
    render(
      <SearchResults
        results={mockResults}
        isLoading={false}
        allowMultiSelect={false}
        selectedIds={new Set()}
        onSelectionChange={mockOnSelectionChange}
        onPreview={mockOnPreview}
        onGoToEntity={mockOnGoToEntity}
      />
    );

    fireEvent.click(screen.getByText(mockResults[0].name));

    expect(mockOnSelectionChange).toHaveBeenCalledWith(
      mockResults[0].id,
      expect.objectContaining({
        type: "click",
      }),
      mockResults
    );
  });

  it("should call onPreview when clicking preview button", () => {
    render(
      <SearchResults
        results={mockResults}
        isLoading={false}
        allowMultiSelect={false}
        selectedIds={new Set()}
        onSelectionChange={mockOnSelectionChange}
        onPreview={mockOnPreview}
        onGoToEntity={mockOnGoToEntity}
      />
    );

    const previewButtons = screen.getAllByRole("button", {
      name: /show preview/i,
    });
    fireEvent.click(previewButtons[0]);

    expect(mockOnPreview).toHaveBeenCalledWith(mockResults[0]);
  });

  it("should call onGoToEntity when clicking go-to button", () => {
    render(
      <SearchResults
        results={mockResults}
        isLoading={false}
        allowMultiSelect={false}
        selectedIds={new Set()}
        onSelectionChange={mockOnSelectionChange}
        onPreview={mockOnPreview}
        onGoToEntity={mockOnGoToEntity}
      />
    );

    const goToButtons = screen.getAllByRole("button", {
      name: /go to/i,
    });
    fireEvent.click(goToButtons[0]);

    expect(mockOnGoToEntity).toHaveBeenCalledWith(mockResults[0]);
  });

  it("should show similarity scores when showSimilarityScores is true", () => {
    render(
      <SearchResults
        results={mockResults}
        isLoading={false}
        allowMultiSelect={false}
        selectedIds={new Set()}
        onSelectionChange={mockOnSelectionChange}
        onPreview={mockOnPreview}
        onGoToEntity={mockOnGoToEntity}
        showSimilarityScores={true}
      />
    );

    const scoreCounts = mockResults.reduce<Record<string, number>>(
      (acc, entity) => {
        if (entity.similarity === undefined) {
          return acc;
        }
        const scoreText = entity.similarity.toFixed(2);
        acc[scoreText] = (acc[scoreText] ?? 0) + 1;
        return acc;
      },
      {}
    );

    Object.entries(scoreCounts).forEach(([scoreText, count]) => {
      expect(screen.getAllByText(scoreText)).toHaveLength(count);
    });
  });

  it("should mark selected items", () => {
    const selectedIds = new Set([mockResults[0].id, mockResults[1].id]);

    render(
      <SearchResults
        results={mockResults}
        isLoading={false}
        allowMultiSelect={true}
        selectedIds={selectedIds}
        onSelectionChange={mockOnSelectionChange}
        onPreview={mockOnPreview}
        onGoToEntity={mockOnGoToEntity}
      />
    );

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).toBeChecked();
    expect(checkboxes[2]).not.toBeChecked();
  });
});
