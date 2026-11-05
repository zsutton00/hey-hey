import { ThemeProvider } from "@mui/material/styles";
import { render as baseRender, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
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
  it("marks question uncertainties as needing an answer", () => {
    render(
      <UncertaintyItem
        category={AgentUncertaintySystemMessageDataCategoryEnum.Question}
        severity="high"
        statement="Which option should I choose?"
        testId="uncertainty"
      />,
    );

    expect(screen.getByText("Needs your answer")).toBeVisible();
    expect(screen.getByText("Question")).toBeVisible();
  });

  const otherCategories: AgentUncertaintySystemMessageData["category"][] = [
    AgentUncertaintySystemMessageDataCategoryEnum.LackOfEvidence,
    AgentUncertaintySystemMessageDataCategoryEnum.Conflict,
    AgentUncertaintySystemMessageDataCategoryEnum.Ambiguity,
    AgentUncertaintySystemMessageDataCategoryEnum.NotImplemented,
  ];

  it.each(otherCategories)(
    "does not mark %s uncertainties as needing an answer",
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
});
