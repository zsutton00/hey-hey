import { screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SearchPreview } from "../SearchPreview";
import { createMockSearchEntity, renderWithProviders } from "./testUtils";

vi.mock("../../EntityViewer", () => ({
  EntityViewerLoader: ({
    entityId,
    entityType,
  }: {
    entityId: string;
    entityType: string;
  }) => (
    <div data-testid="mock-entity-viewer-loader">
      {entityType}:{entityId}
    </div>
  ),
}));

describe("SearchPreview", () => {
  const mockOnClose = vi.fn<[], void>();
  const mockOnSelect = vi.fn<[], void>();
  const defaultScope = {
    organizationId: "org-1",
    projectId: "proj-1",
  };

  beforeEach(() => {
    mockOnClose.mockClear();
    mockOnSelect.mockClear();
  });

  it("should render return button", () => {
    const entity = createMockSearchEntity();

    renderWithProviders(
      <SearchPreview
        entity={entity}
        organizationId={defaultScope.organizationId}
        projectId={defaultScope.projectId}
        onClose={mockOnClose}
        allowSelection={false}
        isSelected={false}
      />
    );

    expect(
      screen.getByTestId("entity-preview-close-button")
    ).toBeInTheDocument();
  });

  it("should call onClose when return button is clicked", () => {
    const entity = createMockSearchEntity();

    renderWithProviders(
      <SearchPreview
        entity={entity}
        organizationId={defaultScope.organizationId}
        projectId={defaultScope.projectId}
        onClose={mockOnClose}
        allowSelection={false}
        isSelected={false}
      />
    );

    fireEvent.click(screen.getByTestId("entity-preview-close-button"));

    expect(mockOnClose).toHaveBeenCalled();
  });

  it("should show select button when allowSelection is true and not selected", () => {
    const entity = createMockSearchEntity();

    renderWithProviders(
      <SearchPreview
        entity={entity}
        organizationId={defaultScope.organizationId}
        projectId={defaultScope.projectId}
        onClose={mockOnClose}
        onSelect={mockOnSelect}
        allowSelection={true}
        isSelected={false}
      />
    );

    expect(
      screen.getByTestId("search-preview-select-button")
    ).toBeInTheDocument();
  });

  it("should hide select button when already selected", () => {
    const entity = createMockSearchEntity();

    renderWithProviders(
      <SearchPreview
        entity={entity}
        organizationId={defaultScope.organizationId}
        projectId={defaultScope.projectId}
        onClose={mockOnClose}
        onSelect={mockOnSelect}
        allowSelection={true}
        isSelected={true}
      />
    );

    expect(
      screen.queryByTestId("search-preview-select-button")
    ).not.toBeInTheDocument();
  });

  it("should call onSelect when select button is clicked", () => {
    const entity = createMockSearchEntity();

    renderWithProviders(
      <SearchPreview
        entity={entity}
        organizationId={defaultScope.organizationId}
        projectId={defaultScope.projectId}
        onClose={mockOnClose}
        onSelect={mockOnSelect}
        allowSelection={true}
        isSelected={false}
      />
    );

    fireEvent.click(screen.getByTestId("search-preview-select-button"));

    expect(mockOnSelect).toHaveBeenCalled();
  });

  it("should render task entity with WorkItemReadView", () => {
    const entity = createMockSearchEntity({
      type: "TASK",
      metadata: {
        description: "Task description",
        details: "Task details",
      },
    });

    renderWithProviders(
      <SearchPreview
        entity={entity}
        organizationId={defaultScope.organizationId}
        projectId={defaultScope.projectId}
        onClose={mockOnClose}
        allowSelection={false}
        isSelected={false}
      />
    );

    expect(screen.getByTestId("mock-entity-viewer-loader")).toHaveTextContent(
      "TASK:entity-1"
    );
  });

  it("should render design doc entity with AdrReadView", () => {
    const entity = createMockSearchEntity({
      type: "DESIGN_DOC",
      metadata: {
        name: "ADR Title",
        summary: "ADR Summary",
      },
    });

    renderWithProviders(
      <SearchPreview
        entity={entity}
        organizationId={defaultScope.organizationId}
        projectId={defaultScope.projectId}
        onClose={mockOnClose}
        allowSelection={false}
        isSelected={false}
      />
    );

    expect(screen.getByTestId("mock-entity-viewer-loader")).toHaveTextContent(
      "DESIGN_DOC:entity-1"
    );
  });

  it("should render default preview for unknown entity types", () => {
    const entity = createMockSearchEntity({
      type: "unknown_type",
      name: "Unknown Entity",
      description: "Unknown description",
    });

    renderWithProviders(
      <SearchPreview
        entity={entity}
        organizationId={defaultScope.organizationId}
        projectId={defaultScope.projectId}
        onClose={mockOnClose}
        allowSelection={false}
        isSelected={false}
      />
    );

    expect(screen.getByText("Unsupported entity type.")).toBeInTheDocument();
  });
});
