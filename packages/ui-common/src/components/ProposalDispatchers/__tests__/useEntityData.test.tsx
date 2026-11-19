import { unifiedApiClient as workItemFixtureClient } from "../../../clients/serviceClients";
import { workItemHandlersFromClient } from "../../../test/workItemGraphQLHandlers";
import { act, renderHook, waitFor } from "@testing-library/react";
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
import { refreshWorkItem } from "../../../data/graphql/workItemCache";
import { FakeWorkItemServer } from "../../../test/workItemGraphQL";

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
  status: "ACTIVE",
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
    globalThis.mswServer.use(
      ...workItemHandlersFromClient(
        workItemFixtureClient as unknown as Record<string, unknown>,
      ),
    );
    getTaskMock.mockReset();
    getTaskMock.mockResolvedValue({ data: { data: task } });
  });

  it("loads service relations needed for the before side of task diffs", async () => {
    const { result } = renderHook(() =>
      useEntityData([proposal], "org-1", "project-1"),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        taskId: "task-1",
        includeServiceRelations: true,
      }),
      expect.anything(),
    );
    expect(result.current.entities["task-1"]).toEqual({
      type: "task",
      data: expect.objectContaining(task),
    });
  });

  it("updates an open live comparison while keeping recorded values in the retained comparison", async () => {
    const server = new FakeWorkItemServer([
      {
        id: "task-1",
        name: "Live title",
        type: "STANDARD",
        status: "ACTIVE",
        sections: [{ key: "description", materializedMarkdown: "Live text" }],
      },
    ]);
    const proposals = [
      {
        ...proposal,
        updates: {
          name: "Proposed title",
          sections: [{ key: "description", content: "Proposed text" }],
        },
        retainedOriginalTargetContent: {
          name: "Recorded title",
          "sections.description.content": "Recorded text",
        },
      },
    ];
    const { result } = renderHook(
      () => ({
        live: useEntityData(proposals, "org-1", "project-1"),
        retained: useEntityData(proposals, "org-1", "project-1", "retained"),
      }),
      { wrapper: server.wrapper },
    );

    const expectComparisons = (
      title: string,
      description: string,
      status: string,
    ) => {
      expect(result.current.live.entities["task-1"]?.data).toMatchObject({
        name: title,
        status,
        sections: [{ key: "description", materializedMarkdown: description }],
      });
      expect(result.current.retained.entities["task-1"]?.data).toMatchObject({
        name: "Recorded title",
        status,
        sections: [
          { key: "description", materializedMarkdown: "Recorded text" },
        ],
      });
    };

    await waitFor(() => expectComparisons("Live title", "Live text", "ACTIVE"));
    server.update("task-1", {
      name: "Edited title",
      status: "BACKLOG",
      sections: [{ key: "description", materializedMarkdown: "Edited text" }],
    });
    await act(async () => {
      await refreshWorkItem(server.graphql.apollo, "task-1", {
        organizationId: "org-1",
        projectId: "project-1",
      });
    });

    await waitFor(() =>
      expectComparisons("Edited title", "Edited text", "BACKLOG"),
    );
  });
});
