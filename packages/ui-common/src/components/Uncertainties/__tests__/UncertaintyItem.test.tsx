import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AgentUncertaintySystemMessageData } from "../../../api";
import { AgentUncertaintySystemMessageDataCategoryEnum } from "../../../api";
import { UncertaintyItem } from "../UncertaintyItem";

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
});
