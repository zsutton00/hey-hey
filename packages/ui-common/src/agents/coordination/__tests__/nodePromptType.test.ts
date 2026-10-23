import { describe, expect, it } from "vitest";
import { WorkflowName } from "../../../api";
import { LocalPromptType } from "../../../api";
import { resolveNodePromptType } from "../nodePromptType";

describe("resolveNodePromptType", () => {
  it("maps feature-sync analyze node to FeatureSyncAnalyze", () => {
    expect(
      resolveNodePromptType(WorkflowName.FeatureSync, "feature-sync-analyze")
    ).toBe(LocalPromptType.FeatureSyncAnalyze);
  });

  it("maps feature-sync iterate node to FeatureSyncIterate", () => {
    expect(
      resolveNodePromptType(WorkflowName.FeatureSync, "feature-sync-iterate")
    ).toBe(LocalPromptType.FeatureSyncIterate);
  });

  it("returns null for unmapped feature-sync nodes", () => {
    // session-startup is deliberately unmapped — the UI's resolvedPromptType
    // fallback in usePromptSubmission resolves this to StartupSession, which
    // is how feature-sync hands off to the plan phase.
    expect(
      resolveNodePromptType(
        WorkflowName.FeatureSync,
        "feature-sync-session-startup"
      )
    ).toBeNull();
  });

  it("returns null when workflowName is null", () => {
    expect(resolveNodePromptType(null, "feature-sync-analyze")).toBeNull();
  });

  it("returns null when currentNodeId is null", () => {
    expect(resolveNodePromptType(WorkflowName.FeatureSync, null)).toBeNull();
  });

  it("returns null when both are null", () => {
    expect(resolveNodePromptType(null, null)).toBeNull();
  });

  it("returns null for unmapped workflows without a session method", () => {
    expect(
      resolveNodePromptType(WorkflowName.AgentSession, "agent-session-entry")
    ).toBeNull();
  });

  describe("sessionMethod fallback", () => {
    it("falls back to SetSplitting for split_by_service when the node is unmapped", () => {
      expect(resolveNodePromptType(null, null, "split_by_service")).toBe(
        LocalPromptType.SetSplitting
      );
    });

    it("falls back to SetSplitting for split_by_function when the node is unmapped", () => {
      expect(resolveNodePromptType(null, null, "split_by_function")).toBe(
        LocalPromptType.SetSplitting
      );
    });

    it("falls back to FreeForm for open when the node is unmapped", () => {
      expect(resolveNodePromptType(null, null, "open")).toBe(
        LocalPromptType.FreeForm
      );
    });

    it("returns null for plan method when the node is unmapped (caller defaults to StartupSession)", () => {
      expect(resolveNodePromptType(null, null, "plan")).toBeNull();
    });

    it("falls back to Debug for debug method when the node is unmapped", () => {
      expect(resolveNodePromptType(null, null, "debug")).toBe(
        LocalPromptType.Debug
      );
    });

    it("falls back to Research for research method when the node is unmapped", () => {
      expect(resolveNodePromptType(null, null, "research")).toBe(
        LocalPromptType.Research
      );
    });

    it("falls back to Quick for quick method when the node is unmapped", () => {
      expect(resolveNodePromptType(null, null, "quick")).toBe(
        LocalPromptType.Quick
      );
    });

    it("prefers the mapped node over the sessionMethod fallback", () => {
      expect(
        resolveNodePromptType(
          WorkflowName.FeatureSync,
          "feature-sync-analyze",
          "open"
        )
      ).toBe(LocalPromptType.FeatureSyncAnalyze);
    });

    it("uses the fallback when the workflow is non-Temporal-backed (null currentNodeId)", () => {
      expect(
        resolveNodePromptType(
          WorkflowName.AgentSession,
          null,
          "split_by_service"
        )
      ).toBe(LocalPromptType.SetSplitting);
    });
  });
});
