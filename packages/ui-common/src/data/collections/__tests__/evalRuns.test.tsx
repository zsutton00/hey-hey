import {
  FakeConversationServer,
  threadOf,
} from "../../../test/conversationGraphQL";
import { useConversationMessages } from "../../hooks/useConversationMessages";
import { createUnreachableGraphQLClient } from "../../../test/graphqlTestClient";
import { useEvalSessionStatuses } from "../../hooks/useEvalSessionStatuses";
import { applyEvalRunUpdated, applyEvalAttemptUpdated } from "../evalRuns";
import { evalRunStatusLabel } from "../../evalRunStatusLabel";
import i18next from "i18next";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
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
  type EvalSessionStatus,
  type EvalAttemptUpdatedEvent,
  type EvalRunUpdatedEvent,
} from "../../../api";
import {
  buildRunEvalStartPayload,
  evalRunKeys,
  evalSessionStatusesQueryOptions,
  type EvalAttemptReport,
  type EvalRunReport,
} from "../evalRuns";
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
  getEvalSessionStatuses: vi.fn(),
  getReport: vi.fn(),
  listReports: vi.fn(),
  createReport: vi.fn(),
  launchEvalRun: vi.fn(),
}));
vi.mock("../../../clients/serviceClients", async (original) => ({
  ...(await original<object>()),
  unifiedApiClient: api,
  evalRunsClient: api,
  projectsClient: {
    getQueuedConversationInputs: async () => ({ data: { data: [] } }),
  },
}));

