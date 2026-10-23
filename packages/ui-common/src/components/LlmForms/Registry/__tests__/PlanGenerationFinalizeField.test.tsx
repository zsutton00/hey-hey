import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanGenerationFinalizeField } from "../PlanGenerationFinalizeField";
import { FIELD_REGISTRY } from "../Registry";
import type { FieldComponentContext, FieldConfig } from "../types";
import type { PlanGenerationFinalizeValue } from "../types";

const aggregateMock = vi.hoisted(() => ({
  status: "loading" as "loading" | "ready" | "error",
}));

vi.mock("../../../../data/hooks/useCanonicalPlanAggregate", () => ({
  useCanonicalPlanAggregate: vi.fn(() => ({
    status: aggregateMock.status,
    aggregate: null,
    error: null,
  })),
}));

const PAYLOAD = {
  responseType: "plan_generation_finalize_v1" as const,
  planId: "plan-1",
  firstStageId: "stage-1",
  readyButtonLabel: "Ready",
  progressLabel: "Finalizing your plan...",
};
const baseConfig: FieldConfig = {
  field: "plan_generation_finalize_field",
  description: "Plan generation finalize",
  type: "plan_generation_finalize",
  payload: PAYLOAD,
};
const baseContext: FieldComponentContext = {
  conversationId: "conversation-1",
  projectId: "project-1",
  organizationId: "org-1",
};
const pendingValue: PlanGenerationFinalizeValue = {
  type: "PLAN_GENERATION_FINALIZE",
  status: "PENDING",
  planId: PAYLOAD.planId,
  firstStageId: PAYLOAD.firstStageId,
  readyButtonLabel: PAYLOAD.readyButtonLabel,
  progressLabel: PAYLOAD.progressLabel,
};

describe("PlanGenerationFinalizeField", () => {
  beforeEach(() => {
    aggregateMock.status = "loading";
  });

  it("renders the configured progress state", () => {
    render(
      <PlanGenerationFinalizeField
        config={baseConfig}
        context={baseContext}
        isSubmitted={false}
        value={pendingValue}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText(PAYLOAD.progressLabel)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("exposes actions only after finalization", () => {
    const entry = FIELD_REGISTRY.plan_generation_finalize;
    expect(entry.shouldShowButtons?.(pendingValue)).toBe(false);
    expect(
      entry.shouldShowButtons?.({ ...pendingValue, status: "READY" })
    ).toBe(true);
  });

  it("marks the value ready when the canonical Plan aggregate is complete", () => {
    aggregateMock.status = "ready";
    const onChange = vi.fn();
    render(
      <PlanGenerationFinalizeField
        config={baseConfig}
        context={baseContext}
        isSubmitted={false}
        value={pendingValue}
        onChange={onChange}
      />
    );
    expect(onChange).toHaveBeenCalledWith({ ...pendingValue, status: "READY" });
  });
});
