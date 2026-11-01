import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  AgentEdgeType,
  EntityType,
  ProjectRole,
  ProposalAction,
  ProposalStatus,
  ProposalType,
  ReportType,
  TargetEntityType,
  WorkStatus,
  type ProposalResponseDto,
  type WorkItemTypeDefinitionDto,
} from "../../../api";
import {
  projectCapabilitiesForRole,
  useProjectCapabilities,
} from "../../../hooks/auth/useProjectCapabilities";
import { WorkItemTypeCreateRenderer } from "../WorkItemTypeCreateRenderer";
import { PLACEHOLDER_ENTITY_ID } from "../types";

vi.mock("../../shared/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ children }: { children: string }) => (
    <span data-testid="markdown">{children}</span>
  ),
}));

vi.mock("../WorkItemTypeCreateProposalPresentation", () => ({
  WorkItemTypeCreateProposalPresentation: () => (
    <div data-testid="work-item-type-create-example" />
  ),
}));

const ORG_ID = "org-1";
const PROJ_ID = "proj-1";
const TARGET_ID = PLACEHOLDER_ENTITY_ID;
const RETAINED_TARGET_ID = "MARKETING";

// Typed as `Required<…>` so that adding a new field to the
// WorkItemTypeDefinitionDto contract is a compile error here until this sample
// populates it — the sample can never silently fall behind the engine's shape.
const fullDefinition: Required<WorkItemTypeDefinitionDto> = {
  key: "MARKETING",
  name: "Marketing Campaign",
  role: "work-item",
  iconKey: "contract",
  description: "Captures a marketing campaign and its launch plan.",
  sections: [
    {
      key: "audience",
      label: "Audience",
      writingStandard: "Describe the target audience precisely.",
    },
    {
      key: "channels",
      label: "Channels",
      writingStandard: "List the distribution channels.",
    },
  ],
  requiredScalars: ["dueDate"],
  forbiddenScalars: ["tag"],
  allowedStatuses: [
    WorkStatus.Backlog,
    WorkStatus.Active,
    WorkStatus.Completed,
  ],
  agentSettableStatuses: [WorkStatus.Backlog, WorkStatus.Active],
  allowedParentTypes: ["FEATURE"],
  allowedParentEntityTypes: [EntityType.Initiative],
  edgeTargets: [
    { edgeType: AgentEdgeType.DependsOn, targetTypeKeys: ["FEATURE"] },
    { edgeType: AgentEdgeType.RelatedTo, targetTypeKeys: [] },
  ],
  tracking: {
    allowedSourceEntityTypes: [EntityType.Task],
    allowedSourceTaskTypes: ["GOAL"],
  },
  anchorableReportTypes: [ReportType.Plan, ReportType.Implement],
  writingStandards: {
    create: "Lead with the campaign objective.",
    edit: "Preserve the original objective.",
  },
  capabilities: {
    requiresParent: true,
  },
};

// The axes this suite exercises with render assertions below — one entry per
// field the WorkItemTypeDefinitionDto contract carries (agent-settable statuses,
// anchorable report types, EntityType parentage, tracking rules, type-level
// writing standards all included). The meta-assertion ties this list to the
// sample's keys: a newly-added engine axis forces the sample to populate it (via
// the `Required<…>` type above) and then forces this list to grow, so the new
// axis cannot be added to the contract without being threaded into the renderer
// test rather than silently dropped.
const EXERCISED_AXES = [
  "key",
  "name",
  "role",
  "iconKey",
  "description",
  "sections",
  "requiredScalars",
  "forbiddenScalars",
  "allowedStatuses",
  "agentSettableStatuses",
  "allowedParentTypes",
  "allowedParentEntityTypes",
  "edgeTargets",
  "tracking",
  "anchorableReportTypes",
  "writingStandards",
  "capabilities",
] as const satisfies ReadonlyArray<keyof WorkItemTypeDefinitionDto>;

function makeProposal(
  updates: WorkItemTypeDefinitionDto,
  targetEntityId = TARGET_ID,
): ProposalResponseDto & { updates: WorkItemTypeDefinitionDto } {
  return {
    id: "proposal-1",
    organizationId: ORG_ID,
    projectId: PROJ_ID,
    type: ProposalType.Single,
    action: ProposalAction.Create,
    status: ProposalStatus.Draft,
    targetEntityId,
    targetEntityType: TargetEntityType.WorkItemType,
    updates,
    requestorId: "user-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as ProposalResponseDto & { updates: WorkItemTypeDefinitionDto };
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useProjectCapabilities).mockReturnValue(
    projectCapabilitiesForRole(ProjectRole.Owner),
  );
});

