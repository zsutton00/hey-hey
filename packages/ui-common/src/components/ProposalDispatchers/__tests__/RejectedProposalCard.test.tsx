import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  ProposalApprovalType,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type ProposalResponseDto,
  type TaskResponseDto,
  type WorkItemTypeDefinitionDto,
} from "../../../api";

const {
  useUsersMock,
  useEntityDataMock,
  useWorkItemTypeByKeyMock,
  useWorkItemTypesMock,
  markWorkItemTypeDataStaleMock,
} = vi.hoisted(() => ({
  useUsersMock: vi.fn(),
  useEntityDataMock: vi.fn(),
  useWorkItemTypeByKeyMock: vi.fn(),
  useWorkItemTypesMock: vi.fn(),
  markWorkItemTypeDataStaleMock: vi.fn(),
}));

vi.mock("../ProposalTitle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ProposalTitle")>();
  return {
    ...actual,
    ProposalTitle: (props: import("../ProposalTitle").ProposalTitleProps) => (
      <MemoryRouter>
        <div data-testid="shared-title-boundary">
          <actual.ProposalTitle {...props} />
        </div>
      </MemoryRouter>
    ),
  };
});

vi.mock("../../../data/hooks/useUsers", () => ({
  useUsers: (...args: unknown[]) => useUsersMock(...args),
}));

vi.mock("../useEntityData", () => ({
  useEntityData: (...args: unknown[]) => useEntityDataMock(...args),
}));

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeByKey: (...args: unknown[]) =>
    useWorkItemTypeByKeyMock(...args),
  useWorkItemTypeTrackingEligibility: () => ({
    isAllowed: true,
    isReady: true,
    isLoading: false,
    error: null,
  }),
  useWorkItemTypes: (...args: unknown[]) => useWorkItemTypesMock(...args),
}));

vi.mock("../../../data/hooks/useWorkItemTypeLifecycle", () => ({
  useMarkWorkItemTypeDataStale: () => markWorkItemTypeDataStaleMock,
}));

vi.mock("../../InteractionComponent", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../InteractionComponent")
  >();

  return {
    ...actual,
    InteractionComponent: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
  };
});

vi.mock("../ProposalEdges", () => ({
  ProposalEdges: () => null,
}));

vi.mock("../TaskCreateRenderer", () => ({
  TaskCreateRenderer: ({ proposal }: { proposal: ProposalResponseDto }) => (
    <div data-testid="create-full-content">CREATE BODY {proposal.id}</div>
  ),
}));

vi.mock("../PlanCreateRenderer", () => ({
  PlanCreateRenderer: () => <div />,
}));

vi.mock("../PlanStepsProposalRenderer", () => ({
  PlanStepsProposalRenderer: () => <div />,
}));

vi.mock("../WorkflowProposalRenderer", () => ({
  WorkflowProposalRenderer: () => <div />,
}));

vi.mock("../WorkItemTypeCreateRenderer", () => ({
  WorkItemTypeCreateRenderer: () => <div />,
}));

vi.mock("../DesignDocCreateRenderer", () => ({
  DesignDocCreateRenderer: () => <div />,
}));

vi.mock("../TaskUpdateRenderer", () => ({
  TaskUpdateRenderer: ({ proposal }: { proposal: ProposalResponseDto }) => (
    <div data-testid="update-full-content">UPDATE BODY {proposal.id}</div>
  ),
}));

vi.mock("../DesignDocUpdateRenderer", () => ({
  DesignDocUpdateRenderer: () => <div />,
}));

vi.mock("../PlanStepUpdateRenderer", () => ({
  PlanStepUpdateRenderer: () => <div />,
}));

vi.mock("../WorkItemGraphProposalRenderer", () => ({
  WorkItemGraphProposalRenderer: () => <div />,
}));

vi.mock("../WorkItemTypeLifecycleRenderer", () => ({
  WorkItemTypeLifecycleRenderer: () => (
    <div data-testid="work-item-type-full-content">WORK ITEM TYPE BODY</div>
  ),
}));

import { CreateProposal } from "../CreateProposal";
import { DeleteProposal } from "../DeleteProposal";
import { UpdateProposal } from "../UpdateProposal";

const ORG_ID = "org-1";
const PROJECT_ID = "project-1";

const workItemTypeDefinition: WorkItemTypeDefinitionDto = {
  key: "STANDARD",
  name: "Task",
  sections: [],
  allowedStatuses: [],
};

const updateEntity = {
  id: "update-target",
  name: "Update target",
  type: "STANDARD",
  organizationId: ORG_ID,
  projectId: PROJECT_ID,
  sections: [],
} as unknown as TaskResponseDto;

let proposalSequence = 0;

