import type { PrivateBetaAccessRequestReviewDto } from "../../../api";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePrivateBetaAccessRequests } from "../usePrivateBetaAccessRequests";
const read = vi.hoisted(() => vi.fn());
vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: { listPrivateBetaAccessRequestReviews: read },
}));
const requests: PrivateBetaAccessRequestReviewDto[] = [
  {
    requestId: "request-2",
    name: "Grace Hopper",
    workEmail: "grace@example.com",
    organizationName: "Compiler Labs",
    teamSize: null,
    productContext: null,
    accessRationale: null,
    status: "PENDING",
    createdAt: "2026-08-13T00:00:00.000Z",
    decidedAt: null,
    provisioningOutcome: null,
  },
  {
    requestId: "request-1",
    name: "Ada Lovelace",
    workEmail: "ada@example.com",
    organizationName: "Analytical Engines",
    teamSize: 5,
    productContext: "Product planning",
    accessRationale: "Evaluate agent-assisted planning",
    status: "REJECTED",
    createdAt: "2026-08-12T00:00:00.000Z",
    decidedAt: "2026-08-12T01:00:00.000Z",
    provisioningOutcome: null,
  },
];

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
  read.mockResolvedValue({ data: { data: requests } });
});
describe("usePrivateBetaAccessRequests", () => {
  it("shares an authoritative read and preserves DTOs through refetch", async () => {
    const { client, wrapper } = setup();
    const view = renderHook(
      () => ({
        first: usePrivateBetaAccessRequests(),
        second: usePrivateBetaAccessRequests(),
      }),
      { wrapper }
    );
    expect(view.result.current.first.error).toBeNull();
    await waitFor(() => expect(view.result.current.first.isReady).toBe(true));
    expect(view.result.current.first.data).toEqual(requests);
    expect(view.result.current.second.data).toEqual(requests);
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => {
      expect(await view.result.current.first.refetch()).toEqual(requests);
    });
    expect(read).toHaveBeenCalledTimes(2);
    view.unmount();
    client.clear();
  });
  it("does not read while disabled", () => {
    const { client, wrapper } = setup();
    const view = renderHook(
      () => usePrivateBetaAccessRequests({ enabled: false }),
      { wrapper }
    );
    expect(read).not.toHaveBeenCalled();
    expect(view.result.current.isReady).toBe(false);
    expect(view.result.current.error).toBeNull();
    view.unmount();
    client.clear();
  });
});
