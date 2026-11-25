import { legacyStatuses } from "../../../test/fixtures/workItemStatuses";
import { workItemHandlers } from "../../../test/workItemGraphQLHandlers";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  ProposalGroupLifecycle,
  ProposalGroupMemberExecutionState,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type ProposalResponseDto,
  type WorkItemTypeDefinitionDto,
} from "../../../api";
import {
  proposalsClient,
  unifiedApiClient,
} from "../../../clients/serviceClients";
import { ProposalGroupReviewView } from "../../ProposalGroupReview/ProposalGroupReview";
import { DeleteProposal } from "../DeleteProposal";
import { UpdateProposal } from "../UpdateProposal";

const definition = vi.hoisted(() => ({
  key: "STANDARD",
  name: "Task",
  sections: [],
}));

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: { getDesignDoc: vi.fn() },
  proposalsClient: { getProposalReconciliation: vi.fn() },
}));

vi.mock("../../../data/hooks/useWorkItemTypes", () => {
  const typeDefinition = {
    ...definition,
    statuses: legacyStatuses([]),
  } satisfies WorkItemTypeDefinitionDto;
  const workItemTypes = [{ definition: typeDefinition }];

  return {
    useWorkItemTypes: () => ({ workItemTypes, isLoading: false, error: null }),
    useWorkItemTypeTrackingEligibility: () => ({
      isAllowed: false,
      isReady: true,
      isLoading: false,
      error: null,
    }),
    useWorkItemTypeByKey: () => ({
      workItemTypeDefinition: typeDefinition,
      isLoading: false,
      error: null,
    }),
  };
});

vi.mock("../../../data/hooks/useWorkItemTypeLifecycle", () => ({
  useMarkWorkItemTypeDataStale: () => vi.fn(),
}));

vi.mock("../../../data/hooks/useUsers", () => ({
  useUsers: () => ({ data: [] }),
}));

