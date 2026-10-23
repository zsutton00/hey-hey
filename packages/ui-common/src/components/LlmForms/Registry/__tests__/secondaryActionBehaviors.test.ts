import { describe, expect, it } from "vitest";
import { WorkflowReviewAction, type JourneyMap } from "../../../../api";
import {
  applyPlanGenerationJourneyMapApprove,
  applyPlanGenerationJourneyMapContinueRevising,
  tryUpdatePlanGenerationVisualPreviewAction,
  tryUpdatePlanGenerationStageReviewAction,
  tryUpdatePlanGenerationStepReviewAction,
} from "../secondaryActionBehaviors";
import type { FormValue } from "../../types";
import type {
  PlanGenerationJourneyReviewValue,
  PlanGenerationStageReviewValue,
  PlanGenerationStepReviewValue,
} from "../types";

const buildJourneyMap = (): JourneyMap => ({
  steps: [
    {
      id: "step-a",
      title: "Step A",
      description: "Desc",
      isUserInteractive: false,
      implementationNotes: [],
    },
  ],
});

describe("visual preview review actions", () => {
  it("projects revision feedback and approval through the canonical actions", () => {
    const formValues: Record<string, FormValue> = {
      "visual-preview": {
        payload: { feedback: "Show the empty state" },
      } as FormValue,
    };

    expect(
      tryUpdatePlanGenerationVisualPreviewAction(
        formValues,
        "visual-preview",
        "REFINE",
      ).values["visual-preview"],
    ).toEqual({
      action: "REFINE",
      payload: { feedback: "Show the empty state" },
    });
    expect(
      tryUpdatePlanGenerationVisualPreviewAction(
        formValues,
        "visual-preview",
        "APPROVED",
      ).values["visual-preview"],
    ).toEqual({ action: "APPROVED", payload: {} });
  });
});

describe("applyPlanGenerationJourneyMapApprove", () => {
  it("projects approval to the canonical action with an empty payload", () => {
    const journeyMap = buildJourneyMap();
    const initial: PlanGenerationJourneyReviewValue = {
      payload: { journeyMap, feedback: "looks good" },
    };
    const formValues: Record<string, FormValue> = {
      "journey-review-field": initial as unknown as FormValue,
    };

    const result = applyPlanGenerationJourneyMapApprove(
      formValues,
      "journey-review-field",
    );

    expect(result.updated).toBe(true);
    const updated = result.values[
      "journey-review-field"
    ] as PlanGenerationJourneyReviewValue;
    expect(updated).toEqual({
      action: WorkflowReviewAction.Approved,
      payload: {},
    });
  });

  it("locates the journey-review value by predicate when fieldId is not provided", () => {
    const journeyMap = buildJourneyMap();
    const formValues: Record<string, FormValue> = {
      "other-field": "unrelated" as unknown as FormValue,
      "journey-review-field": {
        payload: { journeyMap, feedback: "" },
      } as unknown as FormValue,
    };

    const result = applyPlanGenerationJourneyMapApprove(formValues, undefined);

    expect(result.updated).toBe(true);
    const updated = result.values[
      "journey-review-field"
    ] as PlanGenerationJourneyReviewValue;
    expect(updated.action).toBe(WorkflowReviewAction.Approved);
  });

  it("does nothing when no journey-review value is present", () => {
    const formValues: Record<string, FormValue> = {
      "other-field": "unrelated" as unknown as FormValue,
    };

    const result = applyPlanGenerationJourneyMapApprove(formValues, "missing");

    expect(result.updated).toBe(false);
    expect(result.values).toEqual(formValues);
  });
});

describe("applyPlanGenerationJourneyMapContinueRevising", () => {
  it("projects refinement to the canonical action with feedback only", () => {
    const journeyMap = buildJourneyMap();
    const initial: PlanGenerationJourneyReviewValue = {
      payload: { journeyMap, feedback: "collapse auth steps" },
    };
    const formValues: Record<string, FormValue> = {
      "journey-review-field": initial as unknown as FormValue,
    };

    const result = applyPlanGenerationJourneyMapContinueRevising(
      formValues,
      "journey-review-field",
    );

    expect(result.updated).toBe(true);
    const updated = result.values[
      "journey-review-field"
    ] as PlanGenerationJourneyReviewValue;
    expect(updated).toEqual({
      action: WorkflowReviewAction.Refine,
      payload: { feedback: "collapse auth steps" },
    });
  });
});

describe("generated plan-generation review actions", () => {
  it("projects the stage-review value through generated action types", () => {
    const initial: PlanGenerationStageReviewValue = {
      payload: { feedback: "split the delivery stage" },
    };

    const result = tryUpdatePlanGenerationStageReviewAction(
      { stage: initial as FormValue },
      "stage",
      WorkflowReviewAction.Refine,
    );

    expect(result.updated).toBe(true);
    expect(result.values.stage).toEqual({
      action: WorkflowReviewAction.Refine,
      payload: { feedback: "split the delivery stage" },
    });
  });

  it("projects the step-review value through generated action types", () => {
    const initial: PlanGenerationStepReviewValue = {
      payload: { feedback: "combine the setup steps" },
    };

    const result = tryUpdatePlanGenerationStepReviewAction(
      { steps: initial as FormValue },
      "steps",
      WorkflowReviewAction.Approved,
    );

    expect(result.updated).toBe(true);
    expect(result.values.steps).toEqual({
      action: WorkflowReviewAction.Approved,
      payload: {},
    });
  });
});
