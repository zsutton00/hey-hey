import { describe, expect, it } from "vitest";
import { ExtendedUIFieldType, ReportType, type UIElement } from "../../../api";
import {
  getReportConfig,
  getReportPresentation,
  resolveInteractiveReportResponseUiElement,
} from "../reportConfig";

describe("reportConfig", () => {
  it("makes PLAN reports interactive independently of their host field", () => {
    expect(getReportConfig(ReportType.Plan)).toMatchObject({
      presentation: "interactive",
      responseUiElement: {
        id: "coding_prompt_startup_plan",
        type: "coding_prompt_startup_plan",
      },
      hostPolicy: {
        requiredMessageType: "SYSTEM",
        requiredDataType: "AGENT",
        requiredPromptHandler: "startup_session",
        matchProviderSessionToReportAgent: true,
        excludeCarrier: true,
        excludeInterstitial: true,
      },
    });
  });

  it("classifies Feature Sync decision reports as interactive attachments", () => {
    expect(getReportConfig(ReportType.FeatureSyncDecision)).toMatchObject({
      presentation: "interactive",
      responseUiElement: {
        id: "feature-sync-decision-response",
      },
      hostPolicy: {
        requiredMessageType: "SYSTEM",
        requiredDataType: "AGENT",
        matchProviderSessionToReportAgent: true,
        excludeCarrier: true,
        excludeInterstitial: true,
      },
    });
    expect(getReportPresentation(ReportType.FeatureSyncDecision)).toBe(
      "interactive"
    );
  });

  it("defaults unconfigured report types to inline presentation", () => {
    expect(getReportConfig(ReportType.Snapshot)).toEqual({
      presentation: "inline",
    });
  });

  it("retains an authored startup-plan response identity when available", () => {
    const config = getReportConfig(ReportType.Plan);
    expect(config.presentation).toBe("interactive");
    if (config.presentation !== "interactive") return;

    const sourceUiElement: UIElement = {
      id: "authored-startup-plan-field",
      type: ExtendedUIFieldType.CodingPromptStartupPlan,
      label: "Authored startup plan",
    };

    expect(
      resolveInteractiveReportResponseUiElement(config, [sourceUiElement])
    ).toBe(sourceUiElement);
  });

  it("uses the report-owned response identity for carrier-hosted reports", () => {
    const config = getReportConfig(ReportType.Plan);
    expect(config.presentation).toBe("interactive");
    if (config.presentation !== "interactive") return;

    const interstitial: UIElement = {
      id: "interstitial",
      type: ExtendedUIFieldType.Interstitial,
      label: "",
    };

    expect(
      resolveInteractiveReportResponseUiElement(config, [interstitial])
    ).toEqual(config.responseUiElement);
  });
});