describe("WorkItemTypeCreateRenderer", () => {
  it("colors the Work Item Type chip from the proposed type key", () => {
    render(
      <MemoryRouter>
        <WorkItemTypeCreateRenderer
          proposal={makeProposal({ ...fullDefinition, key: "BUG" })}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("proposal-header-type")).toHaveClass(
      "MuiChip-filled",
    );
  });

  it("exercises every axis the live WorkItemTypeDefinitionDto carries", () => {
    // Drift guard: the set of axes this suite asserts on must exactly match the
    // keys present on the live sample. Because the sample is typed
    // `Required<WorkItemTypeDefinitionDto>`, a new contract field forces it to be
    // populated; this assertion then fails until EXERCISED_AXES is updated too,
    // surfacing the new axis to whoever extends the renderer.
    expect(new Set(Object.keys(fullDefinition))).toEqual(
      new Set(EXERCISED_AXES),
    );
  });

  it("keeps the complete definition collapsed until the reviewer opens it", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <WorkItemTypeCreateRenderer
          proposal={makeProposal(fullDefinition)}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>,
    );

    const toggle = screen.getByRole("button", {
      name: "Complete proposed definition",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("renders the name/key header and every DTO axis read-only", () => {
    render(
      <MemoryRouter>
        <WorkItemTypeCreateRenderer
          proposal={makeProposal(fullDefinition)}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>,
    );

    // The shared header carries only identity and Create/type badges; the
    // stable type key remains part of the complete definition below it.
    expect(screen.getByText("Marketing Campaign")).toBeInTheDocument();
    expect(
      screen.getByTestId("proposal-identity-header"),
    ).not.toHaveTextContent("MARKETING");
    expect(screen.getByTestId("work-item-type-key")).toHaveTextContent(
      "MARKETING",
    );
    expect(screen.getByTestId("work-item-type-role")).toHaveTextContent(
      "work-item",
    );
    expect(screen.getByTestId("work-item-type-icon-key")).toHaveTextContent(
      "Contract",
    );

    // Description, per-section writing standards, and the type-level
    // create/edit writing standards all render as markdown prose.
    const prose = screen.getAllByTestId("markdown").map((el) => el.textContent);
    expect(prose).toContain(
      "Captures a marketing campaign and its launch plan.",
    );
    expect(prose).toContain("Describe the target audience precisely.");
    expect(prose).toContain("List the distribution channels.");
    expect(prose).toContain("Lead with the campaign objective.");
    expect(prose).toContain("Preserve the original objective.");
    expect(screen.getByText("Purpose")).toBeInTheDocument();
    expect(screen.getByText("Writing standards")).toBeInTheDocument();
    expect(screen.getByText("Writing standard — Create")).toBeInTheDocument();
    expect(screen.getByText("Writing standard — Edit")).toBeInTheDocument();
    expect(screen.getAllByText("Section writing standard")).toHaveLength(2);

    // Sections show the human label; the internal section key is hidden.
    expect(screen.getByText("Audience")).toBeInTheDocument();
    expect(screen.queryByText("audience")).not.toBeInTheDocument();
    expect(screen.getByText("Channels")).toBeInTheDocument();
    expect(screen.queryByText("channels")).not.toBeInTheDocument();

    // Required and forbidden scalar fields, rendered as humanized field names.
    expect(screen.getByText("Due Date")).toBeInTheDocument();
    expect(screen.getByText("Tag")).toBeInTheDocument();

    // Allowed statuses rendered with human labels. Backlog and In progress are
    // also agent-settable, so they appear in both the allowed and
    // agent-settable blocks.
    expect(screen.getAllByText("Backlog").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("In progress").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Completed")).toBeInTheDocument();

    // Child-owned placement declares only allowed parents. FEATURE also appears
    // as an edge target, so assert at least one occurrence.
    expect(
      screen.getByTestId("work-item-type-allowed-parents"),
    ).toHaveTextContent("FEATURE");
    expect(
      screen.queryByTestId("work-item-type-allowed-children"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("FEATURE").length).toBeGreaterThan(0);

    // Parent entity types rendered as humanized EntityType labels.
    expect(screen.getByText("Initiative")).toBeInTheDocument();

    // Edge targets: humanized edge type, target keys, and "Any type" fallback.
    expect(screen.getByText("Depends On")).toBeInTheDocument();
    expect(screen.getByText("Related To")).toBeInTheDocument();
    expect(screen.getByText("Any type")).toBeInTheDocument();

    // Target-owned tracking renders the allowed inbound source categories and
    // work-item type keys.
    expect(screen.getByText("Allowed Source Entity Types")).toBeInTheDocument();
    expect(screen.getByText("Allowed Source Type Keys")).toBeInTheDocument();
    expect(screen.getByText("Task")).toBeInTheDocument();
    expect(screen.getByText("GOAL")).toBeInTheDocument();

    // Anchorable report types rendered as humanized ReportType labels.
    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByText("Implement")).toBeInTheDocument();

    // Every declared capability keeps its explicit enabled/disabled value;
    // undeclared optional capabilities leave no trace.
    expect(screen.getByText("Requires Parent: Yes")).toBeInTheDocument();
    expect(screen.queryByText(/Hierarchy Node/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Plan Eligible/)).not.toBeInTheDocument();
  });

  it("shows each supplied session role in CREATE review", () => {
    render(
      <MemoryRouter>
        <WorkItemTypeCreateRenderer
          proposal={makeProposal({
            ...fullDefinition,
            sessionRoleGuidance: {
              implementation: "Build advice",
              research: "Research advice",
              planning: "Plan advice",
            },
          })}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>,
    );
    const group = screen.getByTestId("work-item-type-create-role-guidance");
    expect(group).toHaveTextContent("implementation");
    expect(group).toHaveTextContent("Build advice");
    expect(group).toHaveTextContent("Research advice");
    expect(group).toHaveTextContent("Plan advice");
    expect(group).not.toHaveTextContent("review");
  });

  it("does not crash and shows only the header for a minimal definition", () => {
    const minimal = makeProposal({
      key: "MINIMAL",
      name: "Minimal Type",
      role: "project-info",
      sections: [],
      allowedStatuses: [],
    });

    render(
      <MemoryRouter>
        <WorkItemTypeCreateRenderer
          proposal={minimal}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Minimal Type")).toBeInTheDocument();
    expect(screen.getByText("MINIMAL")).toBeInTheDocument();
    expect(screen.queryAllByTestId("markdown")).toHaveLength(0);
  });

  it("invokes onApply when the Create control is clicked", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();

    render(
      <MemoryRouter>
        <WorkItemTypeCreateRenderer
          proposal={makeProposal(fullDefinition)}
          status={{ state: "pending" }}
          onApply={onApply}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("renders a retained stable-key CREATE as a restoration review", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();

    render(
      <MemoryRouter>
        <WorkItemTypeCreateRenderer
          proposal={makeProposal(fullDefinition, RETAINED_TARGET_ID)}
          status={{ state: "pending" }}
          onApply={onApply}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("proposal-header-action")).toHaveTextContent(
      "Create",
    );
    expect(screen.getByTestId("proposal-header-type")).toHaveTextContent(
      "Work Item Type",
    );
    expect(
      screen.getByTestId("work-item-type-restore-review"),
    ).toHaveTextContent("new-work choices");
    expect(screen.getByText("Marketing Campaign")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Restore" }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("hides approval for a project MEMBER and shows it to an ARCHITECT", () => {
    vi.mocked(useProjectCapabilities).mockReturnValue(
      projectCapabilitiesForRole(ProjectRole.Member),
    );
    const { unmount } = render(
      <MemoryRouter>
        <WorkItemTypeCreateRenderer
          proposal={makeProposal(fullDefinition)}
          status={{ state: "pending" }}
          onApply={vi.fn()}
          onReject={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("proposal-approve")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    unmount();

    vi.mocked(useProjectCapabilities).mockReturnValue(
      projectCapabilitiesForRole(ProjectRole.Architect),
    );
    render(
      <MemoryRouter>
        <WorkItemTypeCreateRenderer
          proposal={makeProposal(fullDefinition)}
          status={{ state: "pending" }}
          onApply={vi.fn()}
          onReject={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("proposal-approve")).toBeInTheDocument();
  });

  it("keeps a non-matching target from being mislabeled as restoration", () => {
    render(
      <MemoryRouter>
        <WorkItemTypeCreateRenderer
          proposal={makeProposal(fullDefinition, "legacy-target")}
          status={{ state: "pending" }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Work Item Type")).toBeInTheDocument();
    expect(screen.getByTestId("proposal-header-action")).toHaveTextContent(
      "Create",
    );
    expect(
      screen.queryByTestId("work-item-type-restore-review"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });

  it("invokes onReject with the entered reason via the Reject control", async () => {
    const user = userEvent.setup();
    const onReject = vi.fn().mockResolvedValue(undefined);

    render(
      <MemoryRouter>
        <WorkItemTypeCreateRenderer
          proposal={makeProposal(fullDefinition)}
          status={{ state: "pending" }}
          onApply={() => {}}
          onReject={onReject}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Reject" }));
    await user.type(
      screen.getByLabelText("Reason for rejection"),
      "Not the right shape",
    );
    // The dialog's confirm button is the second "Reject" button.
    const rejectButtons = screen.getAllByRole("button", { name: "Reject" });
    await user.click(rejectButtons[rejectButtons.length - 1]);

    expect(onReject).toHaveBeenCalledWith("Not the right shape");
  });
});
