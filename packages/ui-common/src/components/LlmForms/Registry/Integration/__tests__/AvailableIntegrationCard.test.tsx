import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import GitHubIcon from "@mui/icons-material/GitHub";
import { AvailableIntegrationCard } from "../AvailableIntegrationCard";
import type { AvailableIntegration } from "../types";

describe("AvailableIntegrationCard", () => {
  const mockOnAdd = vi.fn();

  const mockIntegration: AvailableIntegration = {
    type: "github",
    name: "GitHub",
    description: "Connect your GitHub repositories",
    icon: <GitHubIcon />,
    configFields: [],
  };

  beforeEach(() => {
    mockOnAdd.mockClear();
  });

  it("should render integration name and description", () => {
    render(
      <AvailableIntegrationCard
        integration={mockIntegration}
        onAdd={mockOnAdd}
      />
    );

    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(
      screen.getByText("Connect your GitHub repositories")
    ).toBeInTheDocument();
  });

  it("should display the integration icon", () => {
    render(
      <AvailableIntegrationCard
        integration={mockIntegration}
        onAdd={mockOnAdd}
      />
    );

    expect(screen.getByTestId("GitHubIcon")).toBeInTheDocument();
  });

  it("should call onAdd when add button is clicked", () => {
    render(
      <AvailableIntegrationCard
        integration={mockIntegration}
        onAdd={mockOnAdd}
      />
    );

    const addButton = screen.getByRole("button");
    fireEvent.click(addButton);

    expect(mockOnAdd).toHaveBeenCalledWith("github");
  });

  it("should be disabled when disabled prop is true", () => {
    render(
      <AvailableIntegrationCard
        integration={mockIntegration}
        onAdd={mockOnAdd}
        disabled={true}
      />
    );

    const addButton = screen.getByRole("button");
    expect(addButton).toBeDisabled();
  });
});
