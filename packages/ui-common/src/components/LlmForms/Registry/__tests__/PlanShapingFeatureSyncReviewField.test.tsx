import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlanShapingFeatureSyncReviewField } from "../PlanShapingFeatureSyncReviewField";
import type { FieldComponentContext, FieldConfig } from "../types";

vi.mock("../../../SmarterTextAreaCard", () => ({
  SmarterTextAreaCard: ({
    disabled,
    onChange,
    onSubmit,
    placeholder,
    value,
  }: {
    disabled?: boolean;
    onChange: (value: string) => void;
    onSubmit?: () => void;
    placeholder?: string;
    value: string;
  }) => (
    <>
      <textarea
        data-testid="feature-sync-feedback"
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        data-testid="feature-sync-keyboard-submit"
        disabled={disabled || !onSubmit}
        onClick={onSubmit}
      />
    </>
  ),
}));

const context: FieldComponentContext = {
  conversationId: "conversation-1",
  projectId: "project-1",
  organizationId: "organization-1",
};

const config: FieldConfig = {
  field: "feature-sync-review-field",
  description: "Review flagged items",
  type: "plan_shaping_feature_sync_review",
  required: false,
};

describe("PlanShapingFeatureSyncReviewField", () => {
  it("passes the guarded submit callback to the feedback editor", () => {
    const onSubmit = vi.fn();

    render(
      <PlanShapingFeatureSyncReviewField
        config={config}
        context={context}
        isSubmitted={false}
        onChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    expect(
      screen.getByPlaceholderText(/select revise/i)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("feature-sync-keyboard-submit"));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not expose keyboard submission when the field is disabled or submitted", () => {
    const onSubmit = vi.fn();

    const { rerender } = render(
      <PlanShapingFeatureSyncReviewField
        config={config}
        context={context}
        disabled
        isSubmitted={false}
        onChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByTestId("feature-sync-keyboard-submit")).toBeDisabled();

    rerender(
      <PlanShapingFeatureSyncReviewField
        config={config}
        context={context}
        isSubmitted
        onChange={vi.fn()}
        onSubmit={onSubmit}
        value={{
          action: "DISMISSED",
          payload: {},
        }}
      />
    );

    expect(
      screen.queryByTestId("feature-sync-keyboard-submit")
    ).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("switches edited feedback to the revision action payload", () => {
    const onChange = vi.fn();
    render(
      <PlanShapingFeatureSyncReviewField
        config={config}
        context={context}
        isSubmitted={false}
        onChange={onChange}
        value={{
          action: "DISMISSED",
          payload: {},
        }}
      />
    );

    fireEvent.change(screen.getByTestId("feature-sync-feedback"), {
      target: { value: "Revise the API wording" },
    });

    expect(onChange).toHaveBeenCalledWith({
      action: "REFINE",
      payload: { feedback: "Revise the API wording" },
    });
  });
});
