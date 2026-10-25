import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FutureApplicability,
  ProposalResponseDto,
  FutureApplyResponse,
  FutureRevisionResponse,
} from "../../../api";
import { FutureApplication } from "../FutureApplication";

const api = vi.hoisted(() => ({
  apply: vi.fn(),
  readiness: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("../../../clients/serviceClients", () => ({
  proposalsClient: {
    applyProposalFuture: api.apply,
    getProposalFutureApplicability: api.readiness,
  },
}));
vi.mock("../../../data/hooks/useInvalidateProposalReview", () => ({
  useInvalidateProposalReview: () => api.invalidate,
}));
vi.mock("../FutureProposalLink", () => ({
  FutureProposalLink: ({ proposalId }: { proposalId: string }) => (
    <a href={`/proposals/${proposalId}`}>Proposed refinement</a>
  ),
}));

vi.mock("../../ProposalReconciliation/ProposalReconciliationReview", () => ({
  ProposalReconciliationReview: () => (
    <div data-testid="shared-reconciliation">Reconcile reviewed change</div>
  ),
}));

const content = {
  id: "target",
  name: "Reviewed content",
  type: "FEATURE",
  organizationId: "org",
  projectId: "project",
  status: "BACKLOG",
  source: "user",
  sections: [],
} as const;
const future: FutureRevisionResponse = {
  id: "future",
  organizationId: "org",
  projectId: "project",
  targetEntityId: "target",
  targetEntityType: "TASK",
  revision: 2,
  outcome: "STAGED",
  originatingProposalId: "origin",
  latestProposalId: "reviewed",
  baseline: {
    kind: "LIVE",
    revision: "basis",
    content: { ...content, sections: [] },
  },
  result: { ...content, sections: [] },
  dependencies: [],
  dependencyPresentation: [],
  history: [],
  completionEligibility: { eligible: true, blockers: [] },
  outstandingRefinementProposalIds: new Set(["pending"]),
};
const confirmation = {
  revision: 2,
  refinements: [{ proposalId: "pending", updatedAt: "2026-09-28T00:00:00Z" }],
};
const ready: FutureApplicability = {
  revision: 2,
  canApply: true,
  blockers: [],
  completionEligibility: { eligible: true, blockers: [] },
};
const respond = (result: FutureApplyResponse) => ({ data: { data: result } });
const onApplied = vi.fn();
function mount(currentFuture: FutureRevisionResponse = future) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <FutureApplication future={currentFuture} onApplied={onApplied} />
    </QueryClientProvider>,
  );
}
async function start() {
  await waitFor(() => expect(screen.getByTestId("future-apply")).toBeEnabled());
  fireEvent.click(screen.getByTestId("future-apply"));
}
beforeEach(() => {
  vi.clearAllMocks();
  api.readiness.mockResolvedValue({ data: { data: ready } });
});

describe("manual future application", () => {
  it("shows readiness without applying an eligible future automatically", async () => {
    mount();
    await screen.findByText(
      "The linked work is done. Apply when you're ready.",
    );
    expect(screen.getByTestId("future-apply")).toBeEnabled();
    expect(api.readiness).toHaveBeenCalledWith(
      expect.objectContaining({ futureId: future.id }),
    );
    expect(api.apply).not.toHaveBeenCalled();
  });

  it("does not apply completed work automatically and blocks incomplete work", async () => {
    api.readiness.mockResolvedValue({
      data: {
        data: {
          ...ready,
          canApply: false,
          blockers: ["COMPLETION_INCOMPLETE"],
        },
      },
    });
    mount();
    await screen.findByText(
      "Waiting for linked work to reach Verifying (or a linked Plan to complete). You'll be asked to apply this then.",
    );
    expect(screen.getByTestId("future-apply")).toBeDisabled();
    expect(api.apply).not.toHaveBeenCalled();
  });

  it("refreshes API-owned readiness and enables Apply when blockers clear", async () => {
    api.readiness
      .mockResolvedValueOnce({
        data: {
          data: {
            ...ready,
            canApply: false,
            blockers: ["COMPLETION_INCOMPLETE"],
          },
        },
      })
      .mockResolvedValueOnce({ data: { data: ready } });
    mount();

    await screen.findByText(
      "Waiting for linked work to reach Verifying (or a linked Plan to complete). You'll be asked to apply this then.",
    );
    fireEvent.click(screen.getByTestId("future-refresh-readiness"));

    await waitFor(() =>
      expect(screen.getByTestId("future-apply")).toBeEnabled(),
    );
    expect(api.readiness).toHaveBeenCalledTimes(2);
    expect(api.apply).not.toHaveBeenCalled();
  });

  it("shows an already applied API outcome without an Apply action", async () => {
    mount({ ...future, outcome: "APPLIED", appliedRevision: 2 });

    expect(await screen.findByText("Applied version 2")).toBeInTheDocument();
    expect(screen.queryByTestId("future-apply")).not.toBeInTheDocument();
    expect(api.apply).not.toHaveBeenCalled();
  });

  it("cancels without sending confirmation, then sends exactly the API confirmation on explicit retry", async () => {
    api.apply.mockResolvedValue(
      respond({ status: "CONFIRMATION_REQUIRED", future, confirmation }),
    );
    mount();
    await start();
    await screen.findByText(
      "Apply the currently approved version? Pending revisions will be invalidated.",
    );
    fireEvent.click(screen.getByTestId("future-apply-cancel"));
    expect(api.apply).toHaveBeenCalledTimes(1);
    expect(onApplied).not.toHaveBeenCalled();
    await start();
    await waitFor(() =>
      expect(screen.getByTestId("future-apply-confirm")).toBeEnabled(),
    );
    api.apply.mockResolvedValue(
      respond({
        status: "APPLIED",
        future: { ...future, outcome: "APPLIED", appliedRevision: 2 },
      }),
    );
    fireEvent.click(screen.getByTestId("future-apply-confirm"));
    await screen.findByText("Applied version 2");
    expect(api.apply.mock.lastCall?.[0].futureApplyRequest).toEqual({
      expectedRevision: 2,
      confirmation,
    });
    expect(api.apply.mock.lastCall?.[0].futureId).toBe(future.id);
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("Invalidated pending revisions"),
    ).toBeInTheDocument();
  });
  it("requires another confirmation when the API returns a changed pending set", async () => {
    api.apply.mockResolvedValueOnce(
      respond({ status: "CONFIRMATION_REQUIRED", future, confirmation }),
    );
    mount();
    await start();
    await waitFor(() =>
      expect(screen.getByTestId("future-apply-confirm")).toBeEnabled(),
    );
    const changed = {
      ...confirmation,
      refinements: [
        { proposalId: "new-pending", updatedAt: "2026-09-28T01:00:00Z" },
      ],
    };
    api.apply.mockResolvedValue(
      respond({
        status: "CONFIRMATION_REQUIRED",
        future,
        confirmation: changed,
      }),
    );
    fireEvent.click(screen.getByTestId("future-apply-confirm"));
    await waitFor(() =>
      expect(screen.getByRole("link")).toHaveAttribute(
        "href",
        "/proposals/new-pending",
      ),
    );
    expect(api.apply).toHaveBeenCalledTimes(2);
    expect(onApplied).not.toHaveBeenCalled();
  });
  it("retains retry and does not report invalidation after failure", async () => {
    api.apply.mockRejectedValue(new Error("Application failed"));
    mount();
    await start();
    await screen.findByText(/Application failed/);
    expect(
      screen.queryByText("Invalidated pending revisions"),
    ).not.toBeInTheDocument();
    expect(onApplied).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId("future-apply")).toBeEnabled(),
    );
  });
});

it.each(["BASELINE_CHANGED", "BASELINE_UNAVAILABLE"] as const)(
  "opens shared reconciliation for %s while keeping Apply guarded",
  async (blocker) => {
    api.readiness.mockResolvedValue({
      data: { data: { ...ready, canApply: false, blockers: [blocker] } },
    });
    const proposal: ProposalResponseDto = {
      id: "reviewed",
      organizationId: "org",
      projectId: "project",
      type: "SINGLE",
      action: "VERSIONED_UPDATE",
      status: "APPROVED",
      targetEntityType: "TASK",
      targetEntityId: "target",
      updates: {},
      title: "Reviewed change",
      requestorId: "user",
      requiredApprovals: 1,
      approvals: [],
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
    };
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <FutureApplication
          future={future}
          onApplied={onApplied}
          reconciliationProposal={proposal}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId("shared-reconciliation")).toBeVisible();
    expect(screen.getByTestId("future-apply")).toBeDisabled();
    expect(api.apply).not.toHaveBeenCalled();
  },
);
