import { describe, expect, it } from "vitest";
import {
  ExtendedUIFieldType,
  SecondaryActionHandler,
  type UIElement,
} from "../../../../api";
import { getSecondaryActionBehavior } from "../Registry";

const createElement = (id: string, type: UIElement["type"]): UIElement => ({
  id,
  type,
  label: "Field",
});

describe("getSecondaryActionBehavior", () => {
  it("keeps Continue Revising on the visual field ungated", () => {
    const element = createElement(
      "visual-preview-1",
      ExtendedUIFieldType.PlanGenerationVisualPreview,
    );

    const behavior = getSecondaryActionBehavior({
      handler:
        SecondaryActionHandler.PlanGenerationVisualPreviewContinueRevising,
      fieldId: element.id,
      uiElements: [element],
    });

    expect(behavior).toBeDefined();
    expect(typeof behavior?.apply).toBe("function");
    expect(behavior?.getAvailability).toBeUndefined();
  });

  it("routes Continue Revising to the feedback textarea when the visual field shares the message", () => {
    const visual = createElement(
      "visual-preview-1",
      ExtendedUIFieldType.PlanGenerationVisualPreview,
    );
    const textarea = createElement("feedback-1", ExtendedUIFieldType.Textarea);
    const formValues = {
      [visual.id]: { payload: { feedback: "" } },
      [textarea.id]: "",
    };

    const behavior = getSecondaryActionBehavior({
      handler:
        SecondaryActionHandler.PlanGenerationVisualPreviewContinueRevising,
      fieldId: textarea.id,
      uiElements: [visual, textarea],
    });

    expect(behavior?.getAvailability).toBeUndefined();
    expect(
      behavior?.apply?.({
        config: {
          id: "continue-revising",
          type: "field_action",
          label: "Continue Revising",
          handler:
            SecondaryActionHandler.PlanGenerationVisualPreviewContinueRevising,
          fieldId: textarea.id,
          presentation: "BUTTON",
        },
        formValues,
      }),
    ).toEqual({
      ...formValues,
      [textarea.id]: {
        action: "REFINE",
        payload: { feedback: "" },
      },
    });
  });

  it("resolves visual-preview review actions for a generic feedback textarea", () => {
    const element = createElement("feedback-1", ExtendedUIFieldType.Textarea);

    const continueRevising = getSecondaryActionBehavior({
      handler:
        SecondaryActionHandler.PlanGenerationVisualPreviewContinueRevising,
      fieldId: element.id,
      uiElements: [element],
    });
    const approve = getSecondaryActionBehavior({
      handler: SecondaryActionHandler.PlanGenerationVisualPreviewApprove,
      fieldId: element.id,
      uiElements: [element],
    });

    expect(continueRevising).toBeDefined();
    expect(approve).toBeDefined();
    expect(continueRevising?.getAvailability).toBeUndefined();
    expect(
      continueRevising?.apply?.({
        config: {
          id: "continue-revising",
          type: "field_action",
          label: "Continue Revising",
          handler:
            SecondaryActionHandler.PlanGenerationVisualPreviewContinueRevising,
          fieldId: element.id,
          presentation: "BUTTON",
        },
        formValues: { [element.id]: "Show the empty state" },
      }),
    ).toEqual({
      [element.id]: {
        action: "REFINE",
        payload: { feedback: "Show the empty state" },
      },
    });
    expect(
      continueRevising?.apply?.({
        config: {
          id: "continue-revising",
          type: "field_action",
          label: "Continue Revising",
          handler:
            SecondaryActionHandler.PlanGenerationVisualPreviewContinueRevising,
          fieldId: element.id,
          presentation: "BUTTON",
        },
        formValues: { [element.id]: "" },
      }),
    ).toEqual({
      [element.id]: {
        action: "REFINE",
        payload: { feedback: "" },
      },
    });
    expect(
      approve?.apply?.({
        config: {
          id: "approve",
          type: "field_action",
          label: "Approve Visual Set",
          handler: SecondaryActionHandler.PlanGenerationVisualPreviewApprove,
          fieldId: element.id,
          presentation: "BUTTON",
        },
        formValues: { [element.id]: "" },
      }),
    ).toEqual({
      [element.id]: {
        action: "APPROVED",
        payload: {},
      },
    });
  });

  it("resolves PlanGenerationJourneyMapApprove for a PlanGenerationJourneyReview field", () => {
    const element = createElement(
      "journey-review-1",
      ExtendedUIFieldType.PlanGenerationJourneyReview,
    );

    const behavior = getSecondaryActionBehavior({
      handler: SecondaryActionHandler.PlanGenerationJourneyMapApprove,
      fieldId: element.id,
      uiElements: [element],
    });

    expect(behavior).toBeDefined();
    expect(typeof behavior?.apply).toBe("function");
  });

  it("resolves a readiness action to the only matching field when its fieldId is stale", () => {
    const element = createElement(
      "readiness-field",
      ExtendedUIFieldType.ImplementationReadiness,
    );

    const behavior = getSecondaryActionBehavior({
      handler: SecondaryActionHandler.ImplementationReadinessDismiss,
      fieldId: "stale-readiness-field",
      uiElements: [element],
    });

    expect(behavior).toBeDefined();
    expect(typeof behavior?.apply).toBe("function");
  });
});
