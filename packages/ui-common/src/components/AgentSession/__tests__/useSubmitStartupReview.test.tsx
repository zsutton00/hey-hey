import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ResponseActionRegistry, StartupPlanSubmission } from "../runtime";
import { useSubmitStartupReview } from "../useSubmitStartupReview";
import type { AgentSessionLaunchOrchestration } from "../CodingSession";

const buildSubmission = (
  overrides?: Partial<StartupPlanSubmission>
): StartupPlanSubmission => ({
  decision: "approve",
  feedback: null,
  review: {
    responseType: "startup_plan_review_v1",
    originalPlan: {} as never,
    questionAnswers: [],
    discrepancyDispositions: [],
  } as never,
  provider: "claude" as StartupPlanSubmission["provider"],
  model: "claude-sonnet-4-6",
  reasoningEffort: "medium",
  ...overrides,
});

const buildLaunch = (): AgentSessionLaunchOrchestration =>
  ({
    startRun: vi.fn(),
    submitStartupPlanReview: vi.fn().mockResolvedValue({ ok: true }),
    submitNodeDecision: vi.fn().mockResolvedValue({ ok: true }),
  } as unknown as AgentSessionLaunchOrchestration);

const buildRegistry = (): ResponseActionRegistry =>
  ({
    execute: vi.fn().mockResolvedValue({
      eventType: "startup_plan_replied",
      totalPlugins: 0,
      successful: [],
      failed: [],
    }),
  } as unknown as ResponseActionRegistry);

const renderSubmit = (
  overrides: Partial<{
    runId: string | null;
    launch: AgentSessionLaunchOrchestration;
    responseRegistry: ResponseActionRegistry;
  }> = {}
) => {
  const launch = overrides.launch ?? buildLaunch();
  const responseRegistry = overrides.responseRegistry ?? buildRegistry();
  const setStartupReviewError = vi.fn();
  const setSubmittingStartupReview = vi.fn();
  const { result } = renderHook(() =>
    useSubmitStartupReview({
      runId: overrides.runId !== undefined ? overrides.runId : "run-1",
      setStartupReviewError,
      setSubmittingStartupReview,
      launch,
      responseRegistry,
      organizationId: "org-1",
      serviceId: "svc-1",
      agentSessionId: "cs-1",
    })
  );
  return {
    submit: result.current,
    launch,
    responseRegistry,
    setStartupReviewError,
    setSubmittingStartupReview,
  };
};

describe("useSubmitStartupReview", () => {
  it("Approve branch forwards the rendered review markdown (including question answers and discrepancy dispositions) as the node-decision comment", async () => {
    const { submit, launch } = renderSubmit();
    const submission = buildSubmission({ decision: "approve", feedback: null });
    const requiredServiceIds = ["service-1", "service-2"];
    const userMessageData = { requiredServiceIds };
    const renderedReviewMarkdown =
      "### Plan approved\n\n#### Question answers\n1. _Q?_ — A.";

    await submit(submission, renderedReviewMarkdown, userMessageData);

    expect(launch.submitNodeDecision).toHaveBeenCalledTimes(1);
    expect(launch.submitNodeDecision).toHaveBeenCalledWith(
      "run-1",
      "APPROVED",
      userMessageData,
      renderedReviewMarkdown
    );
    expect(
      (launch.submitNodeDecision as ReturnType<typeof vi.fn>).mock.calls[0][2]
    ).toBe(userMessageData);
    expect(launch.submitStartupPlanReview).not.toHaveBeenCalled();
  });

  it("Improve branch still calls launch.submitStartupPlanReview with WorkflowDefined", async () => {
    const { submit, launch } = renderSubmit();
    const submission = buildSubmission({
      decision: "improve",
      feedback: "please rework",
    });
    const userMessageData = { requiredServiceIds: ["service-1", "service-2"] };

    await submit(submission, "improve prompt", userMessageData);

    expect(launch.submitStartupPlanReview).toHaveBeenCalledTimes(1);
    expect(launch.submitStartupPlanReview).toHaveBeenCalledWith(
      "run-1",
      submission,
      "improve prompt",
      userMessageData,
      "workflow-defined"
    );
    expect(
      (launch.submitStartupPlanReview as ReturnType<typeof vi.fn>).mock
        .calls[0][3]
    ).toBe(userMessageData);
    expect(launch.submitNodeDecision).not.toHaveBeenCalled();
  });

  it("runs the responseRegistry flow (carrying runId) after the node decision on Approve", async () => {
    const { submit, responseRegistry } = renderSubmit();
    const submission = buildSubmission({ decision: "approve", feedback: null });

    await submit(submission, "ignored", {});

    expect(responseRegistry.execute).toHaveBeenCalledTimes(1);
    expect(responseRegistry.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "startup_plan_v1.onReplied",
        runId: "run-1",
        agentSessionId: "cs-1",
      })
    );
  });

  it("runs the responseRegistry flow after the review on Improve", async () => {
    const { submit, responseRegistry } = renderSubmit();
    const submission = buildSubmission({
      decision: "improve",
      feedback: "x",
    });

    await submit(submission, "txt", {});

    expect(responseRegistry.execute).toHaveBeenCalledTimes(1);
    expect(responseRegistry.execute).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" })
    );
  });

  it("carries provider through to submitStartupPlanReview on Improve", async () => {
    const { submit, launch } = renderSubmit();
    const submission = buildSubmission({
      decision: "improve",
      feedback: "please revise",
      provider: "claude" as StartupPlanSubmission["provider"],
    });

    await submit(submission, "improve prompt", {});

    expect(launch.submitStartupPlanReview).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ provider: "claude" }),
      "improve prompt",
      {},
      "workflow-defined"
    );
  });
});
