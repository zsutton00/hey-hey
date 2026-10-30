import {
  buildWorkflowGraphModel,
  projectWorkItemGraphForWorkflowSurface,
} from "../../shared/WorkflowMentionInlineRenderer";
import { describe, expect, it } from "vitest";
import {
  ProposalAction,
  ProposalGroupLifecycle,
  ProposalGroupMemberExecutionState,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  WorkItemTypeRole,
  type ProposalGroupMemberSnapshot,
  type ProposalGroupSnapshot,
  type ProposalResponseDto,
  type WorkItemTypeDefinitionDto,
} from "../../../api";
import {
  projectCanonicalProposalGroupGraph,
  resolveCanonicalProposalGroupRootDefinition,
} from "../canonicalProposalGroupGraph";

const diagramDefinition: WorkItemTypeDefinitionDto = {
  key: "DIAGRAM",
  name: "Diagram",
  role: WorkItemTypeRole.ProjectInfo,
  sections: [
    {
      key: "layout",
      kind: "json",
      schemaRef: "work-item-graph-layout.v1",
    },
  ],
  allowedStatuses: [],
  capabilities: {
    graph: {
      nodeChildType: "DIAGRAM_ELEMENT",
      layout: {
        sectionKey: "layout",
        schemaRef: "work-item-graph-layout.v1",
      },
      layoutPreference: {
        sectionKey: "layoutPreference",
        schemaRef: "work-item-graph-layout-preference.v1",
      },
      readableRelationships: [],
      editableRelationships: [],
      rendererKey: "work-item-graph",
      editorKey: "work-item-graph-editor",
      supportedActions: [],
    },
  },
};

const proposal = (
  id: string,
  title: string,
  updates: ProposalResponseDto["updates"],
): ProposalResponseDto => ({
  id,
  organizationId: "org-1",
  projectId: "project-1",
  type: ProposalType.Single,
  action: ProposalAction.Create,
  status: ProposalStatus.Draft,
  targetEntityId: "00000000-0000-0000-0000-000000000000",
  targetEntityType: TargetEntityType.Task,
  title,
  updates,
  requestorId: "user-1",
  requiredApprovals: 1,
  approvals: [],
  createdAt: "2026-09-20T00:00:00.000Z",
  updatedAt: "2026-09-20T00:00:00.000Z",
});

const member = (
  memberId: string,
  memberOrder: number,
  reservedEntityId: string,
  memberProposal: ProposalResponseDto,
): ProposalGroupMemberSnapshot => ({
  memberId,
  memberOrder,
  reservedEntityId,
  proposal: memberProposal,
  approvalProgress: {
    receivedApprovals: 0,
    requiredApprovals: 1,
    approvalSatisfied: false,
  },
  executionState: ProposalGroupMemberExecutionState.PendingApproval,
  dependencies: [],
  terminalTimestamps: {
    appliedAt: null,
    rejectedAt: null,
    invalidatedAt: null,
    failedAt: null,
  },
});

const root = member(
  "root-member",
  0,
  "diagram-id",
  proposal("root-proposal", "Disposable Two-Element Test Diagram", {
    name: "Disposable Two-Element Test Diagram",
    type: "DIAGRAM",
    sections: [
      {
        key: "layout",
        content: {
          schemaVersion: "work-item-graph-layout.v1",
          nodes: [
            {
              node: { refType: "existing", id: "element-a-id" },
              position: { x: 10, y: 20 },
            },
            {
              node: { refType: "existing", id: "element-b-id" },
              position: { x: 210, y: 20 },
            },
          ],
        },
      },
    ],
  }),
);
const elementA = member(
  "element-a-member",
  1,
  "element-a-id",
  proposal("element-a-proposal", "Test Element A", {
    name: "Test Element A",
    type: "DIAGRAM_ELEMENT",
    parentTaskId: "diagram-id",
  }),
);
const elementB = member(
  "element-b-member",
  2,
  "element-b-id",
  proposal("element-b-proposal", "Test Element B", {
    name: "Test Element B",
    type: "DIAGRAM_ELEMENT",
    parentTaskId: "diagram-id",
  }),
);

const group: ProposalGroupSnapshot = {
  groupId: "group-1",
  organizationId: "org-1",
  projectId: "project-1",
  lifecycle: ProposalGroupLifecycle.Reviewable,
  currentRevision: 1,
  frozenRevision: 1,
  members: [root, elementA, elementB],
  dependencies: [
    {
      dependentMemberId: "element-a-member",
      prerequisiteMemberId: "root-member",
    },
    {
      dependentMemberId: "element-b-member",
      prerequisiteMemberId: "root-member",
    },
  ],
  createdAt: "2026-09-20T00:00:00.000Z",
  updatedAt: "2026-09-20T00:00:00.000Z",
};

