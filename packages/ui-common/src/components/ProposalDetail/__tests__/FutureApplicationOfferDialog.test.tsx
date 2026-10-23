import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FutureApplicationOffer } from "../../../api";
import { FutureApplicationOfferDialog } from "../FutureApplicationOfferDialog";

const api = vi.hoisted(() => ({
  offers: vi.fn(),
  future: vi.fn(),
  apply: vi.fn(),
}));
vi.mock("../../../clients/serviceClients", () => ({
  proposalsClient: {
    listProposalFutureOffers: api.offers,
    getProposalFuture: api.future,
  },
}));
vi.mock("../FutureProposalLink", () => ({
  FutureProposalLink: () => <a href="/proposal">Reviewed knowledge</a>,
}));
vi.mock("../FutureApplication", () => ({
  FutureApplication: () => (
    <button data-testid="future-apply" onClick={api.apply}>
      Apply
    </button>
  ),
}));

const offer: FutureApplicationOffer = {
  futureId: "future",
  proposalId: "proposal",
  proposalTitle: "Reviewed knowledge",
  targetEntityType: "DESIGN_DOC",
  targetEntityId: "doc",
  applicability: {
    revision: 1,
    canApply: true,
    blockers: [],
    completionEligibility: { eligible: true, blockers: [] },
  },
};

function mount(open = true, onClose = vi.fn()) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <FutureApplicationOfferDialog
        organizationId="org"
        projectId="project"
        taskId="task"
        open={open}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
}

describe("FutureApplicationOfferDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.offers.mockResolvedValue({ data: { data: [offer] } });
    api.future.mockResolvedValue({ data: { data: { id: "future" } } });
  });

  it("offers linked futures without applying until the user chooses Apply", async () => {
    mount();
    await screen.findByText("Apply 1 linked future?");
    expect(api.offers).toHaveBeenCalledWith({
      organizationId: "org",
      projectId: "project",
      dependencyTaskId: "task",
    });
    await screen.findByTestId("future-apply");
    expect(api.apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("future-apply"));
    expect(api.apply).toHaveBeenCalledTimes(1);
  });

  it("dismisses without applying", async () => {
    const onClose = vi.fn();
    mount(true, onClose);
    fireEvent.click(await screen.findByTestId("future-offer-dismiss"));
    expect(onClose).toHaveBeenCalled();
    expect(api.apply).not.toHaveBeenCalled();
  });

  it("shows nothing when closed or when no unapplied futures remain", async () => {
    mount(false);
    expect(api.offers).not.toHaveBeenCalled();
    api.offers.mockResolvedValue({ data: { data: [] } });
    mount();
    await waitFor(() => expect(api.offers).toHaveBeenCalled());
    expect(screen.queryByTestId("future-offer-dialog")).toBeNull();
  });
});
