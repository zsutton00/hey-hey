import {
  EntityType,
  WorkItemGraphDerivedReferenceProjectionKindEnum,
  type AgentEdgeResponseDto,
  type TaskResponseDto,
  type WorkItemGraphAggregateResponseDto,
} from "@hey-hey/ui-common/api";
import { describe, expect, it } from "vitest";

import {
  buildWorkflowGraphData,
  buildWorkflowGraphDataFromAggregate,
  dedupeWorkflowEdges,
  isWorkflowStepType,
  isWorkflowType,
  normalizeWorkflowStepEdges,
} from "./workflowStepEdges";

const edge = (
  overrides: Partial<AgentEdgeResponseDto> & { type: string }
): AgentEdgeResponseDto =>
  ({
    id: "edge-1",
    sourceNodeId: "step-1",
    targetNodeId: "step-2",
    reasoning: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as AgentEdgeResponseDto);

const step = (id: string, name: string): TaskResponseDto =>
  ({
    id,
    name,
    type: "workflow_step",
  } as TaskResponseDto);

const workflow = (overrides: Partial<TaskResponseDto> = {}): TaskResponseDto =>
  ({
    id: "workflow-1",
    name: "Workflow",
    type: "workflow",
    ...overrides,
  } as TaskResponseDto);

describe("normalizeWorkflowStepEdges", () => {
  it("splits workflow flow links from fulfillment metadata", () => {
    const result = normalizeWorkflowStepEdges(
      "step-1",
      [
        edge({ id: "standard", type: "STANDARD", targetNodeId: "step-2" }),
        edge({
          id: "conditional",
          type: "CONDITIONAL",
          targetNodeId: "step-3",
        }),
        edge({
          id: "fulfilled",
          type: "FULFILLED_BY",
          targetNodeId: "task-1",
        }),
        edge({ id: "related", type: "RELATED_TO", targetNodeId: "task-2" }),
      ],
      [step("step-2", "Second Step"), step("step-3", "Decision Step")]
    );

    expect(result.flowLinks.map((item) => item.id)).toEqual([
      "standard",
      "conditional",
    ]);
    expect(result.fulfillmentLinks.map((item) => item.id)).toEqual([
      "fulfilled",
    ]);
    expect(result.flowLinks[0]).toMatchObject({
      connectedNodeId: "step-2",
      connectedNodeName: "Second Step",
      directionFromStep: "outbound",
    });
  });

  it("marks incoming and loop links from the current step perspective", () => {
    const result = normalizeWorkflowStepEdges("step-1", [
      edge({
        id: "incoming",
        type: "STANDARD",
        sourceNodeId: "step-2",
        targetNodeId: "step-1",
      }),
      edge({
        id: "loop",
        type: "LOOP",
        sourceNodeId: "step-1",
        targetNodeId: "step-1",
      }),
    ]);

    expect(result.flowLinks).toEqual([
      expect.objectContaining({
        id: "incoming",
        directionFromStep: "inbound",
        connectedNodeId: "step-2",
      }),
      expect.objectContaining({
        id: "loop",
        directionFromStep: "self",
        connectedNodeId: "step-1",
      }),
    ]);
  });

  it("excludes aggregate relationships that are not incident to the current step", () => {
    const result = normalizeWorkflowStepEdges("step-1", [
      edge({
        id: "sibling-flow",
        type: "STANDARD",
        sourceNodeId: "step-2",
        targetNodeId: "step-3",
      }),
      edge({
        id: "sibling-fulfillment",
        type: "FULFILLED_BY",
        sourceNodeId: "step-2",
        targetNodeId: "task-1",
      }),
      edge({
        id: "current-flow",
        type: "STANDARD",
        sourceNodeId: "step-1",
        targetNodeId: "step-2",
      }),
    ]);

    expect(result.flowLinks.map((item) => item.id)).toEqual(["current-flow"]);
    expect(result.fulfillmentLinks).toEqual([]);
  });
});

describe("workflow work-item helpers", () => {
  it("detects workflow containers and workflow_step leaves", () => {
    expect(isWorkflowType({ type: "workflow" } as TaskResponseDto)).toBe(true);
    expect(isWorkflowType({ type: "workflow_step" } as TaskResponseDto)).toBe(
      false
    );
    expect(
      isWorkflowStepType({ type: "workflow_step" } as TaskResponseDto)
    ).toBe(true);
  });

  it("dedupes workflow graph edges and filters generic relationships", () => {
    const result = dedupeWorkflowEdges([
      [
        edge({ id: "flow-1", type: "STANDARD" }),
        edge({ id: "related", type: "RELATED_TO" }),
      ],
      [
        edge({
          id: "flow-1",
          type: "STANDARD",
          targetNodeId: "step-3",
        }),
        edge({ id: "fulfilled", type: "FULFILLED_BY" }),
        edge({
          id: "contract-dependency",
          type: "DEPENDS_ON",
          targetNodeId: "contract-1",
          targetNodeName: "Canonical payload boundary",
          targetNodeType: "CONTRACT",
        }),
      ],
    ]);

    expect(result.map((item) => item.id)).toEqual([
      "flow-1",
      "fulfilled",
      "contract-dependency",
    ]);
    expect(result[0]).toMatchObject({ targetNodeId: "step-3" });
    expect(result[2]).toMatchObject({
      targetNodeId: "contract-1",
      targetNodeName: "Canonical payload boundary",
      targetNodeType: "CONTRACT",
    });
  });

  it("builds shared workflow graph surface data from a workflow and steps", () => {
    const result = buildWorkflowGraphData(
      workflow({
        edges: [
          edge({ id: "flow-1", type: "STANDARD" }),
          edge({ id: "related", type: "RELATED_TO" }),
        ],
      }),
      [
        step("step-1", "First Step"),
        step("step-2", "Second Step"),
        {
          ...step("task-1", "Ordinary Task"),
          type: "STANDARD",
        } as TaskResponseDto,
      ]
    );

    expect(result?.workflow.id).toBe("workflow-1");
    expect(result?.steps.map((item) => item.id)).toEqual(["step-1", "step-2"]);
    expect(result?.edges.map((item) => item.id)).toEqual(["flow-1"]);
  });

  it("preserves aggregate relationships without forwarding derived workflow references", () => {
    const aggregate: WorkItemGraphAggregateResponseDto = {
      root: workflow(),
      children: [step("step-1", "First Step")],
      relationships: [edge({ id: "flow-1", type: "STANDARD" })],
      layout: null,
      derivedReferences: [
        {
          expansionKey: "contractLinkedWorkflows",
          projectionKind:
            WorkItemGraphDerivedReferenceProjectionKindEnum.WorkItemReference,
          entityId: "workflow-2",
          entityType: EntityType.Task,
          workItemTypeKey: "workflow",
          displayName: "External workflow",
          viaEntityIds: ["contract-1"],
        },
      ],
    };
    const definition = {
      key: "workflow",
      name: "Workflow",
      sections: [],
      allowedStatuses: [],
      iconKey: "workflow" as const,
    };

    const result = buildWorkflowGraphDataFromAggregate(aggregate, definition);

    expect(result?.edges).toBe(aggregate.relationships);
    expect(result).not.toHaveProperty("derivedReferences");
    expect(result?.workflowTypeDefinition).toBe(definition);
  });
});
