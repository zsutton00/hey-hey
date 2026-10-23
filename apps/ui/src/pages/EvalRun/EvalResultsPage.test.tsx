import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvalAttemptReport, EvalRunReport } from "@hey-hey/ui-common/data";

const mockNavigate = vi.fn();
const mockUseEvalRun = vi.fn();
const mockUseEvalAttemptOutput = vi.fn();
const mockUseEvalHumanReviews = vi.fn();
const mockSaveReview = vi.fn();
const mockUpdateProposal = vi.fn();
const mockReport = vi.fn();

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ projectId: "p1", evalId: "eval-1", runId: "run-1" }),
}));

vi.mock("nuqs", async () => {
  const { useState } = await vi.importActual<typeof import("react")>("react");
  return {
    parseAsString: {},
    useQueryState: () => useState<string | null>(null),
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: "org" }),
}));

vi.mock("@hey-hey/ui-common/services", () => ({
  WebPathService: {
    agentSession: (p: { projectId: string; agentSessionId: string }) =>
      `/projects/${p.projectId}/sessions/${p.agentSessionId}`,
    evalRun: (p: { projectId: string; evalId: string; runId: string }) =>
      `/projects/${p.projectId}/evals/${p.evalId}/runs/${p.runId}`,
    proposal: (p: { projectId: string; proposalId: string }) =>
      `/projects/${p.projectId}/proposals/${p.proposalId}`,
    task: (p: { projectId: string; taskId: string }) =>
      `/projects/${p.projectId}/tasks/${p.taskId}`,
    designDoc: (p: { projectId: string; designDocId: string }) =>
      `/projects/${p.projectId}/design-docs/${p.designDocId}`,
  },
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  CreateProposal: () => <div data-testid="create-proposal" />,
  DeleteProposal: () => <div data-testid="delete-proposal" />,
  UpdateProposal: (props: { renderMode?: string }) => {
    mockUpdateProposal(props);
    return <div data-testid="update-proposal">{props.renderMode}</div>;
  },
  Report: (props: { evaluationOutput?: boolean }) => {
    mockReport(props);
    return <div data-testid="report" />;
  },
  isPlaceholderEntityId: (id: string) =>
    !id || id === "00000000-0000-0000-0000-000000000000",
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useWorkItem: () => ({
    workItem: { id: "eval-1", name: "Refiner eval", type: "EVAL" },
    isLoading: false,
    error: null,
  }),
  useEvalRun: (...args: unknown[]) => mockUseEvalRun(...args),
  useEvalAttemptOutput: (...args: unknown[]) =>
    mockUseEvalAttemptOutput(...args),
  useEvalHumanReviews: (...args: unknown[]) => mockUseEvalHumanReviews(...args),
  useSaveEvalHumanReview: () => ({
    mutate: mockSaveReview,
    isPending: false,
    error: null,
  }),
}));

