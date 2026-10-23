import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentEdgeType, TaskSource, WorkStatus } from "../../../api";
import { unifiedApiClient } from "../../../clients/serviceClients";
import { resolveFinalAssessmentTaskNeighborhood } from "../finalAssessmentTaskNeighborhood";

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    getTask: vi.fn(),
    getTasks: vi.fn(),
  },
}));

const mockGetTask = vi.mocked(unifiedApiClient.getTask);
const mockGetTasks = vi.mocked(unifiedApiClient.getTasks);

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
  beforeEach(() => vi.clearAllMocks());

  it("validates ancestry and resolves one canonical Stage child batch", async () => {
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
          workItem({ id: "parent", type: "STANDARD", parentTaskId: "stage-1" }),
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

    const result = await resolveFinalAssessmentTaskNeighborhood({
      organizationId: "org-1",
      projectId: "project-1",
      planId: "plan-1",
      taskId: "active",
    });

    expect(result.parentTasks.map(({ id }) => id)).toEqual(["parent"]);
    expect(result.childTasks.map(({ id }) => id)).toEqual(["child"]);
    expect(mockGetTasks).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      parentTaskId: "stage-1",
      type: "STANDARD",
      includeEdges: true,
      edgeTypes: [AgentEdgeType.DependsOn],
      includeSectionKeys: ["description", "acceptanceCriteria"],
      limit: 500,
    });
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
      resolveFinalAssessmentTaskNeighborhood({
        organizationId: "org-1",
        projectId: "project-1",
        planId: "plan-1",
        taskId: "active",
      })
    ).rejects.toThrow("does not belong to Plan plan-1");
    expect(mockGetTasks).not.toHaveBeenCalled();
  });
});
