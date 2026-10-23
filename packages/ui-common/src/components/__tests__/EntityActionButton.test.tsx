import React from "react";
import { render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { vi } from "vitest";
import { EntityActionButton } from "../EntityActionButton";

const mockUseMediaQuery = vi.fn<() => boolean>();

vi.mock("@mui/material", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mui/material")>();
  return { ...actual, useMediaQuery: () => mockUseMediaQuery() };
});

const renderButton = (
  props: Partial<React.ComponentProps<typeof EntityActionButton>> = {},
) =>
  render(
    <ThemeProvider theme={createTheme()}>
      <EntityActionButton
        verb="create"
        noun="Task"
        entityType="conversation"
        {...props}
      />
    </ThemeProvider>,
  );

describe("EntityActionButton", () => {
  it("shows verb and noun above md", () => {
    mockUseMediaQuery.mockReturnValue(false);
    renderButton();
    const button = screen.getByRole("button", { name: "Create Task" });
    expect(button).toHaveTextContent("Create Task");
    expect(screen.getByTestId("AddIcon")).toBeInTheDocument();
  });

  it("shows only the verb at md and below but keeps the full accessible name", () => {
    mockUseMediaQuery.mockReturnValue(true);
    renderButton({ verb: "start", noun: "Conversation" });
    const button = screen.getByRole("button", { name: "Start Conversation" });
    expect(button).toHaveTextContent(/^Start$/);
    expect(button.querySelector("svg")).not.toBeNull();
    expect(screen.queryByTestId("PlayArrowIcon")).not.toBeInTheDocument();
  });

  it("shows the verb icon, not the type icon, above md", () => {
    mockUseMediaQuery.mockReturnValue(false);
    renderButton({ verb: "start" });
    expect(screen.getByTestId("PlayArrowIcon")).toBeInTheDocument();
  });

  it("renders the loading label and a spinner", () => {
    mockUseMediaQuery.mockReturnValue(false);
    renderButton({ loading: true, loadingLabel: "Starting..." });
    expect(
      screen.getByRole("button", { name: "Create Task" }),
    ).toHaveTextContent("Starting...");
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("withholds the type icon for a work-item type without a definition", () => {
    mockUseMediaQuery.mockReturnValue(true);
    renderButton({
      entityType: "task",
      workItemIcon: { typeKey: "STANDARD", definition: undefined },
    });
    expect(
      screen.getByRole("button", { name: "Create Task" }),
    ).toHaveTextContent(/^Create$/);
    expect(document.querySelector("svg")).toBeNull();
  });
});
