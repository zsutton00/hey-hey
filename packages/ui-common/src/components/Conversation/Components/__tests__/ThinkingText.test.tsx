import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { AgentSessionCurrentState } from "../../../../api";
import { ThinkingText } from "../ThinkingText";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../../../hooks/useTypingAnimation", () => ({
  useTypingAnimation: ({ description }: { description: string }) => ({
    displayedDescription: description,
    isTyping: false,
    promptPhrase: "",
    startAnimation: () => undefined,
    showFullText: () => undefined,
  }),
}));

const theme = createTheme();

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ThemeProvider theme={theme}>{children}</ThemeProvider>
);

describe("ThinkingText", () => {
  it("renders the thinking gif and cycling word caption for the default 'Thinking...' state", () => {
    render(<ThinkingText text="Thinking..." />, { wrapper });

    const gif = screen.getByTestId("thinking-indicator-gif");
    expect(gif).toBeInTheDocument();
    expect(gif.getAttribute("src")).toContain("thinking_1");

    expect(screen.getByTestId("thinking-caption")).toHaveTextContent("hmmm...");
    expect(screen.queryByTestId("writing-caption")).not.toBeInTheDocument();
  });

  it("renders the writing gif and cycling phrase caption for the 'Writing Response...' state", () => {
    render(<ThinkingText text="Writing Response..." />, { wrapper });

    const gif = screen.getByTestId("thinking-indicator-gif");
    expect(gif).toBeInTheDocument();
    expect(gif.getAttribute("src")).toContain("writing_1");

    expect(screen.getByTestId("writing-caption")).toHaveTextContent(
      "{ outputting: true }",
    );
    expect(screen.queryByTestId("thinking-caption")).not.toBeInTheDocument();
  });

  it("renders a spinner and the starting caption for the 'starting' phase", () => {
    render(
      <ThinkingText
        currentState={AgentSessionCurrentState.Starting}
        text="Starting conversation..."
      />,
      { wrapper },
    );

    const indicator = screen.getByTestId("thinking-indicator-gif");
    expect(indicator).toHaveAttribute("role", "progressbar");
    expect(indicator).not.toHaveAttribute("src");

    expect(screen.getByTestId("thinking-caption")).toHaveTextContent(
      "Starting conversation...",
    );
    expect(screen.queryByTestId("writing-caption")).not.toBeInTheDocument();
  });

  it("renders a spinner and the gathering caption while context is gathered", () => {
    render(
      <ThinkingText
        currentState={AgentSessionCurrentState.GatheringContext}
        text="Gathering context..."
      />,
      { wrapper },
    );

    expect(screen.getByTestId("thinking-indicator-gif")).toHaveAttribute(
      "role",
      "progressbar",
    );
    expect(screen.getByTestId("thinking-caption")).toHaveTextContent(
      "Gathering context...",
    );
  });

  it("falls back to the thinking gif and word caption for unrecognized text values", () => {
    render(<ThinkingText text="Réflexion..." />, { wrapper });

    const gif = screen.getByTestId("thinking-indicator-gif");
    expect(gif).toBeInTheDocument();
    expect(gif.getAttribute("src")).toContain("thinking_1");

    expect(screen.getByTestId("thinking-caption")).toBeInTheDocument();
    expect(screen.queryByTestId("writing-caption")).not.toBeInTheDocument();
  });

  describe("writing-state latch", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(0));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("switches to the writing gif and caption immediately when the text flips from Thinking to Writing", () => {
      const { rerender } = render(<ThinkingText text="Thinking..." />, {
        wrapper,
      });

      expect(
        screen.getByTestId("thinking-indicator-gif").getAttribute("src"),
      ).toContain("thinking_1");
      expect(screen.getByTestId("thinking-caption")).toBeInTheDocument();

      act(() => {
        rerender(
          <ThemeProvider theme={theme}>
            <ThinkingText text="Writing Response..." />
          </ThemeProvider>,
        );
      });

      expect(
        screen.getByTestId("thinking-indicator-gif").getAttribute("src"),
      ).toContain("writing_1");
      expect(screen.getByTestId("writing-caption")).toBeInTheDocument();
      expect(screen.queryByTestId("thinking-caption")).not.toBeInTheDocument();
    });

    it("switches from the starting spinner to the thinking gif when the phase changes to thinking", () => {
      const { rerender } = render(
        <ThinkingText
          currentState={AgentSessionCurrentState.Starting}
          text="Starting conversation..."
        />,
        {
          wrapper,
        },
      );

      expect(screen.getByTestId("thinking-indicator-gif")).toHaveAttribute(
        "role",
        "progressbar",
      );
      expect(screen.getByTestId("thinking-caption")).toHaveTextContent(
        "Starting conversation...",
      );

      act(() => {
        rerender(
          <ThemeProvider theme={theme}>
            <ThinkingText
              currentState={AgentSessionCurrentState.Thinking}
              text="Thinking..."
            />
          </ThemeProvider>,
        );
      });

      expect(
        screen.getByTestId("thinking-indicator-gif").getAttribute("src"),
      ).toContain("thinking_1");
      expect(screen.getByTestId("thinking-caption")).toHaveTextContent(
        "hmmm...",
      );
    });

    it("keeps the writing gif and caption visible when the text reverts to Thinking before the 5s latch elapses", () => {
      const { rerender } = render(<ThinkingText text="Thinking..." />, {
        wrapper,
      });

      act(() => {
        rerender(
          <ThemeProvider theme={theme}>
            <ThinkingText text="Writing Response..." />
          </ThemeProvider>,
        );
      });

      expect(screen.getByTestId("writing-caption")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(500);
      });

      act(() => {
        rerender(
          <ThemeProvider theme={theme}>
            <ThinkingText text="Thinking..." />
          </ThemeProvider>,
        );
      });

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(
        screen.getByTestId("thinking-indicator-gif").getAttribute("src"),
      ).toContain("writing_1");
      expect(screen.getByTestId("writing-caption")).toBeInTheDocument();
      expect(screen.queryByTestId("thinking-caption")).not.toBeInTheDocument();
    });

    it("returns to the thinking gif and caption once the 5s latch elapses while the parent text stays on Thinking", () => {
      const { rerender } = render(<ThinkingText text="Writing Response..." />, {
        wrapper,
      });

      act(() => {
        rerender(
          <ThemeProvider theme={theme}>
            <ThinkingText text="Thinking..." />
          </ThemeProvider>,
        );
      });

      act(() => {
        vi.advanceTimersByTime(5100);
      });

      expect(
        screen.getByTestId("thinking-indicator-gif").getAttribute("src"),
      ).toContain("thinking_1");
      expect(screen.getByTestId("thinking-caption")).toBeInTheDocument();
      expect(screen.queryByTestId("writing-caption")).not.toBeInTheDocument();
    });

    it("renders the thinking caption as a single static element with no nested animation span", () => {
      render(<ThinkingText text="Thinking..." />, { wrapper });

      const caption = screen.getByTestId("thinking-caption");
      expect(caption).toHaveTextContent("hmmm...");
      expect(caption.firstElementChild).toBeNull();

      act(() => {
        vi.advanceTimersByTime(20000);
      });

      expect(screen.getByTestId("thinking-caption")).toHaveTextContent(
        "hmmm...",
      );
    });
  });
});
