import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type ProposalResponseDto,
} from "../../../api";
import { CreateProposal } from "../CreateProposal";
import { PlanCreateRenderer } from "../PlanCreateRenderer";
import {
  PLACEHOLDER_ENTITY_ID,
  type CreatePlanProposalUpdates,
} from "../types";

vi.mock("../../../clients/serviceClients", () => ({
  proposalsClient: {
    updateProposal: vi
      .fn()
      .mockResolvedValue({ data: { data: {} } }),
    getProposal: vi
      .fn()
      .mockResolvedValue({ data: { data: {} } }),
  },
}));

const useConversationMock = vi.fn(() => ({ data: null }));
vi.mock("../../../data/hooks/useConversation", () => ({
  useConversation: (...args: unknown[]) => useConversationMock(...args),
}));

vi.mock("../../Features/FeaturePicker", () => ({
  FeaturePicker: ({
    label,
    value,
  }: {
    label?: string;
    value: string | null;
  }) => (
    <div
      data-testid="feature-picker"
      data-label={label}
      data-value={value ?? ""}
    >
      {label}
    </div>
  ),
}));

const ORG_ID = "org-1";
const PROJ_ID = "proj-1";
const PROPOSAL_ID = "prop-1";
const FEATURE_ID = "feature-7";

const planUpdates: CreatePlanProposalUpdates = {
  workflowName: "plan-from-design-doc",
  designDocMarkdown: "# Plan body\n\nInitial markdown.",
  planTitle: "Migrate auth flow",
  parentFeatureId: FEATURE_ID,
};

function makePlanProposal(
  overrides: Partial<CreatePlanProposalUpdates> = {}
): ProposalResponseDto & { updates: CreatePlanProposalUpdates } {
  return {
    id: PROPOSAL_ID,
    organizationId: ORG_ID,
    projectId: PROJ_ID,
    type: ProposalType.Single,
    action: ProposalAction.Create,
    status: ProposalStatus.Pending,
    targetEntityId: "00000000-0000-0000-0000-000000000000",
    targetEntityType: TargetEntityType.Conversation,
    updates: { ...planUpdates, ...overrides },
    requestorId: "user-1",
    requiredApprovals: 1,
    approvals: [],
    createdAt: "2026-05-05T00:00:00Z",
    updatedAt: "2026-05-05T00:00:00Z",
  } as unknown as ProposalResponseDto & { updates: CreatePlanProposalUpdates };
}

beforeEach(() => {
  vi.clearAllMocks();
  useConversationMock.mockReturnValue({ data: null });
});

