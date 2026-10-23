import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStore } from "jotai";
import { useDesignDoc } from "../useDesignDoc";
import { useAdr } from "../useAdr";
import { useProjectLibrary } from "../useProjectLibrary";
import { designDocKeys } from "../../collections/designDocs";
import { WebSocketHandler } from "../../websockets/handler";
import { doc, ok, deferred, client, wrapper } from "./designDocTestUtils";
const mocks = vi.hoisted(() => ({ request: vi.fn(), library: vi.fn() }));
vi.mock("../../../clients", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  dataClient: { request: mocks.request },
}));
vi.mock("../../../clients/serviceClients", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  designDocsClient: { getDesignDocLibrary: mocks.library },
}));
beforeEach(() => {
  vi.clearAllMocks();
});
describe("design-doc reads", () => {
  it("shares the first read across design-doc and ADR consumers and fresh remounts", async () => {
    const pending = deferred<ReturnType<typeof ok>>();
    mocks.request.mockReturnValue(pending.promise);
    const queryClient = client();
    const first = renderHook(() => useDesignDoc("org", "doc"), {
      wrapper: wrapper(queryClient),
    });
    const second = renderHook(() => useAdr("org", "doc"), {
      wrapper: wrapper(queryClient),
    });
    expect(first.result.current.isLoading).toBe(true);
    expect(first.result.current.error).toBeNull();
    expect(first.result.current.isReady).toBe(false);
    await act(async () => pending.resolve(ok(doc("doc", { template: "ADR" }))));
    await waitFor(() => expect(second.result.current.isReady).toBe(true));
    expect(mocks.request).toHaveBeenCalledTimes(1);
    first.unmount();
    second.unmount();
    renderHook(() => useDesignDoc("org", "doc"), {
      wrapper: wrapper(queryClient),
    });
    expect(mocks.request).toHaveBeenCalledTimes(1);
    queryClient.clear();
  });
  it("keeps disabled reads unstarted and caches settled 404s", async () => {
    const queryClient = client();
    const disabled = renderHook(() => useDesignDoc(undefined, undefined), {
      wrapper: wrapper(queryClient),
    });
    expect(disabled.result.current).toMatchObject({
      data: null,
      error: null,
      isFetched: false,
      isReady: false,
      isLoading: false,
    });
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.request.mockRejectedValue(
      Object.assign(new Error("missing"), { status: 404 })
    );
    const first = renderHook(() => useDesignDoc("org", "missing"), {
      wrapper: wrapper(queryClient),
    });
    await waitFor(() =>
      expect(first.result.current.error?.message).toBe("missing")
    );
    first.unmount();
    renderHook(() => useDesignDoc("org", "missing"), {
      wrapper: wrapper(queryClient),
    });
    expect(mocks.request).toHaveBeenCalledTimes(1);
    queryClient.clear();
  });
  it("shares project-library reads", async () => {
    mocks.library.mockResolvedValue(ok([]));
    const queryClient = client();
    const first = renderHook(() => useProjectLibrary("org", "project"), {
      wrapper: wrapper(queryClient),
    });
    const second = renderHook(() => useProjectLibrary("org", "project"), {
      wrapper: wrapper(queryClient),
    });
    await waitFor(() =>
      expect(
        first.result.current.isReady && second.result.current.isReady
      ).toBe(true)
    );
    expect(mocks.library).toHaveBeenCalledTimes(1);
    queryClient.clear();
  });
  it("restarts an initial read invalidated by realtime, leaving unrelated docs alone", async () => {
    const pending = deferred<ReturnType<typeof ok>>();
    mocks.request
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(ok(doc("doc", { name: "After event" })));
    const queryClient = client();
    queryClient.setQueryData(
      designDocKeys.detail("org", "other"),
      doc("other")
    );
    const mounted = renderHook(() => useDesignDoc("org", "doc"), {
      wrapper: wrapper(queryClient),
    });
    const handler = new WebSocketHandler(createStore(), undefined, queryClient);
    act(() =>
      handler.handleEvent({
        type: "design_doc.updated",
        organizationId: "org",
        projectId: "project",
        designDocId: "doc",
        timestamp: "2026-01-01",
      })
    );
    await waitFor(() =>
      expect(mounted.result.current.data?.name).toBe("After event")
    );
    expect(mocks.request).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(ok(doc())));
    expect(mounted.result.current.data?.name).toBe("After event");
    expect(
      queryClient.getQueryState(designDocKeys.detail("org", "other"))
        ?.isInvalidated
    ).toBe(false);
    queryClient.clear();
  });
  it("preserves expired data while reporting refreshing", async () => {
    const pending = deferred<ReturnType<typeof ok>>();
    mocks.request.mockReturnValue(pending.promise);
    const queryClient = client();
    queryClient.setQueryData(designDocKeys.detail("org", "doc"), doc(), {
      updatedAt: Date.now() - 1000,
    });
    const mounted = renderHook(
      () => useDesignDoc("org", "doc", { maxCacheAgeMs: 500 }),
      { wrapper: wrapper(queryClient) }
    );
    expect(mounted.result.current.data?.name).toBe("Design");
    expect(mounted.result.current.isFetching).toBe(true);
    await act(async () => pending.resolve(ok(doc("doc", { name: "Fresh" }))));
    await waitFor(() =>
      expect(mounted.result.current.data?.name).toBe("Fresh")
    );
    queryClient.clear();
  });
});
