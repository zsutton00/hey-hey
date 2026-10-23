import { describe, expect, it } from "vitest";
import { AgentEdgeType, TaskSource, WorkStatus } from "../../../api";
import type { PlanStageStandardTask } from "../../../data/plans/canonicalPlan";
import { deriveFinalAssessmentTaskNeighborhood } from "../finalAssessmentTaskNeighborhood";

const createTask = (input: {
  id: string;
  dependencies?: string[];
  description?: string;
}): PlanStageStandardTask => ({
  id: input.id,
  name: `Name ${input.id}`,
  type: "STANDARD",
  organizationId: "org-1",
  projectId: "project-1",
  parentTaskId: "stage-1",
  status: WorkStatus.Active,
  source: TaskSource.Agent,
  sections: input.description
    ? [
        {
          id: `description-${input.id}`,
          key: "description",
          order: 0,
          materializedMarkdown: input.description,
          crdtSnapshotSeq: null,
        },
      ]
    : [],
  edges: (input.dependencies ?? []).map((dependencyId) => ({
    id: `${input.id}-depends-on-${dependencyId}`,
    sourceNodeId: input.id,
    targetNodeId: dependencyId,
    type: AgentEdgeType.DependsOn,
    reasoning: "Dependency",
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
  })),
});

describe("deriveFinalAssessmentTaskNeighborhood", () => {
  it("derives direct parents and children from canonical dependency edges", () => {
    const result = deriveFinalAssessmentTaskNeighborhood({
      activeTaskId: "active",
      siblingTasks: [
        createTask({ id: "parent", description: "Parent description" }),
        createTask({ id: "active", dependencies: ["parent"] }),
        createTask({ id: "child-a", dependencies: ["active"] }),
        createTask({ id: "unrelated" }),
        createTask({ id: "child-b", dependencies: ["active", "parent"] }),
      ],
    });

    expect(result.parentTasks.map(({ id }) => id)).toEqual(["parent"]);
    expect(result.childTasks.map(({ id }) => id)).toEqual([
      "child-a",
      "child-b",
    ]);
    expect(result.parentTasks[0]?.description).toBe("Parent description");
  });

  it("ignores dependency targets outside the Stage", () => {
    expect(
      deriveFinalAssessmentTaskNeighborhood({
        activeTaskId: "active",
        siblingTasks: [
          createTask({ id: "active", dependencies: ["external"] }),
        ],
      })
    ).toEqual({ parentTasks: [], childTasks: [] });
  });

  it("returns an empty neighborhood when the active Task is absent", () => {
    expect(
      deriveFinalAssessmentTaskNeighborhood({
        activeTaskId: "missing",
        siblingTasks: [createTask({ id: "task-1" })],
      })
    ).toEqual({ parentTasks: [], childTasks: [] });
  });
});
