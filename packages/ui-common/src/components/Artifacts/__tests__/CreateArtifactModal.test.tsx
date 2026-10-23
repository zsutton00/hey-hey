import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { CreateArtifactModal } from "../CreateArtifactModal";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

describe("CreateArtifactModal", () => {
  const mockOnClose = vi.fn();
  const mockOnTemplateSelect = vi.fn();

  const defaultProps = {
    open: true,
    onClose: mockOnClose,
    projectId: "test-project-id",
    onTemplateSelect: mockOnTemplateSelect,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the modal when open is true", () => {
    render(<CreateArtifactModal {...defaultProps} />);

    expect(screen.getByText("Create Document")).toBeInTheDocument();
    expect(
      screen.getByText("Choose a template to get started")
    ).toBeInTheDocument();
  });

  it("does not render the modal when open is false", () => {
    render(<CreateArtifactModal {...defaultProps} open={false} />);

    expect(screen.queryByText("Create Document")).not.toBeInTheDocument();
  });

  it("displays the blank document template", () => {
    render(<CreateArtifactModal {...defaultProps} />);

    expect(screen.getByText("Blank Document")).toBeInTheDocument();
    expect(screen.getByText("Start with a blank document")).toBeInTheDocument();
  });

  it("calls onTemplateSelect when blank document template is clicked", () => {
    render(<CreateArtifactModal {...defaultProps} />);

    const blankTemplate = screen.getByRole("button", {
      name: /blank document/i,
    });
    fireEvent.click(blankTemplate);

    expect(mockOnTemplateSelect).toHaveBeenCalledWith({
      id: "blank",
      name: "Blank Document",
      description: "Start with a blank document",
      content: "# Untitled Document\n\nStart writing your content here...",
      icon: expect.anything(),
    });
  });

  it("calls onClose when close button is clicked", () => {
    render(<CreateArtifactModal {...defaultProps} />);

    const closeButton = screen.getByRole("button", { name: "" });
    fireEvent.click(closeButton);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when cancel button is clicked", () => {
    render(<CreateArtifactModal {...defaultProps} />);

    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelButton);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("has proper accessibility attributes", () => {
    render(<CreateArtifactModal {...defaultProps} />);

    // Modal should have a title
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-labelledby");

    // Template cards should be clickable
    const templateCard = screen.getByRole("button", {
      name: /blank document/i,
    });
    expect(templateCard).toBeInTheDocument();
  });
});
