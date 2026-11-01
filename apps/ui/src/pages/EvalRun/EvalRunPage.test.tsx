import { act, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvalAttemptReport, EvalRunReport } from "@hey-hey/ui-common/data";

const mockNavigate = vi.fn();
const mockUseEvalRun = vi.fn();
const mockUseEvalAttemptOutput = vi.fn();
const mockStart = vi.fn();
const mockStop = vi.fn();
let mockSessionError: string | null = null;
let mockLocationState: unknown = null;

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: mockLocationState }),
  useParams: () => ({ projectId: "p1", evalId: "eval-1", runId: "run-1" }),
}));

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
    evalRunResults: (p: { projectId: string; evalId: string; runId: string }) =>
      `/projects/${p.projectId}/evals/${p.evalId}/runs/${p.runId}/results`,
  },
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  useMachineResolution: () => ({
    machines: [],
    isReady: true,
    mode: "one",
    selectedMachine: { machineId: "machine-1" },
    setSelectedMachineId: vi.fn(),
  }),
  resolveAgentBridgeRecoveryState: () => ({ type: "loading" }),
  ModelSelectorMachineSelection: () => <div data-testid="machine-picker" />,
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
        { id: "case-1", title: "Maintenance case" },
        { id: "case-2", title: "Mobile view" },
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
    mockUseEvalAttemptOutput.mockReturnValue({
      data: {
        messages: [],
        proposals: [{ id: "proposal" }],
        reports: [{ id: "report" }],
      },
      error: null,
      hasRecordedConversation: true,
    });
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

  it("logs each attempt start and end in the progress list", () => {
    givenRun(run("RUNNING"), mixedAttempts);
    render(<EvalRunPage />);
    expect(
      screen.getByTestId("eval-run-progress-started-finished"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("eval-run-progress-error-failed"),
    ).toHaveTextContent("provider unavailable");
    expect(
      screen.getByTestId("eval-run-progress-stopped-time-limited"),
    ).toHaveTextContent("eval.run.progress.stopped.TIME_LIMIT");
    expect(
      screen.queryByTestId("eval-run-progress-started-waiting"),
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

  it("shows a stopped run's unfinished attempts as stopped, without Stop run", () => {
    givenRun(run("STOPPED"), [
      attempt("finished", "case-1", setupA, { status: "COMPLETED" }),
      attempt("halted", "case-1", setupB, {
        status: "STOPPED",
        stopReason: "USER",
      }),
    ]);
    render(<EvalRunPage />);
    expect(cell("case-1", "setup-b")).toHaveAttribute("data-state", "stopped");
    expect(cell("case-1", "setup-b")).toHaveTextContent(
      "eval.run.cell.stopped.USER",
    );
    expect(screen.queryByTestId("eval-run-stop")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("eval-run-background-hint"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("eval-run-view-results"));
    expect(mockNavigate).toHaveBeenCalledWith(
      "/projects/p1/evals/eval-1/runs/run-1/results",
    );
  });

  it("offers results only once the run has ended", () => {
    givenRun(run("RUNNING"), mixedAttempts);
    render(<EvalRunPage />);
    expect(
      screen.queryByTestId("eval-run-view-results"),
    ).not.toBeInTheDocument();
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
