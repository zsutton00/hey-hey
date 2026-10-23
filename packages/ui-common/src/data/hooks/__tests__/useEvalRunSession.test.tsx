import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EvalAttemptStatus,
  EvalRunStatus,
  ReportAudience,
  ReportType,
} from "../../../api";
import type {
  EvalAttemptReport,
  EvalRunReport,
} from "../../collections/evalRuns";

const api = vi.hoisted(() => ({
  getReport: vi.fn(),
  listReports: vi.fn(),
  updateAgentSession: vi.fn(),
  stopAgentSessionRun: vi.fn(),
}));
vi.mock("../../../clients/serviceClients", async (original) => ({
  ...(await original<object>()),
  unifiedApiClient: api,
  agentSessionsClient: api,
}));
vi.mock("../../../clients", async (original) => ({
  ...(await original<object>()),
  agentSessionsClient: api,
}));

const startSession = vi.hoisted(() => vi.fn());
const getAccess = vi.hoisted(() => vi.fn());
vi.mock(
  "../../../components/AgentSession/operations/useAgentSessionInteractionAccess",
  () => ({ useAgentSessionInteractionAccessResolver: () => ({ getAccess }) }),
);

import { useEvalRunSession } from "../useEvalRunSession";

const wrap = <T,>(data: T) => ({ data: { data } });
const configuration = {
  id: "setup-a",
  target: { provider: "claude", model: "claude-sonnet-5-5" },
};
const caseInput = {
  id: "case-input-1",
  evalCaseId: "eval-case-1",
  title: "Case",
  target: {},
  grading: {},
};

const runReport = (status: EvalRunReport["payload"]["status"]) =>
  ({
    id: "run-1",
    organizationId: "org",
    projectId: "project",
    reportType: ReportType.EvalRun,
    audience: ReportAudience.ProjectVisible,
    title: "Run",
    createdAt: "2026-10-22T00:00:00Z",
    entities: [],
    payload: {
      summary: "Run",
      reportType: ReportType.EvalRun,
      evalId: "eval-1",
      status,
      judgeSetup: {
        provider: "claude",
        model: "claude-opus-5-5",
        reasoningEffort: "high",
      },
      cases: [caseInput],
      configurations: [configuration],
      settings: { maxConcurrentAttempts: 2, attemptTimeLimitSeconds: 900 },
      coordinatorAgentSessionId: "coordinator-session",
      coordinatorConversationId: "coordinator-conversation",
    },
  }) as unknown as EvalRunReport;

const attemptReport = {
  id: "attempt-1",
  organizationId: "org",
  projectId: "project",
  parentReportId: "run-1",
  reportType: ReportType.EvalAttempt,
  createdAt: "2026-10-22T00:00:00Z",
  entities: [],
  payload: {
    summary: "Attempt",
    reportType: ReportType.EvalAttempt,
    caseInputId: "case-input-1",
    configuration,
    status: EvalAttemptStatus.Queued,
    measurements: [],
    targetSessionId: "target-session",
    targetConversationId: "target-conversation",
  },
} as unknown as EvalAttemptReport;

const setup = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useEvalRunSession(), { wrapper });
};

const startInput = {
  organizationId: "org",
  projectId: "project",
  runId: "run-1",
  machineId: "machine-1",
};

beforeEach(() => {
  vi.resetAllMocks();
  getAccess.mockReturnValue({
    isDeviceEnabled: true,
    interactions: { startSession },
    unavailable: null,
  });
  api.getReport.mockResolvedValue(wrap(runReport(EvalRunStatus.Queued)));
  api.listReports.mockResolvedValue(wrap([attemptReport]));
  api.updateAgentSession.mockResolvedValue(wrap({ id: "coordinator-session" }));
  startSession.mockResolvedValue({ state: "accepted" });
});

describe("useEvalRunSession", () => {
  it("starts the prepared session with a payload built only from the saved run", async () => {
    const { result } = setup();
    let started: unknown;
    await act(async () => {
      started = await result.current.start(startInput);
    });

    expect(started).toEqual({ ok: true });
    expect(api.updateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSessionId: "coordinator-session",
        updateAgentSessionDto: { machineId: "machine-1" },
      }),
    );
    expect(getAccess).toHaveBeenCalledWith("machine-1");
    const input = startSession.mock.calls[0][0];
    expect(input.agentSessionId).toBe("coordinator-session");
    expect(input.conversationId).toBe("coordinator-conversation");
    expect(input.intent).toMatchObject({
      handlerPromptType: "run_eval",
      provider: "claude",
      model: "claude-opus-5-5",
      reasoningEffort: "high",
    });
    expect(input.intent.payload).toEqual({
      promptType: "run_eval",
      entity: { entityType: "TASK", entityId: "eval-1" },
      userMessage: "Run eval",
      evalRunId: "run-1",
      judgeSetup: runReport(EvalRunStatus.Queued).payload.judgeSetup,
      settings: { maxConcurrentAttempts: 2, attemptTimeLimitSeconds: 900 },
      attempts: [
        {
          attemptId: "attempt-1",
          targetSessionId: "target-session",
          targetConversationId: "target-conversation",
          caseInput,
          configuration,
        },
      ],
    });
    expect(result.current.error).toBeNull();
  });

  it("surfaces a refused start so it can be retried with the same operation", async () => {
    startSession.mockResolvedValueOnce({
      state: "failed",
      message: "No CLI picked up the run",
    });
    const { result } = setup();
    let started: unknown;
    await act(async () => {
      started = await result.current.start(startInput);
    });
    expect(started).toEqual({ ok: false, error: "No CLI picked up the run" });
    expect(result.current.error).toBe("No CLI picked up the run");

    await act(async () => {
      started = await result.current.start(startInput);
    });
    expect(started).toEqual({ ok: true });
    expect(result.current.error).toBeNull();
    expect(startSession.mock.calls[1][0].operationId).toBe(
      startSession.mock.calls[0][0].operationId,
    );
  });

  it("refuses to start without an available machine", async () => {
    getAccess.mockReturnValue({
      isDeviceEnabled: false,
      interactions: null,
      unavailable: {
        type: "machine_not_selected",
        message: "Select an execution-ready machine to continue.",
      },
    });
    const { result } = setup();
    await act(async () => {
      await result.current.start({ ...startInput, machineId: null });
    });
    expect(startSession).not.toHaveBeenCalled();
    expect(result.current.error).toBe(
      "Select an execution-ready machine to continue.",
    );
  });

  it("does not start a run that already started", async () => {
    api.getReport.mockResolvedValue(wrap(runReport(EvalRunStatus.Running)));
    const { result } = setup();
    await act(async () => {
      await result.current.start(startInput);
    });
    expect(startSession).not.toHaveBeenCalled();
    expect(result.current.error).toBe("This run has already started.");
  });

  it("stops the run's coordinator session through the platform", async () => {
    api.stopAgentSessionRun.mockResolvedValue({});
    const { result } = setup();
    let stopped = false;
    await act(async () => {
      stopped = await result.current.stop(runReport(EvalRunStatus.Running));
    });
    expect(stopped).toBe(true);
    expect(api.stopAgentSessionRun).toHaveBeenCalledWith({
      organizationId: "org",
      projectId: "project",
      agentSessionId: "coordinator-session",
    });
  });

  it("shows a failed stop", async () => {
    api.stopAgentSessionRun.mockRejectedValue(new Error("Stop refused"));
    const { result } = setup();
    await act(async () => {
      await result.current.stop(runReport(EvalRunStatus.Running));
    });
    expect(result.current.error).toBe("Stop refused");
  });
});
