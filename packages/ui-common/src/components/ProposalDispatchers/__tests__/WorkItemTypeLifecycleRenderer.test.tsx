import {
  fireEvent,
  render as testingLibraryRender,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
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
  ProjectRole,
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  WorkItemTypeLifecycleStatus,
  type ProposalResponseDto,
  type WorkItemTypeDefinitionDto,
  type WorkItemTypeSummaryDto,
} from "../../../api";
import {
  projectCapabilitiesForRole,
  useProjectCapabilities,
} from "../../../hooks/auth/useProjectCapabilities";
import { WorkItemTypeLifecycleRenderer } from "../WorkItemTypeLifecycleRenderer";

const render = (ui: ReactNode) =>
  testingLibraryRender(<MemoryRouter>{ui}</MemoryRouter>);

const {
  useWorkItemTypeByKeyMock,
  useSectionImpactMock,
  useTrackingImpactMock,
} = vi.hoisted(() => ({
  useWorkItemTypeByKeyMock: vi.fn(),
  useSectionImpactMock: vi.fn(),
  useTrackingImpactMock: vi.fn(),
}));

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeTrackingEligibility: () => ({
    isAllowed: true,
    isReady: true,
    isLoading: false,
    error: null,
  }),
  useWorkItemTypeByKey: useWorkItemTypeByKeyMock,
}));

vi.mock("../../../data/hooks/useWorkItemTypeLifecycle", () => ({
  useWorkItemTypeSectionContentImpact: useSectionImpactMock,
  useWorkItemTypeTrackingLinkRevocationImpact: useTrackingImpactMock,
}));

const currentDefinition: WorkItemTypeDefinitionDto = {
  key: "MARKETING",
  name: "Marketing",
  role: "work-item",
  sections: [
    { key: "audience", label: "Audience" },
    { key: "constraints", label: "Constraints" },
  ],
  allowedStatuses: ["NOT_STARTED"],
  allowedParentTypes: ["FEATURE", "INITIATIVE"],
  tracking: {
    allowedSourceEntityTypes: [],
    allowedSourceTaskTypes: ["BUG", "FEATURE"],
  },
};

const currentSummary: WorkItemTypeSummaryDto = {
  definition: currentDefinition,
  status: WorkItemTypeLifecycleStatus.Active,
  projectId: "project-1",
};

const readyImpact = <T,>(data: T | null) => ({
  data,
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: vi.fn(),
  markStale: vi.fn(),
});

function editProposal(
  definition: WorkItemTypeDefinitionDto,
): ProposalResponseDto & {
  updates: { definition: WorkItemTypeDefinitionDto };
} {
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
    approvals: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function archiveProposal(): ProposalResponseDto & {
  updates: { reason: string };
} {
  return {
    id: "proposal-archive",
    organizationId: "org-1",
    projectId: "project-1",
    type: ProposalType.Single,
    action: ProposalAction.Delete,
    status: ProposalStatus.Draft,
    targetEntityId: "MARKETING",
    targetEntityType: TargetEntityType.WorkItemType,
    updates: { reason: "Campaign work moved elsewhere" },
    requestorId: "user-1",
    approvals: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useProjectCapabilities).mockReturnValue(
    projectCapabilitiesForRole(ProjectRole.Owner),
  );
  useWorkItemTypeByKeyMock.mockReturnValue({
    workItemTypeSummary: currentSummary,
    isLoading: false,
    error: null,
  });
  useSectionImpactMock.mockReturnValue(
    readyImpact({
      totalAffectedItemCount: 3,
      sections: [{ sectionKey: "audience", affectedItemCount: 3 }],
    }),
  );
  useTrackingImpactMock.mockReturnValue(
    readyImpact({
      totalAffectedLinkCount: 4,
      sources: [{ sourceTypeKey: "BUG", affectedLinkCount: 4 }],
    }),
  );
});

