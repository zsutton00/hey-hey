import React from "react";
import { render, screen } from "@testing-library/react";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { describe, expect, it } from "vitest";
import { JsonSectionRenderer } from "../JsonSectionRenderer";

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ThemeProvider theme={createTheme()}>{children}</ThemeProvider>
);

describe("JsonSectionRenderer", () => {
  it("normalizes proposal values and persisted JSON snapshots through one path", () => {
    const value = {
      modeFile: "MODE.md",
      supportingFiles: [{ path: "references/checklist.md", content: "Use it" }],
    };

    const view = render(<JsonSectionRenderer content={value} />, {
      wrapper,
    });

    expect(screen.getByTestId("json-section-renderer")).toBeInTheDocument();
    expect(screen.getByTestId("json-section-content")).toHaveTextContent(
      '"MODE.md"'
    );
    expect(screen.getByTestId("json-section-content")).toHaveTextContent(
      "references/checklist.md"
    );
    expect(screen.getByTestId("json-section-content")).toHaveTextContent(
      "Use it"
    );

    view.rerender(<JsonSectionRenderer content={JSON.stringify(value)} />);
    expect(screen.getByTestId("json-section-renderer")).toBeInTheDocument();
  });

  it("renders an explicit invalid-content state without interpreting it as Markdown", () => {
    render(<JsonSectionRenderer content="{not-json" />, { wrapper });

    expect(
      screen.getByTestId("json-section-invalid-content")
    ).toHaveTextContent("invalid JSON");
    expect(
      screen.queryByTestId("json-section-content")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("not-json")).not.toBeInTheDocument();
  });
});
