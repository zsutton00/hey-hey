import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EvalAttemptStatus,
  EvalMeasurementScope,
  EvalRunStatus,
  PayloadType,
  ReportAudience,
  ReportType,
  WebSocketSubscriptionRequestEventTypesEnum,
  type EvalAttemptUpdatedEvent,
  type EvalRunUpdatedEvent,
} from "../../../api";
import {
  buildRunEvalStartPayload,
  evalRunKeys,
  type EvalAttemptReport,
  type EvalRunReport,
} from "../evalRuns";
import { invalidateConversationMessages } from "../messages";
import {
  useEvalAttemptOutput,
  useEvalHumanReviews,
  useEvalRun,
  useEvalRuns,
  useLaunchEvalRun,
  useSaveEvalHumanReview,
} from "../../hooks/useEvalRuns";
import { WebSocketHandler } from "../../websockets/handler";
import { WebSocketDebugger } from "../../websockets/debug";

const api = vi.hoisted(() => ({
  getReport: vi.fn(),
  listReports: vi.fn(),
  createReport: vi.fn(),
  launchEvalRun: vi.fn(),
  getMessages: vi.fn(),
}));
vi.mock("../../../clients/serviceClients", async (original) => ({
  ...(await original<object>()),
  unifiedApiClient: api,
  evalRunsClient: api,
  platformClient: api,
}));

const wrap = <T,>(data: T) => ({ data: { data } });
const caseInput = {
  id: "case-input-1",
  evalCaseId: "eval-case-1",
  title: "Case",
  target: {},
  grading: {},
} as unknown as EvalRunReport["payload"]["cases"][number];
const configuration = {
  key: "setup-a",
} as unknown as EvalRunReport["payload"]["configurations"][number];

const runReport = (status: EvalRunReport["payload"]["status"]): EvalRunReport =>
  ({
    id: "run-1",
    organizationId: "org",
    projectId: "project",
    reportType: ReportType.EvalRun,
    audience: ReportAudience.ProjectVisible,
    title: "Run",
    version: 1,
    schemaVersion: 1,
    createdAt: "2026-10-20T00:00:00Z",
    expiresAt: null,
    entities: [],
    payload: {
      summary: "Run",
      reportType: ReportType.EvalRun,
      evalId: "eval-1",
      status,
      judgeSetup: { explanation: "judge" },
      cases: [caseInput],
      configurations: [configuration],
      settings: { maxConcurrentAttempts: 3 },
      coordinatorAgentSessionId: "session-1",
      coordinatorConversationId: "conversation-1",
    },
  }) as EvalRunReport;

const attemptReport = (
  status: EvalAttemptReport["payload"]["status"],
  measurements: EvalAttemptReport["payload"]["measurements"] = [],
): EvalAttemptReport =>
  ({
    ...runReport(EvalRunStatus.Running),
    id: "attempt-1",
    parentReportId: "run-1",
    reportType: ReportType.EvalAttempt,
    payload: {
      summary: "Attempt",
      reportType: ReportType.EvalAttempt,
      caseInputId: "case-input-1",
      configuration,
      status,
      measurements,
      targetSessionId: "target-session-1",
      targetConversationId: "target-conversation-1",
    },
  }) as EvalAttemptReport;

const clients: QueryClient[] = [];
const setup = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
};
beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  clients.forEach((client) => client.clear());
  clients.length = 0;
});

