import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "../../../hooks/auth/useProjectCapabilities",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../hooks/auth/useProjectCapabilities")
      >();
    return {
      ...actual,
      useProjectCapabilities: vi.fn(() =>
        actual.projectCapabilitiesForRole("OWNER"),
      ),
    };
  },
);
import {
  ProposalAction,
  ProposalApprovalType,
  ProposalOutOfDateStatus,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  WorkItemTypeLifecycleStatus,
  type ProposalResponseDto,
} from "../../../api";

const {
  markWorkItemTypeDataStaleMock,
  useWorkItemTypeByKeyMock,
  useSectionImpactMock,
  useTrackingImpactMock,
} = vi.hoisted(() => ({
  markWorkItemTypeDataStaleMock: vi.fn(),
  useWorkItemTypeByKeyMock: vi.fn(),
  useSectionImpactMock: vi.fn(),
  useTrackingImpactMock: vi.fn(),
}));

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    getTask: vi.fn(),
    getDesignDoc: vi.fn(),
  },
  proposalsClient: {
    getProposal: vi.fn(),
    getProposalReconciliation: vi.fn(),
    createProposalReconciliationCandidate: vi.fn(),
  },
}));

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypes: () => ({
    workItemTypes: [],
    isLoading: false,
    error: null,
  }),
  useWorkItemTypeByKey: useWorkItemTypeByKeyMock,
  useWorkItemTypeTrackingEligibility: () => ({
    isAllowed: true,
    isReady: true,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../../../data/hooks/useWorkItemTypeLifecycle", () => ({
  useMarkWorkItemTypeDataStale: () => markWorkItemTypeDataStaleMock,
  useWorkItemTypeSectionContentImpact: useSectionImpactMock,
  useWorkItemTypeTrackingLinkRevocationImpact: useTrackingImpactMock,
}));

import {
  proposalsClient,
  unifiedApiClient,
} from "../../../clients/serviceClients";
import { DeleteProposal } from "../DeleteProposal";

const ORG_ID = "org-1";
const PROJ_ID = "proj-1";
const STAGE_ID = "stage-1";
const STEP_ID = "step-1";

const mockedGetTask = vi.mocked(unifiedApiClient.getTask);
const mockedGetDesignDoc = vi.mocked(unifiedApiClient.getDesignDoc);

function makeProposal(
  overrides: Partial<ProposalResponseDto>,
): ProposalResponseDto {
  return {
    id: "proposal-1",
    organizationId: ORG_ID,
    projectId: PROJ_ID,
    type: ProposalType.Single,
    action: ProposalAction.Delete,
    status: ProposalStatus.Pending,
    targetEntityId: "entity-1",
    targetEntityType: TargetEntityType.Task,
    updates: {},
    requestorId: "user-1",
    requiredApprovals: 1,
    approvals: [],
    outOfDateStatus: ProposalOutOfDateStatus.Current,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } as unknown as ProposalResponseDto;
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(proposalsClient.getProposalReconciliation).mockResolvedValue({
    data: {
      data: {
        status: "CURRENT",
        currentBases: [],
        revisions: [],
        conflictingPaths: [],
      },
    },
  } as never);
  localStorage.clear();
  mockedGetTask.mockResolvedValue({
    data: { data: { id: "entity-1", name: "Resolved task name" } },
  } as never);
  mockedGetDesignDoc.mockResolvedValue({
    data: { data: { id: "doc-1", name: "Resolved doc name" } },
  } as never);
  useWorkItemTypeByKeyMock.mockReturnValue({
    workItemTypeSummary: {
      definition: {
        key: "MARKETING",
        name: "Marketing",
        sections: [],
        allowedStatuses: ["NOT_STARTED"],
      },
      status: WorkItemTypeLifecycleStatus.Active,
      projectId: PROJ_ID,
    },
    isLoading: false,
    error: null,
  });
  const emptyImpact = {
    data: null,
    isLoading: false,
    isFetching: false,
    error: null,
  };
  useSectionImpactMock.mockReturnValue(emptyImpact);
  useTrackingImpactMock.mockReturnValue(emptyImpact);
});

