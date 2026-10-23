import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskSource, WorkStatus } from "../../../api";
import { parseTaskMonitorExecutionDefinition } from "../taskMonitorSchema";
import { useTaskMonitorProjection } from "../useTaskMonitorProjection";
import {
  createSession,
  createTask,
  createTaskMonitorDefinition,
  firstTaskId,
  secondTaskId,
  sessionId,
} from "./taskMonitorTestFixtures";

const collectionMocks = vi.hoisted(() => ({
  readSessions: vi.fn(),
  agentSessionListQueryOptions: vi.fn(),
}));
vi.mock("../../../data/collections/agentSessions", () => ({
  agentSessionListQueryOptions: collectionMocks.agentSessionListQueryOptions,
}));
const listOptions = (filters: unknown) => ({
  queryKey: ["agentSessions", "test", filters],
  queryFn: collectionMocks.readSessions,
});
vi.mock("../../../data/hooks", () => ({
  useWorkItem: vi.fn(),
  useWorkItems: vi.fn(),
  useAgentSessions: vi.fn(),
}));
const updateTask = vi.hoisted(() => vi.fn());
vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: { updateTask },
}));

import {
  useAgentSessions,
  useWorkItem,
  useWorkItems,
} from "../../../data/hooks";

const mockUseWorkItem = vi.mocked(useWorkItem);
const mockUseWorkItems = vi.mocked(useWorkItems);
const mockUseAgentSessions = vi.mocked(useAgentSessions);

const monitor = (definition = createTaskMonitorDefinition()) => ({
  id: "monitor-1",
  name: "Release monitor",
  type: "TASK_MONITOR",
  organizationId: "org-1",
  projectId: "project-1",
  status: WorkStatus.Active,
  source: TaskSource.User,
  sections: [
    {
      id: "section-1",
      key: "executionDefinition",
      order: 0,
      materializedMarkdown: JSON.stringify(definition),
    },
  ],
});

