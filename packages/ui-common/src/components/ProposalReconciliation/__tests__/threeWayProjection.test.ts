import { describe, expect, it } from "vitest";
import type {
  ProposalResponseDto,
  ProposalReconciliationState,
} from "../../../api";
import {
  projectThreeWayReview,
  threeWayFields,
  branchChange,
  equivalentContent,
} from "../threeWayProjection";
const proposal = {
  id: "selected",
  targetEntityId: "target",
  targetEntityType: "TASK",
  action: "UPDATE",
  status: "DRAFT",
} as ProposalResponseDto;
const state: ProposalReconciliationState = {
  status: "RECONCILIATION_REQUIRED",
  overlaps: [],
  conflictingPaths: [],
  interveningProposals: [],
  candidateRevisionId: "revision",
  currentBases: [
    {
      entityId: "target",
      entityType: "TASK",
      version: "live",
      content: { name: "Live" },
    },
  ],
  revisions: [
    {
      id: "revision",
      proposalId: "selected",
      source: "AUTHORING",
      createdAt: "2026-10-25T00:00:00Z",
      intent: null,
      bases: [
        {
          entityId: "target",
          entityType: "TASK",
          version: "original",
          content: { name: "Original" },
        },
      ],
      proposedResult: {
        name: "Intended",
        sections: [
          {
            key: "description",
            order: 0,
            materializedMarkdown: "Intended text",
          },
        ],
      },
    },
  ],
};
describe("retained three-way evidence", () => {
  it("normalizes retained sections against the same original", () => {
    const result = projectThreeWayReview(proposal, state);
    expect(result.original?.name).toBe("Original");
    expect(result.live?.name).toBe("Live");
    expect(result.intended?.sections).toEqual({ description: "Intended text" });
    expect(threeWayFields(result)).toEqual(["name", "sections.description"]);
  });
  it("does not select another proposal's pending replacement", () => {
    const pending = {
      ...state.revisions[0],
      id: "pending",
      proposalId: "pending",
      proposedResult: { name: "Pending" },
    };
    expect(
      projectThreeWayReview(proposal, {
        ...state,
        revisions: [...state.revisions, pending],
        candidateRevisionId: "pending",
      }).intended?.name,
    ).toBe("Intended");
  });
  it("selects the reviewed future through historical proposal links", () => {
    const future = {
      ...proposal,
      id: "historical",
      action: "VERSIONED_UPDATE",
      status: "APPROVED",
      reviewedFuture: {
        latestProposalId: "selected",
        baseline: { content: { name: "Retained future basis" } },
        result: { name: "Reviewed" },
      },
    } as ProposalResponseDto;
    expect(projectThreeWayReview(future, state)).toMatchObject({
      original: { name: "Retained future basis" },
      intended: { name: "Reviewed" },
    });
  });
  it("uses the accepted basis after renewed drift", () => {
    const accepted = {
      ...state.revisions[0],
      id: "accepted",
      source: "MANUAL" as const,
      previousRevisionId: "revision",
      bases: [
        { ...state.currentBases[0], content: { name: "Accepted basis" } },
      ],
    };
    expect(
      projectThreeWayReview(proposal, {
        ...state,
        revisions: [...state.revisions, accepted],
        candidateRevisionId: "accepted",
      }).original?.name,
    ).toBe("Accepted basis");
  });
  it("never invents missing original evidence or selects another target", () => {
    expect(
      projectThreeWayReview(proposal, { ...state, revisions: [] }).original,
    ).toBeUndefined();
    expect(
      projectThreeWayReview(proposal, {
        ...state,
        revisions: [
          {
            ...state.revisions[0],
            bases: [{ ...state.currentBases[0], entityId: "other" }],
          },
        ],
      }).original,
    ).toBeUndefined();
  });
  it("includes additions and removals without calling them conflicts", () => {
    expect(
      threeWayFields({
        original: { sections: { removed: "text" } },
        live: { sections: { removed: "text" } },
        intended: { sections: { added: "new" } },
      }),
    ).toEqual(["sections.removed", "sections.added"]);
    expect(branchChange(undefined, "new")).toBe("Added");
    expect(branchChange("old", undefined)).toBe("Removed");
    expect(branchChange("same", "same")).toBe("Unchanged");
  });
});

describe("storage-form equivalence", () => {
  const graph = (description: string, metadata: unknown) => ({
    projectedRoot: {
      identity: { refType: "existing", id: "diagram" },
      type: "DIAGRAM",
      name: "Diagram",
      sections: [
        { key: "graphLayout", content: "" },
        { key: "diagramMetadata", content: metadata },
      ],
    },
    children: [
      {
        identity: { refType: "existing", id: "element" },
        type: "DIAGRAM_ELEMENT",
        name: "Element",
        sections: [{ key: "description", content: description }],
      },
    ],
    incidentRelationships: [],
  });
  const basis = {
    nodes: {
      "existing:diagram": {
        type: "DIAGRAM",
        name: "Diagram",
        parent: null,
        status: null,
        priority: null,
        dueDate: null,
        assigneeId: null,
        tag: null,
        serviceIds: [],
        sections: { diagramMetadata: { kind: "PROCESS", level: "OVERVIEW" } },
      },
      "existing:element": {
        type: "DIAGRAM_ELEMENT",
        name: "Element",
        parent: null,
        status: null,
        priority: null,
        dueDate: null,
        assigneeId: null,
        tag: null,
        serviceIds: [],
        sections: { description: "Reviewed" },
      },
    },
    relationships: {},
  };
  // The partly applied staging future: live already holds the reviewed result in other storage forms.
  const original = {
    sections: {
      description: "Before",
      graphLayout: null,
      diagramMetadata: '{"kind":"PROCESS","level":"OVERVIEW"}',
    },
    graph: graph("Before", '{"kind":"PROCESS","level":"OVERVIEW"}'),
  };
  const live = {
    sections: {
      description: "After",
      graphLayout: null,
      diagramMetadata: { kind: "PROCESS", level: "OVERVIEW" },
    },
    graph: basis,
  };
  const intended = {
    sections: {
      description: "After",
      graphLayout: "",
      diagramMetadata: '{ "kind": "PROCESS", "level": "OVERVIEW" }',
    },
    graph: graph("Reviewed", '{"kind":"PROCESS","level":"OVERVIEW"}'),
  };

  it("does not count null versus '' or JSON text versus object as a change", () => {
    expect(branchChange(null, "")).toBe("Unchanged");
    expect(branchChange('{"kind":"PROCESS"}', { kind: "PROCESS" })).toBe(
      "Unchanged",
    );
    expect(branchChange(null, "text")).toBe("Added");
    expect(branchChange("text", "")).toBe("Removed");
    expect(threeWayFields({ original, live, intended })).toEqual([
      "graph",
      "sections.description",
    ]);
  });

  it("compares a reviewed graph projection with the live graph basis", () => {
    expect(equivalentContent(intended.graph, live.graph)).toBe(true);
    expect(equivalentContent(original.graph, live.graph)).toBe(false);
  });
});
