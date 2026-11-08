import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvalAttemptReport, EvalRunReport } from "@hey-hey/ui-common/data";

const mockNavigate = vi.fn();
const mockUseEvalRun = vi.fn();
const mockUseEvalAttemptOutput = vi.fn();
const mockStart = vi.fn();
const mockStop = vi.fn();
const mockUseEvalHumanReviews = vi.fn();
const mockSaveReview = vi.fn();
const mockUpdateProposal = vi.fn();
const mockReport = vi.fn();
let mockSessionError: string | null = null;
let mockLocationState: unknown = null;
let mockSelectedAttempt: string | null = null;

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: mockLocationState }),
  useParams: () => ({ projectId: "p1", evalId: "eval-1", runId: "run-1" }),
}));

vi.mock("nuqs", async () => {
  const { useState } = await vi.importActual<typeof import("react")>("react");
  return {
    parseAsString: {},
    useQueryState: () => useState<string | null>(mockSelectedAttempt),
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
      `/projects/${p.projectId}/resolve-agent-session-by-id/${p.agentSessionId}`,
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
  useMachineResolution: () => ({
    machines: [],
    isReady: true,
    mode: "one",
    selectedMachine: { machineId: "machine-1" },
    setSelectedMachineId: vi.fn(),
  }),
  resolveAgentBridgeRecoveryState: () => ({ type: "loading" }),
  ModelSelectorMachineSelection: () => <div data-testid="machine-picker" />,
  FunctionalDialog: ({
    open,
    children,
    "data-testid": testId,
  }: {
    open: boolean;
    children: React.ReactNode;
    "data-testid"?: string;
  }) => (open ? <div data-testid={testId}>{children}</div> : null),
}));

vi.mock("@hey-hey/ui-common/data", async (importOriginal) => ({
  runRepeats: (await importOriginal<typeof import("@hey-hey/ui-common/data")>())
    .runRepeats,
  attemptRepeat: (
    await importOriginal<typeof import("@hey-hey/ui-common/data")>()
  ).attemptRepeat,
  evalRunName: (run: { payload: { name?: string } }) =>
    run.payload.name ?? "generated name",
  useRenameEvalRun: () => ({ mutate: vi.fn(), isPending: false }),
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
  useService: () => ({ data: { name: "hey-hey" } }),
  useEvalRunSession: () => ({
    start: mockStart,
    stop: mockStop,
    isStarting: false,
    isStopping: false,
    error: mockSessionError,
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

import { EvalRunPage } from "./EvalRunPage";

const setupA = {
  id: "setup-a",
  target: { provider: "claude", model: "opus", reasoningEffort: "medium" },
};
const setupB = {
  id: "setup-b",
  target: { provider: "claude", model: "opus", reasoningEffort: "high" },
};
const setupC = {
  id: "setup-c",
  target: { provider: "claude", model: "sonnet", reasoningEffort: "medium" },
};

const run = (
  status: string,
  settings: Record<string, number> = {
    maxConcurrentAttempts: 3,
    attemptTimeLimitSeconds: 900,
  },
): EvalRunReport =>
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
          evalCaseId: "eval-case-1",
          title: "Maintenance case",
          grading: {
            expectations: "Update the existing mockup.",
            checks: [{ id: "no-direct", description: "No direct changes" }],
            rubric: [],
          },
        },
        {
          id: "case-2",
          evalCaseId: "eval-case-2",
          title: "Mobile view",
          grading: { expectations: "Do nothing.", checks: [], rubric: [] },
        },
      ],
      configurations: [setupA, setupB, setupC],
      settings,
      coordinatorAgentSessionId: "coordinator",
      coordinatorConversationId: "coordinator-conversation",
    },
  }) as unknown as EvalRunReport;

const attempt = (
  id: string,
  caseInputId: string,
  configuration: typeof setupA,
  payload: Record<string, unknown>,
): EvalAttemptReport =>
  ({
    id,
    createdAt: "2026-10-22T10:00:00.000Z",
    payload: {
      reportType: "EVAL_ATTEMPT",
      caseInputId,
      configuration,
      measurements: [],
      targetSessionId: `session-${id}`,
      targetConversationId: `conversation-${id}`,
      ...payload,
    },
  }) as unknown as EvalAttemptReport;