describe("eval run reads", () => {
  it("lists an Eval's runs through the report read anchored to the Eval", async () => {
    api.listReports.mockResolvedValue(wrap([runReport(EvalRunStatus.Queued)]));
    const { wrapper } = setup();
    const { result } = renderHook(
      () => useEvalRuns("org", "project", "eval-1"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.runs).toHaveLength(1));
    expect(api.listReports).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org",
        projectId: "project",
        reportType: ReportType.EvalRun,
        entityType: "TASK",
        entityId: "eval-1",
        relation: "PRIMARY",
      }),
      expect.anything(),
    );
  });

  it("reads a run with its attempts and keeps unreported measurements missing", async () => {
    api.getReport.mockResolvedValue(wrap(runReport(EvalRunStatus.Running)));
    api.listReports.mockResolvedValue(
      wrap([
        attemptReport(EvalAttemptStatus.Running, [
          { scope: EvalMeasurementScope.TargetHandler, elapsedMs: 1200 },
        ]),
      ]),
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useEvalRun("org", "run-1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.data?.id).toBe("run-1");
    expect(api.listReports).toHaveBeenCalledWith(
      expect.objectContaining({
        parentReportId: "run-1",
        reportType: ReportType.EvalAttempt,
      }),
      expect.anything(),
    );
    const [measurement] = result.current.attempts[0].payload.measurements;
    expect(measurement.elapsedMs).toBe(1200);
    expect(measurement).not.toHaveProperty("inputTokens");
  });

  it("fails rather than showing a partial run when attempts exceed one read", async () => {
    api.getReport.mockResolvedValue(wrap(runReport(EvalRunStatus.Running)));
    api.listReports.mockResolvedValue(
      wrap(Array.from({ length: 200 }, () => attemptReport("QUEUED"))),
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useEvalRun("org", "run-1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.attempts).toEqual([]);
  });

  it("rejects a report that is not an eval run", async () => {
    api.getReport.mockResolvedValue(
      wrap({ ...runReport("QUEUED"), payload: { reportType: "SNAPSHOT" } }),
    );
    api.listReports.mockResolvedValue(wrap([]));
    const { wrapper } = setup();
    const { result } = renderHook(() => useEvalRun("org", "run-1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
  });
});

describe("eval attempt output", () => {
  const retainedOriginalTargetContent = { description: "before" };
  const proposal = {
    id: "proposal-1",
    applicationEligible: false,
    retainedOriginalTargetContent,
  };
  const outputReport = { id: "report-1" };
  const messages = [
    {
      id: "message-1",
      conversationId: "target-conversation-1",
      proposals: [proposal],
    },
    {
      id: "message-2",
      conversationId: "target-conversation-1",
      reports: [outputReport],
    },
  ];

  it("reads the attempt's whole target conversation with its proposals and reports", async () => {
    api.getMessages.mockResolvedValue(wrap(messages));
    const { wrapper } = setup();
    const { result } = renderHook(
      () =>
        useEvalAttemptOutput("org", attemptReport(EvalAttemptStatus.Completed)),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(api.getMessages).toHaveBeenCalledWith(
      {
        organizationId: "org",
        projectId: "project",
        conversationId: "target-conversation-1",
        includeProposals: true,
        includeReports: true,
      },
      expect.anything(),
    );
    expect(result.current.hasRecordedConversation).toBe(true);
    expect(result.current.data?.messages.map(({ id }) => id)).toEqual([
      "message-1",
      "message-2",
    ]);
    expect(result.current.data?.proposals).toEqual([proposal]);
    expect(
      result.current.data?.proposals[0].retainedOriginalTargetContent,
    ).toEqual(retainedOriginalTargetContent);
    expect(result.current.data?.reports).toEqual([outputReport]);
  });

  it("refreshes when the target conversation's messages are invalidated", async () => {
    api.getMessages.mockResolvedValue(wrap(messages));
    const { client, wrapper } = setup();
    const { result } = renderHook(
      () =>
        useEvalAttemptOutput("org", attemptReport(EvalAttemptStatus.Running)),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));
    await act(() =>
      invalidateConversationMessages(
        client,
        "org",
        "project",
        "target-conversation-1",
      ),
    );
    expect(api.getMessages).toHaveBeenCalledTimes(2);
  });

  it("reads nothing for an attempt with no recorded conversation", () => {
    const attempt = attemptReport(EvalAttemptStatus.Completed);
    attempt.payload.targetConversationId = null;
    const { wrapper } = setup();
    const { result } = renderHook(() => useEvalAttemptOutput("org", attempt), {
      wrapper,
    });
    expect(result.current.hasRecordedConversation).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(api.getMessages).not.toHaveBeenCalled();
  });

  it("exposes research kept on the attempt even when its conversation holds nothing", async () => {
    api.getMessages.mockResolvedValue(wrap([]));
    const attempt = attemptReport(EvalAttemptStatus.Completed);
    attempt.payload.summary = {
      outputText: JSON.stringify({
        reportType: "CODING_RESEARCH",
        summary: "Kept on the attempt.",
        analysis: "Analysis.",
        frame: {},
        provenance: { discoveryCalls: [], edgesTraversed: [] },
        updates: [],
      }),
    };
    const { wrapper } = setup();
    const { result } = renderHook(() => useEvalAttemptOutput("org", attempt), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.data?.reports).toEqual([]);
    expect(result.current.data?.proposals).toEqual([]);
    expect(result.current.retainedResearch.status).toBe("readable");
  });

  it("reports no retained research when the attempt kept none", async () => {
    api.getMessages.mockResolvedValue(wrap(messages));
    const { wrapper } = setup();
    const { result } = renderHook(
      () =>
        useEvalAttemptOutput("org", attemptReport(EvalAttemptStatus.Completed)),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.retainedResearch).toEqual({ status: "none" });
  });
});

describe("eval run writes", () => {
  it("launches a run, caches it and refreshes the Eval's run list", async () => {
    const run = runReport(EvalRunStatus.Queued);
    api.launchEvalRun.mockResolvedValue(wrap(run));
    api.listReports.mockResolvedValue(wrap([]));
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useLaunchEvalRun(), { wrapper });
    await act(() =>
      result.current.mutate({
        organizationId: "org",
        projectId: "project",
        evalId: "eval-1",
        request: {
          evalCaseIds: ["eval-case-1"],
          configurations: [configuration],
          judgeSetup: { explanation: "judge" },
        },
      }),
    );
    expect(api.launchEvalRun).toHaveBeenCalledWith(
      expect.objectContaining({ evalId: "eval-1" }),
    );
    expect(client.getQueryData(evalRunKeys.run("org", "run-1"))).toEqual(run);
  });

  it("saves a review as a never-expiring child of the attempt anchored to the Eval", async () => {
    const review = {
      ...attemptReport("COMPLETED"),
      id: "review-1",
      payload: {
        summary: "Review",
        reportType: ReportType.EvalHumanReview,
        score: 4,
        challengeCase: false,
      },
    };
    api.createReport.mockResolvedValue(wrap(review));
    api.listReports.mockResolvedValue(wrap([review]));
    const { wrapper } = setup();
    const { result } = renderHook(
      () => ({
        save: useSaveEvalHumanReview(),
        reviews: useEvalHumanReviews("org", "attempt-1"),
      }),
      { wrapper },
    );
    await act(() =>
      result.current.save.mutate({
        organizationId: "org",
        projectId: "project",
        evalId: "eval-1",
        attemptId: "attempt-1",
        score: 4,
        challengeCase: false,
        summary: "Review",
      }),
    );
    expect(api.createReport).toHaveBeenCalledWith({
      organizationId: "org",
      createReportDto: expect.objectContaining({
        parentReportId: "attempt-1",
        neverExpires: true,
        reportType: ReportType.EvalHumanReview,
        entities: [
          { entityType: "TASK", entityId: "eval-1", relation: "PRIMARY" },
        ],
      }),
    });
    await waitFor(() => expect(result.current.reviews.data).toHaveLength(1));
  });
});

describe("run_eval start payload", () => {
  it("is built only from the recorded run and attempts", () => {
    const run = runReport(EvalRunStatus.Queued);
    expect(
      buildRunEvalStartPayload(run, [attemptReport("QUEUED")], "Run the eval"),
    ).toEqual({
      promptType: "run_eval",
      entity: { entityType: "TASK", entityId: "eval-1" },
      userMessage: "Run the eval",
      evalRunId: "run-1",
      judgeSetup: run.payload.judgeSetup,
      settings: run.payload.settings,
      attempts: [
        {
          attemptId: "attempt-1",
          targetSessionId: "target-session-1",
          targetConversationId: "target-conversation-1",
          caseInput,
          configuration,
        },
      ],
    });
  });

  it.each(["targetSessionId", "targetConversationId"] as const)(
    "refuses to start when %s is missing",
    (field) => {
      for (const value of [undefined, null, ""]) {
        const attempt = attemptReport("QUEUED");
        attempt.payload[field] = value;
        expect(() =>
          buildRunEvalStartPayload(
            runReport("QUEUED"),
            [attempt],
            "Run the eval",
          ),
        ).toThrow(
          /Attempt attempt-1 is missing its recorded target session or conversation/,
        );
      }
    },
  );

  it("refuses to start with attempts missing", () => {
    expect(() =>
      buildRunEvalStartPayload(runReport("QUEUED"), [], "Run the eval"),
    ).toThrow(/recorded 1 attempts but 0/);
  });
});

describe("eval progress events", () => {
  const debuggerInstance = () => {
    const instance = new WebSocketDebugger();
    vi.spyOn(instance, "logEvent").mockImplementation(() => {});
    vi.spyOn(instance, "logQueryInvalidation").mockImplementation(() => {});
    return instance;
  };
  const context = {
    payloadType: PayloadType.EvalRunUpdated,
    organizationId: "org",
    projectId: "project",
  };

  it("applies a run update to the open run and refreshes the run list", () => {
    const { client } = setup();
    const listKey = evalRunKeys.runs("org", "project", "eval-1");
    client.setQueryData(evalRunKeys.run("org", "run-1"), runReport("QUEUED"));
    client.setQueryData(listKey, [runReport("QUEUED")]);
    const handler = new WebSocketHandler(
      createStore(),
      debuggerInstance(),
      client,
    );
    const event: EvalRunUpdatedEvent = {
      id: "event-1",
      type: WebSocketSubscriptionRequestEventTypesEnum.EvalRunUpdated,
      aggregateId: "run-1",
      payload: {
        ...context,
        evalId: "eval-1",
        run: runReport(EvalRunStatus.Running),
      },
    };
    handler.handleEvent(event);
    expect(
      client.getQueryData<EvalRunReport>(evalRunKeys.run("org", "run-1"))
        ?.payload.status,
    ).toBe(EvalRunStatus.Running);
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
  });

  it("replaces the changed attempt in the open run without a reload", () => {
    const { client } = setup();
    const key = evalRunKeys.attempts("org", "run-1");
    client.setQueryData(key, [attemptReport("QUEUED")]);
    const handler = new WebSocketHandler(
      createStore(),
      debuggerInstance(),
      client,
    );
    const event: EvalAttemptUpdatedEvent = {
      id: "event-2",
      type: WebSocketSubscriptionRequestEventTypesEnum.EvalAttemptUpdated,
      aggregateId: "run-1",
      payload: {
        ...context,
        payloadType: PayloadType.EvalAttemptUpdated,
        evalId: "eval-1",
        evalRunId: "run-1",
        attempt: attemptReport(EvalAttemptStatus.Judging),
      },
    };
    handler.handleEvent(event);
    expect(
      client.getQueryData<EvalAttemptReport[]>(key)?.[0].payload.status,
    ).toBe(EvalAttemptStatus.Judging);
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    expect(api.listReports).not.toHaveBeenCalled();
  });

  it("re-reads the attempts when an unknown attempt arrives", () => {
    const { client } = setup();
    const key = evalRunKeys.attempts("org", "run-1");
    client.setQueryData(key, []);
    const handler = new WebSocketHandler(
      createStore(),
      debuggerInstance(),
      client,
    );
    handler.handleEvent({
      id: "event-3",
      type: WebSocketSubscriptionRequestEventTypesEnum.EvalAttemptUpdated,
      aggregateId: "run-1",
      payload: {
        ...context,
        payloadType: PayloadType.EvalAttemptUpdated,
        evalId: "eval-1",
        evalRunId: "run-1",
        attempt: attemptReport("RUNNING"),
      },
    });
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });
});
