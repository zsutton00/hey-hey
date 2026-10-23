import type { PrivateBetaAccessRequestReviewDto } from "../../../api";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePrivateBetaAccessRequest } from "../usePrivateBetaAccessRequest";
const read = vi.hoisted(() => vi.fn());
vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: { getPrivateBetaAccessRequestReview: read },
}));
const request: PrivateBetaAccessRequestReviewDto = {
  requestId: "request-1",
  name: "Ada Lovelace",
  workEmail: "ada@example.com",
  organizationName: "Analytical Engines",
  teamSize: 5,
  productContext: "Product planning",
  accessRationale: "Evaluate agent-assisted planning",
  status: "PROVISIONING_FAILED",
  createdAt: "2026-08-12T00:00:00.000Z",
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

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}
beforeEach(() => {
  vi.resetAllMocks();
  read.mockResolvedValue({ data: { data: request } });
});
describe("usePrivateBetaAccessRequest", () => {
  it("shares an authoritative read and preserves DTOs through refetch", async () => {
    const { client, wrapper } = setup();
    const view = renderHook(
      () => ({
        first: usePrivateBetaAccessRequest("request-1"),
        second: usePrivateBetaAccessRequest("request-1"),
      }),
      { wrapper }
    );
    expect(view.result.current.first.error).toBeNull();
    await waitFor(() => expect(view.result.current.first.isReady).toBe(true));
    expect(view.result.current.first.data).toEqual(request);
    expect(view.result.current.second.data).toEqual(request);
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => {
      expect(await view.result.current.first.refetch()).toEqual(request);
    });
    expect(read).toHaveBeenCalledTimes(2);
    view.unmount();
    client.clear();
  });
  it("does not read while disabled", () => {
    const { client, wrapper } = setup();
    const view = renderHook(
      () => usePrivateBetaAccessRequest("request-1", { enabled: false }),
      { wrapper }
    );
    expect(read).not.toHaveBeenCalled();
    expect(view.result.current.isReady).toBe(false);
    expect(view.result.current.error).toBeNull();
    view.unmount();
    client.clear();
  });
});
