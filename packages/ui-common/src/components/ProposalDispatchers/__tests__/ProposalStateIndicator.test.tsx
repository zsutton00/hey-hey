import { proposalsClient } from "../../../clients/serviceClients";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  ProposalOutOfDateStatus,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type ProposalResponseDto,
} from "../../../api";
import {
  ProposalOutOfDateReview,
  ProposalStateIndicator,
} from "../ProposalStateIndicator";
import { ProposalPresentationContext } from "../ProposalPresentationContext";
import type { ApprovalProgress } from "../../../permissions";

const renderIndicator = (
  action: ProposalAction,
  onReject: (reason: string) => Promise<void> = vi.fn(),
  approvalProgress?: ApprovalProgress,
  applyLabel?: string,
) => {
  render(
    <ProposalStateIndicator
      status={{ state: "pending" }}
      action={action}
      onApply={vi.fn()}
      onReject={onReject}
      approvalProgress={approvalProgress}
      applyLabel={applyLabel}
    />,
  );
};

const openRejectDialog = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Reject" }));
  return screen.getByTestId("proposal-reject-reason-input");
};

describe("read-only proposal presentations", () => {
  it("removes an already-open rejection dialog when the presentation becomes historical", async () => {
    const onApply = vi.fn();
    const onReject = vi.fn();
    const view = (value: "actionable" | "read-only") => (
      <ProposalPresentationContext.Provider value={value}>
        <ProposalStateIndicator
          status={{ state: "pending" }}
          action={ProposalAction.Update}
          onApply={onApply}
          onReject={onReject}
        />
      </ProposalPresentationContext.Provider>
    );
    const { rerender } = render(view("actionable"));
    const input = await openRejectDialog();
    fireEvent.change(input, { target: { value: "Needs revision" } });
    rerender(view("read-only"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(onReject).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("retains approval failure evidence without a retry decision", () => {
    render(
      <ProposalPresentationContext.Provider value="read-only">
        <ProposalStateIndicator
          status={{ state: "failed", error: "Approval unavailable" }}
          action={ProposalAction.Create}
          onApply={vi.fn()}
        />
      </ProposalPresentationContext.Provider>,
    );
    expect(screen.getByText("Approval unavailable")).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("retains rejection failure evidence without a retry decision", async () => {
    const onReject = vi.fn().mockRejectedValue(new Error("Unavailable"));
    const view = (value: "actionable" | "read-only") => (
      <ProposalPresentationContext.Provider value={value}>
        <ProposalStateIndicator
          status={{ state: "pending" }}
          action={ProposalAction.Create}
          onApply={vi.fn()}
          onReject={onReject}
        />
      </ProposalPresentationContext.Provider>
    );
    const { rerender } = render(view("actionable"));
    await openRejectDialog();
    fireEvent.click(screen.getByTestId("proposal-reject-submit"));
    await screen.findByRole("button", { name: "Retry Reject" });
    rerender(view("read-only"));
    expect(screen.getByText("Rejection failed")).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(onReject).toHaveBeenCalledTimes(1);
  });
});

describe("ProposalStateIndicator approval state", () => {
  it.each([
    [ProposalAction.Create, "Created"],
    [ProposalAction.Update, "Updated"],
    [ProposalAction.Delete, "Deleted"],
    [ProposalAction.VersionedUpdate, "Revision approved"],
  ] as const)("labels completed %s proposals as %s", (action, label) => {
    const { rerender } = render(
      <ProposalStateIndicator
        status={{ state: "applying" }}
        action={action}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getByRole("progressbar")).toBeVisible();
    expect(screen.queryByText(label)).not.toBeInTheDocument();

    rerender(
      <ProposalStateIndicator
        status={{ state: "applied" }}
        action={action}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getByText(label)).toBeVisible();
    expect(screen.queryByText("Applied")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows API-owned single-approval progress with Approve", () => {
    renderIndicator(ProposalAction.Create, vi.fn(), {
      requiredApprovals: 1,
      approvalCount: 0,
      isMultiApproval: false,
      isMet: false,
    });

    expect(screen.getByTestId("proposal-approval-progress")).toHaveTextContent(
      "0 of 1 approvals",
    );
    expect(screen.getByTestId("proposal-approve")).toBeVisible();
    expect(screen.getByRole("button", { name: "Approve" })).toBeVisible();
  });

  it("shows API-owned multi-approval progress with Add approval", () => {
    renderIndicator(ProposalAction.Update, vi.fn(), {
      requiredApprovals: 3,
      approvalCount: 1,
      isMultiApproval: true,
      isMet: false,
    });

    const approveButton = screen.getByRole("button", {
      name: "Add approval",
    });
    const rejectButton = screen.getByRole("button", { name: "Reject" });
    const progress = screen.getByTestId("proposal-approval-progress");

    expect(progress).toHaveTextContent("1 of 3 approvals");
    expect(approveButton).toBeVisible();
    expect(approveButton.compareDocumentPosition(rejectButton)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(rejectButton.compareDocumentPosition(progress)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("uses the approval label instead of an action-specific apply label", () => {
    renderIndicator(
      ProposalAction.Create,
      vi.fn(),
      {
        requiredApprovals: 2,
        approvalCount: 0,
        isMultiApproval: true,
        isMet: false,
      },
      "Accept Type",
    );

    expect(screen.getByRole("button", { name: "Add approval" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Accept Type" }),
    ).not.toBeInTheDocument();
  });
});

describe("ProposalStateIndicator out-of-date approval state", () => {
  const proposal = (
    outOfDateStatus: ProposalOutOfDateStatus,
  ): ProposalResponseDto =>
    ({
      id: "proposal-1",
      organizationId: "org-1",
      projectId: "project-1",
      type: ProposalType.Single,
      action: ProposalAction.Update,
      status: ProposalStatus.Draft,
      targetEntityId: "task-1",
      targetEntityType: TargetEntityType.Task,
      updates: {},
      requestorId: "user-1",
      requiredApprovals: 1,
      approvals: [],
      outOfDateStatus,
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z",
    }) as ProposalResponseDto;

  const renderOutOfDateReview = (
    outOfDateStatus: ProposalOutOfDateStatus,
    onApply = vi.fn(),
  ) => {
    render(
      <ProposalOutOfDateReview
        proposal={proposal(outOfDateStatus)}
        onApply={onApply}
      >
        <ProposalStateIndicator
          status={{ state: "pending" }}
          action={ProposalAction.Update}
          onApply={vi.fn()}
        />
      </ProposalOutOfDateReview>,
    );
    return onApply;
  };

  it.each([
    ProposalOutOfDateStatus.Current,
    ProposalOutOfDateStatus.NotApplicable,
  ])("keeps %s proposals ungated", async (outOfDateStatus) => {
    const onApply = renderOutOfDateReview(outOfDateStatus);

    expect(
      screen.queryByTestId("proposal-out-of-date-review"),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("proposal-approve")).toBeEnabled(),
    );
    await userEvent.click(screen.getByTestId("proposal-approve"));
    expect(onApply).toHaveBeenCalledWith({});
  });

  it("requires reconciliation and never offers acknowledgement as approval", async () => {
    vi.mocked(proposalsClient.getProposalReconciliation).mockResolvedValueOnce({
      data: {
        data: {
          status: "RECONCILIATION_REQUIRED",
          currentBases: [],
          revisions: [],
          conflictingPaths: [],
          interveningProposals: [],
          overlaps: [],
        },
      },
    } as never);
    const onApply = renderOutOfDateReview(ProposalOutOfDateStatus.Current);
    expect(
      await screen.findByTestId("proposal-reconciliation-agent-fix"),
    ).toBeVisible();
    expect(
      screen.queryByTestId("proposal-reconciliation-merge"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("proposal-approve")).toBeDisabled();
    expect(
      screen.queryByTestId("proposal-out-of-date-acknowledgement"),
    ).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("leaves an approved proposal's indicator alone, with no out-of-date controls", async () => {
    vi.mocked(proposalsClient.getProposalReconciliation).mockClear();
    render(
      <ProposalOutOfDateReview
        proposal={{
          ...proposal(ProposalOutOfDateStatus.Current),
          status: ProposalStatus.Approved,
        }}
        onApply={vi.fn()}
      >
        <ProposalStateIndicator
          status={{ state: "applied" }}
          action={ProposalAction.Update}
          onApply={vi.fn()}
        />
      </ProposalOutOfDateReview>,
    );
    expect(screen.getByText("Updated")).toBeVisible();
    expect(
      screen.queryByTestId("proposal-reconciliation-merge"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("proposal-reconciliation-heads-up"),
    ).not.toBeInTheDocument();
    expect(proposalsClient.getProposalReconciliation).not.toHaveBeenCalled();
  });
});

describe("ProposalStateIndicator rejection dialog", () => {
  it("allows a CREATE proposal to be rejected with an empty reason", async () => {
    const onReject = vi.fn().mockResolvedValue(undefined);
    renderIndicator(ProposalAction.Create, onReject);

    await openRejectDialog();
    const submitButton = screen.getByTestId("proposal-reject-submit");

    expect(submitButton).toBeEnabled();
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(onReject).toHaveBeenCalledWith("");
    });
  });

  it.each([ProposalAction.Update, ProposalAction.Delete])(
    "requires a non-blank reason for %s proposals",
    async (action) => {
      const onReject = vi.fn().mockResolvedValue(undefined);
      renderIndicator(action, onReject);

      const reasonInput = await openRejectDialog();
      const submitButton = screen.getByTestId("proposal-reject-submit");

      expect(submitButton).toBeDisabled();
      fireEvent.keyDown(reasonInput, { key: "Enter", metaKey: true });
      expect(onReject).not.toHaveBeenCalled();

      await userEvent.type(reasonInput, "   ");
      expect(submitButton).toBeDisabled();

      await userEvent.type(reasonInput, "Needs revision");
      expect(submitButton).toBeEnabled();
    },
  );

  it("submits a trimmed valid reason once with Meta+Enter", async () => {
    const onReject = vi.fn().mockResolvedValue(undefined);
    renderIndicator(ProposalAction.Update, onReject);

    const reasonInput = await openRejectDialog();
    await userEvent.type(reasonInput, "  Needs revision  ");
    fireEvent.keyDown(reasonInput, { key: "Enter", metaKey: true });

    await waitFor(() => {
      expect(onReject).toHaveBeenCalledTimes(1);
    });
    expect(onReject).toHaveBeenCalledWith("Needs revision");
  });

  it("retains ordinary Enter behavior in the multiline reason input", async () => {
    const onReject = vi.fn().mockResolvedValue(undefined);
    renderIndicator(ProposalAction.Update, onReject);

    const reasonInput = await openRejectDialog();
    await userEvent.type(reasonInput, "First line{Enter}Second line");

    expect(reasonInput).toHaveValue("First line\nSecond line");
    expect(onReject).not.toHaveBeenCalled();
  });

  it("ignores composing and repeated Meta+Enter keydown events", async () => {
    const onReject = vi.fn().mockResolvedValue(undefined);
    renderIndicator(ProposalAction.Create, onReject);

    const reasonInput = await openRejectDialog();
    fireEvent.keyDown(reasonInput, {
      key: "Enter",
      metaKey: true,
      isComposing: true,
    });
    fireEvent.keyDown(reasonInput, {
      key: "Enter",
      metaKey: true,
      repeat: true,
    });

    expect(onReject).not.toHaveBeenCalled();
  });

  it("does not submit again while a rejection request is pending", async () => {
    let resolveRejection: (() => void) | undefined;
    const onReject = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRejection = resolve;
        }),
    );
    renderIndicator(ProposalAction.Create, onReject);

    const reasonInput = await openRejectDialog();
    fireEvent.keyDown(reasonInput, { key: "Enter", metaKey: true });
    fireEvent.keyDown(reasonInput, { key: "Enter", metaKey: true });

    expect(onReject).toHaveBeenCalledTimes(1);
    resolveRejection?.();

    await waitFor(() => {
      expect(screen.getByText("Rejected")).toBeInTheDocument();
    });
  });

  it("preserves rejection retry after a failed request", async () => {
    const onReject = vi
      .fn()
      .mockRejectedValueOnce(new Error("Request failed"))
      .mockResolvedValueOnce(undefined);
    renderIndicator(ProposalAction.Create, onReject);

    await openRejectDialog();
    await userEvent.click(screen.getByTestId("proposal-reject-submit"));

    const retryButton = await screen.findByRole("button", {
      name: "Retry Reject",
    });
    await userEvent.click(retryButton);
    await userEvent.click(screen.getByTestId("proposal-reject-submit"));

    await waitFor(() => {
      expect(onReject).toHaveBeenCalledTimes(2);
    });
  });
});

describe("approval gating", () => {
  it("hides approve but keeps reject when canApprove is false", () => {
    render(
      <ProposalStateIndicator
        status={{ state: "pending" }}
        action={ProposalAction.Update}
        onApply={vi.fn()}
        onReject={vi.fn()}
        canApprove={false}
      />,
    );

    expect(screen.queryByTestId("proposal-approve")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("hides the failed-state retry when canApprove is false", () => {
    render(
      <ProposalStateIndicator
        status={{ state: "failed", error: "Denied" }}
        action={ProposalAction.Update}
        onApply={vi.fn()}
        canApprove={false}
      />,
    );

    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Retry/ }),
    ).not.toBeInTheDocument();
  });
});

beforeEach(() => {
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

vi.mock("../../../clients/serviceClients", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../clients/serviceClients")>()),
  proposalsClient: {
    getProposalReconciliation: vi.fn(),
    createProposalReconciliationCandidate: vi.fn(),
  },
}));