describe("useTaskMonitorProjection", () => {
  const refetchMonitor = vi.fn();

  beforeEach(() => {
    updateTask.mockReset();
    updateTask.mockResolvedValue({ data: { data: {} } });
    refetchMonitor.mockReset();
    refetchMonitor.mockResolvedValue(monitor());
    collectionMocks.readSessions.mockReset();
    collectionMocks.readSessions.mockResolvedValue([]);
    collectionMocks.agentSessionListQueryOptions.mockReset();
    collectionMocks.agentSessionListQueryOptions.mockImplementation(
      (_organizationId: string, _projectId: string, filters: unknown) =>
        listOptions(filters)
    );
    mockUseWorkItem.mockReturnValue({
      workItem: monitor(),
      isLoading: false,
      isFetched: true,
      error: null,
      refetch: refetchMonitor,
    } as ReturnType<typeof useWorkItem>);
    mockUseWorkItems.mockReturnValue({
      workItems: [createTask(firstTaskId, "First task")],
      isLoading: false,
      isFetched: true,
      error: null,
    } as ReturnType<typeof useWorkItems>);
    mockUseAgentSessions.mockReturnValue({
      agentSessions: [createSession()],
      isLoading: false,
      isFetched: true,
      error: null,
    } as ReturnType<typeof useAgentSessions>);
  });

  it("strictly rejects the legacy execution definition", () => {
    expect(() =>
      parseTaskMonitorExecutionDefinition(
        JSON.stringify({
          selectedWork: [],
          dependencyOrder: { nodes: [], edges: [] },
          cursor: { state: "READY" },
        })
      )
    ).toThrow("does not match the Task Monitor schema");
  });

  it("preserves order and cursor while batch-joining canonical records", () => {
    const { result } = renderHook(() =>
      useTaskMonitorProjection({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "monitor-1",
      })
    );

    expect(mockUseWorkItems).toHaveBeenCalledWith(
      "org-1",
      "task",
      "project-1",
      undefined,
      expect.objectContaining({ taskIds: [firstTaskId, secondTaskId] })
    );
    expect(mockUseAgentSessions).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      expect.objectContaining({ ids: [sessionId] })
    );
    expect(result.current.nodes.map((node) => node.taskId)).toEqual([
      firstTaskId,
      secondTaskId,
    ]);
    expect(result.current.nodes[0]).toMatchObject({
      position: 0,
      isCursor: false,
      task: { kind: "loaded" },
      session: { kind: "none" },
    });
    expect(result.current.nodes[1]).toMatchObject({
      position: 1,
      isCursor: true,
      task: { kind: "missing" },
      session: { kind: "loaded" },
      visualStatus: "errored",
    });
  });

  it("represents a referenced session that cannot be loaded explicitly", () => {
    mockUseAgentSessions.mockReturnValue({
      agentSessions: [],
      isLoading: false,
      isFetched: true,
      error: null,
    } as ReturnType<typeof useAgentSessions>);
    const { result } = renderHook(() =>
      useTaskMonitorProjection({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "monitor-1",
      })
    );
    expect(result.current.nodes[1]?.session).toEqual({ kind: "missing" });
  });

  it("updates only the generated execution-definition section and refreshes it", async () => {
    const { result } = renderHook(() =>
      useTaskMonitorProjection({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "monitor-1",
      })
    );

    await act(() =>
      result.current.saveLaunchConfiguration(firstTaskId, {
        method: "plan",
        provider: "claude",
        model: "claude-sonnet-4-6",
        reasoningEffort: "high",
      })
    );

    expect(updateTask).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      taskId: "monitor-1",
      updateTaskDto: {
        sections: [
          {
            key: "executionDefinition",
            content: {
              ...createTaskMonitorDefinition(),
              executionPlan: createTaskMonitorDefinition().executionPlan.map(
                (node) =>
                  node.taskId === firstTaskId
                    ? {
                        ...node,
                        launchConfiguration: {
                          method: "plan",
                          provider: "claude",
                          model: "claude-sonnet-4-6",
                          reasoningEffort: "high",
                        },
                      }
                    : node
              ),
            },
          },
        ],
      },
    });
    expect(refetchMonitor).toHaveBeenCalledTimes(1);
  });

  it("refreshes the monitor before refetching newly linked sessions", async () => {
    const newSessionId = "44444444-4444-4444-8444-444444444444";
    const events: string[] = [];
    const refreshedDefinition = {
      ...createTaskMonitorDefinition(),
      executionPlan: createTaskMonitorDefinition().executionPlan.map(
        (node, index) =>
          index === 0 ? { ...node, agentSessionId: newSessionId } : node
      ),
    };
    refetchMonitor.mockImplementation(async () => {
      events.push("refetch-monitor");
      return monitor(refreshedDefinition);
    });
    collectionMocks.agentSessionListQueryOptions.mockImplementation(
      (_organizationId: string, _projectId: string, filters: unknown) => {
        events.push("derive-linked-sessions");
        return listOptions(filters);
      }
    );
    collectionMocks.readSessions.mockImplementation(async () => {
      events.push("refetch-sessions");
      return [];
    });
    const { result } = renderHook(() =>
      useTaskMonitorProjection({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "monitor-1",
      })
    );

    await act(() => result.current.reconcileAfterCommand());

    expect(events).toEqual([
      "refetch-monitor",
      "derive-linked-sessions",
      "refetch-sessions",
    ]);
    expect(refetchMonitor).toHaveBeenCalledTimes(1);
    expect(collectionMocks.agentSessionListQueryOptions).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      { ids: [newSessionId, sessionId] }
    );
    expect(collectionMocks.readSessions).toHaveBeenCalledOnce();
  });

  it("fails reconciliation when the canonical monitor cannot be refreshed", async () => {
    refetchMonitor.mockResolvedValue(null);
    const { result } = renderHook(() =>
      useTaskMonitorProjection({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "monitor-1",
      })
    );

    await expect(
      act(() => result.current.reconcileAfterCommand())
    ).rejects.toThrow("canonical Task Monitor could not be refreshed");
    expect(collectionMocks.readSessions).not.toHaveBeenCalled();
  });
});