describe("DeleteProposal", () => {
  it("routes archive-style WORK_ITEM_TYPE deletes and invalidates registry reads after apply", async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    const onApplied = vi.fn().mockResolvedValue(undefined);

    render(
      <MemoryRouter>
        <DeleteProposal
          proposals={[
            makeProposal({
              id: "archive-type",
              targetEntityId: "MARKETING",
              targetEntityType: TargetEntityType.WorkItemType,
              updates: { reason: "No longer used" },
            }),
          ]}
          onApply={onApply}
          onApplied={onApplied}
          organizationId={ORG_ID}
          projectId={PROJ_ID}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByTestId("work-item-type-archive-review"),
    ).toHaveTextContent("Existing items and this definition remain readable");
    expect(screen.queryByText(/will be deleted/i)).not.toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(onApply).toHaveBeenCalledWith("archive-type", {}),
    );
    expect(markWorkItemTypeDataStaleMock).toHaveBeenCalledWith(
      ORG_ID,
      PROJ_ID,
      "MARKETING",
    );
    expect(onApplied).toHaveBeenCalledWith("archive-type");
  });

  it("requires reconciliation for an out-of-date DELETE without offering acknowledgement", async () => {
    vi.mocked(proposalsClient.getProposalReconciliation).mockResolvedValue({
      data: {
        data: {
          status: "RECONCILIATION_REQUIRED",
          currentBases: [],
          revisions: [],
          conflictingPaths: [],
        },
      },
    } as never);
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <DeleteProposal
          proposals={[
            makeProposal({
              id: "out-of-date-delete",
              outOfDateStatus: ProposalOutOfDateStatus.OutOfDate,
            }),
          ]}
          onApply={onApply}
          organizationId={ORG_ID}
          projectId={PROJ_ID}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByTestId("proposal-reconciliation-merge"),
    ).toBeVisible();
    expect(screen.getByTestId("proposal-approve")).toBeDisabled();
    expect(
      screen.queryByTestId("proposal-out-of-date-acknowledgement"),
    ).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("renders the entity-type chip, resolved title, will-be-deleted treatment and Approve/Reject", async () => {
    render(
      <MemoryRouter>
        <DeleteProposal
          proposals={[
            makeProposal({
              id: "del-task",
              title: "Legacy login task",
              targetEntityType: TargetEntityType.Task,
            }),
          ]}
          onApply={async () => {}}
          onReject={async () => {}}
          organizationId={ORG_ID}
          projectId={PROJ_ID}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Legacy login task")).toBeInTheDocument();
    expect(screen.getByText("TASK")).toBeInTheDocument();
    expect(screen.getByText("This task will be deleted.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("renders embedded DELETE content without a standalone card or decision controls", async () => {
    render(
      <MemoryRouter>
        <DeleteProposal
          proposals={[
            makeProposal({
              id: "embedded-delete",
              title: "Embedded delete",
              targetEntityType: TargetEntityType.Task,
            }),
          ]}
          onApply={async () => {}}
          onReject={async () => {}}
          organizationId={ORG_ID}
          projectId={PROJ_ID}
          renderMode="group-member"
        />
      </MemoryRouter>,
    );

    expect(
      (await screen.findAllByText("This task will be deleted."))[0],
    ).toBeInTheDocument();
    expect(screen.queryByText("Embedded delete")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reject" }),
    ).not.toBeInTheDocument();
  });

  it("renders APPROVAL-only API progress and wording for DELETE proposals", async () => {
    render(
      <MemoryRouter>
        <DeleteProposal
          proposals={[
            makeProposal({
              id: "del-multi-approval",
              requiredApprovals: 3,
              approvals: [
                {
                  userId: "approver-1",
                  type: ProposalApprovalType.Approval,
                  reason: null,
                  createdAt: "2026-01-01T01:00:00Z",
                },
                {
                  userId: "reviewer-1",
                  type: ProposalApprovalType.Rejection,
                  reason: "Needs changes",
                  createdAt: "2026-01-01T02:00:00Z",
                },
              ],
            }),
          ]}
          onApply={async () => {}}
          onReject={async () => {}}
          organizationId={ORG_ID}
          projectId={PROJ_ID}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByTestId("proposal-approval-progress"),
    ).toHaveTextContent("1 of 3 approvals");
    expect(screen.getByRole("button", { name: "Add approval" })).toBeVisible();
  });

  it("renders the server-stamped title for a PLAN_STEP delete", async () => {
    render(
      <MemoryRouter>
        <DeleteProposal
          proposals={[
            makeProposal({
              id: "del-step",
              title: "Resolve auth race",
              targetEntityId: STEP_ID,
              targetEntityType: TargetEntityType.Task,
            }),
          ]}
          onApply={async () => {}}
          onReject={async () => {}}
          organizationId={ORG_ID}
          projectId={PROJ_ID}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Resolve auth race")).toBeInTheDocument();
    expect(screen.queryByText("DELETE PLAN_STEP")).not.toBeInTheDocument();
  });

  it("routes every DELETE variety through the one shared card", async () => {
    render(
      <MemoryRouter>
        <DeleteProposal
          proposals={[
            makeProposal({
              id: "del-task",
              targetEntityId: "entity-1",
              targetEntityType: TargetEntityType.Task,
            }),
            makeProposal({
              id: "del-doc",
              targetEntityId: "doc-1",
              targetEntityType: TargetEntityType.DesignDoc,
            }),
            makeProposal({
              id: "del-stage",
              title: "Foundation",
              targetEntityId: STAGE_ID,
              targetEntityType: TargetEntityType.Task,
            }),
            makeProposal({
              id: "del-step",
              title: "Resolve auth race",
              targetEntityId: STEP_ID,
              targetEntityType: TargetEntityType.Task,
            }),
          ]}
          onApply={async () => {}}
          onReject={async () => {}}
          organizationId={ORG_ID}
          projectId={PROJ_ID}
        />
      </MemoryRouter>,
    );

    const notes = await screen.findAllByText(/will be deleted\.$/);
    expect(notes).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(4);
    expect(screen.getAllByText("This task will be deleted.")).toHaveLength(3);
    expect(
      screen.getByText("This design doc will be deleted."),
    ).toBeInTheDocument();
  });

  it("labels task-backed workflow deletes by workflow type when task data is available", async () => {
    mockedGetTask.mockResolvedValueOnce({
      data: {
        data: {
          id: "workflow-1",
          name: "Launch workflow",
          type: "workflow",
        },
      },
    } as never);

    render(
      <MemoryRouter>
        <DeleteProposal
          proposals={[
            makeProposal({
              id: "del-workflow",
              targetEntityId: "workflow-1",
              targetEntityType: TargetEntityType.Task,
            }),
          ]}
          onApply={async () => {}}
          onReject={async () => {}}
          organizationId={ORG_ID}
          projectId={PROJ_ID}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Launch workflow")).toBeInTheDocument();
    expect(screen.getByText("Workflow")).toBeInTheDocument();
    expect(
      screen.getByText("This workflow will be deleted."),
    ).toBeInTheDocument();
  });
});
