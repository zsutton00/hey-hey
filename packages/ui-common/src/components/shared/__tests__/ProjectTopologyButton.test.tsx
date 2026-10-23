import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { describe, expect, it, vi } from "vitest";
import { createHeyTheme } from "../../../contexts/ThemeContext";
import {
  ProjectTopologyButton,
  type ProjectTopologyButtonProps,
} from "../ProjectTopologyButton";

const renderButton = (
  props: Partial<ProjectTopologyButtonProps> = {}
) =>
  render(
    <ThemeProvider theme={createHeyTheme("light")}>
      <ProjectTopologyButton onClick={vi.fn()} {...props} />
    </ThemeProvider>
  );

describe("ProjectTopologyButton", () => {
  it("renders the accessible sync-warning label and graph icon", () => {
    renderButton();

    const button = screen.getByTestId("project-topology-button");
    expect(button).toHaveAccessibleName("Potential project sync issue");
    expect(button).toHaveTextContent("Potential project sync issue");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveStyle({
      backgroundColor: "rgb(8, 126, 139)",
      color: "rgb(255, 255, 255)",
    });
    expect(button.querySelector("svg")).toBeInTheDocument();
  });

  it("renders when the host uses MUI's default theme", () => {
    render(<ProjectTopologyButton onClick={vi.fn()} />);

    expect(screen.getByTestId("project-topology-button")).toBeInTheDocument();
  });

  it("dispatches the host callback when activated", () => {
    const onClick = vi.fn();
    renderButton({ onClick });

    fireEvent.click(screen.getByTestId("project-topology-button"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("prevents activation while disabled or loading", () => {
    const disabledClick = vi.fn();
    const { rerender } = render(
      <ThemeProvider theme={createHeyTheme("light")}>
        <ProjectTopologyButton onClick={disabledClick} disabled />
      </ThemeProvider>
    );

    const button = screen.getByTestId("project-topology-button");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(disabledClick).not.toHaveBeenCalled();

    const loadingClick = vi.fn();
    rerender(
      <ThemeProvider theme={createHeyTheme("light")}>
        <ProjectTopologyButton onClick={loadingClick} loading />
      </ThemeProvider>
    );

    const loadingButton = screen.getByTestId("project-topology-button");
    expect(loadingButton).toBeDisabled();
    expect(loadingButton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    fireEvent.click(loadingButton);
    expect(loadingClick).not.toHaveBeenCalled();
  });
});
