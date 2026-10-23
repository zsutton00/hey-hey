import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MultipleChoiceAction } from "../../../api";
import { MultipleChoiceField } from "./MultipleChoiceField";
import type { FieldConfig } from "./types";

const mockContext = {
  conversationId: "conversation-1",
  projectId: "project-1",
  organizationId: "organization-1",
};

const mockConfig: FieldConfig = {
  field: "onboarding-branch",
  description: "Choose how you want to proceed",
  type: "multiple_choice",
  required: true,
  payload: {
    options: [
      {
        title: "Plans",
        description: "Fast setup for simple projects.",
        action: MultipleChoiceAction.CreatePlan,
      },
      {
        title: "Initiatives",
        description: "Longer-running, multi-user project setup.",
        action: MultipleChoiceAction.CreateInitiative,
      },
    ],
  },
};

describe("MultipleChoiceField", () => {
  it("renders option titles and descriptions", () => {
    render(
      <MultipleChoiceField
        config={mockConfig}
        isSubmitted={false}
        context={mockContext}
      />
    );

    expect(screen.getByText("Plans")).toBeInTheDocument();
    expect(screen.getByText("Initiatives")).toBeInTheDocument();
    expect(
      screen.getByText("Fast setup for simple projects.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Longer-running, multi-user project setup.")
    ).toBeInTheDocument();
  });

  it("emits create-plan when plans option is selected", () => {
    const onChange = vi.fn();
    render(
      <MultipleChoiceField
        config={mockConfig}
        onChange={onChange}
        isSubmitted={false}
        context={mockContext}
      />
    );

    fireEvent.click(
      screen.getByTestId(
        `multiple-choice-option-${MultipleChoiceAction.CreatePlan}`
      )
    );

    expect(onChange).toHaveBeenCalledWith(MultipleChoiceAction.CreatePlan);
  });

  it("emits create-initiative when initiatives option is selected", () => {
    const onChange = vi.fn();
    render(
      <MultipleChoiceField
        config={mockConfig}
        onChange={onChange}
        isSubmitted={false}
        context={mockContext}
      />
    );

    fireEvent.click(
      screen.getByTestId(
        `multiple-choice-option-${MultipleChoiceAction.CreateInitiative}`
      )
    );

    expect(onChange).toHaveBeenCalledWith(
      MultipleChoiceAction.CreateInitiative
    );
  });

  it("does not emit changes when submitted", () => {
    const onChange = vi.fn();
    render(
      <MultipleChoiceField
        config={mockConfig}
        onChange={onChange}
        isSubmitted={true}
        context={mockContext}
      />
    );

    fireEvent.click(
      screen.getByTestId(
        `multiple-choice-option-${MultipleChoiceAction.CreatePlan}`
      )
    );

    expect(onChange).not.toHaveBeenCalled();
  });
});
