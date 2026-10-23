import { createTheme, ThemeProvider } from "@mui/material/styles";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ConversationPhase } from "../../../../api";
import { ConversationPhaseIndicator } from "../ConversationPhaseIndicator";

const theme = createTheme();
const wrapper = ({ children }: { children: ReactNode }) => (
  <ThemeProvider theme={theme}>{children}</ThemeProvider>
);

describe("ConversationPhaseIndicator", () => {
  it("uses the code-review icon for reviewing", () => {
    render(
      <ConversationPhaseIndicator phase={ConversationPhase.Reviewing} />,
      { wrapper },
    );

    const indicator = screen.getByTestId("conversation-phase-indicator");
    expect(indicator).toHaveAttribute("data-phase", ConversationPhase.Reviewing);
    expect(indicator).toHaveAttribute("aria-label", "Reviewing");
    expect(screen.getByTestId("conversation-phase-icon")).toHaveAttribute(
      "viewBox",
      "0 0 24 24",
    );
  });

  it("does not render an icon for idle", () => {
    render(
      <ConversationPhaseIndicator phase={ConversationPhase.Idle} />,
      { wrapper },
    );

    expect(
      screen.queryByTestId("conversation-phase-indicator"),
    ).not.toBeInTheDocument();
  });
});
