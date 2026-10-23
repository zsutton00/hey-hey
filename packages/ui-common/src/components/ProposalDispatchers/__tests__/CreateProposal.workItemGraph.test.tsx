import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  WorkItemChangeSetMaterializationState,
  type ProposalResponseDto,
} from "../../../api";
import type { ProposalItemStatus } from "../types";
import { CreateProposal } from "../CreateProposal";

vi.mock("../WorkItemGraphProposalRenderer", () => ({
  WorkItemGraphProposalRenderer: ({
    proposal,
    status,
  }: {
    proposal: ProposalResponseDto;
    status: ProposalItemStatus;
  }) => (
    <div
      data-testid="work-item-graph-create-renderer"
      data-proposal-state={status.state}
    >
      {proposal.title}
    </div>
  ),
}));

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypes: () => ({ workItemTypes: [], isLoading: false, error: null }),
  useWorkItemTypeTrackingEligibility: () => ({
    isAllowed: true,
    isReady: true,
    isLoading: false,
    error: null,
  }),
  useWorkItemTypeByKey: () => ({
    workItemTypeDefinition: undefined,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../../../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

describe("CreateProposal — work-item graph routing", () => {
  it("routes a structural CREATE graph envelope through the shared renderer", () => {
    const proposal: ProposalResponseDto = {
      id: "proposal-diagram-create",
      organizationId: "org-1",
      projectId: "project-1",
      type: ProposalType.Single,
      action: ProposalAction.Create,
      status: ProposalStatus.Pending,
      targetEntityId: "00000000-0000-0000-0000-000000000000",
      targetEntityType: TargetEntityType.Task,
      title: "Create architecture diagram",
      updates: {
        root: { refType: "temporary", tempId: "diagram-root" },
        operations: [
          {
            op: "workItem.create",
            ref: { refType: "temporary", tempId: "diagram-root" },
            name: "Architecture diagram",
            type: "DIAGRAM",
          },
          {
            op: "workItem.create",
            ref: { refType: "temporary", tempId: "diagram-element" },
            name: "API",
            type: "DIAGRAM_ELEMENT",
            parent: { refType: "temporary", tempId: "diagram-root" },
          },
        ],
      },
      requestorId: "user-1",
      requiredApprovals: 1,
      approvals: [],
      createdAt: "2026-09-20T00:00:00.000Z",
      updatedAt: "2026-09-20T00:00:00.000Z",
    };

    render(
      <MemoryRouter>
        <CreateProposal
          proposals={[proposal]}
          onApply={async () => undefined}
        />
      </MemoryRouter>
    );

    expect(
      screen.getByTestId("work-item-graph-create-renderer")
    ).toHaveTextContent("Create architecture diagram");
  });

  it("uses materialization progress as the CREATE graph lifecycle authority", () => {
    const proposal: ProposalResponseDto = {
      id: "proposal-diagram-create",
      organizationId: "org-1",
      projectId: "project-1",
      type: ProposalType.Single,
      action: ProposalAction.Create,
      status: ProposalStatus.Approved,
      targetEntityId: "diagram-id",
      targetEntityType: TargetEntityType.Task,
      title: "Create architecture diagram",
      updates: {
        root: { refType: "temporary", tempId: "diagram-root" },
        operations: [
          {
            op: "workItem.create",
            ref: { refType: "temporary", tempId: "diagram-root" },
            name: "Architecture diagram",
            type: "DIAGRAM",
          },
        ],
      },
      materialization: {
        state: WorkItemChangeSetMaterializationState.Applying,
        attemptCount: 1,
        operations: [],
      },
      requestorId: "user-1",
      requiredApprovals: 1,
      approvals: [],
      createdAt: "2026-09-20T00:00:00.000Z",
      updatedAt: "2026-09-20T00:00:00.000Z",
    };

    render(
      <MemoryRouter>
        <CreateProposal
          proposals={[proposal]}
          onApply={async () => undefined}
        />
      </MemoryRouter>
    );

    expect(
      screen.getByTestId("work-item-graph-create-renderer")
    ).toHaveAttribute("data-proposal-state", "applying");
  });
});