const mixedAttempts = [
  attempt("finished", "case-1", setupA, {
    status: "COMPLETED",
    startedAt: "2026-10-22T10:12:00.000Z",
    completedAt: "2026-10-22T10:14:41.000Z",
  }),
  attempt("time-limited", "case-1", setupB, {
    status: "STOPPED",
    stopReason: "TIME_LIMIT",
    startedAt: "2026-10-22T10:12:00.000Z",
    completedAt: "2026-10-22T10:27:00.000Z",
  }),
  attempt("failed", "case-1", setupC, {
    status: "ERROR",
    error: { message: "provider unavailable" },
    startedAt: "2026-10-22T10:12:00.000Z",
    completedAt: "2026-10-22T10:13:00.000Z",
  }),
  attempt("unmeasured", "case-2", setupA, { status: "COMPLETED" }),
  attempt("running", "case-2", setupB, {
    status: "RUNNING",
    startedAt: "2026-10-22T10:20:00.000Z",
  }),
  attempt("waiting", "case-2", setupC, { status: "QUEUED" }),
];

const endedAttempts = [
  attempt("finished", "case-1", setupA, {
    status: "COMPLETED",
    judgedOutput: "SAVED-OUTPUT",
    attemptProviderSessionIds: ["provider-first"],
    judgeProviderSessionId: "judge-provider-session",
    automatedAssessment: {
      judgeSessionId: "judge-agent-session",
      checkResults: [{ checkId: "no-direct", passed: true }],
      recognition: { recognized: true, explanation: "Found the mockup." },
      quality: [],
      createdAt: "2026-10-22T10:20:00.000Z",
    },
    measurements: [
      {
        scope: "TARGET_HANDLER",
        elapsedMs: 400_000,
        inputTokens: 100_000,
        outputTokens: 12_000,
        toolCalls: 35,
      },
    ],
  }),
  attempt("unmeasured", "case-1", setupB, { status: "COMPLETED" }),
];

const givenRun = (
  report: EvalRunReport,
  attempts: EvalAttemptReport[],
): void => {
  mockUseEvalRun.mockReturnValue({
    data: report,
    attempts,
    error: null,
    isLoading: false,
    isFetched: true,
  });
};

const cell = (caseId: string, setupId: string): HTMLElement =>
  screen.getByTestId(`eval-attempt-cell-${caseId}-${setupId}`);

