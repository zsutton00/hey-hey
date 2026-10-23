import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { JourneyMap } from "../../../../api";
import { PlanGenerationJourneyReviewField } from "../PlanGenerationJourneyReviewField";
import type { FieldComponentContext, FieldConfig } from "../types";
import type { PlanGenerationJourneyReviewValue } from "../types";

vi.mock("../../../SmarterTextAreaCard", () => ({
  SmarterTextAreaCard: ({
    value,
    onChange,
    placeholder,
    disabled,
  }: {
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
    disabled?: boolean;
  }) => (
    <textarea
      data-testid="mock-smarter-textarea"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const buildJourneyMap = (): JourneyMap => ({
  steps: [
    {
      id: "step-1",
      title: "Open the conversation",
      description: "User opens the chat.",
      isUserInteractive: true,
      implementationNotes: [
        {
          text: "Wire the websocket",
          serviceId: "svc-1",
          serviceName: "API",
        },
      ],
    },
    {
      id: "step-2",
      title: "See the response",
      description: "Agent replies.",
      isUserInteractive: false,
      implementationNotes: [],
    },
  ],
});

const baseConfig = (journeyMap: JourneyMap): FieldConfig => ({
  field: "journey_review_field",
  description: "Review the journey",
  type: "plan_generation_journey_review",
  payload: journeyMap as unknown as FieldConfig["payload"],
});

const baseContext: FieldComponentContext = {
  conversationId: "conversation-1",
  projectId: "project-1",
  organizationId: "org-1",
};

describe("PlanGenerationJourneyReviewField", () => {
  it("renders the JourneyMap pulled off uiElement.payload", () => {
    const journeyMap = buildJourneyMap();

    render(
      <PlanGenerationJourneyReviewField
        config={baseConfig(journeyMap)}
        context={baseContext}
        isSubmitted={false}
        onChange={vi.fn()}
      />
    );

    const phases = screen.getByTestId("plan-generation-journey-review-phases");
    expect(
      within(phases).getAllByTestId(
        /plan-generation-journey-review-phase-card-/
      )
    ).toHaveLength(2);
    expect(screen.getByText("Open the conversation")).toBeInTheDocument();
    expect(screen.getByText("See the response")).toBeInTheDocument();
    expect(
      screen.getByTestId("plan-generation-journey-review-phase-card-step-1")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("plan-generation-journey-review-phase-card-step-2")
    ).toBeInTheDocument();
  });

  it("renders an amber warning banner below the journey steps", () => {
    const journeyMap = buildJourneyMap();

    render(
      <PlanGenerationJourneyReviewField
        config={baseConfig(journeyMap)}
        context={baseContext}
        isSubmitted={false}
        onChange={vi.fn()}
      />
    );

    expect(
      screen.getByText(/Review these steps carefully/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByTestId("plan-generation-journey-review-phase-card-step-1")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("plan-generation-journey-review-phase-card-step-2")
    ).toBeInTheDocument();
  });

  it("seeds the JourneyMap into form value on first render via onChange", () => {
    const journeyMap = buildJourneyMap();
    const onChange = vi.fn<[PlanGenerationJourneyReviewValue], void>();

    render(
      <PlanGenerationJourneyReviewField
        config={baseConfig(journeyMap)}
        context={baseContext}
        isSubmitted={false}
        onChange={onChange}
      />
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    const seeded = onChange.mock.calls[0][0];
    expect(seeded.payload.journeyMap.steps.map((step) => step.id)).toEqual([
      "step-1",
      "step-2",
    ]);
    expect(seeded.payload.feedback).toBe("");
    expect(seeded.action).toBeUndefined();
  });

  it("does not re-seed when a value is already provided", () => {
    const journeyMap = buildJourneyMap();
    const onChange = vi.fn<[PlanGenerationJourneyReviewValue], void>();

    render(
      <PlanGenerationJourneyReviewField
        config={baseConfig(journeyMap)}
        context={baseContext}
        isSubmitted={false}
        value={{ payload: { journeyMap, feedback: "" } }}
        onChange={onChange}
      />
    );

    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders a feedback textarea that pushes typed text onto the form value via onChange", () => {
    const journeyMap = buildJourneyMap();
    const onChange = vi.fn<[PlanGenerationJourneyReviewValue], void>();

    render(
      <PlanGenerationJourneyReviewField
        config={baseConfig(journeyMap)}
        context={baseContext}
        isSubmitted={false}
        value={{ payload: { journeyMap, feedback: "" } }}
        onChange={onChange}
      />
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, {
      target: { value: "collapse the auth steps" },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0];
    expect(next.payload.feedback).toBe("collapse the auth steps");
    expect(next.payload.journeyMap).toBe(journeyMap);
  });

  it("renders implementation notes indented inside each phase card", () => {
    const journeyMap = buildJourneyMap();

    render(
      <PlanGenerationJourneyReviewField
        config={baseConfig(journeyMap)}
        context={baseContext}
        isSubmitted={false}
        value={{ payload: { journeyMap, feedback: "" } }}
        onChange={vi.fn()}
      />
    );

    const phaseCard = screen.getByTestId(
      "plan-generation-journey-review-phase-card-step-1"
    );
    const breakdowns = within(phaseCard).getByTestId(
      "plan-generation-journey-review-breakdowns-step-1"
    );

    expect(
      within(breakdowns).getByText("Wire the websocket")
    ).toBeInTheDocument();
    expect(within(phaseCard).getByText("Validation")).toBeInTheDocument();
  });

  it("hides the textarea after submission when there is no feedback to show", () => {
    const journeyMap = buildJourneyMap();

    render(
      <PlanGenerationJourneyReviewField
        config={baseConfig(journeyMap)}
        context={baseContext}
        isSubmitted={true}
        value={{ payload: { journeyMap, feedback: "" } }}
        onChange={vi.fn()}
      />
    );

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