describe("WorkItemTypeLifecycleRenderer", () => {
  it("uses the retained definition for an evaluation diff after the live type changes", () => {
    const historical = {
      ...currentDefinition,
      description: "Historical guidance",
    };
    const proposed = { ...currentDefinition, description: "Proposed guidance" };
    useWorkItemTypeByKeyMock.mockReturnValue({
      workItemTypeSummary: {
        ...currentSummary,
        definition: { ...currentDefinition, description: "Later live change" },
      },
      isLoading: false,
      error: null,
    });
    const proposal = {
      ...editProposal(proposed),
      applicationEligible: false,
      ragEnabled: false,
      retainedOriginalTargetContent: { definition: historical },
    };
    render(
      <WorkItemTypeLifecycleRenderer
        mode="edit"
        proposal={proposal}
        organizationId="org-1"
        projectId="project-1"
        status={{ state: "pending" }}
        onApply={vi.fn()}
      />,
    );
    const review = screen.getByTestId("work-item-type-lifecycle-review");
    expect(review).toHaveTextContent("Historical guidance");
    expect(review).toHaveTextContent("Proposed guidance");
    expect(review).not.toHaveTextContent("Later live change");
  });

  it.each([ProjectRole.Owner, ProjectRole.Architect])(
    "offers approval to a project %s",
    (role) => {
      vi.mocked(useProjectCapabilities).mockReturnValue(
        projectCapabilitiesForRole(role),
      );
      render(
        <WorkItemTypeLifecycleRenderer
          mode="archive"
          proposal={archiveProposal()}
          organizationId="org-1"
          projectId="project-1"
          status={{ state: "pending" }}
          onApply={vi.fn()}
          onReject={vi.fn()}
        />,
      );

      expect(screen.getByTestId("proposal-approve")).toBeInTheDocument();
    },
  );

  it.each([ProjectRole.Member, ProjectRole.Viewer])(
    "hides approval but keeps reject for a project %s",
    (role) => {
      vi.mocked(useProjectCapabilities).mockReturnValue(
        projectCapabilitiesForRole(role),
      );
      render(
        <WorkItemTypeLifecycleRenderer
          mode="edit"
          proposal={editProposal(currentDefinition)}
          organizationId="org-1"
          projectId="project-1"
          status={{ state: "pending" }}
          onApply={vi.fn()}
          onReject={vi.fn()}
        />,
      );

      expect(screen.queryByTestId("proposal-approve")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Reject" }),
      ).toBeInTheDocument();
    },
  );

  it.each(["missing", "error", "loading"])(
    "blocks approval when the canonical definition is %s",
    (state) => {
      useWorkItemTypeByKeyMock.mockReturnValue({
        workItemTypeSummary: state === "error" ? currentSummary : undefined,
        isLoading: state === "loading",
        error: state === "error" ? new Error("Unavailable") : null,
      });
      render(
        <WorkItemTypeLifecycleRenderer
          mode="edit"
          proposal={editProposal(currentDefinition)}
          organizationId="org-1"
          projectId="project-1"
          status={{ state: "pending" }}
          onApply={vi.fn()}
        />,
      );
      expect(
        screen.queryByRole("button", { name: "Update" }),
      ).not.toBeInTheDocument();
      expect(
        state === "loading"
          ? screen.getByRole("progressbar")
          : screen.getByTestId("work-item-type-lifecycle-load-error"),
      ).toBeInTheDocument();
    },
  );
  it("blocks approval if stable declaration identities cannot be compared", () => {
    render(
      <WorkItemTypeLifecycleRenderer
        mode="edit"
        proposal={editProposal({
          ...currentDefinition,
          sections: [
            currentDefinition.sections[0],
            currentDefinition.sections[0],
          ],
        })}
        organizationId="org-1"
        projectId="project-1"
        status={{ state: "pending" }}
        onApply={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("work-item-type-comparison-error"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Update" }),
    ).not.toBeInTheDocument();
  });
  it.each(["loading", "error"])(
    "blocks destructive approval while impact is %s",
    (state) => {
      useSectionImpactMock.mockReturnValue({
        ...readyImpact(null),
        isLoading: state === "loading",
        error: state === "error" ? new Error("Unavailable") : null,
      });
      render(
        <WorkItemTypeLifecycleRenderer
          mode="edit"
          proposal={editProposal({ ...currentDefinition, sections: [] })}
          organizationId="org-1"
          projectId="project-1"
          status={{ state: "pending" }}
          onApply={vi.fn()}
        />,
      );
      expect(screen.getByRole("button", { name: "Update" })).toBeDisabled();
      if (state === "error")
        expect(
          screen.getByTestId("work-item-type-impact-error"),
        ).toBeInTheDocument();
    },
  );
  it("renders additions, removals and order alongside complete declaration content", () => {
    render(
      <WorkItemTypeLifecycleRenderer
        mode="edit"
        proposal={editProposal({
          ...currentDefinition,
          sections: [
            currentDefinition.sections[1],
            currentDefinition.sections[0],
            {
              key: "new",
              label: "New section",
              writingStandard: "Include evidence.",
            },
          ],
        })}
        organizationId="org-1"
        projectId="project-1"
        status={{ state: "pending" }}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByText("Section order")).toBeInTheDocument();
    const sections = screen.getAllByTestId("work-item-type-section-comparison");
    expect(sections.map((s) => s.getAttribute("data-change"))).toEqual([
      "unchanged",
      "unchanged",
      "added",
    ]);
    expect(sections[2]).toHaveTextContent("Include evidence.");
  });
  it("shows classification changes independently from lifecycle impact", () => {
    render(
      <WorkItemTypeLifecycleRenderer
        mode="edit"
        proposal={editProposal({
          ...currentDefinition,
          role: "scheduled",
        })}
        organizationId="org-1"
        projectId="project-1"
        status={{ state: "pending" }}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getByTestId("work-item-type-role-change")).toHaveTextContent(
      "work-item→scheduled",
    );
    expect(
      screen.queryByTestId("work-item-type-edit-impact"),
    ).not.toBeInTheDocument();
  });

  it("shows section-content and tracking-link counts for destructive edits", () => {
    const proposal = editProposal({
      ...currentDefinition,
      sections: [{ key: "constraints", label: "Constraints" }],
      tracking: {
        ...currentDefinition.tracking!,
        allowedSourceTaskTypes: ["FEATURE"],
      },
    });

    render(
      <WorkItemTypeLifecycleRenderer
        mode="edit"
        proposal={proposal}
        organizationId="org-1"
        projectId="project-1"
        status={{ state: "pending" }}
        onApply={vi.fn()}
      />,
    );

    expect(
      screen.getByTestId("work-item-type-edit-impact"),
    ).toBeInTheDocument();
    expect(screen.getByText(/affects 3 existing items/)).toBeInTheDocument();
    expect(screen.getByText("audience: 3 items")).toBeInTheDocument();
    expect(
      screen.getByText(/affects 4 existing tracking links/),
    ).toBeInTheDocument();
    expect(screen.getByText("BUG: 4 links")).toBeInTheDocument();
    expect(useSectionImpactMock).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      "MARKETING",
      ["audience"],
      { enabled: true },
    );
    expect(useTrackingImpactMock).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      "MARKETING",
      ["BUG"],
      { enabled: true },
    );
  });

  it("renders additive edits without destructive confirmation text", () => {
    render(
      <WorkItemTypeLifecycleRenderer
        mode="edit"
        proposal={editProposal({
          ...currentDefinition,
          sections: [
            ...currentDefinition.sections,
            { key: "channels", label: "Channels" },
          ],
        })}
        organizationId="org-1"
        projectId="project-1"
        status={{ state: "pending" }}
        onApply={vi.fn()}
      />,
    );

    expect(
      screen.getByTestId("work-item-type-added-sections"),
    ).toHaveTextContent("channels");
    expect(
      screen.queryByTestId("work-item-type-edit-impact"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update" })).toBeEnabled();
  });

  it("renders child-owned parent placement deltas", () => {
    render(
      <WorkItemTypeLifecycleRenderer
        mode="edit"
        proposal={editProposal({
          ...currentDefinition,
          allowedParentTypes: ["FEATURE", "EPIC"],
        })}
        organizationId="org-1"
        projectId="project-1"
        status={{ state: "pending" }}
        onApply={vi.fn()}
      />,
    );

    expect(
      screen.getByTestId("work-item-type-placement-changes"),
    ).toHaveTextContent("Placement changes");
    expect(
      screen.getByTestId("work-item-type-added-parents"),
    ).toHaveTextContent("Added parentsEPIC");
    expect(
      screen.getByTestId("work-item-type-removed-parents"),
    ).toHaveTextContent("Removed parentsINITIATIVE");
    expect(
      screen.queryByTestId("work-item-type-edit-impact"),
    ).not.toBeInTheDocument();
  });

  it("does not render placement sections when parent and child keys are unchanged", () => {
    render(
      <WorkItemTypeLifecycleRenderer
        mode="edit"
        proposal={editProposal(currentDefinition)}
        organizationId="org-1"
        projectId="project-1"
        status={{ state: "pending" }}
        onApply={vi.fn()}
      />,
    );

    expect(
      screen.queryByTestId("work-item-type-placement-changes"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update" })).toBeEnabled();
  });

  it("keeps loading and unavailable-definition states explicit", () => {
    useWorkItemTypeByKeyMock.mockReturnValueOnce({
      workItemTypeSummary: undefined,
      isLoading: true,
      error: null,
    });

    const { unmount } = render(
      <WorkItemTypeLifecycleRenderer
        mode="edit"
        proposal={editProposal(currentDefinition)}
        organizationId="org-1"
        projectId="project-1"
        status={{ state: "pending" }}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    unmount();

    useWorkItemTypeByKeyMock.mockReturnValueOnce({
      workItemTypeSummary: undefined,
      isLoading: false,
      error: new Error("registry unavailable"),
    });
    render(
      <WorkItemTypeLifecycleRenderer
        mode="edit"
        proposal={editProposal(currentDefinition)}
        organizationId="org-1"
        projectId="project-1"
        status={{ state: "pending" }}
        onApply={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("work-item-type-lifecycle-load-error"),
    ).toBeInTheDocument();
  });

  it("renders archive as safe retirement and keeps the apply affordance", () => {
    const onApply = vi.fn();

    render(
      <WorkItemTypeLifecycleRenderer
        mode="archive"
        proposal={archiveProposal()}
        organizationId="org-1"
        projectId="project-1"
        status={{ state: "pending" }}
        onApply={onApply}
      />,
    );

    expect(
      screen.getByTestId("work-item-type-archive-review"),
    ).toHaveTextContent("Existing items and this definition remain readable");
    expect(screen.queryByText(/will be deleted/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onApply).toHaveBeenCalledOnce();
  });
});
