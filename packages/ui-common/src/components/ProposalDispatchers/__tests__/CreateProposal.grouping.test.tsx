import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../hooks/auth/useProjectCapabilities", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../hooks/auth/useProjectCapabilities")
    >();
  return {
    ...actual,
    useProjectCapabilities: vi.fn(() =>
      actual.projectCapabilitiesForRole("OWNER")
    ),
  };
});
import {
  EntityType,
  ProposalAction,
  ProposalApprovalType,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  WorkItemTypeRole,
  WorkStatus,
  type ProposalResponseDto,
  type WorkItemTypeDefinitionDto,
} from "../../../api";
import { CreateProposal } from "../CreateProposal";
import { PLACEHOLDER_ENTITY_ID } from "../types";

vi.mock("../../shared/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ children }: { children: string }) => (
    <span data-testid="markdown">{children}</span>
  ),
}));

const useDesignDocMock = vi.fn();
const useWorkItemMock = vi.fn();

vi.mock("../../../data/hooks/useDesignDoc", () => ({
  useDesignDoc: (...args: unknown[]) => useDesignDocMock(...args),
}));

vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: (...args: unknown[]) => useWorkItemMock(...args),
}));

vi.mock("../../../clients/serviceClients", () => ({
  tasksClient: {
    organizationsOrganizationIdProjectsProjectIdTasksTaskIdPatch: vi.fn(),
  },
  proposalsClient: {
    getProposal: vi.fn(),
  },
}));

vi.mock("../../Selectors/TaskTreePicker", () => ({
  TaskTreePicker: () => <div data-testid="task-tree-picker" />,
}));

const ORG_ID = "org-1";
const PROJ_ID = "proj-1";
const PLAN_ID = "plan-1";

function makeStageProposal(
  id: string,
  stageId: string,
  title: string,
): ProposalResponseDto {
  return {
    id,
    organizationId: ORG_ID,
    projectId: PROJ_ID,
    type: ProposalType.Single,
    action: ProposalAction.Create,
    status: ProposalStatus.Draft,
    targetEntityId: stageId,
    targetEntityType: TargetEntityType.Task,
    updates: {
      name: title,
      type: "PLAN_STAGE",
      parentTaskId: PLAN_ID,
      sections: [{ key: "description", content: "Stage description." }],
    },
    requestorId: "user-1",
    requiredApprovals: 1,
    approvals: [],
    createdAt: "2026-05-05T00:00:00Z",
    updatedAt: "2026-05-05T00:00:00Z",
  } as unknown as ProposalResponseDto;
}

function makeWorkItemTypeProposal(
  id: string,
  definition: WorkItemTypeDefinitionDto,
): ProposalResponseDto & { updates: WorkItemTypeDefinitionDto } {
  return {
    id,
    organizationId: ORG_ID,
    projectId: PROJ_ID,
    type: ProposalType.Single,
    action: ProposalAction.Create,
    status: ProposalStatus.Draft,
    targetEntityId: PLACEHOLDER_ENTITY_ID,
    targetEntityType: TargetEntityType.WorkItemType,
    updates: definition,
    requestorId: "user-1",
    requiredApprovals: 1,
    approvals: [],
    createdAt: "2026-05-05T00:00:00Z",
    updatedAt: "2026-05-05T00:00:00Z",
  } as unknown as ProposalResponseDto & { updates: WorkItemTypeDefinitionDto };
}

beforeEach(() => {
  vi.clearAllMocks();
  useDesignDocMock.mockReturnValue({ data: null });
  useWorkItemMock.mockReturnValue({ workItem: null });
});

describe("CreateProposal — canonical proposal cards", () => {
  it("renders embedded CREATE content without a standalone card or decision controls", () => {
    const embeddedProposal = {
      ...makeStageProposal(
        "embedded-create",
        "conversation-1",
        "Embedded title",
      ),
      targetEntityType: TargetEntityType.Conversation,
      updates: { summary: "Embedded create summary" },
    } as unknown as ProposalResponseDto;

    render(
      <MemoryRouter>
        <CreateProposal
          proposals={[embeddedProposal]}
          onApply={async () => {}}
          renderMode="group-member"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Embedded create summary")).toBeInTheDocument();
    expect(screen.queryByText("Embedded title")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reject" }),
    ).not.toBeInTheDocument();
  });

  it("preserves the standalone-card path for a length-1 array (ProposalDetail invariant)", () => {
    // ProposalDetail.tsx wraps a single proposal in `useMemo(() => [proposal])`
    // before handing it to CreateProposal; this test is the dispatcher-side
    // guard that the stepper never wraps that length-1 payload.
    const stage = makeStageProposal("prop-stage", "stage-a", "Stage A");
    render(
      <MemoryRouter>
        <CreateProposal proposals={[stage]} onApply={async () => {}} />
      </MemoryRouter>,
    );
    expect(
      screen.queryByTestId("proposal-stepper-dot-0"),
    ).not.toBeInTheDocument();
  });

  it("routes a CREATE WORK_ITEM_TYPE proposal through the shared approval control", () => {
    const proposal = makeWorkItemTypeProposal("wit-1", {
      key: "MARKETING",
      name: "Marketing Campaign",
      role: WorkItemTypeRole.WorkItem,
      sections: [],
      allowedStatuses: [WorkStatus.Backlog],
    });

    render(
      <MemoryRouter>
        <CreateProposal proposals={[proposal]} onApply={async () => {}} />
      </MemoryRouter>,
    );

    // The dedicated renderer surfaces the type's name + key chip, which the
    // generic fallback would not produce.
    expect(screen.getByText("Marketing Campaign")).toBeInTheDocument();
    expect(screen.getByText("MARKETING")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("does not stack non-opted-in (action, targetEntityType) pairs even when many appear in a row", () => {
    const stages = [
      makeStageProposal("s-1", "stage-a", "Stage A"),
      makeStageProposal("s-2", "stage-b", "Stage B"),
      makeStageProposal("s-3", "stage-c", "Stage C"),
    ];
    render(
      <MemoryRouter>
        <CreateProposal proposals={stages} onApply={async () => {}} />
      </MemoryRouter>,
    );

    expect(
      screen.queryByTestId("proposal-stepper-dot-0"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(3);
  });

  it("renders API-owned approval progress and wording for CREATE proposals", () => {
    const proposal = makeStageProposal("prop-stage", "stage-a", "Stage A");
    proposal.requiredApprovals = 2;
    proposal.approvals = [
      {
        userId: "approver-1",
        type: ProposalApprovalType.Approval,
        reason: null,
        createdAt: "2026-05-05T01:00:00Z",
      },
    ];

    render(
      <MemoryRouter>
        <CreateProposal proposals={[proposal]} onApply={async () => {}} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("proposal-approval-progress")).toHaveTextContent(
      "1 of 2 approvals",
    );
    expect(screen.getByRole("button", { name: "Add approval" })).toBeVisible();
  });
});

vi.mock("../../../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypes: () => ({
    isReady: true,
    error: null,
    workItemTypes: [],
  }),
  useWorkItemTypeTrackingEligibility: () => ({
    isAllowed: true,
    isReady: true,
    isLoading: false,
    error: null,
  }),
  useWorkItemTypeByKey: (_org: string, _project: string, key: string) => ({
    workItemTypeDefinition: {
      key,
      name: "Plan stage",
      sections: [{ key: "description", label: "Description" }],
      allowedStatuses: [],
    },
    isLoading: false,
    isReady: true,
    isFetched: true,
    error: null,
  }),
}));