describe("EvalRunPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionError = null;
    mockLocationState = null;
    mockSelectedAttempt = null;
    mockUseEvalAttemptOutput.mockReturnValue({
      data: {
        messages: [],
        proposals: [
          {
            id: "proposal",
            action: "UPDATE",
            targetEntityType: "TASK",
            targetEntityId: "mockup-1",
            applicationEligible: false,
          },
        ],
        reports: [{ id: "report" }],
      },
      error: null,
      hasRecordedConversation: true,
    });
    mockUseEvalHumanReviews.mockReturnValue({ data: [] });
    mockSaveReview.mockResolvedValue({ id: "review-1" });
    mockStop.mockResolvedValue(true);
    mockStart.mockResolvedValue({ ok: true });
  });

  it("reads the run named in the address", () => {
    givenRun(run("RUNNING"), mixedAttempts);
    render(<EvalRunPage />);
    expect(mockUseEvalRun).toHaveBeenCalledWith("org", "run-1");
  });

  it("shows every case under every setup with its current state", () => {
    givenRun(run("RUNNING"), mixedAttempts);
    render(<EvalRunPage />);

    expect(cell("case-1", "setup-a")).toHaveAttribute("data-state", "finished");
    expect(cell("case-1", "setup-a")).toHaveTextContent('"elapsed":"2m 41s"');
    expect(cell("case-1", "setup-a")).toHaveTextContent(
      'eval.run.cell.proposals {"count":1}',
    );

    expect(cell("case-1", "setup-b")).toHaveAttribute("data-state", "stopped");
    expect(cell("case-1", "setup-b")).toHaveTextContent(
      'eval.run.cell.stopped.TIME_LIMIT {"limit":"15 min"}',
    );
    expect(cell("case-1", "setup-b")).toHaveTextContent(
      "eval.run.cell.partialOutput",
    );

    expect(cell("case-1", "setup-c")).toHaveAttribute("data-state", "error");
    expect(cell("case-1", "setup-c")).toHaveTextContent("provider unavailable");
    expect(
      screen.getByTestId("eval-attempt-open-session-failed"),
    ).toHaveAttribute(
      "href",
      "/projects/p1/resolve-agent-session-by-id/session-failed",
    );

    expect(cell("case-2", "setup-a")).toHaveTextContent(
      '"elapsed":"eval.run.cell.elapsedUnavailable"',
    );
    expect(cell("case-2", "setup-b")).toHaveAttribute("data-state", "running");
    expect(cell("case-2", "setup-c")).toHaveAttribute("data-state", "queued");
  });

  it("says how many attempts ended and repeats the applied settings", () => {
    givenRun(run("RUNNING"), mixedAttempts);
    render(<EvalRunPage />);
    expect(screen.getByTestId("eval-run-progress-summary")).toHaveTextContent(
      '"ended":4,"total":6',
    );
    const summary = screen.getByTestId("eval-run-settings-summary");
    expect(summary).toHaveTextContent("15 min");
    expect(summary).toHaveTextContent('"tokens":"eval.run.page.limitNone"');
    expect(summary).toHaveTextContent(
      '"projectAssistant":"eval.run.page.projectAssistantOn"',
    );
    expect(screen.getByTestId("eval-run-background-hint")).toBeInTheDocument();
  });

  it("is the progress itself: no log, comparison or results link while running", () => {
    givenRun(run("RUNNING"), mixedAttempts);
    render(<EvalRunPage />);
    expect(screen.getByTestId("eval-run-stop")).toBeInTheDocument();
    expect(screen.getByTestId("eval-run-rename")).toBeInTheDocument();
    expect(screen.getByTestId("eval-run-progress-summary")).toHaveTextContent(
      "eval.run.page.statusRunning",
    );
    expect(screen.queryByTestId("eval-run-progress")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("eval-results-comparison"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("eval-run-view-results"),
    ).not.toBeInTheDocument();
  });

  it("stops the run from the header", async () => {
    givenRun(run("RUNNING"), mixedAttempts);
    render(<EvalRunPage />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("eval-run-stop"));
    });
    expect(mockStop).toHaveBeenCalledWith(
      expect.objectContaining({ id: "run-1" }),
    );
  });

  it("shows an ended run's comparison above its case rows on the same page", () => {
    givenRun(run("STOPPED"), endedAttempts);
    render(<EvalRunPage />);

    expect(screen.queryByTestId("eval-run-stop")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("eval-run-background-hint"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("eval-run-rename")).toBeInTheDocument();
    expect(screen.queryByTestId("eval-attempt-grid")).not.toBeInTheDocument();
    expect(screen.queryByTestId("eval-results-overhead")).toBeNull();

    const comparison = screen.getByTestId("eval-results-comparison");
    const cases = screen.getByTestId("eval-case-toggle-finished");
    expect(
      comparison.compareDocumentPosition(cases) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByTestId("eval-results-setup-setup-a-recognition"),
    ).toHaveTextContent("1 / 1");
  });

  it("shows anything not reported as not reported, never 0", () => {
    givenRun(run("FINISHED"), endedAttempts);
    render(<EvalRunPage />);
    expect(
      screen.getByTestId("eval-results-setup-setup-b-tokens"),
    ).toHaveTextContent("eval.results.notReported");
    expect(
      screen.getByTestId("eval-results-setup-setup-b-tool-calls"),
    ).toHaveTextContent("eval.results.notReported");
  });

  it("expands a case row to its session ids, links and read-only evaluation output", () => {
    givenRun(run("FINISHED"), endedAttempts);
    render(<EvalRunPage />);
    fireEvent.click(screen.getByTestId("eval-case-toggle-finished"));

    const detail = screen.getByTestId("eval-attempt-detail-finished");
    expect(
      within(detail).getByTestId("eval-attempt-sessions"),
    ).toHaveTextContent("provider-first");
    expect(
      within(detail).getByTestId("eval-open-judge-session"),
    ).toHaveAttribute("href", expect.stringContaining("judge-agent-session"));
    expect(screen.getByTestId("update-proposal")).toHaveTextContent(
      "evaluation-output",
    );
    expect(mockReport).toHaveBeenCalledWith(
      expect.objectContaining({ evaluationOutput: true }),
    );
    expect(
      screen.getByTestId("eval-output-live-item-proposal"),
    ).toHaveAttribute("href", "/projects/p1/tasks/mockup-1");
    expect(screen.getByTestId("eval-rubric-recognition")).toHaveTextContent(
      "Found the mockup.",
    );
    expect(screen.getByTestId("eval-check-no-direct")).toHaveTextContent(
      "No direct changes",
    );
  });

  it("lists provider sessions as rows with resume commands, not-reported ids and the judge input modal", () => {
    const sessionsRun = {
      id: "run-2",
      organizationId: "org",
      projectId: "p1",
      title: "Run sessions",
      createdAt: "2026-10-22T10:00:00.000Z",
      payload: {
        reportType: "EVAL_RUN",
        evalId: "eval-1",
        status: "FINISHED",
        judgeSetup: { provider: "claude", model: "claude-opus-5-5" },
        cases: [
          {
            id: "case-1",
            evalCaseId: "eval-case-1",
            title: "Case",
            grading: { expectations: "Do the thing.", checks: [], rubric: [] },
          },
        ],
        configurations: [
          {
            id: "setup-rotated",
            target: { provider: "claude", model: "opus" },
          },
          {
            id: "setup-no-command",
            target: { provider: "opencode", model: "m" },
          },
          { id: "setup-bare", target: { provider: "codex", model: "m" } },
        ],
        settings: { maxConcurrentAttempts: 3 },
        coordinatorAgentSessionId: "coordinator",
        coordinatorConversationId: "coordinator-conversation",
      },
    } as unknown as EvalRunReport;
    const [setupRotated, setupNoCommand, setupBare] =
      sessionsRun.payload.configurations;

    const rotated = attempt("rotated", "case-1", setupRotated, {
      status: "COMPLETED",
      attemptProviderSessionIds: ["provider-a", "provider-b", "pending_c"],
      judgeProviderSessionId: "judge-session-1",
      judgedOutput: "WHAT THE JUDGE SAW",
      automatedAssessment: {
        judgeSessionId: "judge-agent-rotated",
        checkResults: [],
        recognition: { recognized: true, explanation: "ok" },
        quality: [],
        createdAt: "2026-10-22T10:20:00.000Z",
      },
    });
    const noCommand = attempt("no-command", "case-1", setupNoCommand, {
      status: "COMPLETED",
      attemptProviderSessionIds: ["provider-opencode"],
    });
    const bare = attempt("bare", "case-1", setupBare, {
      status: "COMPLETED",
    });

    givenRun(sessionsRun, [rotated, noCommand, bare]);
    render(<EvalRunPage />);

    fireEvent.click(screen.getByTestId("eval-case-toggle-rotated"));
    const rotatedDetail = screen.getByTestId("eval-attempt-detail-rotated");
    expect(rotatedDetail).toHaveTextContent("provider-a");
    expect(rotatedDetail).toHaveTextContent("provider-b");
    expect(rotatedDetail).not.toHaveTextContent("pending_c");
    expect(rotatedDetail).toHaveTextContent("claude --resume provider-a");
    expect(rotatedDetail).toHaveTextContent("claude --resume provider-b");
    expect(rotatedDetail).toHaveTextContent("claude --resume judge-session-1");

    fireEvent.click(within(rotatedDetail).getByTestId("eval-judge-view-input"));
    expect(screen.getByTestId("eval-judge-input-modal")).toHaveTextContent(
      "WHAT THE JUDGE SAW",
    );

    fireEvent.click(screen.getByTestId("eval-case-toggle-no-command"));
    const noCommandDetail = screen.getByTestId(
      "eval-attempt-detail-no-command",
    );
    expect(noCommandDetail).toHaveTextContent("provider-opencode");
    expect(noCommandDetail).not.toHaveTextContent("resume");

    fireEvent.click(screen.getByTestId("eval-case-toggle-bare"));
    const bareDetail = screen.getByTestId("eval-attempt-detail-bare");
    expect(
      within(bareDetail).getByTestId("eval-attempt-sessions"),
    ).toHaveTextContent("eval.results.notReported");
    expect(
      within(bareDetail).getByTestId("eval-attempt-judged-none"),
    ).toBeInTheDocument();
    expect(
      within(bareDetail).queryByTestId("eval-judge-view-input"),
    ).not.toBeInTheDocument();
  });

  it("saves a person's review beside the automated assessment", async () => {
    givenRun(run("FINISHED"), endedAttempts);
    render(<EvalRunPage />);
    fireEvent.click(screen.getByTestId("eval-case-toggle-finished"));

    fireEvent.click(screen.getByRole("radio", { name: /3 Stars/i }));
    fireEvent.click(screen.getByTestId("eval-human-review-save"));

    await waitFor(() =>
      expect(mockSaveReview).toHaveBeenCalledWith(
        expect.objectContaining({ attemptId: "finished", score: 3 }),
      ),
    );
    expect(screen.getByTestId("eval-rubric-recognition")).toBeInTheDocument();
  });

  it("brings the comparison in on the same page when the run ends", () => {
    givenRun(run("RUNNING"), endedAttempts);
    const { rerender } = render(<EvalRunPage />);
    expect(screen.getByTestId("eval-run-stop")).toBeInTheDocument();
    expect(
      screen.queryByTestId("eval-results-comparison"),
    ).not.toBeInTheDocument();

    givenRun(run("FINISHED"), endedAttempts);
    rerender(<EvalRunPage />);

    expect(screen.getByTestId("eval-results-comparison")).toBeInTheDocument();
    expect(screen.queryByTestId("eval-run-stop")).not.toBeInTheDocument();
    expect(screen.getByTestId("eval-run-rename")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("offers to start a recorded run that never started, with the earlier error", async () => {
    mockLocationState = { startError: "No CLI connected" };
    givenRun(run("QUEUED", { maxConcurrentAttempts: 3 }), [
      attempt("waiting", "case-1", setupA, { status: "QUEUED" }),
    ]);
    render(<EvalRunPage />);
    expect(screen.getByTestId("eval-run-not-started")).toBeInTheDocument();
    expect(screen.getByTestId("eval-run-start-error")).toHaveTextContent(
      "No CLI connected",
    );
    expect(screen.queryByTestId("eval-run-stop")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByTestId("eval-run-start-recorded"));
    });
    expect(mockStart).toHaveBeenCalledWith({
      organizationId: "org",
      projectId: "p1",
      runId: "run-1",
      machineId: "machine-1",
    });
  });

  describe("with repeats", () => {
    const repeated = (status: string) =>
      run(status, { maxConcurrentAttempts: 3, repeatsPerAttempt: 3 });
    const judgedRepeat = (id: string, repeat: number, recognized: boolean) =>
      attempt(id, "case-1", setupA, {
        repeat,
        status: "COMPLETED",
        automatedAssessment: {
          checkResults: [{ checkId: "no-direct", passed: recognized }],
          recognition: { recognized, explanation: "" },
          quality: [{ key: "q", name: "Q", score: recognized ? 4 : 2 }],
          createdAt: "2026-10-22T10:20:00.000Z",
        },
      });

    it("counts every repeat while running and shows a cell's progress through them", () => {
      givenRun(repeated("RUNNING"), [
        judgedRepeat("r1", 1, true),
        attempt("r2", "case-1", setupA, {
          repeat: 2,
          status: "RUNNING",
          startedAt: "2026-10-22T10:20:00.000Z",
        }),
        attempt("r3", "case-1", setupA, {
          repeat: 3,
          status: "ERROR",
          error: { message: "provider unavailable" },
        }),
      ]);
      render(<EvalRunPage />);

      expect(screen.getByTestId("eval-run-progress-summary")).toHaveTextContent(
        '"ended":2,"total":18',
      );
      expect(screen.getByTestId("eval-run-settings-summary")).toHaveTextContent(
        'eval.run.page.repeatsSummary {"count":3}',
      );
      expect(cell("case-1", "setup-a")).toHaveAttribute("data-state", "error");
      expect(cell("case-1", "setup-a")).toHaveTextContent(
        '"ended":2,"total":3',
      );
      expect(cell("case-1", "setup-a")).toHaveTextContent(
        '"correct":1,"assessed":1',
      );
      expect(cell("case-1", "setup-a")).toHaveTextContent(
        "provider unavailable",
      );
      expect(
        screen.getByTestId("eval-attempt-cell-case-1-setup-a-open-session-3"),
      ).toHaveAttribute("href", expect.stringContaining("session-r3"));
    });

    it("summarises each case's repeats and opens any repeat with its own review", () => {
      givenRun(repeated("FINISHED"), [
        judgedRepeat("r1", 1, true),
        judgedRepeat("r2", 2, false),
        attempt("r3", "case-1", setupA, {
          repeat: 3,
          status: "STOPPED",
          stopReason: "TIME_LIMIT",
        }),
      ]);
      render(<EvalRunPage />);

      const row = "eval-repeat-case-setup-a-case-1";
      expect(screen.getByTestId(`${row}-recognition`)).toHaveTextContent(
        '"recognized":1,"assessed":2',
      );
      expect(screen.getByTestId(`${row}-quality`)).toHaveTextContent(
        'eval.results.qualitySpread {"mean":"3.0","spread":"1.0"}',
      );
      expect(screen.getByTestId(`${row}-checks`)).toHaveTextContent("1 / 2");
      expect(screen.getByTestId(`${row}-excluded`)).toHaveTextContent(
        'eval.results.repeats.excludedStopped {"repeat":3',
      );
      expect(
        screen.getByTestId("eval-results-setup-setup-a-stopped"),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByTestId(`${row}-toggle`));
      expect(screen.getByTestId("eval-repeat-row-r2")).toHaveAttribute(
        "data-weak",
        "true",
      );
      expect(screen.getByTestId("eval-repeat-open-session-r1")).toHaveAttribute(
        "href",
        expect.stringContaining("session-r1"),
      );

      fireEvent.click(screen.getByTestId("eval-repeat-row-r2"));
      expect(screen.getByTestId("eval-attempt-detail-r2")).toBeInTheDocument();
      expect(screen.getByTestId("eval-human-review-form")).toHaveTextContent(
        'eval.results.review.titleRepeat {"repeat":2}',
      );
    });

    it("opens the repeat a deep link names, with its review headed by repeat", () => {
      mockSelectedAttempt = "r2";
      givenRun(repeated("FINISHED"), [
        judgedRepeat("r1", 1, true),
        judgedRepeat("r2", 2, false),
      ]);
      render(<EvalRunPage />);

      expect(screen.getByTestId("eval-attempt-detail-r2")).toBeInTheDocument();
      expect(screen.getByTestId("eval-human-review-form")).toHaveTextContent(
        'eval.results.review.titleRepeat {"repeat":2}',
      );
    });
  });

  it("shows when the run can't be read", () => {
    mockUseEvalRun.mockReturnValue({
      data: null,
      attempts: [],
      error: new Error(
        "Eval run run-1 has more attempts than one report read returns (200)",
      ),
      isLoading: false,
      isFetched: true,
    });
    render(<EvalRunPage />);
    expect(screen.getByTestId("eval-run-load-error")).toHaveTextContent("200");
  });
});
