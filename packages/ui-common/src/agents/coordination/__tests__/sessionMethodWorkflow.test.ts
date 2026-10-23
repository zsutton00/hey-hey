import { describe, expect, it } from "vitest";
import { WorkflowName } from "../../../api";
import {
  isWorkflowOrchestratedLaunch,
  resolveCodingSessionWorkflowType,
  toWorkflowName,
} from "../sessionMethodWorkflow";

describe("resolveCodingSessionWorkflowType", () => {
  it("routes plan mode to the feature-sync workflow", () => {
    expect(resolveCodingSessionWorkflowType("plan")).toBe(
      WorkflowName.FeatureSync
    );
  });

  it("prefers an explicit override over the method-derived workflow", () => {
    // The override is the conversation's durable workflow identity; it wins so a
    // reload that drops the sessionMethod query params can still approve plans.
    expect(
      resolveCodingSessionWorkflowType("open", WorkflowName.FeatureSync)
    ).toBe(WorkflowName.FeatureSync);
  });

  it("falls back to the override when the method is undefined (params lost)", () => {
    expect(
      resolveCodingSessionWorkflowType(undefined, WorkflowName.FeatureSync)
    ).toBe(WorkflowName.FeatureSync);
  });

  it("returns undefined when neither a method nor an override is available", () => {
    expect(resolveCodingSessionWorkflowType(undefined, undefined)).toBe(
      undefined
    );
  });

  it("resolves from the method when no override is provided", () => {
    expect(resolveCodingSessionWorkflowType("plan", undefined)).toBe(
      WorkflowName.FeatureSync
    );
  });

  it("routes open mode to the agent-session workflow", () => {
    expect(resolveCodingSessionWorkflowType("open")).toBe(
      WorkflowName.AgentSession
    );
  });

  it("routes split_by_function mode to the agent-session workflow", () => {
    expect(resolveCodingSessionWorkflowType("split_by_function")).toBe(
      WorkflowName.AgentSession
    );
  });

  it("routes split_by_service mode to the agent-session workflow", () => {
    expect(resolveCodingSessionWorkflowType("split_by_service")).toBe(
      WorkflowName.AgentSession
    );
  });

  it("routes debug mode to the agent-session workflow", () => {
    expect(resolveCodingSessionWorkflowType("debug")).toBe(
      WorkflowName.AgentSession
    );
  });

  it("routes research mode to the agent-session workflow", () => {
    expect(resolveCodingSessionWorkflowType("research")).toBe(
      WorkflowName.AgentSession
    );
  });

  it("routes quick mode to the agent-session workflow", () => {
    expect(resolveCodingSessionWorkflowType("quick")).toBe(
      WorkflowName.AgentSession
    );
  });
});

describe("isWorkflowOrchestratedLaunch", () => {
  it("treats plan (FeatureSync) as workflow-orchestrated", () => {
    // plan is launched by the Temporal workflow itself, so the UI must skip
    // the start-run rail to avoid a double-launch.
    expect(isWorkflowOrchestratedLaunch("plan")).toBe(true);
  });

  it.each([
    "open",
    "split_by_function",
    "split_by_service",
    "debug",
    "research",
    "quick",
  ] as const)("treats %s (AgentSession) as start-run launched", (method) => {
    expect(isWorkflowOrchestratedLaunch(method)).toBe(false);
  });
});

describe("toWorkflowName", () => {
  it("narrows a recognized workflow-name string to the union", () => {
    expect(toWorkflowName("feature-sync")).toBe(WorkflowName.FeatureSync);
  });

  it("fails closed to undefined for an unknown value", () => {
    expect(toWorkflowName("not-a-workflow")).toBe(undefined);
  });

  it.each([null, undefined, ""])("returns undefined for %s", (value) => {
    expect(toWorkflowName(value)).toBe(undefined);
  });
});
