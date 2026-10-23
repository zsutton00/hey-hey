import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AgentEdgeCategory,
  AgentEdgeType,
  WorkItemChangeSetMaterializationState,
  WorkItemChangeSetOperationProgressStatusEnum,
  type ProjectedWorkItemRelationship,
  type WorkItemChangeSetMaterializationProgress,
  type WorkItemChangeSetOperation,
} from "../../../api";
import { WorkItemGraphMaterializationProgress } from "../WorkItemGraphMaterializationProgress";

const root = { refType: "existing" as const, id: "root-id" };
const child = { refType: "temporary" as const, tempId: "child-id" };

const operations: WorkItemChangeSetOperation[] = [
  {
    op: "relationship.create",
    ref: { refType: "temporary", tempId: "flow-link" },
    source: root,
    target: child,
    edgeType: AgentEdgeType.Standard,
    category: AgentEdgeCategory.Flow,
  },
  {
    op: "relationship.create",
    ref: { refType: "temporary", tempId: "fulfillment-link" },
    source: child,
    target: root,
    edgeType: AgentEdgeType.FulfilledBy,
    category: AgentEdgeCategory.Meta,
  },
  {
    op: "relationship.create",
    ref: { refType: "temporary", tempId: "meta-link" },
    source: child,
    target: root,
    edgeType: AgentEdgeType.DependsOn,
    category: AgentEdgeCategory.Meta,
  },
];

const relationships: ProjectedWorkItemRelationship[] = operations.map(
  (operation, index) => {
    if (operation.op !== "relationship.create") {
      throw new Error("Fixture must contain relationship creation operations.");
    }
    return {
      identity: operation.ref,
      label: `Link ${index + 1}`,
      source: operation.source,
      target: operation.target,
      edgeType: operation.edgeType,
      category: operation.category,
      deleted: false,
    };
  },
);

const progress: WorkItemChangeSetMaterializationProgress = {
  state: WorkItemChangeSetMaterializationState.Prepared,
  attemptCount: 2,
  lastError: "Graph service was interrupted",
  diagnostic: {
    issues: [
      {
        field: "operations[1].target",
        code: "missing_reference",
        reason: "Target does not exist",
        layer: "referential",
      },
    ],
    issueCount: 1,
    truncated: false,
    correlationId: "correlation-1",
  },
  operations: operations.map((operation, operationIndex) => ({
    operationIndex,
    operationKind: operation.op,
    status:
      operationIndex === 0
        ? WorkItemChangeSetOperationProgressStatusEnum.Completed
        : operationIndex === 1
        ? WorkItemChangeSetOperationProgressStatusEnum.Failed
        : WorkItemChangeSetOperationProgressStatusEnum.Pending,
    attemptCount: operationIndex === 2 ? 0 : 1,
    lastError: operationIndex === 1 ? "Fulfillment write failed" : undefined,
  })),
};

describe("WorkItemGraphMaterializationProgress", () => {
  it("shows durable checkpoints and keeps relationship categories distinct", () => {
    render(
      <WorkItemGraphMaterializationProgress
        progress={progress}
        operations={operations}
        relationships={relationships}
      />,
    );

    expect(screen.getByText("Materialization paused")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 operations complete")).toBeInTheDocument();
    expect(
      screen.getByText("Graph service was interrupted"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Flow relationship/)).toBeInTheDocument();
    expect(screen.getByText(/Fulfillment relationship/)).toBeInTheDocument();
    expect(screen.getByText(/Meta relationship/)).toBeInTheDocument();
    expect(
      screen.getAllByTestId("work-item-graph-operation-checkpoint"),
    ).toHaveLength(3);
    expect(
      screen.getByTestId("proposal-failure-correlation"),
    ).toHaveTextContent("correlation-1");
  });
});
