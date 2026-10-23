import { createTheme, ThemeProvider } from "@mui/material/styles";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { AgentSessionCurrentState } from "../../../api";
import { AgentSessionCurrentStateIndicator } from "../AgentSessionCurrentStateIndicator";

const theme = createTheme();
const wrapper = ({ children }: { children: ReactNode }) => (
  <ThemeProvider theme={theme}>{children}</ThemeProvider>
);

const renderIndicator = (currentState: AgentSessionCurrentState | undefined) =>
  render(
    <AgentSessionCurrentStateIndicator
      currentState={currentState}
      presentation="icon"
    />,
    { wrapper },
  );

const WRITING_PATH =
  "M17 4a2.12 2.12 0 0 1 0 3l-9.5 9.5l-4 1l1-3.944l9.504-9.552a2.116 2.116 0 0 1 2.864-.125zM9.5 17.5h8m-2-11l1 1";
const LOADING_SPINNER_PATH = "M22.5 4.742A13 13 0 1 0 29 16";
const PLAN_READY_PATH =
  "m5.97 3l-.314.344S4.9 4 4.406 4v2c.68 0 1.15-.276 1.594-.53V10h2V3zM11 6v2h17V6zm-4.5 6A2.497 2.497 0 0 0 4 14.5v.5h2v-.5c0-.217.283-.5.5-.5s.5.283.5.5l-.03.03l-.064.064l-2.593 2.5l-.313.28V19h5v-2H7.28l.876-.875l.125-.094l-.03-.03c.502-.41.75-1.02.75-1.5A2.5 2.5 0 0 0 6.5 12m4.5 3v2h17v-2zm-7 6v2h1.375l-.25.406l-.125.22V25h1.5c.217 0 .5.283.5.5s-.283.5-.5.5H4v2h2.5C7.883 28 9 26.883 9 25.5c0-1.005-.678-1.696-1.53-2.094l.405-.687l.125-.25V21zm7 3v2h17v-2z";

