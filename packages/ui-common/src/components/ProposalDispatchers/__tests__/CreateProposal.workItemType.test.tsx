import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  AgentEdgeType,
  EntityType,
  ProposalAction,
  ProposalStatus,
  ProposalType,
  ReportType,
  TargetEntityType,
  WorkItemTypeEffectiveSource,
  WorkItemTypeLifecycleStatus,
  WorkItemTypeRole,
  WorkStatus,
  type ProposalResponseDto,
  type WorkItemTypeDefinitionDto,
} from "../../../api";
import { CreateProposal } from "../CreateProposal";
import { PLACEHOLDER_ENTITY_ID } from "../types";

const { invalidateType } = vi.hoisted(() => ({ invalidateType: vi.fn() }));
vi.mock("../../../data/hooks/useWorkItemTypeLifecycle", () => ({
  useMarkWorkItemTypeDataStale: () => invalidateType,
}));

vi.mock("../../shared/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ children }: { children: string }) => (
    <span data-testid="markdown">{children}</span>
  ),
}));

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeTrackingEligibility: () => ({
    isAllowed: false,
    isReady: true,
    error: null,
    workItemTypes: [],
  }),
  useWorkItemTypes: () => ({
    isReady: true,
    error: null,
    workItemTypes: [
      {
        id: "feature-type",
        projectId: PROJ_ID,
        status: WorkItemTypeLifecycleStatus.Active,
        effectiveSource: WorkItemTypeEffectiveSource.Canonical,
        definition: {
          key: "FEATURE",
          name: "Feature",
          role: WorkItemTypeRole.ProjectInfo,
          sections: [],
          allowedStatuses: [],
        },
      },
      {
        id: "goal-type",
        projectId: PROJ_ID,
        status: WorkItemTypeLifecycleStatus.Active,
        effectiveSource: WorkItemTypeEffectiveSource.Canonical,
        definition: {
          key: "GOAL",
          name: "Goal",
          role: WorkItemTypeRole.ProjectInfo,
          sections: [],
          allowedStatuses: [],
        },
      },
    ],
  }),
}));

const useDesignDocMock = vi.fn();
const useWorkItemMock = vi.fn();
const usePlanMock = vi.fn();

vi.mock("../../../data/hooks/useDesignDoc", () => ({
  useDesignDoc: (...args: unknown[]) => useDesignDocMock(...args),
}));

vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: (...args: unknown[]) => useWorkItemMock(...args),
}));

vi.mock("../../../data/hooks/usePlan", () => ({
  usePlan: (...args: unknown[]) => usePlanMock(...args),
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

const fullDefinition: WorkItemTypeDefinitionDto = {
  key: "MARKETING",
  name: "Marketing Campaign",
  role: WorkItemTypeRole.WorkItem,
  description: "Captures a marketing campaign and its launch plan.",
  sections: [
    {
      key: "audience",
      label: "Audience",
      writingStandard: "Describe the target audience precisely.",
    },
  ],
  requiredScalars: ["dueDate"],
  forbiddenScalars: ["tag"],
  allowedStatuses: [WorkStatus.Backlog, WorkStatus.Active],
  agentSettableStatuses: [WorkStatus.Backlog],
  allowedParentTypes: ["FEATURE"],
  allowedParentEntityTypes: [EntityType.Initiative],
  edgeTargets: [
    { edgeType: AgentEdgeType.DependsOn, targetTypeKeys: ["FEATURE"] },
  ],
  tracking: {
    allowedSourceEntityTypes: [EntityType.Task],
    allowedSourceTaskTypes: ["GOAL"],
  },
  anchorableReportTypes: [ReportType.Plan],
  writingStandards: {
    create: "Lead with the campaign objective.",
    edit: "Preserve the original objective.",
  },
  capabilities: {
    requiresParent: true,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  useDesignDocMock.mockReturnValue({ data: null });
  useWorkItemMock.mockReturnValue({ workItem: null });
  usePlanMock.mockReturnValue({ data: null });
});

describe("CreateProposal — WORK_ITEM_TYPE routing", () => {
  it("invalidates registry reads only after successful type approval", async () => {
    const proposal = makeWorkItemTypeProposal("approve-type", fullDefinition);
    const onApply = vi
      .fn()
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <CreateProposal proposals={[proposal]} onApply={onApply} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /retry|approve/i }),
      ).toBeEnabled(),
    );
    expect(invalidateType).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /retry|approve/i }));
    await waitFor(() =>
      expect(invalidateType).toHaveBeenCalledWith(
        ORG_ID,
        PROJ_ID,
        fullDefinition.key,
      ),
    );
  });
  it("routes a CREATE WORK_ITEM_TYPE proposal to the dedicated renderer, not the generic fallback", () => {
    const proposal = makeWorkItemTypeProposal("wit-1", fullDefinition);

    render(
      <MemoryRouter>
        <CreateProposal proposals={[proposal]} onApply={async () => {}} />
      </MemoryRouter>,
    );

    // The name is in the shared header; the type key remains reviewable in the
    // complete definition instead of becoming a third header badge.
    expect(screen.getByText("Marketing Campaign")).toBeInTheDocument();
    expect(
      screen.getByTestId("proposal-identity-header"),
    ).not.toHaveTextContent("MARKETING");
    expect(screen.getByTestId("work-item-type-key")).toHaveTextContent(
      "MARKETING",
    );

    // Framed definition-axis groups only the dedicated renderer emits. The
    // generic fallback renders a flat summary card with none of these.
    expect(screen.getByText("Structure & placement")).toBeInTheDocument();
    expect(screen.getAllByText("Capabilities")).toHaveLength(2);
    expect(
      screen.getByTestId("work-item-type-create-example"),
    ).toHaveTextContent("Example Marketing Campaign");
    expect(
      screen.getByText("Complete proposed definition"),
    ).toBeInTheDocument();

    const card = screen.getByTestId(
      "work-item-type-create-example",
    ).parentElement;
    const approve = screen.getByRole("button", { name: "Approve" });
    expect(approve).toBeInTheDocument();
    expect(
      card?.compareDocumentPosition(approve) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The dedicated renderer's humanized "Work Item Type" chip is present; the
    // fallback's bare raw targetEntityType chip ("WORK_ITEM_TYPE") is not, which
    // is what we'd see if routing fell through to GenericCreateProposalFallback.
    expect(screen.getByText("Work Item Type")).toBeInTheDocument();
    expect(screen.queryByText("WORK_ITEM_TYPE")).not.toBeInTheDocument();
  });
});
