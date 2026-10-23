import { createTheme, ThemeProvider } from "@mui/material/styles";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { AgentSessionOutputAttentionState } from "../../../api";
import { AgentSessionOutputAttentionIndicator } from "../AgentSessionOutputAttentionIndicator";

const theme = createTheme();
const wrapper = ({ children }: { children: ReactNode }) => (
  <ThemeProvider theme={theme}>{children}</ThemeProvider>
);

describe("AgentSessionOutputAttentionIndicator", () => {
  it("renders MESSAGE_READY as an accessible icon", () => {
    render(
      <AgentSessionOutputAttentionIndicator
        state={AgentSessionOutputAttentionState.MessageReady}
      />,
      { wrapper },
    );

    const indicator = screen.getByTestId(
      "agent-session-output-attention-indicator",
    );
    expect(indicator).toHaveAccessibleName("New response");
    expect(indicator).toHaveAttribute("aria-live", "polite");
    expect(indicator).toHaveAttribute(
      "data-output-attention-state",
      AgentSessionOutputAttentionState.MessageReady,
    );
    const icon = indicator.querySelector("svg");
    expect(icon).toHaveAttribute("viewBox", "0 0 512 512");
    expect(icon?.querySelector("path")).toHaveAttribute(
      "d",
      "M160 368c26.5 0 48 21.5 48 48v16l72.5-54.4c8.3-6.2 18.4-9.6 28.8-9.6H448c8.8 0 16-7.2 16-16V64c0-8.8-7.2-16-16-16H64c-8.8 0-16 7.2-16 16v288c0 8.8 7.2 16 16 16zm48 124l-.2.2l-5.1 3.8l-17.1 12.8c-4.8 3.6-11.3 4.2-16.8 1.5s-8.8-8.2-8.8-14.3v-80H64c-35.3 0-64-28.7-64-64V64C0 28.7 28.7 0 64 0h384c35.3 0 64 28.7 64 64v288c0 35.3-28.7 64-64 64H309.3z",
    );
    const badge = indicator.querySelector(".MuiBadge-badge");
    expect(badge).toHaveTextContent("1");
    expect(badge).toHaveClass("MuiBadge-colorWarning");
    expect(badge?.parentElement).toHaveAttribute("aria-hidden", "true");
  });

  it.each([undefined, AgentSessionOutputAttentionState.None])(
    "does not render an indicator for %s",
    (state) => {
      render(<AgentSessionOutputAttentionIndicator state={state} />, {
        wrapper,
      });

      expect(
        screen.queryByTestId("agent-session-output-attention-indicator"),
      ).not.toBeInTheDocument();
    },
  );
});
