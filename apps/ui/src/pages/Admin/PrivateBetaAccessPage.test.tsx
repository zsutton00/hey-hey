import type { PrivateBetaAccessRequestReviewDto } from "@hey-hey/ui-common/api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { PrivateBetaAccessPage } from "./PrivateBetaAccessPage";

const mocks = vi.hoisted(() => ({
  usePlatformAdminAccess: vi.fn(),
  useRequests: vi.fn(),
  useRequest: vi.fn(),
  useDecision: vi.fn(),
  mutate: vi.fn(),
  listRefetch: vi.fn(),
  detailRefetch: vi.fn(),
  useMode: vi.fn(),
  modeMutate: vi.fn(),
  modeRefetch: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  usePlatformAdminAccess: mocks.usePlatformAdminAccess,
  usePrivateBetaAccessRequests: mocks.useRequests,
  usePrivateBetaAccessRequest: mocks.useRequest,
  usePrivateBetaAccessRequestDecision: mocks.useDecision,
  usePrivateBetaAdmissionMode: mocks.useMode,
}));

const pendingRequest: PrivateBetaAccessRequestReviewDto = {
  requestId: "request-1",
  name: "Ada Lovelace",
  workEmail: "ada@example.com",
  organizationName: "Analytical Engines",
  teamSize: 5,
  productContext: "Developer tooling",
  accessRationale: "Evaluate agent-assisted planning",
  status: "PENDING",
  createdAt: "2026-08-12T00:00:00.000Z",
  decidedAt: null,
  provisioningOutcome: null,
};

const failedRequest: PrivateBetaAccessRequestReviewDto = {
  ...pendingRequest,
  status: "PROVISIONING_FAILED",
  decidedAt: "2026-08-12T01:00:00.000Z",
  provisioningOutcome: {
    status: "FAILED",
    attemptedAt: "2026-08-12T01:01:00.000Z",
    completedAt: "2026-08-12T01:02:00.000Z",
    organizationId: null,
    userId: null,
    failureCode: "ONBOARDING_UNAVAILABLE",
    failureMessage: "Provisioning did not complete. Retry approval.",
    retryable: true,
  },
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/admin/beta-access"]}>
      <PrivateBetaAccessPage />
    </MemoryRouter>,
  );

describe("PrivateBetaAccessPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usePlatformAdminAccess.mockReturnValue({
      isPlatformAdmin: true,
      isResolved: true,
    });
    mocks.useRequests.mockReturnValue({
      data: [pendingRequest],
      isLoading: false,
      error: null,
      refetch: mocks.listRefetch,
    });
    mocks.useRequest.mockReturnValue({
      data: pendingRequest,
      isLoading: false,
      error: null,
      refetch: mocks.detailRefetch,
    });
    mocks.useDecision.mockReturnValue({
      mutate: mocks.mutate,
      isPending: false,
    });
    mocks.useMode.mockReturnValue({
      data: {
        mode: "OPEN",
        updatedAt: "2026-09-22T10:00:00.000Z",
        updatedByUserId: null,
      },
      isLoading: false,
      error: null,
      refetch: mocks.modeRefetch,
      update: { mutate: mocks.modeMutate, isPending: false },
    });
    mocks.mutate.mockResolvedValue({});
    mocks.listRefetch.mockResolvedValue([pendingRequest]);
    mocks.detailRefetch.mockResolvedValue(pendingRequest);
  });

  it("renders the submitted review context and pending decisions", async () => {
    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText("Evaluate agent-assisted planning"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText("Developer tooling")).toBeInTheDocument();
    expect(screen.getAllByText("PENDING")).not.toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "Approve access" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reject request" }),
    ).toBeInTheDocument();
  });

  it("refreshes the selected review and collection after a decision", async () => {
    renderPage();
    const approve = await screen.findByRole("button", {
      name: "Approve access",
    });

    fireEvent.click(approve);

    await waitFor(() => {
      expect(mocks.mutate).toHaveBeenCalledWith({
        requestId: "request-1",
        decision: "APPROVE",
      });
    });
    expect(mocks.detailRefetch).toHaveBeenCalledTimes(1);
    expect(mocks.listRefetch).toHaveBeenCalledTimes(1);
  });

  it("only exposes retry for a retryable provisioning failure", async () => {
    mocks.useRequests.mockReturnValue({
      data: [failedRequest],
      isLoading: false,
      error: null,
      refetch: mocks.listRefetch,
    });
    mocks.useRequest.mockReturnValue({
      data: failedRequest,
      isLoading: false,
      error: null,
      refetch: mocks.detailRefetch,
    });

    renderPage();

    expect(
      await screen.findByRole("button", { name: "Retry approval" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reject request" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Provisioning did not complete. Retry approval."),
    ).toBeInTheDocument();
  });
});
