import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FutureApplicability,
  FutureApplyResponse,
  FutureRevisionResponse,
} from "../../../api";
import { ProposalReconciliationContext } from "../../ProposalReconciliation/ProposalReconciliationReview";
import { FutureApplication } from "../FutureApplication";

const api = vi.hoisted(() => ({
  apply: vi.fn(),
  readiness: vi.fn(),
  invalidate: vi.fn(),
  createProposal: vi.fn(),
  updateProposal: vi.fn(),
  getProposal: vi.fn(),
  rejectProposal: vi.fn(),
}));
vi.mock("../../../clients/serviceClients", () => ({
  proposalsClient: {
    applyProposalFuture: api.apply,
    getProposalFutureApplicability: api.readiness,
    createProposal: api.createProposal,
    updateProposal: api.updateProposal,
    getProposal: api.getProposal,
    rejectProposal: api.rejectProposal,
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
  api.getProposal.mockResolvedValue({
    data: {
      data: {
        id: "pending",
        status: "DRAFT",
        updates: { operation: "REVISE" },
      },
    },
  });
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

    expect(await screen.findByText("✓ Applied")).toBeInTheDocument();
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
    await screen.findByText("✓ Applied");
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
  "keeps Apply guarded for %s while the shared comparison owns recovery",
  async (blocker) => {
    api.readiness.mockResolvedValue({
      data: { data: { ...ready, canApply: false, blockers: [blocker] } },
    });
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <FutureApplication future={future} onApplied={onApplied} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(api.readiness).toHaveBeenCalled());
    expect(screen.getByTestId("future-apply")).toBeDisabled();
    expect(api.apply).not.toHaveBeenCalled();
  },
);

it("withholds Apply while a fix awaits review even when the last readiness read was eligible", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const tree = (approvalDisabled: boolean) => (
    <QueryClientProvider client={client}>
      <ProposalReconciliationContext.Provider
        value={{
          approvalDisabled,
          state: null,
          standaloneUpdate: false,
          future: true,
          staged: true,
          submit: vi.fn(),
        }}
      >
        <FutureApplication future={future} onApplied={onApplied} />
      </ProposalReconciliationContext.Provider>
    </QueryClientProvider>
  );
  const view = render(tree(true));
  await waitFor(() => expect(api.readiness).toHaveBeenCalled());
  expect(screen.getByTestId("future-apply")).toBeDisabled();
  expect(api.apply).not.toHaveBeenCalled();
  view.rerender(tree(false));
  await waitFor(() => expect(screen.getByTestId("future-apply")).toBeEnabled());
  expect(api.apply).not.toHaveBeenCalled();
});

async function openCancel() {
  await waitFor(() =>
    expect(screen.getByTestId("future-cancel")).toBeEnabled(),
  );
  fireEvent.click(screen.getByTestId("future-cancel"));
}

describe("cancelling an unapplied future", () => {
  it("offers Cancel only while the future is approved and unapplied", async () => {
    const { unmount } = mount();
    await screen.findByTestId("future-cancel");
    unmount();
    mount({ ...future, outcome: "APPLIED" });
    await screen.findByTestId("future-application");
    expect(screen.getByText(/Applied/)).toBeTruthy();
    expect(screen.queryByTestId("future-cancel")).toBeNull();
  });

  it("lists pending revisions and sends nothing when declined", async () => {
    mount();
    await openCancel();
    expect(screen.getByTestId("future-cancel-refinements")).toBeTruthy();
    expect(screen.getByText("Proposed refinement")).toBeTruthy();
    fireEvent.click(screen.getByTestId("future-cancel-decline"));
    expect(api.createProposal).not.toHaveBeenCalled();
  });

  it("cancels on confirmation: submits the CANCEL for the reviewed revision and refinements and records the user's approval", async () => {
    api.createProposal.mockResolvedValue({
      data: { data: { id: "cancel", status: "DRAFT" } },
    });
    api.updateProposal.mockResolvedValue({
      data: { data: { id: "cancel", status: "APPROVED" } },
    });
    mount();
    await openCancel();
    fireEvent.click(screen.getByTestId("future-cancel-confirm"));
    await waitFor(() => expect(api.updateProposal).toHaveBeenCalled());
    expect(api.createProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        createProposalRequestDto: expect.objectContaining({
          action: "VERSIONED_UPDATE",
          targetEntityId: future.targetEntityId,
          updates: {
            operation: "CANCEL",
            futureId: future.id,
            expectedRevision: future.revision,
            reviewedRefinementProposalIds: ["pending"],
          },
        }),
      }),
    );
    expect(api.updateProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: "cancel",
        updateProposalDto: { status: "APPROVED" },
      }),
    );
    expect(api.apply).not.toHaveBeenCalled();
    expect(screen.queryByTestId("future-cancel-pending")).toBeNull();
  });

  const pendingCancel = (reviewed?: string[]) => ({
    data: {
      data: {
        id: "cancel",
        status: "DRAFT",
        updates: {
          operation: "CANCEL",
          futureId: future.id,
          expectedRevision: 2,
          ...(reviewed ? { reviewedRefinementProposalIds: reviewed } : {}),
        },
      },
    },
  });
  const withOutstanding = (...ids: string[]): FutureRevisionResponse => ({
    ...future,
    outstandingRefinementProposalIds: new Set(ids) as never,
  });

  it("finds a pending cancellation from the future's own pending proposals and clears it when it is gone", async () => {
    api.getProposal.mockResolvedValue(pendingCancel(["pending"]));
    const first = mount(withOutstanding("pending", "cancel"));
    await screen.findByTestId("future-cancel-pending");
    expect(screen.getByTestId("future-cancel")).toBeDisabled();
    first.unmount();

    api.getProposal.mockResolvedValue({
      data: { data: { id: "pending", status: "DRAFT", updates: {} } },
    });
    mount();
    await waitFor(() =>
      expect(screen.getByTestId("future-cancel")).toBeEnabled(),
    );
    expect(screen.queryByTestId("future-cancel-pending")).toBeNull();
  });

  it("reports a failed lookup separately and does not offer Cancel", async () => {
    api.getProposal.mockRejectedValue(new Error("lookup failed"));
    mount();
    await screen.findByTestId("future-cancel-lookup-failed");
    expect(screen.getByTestId("future-cancel")).toBeDisabled();
    expect(screen.queryByTestId("future-cancel-pending")).toBeNull();
  });

  it("shows the server's re-review message when approval conflicts, and replaces a stale request after re-review", async () => {
    api.createProposal.mockResolvedValue({
      data: { data: { id: "stale", status: "DRAFT" } },
    });
    api.updateProposal.mockRejectedValue({
      response: {
        status: 409,
        data: { message: "Pending revisions changed; review them again." },
      },
      message: "Pending revisions changed; review them again.",
    });
    const view = mount();
    await openCancel();
    fireEvent.click(screen.getByTestId("future-cancel-confirm"));
    await screen.findByText(/review them again/);
    view.unmount();

    api.getProposal.mockResolvedValue({
      data: {
        data: {
          id: "stale",
          status: "DRAFT",
          updates: {
            operation: "CANCEL",
            futureId: future.id,
            expectedRevision: 2,
            reviewedRefinementProposalIds: ["pending"],
          },
        },
      },
    });
    api.rejectProposal.mockResolvedValue({ data: { data: {} } });
    api.createProposal.mockClear();
    api.createProposal.mockResolvedValue({
      data: { data: { id: "fresh", status: "APPROVED" } },
    });
    api.updateProposal.mockReset();
    mount(withOutstanding("pending", "newer", "stale"));
    await screen.findByTestId("future-cancel-stale");
    await openCancel();
    fireEvent.click(screen.getByTestId("future-cancel-confirm"));
    await waitFor(() => expect(api.createProposal).toHaveBeenCalledTimes(1));
    expect(api.rejectProposal).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: "stale" }),
    );
    expect(
      api.createProposal.mock.calls[0]![0].createProposalRequestDto.updates
        .reviewedRefinementProposalIds,
    ).toEqual(["pending", "newer"]);
  });
});