vi.mock("../../../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("../../InteractionComponent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../InteractionComponent")>()),
  InteractionComponent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

const proposal = (
  id: string,
  targetEntityId: string,
  overrides: Partial<ProposalResponseDto> = {},
): ProposalResponseDto =>
  ({
    id,
    organizationId: "org-1",
    projectId: "project-1",
    type: ProposalType.Single,
    action: ProposalAction.Update,
    status: ProposalStatus.Pending,
    targetEntityId,
    targetEntityType: TargetEntityType.Task,
    title: `Title of ${targetEntityId}`,
    updates: { name: `Renamed ${targetEntityId}` },
    requestorId: "user-1",
    requiredApprovals: 1,
    approvals: [],
    createdAt: "2026-11-24T00:00:00Z",
    updatedAt: "2026-11-24T00:00:00Z",
    ...overrides,
  }) as ProposalResponseDto;

const item = (id: string) => ({
  id,
  name: `Item ${id}`,
  type: "STANDARD",
  status: "ACTIVE",
  organizationId: "org-1",
  projectId: "project-1",
  sections: [],
});

/** The server holds `first` and `second`; `slow` answers only once released. */
function serveItems(): () => void {
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.mswServer.use(
    http.post("*/graphql", async ({ request }) => {
      const { variables } = (await request.clone().json()) as {
        variables?: { id?: string };
      };
      if (variables?.id === "slow") {
        await released;
        return HttpResponse.json(
          { errors: [{ message: "Task not found" }] },
          { status: 404 },
        );
      }
    }),
    ...workItemHandlers([item("first"), item("second")]),
  );

  return release;
}

const unavailableCard = (proposalId: string) =>
  screen
    .getAllByTestId("proposal-target-unavailable")
    .find((card) => card.dataset.proposalId === proposalId)!;

beforeEach(() => {
  vi.mocked(unifiedApiClient.getDesignDoc).mockRejectedValue(
    Object.assign(new Error("Request failed with status code 404"), {
      isAxiosError: true,
      response: { status: 404 },
    }),
  );
  vi.mocked(proposalsClient.getProposalReconciliation).mockResolvedValue({
    data: {
      data: {
        status: "CURRENT",
        currentBases: [],
        revisions: [],
        conflictingPaths: [],
        interveningProposals: [],
        overlaps: [],
      },
    },
  } as never);
});

describe("proposals listed together when a target cannot be read", () => {
  it("reports the problem on the affected cards and keeps the rest actionable", async () => {
    const releaseSlowRead = serveItems();
    const onApply = vi.fn().mockResolvedValue(undefined);
    const onReject = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <UpdateProposal
          proposals={[
            proposal("p-first", "first"),
            proposal("p-archiver", "archived", {
              status: ProposalStatus.Approved,
              updates: { status: "ARCHIVED" },
            }),
            proposal("p-gone", "gone"),
            proposal("p-doc", "doc", {
              targetEntityType: TargetEntityType.DesignDoc,
            }),
            proposal("p-slow", "slow"),
            proposal("p-second", "second"),
          ]}
          organizationId="org-1"
          projectId="project-1"
          onApply={onApply}
          onReject={onReject}
        />
      </MemoryRouter>,
    );

    // Only the two readable targets can be approved, while one still loads.
    await waitFor(() => {
      expect(screen.getAllByTestId("proposal-target-unavailable")).toHaveLength(
        3,
      );
      const approvals = screen.getAllByTestId("proposal-approve");
      expect(approvals).toHaveLength(2);
      approvals.forEach((approve) => expect(approve).toBeEnabled());
    });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    const archived = unavailableCard("p-archiver");
    expect(archived).toHaveTextContent("Title of archived");
    expect(archived).toHaveTextContent("is now archived");
    expect(within(archived).getByText("Updated")).toBeInTheDocument();
    expect(within(archived).queryByRole("button")).not.toBeInTheDocument();

    for (const id of ["p-gone", "p-doc"]) {
      expect(unavailableCard(id)).toHaveTextContent(
        "is archived or no longer exists",
      );
    }

    await user.click(screen.getAllByTestId("proposal-approve")[0]!);
    expect(onApply).toHaveBeenCalledWith("p-first", {});

    await user.click(
      within(unavailableCard("p-gone")).getByRole("button", { name: "Reject" }),
    );
    await user.type(
      screen.getByTestId("proposal-reject-reason-input"),
      "Superseded",
    );
    await user.click(screen.getByTestId("proposal-reject-submit"));
    expect(onReject).toHaveBeenCalledWith("p-gone", "Superseded");

    releaseSlowRead();
    await waitFor(() =>
      expect(unavailableCard("p-slow")).toHaveTextContent("Title of slow"),
    );
  });

  it("offers another read when the failure could pass", async () => {
    serveItems();
    globalThis.mswServer.use(
      http.post(
        "*/graphql",
        () =>
          HttpResponse.json(
            { errors: [{ message: "Database unavailable" }] },
            { status: 500 },
          ),
        { once: true },
      ),
    );
    vi.mocked(unifiedApiClient.getDesignDoc)
      .mockRejectedValueOnce(new Error("Network Error"))
      .mockResolvedValue({
        data: { data: { id: "doc", name: "Doc", sections: [] } },
      } as never);
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <UpdateProposal
          proposals={[
            proposal("retry-task", "first"),
            proposal("retry-doc", "doc", {
              targetEntityType: TargetEntityType.DesignDoc,
            }),
          ]}
          organizationId="org-1"
          projectId="project-1"
          onApply={vi.fn()}
        />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getAllByTestId("proposal-target-retry")).toHaveLength(2),
    );
    expect(screen.queryByTestId("proposal-approve")).not.toBeInTheDocument();
    for (const retry of screen.getAllByTestId("proposal-target-retry")) {
      await user.click(retry);
    }

    await waitFor(() =>
      expect(screen.getAllByTestId("proposal-approve")).toHaveLength(2),
    );
    expect(
      screen.queryByTestId("proposal-target-unavailable"),
    ).not.toBeInTheDocument();
  });

  it("keeps deletion cards separate", async () => {
    serveItems();

    render(
      <MemoryRouter>
        <DeleteProposal
          proposals={[
            proposal("del-deleted", "deleted", {
              action: ProposalAction.Delete,
              status: ProposalStatus.Approved,
              updates: {},
            }),
            proposal("del-gone", "gone", {
              action: ProposalAction.Delete,
              updates: {},
            }),
            proposal("del-first", "first", {
              action: ProposalAction.Delete,
              updates: {},
            }),
          ]}
          organizationId="org-1"
          projectId="project-1"
          onApply={vi.fn()}
          onReject={vi.fn()}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("proposal-target-unavailable")).toHaveLength(
        2,
      );
      expect(screen.getAllByTestId("proposal-approve")).toHaveLength(1);
    });
    expect(unavailableCard("del-deleted")).toHaveTextContent("is now archived");
    expect(
      within(unavailableCard("del-gone")).getByRole("button", {
        name: "Reject",
      }),
    ).toBeEnabled();
  });

  it("withholds group approval only where a member cannot be shown", async () => {
    serveItems();
    const members = ["first", "gone"].map((target, memberOrder) => ({
      memberId: `member-${target}`,
      memberOrder,
      proposal: proposal(`group-${target}`, target, {
        status: ProposalStatus.Draft,
      }),
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
    }));

    render(
      <MemoryRouter>
        <ProposalGroupReviewView
          organizationId="org-1"
          projectId="project-1"
          proposalGroup={{
            groupId: "group-1",
            organizationId: "org-1",
            projectId: "project-1",
            lifecycle: ProposalGroupLifecycle.Reviewable,
            currentRevision: 1,
            frozenRevision: 1,
            members,
            dependencies: [],
            createdAt: "2026-11-24T00:00:00Z",
            updatedAt: "2026-11-24T00:00:00Z",
          }}
          onApproveMember={vi.fn()}
          onRejectMember={vi.fn()}
          onApproveAll={vi.fn()}
          decidingProposalIds={new Set()}
          isApprovingAll={false}
          approveAllResult={null}
          decisionProposals={new Map()}
          decisionError={null}
        />
      </MemoryRouter>,
    );

    await screen.findByTestId("proposal-target-unavailable");
    await waitFor(() => {
      const [first, gone] = screen.getAllByTestId(
        "proposal-group-member-approve",
      );
      expect(first).toBeEnabled();
      expect(gone).toBeDisabled();
    });
    expect(screen.getByTestId("proposal-group-approve-all")).toBeDisabled();
    screen
      .getAllByTestId("proposal-group-member-reject")
      .forEach((reject) => expect(reject).toBeEnabled());
  });
});
