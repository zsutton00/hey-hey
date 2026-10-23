import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type ProposalResponseDto,
  type TaskResponseDto,
} from "../../../api";
import { useEntityData } from "../useEntityData";

const getTaskMock = vi.hoisted(() => vi.fn());

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    getTask: getTaskMock,
    getDesignDoc: vi.fn(),
  },
}));

const proposal = {
  id: "proposal-1",
  organizationId: "org-1",
  projectId: "project-1",
  type: ProposalType.Single,
  action: ProposalAction.Update,
  status: ProposalStatus.Pending,
  targetEntityId: "task-1",
  targetEntityType: TargetEntityType.Task,
  updates: { serviceIds: ["service-new"] },
  requestorId: "user-1",
  createdAt: "2026-08-13T00:00:00Z",
  updatedAt: "2026-08-13T00:00:00Z",
} as ProposalResponseDto;

const task = {
  id: "task-1",
  name: "Task",
  type: "STANDARD",
  organizationId: "org-1",
  projectId: "project-1",
  serviceRelations: [
    {
      id: "relation-1",
      serviceId: "service-old",
      taskId: "task-1",
      createdAt: "2026-08-13T00:00:00Z",
    },
  ],
} as TaskResponseDto;

describe("useEntityData task service relations", () => {
  beforeEach(() => {
    getTaskMock.mockReset();
    getTaskMock.mockResolvedValue({ data: { data: task } });
  });

  it("loads service relations needed for the before side of task diffs", async () => {
    const { result } = renderHook(() =>
      useEntityData([proposal], "org-1", "project-1")
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getTaskMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      taskId: "task-1",
      includeServiceRelations: true,
    });
    expect(result.current.entities["task-1"]).toEqual({
      type: "task",
      data: task,
    });
  });
});
