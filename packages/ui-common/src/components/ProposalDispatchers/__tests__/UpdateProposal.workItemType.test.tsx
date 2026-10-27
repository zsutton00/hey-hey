import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  WorkItemTypeLifecycleStatus,
  WorkItemTypeRole,
  type ProposalResponseDto,
  type WorkItemTypeDefinitionDto,
} from "../../../api";
import { UpdateProposal } from "../UpdateProposal";
import { __resetForTests as resetProposalCache } from "../proposalSelectedStateCache";

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

vi.mock("../useEntityData", () => ({
  useEntityData: () => ({ entities: {}, loading: false, error: null }),
}));

vi.mock("../../../data/hooks/useUsers", () => ({
  useUsers: () => ({ data: [] }),
}));

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeTrackingEligibility: () => ({
    isAllowed: true,
    isReady: true,
    isLoading: false,
    error: null,
  }),
  useWorkItemTypeByKey: useWorkItemTypeByKeyMock,
  useWorkItemTypes: () => ({
    workItemTypes: [],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../../../data/hooks/useWorkItemTypeLifecycle", () => ({
  useMarkWorkItemTypeDataStale: () => markWorkItemTypeDataStaleMock,
  useWorkItemTypeSectionContentImpact: useSectionImpactMock,
  useWorkItemTypeTrackingLinkRevocationImpact: useTrackingImpactMock,
}));

const definition: WorkItemTypeDefinitionDto = {
  key: "MARKETING",
  name: "Marketing",
  role: WorkItemTypeRole.WorkItem,
  sections: [{ key: "audience", label: "Audience" }],
  allowedStatuses: ["NOT_STARTED"],
};

