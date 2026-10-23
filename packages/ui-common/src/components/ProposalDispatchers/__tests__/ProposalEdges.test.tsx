import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  type ProposalResponseDto,
  type ProposalEdgeDeclaration,
  ProposalEdgeTargetType,
  ProposalEdgeType,
  ProposalStatus,
  ProposalAction,
  TargetEntityType,
  ProposalType,
} from "../../../api";
import {
  ProposalEdges as ProposalEdgesComponent,
  edgeTypeLabel,
  type ProposalEdgesProps,
} from "../ProposalEdges";

const ProposalEdges = (
  props: Omit<ProposalEdgesProps, "organizationId" | "projectId">
) => (
  <MemoryRouter>
    <ProposalEdgesComponent
      {...props}
      organizationId="org-1"
      projectId="project-1"
    />
  </MemoryRouter>
);

const makeProposal = (
  overrides: Partial<ProposalResponseDto> = {}
): ProposalResponseDto => ({
  id: "proposal-1",
  organizationId: "org-1",
  projectId: "proj-1",
  type: ProposalType.Single,
  action: ProposalAction.Create,
  status: ProposalStatus.Pending,
  targetEntityId: "entity-1",
  targetEntityType: TargetEntityType.Task,
  updates: { name: "Task A" } as never,
  requestorId: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

const makeEdge = (
  overrides: Partial<ProposalEdgeDeclaration> = {}
): ProposalEdgeDeclaration => ({
  targetEntityId: "proposal-2",
  targetEntityType: ProposalEdgeTargetType.Proposal,
  edgeType: ProposalEdgeType.DependsOn,
  ...overrides,
});

describe("edgeTypeLabel", () => {
  it("returns human-readable labels", () => {
    expect(edgeTypeLabel(ProposalEdgeType.DependsOn)).toBe("depends on");
    expect(edgeTypeLabel(ProposalEdgeType.Blocks)).toBe("blocks");
    expect(edgeTypeLabel(ProposalEdgeType.RelatedTo)).toBe("relates to");
  });

  it("returns 'evolves' for the EVOLVES edge type", () => {
    expect(edgeTypeLabel("EVOLVES")).toBe("evolves");
  });

  it("uses a general relationship label for unknown edge types", () => {
    expect(edgeTypeLabel("FUTURE_TYPE" as ProposalEdgeType)).toBe("relates to");
  });
});

describe("ProposalEdges", () => {
  it("returns null when edges is undefined", () => {
    const { container } = render(
      <ProposalEdges edges={undefined} siblingProposals={new Map()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("returns null when edges is empty", () => {
    const { container } = render(
      <ProposalEdges edges={[]} siblingProposals={new Map()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders edge type label and target proposal title", () => {
    const target = makeProposal({
      id: "proposal-2",
      updates: { name: "Setup Database" } as never,
    });
    const siblings = new Map([["proposal-2", target]]);

    render(<ProposalEdges edges={[makeEdge()]} siblingProposals={siblings} />);

    expect(screen.getByText("depends on")).toBeInTheDocument();
    expect(screen.getByText("Setup Database")).toBeInTheDocument();
    expect(screen.getByText("Relationships")).toBeInTheDocument();
  });

  it("uses targetEntityTitle from the edge when present", () => {
    render(
      <ProposalEdges
        edges={[
          makeEdge({
            targetEntityId: "1aa2e588-60a9-482b-ac18-ca36be753234",
            targetEntityType: ProposalEdgeTargetType.Task,
            targetEntityTitle: "Project membership endpoints",
            edgeType: ProposalEdgeType.RelatedTo,
          }),
        ]}
        siblingProposals={new Map()}
      />
    );

    expect(
      screen.getByText("Project membership endpoints")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("1aa2e588-60a9-482b-ac18-ca36be753234")
    ).not.toBeInTheDocument();
  });

  it("prefers targetEntityTitle over sibling proposal name", () => {
    const target = makeProposal({
      id: "proposal-2",
      updates: { name: "Stale sibling name" } as never,
    });
    const siblings = new Map([["proposal-2", target]]);

    render(
      <ProposalEdges
        edges={[makeEdge({ targetEntityTitle: "Snapshot title" })]}
        siblingProposals={siblings}
      />
    );

    expect(screen.getByText("Snapshot title")).toBeInTheDocument();
    expect(screen.queryByText("Stale sibling name")).not.toBeInTheDocument();
  });

  it("uses an unavailable state when target is not found in siblings", () => {
    render(
      <ProposalEdges
        edges={[makeEdge({ targetEntityId: "unknown-id" })]}
        siblingProposals={new Map()}
      />
    );

    expect(
      screen.getByText("Related proposal unavailable")
    ).toBeInTheDocument();
    expect(screen.queryByText("unknown-id")).not.toBeInTheDocument();
  });

  it("uses the target proposal's readable fallback when it has no name", () => {
    const target = makeProposal({
      id: "proposal-2",
      updates: { status: "ACTIVE" } as never,
    });
    const siblings = new Map([["proposal-2", target]]);

    render(<ProposalEdges edges={[makeEdge()]} siblingProposals={siblings} />);

    expect(screen.getByText("Create Task")).toBeInTheDocument();
    expect(screen.queryByText("proposal-2")).not.toBeInTheDocument();
  });

  it("renders optional description", () => {
    const target = makeProposal({ id: "proposal-2" });
    const siblings = new Map([["proposal-2", target]]);

    render(
      <ProposalEdges
        edges={[makeEdge({ description: "needed for schema setup" })]}
        siblingProposals={siblings}
      />
    );

    expect(screen.getByText(/needed for schema setup/)).toBeInTheDocument();
  });

  it("does not show status chips when ownerApplied is false", () => {
    const target = makeProposal({
      id: "proposal-2",
      status: ProposalStatus.Approved,
    });
    const siblings = new Map([["proposal-2", target]]);

    render(
      <ProposalEdges
        edges={[makeEdge()]}
        siblingProposals={siblings}
        ownerApplied={false}
      />
    );

    expect(screen.queryByText("Resolved")).not.toBeInTheDocument();
    expect(screen.queryByText("Waiting")).not.toBeInTheDocument();
  });

  it("shows materialized status when owner applied and target approved", () => {
    const target = makeProposal({
      id: "proposal-2",
      status: ProposalStatus.Approved,
    });
    const siblings = new Map([["proposal-2", target]]);

    render(
      <ProposalEdges
        edges={[makeEdge()]}
        siblingProposals={siblings}
        ownerApplied
      />
    );

    expect(screen.getByRole("img", { name: "Resolved" })).toBeVisible();
    expect(screen.queryByText("Resolved")).not.toBeInTheDocument();
  });

  it("shows pending status when owner applied and target still pending", () => {
    const target = makeProposal({
      id: "proposal-2",
      status: ProposalStatus.Pending,
    });
    const siblings = new Map([["proposal-2", target]]);

    render(
      <ProposalEdges
        edges={[makeEdge()]}
        siblingProposals={siblings}
        ownerApplied
      />
    );

    expect(screen.getByText("Waiting")).toBeInTheDocument();
  });

  it("shows cancelled status when owner applied and target rejected", () => {
    const target = makeProposal({
      id: "proposal-2",
      status: ProposalStatus.Rejected,
    });
    const siblings = new Map([["proposal-2", target]]);

    render(
      <ProposalEdges
        edges={[makeEdge()]}
        siblingProposals={siblings}
        ownerApplied
      />
    );

    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });

  it("renders multiple edges", () => {
    const target1 = makeProposal({
      id: "proposal-2",
      updates: { name: "Task B" } as never,
    });
    const target2 = makeProposal({
      id: "proposal-3",
      updates: { name: "Task C" } as never,
    });
    const siblings = new Map([
      ["proposal-2", target1],
      ["proposal-3", target2],
    ]);

    render(
      <ProposalEdges
        edges={[
          makeEdge({
            targetEntityId: "proposal-2",
            edgeType: ProposalEdgeType.DependsOn,
          }),
          makeEdge({
            targetEntityId: "proposal-3",
            edgeType: ProposalEdgeType.Blocks,
          }),
        ]}
        siblingProposals={siblings}
      />
    );

    expect(screen.getByText("depends on")).toBeInTheDocument();
    expect(screen.getByText("blocks")).toBeInTheDocument();
    expect(screen.getByText("Task B")).toBeInTheDocument();
    expect(screen.getByText("Task C")).toBeInTheDocument();
  });

  it("calls onNavigateToEntity for materialized edges", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const target = makeProposal({
      id: "proposal-2",
      status: ProposalStatus.Approved,
      targetEntityId: "real-entity-id",
      targetEntityType: TargetEntityType.Task,
      updates: { name: "Linked Task" } as never,
    });
    const siblings = new Map([["proposal-2", target]]);

    render(
      <ProposalEdges
        edges={[makeEdge()]}
        siblingProposals={siblings}
        ownerApplied
        onNavigateToEntity={onNavigate}
      />
    );

    await user.click(screen.getByText("Linked Task"));
    expect(onNavigate).toHaveBeenCalledWith("TASK", "real-entity-id");
  });

  it("treats entity-typed edges as materialized and navigates on click", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(
      <ProposalEdges
        edges={[
          makeEdge({
            targetEntityId: "existing-task-1",
            targetEntityType: ProposalEdgeTargetType.Task,
          }),
        ]}
        siblingProposals={new Map()}
        ownerApplied
        onNavigateToEntity={onNavigate}
      />
    );

    expect(screen.getByRole("img", { name: "Resolved" })).toBeVisible();
    expect(screen.queryByText("Resolved")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("link", { name: "Task name unavailable" })
    );
    expect(onNavigate).toHaveBeenCalledWith("TASK", "existing-task-1");
  });

  it("renders a direct task target with its snapshot title and canonical link", () => {
    render(
      <ProposalEdges
        edges={[
          makeEdge({
            targetEntityId: "task-target-1",
            targetEntityType: ProposalEdgeTargetType.Task,
            targetEntityTitle: "Searchable Activity",
          }),
        ]}
        siblingProposals={new Map()}
      />
    );

    expect(screen.getByText("Searchable Activity")).toBeInTheDocument();
    expect(screen.queryByText("task-target-1")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Searchable Activity" })
    ).toHaveAttribute("href", "/projects/project-1/tasks/task-target-1");
  });

  it("uses the canonical design-doc route for a design-doc target", () => {
    render(
      <ProposalEdges
        edges={[
          makeEdge({
            targetEntityId: "design-doc-target-1",
            targetEntityType: ProposalEdgeTargetType.DesignDoc,
            targetEntityTitle: "Activity design",
          }),
        ]}
        siblingProposals={new Map()}
      />
    );

    expect(
      screen.getByRole("link", { name: "Activity design" })
    ).toHaveAttribute(
      "href",
      "/projects/project-1/design-docs/design-doc-target-1"
    );
  });

  it("uses an approved sibling proposal's resolved entity identity for the preview", () => {
    const target = makeProposal({
      id: "proposal-2",
      status: ProposalStatus.Approved,
      targetEntityId: "resolved-design-doc-1",
      targetEntityType: TargetEntityType.DesignDoc,
      updates: { name: "Stale proposal name" } as never,
    });

    render(
      <ProposalEdges
        edges={[
          makeEdge({
            targetEntityTitle: "Snapshot design title",
          }),
        ]}
        siblingProposals={new Map([[target.id, target]])}
        ownerApplied
      />
    );

    expect(screen.getByText("Snapshot design title")).toBeInTheDocument();
    expect(screen.queryByText("resolved-design-doc-1")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Snapshot design title" })
    ).toHaveAttribute(
      "href",
      "/projects/project-1/design-docs/resolved-design-doc-1"
    );
  });

  it("keeps a pending sibling proposal preview non-interactive", () => {
    const target = makeProposal({
      id: "proposal-2",
      status: ProposalStatus.Pending,
      targetEntityId: "unresolved-task-1",
      targetEntityType: TargetEntityType.Task,
      updates: { name: "Pending task" } as never,
    });

    render(
      <ProposalEdges
        edges={[makeEdge({ targetEntityTitle: "Pending task" })]}
        siblingProposals={new Map([[target.id, target]])}
        ownerApplied
      />
    );

    expect(screen.getByText("Pending task")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Pending task" })
    ).not.toBeInTheDocument();
    expect(screen.queryByText("proposal-2")).not.toBeInTheDocument();
  });

  it("does not navigate for pending edges", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const target = makeProposal({
      id: "proposal-2",
      status: ProposalStatus.Pending,
      updates: { name: "Pending Task" } as never,
    });
    const siblings = new Map([["proposal-2", target]]);

    render(
      <ProposalEdges
        edges={[makeEdge()]}
        siblingProposals={siblings}
        ownerApplied
        onNavigateToEntity={onNavigate}
      />
    );

    await user.click(screen.getByText("Pending Task"));
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
