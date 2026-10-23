import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type ProposalResponseDto,
  type WorkItemTypeDefinitionDto,
} from "../../../api";
import { useMentionExpansion } from "../../shared/MentionExpansionContext";
import { CreateProposal } from "../CreateProposal";
import { UpdateProposal } from "../UpdateProposal";

const ExpansionProbe: React.FC = () => {
  const { presentation } = useMentionExpansion();
  return <div data-testid="probe" data-presentation={presentation} />;
};

// Mock factories are hoisted, so they defer to the probe at render time.
vi.mock("../TaskCreateRenderer", () => ({
  TaskCreateRenderer: () => <ExpansionProbe />,
}));
vi.mock("../TaskUpdateRenderer", () => ({
  TaskUpdateRenderer: () => <ExpansionProbe />,
}));
vi.mock("../WorkflowProposalRenderer", () => ({
  WorkflowProposalRenderer: () => <ExpansionProbe />,
}));
vi.mock("../WorkItemGraphProposalRenderer", () => ({
  WorkItemGraphProposalRenderer: () => <ExpansionProbe />,
}));
vi.mock("../../InteractionComponent", () => ({
  InteractionComponent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("../useProposalState", () => ({
  useProposalState: () => ({
    getState: () => ({ state: "pending" }),
    applyItem: vi.fn(),
    rejectItem: vi.fn(),
  }),
}));
vi.mock("../../../data/hooks/useWorkItemTypeLifecycle", () => ({
  useMarkWorkItemTypeDataStale: () => vi.fn(),
}));

const definition = (
  key: string,
  kind?: "html/css" | "structured-mockup"
): WorkItemTypeDefinitionDto =>
  ({
    key,
    name: key,
    allowedStatuses: [],
    sections: [
      { key: "description", label: "Description" },
      ...(kind ? [{ key: "preview", label: "Preview", kind }] : []),
    ],
  }) as unknown as WorkItemTypeDefinitionDto;

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypes: () => ({
    workItemTypes: [
      { definition: definition("STANDARD") },
      { definition: definition("project_mockup", "structured-mockup") },
      { definition: definition("screen", "html/css") },
    ],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../useEntityData", () => ({
  useEntityData: (proposals: ProposalResponseDto[]) => ({
    entities: Object.fromEntries(
      proposals.map((proposal) => [
        proposal.targetEntityId,
        {
          type: "task",
          data: {
            id: proposal.targetEntityId,
            name: "Existing",
            type: (proposal.updates as { existingType: string }).existingType,
          },
        },
      ])
    ),
    loading: false,
    error: null,
  }),
}));

const proposal = (
  action: ProposalAction,
  updates: Record<string, unknown>
): ProposalResponseDto =>
  ({
    id: `proposal-${action}`,
    organizationId: "org-1",
    projectId: "project-1",
    type: ProposalType.Single,
    action,
    status: ProposalStatus.Pending,
    targetEntityId: "task-1",
    targetEntityType: TargetEntityType.Task,
    title: "Proposal",
    updates,
    requiredApprovals: 1,
    approvals: [],
    createdAt: "2026-10-11T00:00:00.000Z",
    updatedAt: "2026-10-11T00:00:00.000Z",
  }) as unknown as ProposalResponseDto;

const expansion = () =>
  screen.getByTestId("probe").getAttribute("data-presentation");

describe("proposal mention expansion", () => {
  it.each([
    ["structured-mockup", "project_mockup"],
    ["html/css", "screen"],
  ])(
    "renders mentions as badges in a CREATE proposal for a %s type",
    (_kind, type) => {
      render(
        <CreateProposal
          proposals={[
            proposal(ProposalAction.Create, { name: "Visual", type }),
          ]}
          onApply={vi.fn()}
        />
      );
      expect(expansion()).toBe("badge");
    }
  );

  it("renders mentions as badges in a proposal routed to the graph surface", () => {
    render(
      <CreateProposal
        proposals={[
          proposal(ProposalAction.Create, { name: "Flow", type: "workflow" }),
        ]}
        onApply={vi.fn()}
      />
    );
    expect(expansion()).toBe("badge");
  });

  it("keeps the default card presentation in a non-visual CREATE proposal", () => {
    render(
      <CreateProposal
        proposals={[
          proposal(ProposalAction.Create, {
            name: "Plain",
            type: "STANDARD",
            description: "See @[project_mockup:m-1|Checkout mockup]",
          }),
        ]}
        onApply={vi.fn()}
      />
    );
    expect(expansion()).toBe("card");
  });

  it("renders mentions as badges in an UPDATE proposal for a visual type", () => {
    render(
      <UpdateProposal
        proposals={[
          proposal(ProposalAction.Update, { existingType: "project_mockup" }),
        ]}
        onApply={vi.fn()}
        organizationId="org-1"
        projectId="project-1"
      />
    );
    expect(expansion()).toBe("badge");
  });

  it("keeps the default card presentation in a non-visual UPDATE proposal", () => {
    render(
      <UpdateProposal
        proposals={[
          proposal(ProposalAction.Update, { existingType: "STANDARD" }),
        ]}
        onApply={vi.fn()}
        organizationId="org-1"
        projectId="project-1"
      />
    );
    expect(expansion()).toBe("card");
  });

  it("defaults to the card presentation outside proposals", () => {
    render(<ExpansionProbe />);
    expect(expansion()).toBe("card");
  });
});