function proposal(): ProposalResponseDto {
  return {
    id: "proposal-edit",
    organizationId: "org-1",
    projectId: "project-1",
    type: ProposalType.Single,
    action: ProposalAction.Update,
    status: ProposalStatus.Draft,
    targetEntityId: "MARKETING",
    targetEntityType: TargetEntityType.WorkItemType,
    updates: { definition },
    requestorId: "user-1",
    requiredApprovals: 1,
    approvals: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

const emptyImpact = {
  data: null,
  isLoading: false,
  isFetching: false,
  isFetched: false,
  isReady: false,
  error: null,
  isStale: false,
  refetch: vi.fn(),
  markStale: vi.fn(),
};

beforeEach(() => {
  resetProposalCache();
  vi.clearAllMocks();
  localStorage.clear();
  useWorkItemTypeByKeyMock.mockReturnValue({
    workItemTypeSummary: {
      definition: { ...definition, sections: [] },
      status: WorkItemTypeLifecycleStatus.Active,
      projectId: "project-1",
    },
    isLoading: false,
    error: null,
  });
  useSectionImpactMock.mockReturnValue(emptyImpact);
  useTrackingImpactMock.mockReturnValue(emptyImpact);
});

describe("UpdateProposal — work-item-type lifecycle routing", () => {
  it("compares the complete JOB_APPLICATION_RECORD envelope one-to-one with selectable split and inline views", () => {
    const current: WorkItemTypeDefinitionDto = {
      ...definition,
      key: "JOB_APPLICATION_RECORD",
      name: "Job application record",
      sections: [
        {
          key: "application",
          label: "Application",
          writingStandard: "Describe the application.",
        },
        { key: "notes", label: "Notes", writingStandard: "Preserve notes." },
      ],
    };
    useWorkItemTypeByKeyMock.mockReturnValue({
      workItemTypeSummary: { definition: current },
      isLoading: false,
      error: null,
    });
    const draft = {
      ...proposal(),
      targetEntityId: current.key,
      updates: {
        definition: {
          ...current,
          sections: [
            {
              key: "application",
              label: "Application details",
              kind: "json",
              schemaRef: "#/components/schemas/Application",
              writingStandard: "Record the complete application.",
            },
            current.sections[1],
          ],
        },
      },
    };
    render(
      <MemoryRouter>
        <UpdateProposal
          proposals={[draft]}
          organizationId="org-1"
          projectId="project-1"
          onApply={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(useWorkItemTypeByKeyMock).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      "JOB_APPLICATION_RECORD",
    );
    const sections = screen.getAllByTestId("work-item-type-section-comparison");
    expect(sections).toHaveLength(2);
    expect(sections[0]).toHaveAttribute("data-section-key", "application");
    expect(sections[0]).toHaveAttribute("data-change", "modified");
    expect(sections[1]).toHaveAttribute("data-change", "unchanged");
    const fields = within(sections[0]).getAllByTestId(
      "work-item-type-definition-field",
    );
    const label = within(fields[0]);
    expect(label.getByTestId("diff-renderer-split-pane-old")).toHaveTextContent(
      "Application",
    );
    expect(label.getByTestId("diff-renderer-split-pane-new")).toHaveTextContent(
      "Application details",
    );
    expect(
      within(fields[1]).getByTestId("diff-renderer-split-pane-old"),
    ).toHaveTextContent("markdown");
    expect(
      within(fields[1]).getByTestId("diff-renderer-split-pane-new"),
    ).toHaveTextContent("json");
    expect(
      within(fields[2]).getByTestId("diff-renderer-split-pane-old"),
    ).toHaveTextContent("Describe the application.");
    expect(
      within(fields[2]).getByTestId("diff-renderer-split-pane-new"),
    ).toHaveTextContent("Record the complete application.");
    fireEvent.click(label.getByTestId("diff-renderer-view-mode-inline"));
    expect(label.getByTestId("diff-renderer-inline-view")).toBeInTheDocument();
  });

  it("forwards an explicit Inline default", () => {
    render(
      <MemoryRouter>
        <UpdateProposal
          proposals={[proposal()]}
          organizationId="org-1"
          projectId="project-1"
          onApply={vi.fn()}
          diffDefaultViewMode="inline"
        />
      </MemoryRouter>,
    );
    expect(
      screen.getAllByTestId("diff-renderer-inline-view").length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByTestId("diff-renderer-split-view"),
    ).not.toBeInTheDocument();
  });

  it("keeps apply pending and failure visible without invalidating the definition", async () => {
    let fail: (reason: Error) => void = () => {};
    const onApply = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          fail = reject;
        }),
    );
    render(
      <MemoryRouter>
        <UpdateProposal
          proposals={[proposal()]}
          organizationId="org-1"
          projectId="project-1"
          onApply={onApply}
        />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApply).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
    fail(new Error("Could not apply definition"));
    expect(await screen.findByText("Failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry/ })).toBeEnabled();
    expect(markWorkItemTypeDataStaleMock).not.toHaveBeenCalled();
  });
  it("rejects through the existing controls and collapses the terminal card", async () => {
    const onReject = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <UpdateProposal
          proposals={[proposal()]}
          organizationId="org-1"
          projectId="project-1"
          onApply={vi.fn()}
          onReject={onReject}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.change(screen.getByTestId("proposal-reject-reason-input"), {
      target: { value: "Keep the current standard" },
    });
    fireEvent.click(screen.getByTestId("proposal-reject-submit"));
    await waitFor(() =>
      expect(onReject).toHaveBeenCalledWith(
        "proposal-edit",
        "Keep the current standard",
      ),
    );
    expect(
      await screen.findByTestId("rejected-proposal-card"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("work-item-type-definition-diff"),
    ).not.toBeInTheDocument();
  });

  it("routes the generated edit payload and invalidates registry reads after accepted apply", async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    const onApplied = vi.fn().mockResolvedValue(undefined);

    render(
      <MemoryRouter>
        <UpdateProposal
          proposals={[proposal()]}
          onApply={onApply}
          onApplied={onApplied}
          organizationId="org-1"
          projectId="project-1"
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByTestId("work-item-type-lifecycle-review"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Unsupported entity type/),
    ).not.toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(onApply).toHaveBeenCalledWith("proposal-edit", {}),
    );
    expect(markWorkItemTypeDataStaleMock).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      "MARKETING",
    );
    expect(onApplied).toHaveBeenCalledWith("proposal-edit");
    expect(await screen.findByText("Updated")).toBeInTheDocument();
  });
});
