import { createNavigationLineageEntry } from "../../../types/userTracking";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EntityType,
  type OpenItem,
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
  getOpenItems: vi.fn(),
  activateOpenItem: vi.fn(),
  getReport: vi.fn(),
  listReports: vi.fn(),
  updateAgentSession: vi.fn(),
  stopAgentSessionRun: vi.fn(),
}));
vi.mock("../../../clients/serviceClients", async (original) => ({
  ...(await original<object>()),
  openItemsClient: api,
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
const execution = {
  handler: "entity_conversation",
  projectAssistantPrepares: true,
  assessedOutput: "HANDLER_REPLY",
} as const;

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
      evalId: "550e8400-e29b-41d4-a716-446655440002",
      status,
      judgeSetup: {
        provider: "claude",
        model: "claude-opus-5-5",
        reasoningEffort: "high",
      },
      cases: [caseInput],
      configurations: [configuration],
      settings: { maxConcurrentAttempts: 2, attemptTimeLimitSeconds: 900 },
      coordinatorAgentSessionId: "550e8400-e29b-41d4-a716-446655440001",
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
    execution,
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
  userId: "user",
  lineage: [
    createNavigationLineageEntry(
      "task",
      "550e8400-e29b-41d4-a716-446655440002",
    ),
  ],
};

let serverItems: OpenItem[];
const now = "2026-11-13T00:00:00.000Z";
const populatedItem = (entityId: string, index: number): OpenItem => ({
  entityType: EntityType.Task,
  entityId,
  note: `Keep context ${index}`,
  pinned: index === 1,
  position: String(index),
  groupId: null,
  memberPosition: null,
  goalTrackedWorkFilter: "ACTIVE_AND_BACKLOG",
  goalCollapsed: true,
  revision: 1,
  lineage: [],
  presentation: {
    label: `Existing task ${index}`,
    workItemTypeKey: "STANDARD",
  },
  removedAt: null,
  updatedAt: now,
});

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  serverItems = [
    populatedItem("550e8400-e29b-41d4-a716-446655440002", 0),
    populatedItem("550e8400-e29b-41d4-a716-446655440003", 1),
    populatedItem("550e8400-e29b-41d4-a716-446655440004", 2),
  ];
  api.getOpenItems.mockImplementation(async () =>
    wrap({ state: "PRESENT", revision: 1, items: serverItems, groups: [] }),
  );
  api.activateOpenItem.mockImplementation(
    async ({ activateOpenItemRequest: request }) => {
      const existing = serverItems.find(
        (item) => item.entityId === request.item.entityId,
      );
      const item = {
        ...populatedItem(request.item.entityId, 3),
        ...existing,
        ...request.item,
        presentation: request.presentation,
        lineage: request.lineage,
        revision: 2,
      };
      serverItems = [
        ...serverItems.filter((row) => row.entityId !== item.entityId),
        item,
      ];
      return wrap({
        collectionRevision: 2,
        items: [item],
        groups: [],
        deletedGroupIds: [],
        replayed: false,
      });
    },
  );
  getAccess.mockReturnValue({
    isDeviceEnabled: true,
    interactions: { startSession },
    unavailable: null,
  });
  api.getReport.mockResolvedValue(wrap(runReport(EvalRunStatus.Queued)));
  api.listReports.mockResolvedValue(wrap([attemptReport]));
  api.updateAgentSession.mockResolvedValue(
    wrap({ id: "550e8400-e29b-41d4-a716-446655440001" }),
  );
  startSession.mockResolvedValue({ state: "accepted" });
});

describe("useEvalRunSession", () => {
  it("adds one coordinator after accepted start while preserving a populated working set", async () => {
    const original = structuredClone(serverItems);
    const { result } = setup();
    expect(api.activateOpenItem).not.toHaveBeenCalled();
    await act(async () => {
      expect(await result.current.start(startInput)).toEqual({ ok: true });
      expect(await result.current.start(startInput)).toEqual({ ok: true });
    });
    expect(serverItems).toHaveLength(4);
    expect(serverItems.slice(0, 3)).toEqual(original);
    expect(serverItems[3]).toMatchObject({
      entityType: EntityType.AgentSession,
      lineage: [
        {
          entityType: EntityType.Task,
          entityId: startInput.lineage[0].entityId,
        },
      ],
      presentation: { agentSessionType: "PROJECT_CONVERSATION" },
    });
    expect(serverItems[3].presentation).not.toHaveProperty("status");
    expect(runReport(EvalRunStatus.Queued).payload.status).toBe(
      EvalRunStatus.Queued,
    );
  });

  it("keeps accepted start successful when Open Items refuses activation", async () => {
    api.activateOpenItem.mockRejectedValue(new Error("All items protected"));
    const { result } = setup();
    await act(async () => {
      expect(await result.current.start(startInput)).toEqual({ ok: true });
    });
    expect(startSession).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
    expect(serverItems).toHaveLength(3);
  });

  it("starts the prepared session with a payload built only from the saved run", async () => {
    const { result } = setup();
    let started: unknown;
    await act(async () => {
      started = await result.current.start(startInput);
    });

    expect(started).toEqual({ ok: true });
    expect(api.updateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSessionId: "550e8400-e29b-41d4-a716-446655440001",
        updateAgentSessionDto: { machineId: "machine-1" },
      }),
    );
    expect(getAccess).toHaveBeenCalledWith("machine-1");
    const input = startSession.mock.calls[0][0];
    expect(input.agentSessionId).toBe("550e8400-e29b-41d4-a716-446655440001");
    expect(input.conversationId).toBe("coordinator-conversation");
    expect(input.intent).toMatchObject({
      handlerPromptType: "run_eval",
      provider: "claude",
      model: "claude-opus-5-5",
      reasoningEffort: "high",
    });
    expect(input.intent.payload).toEqual({
      promptType: "run_eval",
      entity: {
        entityType: "TASK",
        entityId: "550e8400-e29b-41d4-a716-446655440002",
      },
      userMessage: "Run eval",
      evalRunId: "run-1",
      judgeSetup: runReport(EvalRunStatus.Queued).payload.judgeSetup,
      settings: { maxConcurrentAttempts: 2, attemptTimeLimitSeconds: 900 },
      cases: runReport(EvalRunStatus.Queued).payload.cases,
      attempts: [
        {
          attemptId: "attempt-1",
          targetSessionId: "target-session",
          targetConversationId: "target-conversation",
          caseInput,
          configuration,
          execution,
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
      agentSessionId: "550e8400-e29b-41d4-a716-446655440001",
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
