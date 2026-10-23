import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}

import type { PrivateBetaAccessRequestReviewDto } from "../../../api";
import { usePrivateBetaAccessRequestDecision } from "../usePrivateBetaAccessRequestDecision";
import { usePrivateBetaAccessRequest } from "../usePrivateBetaAccessRequest";
import { usePrivateBetaAccessRequests } from "../usePrivateBetaAccessRequests";
import { privateBetaAccessRequestKeys } from "../../collections/privateBetaAccessRequests";
const mocks = vi.hoisted(() => ({
  decision: vi.fn(),
  detail: vi.fn(),
  list: vi.fn(),
}));
vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    decidePrivateBetaAccessRequest: mocks.decision,
    getPrivateBetaAccessRequestReview: mocks.detail,
    listPrivateBetaAccessRequestReviews: mocks.list,
  },
}));
const review: PrivateBetaAccessRequestReviewDto = {
  requestId: "request-1",
  name: "Ada",
  workEmail: "ada@example.com",
  organizationName: "Engines",
  teamSize: null,
  productContext: null,
  accessRationale: null,
  status: "PENDING",
  createdAt: "2026-08-12T00:00:00Z",
  decidedAt: null,
  provisioningOutcome: null,
};
const decided = {
  ...review,
  status: "APPROVED" as const,
  decidedAt: "2026-08-12T01:00:00Z",
};
const decisionResult = {
  requestId: review.requestId,
  decision: "APPROVE" as const,
  status: decided.status,
  decidedAt: decided.decidedAt,
  provisioningOutcome: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.decision.mockResolvedValue({ data: { data: decisionResult } });
  mocks.detail.mockResolvedValue({ data: { data: review } });
  mocks.list.mockResolvedValue({ data: { data: [review] } });
});
describe("private-beta decisions", () => {
  it("refreshes a complete detail once and invalidates shared list observers once", async () => {
    const { client, wrapper } = setup();
    const view = renderHook(
      () => ({
        detail: usePrivateBetaAccessRequest("request-1"),
        detail2: usePrivateBetaAccessRequest("request-1"),
        list: usePrivateBetaAccessRequests(),
        list2: usePrivateBetaAccessRequests(),
        mutation: usePrivateBetaAccessRequestDecision(),
      }),
      { wrapper }
    );
    await waitFor(() =>
      expect(
        view.result.current.list.isReady && view.result.current.detail.isReady
      ).toBe(true)
    );
    mocks.detail.mockResolvedValue({ data: { data: decided } });
    mocks.list.mockResolvedValue({ data: { data: [decided] } });
    await act(async () => {
      await view.result.current.mutation.mutate({
        requestId: "request-1",
        decision: "APPROVE",
      });
    });
    await waitFor(() =>
      expect(view.result.current.list2.data).toEqual([decided])
    );
    expect(view.result.current.detail2.data).toEqual(decided);
    expect(
      client.getQueryData(privateBetaAccessRequestKeys.detail("request-1"))
    ).toEqual(decided);
    expect(mocks.detail).toHaveBeenCalledTimes(2);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.decision).toHaveBeenCalledWith({
      requestId: "request-1",
      privateBetaAccessRequestDecisionInputDto: { decision: "APPROVE" },
    });
    expect(view.result.current.mutation.isSuccess).toBe(true);
    view.unmount();
    client.clear();
  });
  it("can decide an uncached request without manufacturing a partial review", async () => {
    mocks.detail.mockResolvedValue({ data: { data: decided } });
    const { client, wrapper } = setup();
    const view = renderHook(() => usePrivateBetaAccessRequestDecision(), {
      wrapper,
    });
    await act(async () => {
      await view.result.current.mutate({
        requestId: "request-1",
        decision: "APPROVE",
      });
    });
    expect(
      client.getQueryData(privateBetaAccessRequestKeys.detail("request-1"))
    ).toEqual(decided);
    expect(mocks.detail).toHaveBeenCalledTimes(1);
    view.unmount();
    client.clear();
  });
  it("records refresh failure while keeping a successful durable decision successful", async () => {
    mocks.detail.mockRejectedValue(
      Object.assign(new Error("forbidden"), { status: 403 })
    );
    const { client, wrapper } = setup();
    const view = renderHook(() => usePrivateBetaAccessRequestDecision(), {
      wrapper,
    });
    await act(async () => {
      await expect(
        view.result.current.mutate({
          requestId: "request-1",
          decision: "APPROVE",
        })
      ).resolves.toEqual(decisionResult);
    });
    expect(view.result.current.isSuccess).toBe(true);
    expect(
      client.getQueryState(privateBetaAccessRequestKeys.detail("request-1"))
        ?.status
    ).toBe("error");
    expect(
      client.getQueryData(privateBetaAccessRequestKeys.detail("request-1"))
    ).toBeUndefined();
    expect(mocks.detail).toHaveBeenCalledTimes(1);
    view.unmount();
    client.clear();
  });
  it("does not refresh when the decision fails", async () => {
    mocks.decision.mockRejectedValue(new Error("decision failed"));
    const { client, wrapper } = setup();
    const view = renderHook(() => usePrivateBetaAccessRequestDecision(), {
      wrapper,
    });
    await act(async () => {
      await expect(
        view.result.current.mutate({
          requestId: "request-1",
          decision: "APPROVE",
        })
      ).rejects.toThrow("decision failed");
    });
    expect(view.result.current.isError).toBe(true);
    expect(mocks.detail).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
    view.unmount();
    client.clear();
  });
  it("reports a durable decision successful while the complete review is still loading", async () => {
    let resolve!: (value: { data: { data: typeof decided } }) => void;
    const pending = new Promise<{ data: { data: typeof decided } }>((done) => {
      resolve = done;
    });
    mocks.detail.mockReturnValue(pending);
    const { client, wrapper } = setup();
    const view = renderHook(
      () => ({
        mutation: usePrivateBetaAccessRequestDecision(),
        detail: usePrivateBetaAccessRequest("request-1", { enabled: false }),
      }),
      { wrapper }
    );
    await act(async () => {
      await view.result.current.mutation.mutate({
        requestId: "request-1",
        decision: "APPROVE",
      });
    });
    expect(view.result.current.mutation.isSuccess).toBe(true);
    expect(view.result.current.detail.data).toBeNull();
    expect(view.result.current.detail.error).toBeNull();
    expect(
      client.getQueryState(privateBetaAccessRequestKeys.detail("request-1"))
        ?.fetchStatus
    ).toBe("fetching");
    await act(async () => resolve({ data: { data: decided } }));
    await waitFor(() =>
      expect(view.result.current.detail.data).toEqual(decided)
    );
    expect(mocks.detail).toHaveBeenCalledTimes(1);
    view.unmount();
    client.clear();
  });
});
