import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentEdgeCategory,
  AgentEdgeEndpointEntityType,
  AgentEdgeType,
  EntityType,
  WorkItemTypeGraphEndpointRole,
} from "../../../api";
import { WorkItemGraphMetaLinkDialog } from "../WorkItemGraphMetaLinkDialog";

const mockSearch = vi.hoisted(() => vi.fn());

vi.mock("../../../data/hooks/useWorkItemGraphMetaLinkSearch", async () => {
  const actual = await vi.importActual<
    typeof import("../../../data/hooks/useWorkItemGraphMetaLinkSearch")
  >("../../../data/hooks/useWorkItemGraphMetaLinkSearch");
  return { ...actual, useWorkItemGraphMetaLinkSearch: mockSearch };
});

const declaration = {
  edgeType: AgentEdgeType.RelatedTo,
  category: AgentEdgeCategory.Meta,
  sourceEndpoint: {
    role: WorkItemTypeGraphEndpointRole.GraphNode,
    entityTypes: [AgentEdgeEndpointEntityType.Task],
  },
  targetEndpoint: {
    role: WorkItemTypeGraphEndpointRole.ExternalEntity,
    entityTypes: [AgentEdgeEndpointEntityType.Task],
  },
};

describe("WorkItemGraphMetaLinkDialog", () => {
  beforeEach(() => {
    mockSearch.mockReturnValue({
      status: "idle",
      reason: "empty-query",
      results: [],
      isLoading: false,
      isSelectable: false,
      error: null,
    });
  });

  it("distinguishes omitted explanations from explicit clears and preserves unrelated metadata", () => {
    const onCommit = vi.fn();
    const relationship = {
      identity: { refType: "existing" as const, id: "relationship-id" },
      label: "Contract",
      source: { refType: "existing" as const, id: "source-id" },
      target: { refType: "existing" as const, id: "target-id" },
      edgeType: AgentEdgeType.RelatedTo,
      category: AgentEdgeCategory.Meta,
      reasoning: "Existing reason",
      metadata: {
        label: "Existing label",
        description: "Existing description",
        custom: { preserved: true },
      },
      deleted: false,
    };

    const { rerender } = render(
      <WorkItemGraphMetaLinkDialog
        open
        organizationId="organization-id"
        projectId="project-id"
        sourceChild={relationship.source}
        relationshipDeclaration={declaration}
        searchTarget={{
          edgeType: AgentEdgeType.RelatedTo,
          targetEntityTypes: [AgentEdgeEndpointEntityType.Task],
        }}
        existingTargets={[]}
        relationship={relationship}
        onCancel={vi.fn()}
        onCommit={onCommit}
      />
    );

    fireEvent.click(screen.getByTestId("work-item-graph-meta-commit"));
    expect(onCommit).toHaveBeenLastCalledWith({
      target: {
        identity: relationship.target,
        entityType: EntityType.Task,
        title: "Contract",
        workItemTypeKey: "",
      },
    });

    rerender(
      <WorkItemGraphMetaLinkDialog
        open
        organizationId="organization-id"
        projectId="project-id"
        sourceChild={relationship.source}
        relationshipDeclaration={declaration}
        searchTarget={{
          edgeType: AgentEdgeType.RelatedTo,
          targetEntityTypes: [AgentEdgeEndpointEntityType.Task],
        }}
        existingTargets={[]}
        relationship={relationship}
        onCancel={vi.fn()}
        onCommit={onCommit}
      />
    );
    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByTestId("work-item-graph-meta-commit"));

    expect(onCommit).toHaveBeenLastCalledWith({
      target: {
        identity: relationship.target,
        entityType: EntityType.Task,
        title: "Contract",
        workItemTypeKey: "",
      },
      reasoning: null,
      metadata: {
        label: null,
        description: "Existing description",
        custom: { preserved: true },
      },
    });
  });
});
