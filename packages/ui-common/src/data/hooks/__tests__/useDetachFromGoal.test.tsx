import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EntityType } from "../../../api";
import { unifiedApiClient } from "../../../clients/serviceClients";
import { useDetachFromGoal } from "../useDetachFromGoal";

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    detachFromGoal: vi.fn(),
  },
}));

const mockedClient = vi.mocked(unifiedApiClient);

describe("useDetachFromGoal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends the active goal and selected target to the generated client", async () => {
    mockedClient.detachFromGoal.mockResolvedValue({
      data: {
        data: {
          deleted: true,
          targetEntityId: "target-1",
          targetEntityType: EntityType.Task,
        },
      },
    } as Awaited<ReturnType<typeof unifiedApiClient.detachFromGoal>>);
    const { result } = renderHook(() =>
      useDetachFromGoal({ organizationId: "org-1", projectId: "project-1" })
    );

    await act(async () => {
      await result.current.detach({
        goalId: "goal-1",
        targetEntityId: "target-1",
        targetEntityType: EntityType.Task,
      });
    });

    expect(mockedClient.detachFromGoal).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      taskId: "goal-1",
      detachFromGoalDto: {
        targetEntityId: "target-1",
        targetEntityType: EntityType.Task,
      },
    });
  });
});