describe("AgentSessionCurrentStateIndicator", () => {
  it.each([
    {
      currentState: AgentSessionCurrentState.Starting,
      ariaLabel: "Starting",
      actionable: "false",
      active: "true",
    },
    {
      currentState: AgentSessionCurrentState.Thinking,
      ariaLabel: "Thinking",
      actionable: "false",
      active: "true",
    },
    {
      currentState: AgentSessionCurrentState.Writing,
      ariaLabel: "Writing",
      actionable: "false",
      active: "true",
    },
    {
      currentState: AgentSessionCurrentState.AwaitingApproval,
      ariaLabel: "Awaiting approval",
      actionable: "true",
      active: "false",
    },
    {
      currentState: AgentSessionCurrentState.PlanReady,
      ariaLabel: "Plan ready",
      actionable: "true",
      active: "false",
    },
    {
      currentState: AgentSessionCurrentState.ImplementationReady,
      ariaLabel: "Implementation ready",
      actionable: "true",
      active: "false",
    },
  ])(
    "renders $currentState as its shared accessible icon",
    ({ currentState, ariaLabel, actionable, active }) => {
      renderIndicator(currentState);

      const indicator = screen.getByTestId(
        "agent-session-current-state-indicator",
      );
      expect(indicator).toHaveAttribute("data-current-state", currentState);
      expect(indicator).toHaveAttribute("data-actionable", actionable);
      expect(indicator).toHaveAttribute("data-active", active);
      expect(indicator).toHaveAttribute("data-presentation", "icon");
      expect(indicator).toHaveAttribute("aria-label", ariaLabel);
      expect(indicator).toHaveAttribute("aria-live", "polite");
      expect(
        screen.getByTestId("agent-session-current-state-icon"),
      ).toHaveAttribute("aria-hidden", "true");
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.queryByText(ariaLabel)).not.toBeInTheDocument();
    },
  );

  it("adds a numbered attention badge only to the plan-ready icon", () => {
    renderIndicator(AgentSessionCurrentState.PlanReady);

    const indicator = screen.getByTestId(
      "agent-session-current-state-indicator",
    );
    const icon = screen.getByTestId("agent-session-current-state-icon");
    const badge = indicator.querySelector(".MuiBadge-badge");

    expect(badge).toHaveTextContent("1");
    expect(badge).toHaveClass("MuiBadge-colorWarning");
    expect(badge?.parentElement).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(indicator).toHaveAttribute("aria-label", "Plan ready");
    expect(indicator.querySelector(".MuiBadge-root")).toContainElement(icon);
  });

  it("does not add an attention badge to other state icons", () => {
    renderIndicator(AgentSessionCurrentState.ImplementationReady);

    expect(
      screen
        .getByTestId("agent-session-current-state-indicator")
        .querySelector(".MuiBadge-badge"),
    ).not.toBeInTheDocument();
  });

  it.each([
    {
      currentState: AgentSessionCurrentState.Starting,
      activity: "starting",
      animation: "rotation",
      viewBox: "0 0 32 32",
      path: LOADING_SPINNER_PATH,
    },
    {
      currentState: AgentSessionCurrentState.Thinking,
      activity: "thinking",
      animation: "opacity",
      viewBox: "0 0 32 32",
      path: undefined,
    },
    {
      currentState: AgentSessionCurrentState.Writing,
      activity: "writing",
      animation: "opacity",
      viewBox: "0 0 21 21",
      path: WRITING_PATH,
    },
    {
      currentState: AgentSessionCurrentState.PlanReady,
      activity: "none",
      animation: "opacity",
      viewBox: "0 0 32 32",
      path: PLAN_READY_PATH,
    },
  ])(
    "renders the shared $animation glyph for $currentState",
    ({ currentState, activity, animation, viewBox, path }) => {
      renderIndicator(currentState);

      const icon = screen.getByTestId("agent-session-current-state-icon");
      expect(icon).toHaveAttribute("data-activity", activity);
      expect(icon).toHaveAttribute("data-animation", animation);
      expect(icon).toHaveAttribute("viewBox", viewBox);
      if (path) {
        expect(icon.querySelector(`path[d="${path}"]`)).toBeInTheDocument();
      }
    },
  );

  it.each([undefined, AgentSessionCurrentState.Idle])(
    "does not render an indicator for %s",
    (currentState) => {
      renderIndicator(currentState);

      expect(
        screen.queryByTestId("agent-session-current-state-indicator"),
      ).not.toBeInTheDocument();
    },
  );

  it("returns to a neutral presentation when the current state settles to idle", () => {
    const { rerender } = renderIndicator(AgentSessionCurrentState.Thinking);

    expect(
      screen.getByTestId("agent-session-current-state-indicator"),
    ).toHaveAttribute("data-active", "true");

    rerender(
      <AgentSessionCurrentStateIndicator
        currentState={AgentSessionCurrentState.Idle}
        presentation="icon"
      />,
    );

    expect(
      screen.queryByTestId("agent-session-current-state-indicator"),
    ).not.toBeInTheDocument();
  });

  it.each([
    {
      currentState: AgentSessionCurrentState.Starting,
      visibleText: "Starting conversation...",
    },
    {
      currentState: AgentSessionCurrentState.Thinking,
      visibleText: "hmmm...",
    },
    {
      currentState: AgentSessionCurrentState.Writing,
      visibleText: "{ outputting: true }",
    },
  ])(
    "renders the animated conversation treatment for $currentState",
    ({ currentState, visibleText }) => {
      render(
        <AgentSessionCurrentStateIndicator
          currentState={currentState}
          presentation="animated"
        />,
        { wrapper },
      );

      expect(
        screen.getByTestId("agent-session-current-state-indicator"),
      ).toHaveAttribute("data-presentation", "animated");
      expect(screen.getByTestId("thinking-indicator-gif")).toBeInTheDocument();
      expect(screen.getByText(visibleText)).toBeInTheDocument();
      expect(
        screen.queryByTestId("agent-session-current-state-icon"),
      ).not.toBeInTheDocument();
    },
  );
});