describe("projectCanonicalProposalGroupGraph", () => {
  it("renders a frozen graph-operation journey using its canonical proposed screen", () => {
    const screen = member(
      "screen-member",
      1,
      "screen-id",
      proposal("screen-proposal", "Screen", {
        name: "Screen",
        type: "mockup",
        sections: [{ key: "mockup", content: "frozen design" }],
      }),
    );
    const journey = member(
      "journey-member",
      0,
      "journey-id",
      proposal("journey-proposal", "Journey", {
        root: { refType: "temporary", tempId: "journey" },
        operations: [
          {
            op: "workItem.create",
            ref: { refType: "temporary", tempId: "journey" },
            name: "Journey",
            type: "DIAGRAM",
          },
          {
            op: "workItem.create",
            ref: { refType: "temporary", tempId: "screen-element" },
            parent: { refType: "temporary", tempId: "journey" },
            name: "First screen",
            type: "DIAGRAM_ELEMENT",
          },
          {
            op: "section.replace",
            ref: { refType: "temporary", tempId: "screen-element" },
            key: "diagramElementMetadata",
            content: {
              role: "GENERIC",
              canonicalReference: { entityType: "TASK", entityId: "screen-id" },
            },
          },
        ],
      }),
    );
    screen.executionState = ProposalGroupMemberExecutionState.Rejected;
    const snapshot = { ...group, members: [journey, screen], dependencies: [] };
    const root = resolveCanonicalProposalGroupRootDefinition(snapshot, [
      diagramDefinition,
    ]);
    expect(root.kind).toBe("resolved");
    const result = projectCanonicalProposalGroupGraph(
      snapshot,
      diagramDefinition,
    );
    if (result.kind !== "ready") {
      throw new Error("Expected the complete frozen journey");
    }
    const surface = projectWorkItemGraphForWorkflowSurface(result.projection, {
      organizationId: "org-1",
      projectId: "project-1",
    });
    const model = buildWorkflowGraphModel(surface);
    expect(model.nodes[0].data.projectedReferenceTarget).toEqual({
      type: "mockup",
      name: "Screen",
      sections: [{ key: "mockup", content: "frozen design" }],
    });
    expect(surface.steps).toHaveLength(1);
    expect(surface.edges).toHaveLength(0);
  });

  it("preserves triggering actions and outcomes through the screen preview boundary", () => {
    const projection = projectCanonicalProposalGroupGraph(
      group,
      diagramDefinition,
    );
    if (projection.kind !== "ready") {
      throw new Error("Expected Diagram projection");
    }
    projection.projection.incidentRelationships = [
      {
        identity: { refType: "temporary", tempId: "transition" },
        label: "CONDITIONAL",
        source: { refType: "existing", id: "element-a-id" },
        target: { refType: "existing", id: "element-b-id" },
        edgeType: "CONDITIONAL",
        category: "flow",
        direction: "forward",
        predicate: "Payment accepted",
        actionLabel: "Place order",
        deleted: false,
      },
    ];
    const surface = projectWorkItemGraphForWorkflowSurface(
      projection.projection,
      { organizationId: "org-1", projectId: "project-1" },
    );
    expect(surface.edges[0].actionLabel).toBe("Place order");
    expect(surface.edges[0].predicate).toBe("Payment accepted");
  });

  it("retains frozen screen content outside the Diagram hierarchy after rejection", () => {
    const screen = member(
      "screen-member",
      3,
      "screen-id",
      proposal("screen-proposal", "Screen", {
        name: "Screen",
        type: "mockup",
        sections: [{ key: "mockup", content: "frozen design" }],
      }),
    );
    screen.proposal.status = ProposalStatus.Rejected;
    const result = projectCanonicalProposalGroupGraph(
      { ...group, members: [...group.members, screen] },
      diagramDefinition,
    );

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") {
      throw new Error("Expected a reviewable projection");
    }

    expect(result.projection.projectedReferenceTargets?.["screen-id"]).toEqual({
      type: "mockup",
      name: "Screen",
      sections: [{ key: "mockup", content: "frozen design" }],
    });
    expect(result.projection.children.map(({ name }) => name)).toEqual([
      "Test Element A",
      "Test Element B",
    ]);
    expect(result.projection.incidentRelationships).toEqual([]);
  });

  it("projects both dependency-qualified Diagram Elements without inventing an edge", () => {
    const result = projectCanonicalProposalGroupGraph(group, diagramDefinition);

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.memberIds).toEqual([
      "root-member",
      "element-a-member",
      "element-b-member",
    ]);
    expect(result.projection.children.map(({ name }) => name)).toEqual([
      "Test Element A",
      "Test Element B",
    ]);
    expect(result.projection.incidentRelationships).toEqual([]);
    expect(result.projection.effectiveLayout.nodes).toEqual([
      {
        node: { refType: "existing", id: "element-a-id" },
        position: { x: 10, y: 20 },
      },
      {
        node: { refType: "existing", id: "element-b-id" },
        position: { x: 210, y: 20 },
      },
    ]);
  });

  it("excludes children whose prerequisite closure does not reach the root", () => {
    const result = projectCanonicalProposalGroupGraph(
      { ...group, dependencies: group.dependencies.slice(0, 1) },
      diagramDefinition,
    );

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.projection.children.map(({ name }) => name)).toEqual([
      "Test Element A",
    ]);
  });

  it("fails closed when the registry definition does not authorize the renderer", () => {
    const unauthorizedDefinition: WorkItemTypeDefinitionDto = {
      ...diagramDefinition,
      capabilities: {
        graph: {
          ...diagramDefinition.capabilities!.graph!,
          rendererKey: "unsupported-renderer",
        },
      },
    };

    expect(
      projectCanonicalProposalGroupGraph(group, unauthorizedDefinition),
    ).toEqual({
      kind: "unavailable",
      reason: "Graph rendering is unavailable for this work-item type.",
    });
  });

  it("resolves the root only from a registry-authorized graph definition", () => {
    expect(
      resolveCanonicalProposalGroupRootDefinition(group, [diagramDefinition]),
    ).toEqual({ kind: "resolved", definition: diagramDefinition });
    expect(resolveCanonicalProposalGroupRootDefinition(group, [])).toEqual({
      kind: "unavailable",
      reason: "Graph rendering is unavailable for this proposal group.",
    });
  });
});
