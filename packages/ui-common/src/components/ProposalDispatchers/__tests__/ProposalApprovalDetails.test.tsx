import userEvent from "@testing-library/user-event";
import {
  getApprovalProgress,
  formatApprovalStatus,
} from "../../../permissions";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProposalApprovalExplanation,
  ProposalResponseDto,
} from "../../../api";
import { dataClient } from "../../../clients/dataClient";
import {
  proposalsClient,
  unifiedApiClient,
} from "../../../clients/serviceClients";
import {
  ProposalApprovalDetails,
  OrdinaryProposalApprovalReview,
} from "../ProposalApprovalDetails";
import { ProposalStateIndicator } from "../ProposalStateIndicator";
import { CreateProposal } from "../CreateProposal";
import { UpdateProposal } from "../UpdateProposal";
import { DeleteProposal } from "../DeleteProposal";

vi.mock("../../../clients/serviceClients", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../clients/serviceClients")>();
  return {
    ...actual,
    unifiedApiClient: { ...actual.unifiedApiClient, getDesignDoc: vi.fn() },
    proposalsClient: {
      ...actual.proposalsClient,
      getProposalReconciliation: vi.fn(),
    },
  };
});

const explanation: ProposalApprovalExplanation = {
  evidence: "LIVE",
  source: "PROJECT",
  conditions: {
    typeKey: "MARKETING",
    author: "USER",
    action: "UPDATE",
    change: "CONTENT_CHANGE",
  },
  requirement: { category: "PROJECT_REQUIRED", requiredApprovals: 2 },
  changedFields: ["status", "sections.audience"],
  changedFieldClassification: {
    statusOnlyChange: false,
    contentChange: true,
    featureContentChange: false,
  },
  creditedProposerApprovals: 1,
  viewerEligibility: { eligibleToApprove: true },
};
function proposal(
  overrides: Partial<ProposalResponseDto> = {},
): ProposalResponseDto {
  return {
    id: "review",
    organizationId: "organization",
    projectId: "project",
    type: "SINGLE",
    action: "UPDATE",
    status: "DRAFT",
    targetEntityId: "document",
    targetEntityType: "DESIGN_DOC",
    title: "Review document",
    updates: { name: "Updated document" },
    requestorId: "author",
    requiredApprovals: 2,
    approvals: [
      { userId: "author", type: "APPROVAL", createdAt: "2026-10-31T00:00:00Z" },
    ],
    outOfDateStatus: "NOT_APPLICABLE",
    createdAt: "2026-10-31T00:00:00Z",
    updatedAt: "2026-10-31T00:00:00Z",
    approvalExplanation: explanation,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(dataClient, "request").mockResolvedValue({ data: { data: [] } });
  vi.spyOn(unifiedApiClient, "getDesignDoc").mockResolvedValue({
    data: { data: { id: "document", name: "Current document", sections: [] } },
  } as never);
  vi.spyOn(proposalsClient, "getProposalReconciliation").mockResolvedValue({
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

describe("ordinary approval review", () => {
  it("renders the API rule, counts, proposer credit and combined-edit reason with an expandable explanation", () => {
    render(<ProposalApprovalDetails proposal={proposal()} />);
    expect(screen.getByText("1 of 2 human approvals")).toBeVisible();
    expect(
      screen.getByText("MARKETING · User · Update · Content changes"),
    ).toBeVisible();
    expect(screen.getByText("Project configuration")).toBeVisible();
    expect(screen.getByText(/1 approval credited/)).toBeVisible();
    expect(
      screen.getByText(/Status and content changed together/),
    ).toBeVisible();
    fireEvent.click(screen.getByTestId("proposal-approval-details-toggle"));
    expect(
      screen.getByText("MARKETING · User · Update · Content changes"),
    ).not.toBeVisible();
  });

  it("shows captured immediate history and explicit unavailable legacy history", () => {
    const { rerender } = render(
      <ProposalApprovalDetails
        proposal={proposal({
          status: "APPROVED",
          requiredApprovals: 0,
          approvalExplanation: {
            ...explanation,
            evidence: "CAPTURED",
            requirement: { category: "IMMEDIATE", requiredApprovals: 0 },
          },
        })}
      />,
    );
    expect(screen.getByText("Applied immediately")).toBeVisible();
    expect(screen.getByText(/audit record/)).toBeVisible();
    expect(screen.getByText(/Later settings changes/)).toBeVisible();
    rerender(
      <ProposalApprovalDetails
        proposal={proposal({
          status: "APPROVED",
          requiredApprovals: null,
          approvalExplanation: {
            evidence: "UNAVAILABLE",
            source: null,
            conditions: null,
            requirement: null,
            changedFields: null,
            changedFieldClassification: null,
            creditedProposerApprovals: null,
            viewerEligibility: { eligibleToApprove: false },
          },
        })}
      />,
    );
    expect(
      screen.getByText(/Historical approval details are unavailable/),
    ).toBeVisible();
    expect(screen.queryByText("Project configuration")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    const unknown = getApprovalProgress(null, []);
    expect(unknown.isMet).toBe(false);
    expect(formatApprovalStatus(unknown)).toBe(
      "Historical approval requirement unavailable",
    );
  });

  it("exposes a keyboard-focusable native disclosure, labelled progress and fixed-rule explanation", async () => {
    const user = userEvent.setup();
    render(
      <ProposalApprovalDetails
        proposal={proposal({
          requiredApprovals: 1,
          approvals: [],
          approvalExplanation: {
            ...explanation,
            source: "FIXED",
            creditedProposerApprovals: 0,
            requirement: { category: "FIXED_REQUIRED", requiredApprovals: 1 },
          },
        })}
      />,
    );
    expect(
      screen.getByRole("progressbar", { name: "0 of 1 human approvals" }),
    ).toHaveAttribute("max", "1");
    await user.tab();
    expect(
      screen.getByTestId("proposal-approval-details-toggle"),
    ).toHaveFocus();
    expect(screen.getByText("Fixed rule")).toBeVisible();
    expect(screen.getByText(/cannot change this fixed rule/)).toBeVisible();
    expect(
      screen.getByText("No human proposer approval credited."),
    ).toBeVisible();
    await user.click(screen.getByTestId("proposal-approval-details-toggle"));
    expect(screen.getByText("Fixed rule")).not.toBeVisible();
  });

  it("uses current API eligibility for approval while preserving terminal retries", () => {
    const onApply = vi.fn();
    const item = proposal({
      approvalExplanation: {
        ...explanation,
        viewerEligibility: { eligibleToApprove: false },
      },
    });
    const { rerender } = render(
      <OrdinaryProposalApprovalReview proposal={item} renderMode="standalone">
        <ProposalStateIndicator
          status={{ state: "pending" }}
          action="UPDATE"
          onApply={onApply}
        />
      </OrdinaryProposalApprovalReview>,
    );
    expect(screen.queryByTestId("proposal-approve")).toBeNull();
    rerender(
      <OrdinaryProposalApprovalReview
        proposal={{
          ...item,
          status: "APPROVED",
          approvalExplanation: {
            ...explanation,
            evidence: "CAPTURED",
            viewerEligibility: { eligibleToApprove: false },
          },
        }}
        renderMode="standalone"
      >
        <ProposalStateIndicator
          status={{ state: "failed", error: "Try again" }}
          action="UPDATE"
          onApply={onApply}
        />
      </OrdinaryProposalApprovalReview>,
    );
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onApply).toHaveBeenCalledOnce();
  });

  it.each([
    "group-member",
    "evaluation-output",
    "future-review",
    "reconciliation-refinement",
  ] as const)(
    "preserves the %s layout without adding an ordinary panel",
    (renderMode) => {
      render(
        <OrdinaryProposalApprovalReview
          proposal={proposal()}
          renderMode={renderMode}
        >
          <span>Existing specialized review</span>
        </OrdinaryProposalApprovalReview>,
      );
      expect(screen.getByText("Existing specialized review")).toBeVisible();
      expect(screen.queryByTestId("proposal-approval-details")).toBeNull();
    },
  );

  it.each(["CREATE", "UPDATE", "DELETE"] as const)(
    "wires one panel through the shared %s dispatcher and preserves its approval callback",
    async (action) => {
      const item = proposal({
        id: `review-${action}`,
        action,
        updates:
          action === "CREATE"
            ? { name: "New document", sections: [] }
            : action === "UPDATE"
              ? { name: "Updated document" }
              : {},
      });
      const onApply = vi.fn().mockResolvedValue(undefined);
      const common = {
        proposals: [item],
        organizationId: item.organizationId,
        projectId: item.projectId,
        onApply,
      };
      render(
        <MemoryRouter>
          {action === "CREATE" ? (
            <CreateProposal {...common} />
          ) : action === "UPDATE" ? (
            <UpdateProposal {...common} />
          ) : (
            <DeleteProposal {...common} />
          )}
        </MemoryRouter>,
      );
      expect(
        await screen.findByRole("button", { name: /add approval/i }),
      ).toBeEnabled();
      expect(screen.getAllByTestId("proposal-approval-details")).toHaveLength(
        1,
      );
      fireEvent.click(screen.getByRole("button", { name: /add approval/i }));
      await waitFor(() => expect(onApply).toHaveBeenCalled());
    },
  );
});
