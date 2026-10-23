import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { AgentSessionStatus, AgentSessionType } from "../../../api";
import { agentSessionsClient } from "../../../clients/serviceClients";
import { useResolveWorkItemCoordinator } from "../useResolveWorkItemCoordinator";

vi.mock("../../../clients/serviceClients", () => ({
  agentSessionsClient: { resolveWorkItemCoordinator: vi.fn() },
}));
vi.mock("jotai", () => ({ useSetAtom: () => vi.fn() }));

const endpoint = agentSessionsClient.resolveWorkItemCoordinator as Mock;

describe("useResolveWorkItemCoordinator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    endpoint.mockResolvedValue({
      data: {
        data: {
          created: true,
          agentSession: {
            id: "99999999-9999-4999-8999-999999999999",
            organizationId: "org-1",
            projectId: "project-1",
            userId: "user-1",
            type: AgentSessionType.TaskMonitor,
            status: AgentSessionStatus.NotStarted,
            sessionDate: "2026-07-19T00:00:00.000Z",
            createdAt: "2026-07-19T00:00:00.000Z",
            updatedAt: "2026-07-19T00:00:00.000Z",
          },
        },
      },
    });
  });

  it("resolves the durable work-item coordinator through the generated client", async () => {
    const { result } = renderHook(() => useResolveWorkItemCoordinator());

    let resolved: Awaited<ReturnType<typeof result.current.mutate>> | undefined;
    await act(async () => {
      resolved = await result.current.mutate({
        organizationId: "org-1",
        projectId: "project-1",
        body: {
          type: AgentSessionType.TaskMonitor,
          workItemType: "TASK_MONITOR",
          workItemId: "66666666-6666-4666-8666-666666666666",
          sessionDate: "2026-07-19T00:00:00.000Z",
        },
      });
    });

    expect(endpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        resolveWorkItemCoordinatorAgentSessionDto: expect.objectContaining({
          type: AgentSessionType.TaskMonitor,
          workItemType: "TASK_MONITOR",
        }),
      })
    );
    expect(resolved?.created).toBe(true);
  });

  it("fails when the generated response envelope omits data", async () => {
    endpoint.mockResolvedValue({ data: { data: undefined } });
    const { result } = renderHook(() => useResolveWorkItemCoordinator());

    await act(async () => {
      await expect(
        result.current.mutate({
          organizationId: "org-1",
          projectId: "project-1",
          body: {
            type: AgentSessionType.TaskMonitor,
            workItemType: "TASK_MONITOR",
            workItemId: "66666666-6666-4666-8666-666666666666",
            sessionDate: "2026-07-19T00:00:00.000Z",
          },
        })
      ).rejects.toThrow("did not return a Task Monitor coordinator");
    });
  });
});
