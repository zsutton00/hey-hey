import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type ProposalResponseDto,
  type TaskResponseDto,
  type WorkItemTypeDefinitionDto,
} from "../../../api";
import { getProposalRenderOverrides } from "../proposalRenderOverrides";
import { ProposalStateIndicator } from "../ProposalStateIndicator";
import { UpdateProposal } from "../UpdateProposal";

const { getTask } = vi.hoisted(() => ({ getTask: vi.fn() }));

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: { getTask, getDesignDoc: vi.fn() },
}));

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypes: () => ({
    workItemTypes: [
      {
        definition: {
          key: "mockup",
          name: "Mockup",
          sections: [],
          allowedStatuses: [],
        } as WorkItemTypeDefinitionDto,
        status: "ACTIVE",
        projectId: "project-1",
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../../../data/hooks/useWorkItemTypeLifecycle", () => ({
  useMarkWorkItemTypeDataStale: () => vi.fn(),
}));

// The renderer shows the "before" it was given and the shared state control,
// so the test sees both what the diff is built from and which controls show.
vi.mock("../TaskUpdateRenderer", async () => {
  const { ProposalStateIndicator: Indicator } = await vi.importActual<
    typeof import("../ProposalStateIndicator")
  >("../ProposalStateIndicator");
  return {
    TaskUpdateRenderer: ({
      existing,
      onApply,
      onReject,
    }: {
      existing: TaskResponseDto;
      onApply: () => void;
      onReject?: (reason: string) => Promise<void>;
    }) => (
      <div>
        <div data-testid="diff-before">{existing.name}</div>
        <div data-testid="diff-before-section">
          {existing.sections?.[0]?.materializedMarkdown}
        </div>
        <Indicator
          status={{ state: "pending" }}
          action={ProposalAction.Update}
          onApply={onApply}
          onReject={onReject}
        />
      </div>
    ),
  };
});

vi.mock("../../InteractionComponent", () => ({
  InteractionComponent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

const evalProposal = (
  retained: Record<string, unknown> | null,
): ProposalResponseDto =>
  ({
    id: "proposal-1",
    organizationId: "org-1",
    projectId: "project-1",
    type: ProposalType.Single,
    action: ProposalAction.Update,
    status: ProposalStatus.Pending,
    targetEntityId: "mockup-1",
    targetEntityType: TargetEntityType.Task,
    updates: { name: "Plan Page with effort" },
    requestorId: "user-1",
    requiredApprovals: 1,
    approvals: [],
    applicationEligible: false,
    ragEnabled: false,
    retainedOriginalTargetContent: retained,
    createdAt: "2026-10-22T00:00:00Z",
    updatedAt: "2026-10-22T00:00:00Z",
  }) as ProposalResponseDto;

// Stored as the API captures it: only the changed paths, keyed like proposal
// history, not a whole entity.
const retainedMockup = {
  name: "Plan Page as the attempt saw it",
  "sections.description.content": "Description as the attempt saw it",
};

const liveMockup = {
  id: "mockup-1",
  name: "Plan Page edited since",
  type: "mockup",
  organizationId: "org-1",
  projectId: "project-1",
  sections: [{ key: "description", materializedMarkdown: "Edited since" }],
};

beforeEach(() => {
  getTask.mockReset();
  getTask.mockResolvedValue({
    data: { data: liveMockup },
  });
});

describe("evaluation-output proposal mode", () => {
  it("adds the evaluation override without hiding the card", () => {
    expect(
      getProposalRenderOverrides(TargetEntityType.Task, "evaluation-output"),
    ).toEqual({ evaluationOutput: true });
  });

  it("renders the diff from retained content, never the live item", async () => {
    render(
      <UpdateProposal
        proposals={[evalProposal(retainedMockup)]}
        onApply={vi.fn()}
        onReject={vi.fn()}
        organizationId="org-1"
        projectId="project-1"
        renderMode="evaluation-output"
      />,
    );

    expect(await screen.findByTestId("diff-before")).toHaveTextContent(
      "Plan Page as the attempt saw it",
    );
    expect(screen.getByTestId("diff-before-section")).toHaveTextContent(
      "Description as the attempt saw it",
    );
    expect(
      screen.queryByText("Plan Page edited since"),
    ).not.toBeInTheDocument();
  });

  it("shows the badge in place of approve and reject", async () => {
    render(
      <UpdateProposal
        proposals={[evalProposal(retainedMockup)]}
        onApply={vi.fn()}
        onReject={vi.fn()}
        organizationId="org-1"
        projectId="project-1"
        renderMode="evaluation-output"
      />,
    );

    expect(
      await screen.findByTestId("evaluation-output-badge"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /update|approve|reject|apply/i }),
    ).not.toBeInTheDocument();
  });

  it("says the original wasn't saved rather than diffing the live item", async () => {
    render(
      <UpdateProposal
        proposals={[evalProposal(null)]}
        onApply={vi.fn()}
        organizationId="org-1"
        projectId="project-1"
        renderMode="evaluation-output"
      />,
    );

    expect(
      await screen.findByText(/original content was not saved/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("diff-before")).not.toBeInTheDocument();
  });

  it("keeps ordinary proposals actionable", () => {
    render(
      <ProposalStateIndicator
        status={{ state: "pending" }}
        action={ProposalAction.Update}
        onApply={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(
      screen.queryByTestId("evaluation-output-badge"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });
});
