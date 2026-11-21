import axios from "axios";
import { stripIgnoredCharacters } from "graphql";
import { http } from "msw";
import { WebUiGraphQLClient } from "../../../data/graphql/client";
import { workItemHandlersFromRest } from "../../../test/workItemGraphQLHandlers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentEdgeType, TaskSource, WorkStatus } from "../../../api";
import { resolveFinalAssessmentTaskNeighborhood } from "../finalAssessmentTaskNeighborhood";

const mockGetTask = vi.fn();
const mockGetTasks = vi.fn();
const workItem = (input: {
  id: string;
  type: string;
  parentTaskId: string;
  dependencies?: string[];
}) => ({
  id: input.id,
  name: `Name ${input.id}`,
  type: input.type,
  organizationId: "org-1",
  projectId: "project-1",
  parentTaskId: input.parentTaskId,
  status: WorkStatus.Active,
  source: TaskSource.Agent,
  sections: [],
  edges: (input.dependencies ?? []).map((dependencyId) => ({
    id: `${input.id}-${dependencyId}`,
    sourceNodeId: input.id,
    targetNodeId: dependencyId,
    type: AgentEdgeType.DependsOn,
    reasoning: "Dependency",
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
  })),
});

describe("resolveFinalAssessmentTaskNeighborhood", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.mswServer.use(
      ...workItemHandlersFromRest({
        getTask: mockGetTask,
        getTasks: mockGetTasks,
      }),
    );
  });

  it("validates ancestry and resolves one canonical Stage child batch", async () => {
    const requests: Array<{
      operationName: string;
      query: string;
      variables: Record<string, unknown>;
    }> = [];
    globalThis.mswServer.use(
      http.post("*/graphql", async ({ request }) => {
        requests.push(await request.clone().json());
      }),
    );
    const active = workItem({
      id: "active",
      type: "STANDARD",
      parentTaskId: "stage-1",
      dependencies: ["parent"],
    });
    mockGetTask
      .mockResolvedValueOnce({ data: { data: active } })
      .mockResolvedValueOnce({
        data: {
          data: workItem({
            id: "stage-1",
            type: "PLAN_STAGE",
            parentTaskId: "plan-1",
          }),
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: workItem({
            id: "plan-1",
            type: "PLAN",
            parentTaskId: "feature-1",
          }),
        },
      });
    mockGetTasks.mockResolvedValue({
      data: {
        data: [
          {
            ...workItem({
              id: "parent",
              type: "STANDARD",
              parentTaskId: "stage-1",
            }),
            sections: [
              {
                key: "description",
                materializedMarkdown: "Parent description",
              },
              {
                key: "acceptanceCriteria",
                materializedMarkdown: "Parent criteria",
              },
            ],
          },
          active,
          workItem({
            id: "child",
            type: "STANDARD",
            parentTaskId: "stage-1",
            dependencies: ["active"],
          }),
        ],
      },
    });

    const result = await resolveFinalAssessmentTaskNeighborhood(
      graphqlClient.apollo,
      {
        organizationId: "org-1",
        projectId: "project-1",
        planId: "plan-1",
        taskId: "active",
      },
    );

    expect(result.parentTasks).toEqual([
      {
        id: "parent",
        title: "Name parent",
        taskType: "STANDARD",
        description: "Parent description",
        acceptanceCriteria: "Parent criteria",
      },
    ]);
    expect(result.childTasks.map(({ id }) => id)).toEqual(["child"]);
    expect(requests.map(({ operationName }) => operationName)).toEqual([
      "GetWorkItemParent",
      "GetWorkItemParent",
      "GetWorkItemParent",
      "GetWorkItems",
    ]);
    const hierarchyReads = requests.slice(0, 3);
    expect(hierarchyReads.map(({ variables }) => variables)).toEqual([
      { id: "active" },
      { id: "stage-1" },
      { id: "plan-1" },
    ]);
    for (const { query } of hierarchyReads) {
      expect(stripIgnoredCharacters(query.replace(/\b__typename\b/g, ""))).toBe(
        stripIgnoredCharacters(`
          query GetWorkItemParent($id: ID!) {
            workItem(id: $id) { id type parentTaskId }
          }
        `),
      );
    }
    expect(mockGetTasks).toHaveBeenCalledWith(
      {
        organizationId: "org-1",
        projectId: "project-1",
        parentTaskId: "stage-1",
        type: "STANDARD",
        includeEdges: true,
        edgeTypes: [AgentEdgeType.DependsOn],
        includeSectionKeys: ["acceptanceCriteria", "description"],
        limit: 500,
      },
      expect.anything(),
    );
  });

  it("rejects a Task whose Stage is not a child of the requested Plan", async () => {
    mockGetTask
      .mockResolvedValueOnce({
        data: {
          data: workItem({
            id: "active",
            type: "STANDARD",
            parentTaskId: "stage-1",
          }),
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: workItem({
            id: "stage-1",
            type: "PLAN_STAGE",
            parentTaskId: "different-plan",
          }),
        },
      });

    await expect(
      resolveFinalAssessmentTaskNeighborhood(graphqlClient.apollo, {
        organizationId: "org-1",
        projectId: "project-1",
        planId: "plan-1",
        taskId: "active",
      }),
    ).rejects.toThrow("does not belong to Plan plan-1");
    expect(mockGetTasks).not.toHaveBeenCalled();
  });
});

const graphqlClient = new WebUiGraphQLClient(() =>
  axios.create({ baseURL: "http://localhost:3000/api/v1" }),
);