vi.mock("../../components/Layout", () => ({
  DetailPageContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("../../components/TaskBreadcrumbs", () => ({
  TaskBreadcrumbs: () => null,
}));
vi.mock("../../components/useFeatureAncestors", () => ({
  useFeatureAncestors: () => ({ ancestors: [] }),
}));

import { EvalResultsPage } from "./EvalResultsPage";

const opusHigh = {
  id: "opus-high",
  target: { provider: "claude", model: "opus", reasoningEffort: "high" },
};
const sonnet = {
  id: "sonnet",
  target: { provider: "claude", model: "sonnet", reasoningEffort: "medium" },
};

const run = (status = "FINISHED"): EvalRunReport =>
  ({
    id: "run-1",
    organizationId: "org",
    projectId: "p1",
    title: "Run 4",
    createdAt: "2026-10-22T10:00:00.000Z",
    payload: {
      reportType: "EVAL_RUN",
      evalId: "eval-1",
      status,
      judgeSetup: { provider: "claude", model: "claude-opus-5-5" },
      cases: [
        {
          id: "case-1",
          title: "Feature change that should update its mockup",
          grading: {
            checks: [
              {
                id: "targets-mockup",
                description: "Update targets the mockup",
              },
              { id: "no-direct", description: "No direct project changes" },
            ],
            rubric: [],
          },
        },
      ],
      configurations: [opusHigh, sonnet],
      settings: { maxConcurrentAttempts: 3 },
      coordinatorMeasurement: {
        scope: "COORDINATOR",
        elapsedMs: 30_000,
        inputTokens: 4_000,
        outputTokens: 1_000,
        toolCalls: 3,
      },
      coordinatorAgentSessionId: "coordinator",
      coordinatorConversationId: "coordinator-conversation",
    },
  }) as unknown as EvalRunReport;

const assessed = {
  checkResults: [
    { checkId: "targets-mockup", passed: true },
    { checkId: "no-direct", passed: false, explanation: "Edited the feature" },
  ],
  recognition: {
    recognized: true,
    explanation: "Found the mockup from the feature's children.",
  },
  quality: [
    {
      key: "grounding",
      name: "Grounding",
      score: 4,
      explanation: "Used the stage layout.",
    },
    {
      key: "usefulness",
      name: "Usefulness",
      score: 3,
      explanation: "No source for estimates.",
    },
  ],
  createdAt: "2026-10-22T10:20:00.000Z",
};

const attempt = (
  id: string,
  configuration: typeof opusHigh,
  payload: Record<string, unknown>,
): EvalAttemptReport =>
  ({
    id,
    projectId: "p1",
    createdAt: "2026-10-22T10:00:00.000Z",
    payload: {
      reportType: "EVAL_ATTEMPT",
      caseInputId: "case-1",
      configuration,
      status: "COMPLETED",
      measurements: [],
      targetSessionId: `session-${id}`,
      targetConversationId: `conversation-${id}`,
      ...payload,
    },
  }) as unknown as EvalAttemptReport;

const attempts = [
  attempt("opus-attempt", opusHigh, {
    automatedAssessment: assessed,
    measurements: [
      {
        scope: "TARGET_PREPARATION",
        elapsedMs: 60_000,
        inputTokens: 30_000,
        outputTokens: 8_000,
        toolCalls: 6,
      },
      {
        scope: "TARGET_HANDLER",
        elapsedMs: 400_000,
        inputTokens: 100_000,
        outputTokens: 12_000,
        toolCalls: 35,
      },
      {
        scope: "JUDGE",
        elapsedMs: 42_000,
        inputTokens: 15_000,
        outputTokens: 2_000,
        toolCalls: 6,
      },
    ],
  }),
  // The provider reported preparation but nothing for the handler.
  attempt("sonnet-attempt", sonnet, {
    measurements: [
      {
        scope: "TARGET_PREPARATION",
        elapsedMs: 20_000,
        inputTokens: 31_000,
      },
    ],
  }),
];

const givenRun = (report: EvalRunReport): void => {
  mockUseEvalRun.mockReturnValue({
    data: report,
    attempts,
    error: null,
    isLoading: false,
    isFetched: true,
  });
};

const proposal = {
  id: "proposal-1",
  action: "UPDATE",
  targetEntityType: "TASK",
  targetEntityId: "mockup-1",
  applicationEligible: false,
};

describe("EvalResultsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    givenRun(run());
    mockUseEvalAttemptOutput.mockReturnValue({
      data: {
        messages: [],
        proposals: [proposal],
        reports: [{ id: "report-1" }],
      },
      error: null,
      hasRecordedConversation: true,
    });
    mockUseEvalHumanReviews.mockReturnValue({ data: [] });
    mockSaveReview.mockResolvedValue({ id: "review-1" });
  });

  it("compares setups with preparation and handler work kept apart", () => {
    render(<EvalResultsPage />);
    expect(
      screen.getByTestId("eval-results-setup-opus-high-recognition"),
    ).toHaveTextContent("1 / 1");
    expect(
      screen.getByTestId("eval-results-setup-opus-high-quality"),
    ).toHaveTextContent("3.5");
    expect(
      screen.getByTestId("eval-results-setup-opus-high-checks"),
    ).toHaveTextContent("1 / 2");
    expect(
      screen.getByTestId("eval-results-setup-opus-high-elapsed"),
    ).toHaveTextContent("1m 00s / 6m 40s");
    expect(
      screen.getByTestId("eval-results-setup-opus-high-tokens"),
    ).toHaveTextContent("38k / 112k");
    expect(
      screen.getByTestId("eval-results-setup-opus-high-tool-calls"),
    ).toHaveTextContent("6 / 35");
  });

  it("shows anything not measured as not reported, never 0", () => {
    render(<EvalResultsPage />);
    const tokens = screen.getByTestId("eval-results-setup-sonnet-tokens");
    expect(tokens).toHaveTextContent("31k / eval.results.notReported");
    expect(
      screen.getByTestId("eval-results-setup-sonnet-tool-calls"),
    ).toHaveTextContent("eval.results.notReported / eval.results.notReported");
    expect(
      screen.getByTestId("eval-results-setup-sonnet-quality"),
    ).toHaveTextContent("eval.results.notReported");
    expect(
      screen.getByTestId("eval-results-setup-sonnet-checks"),
    ).not.toHaveTextContent(/\b0\b/);
  });

  it("puts judge and coordinator overhead on its own line, outside the setups", () => {
    render(<EvalResultsPage />);
    const overhead = screen.getByTestId("eval-results-overhead");
    expect(overhead).toHaveTextContent("eval.results.overhead");
    // Judge: 42s and 17k tokens; coordinator: 30s and 5k tokens.
    expect(overhead.textContent).toMatch(/42s.*17k.*30s.*5k/);
    expect(
      screen.getByTestId("eval-results-observation-note"),
    ).toBeInTheDocument();
  });

  it("waits for the run to end before comparing", () => {
    givenRun(run("RUNNING"));
    render(<EvalResultsPage />);
    expect(screen.getByTestId("eval-results-not-finished")).toBeInTheDocument();
    expect(
      screen.queryByTestId("eval-results-comparison"),
    ).not.toBeInTheDocument();
  });

  it("opens an attempt's saved output read-only with session and live-item links", () => {
    render(<EvalResultsPage />);
    fireEvent.click(
      screen.getByTestId("eval-results-open-attempt-opus-attempt"),
    );

    expect(mockUseEvalAttemptOutput).toHaveBeenCalledWith(
      "org",
      expect.objectContaining({ id: "opus-attempt" }),
    );
    expect(screen.getByTestId("update-proposal")).toHaveTextContent(
      "evaluation-output",
    );
    expect(mockReport).toHaveBeenCalledWith(
      expect.objectContaining({ evaluationOutput: true }),
    );
    expect(
      screen.getByTestId("eval-output-open-proposal-proposal-1"),
    ).toHaveAttribute("href", "/projects/p1/proposals/proposal-1");
    expect(
      screen.getByTestId("eval-output-live-item-proposal-1"),
    ).toHaveAttribute("href", "/projects/p1/tasks/mockup-1");
    expect(screen.getByTestId("eval-attempt-open-session")).toHaveAttribute(
      "href",
      "/projects/p1/sessions/session-opus-attempt",
    );
  });

  it("scores recognition apart from quality, each with its explanation", () => {
    render(<EvalResultsPage />);
    fireEvent.click(
      screen.getByTestId("eval-results-open-attempt-opus-attempt"),
    );

    expect(screen.getByTestId("eval-rubric-recognition")).toHaveTextContent(
      "Found the mockup from the feature's children.",
    );
    expect(screen.getByTestId("eval-rubric-grounding")).toHaveTextContent(
      "Used the stage layout.",
    );
    expect(screen.getByTestId("eval-check-no-direct")).toHaveTextContent(
      "No direct project changes",
    );
    expect(screen.getByTestId("eval-check-no-direct")).toHaveTextContent(
      "Edited the feature",
    );
  });

  it("saves a person's review as its own record beside the automated one", async () => {
    render(<EvalResultsPage />);
    fireEvent.click(
      screen.getByTestId("eval-results-open-attempt-opus-attempt"),
    );

    expect(screen.getByTestId("eval-human-review-save")).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /3 Stars/i }));
    fireEvent.change(screen.getByTestId("eval-human-review-comment"), {
      target: { value: "  Effort numbers are invented  " },
    });
    fireEvent.click(screen.getByTestId("eval-human-review-challenge"));
    fireEvent.click(screen.getByTestId("eval-human-review-save"));

    await waitFor(() =>
      expect(mockSaveReview).toHaveBeenCalledWith({
        organizationId: "org",
        projectId: "p1",
        evalId: "eval-1",
        attemptId: "opus-attempt",
        score: 3,
        comment: "Effort numbers are invented",
        challengeCase: true,
        summary: 'eval.results.review.summary {"score":3}',
      }),
    );
    // The automated assessment is still shown, untouched.
    expect(screen.getByTestId("eval-rubric-recognition")).toBeInTheDocument();
  });

  it("starts a fresh review draft when another attempt is opened", () => {
    render(<EvalResultsPage />);
    fireEvent.click(
      screen.getByTestId("eval-results-open-attempt-opus-attempt"),
    );
    fireEvent.change(screen.getByTestId("eval-human-review-comment"), {
      target: { value: "About the opus attempt" },
    });
    fireEvent.click(
      screen.getByTestId("eval-results-open-attempt-sonnet-attempt"),
    );

    expect(screen.getByTestId("eval-human-review-comment")).toHaveValue("");
  });

  it("lists earlier reviews with their challenge flag", () => {
    mockUseEvalHumanReviews.mockReturnValue({
      data: [
        {
          id: "review-1",
          createdAt: "2026-10-22T11:00:00.000Z",
          payload: { score: 2, comment: "Weak", challengeCase: true },
        },
      ],
    });
    render(<EvalResultsPage />);
    fireEvent.click(
      screen.getByTestId("eval-results-open-attempt-opus-attempt"),
    );

    const review = screen.getByTestId("eval-human-review-review-1");
    expect(review).toHaveTextContent("Weak");
    expect(review).toHaveTextContent("eval.results.review.challenged");
  });
});