describe("PlanCreateRenderer", () => {
  it("renders the plan title in the headline", () => {
    render(
      <MemoryRouter>
        <PlanCreateRenderer
          proposal={makePlanProposal()}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>
    );

    expect(
      screen.getByText(`Plan: ${planUpdates.planTitle}`)
    ).toBeInTheDocument();
  });

  it("uses 'Approve plan document' as the apply button label", () => {
    render(
      <MemoryRouter>
        <PlanCreateRenderer
          proposal={makePlanProposal()}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>
    );

    expect(
      screen.getByRole("button", { name: "Approve plan document" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /approve conversation/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^create$/i })
    ).not.toBeInTheDocument();
  });

  it("renders the design-doc markdown via MarkdownRenderer (no editor mounted)", () => {
    render(
      <MemoryRouter>
        <PlanCreateRenderer
          proposal={makePlanProposal()}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>
    );

    // The markdown body is handed to MarkdownRenderer for display.
    expect(screen.getByText(/Initial markdown\./)).toBeInTheDocument();

    // No textarea or editable surface should ever be mounted: the proposal
    // payload is display-only.
    expect(
      document.querySelector('textarea[aria-label="Plan design doc markdown"]')
    ).toBeNull();
    expect(
      screen.queryByLabelText("Plan design doc markdown")
    ).not.toBeInTheDocument();
  });

  it("does not switch to an editor when the rendered markdown is clicked", () => {
    render(
      <MemoryRouter>
        <PlanCreateRenderer
          proposal={makePlanProposal()}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>
    );

    const target = screen.getByText(/Initial markdown\./);
    fireEvent.click(target);

    expect(
      document.querySelector('textarea[aria-label="Plan design doc markdown"]')
    ).toBeNull();
  });

  it("renders the parent feature via FeaturePicker, seeded with the proposal's parentFeatureId", () => {
    render(
      <MemoryRouter>
        <PlanCreateRenderer
          proposal={makePlanProposal()}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>
    );

    const picker = screen.getByTestId("feature-picker");
    expect(picker).toBeInTheDocument();
    expect(picker.getAttribute("data-label")).toBe("Parent feature");
    expect(picker.getAttribute("data-value")).toBe(FEATURE_ID);
  });

  it("does not surface internal field names like workflowName or conversation IDs", () => {
    render(
      <MemoryRouter>
        <PlanCreateRenderer
          proposal={makePlanProposal()}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>
    );

    expect(screen.queryByText(/workflowName/)).not.toBeInTheDocument();
    expect(screen.queryByText(/plan-from-design-doc/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/00000000-0000-0000-0000-000000000000/)
    ).not.toBeInTheDocument();
  });

  it("renders the headline as plain text on a pending proposal (no link)", () => {
    render(
      <MemoryRouter>
        <PlanCreateRenderer
          proposal={makePlanProposal()}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>
    );

    const headline = screen.getByText(`Plan: ${planUpdates.planTitle}`);
    expect(headline.closest("a")).toBeNull();
  });

  it("renders the headline as plain text when applied but the entity id is still the placeholder", () => {
    render(
      <MemoryRouter>
        <PlanCreateRenderer
          proposal={makePlanProposal()}
          status={{ state: "applied" }}
          onApply={() => {}}
        />
      </MemoryRouter>
    );

    const headline = screen.getByText(`Plan: ${planUpdates.planTitle}`);
    expect(headline.closest("a")).toBeNull();
    expect(
      screen.queryByText(/00000000-0000-0000-0000-000000000000/)
    ).not.toBeInTheDocument();
  });

  it("renders the headline as plain text when the proposal was rejected", () => {
    const rejected = {
      ...makePlanProposal(),
      status: ProposalStatus.Rejected,
    } as ProposalResponseDto & { updates: CreatePlanProposalUpdates };

    render(
      <MemoryRouter>
        <PlanCreateRenderer
          proposal={rejected}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>
    );

    const headline = screen.getByText(`Plan: ${planUpdates.planTitle}`);
    expect(headline.closest("a")).toBeNull();
  });

  it("renders the headline as a routed plan link once apply has resolved a real plan", () => {
    const realConversationId = "conv-real-1";
    const realPlanId = "plan-mat-1";

    useConversationMock.mockImplementation(
      (
        _orgId: unknown,
        _projectId: unknown,
        queryOptions: { conversationId: string }
      ) => {
        if (queryOptions.conversationId === realConversationId) {
          return {
            data: {
              id: realConversationId,
              workflowAboutId: realPlanId,
              workflowAboutType: "plan",
            },
          };
        }
        return { data: null };
      }
    );

    const proposal = {
      ...makePlanProposal(),
      targetEntityId: realConversationId,
    } as ProposalResponseDto & { updates: CreatePlanProposalUpdates };

    render(
      <MemoryRouter>
        <PlanCreateRenderer
          proposal={proposal}
          status={{ state: "applied" }}
          onApply={() => {}}
        />
      </MemoryRouter>
    );

    const anchor = screen
      .getByText(`Plan: ${planUpdates.planTitle}`)
      .closest("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toContain(realPlanId);

    expect(screen.queryByText(/workflowAboutId/)).not.toBeInTheDocument();
    expect(screen.queryByText(realConversationId)).not.toBeInTheDocument();
    expect(screen.queryByText(/workflowName/)).not.toBeInTheDocument();
  });

  it("keeps the headline as plain text when the conversation has no workflowAboutId yet", () => {
    const realConversationId = "conv-real-2";
    useConversationMock.mockReturnValue({
      data: {
        id: realConversationId,
        workflowAboutId: undefined,
        workflowAboutType: "plan",
      },
    });

    const proposal = {
      ...makePlanProposal(),
      targetEntityId: realConversationId,
    } as ProposalResponseDto & { updates: CreatePlanProposalUpdates };

    render(
      <MemoryRouter>
        <PlanCreateRenderer
          proposal={proposal}
          status={{ state: "applied" }}
          onApply={() => {}}
        />
      </MemoryRouter>
    );

    const headline = screen.getByText(`Plan: ${planUpdates.planTitle}`);
    expect(headline.closest("a")).toBeNull();
  });

  it("does not enable the conversation fetch while the entity id is still a placeholder", () => {
    render(
      <MemoryRouter>
        <PlanCreateRenderer
          proposal={makePlanProposal()}
          status={{ state: "applied" }}
          onApply={() => {}}
        />
      </MemoryRouter>
    );

    const lastCall =
      useConversationMock.mock.calls[useConversationMock.mock.calls.length - 1];
    expect(lastCall).toBeDefined();
    const queryOptions = lastCall?.[2] as { conversationId: string };
    const callOptions = lastCall?.[3] as { enabled?: boolean };
    expect(queryOptions.conversationId).toBe(PLACEHOLDER_ENTITY_ID);
    expect(callOptions.enabled).toBe(false);
  });
});

describe("CreateProposal dispatcher — CONVERSATION fallback", () => {
  it("renders the generic fallback (not a crash) for CONVERSATION proposals that aren't plan-shaped", () => {
    const unrecognized = {
      id: "prop-other",
      organizationId: ORG_ID,
      projectId: PROJ_ID,
      type: ProposalType.Single,
      action: ProposalAction.Create,
      status: ProposalStatus.Pending,
      targetEntityId: "00000000-0000-0000-0000-000000000000",
      targetEntityType: TargetEntityType.Conversation,
      updates: { title: "Some other conversation", note: "n/a" },
      requestorId: "user-1",
      requiredApprovals: 1,
      approvals: [],
      createdAt: "2026-05-05T00:00:00Z",
      updatedAt: "2026-05-05T00:00:00Z",
    } as unknown as ProposalResponseDto;

    render(
      <MemoryRouter>
        <CreateProposal proposals={[unrecognized]} onApply={async () => {}} />
      </MemoryRouter>
    );

    expect(screen.getByText("Some other conversation")).toBeInTheDocument();
    expect(
      screen.queryByText(/Unsupported entity type/)
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/workflowName/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Generate plan" })
    ).not.toBeInTheDocument();
  });
});
