import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TaskSource,
  WorkStatus,
  type TaskResponseDto,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { useWorkItems } from "../../data/hooks/useWorkItems";
import { usePlanStageTaskMonitorCreateOrReopen } from "./usePlanStageTaskMonitorCreateOrReopen";

vi.mock("../../data/hooks/useWorkItems", () => ({ useWorkItems: vi.fn() }));
vi.mock("../../clients/serviceClients", () => ({
  unifiedApiClient: { createAgentEdge: vi.fn() },
}));

const mockUseWorkItems = vi.mocked(useWorkItems);
const mockCreateAgentEdge = vi.mocked(unifiedApiClient.createAgentEdge);
const context = {
  organizationId: "org-1",
  projectId: "project-1",
  planId: "11111111-1111-4111-8111-111111111111",
  planParentTaskId: "55555555-5555-4555-8555-555555555555",
  stageId: "22222222-2222-4222-8222-222222222222",
  planLabel: "Release plan",
  stageLabel: "Ship stage",
};
const definition = {
  executionPlan: [
    {
      taskId: "44444444-4444-4444-8444-444444444444",
      dependsOnTaskIds: [],
      launchConfiguration: {
        method: "quick" as const,
        provider: "codex" as const,
        model: "gpt-5.5",
        reasoningEffort: "medium" as const,
      },
    },
  ],
  launchPolicy: {
    terminalSupervision: { mode: "AGENT_DECIDES" as const },
  },
  cursor: 0,
};
const createdMonitor: TaskResponseDto = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Monitor",
  type: "TASK_MONITOR",
  organizationId: context.organizationId,
  projectId: context.projectId,
  status: WorkStatus.Backlog,
  source: TaskSource.User,
};
const createTask = vi.fn(async () => createdMonitor);

describe("usePlanStageTaskMonitorCreateOrReopen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockCreateAgentEdge.mockResolvedValue({} as never);
    mockUseWorkItems.mockReturnValue({
      createTask,
    } as ReturnType<typeof useWorkItems>);
  });

  it("creates one fresh generic monitor after setup confirmation", async () => {
    const { result } = renderHook(() =>
      usePlanStageTaskMonitorCreateOrReopen({
        ...context,
        definition,
        userMessage: "Focus on the contract",
      })
    );

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "created",
        monitorId: createdMonitor.id,
      })
    );

    expect(mockUseWorkItems).toHaveBeenCalledWith(
      context.organizationId,
      "task",
      context.projectId,
      undefined,
      { enabled: false }
    );
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ parentTaskId: context.planParentTaskId })
    );
    expect(mockCreateAgentEdge).toHaveBeenCalledTimes(3);
    expect(mockCreateAgentEdge).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          sourceNodeId: createdMonitor.id,
          targetNodeId: definition.executionPlan[0].taskId,
          targetEntityType: "TASK",
        }),
      })
    );
    expect(mockCreateAgentEdge).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          targetNodeId: context.planId,
          targetEntityType: "TASK",
        }),
      })
    );
    expect(mockCreateAgentEdge).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          targetNodeId: context.stageId,
          targetEntityType: "TASK",
        }),
      })
    );
    expect(
      localStorage.getItem(
        `task-monitor-start-message:${context.organizationId}:${context.projectId}:${createdMonitor.id}`
      )
    ).toBe("Focus on the contract");
  });

  it.each(["REQUIRE_REVIEW", "AGENT_DECIDES"] as const)(
    "persists %s in the created Task Monitor definition",
    async (mode) => {
      const selectedDefinition = {
        ...definition,
        launchPolicy: {
          ...definition.launchPolicy,
          terminalSupervision: { mode },
        },
      };
      renderHook(() =>
        usePlanStageTaskMonitorCreateOrReopen({
          ...context,
          definition: selectedDefinition,
        })
      );

      await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          sections: expect.arrayContaining([
            expect.objectContaining({
              key: "executionDefinition",
              content: selectedDefinition,
            }),
          ]),
        })
      );
    }
  );

  it("refuses creation before the request when the Plan parent is missing", async () => {
    const { result } = renderHook(() =>
      usePlanStageTaskMonitorCreateOrReopen({
        ...context,
        planParentTaskId: "",
        definition,
      })
    );

    await waitFor(() => expect(result.current.state.status).toBe("blocked"));
    expect(createTask).not.toHaveBeenCalled();
    expect(mockCreateAgentEdge).not.toHaveBeenCalled();
  });

  it("does not publish the created identity until all relationships finish", async () => {
    let resolveRelationship: (() => void) | undefined;
    const relationshipPending = new Promise<void>((resolve) => {
      resolveRelationship = resolve;
    });
    mockCreateAgentEdge.mockImplementation(() =>
      relationshipPending.then(() => ({} as never))
    );
    const { result } = renderHook(() =>
      usePlanStageTaskMonitorCreateOrReopen({ ...context, definition })
    );

    await waitFor(() => expect(result.current.state.status).toBe("linking"));
    expect(localStorage.length).toBe(0);

    resolveRelationship?.();

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "created",
        monitorId: createdMonitor.id,
      })
    );
  });
});