function makeProposal(
  action: ProposalAction,
  status: ProposalStatus,
  reason: string | null = "Needs another review"
): ProposalResponseDto {
  proposalSequence += 1;
  const id = `proposal-${proposalSequence}`;
  const targetEntityId =
    action === ProposalAction.Update ? "update-target" : id;

  return {
    id,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    type: ProposalType.Single,
    action,
    status,
    targetEntityId,
    targetEntityType: TargetEntityType.Task,
    title: `${action} target title`,
    updates:
      action === ProposalAction.Create
        ? { name: "Created target", type: "STANDARD" }
        : action === ProposalAction.Update
        ? { name: "Updated target", type: "STANDARD" }
        : {},
    requestorId: "requestor-1",
    requiredApprovals: 1,
    approvals:
      status === ProposalStatus.Rejected
        ? [
            {
              userId: "rejector-1",
              type: ProposalApprovalType.Rejection,
              reason,
              createdAt: "2026-07-31T00:00:00Z",
            },
          ]
        : [],
    createdAt: "2026-07-31T00:00:00Z",
    updatedAt: "2026-07-31T00:00:00Z",
  } as unknown as ProposalResponseDto;
}

function renderDispatcher(proposal: ProposalResponseDto) {
  if (proposal.action === ProposalAction.Create) {
    return render(
      <CreateProposal proposals={[proposal]} onApply={async () => {}} />
    );
  }
  if (proposal.action === ProposalAction.Update) {
    return render(
      <UpdateProposal
        proposals={[proposal]}
        onApply={async () => {}}
        organizationId={ORG_ID}
        projectId={PROJECT_ID}
      />
    );
  }
  return render(
    <DeleteProposal
      proposals={[proposal]}
      onApply={async () => {}}
      organizationId={ORG_ID}
      projectId={PROJECT_ID}
    />
  );
}

beforeEach(() => {
  proposalSequence = 0;
  vi.clearAllMocks();
  useUsersMock.mockReturnValue({
    data: [
      {
        userId: "rejector-1",
        user: { name: "Ada Reviewer" },
      },
    ],
  });
  useEntityDataMock.mockReturnValue({
    entities: {
      "update-target": { type: "task", data: updateEntity },
    },
    loading: false,
    error: null,
  });
  useWorkItemTypesMock.mockReturnValue({
    workItemTypes: [
      {
        definition: workItemTypeDefinition,
        status: "ACTIVE",
        projectId: PROJECT_ID,
      },
    ],
    isLoading: false,
    error: null,
  });
  useWorkItemTypeByKeyMock.mockReturnValue({
    workItemTypeSummary: undefined,
    workItemTypeDefinition,
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: true,
    error: null,
    isStale: false,
    refetch: vi.fn(),
    markStale: vi.fn(),
  });
});

describe("rejected proposal dispatcher cards", () => {
  it.each([
    [ProposalAction.Create, "create-full-content"],
    [ProposalAction.Update, "update-full-content"],
    [ProposalAction.Delete, "This task will be deleted."],
  ] as const)(
    "collapses rejected %s content and restores it through the shared expansion control",
    async (action, content) => {
      const proposal = makeProposal(action, ProposalStatus.Rejected);

      renderDispatcher(proposal);

      expect(screen.getByTestId("rejected-proposal-card")).toBeInTheDocument();
      expect(screen.getByTestId("shared-title-boundary")).toHaveTextContent(
        proposal.title!
      );
      expect(screen.getByTestId("rejected-proposal-target")).toHaveTextContent(
        `${action} target title`
      );
      expect(screen.getByText("Ada Reviewer")).toBeInTheDocument();
      expect(screen.getByTestId("rejected-proposal-summary")).toHaveTextContent(
        `${action.charAt(0)}${action.slice(1).toLowerCase()} Task rejected by`
      );
      expect(screen.getByTestId("rejected-proposal-summary")).toHaveTextContent(
        "Needs another review"
      );
      const contentIsTestId = content.endsWith("-full-content");
      expect(
        contentIsTestId
          ? screen.queryByTestId(content)
          : screen.queryByText(content)
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("rejected-proposal-toggle"));
      expect(
        contentIsTestId
          ? await screen.findByTestId(content)
          : await screen.findByText(content)
      ).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("rejected-proposal-toggle"));
      await waitFor(() => {
        expect(
          contentIsTestId
            ? screen.queryByTestId(content)
            : screen.queryByText(content)
        ).not.toBeInTheDocument();
      });
    }
  );

  it("keeps a reasonless CREATE rejection reason-free", () => {
    renderDispatcher(
      makeProposal(ProposalAction.Create, ProposalStatus.Rejected, null)
    );

    expect(screen.getByTestId("rejected-proposal-card")).toBeInTheDocument();
    expect(screen.getByText("Ada Reviewer")).toBeInTheDocument();
    expect(screen.queryByText(/Reason:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No reason/i)).not.toBeInTheDocument();
  });

  it("renders an explicit unavailable voter state without exposing the voter ID", () => {
    useUsersMock.mockReturnValue({ data: [] });

    renderDispatcher(
      makeProposal(ProposalAction.Delete, ProposalStatus.Rejected)
    );

    expect(screen.getByText("User unavailable")).toBeInTheDocument();
    expect(screen.queryByText("rejector-1")).not.toBeInTheDocument();
  });

  it("keeps pending CREATE content fully visible", () => {
    renderDispatcher(
      makeProposal(ProposalAction.Create, ProposalStatus.Pending)
    );

    expect(
      screen.queryByTestId("rejected-proposal-card")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("create-full-content")).toBeInTheDocument();
  });
});
