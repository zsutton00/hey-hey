import { describe, expect, it } from "vitest";
import {
  FIELD_REGISTRY,
  getProposalsRenderConfig,
  getRegistryType,
} from "../Registry";
import type { VerifyFeatureElement } from "../../../../api";

describe("Verify Feature registry", () => {
  it("initializes a display-only field from its generated payload", () => {
    const field: VerifyFeatureElement = {
      id: "verify-feature", type: "verify_feature", label: "Verify Feature",
      payload: { feature: { entityType: "FEATURE", entityId: "3782302e-54ad-4908-b168-0b2260a89b3c" }, explanation: "Changed behavior" },
    };
    const entry = FIELD_REGISTRY[getRegistryType(field)];
    expect(entry.prepareInitialValue?.({ uiElement: field, baseValue: undefined, messageData: {
      type: "QUESTIONS", response: "Done", uiElements: [field],
    } })).toEqual(field.payload);
    expect(entry.getHasContent(field.payload)).toBe(false);
    expect(entry.shouldShowButtons?.(field.payload)).toBe(false);
  });
});

describe("Review file-scope registry", () => {
  it("registers both the OpenAPI discriminator and normalized field type", () => {
    expect(getRegistryType("agent-request-review-file-scope")).toBe(
      "agent_request_review_file_scope"
    );
    expect(getRegistryType("agent_request_review_file_scope")).toBe(
      "agent_request_review_file_scope"
    );
  });
});

describe("Visual plan preview registry", () => {
  it("registers the field and keeps proposal rendering inside the stepper", () => {
    expect(FIELD_REGISTRY.plan_generation_visual_preview).toBeDefined();
    expect(
      getProposalsRenderConfig([
        { id: "visual-preview", type: "plan_generation_visual_preview" },
      ]),
    ).toEqual({ autoRender: false, placement: "below-element" });
  });
});
