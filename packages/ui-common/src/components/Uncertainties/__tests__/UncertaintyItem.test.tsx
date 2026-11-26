import { ThemeProvider } from "@mui/material/styles";
import { render as baseRender, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AgentUncertaintySystemMessageData } from "../../../api";
import { AgentUncertaintySystemMessageDataCategoryEnum } from "../../../api";
import { createHeyTheme } from "../../../contexts/ThemeContext";
import { UncertaintyItem } from "../UncertaintyItem";

const themeWrapper = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider theme={createHeyTheme("light")}>{children}</ThemeProvider>
);

const render = (ui: React.ReactElement) =>
  baseRender(ui, { wrapper: themeWrapper });

describe("UncertaintyItem", () => {
  it("shows Feature Sync with Discuss as its only control", async () => {
    const onDiscuss = vi.fn();
    render(
      <UncertaintyItem
        category={AgentUncertaintySystemMessageDataCategoryEnum.FeatureSync}
        severity="medium"
        statement="The Mockup shows the export control in the toolbar, but it moved to the menu."
        testId="uncertainty"
        onDiscuss={onDiscuss}
      />,
    );

    expect(screen.getByText("Feature Sync")).toBeVisible();
    const discuss = screen.getByRole("button", {
      name: "Discuss this uncertainty",
    });
    expect(screen.getAllByRole("button")).toEqual([discuss]);
    await userEvent.click(discuss);
    expect(onDiscuss).toHaveBeenCalledOnce();
  });

  it("marks question uncertainties as needing an answer", () => {
    render(
      <UncertaintyItem
        category={AgentUncertaintySystemMessageDataCategoryEnum.Question}
        severity="high"
        statement="Which option should I choose?"
        testId="uncertainty"
      />,
    );

    expect(screen.getByTestId("uncertainty")).toHaveAttribute(
      "data-tone",
      "needsAnswer",
    );
    expect(screen.getByText("Needs your answer")).toBeVisible();
    expect(screen.getByText("Question")).toBeVisible();
    expect(screen.getByTestId("conversation-card-lead")).toHaveTextContent(
      "Which option should I choose?",
    );
  });

  it.each(["light", "dark"] as const)(
    "renders a question card in the %s theme",
    (mode) => {
      baseRender(
        <ThemeProvider theme={createHeyTheme(mode)}>
          <UncertaintyItem
            category={AgentUncertaintySystemMessageDataCategoryEnum.Question}
            severity="high"
            statement="Which option should I choose?"
            testId="uncertainty"
          />
        </ThemeProvider>,
      );

      expect(screen.getByTestId("uncertainty")).toHaveAttribute(
        "data-tone",
        "needsAnswer",
      );
      expect(screen.getByText("high")).toBeVisible();
    },
  );

  it("shows several questions in the order raised", () => {
    render(
      <>
        {["First question?", "Second question?"].map((statement) => (
          <UncertaintyItem
            key={statement}
            category={AgentUncertaintySystemMessageDataCategoryEnum.Question}
            severity="medium"
            statement={statement}
            testId="uncertainty"
          />
        ))}
      </>,
    );

    const leads = screen
      .getAllByTestId("conversation-card-lead")
      .map((lead) => lead.textContent);
    expect(leads).toEqual(["First question?", "Second question?"]);
  });

  const otherCategories: AgentUncertaintySystemMessageData["category"][] = [
    AgentUncertaintySystemMessageDataCategoryEnum.LackOfEvidence,
    AgentUncertaintySystemMessageDataCategoryEnum.Conflict,
    AgentUncertaintySystemMessageDataCategoryEnum.Ambiguity,
    AgentUncertaintySystemMessageDataCategoryEnum.NotImplemented,
  ];

  it.each(otherCategories)(
    "frames %s uncertainties by severity with label, severity and category",
    (category) => {
      render(
        <UncertaintyItem
          category={category}
          severity="medium"
          statement="The available evidence is incomplete."
          testId="uncertainty"
        />,
      );

      expect(screen.queryByText("Needs your answer")).not.toBeInTheDocument();
      expect(screen.getByTestId("uncertainty")).toHaveAttribute(
        "data-tone",
        "medium",
      );
      expect(screen.getByText("Uncertainty")).toBeVisible();
      expect(screen.getByText("medium severity")).toBeInTheDocument();
      expect(screen.queryByText("medium")).not.toBeInTheDocument();
      expect(screen.getByTestId("conversation-card-lead")).toHaveTextContent(
        "The available evidence is incomplete.",
      );
    },
  );

  it("keeps the screen-reader severity label from taking up layout space", () => {
    render(
      <UncertaintyItem
        category={AgentUncertaintySystemMessageDataCategoryEnum.Conflict}
        severity="low"
        statement="Two requirements disagree."
        testId="uncertainty"
      />,
    );

    // A full-size hidden label overflows the conversation and adds a scroller.
    expect(screen.getByText("low severity")).toHaveStyle({
      position: "absolute",
      width: "1px",
      height: "1px",
    });
  });

  it.each([
    ["light", "high"],
    ["dark", "high"],
    ["light", "medium"],
    ["dark", "low"],
  ] as const)(
    "colors the full border by severity in the %s theme (%s), never red",
    (mode, severity) => {
      const theme = createHeyTheme(mode);
      baseRender(
        <ThemeProvider theme={theme}>
          <UncertaintyItem
            category={AgentUncertaintySystemMessageDataCategoryEnum.Conflict}
            severity={severity}
            statement="Two sources disagree."
            testId="uncertainty"
          />
        </ThemeProvider>,
      );

      const tone = theme.palette.conversationCard.severities[severity];
      expect(screen.getByTestId("uncertainty")).toHaveStyle({
        borderStyle: "solid",
        borderWidth: "2px",
        borderColor: tone.main,
      });
      expect(screen.getByText("Conflict")).toBeVisible();
    },
  );

  it("shows the answer band only when asked, keeping the question label", () => {
    render(
      <UncertaintyItem
        category={AgentUncertaintySystemMessageDataCategoryEnum.Question}
        severity="low"
        statement="Which option should I choose?"
        testId="uncertainty"
        showAnswerBand={false}
      />,
    );

    expect(screen.queryByText("Needs your answer")).not.toBeInTheDocument();
    expect(screen.getByText("Question")).toBeVisible();
    expect(screen.getByText("low")).toBeVisible();
  });
  describe("Discuss control", () => {
    it("shows an accessible control on a non-question card and calls onDiscuss by click and keyboard", async () => {
      const onDiscuss = vi.fn();
      render(
        <UncertaintyItem
          category={
            AgentUncertaintySystemMessageDataCategoryEnum.LackOfEvidence
          }
          severity="low"
          statement="Nothing confirms this detail."
          testId="uncertainty"
          onDiscuss={onDiscuss}
        />,
      );

      const control = screen.getByRole("button", {
        name: "Discuss this uncertainty",
      });
      expect(control).toHaveTextContent("");

      await userEvent.click(control);
      control.focus();
      await userEvent.keyboard("{Enter}");

      expect(onDiscuss).toHaveBeenCalledTimes(2);
    });

    it("is absent on question cards and when no handler is given", () => {
      const { rerender } = render(
        <UncertaintyItem
          category={AgentUncertaintySystemMessageDataCategoryEnum.Question}
          severity="high"
          statement="Which option?"
          testId="uncertainty"
          onDiscuss={vi.fn()}
        />,
      );
      expect(
        screen.queryByTestId("uncertainty-discuss-control"),
      ).not.toBeInTheDocument();

      rerender(
        <UncertaintyItem
          category={
            AgentUncertaintySystemMessageDataCategoryEnum.LackOfEvidence
          }
          severity="low"
          statement="Nothing confirms this detail."
          testId="uncertainty"
        />,
      );
      expect(
        screen.queryByTestId("uncertainty-discuss-control"),
      ).not.toBeInTheDocument();
    });
  });

  it.each([
    AgentUncertaintySystemMessageDataCategoryEnum.Conflict,
    AgentUncertaintySystemMessageDataCategoryEnum.Question,
  ])(
    "renders a canonical mention in a %s statement as a mention node",
    (category) => {
      render(
        <MemoryRouter>
          <UncertaintyItem
            category={category}
            severity="high"
            statement="@[bug:d7c6524b-b381-4b1a-99ba-29623b12495a|Keep sent file chips on the same row] still says X"
            testId="uncertainty"
            onDiscuss={() => undefined}
          />
        </MemoryRouter>,
      );

      expect(screen.getByTestId("mention-badge")).toBeInTheDocument();
      expect(
        screen.getByTestId("conversation-card-lead"),
      ).not.toHaveTextContent("@[bug:");
    },
  );
});
