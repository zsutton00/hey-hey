import { type ReactNode } from "react";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ProjectContext } from "../../../contexts/ProjectContext";
import { FutureOfferProvider } from "../../futureOffers/FutureOfferProvider";
import {
  FutureOfferContext,
  useFutureOffers,
} from "../../futureOffers/FutureOfferContext";
import { useFutureOfferCheck } from "../useFutureOfferCheck";
import {
  ProposalAction,
  ProposalStatus,
  TargetEntityType,
  type FutureApplicationOffer,
  type ProposalResponseDto,
} from "../../../api";
const api = vi.hoisted(() => ({ offers: vi.fn(), future: vi.fn() }));
vi.mock("../../../clients/serviceClients", () => ({
  proposalsClient: {
    listProposalFutureOffers: api.offers,
    getProposalFuture: api.future,
  },
}));
vi.mock("../../../components/ProposalDetail/FutureProposalLink", () => ({
  FutureProposalLink: () => <span>Reviewed revision</span>,
}));
vi.mock("../../../components/ProposalDetail/FutureApplication", () => ({
  FutureApplication: () => <button>Apply</button>,
}));
const proposal = {
  id: "proposal",
  organizationId: "org",
  projectId: "project",
  action: ProposalAction.Update,
  status: ProposalStatus.Approved,
  targetEntityType: TargetEntityType.Task,
  targetEntityId: "task",
  updates: { status: "COMPLETED" },
} as ProposalResponseDto;
beforeEach(() => {
  vi.clearAllMocks();
  api.future.mockResolvedValue({ data: { data: { id: "future" } } });
});
describe("local completion checks", () => {
  it("uses the existing approval/materialization response and makes no polling requests", () => {
    const checkTask = vi.fn();
    const { result } = renderHook(() => useFutureOfferCheck(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <FutureOfferContext.Provider value={{ checkTask }}>
          {children}
        </FutureOfferContext.Provider>
      ),
    });
    act(() => {
      result.current({ ...proposal, status: ProposalStatus.Pending });
      result.current({
        ...proposal,
        materialization: { state: "QUEUED", attemptCount: 1, operations: [] },
      });
      result.current({
        ...proposal,
        materialization: {
          state: "RECOVERABLE_FAILURE",
          attemptCount: 1,
          operations: [],
        },
      });
    });
    expect(checkTask).not.toHaveBeenCalled();
    act(() => {
      result.current(proposal);
    });
    expect(checkTask).toHaveBeenCalledExactlyOnceWith("task");
    expect(api.offers).not.toHaveBeenCalled();
  });
  it("loads offers once per action, coalesces overlapping callers, and allows a fresh offer after dismissal", async () => {
    const offer = {
      futureId: "future",
      proposalId: "future-proposal",
      applicability: { revision: 1, blockers: [], canApply: true },
    } as FutureApplicationOffer;
    api.offers.mockResolvedValue({ data: { data: [offer] } });
    function Actions() {
      const offers = useFutureOffers();
      return (
        <button
          onClick={() => {
            offers?.checkTask("task");
            offers?.checkTask("task");
          }}
        >
          Complete
        </button>
      );
    }
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <ProjectContext.Provider
          value={{
            organizationId: "org",
            projectId: "project",
            navigate: vi.fn(),
          }}
        >
          <FutureOfferProvider>
            <Actions />
          </FutureOfferProvider>
        </ProjectContext.Provider>
      </QueryClientProvider>,
    );
    expect(api.offers).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Complete"));
    await screen.findByTestId("future-offer-dialog");
    expect(api.offers).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("future-offer-dismiss"));
    await waitFor(() =>
      expect(
        screen.queryByTestId("future-offer-dialog"),
      ).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Complete"));
    await screen.findByTestId("future-offer-dialog");
    expect(api.offers).toHaveBeenCalledTimes(2);
  });
  it("does not show a dialog when no approved unapplied futures remain", async () => {
    api.offers.mockResolvedValue({ data: { data: [] } });
    function Actions() {
      const offers = useFutureOffers();
      return (
        <button onClick={() => offers?.checkTask("task")}>Complete</button>
      );
    }
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <ProjectContext.Provider
          value={{
            organizationId: "org",
            projectId: "project",
            navigate: vi.fn(),
          }}
        >
          <FutureOfferProvider>
            <Actions />
          </FutureOfferProvider>
        </ProjectContext.Provider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText("Complete"));
    await waitFor(() => expect(api.offers).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("future-offer-dialog")).not.toBeInTheDocument();
  });
});
