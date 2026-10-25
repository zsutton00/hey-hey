import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { FutureApplicationOffer, ProposalResponseDto } from "../../../api";
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
vi.mock("../../../data/hooks/useProposal", () => ({
  useProposal: (_org: string, _project: string, proposalId: string) => ({
    proposal: { id: proposalId, title: proposalId },
    isLoading: false,
    error: null,
  }),
}));
vi.mock("../../ProposalDispatchers/UpdateProposal", () => ({
  UpdateProposal: ({
    proposals,
    onApplied,
    renderFutureFooter,
  }: {
    proposals: ProposalResponseDto[];
    onApplied: () => Promise<void>;
    renderFutureFooter: (content: React.ReactNode) => React.ReactNode;
  }) => (
    <>
      <p>Complete changes for {proposals[0].id}</p>
      {renderFutureFooter(
        <button
          data-testid="future-apply"
          onClick={async () => {
            api.apply(proposals[0].id);
            await onApplied();
          }}
        >
          Apply
        </button>,
      )}
    </>
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
    await screen.findByText("Review future revisions");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(
      await screen.findByText("Complete changes for proposal"),
    ).toBeVisible();
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

  it("selects title/readiness tabs with the keyboard and keeps applied revisions reviewable", async () => {
    const user = userEvent.setup();
    api.offers.mockResolvedValue({
      data: {
        data: [
          offer,
          {
            ...offer,
            futureId: "second",
            proposalId: "second-proposal",
            proposalTitle: "Activity diagram",
            applicability: {
              ...offer.applicability,
              canApply: false,
              blockers: ["COMPLETION_INCOMPLETE"],
            },
          },
        ],
      },
    });
    mount();
    const first = await screen.findByRole("tab", {
      name: "Reviewed knowledge Ready to apply",
    });
    const second = screen.getByRole("tab", {
      name: "Activity diagram Not ready to apply",
    });
    await user.click(first);
    await user.keyboard("{ArrowRight}");
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByText("Complete changes for second-proposal"),
    ).toBeVisible();
    await user.keyboard("{ArrowLeft}");
    api.offers.mockResolvedValue({
      data: {
        data: [
          {
            ...offer,
            futureId: "second",
            proposalId: "second-proposal",
            proposalTitle: "Activity diagram",
          },
        ],
      },
    });
    await user.click(
      within(screen.getByRole("tabpanel")).getByTestId("future-apply"),
    );
    expect(api.apply).toHaveBeenCalledWith("proposal");
    expect(
      await screen.findByRole("tab", { name: "Reviewed knowledge Applied" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Complete changes for proposal")).toBeVisible();
    await user.click(
      screen.getByRole("tab", { name: "Activity diagram Ready to apply" }),
    );
    expect(
      screen.getByText("Complete changes for second-proposal"),
    ).toBeVisible();
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
    const onClose = vi.fn();
    mount(true, onClose);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