const wrap = <T,>(data: T) => ({ data: { data } });
const caseInput = {
  id: "case-input-1",
  evalCaseId: "eval-case-1",
  title: "Case",
  target: {},
  grading: {},
} as unknown as EvalRunReport["payload"]["cases"][number];
const execution = {
  handler: "entity_conversation",
  projectAssistantPrepares: true,
  assessedOutput: "HANDLER_REPLY",
} as const;

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
      execution,
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
  vi.useRealTimers();
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
  const setupOutput = () => {
    const thread = threadOf(10);
    thread[3].proposals = [proposal];
    thread[3].reports = [outputReport];
    const server = new FakeConversationServer(thread);
    const attempt = attemptReport(EvalAttemptStatus.Completed);
    attempt.payload.targetConversationId = server.conversationId;
    attempt.projectId = "project-1";
    return { server, attempt, thread };
  };

  it("reads the whole output after a recent page and shares live edits and deletions with the thread", async () => {
    const { server, attempt, thread } = setupOutput();
    const conversation = renderHook(
      () =>
        useConversationMessages("org-1", "project-1", server.conversationId),
      { wrapper: server.wrapper },
    );
    await waitFor(() =>
      expect(conversation.result.current.orderedData).toHaveLength(8),
    );

    const output = renderHook(() => useEvalAttemptOutput("org-1", attempt), {
      wrapper: server.wrapper,
    });
    await waitFor(() =>
      expect(output.result.current.data?.messages.map(({ id }) => id)).toEqual(
        thread.map(({ id }) => id),
      ),
    );
    expect(server.received("GetConversationMessages")).toEqual([
      { id: "conv-1" },
    ]);
    expect(conversation.result.current.orderedData).toHaveLength(8);
    expect(conversation.result.current.hasOlder).toBe(true);
    expect(output.result.current.data?.proposals).toEqual([proposal]);
    expect(output.result.current.data?.reports).toEqual([outputReport]);

    const handler = new WebSocketHandler(
      createStore(),
      undefined,
      server.queryClient,
      server.graphql.apollo,
    );
    const event = {
      timestamp: "2026-11-01T00:00:00.000Z",
      organizationId: "org-1",
      projectId: "project-1",
      conversationId: server.conversationId,
      messageId: "m4",
    };
    server.rename("m4", { response: "edited output" });
    act(() => handler.handleEvent({ type: "message.updated", ...event }));

    await waitFor(() => {
      expect(output.result.current.data?.messages[3]?.data).toEqual({
        response: "edited output",
      });
      expect(
        conversation.result.current.orderedData.find(({ id }) => id === "m4")
          ?.data,
      ).toEqual({
        response: "edited output",
      });
    });

    expect(conversation.result.current.orderedData).toHaveLength(8);

    server.remove("m4");
    act(() => handler.handleEvent({ type: "message.deleted", ...event }));
    await waitFor(() => {
      expect(
        output.result.current.data?.messages.map(({ id }) => id),
      ).not.toContain("m4");
      expect(
        conversation.result.current.orderedData.map(({ id }) => id),
      ).not.toContain("m4");
      expect(output.result.current.data?.proposals).toEqual([]);
      expect(output.result.current.data?.reports).toEqual([]);
    });
    await act(async () => conversation.result.current.loadOlder());
    await waitFor(() => {
      expect(
        conversation.result.current.orderedData.map(({ id }) => id),
      ).toEqual(thread.filter(({ id }) => id !== "m4").map(({ id }) => id));
      expect(conversation.result.current.hasOlder).toBe(false);
    });
  });

  it("reads nothing for an attempt with no recorded conversation", () => {
    const attempt = attemptReport(EvalAttemptStatus.Completed);
    attempt.payload.targetConversationId = null;
    const server = new FakeConversationServer([]);
    const { result } = renderHook(() => useEvalAttemptOutput("org", attempt), {
      wrapper: server.wrapper,
    });
    expect(result.current.hasRecordedConversation).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(server.requests).toEqual([]);
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
      cases: run.payload.cases,
      attempts: [
        {
          attemptId: "attempt-1",
          execution,
          targetSessionId: "target-session-1",
          targetConversationId: "target-conversation-1",
          caseInput,
          configuration,
        },
      ],
    });
  });

  it("refuses to start an attempt that did not record what it executes", () => {
    const attempt = attemptReport("QUEUED");
    attempt.payload.execution = undefined;
    expect(() =>
      buildRunEvalStartPayload(runReport("QUEUED"), [attempt], "Run the eval"),
    ).toThrow(/did not record what it executes/);
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

  it("expects every repeat and orders attempts by repeat, then case, then setup", () => {
    const cases = ["case-a", "case-b"].map((id) => ({ ...caseInput, id }));
    const setups = ["setup-a", "setup-b"].map((id) => ({
      ...configuration,
      id,
    }));
    const run = runReport(EvalRunStatus.Queued);
    run.payload = {
      ...run.payload,
      cases,
      configurations: setups,
      settings: { maxConcurrentAttempts: 3, repeatsPerAttempt: 2 },
    };
    const attempts = [1, 2].flatMap((repeat) =>
      cases.flatMap((c) =>
        setups.map((setup) => {
          const attempt = attemptReport("QUEUED");
          attempt.id = `${c.id}/${setup.id}/${repeat}`;
          attempt.payload = {
            ...attempt.payload,
            caseInputId: c.id,
            configuration: setup,
            repeat,
          };
          return attempt;
        }),
      ),
    );

    const payload = buildRunEvalStartPayload(
      run,
      [...attempts].reverse(),
      "Run the eval",
    );
    expect(
      payload.attempts.map((attempt) => [attempt.attemptId, attempt.repeat]),
    ).toEqual(attempts.map((attempt) => [attempt.id, attempt.payload.repeat]));
    expect(() =>
      buildRunEvalStartPayload(run, attempts.slice(0, 4), "Run the eval"),
    ).toThrow(/recorded 8 attempts but 4/);
  });

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
      createUnreachableGraphQLClient(),
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
      createUnreachableGraphQLClient(),
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
      createUnreachableGraphQLClient(),
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

describe("Open Items eval status without an open Eval page", () => {
  it.each([
    { cached: false, terminal: EvalRunStatus.Finished },
    { cached: true, terminal: EvalRunStatus.Finished },
    { cached: true, terminal: EvalRunStatus.Stopped },
  ])(
    "delivers final $terminal during an older status read (cached=$cached)",
    async ({ cached, terminal }) => {
      const running: EvalSessionStatus = {
        agentSessionId: "session-1",
        runId: "run-1",
        evalId: "eval-1",
        status: EvalRunStatus.Running,
        total: 30,
        ended: 12,
        errors: 0,
      };
      type Response = ReturnType<typeof wrap<EvalSessionStatus[]>>;
      let finishOlder!: (response: Response) => void;
      const olderRead = new Promise<Response>((resolve) => {
        finishOlder = resolve;
      });
      api.getEvalSessionStatuses
        .mockImplementationOnce(() => olderRead)
        .mockResolvedValue(wrap([{ ...running, status: terminal, ended: 30 }]));
      const { client } = setup();
      const options = evalSessionStatusesQueryOptions("org", "project", [
        "session-1",
      ]);
      if (cached) {
        client.setQueryData(options.queryKey, [running]);
      }
      const observer = new QueryObserver(client, {
        ...options,
        refetchOnMount: "always",
      });
      const unsubscribe = observer.subscribe(() => {});
      try {
        await waitFor(() =>
          expect(api.getEvalSessionStatuses).toHaveBeenCalledTimes(1),
        );
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        // This is the final event: there is no later event or focus/reconnect to rescue it.
        await applyEvalRunUpdated(client, {
          payload: {
            organizationId: "org",
            projectId: "project",
            evalId: "eval-1",
            run: runReport(terminal),
          },
        } as EvalRunUpdatedEvent);
        await vi.advanceTimersByTimeAsync(4_999);
        expect(api.getEvalSessionStatuses).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        vi.useRealTimers();
        await waitFor(() =>
          expect(api.getEvalSessionStatuses).toHaveBeenCalledTimes(2),
        );
        finishOlder(wrap([running]));
        await waitFor(() =>
          expect(observer.getCurrentResult().data?.[0]).toMatchObject({
            status: terminal,
            ended: 30,
          }),
        );
        expect(client.getQueryState(options.queryKey)?.isInvalidated).toBe(
          false,
        );
        expect(api.getEvalSessionStatuses).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
        finishOlder(wrap([running]));
        unsubscribe();
      }
    },
  );

  it("reads every session in an older over-cap collection with bounded requests", async () => {
    const ids = Array.from({ length: 237 }, (_, index) => `session-${index}`);
    api.getEvalSessionStatuses.mockImplementation(
      async ({ evalSessionStatusesRequest }) =>
        wrap(
          evalSessionStatusesRequest.agentSessionIds.map(
            (agentSessionId: string) => ({
              agentSessionId,
              runId: `run-${agentSessionId}`,
              evalId: "eval-1",
              status: EvalRunStatus.Queued,
              total: 1,
              ended: 0,
              errors: 0,
            }),
          ),
        ),
    );
    const { client } = setup();
    const statuses = await client.fetchQuery(
      evalSessionStatusesQueryOptions("org", "project", [...ids, ids[0]]),
    );
    expect(statuses).toHaveLength(237);
    expect(new Set(statuses.map((status) => status.agentSessionId))).toEqual(
      new Set(ids),
    );
    expect(
      api.getEvalSessionStatuses.mock.calls.map(
        ([request]) =>
          request.evalSessionStatusesRequest.agentSessionIds.length,
      ),
    ).toEqual([100, 100, 37]);
  });

  it("refreshes canonical counts after coalesced run and attempt events, and recovers on visibility", async () => {
    let recorded = {
      agentSessionId: "session-1",
      runId: "run-1",
      evalId: "eval-1",
      status: EvalRunStatus.Queued,
      total: 300,
      ended: 0,
      errors: 0,
    };
    api.getEvalSessionStatuses.mockImplementation(async () => wrap([recorded]));
    const { client, wrapper } = setup();
    const { result, unmount } = renderHook(
      () =>
        useEvalSessionStatuses("org", "project", [
          "session-1",
          "unrelated-session",
        ]),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current["session-1"]?.status).toBe(EvalRunStatus.Queued),
    );
    expect(result.current["unrelated-session"]).toBeUndefined();
    const initialReads = api.getEvalSessionStatuses.mock.calls.length;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    recorded = {
      ...recorded,
      status: EvalRunStatus.Running,
      ended: 201,
      errors: 2,
    };
    await act(async () => {
      await applyEvalRunUpdated(client, {
        payload: {
          organizationId: "org",
          projectId: "project",
          evalId: "eval-1",
          run: runReport(EvalRunStatus.Running),
        },
      } as EvalRunUpdatedEvent);
      await applyEvalAttemptUpdated(client, {
        payload: {
          organizationId: "org",
          projectId: "project",
          evalRunId: "run-1",
          attempt: attemptReport(EvalAttemptStatus.Completed),
        },
      } as EvalAttemptUpdatedEvent);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_999);
    });
    expect(api.getEvalSessionStatuses).toHaveBeenCalledTimes(initialReads);
    expect(result.current["session-1"]?.ended).toBe(0);
    await act(async () => {
      await applyEvalAttemptUpdated(client, {
        payload: {
          organizationId: "org",
          projectId: "project",
          evalRunId: "run-1",
          attempt: attemptReport(EvalAttemptStatus.Completed),
        },
      } as EvalAttemptUpdatedEvent);
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(api.getEvalSessionStatuses).toHaveBeenCalledTimes(initialReads + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(api.getEvalSessionStatuses).toHaveBeenCalledTimes(initialReads + 1);
    vi.useRealTimers();
    await waitFor(() => expect(result.current["session-1"]?.ended).toBe(201));
    expect(result.current["session-1"]?.total).toBe(300);
    recorded = { ...recorded, status: EvalRunStatus.Stopped, ended: 300 };
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() =>
      expect(result.current["session-1"]?.status).toBe(EvalRunStatus.Stopped),
    );
    unmount();
    const restored = renderHook(
      () => useEvalSessionStatuses("org", "project", ["session-1"]),
      { wrapper },
    );
    await waitFor(() =>
      expect(restored.result.current["session-1"]?.status).toBe(
        EvalRunStatus.Stopped,
      ),
    );
    expect(api.getReport).not.toHaveBeenCalled();
    expect(api.listReports).not.toHaveBeenCalled();
  });

  it("uses the run vocabulary independently of idle session activity", async () => {
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: "en",
      resources: {
        en: {
          translation: {
            "eval.page.runs.status.QUEUED": "Queued",
            "eval.run.page.statusRunning":
              "Running · {{ended}} of {{total}} ended",
            "eval.run.page.statusStopped": "Stopped",
            "eval.run.page.statusFinished": "Finished",
            "eval.run.page.statusFinishedWithErrors":
              "Finished with {{count}} error",
          },
        },
      },
    });
    const values = { total: 30, ended: 12, errors: 0 };
    expect(
      evalRunStatusLabel(i18n.t, { ...values, status: EvalRunStatus.Queued }),
    ).toBe("Queued");
    expect(
      evalRunStatusLabel(i18n.t, { ...values, status: EvalRunStatus.Running }),
    ).toBe("Running · 12 of 30 ended");
    expect(
      evalRunStatusLabel(i18n.t, { ...values, status: EvalRunStatus.Finished }),
    ).toBe("Finished");
    expect(
      evalRunStatusLabel(i18n.t, {
        ...values,
        errors: 1,
        status: EvalRunStatus.Finished,
      }),
    ).toBe("Finished with 1 error");
    expect(
      evalRunStatusLabel(i18n.t, { ...values, status: EvalRunStatus.Stopped }),
    ).toBe("Stopped");
  });
});
