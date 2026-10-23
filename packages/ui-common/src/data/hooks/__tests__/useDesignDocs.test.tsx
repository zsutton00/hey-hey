import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStore } from "jotai";
import { useDesignDocs } from "../useDesignDocs";
import { useAdrs } from "../useAdrs";
import { useProjectLibrary } from "../useProjectLibrary";
import { designDocKeys } from "../../collections/designDocs";
import { WebSocketHandler } from "../../websockets/handler";
import { doc, ok, client, wrapper } from "./designDocTestUtils";
const mocks = vi.hoisted(() => ({ request: vi.fn(), library: vi.fn() }));
vi.mock("../../../clients", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  dataClient: { request: mocks.request },
}));
vi.mock("../../../clients/serviceClients", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  designDocsClient: { getDesignDocLibrary: mocks.library },
}));
beforeEach(() => vi.clearAllMocks());
describe("design-doc lists", () => {
  it("shares lists with ADR projections and excludes other templates", async () => {
    mocks.request.mockResolvedValue(
      ok([doc(), doc("adr", { template: "ADR" })])
    );
    const queryClient = client();
    const mounted = renderHook(
      () => ({
        docs: useDesignDocs("org", { projectId: "project" }),
        adrs: useAdrs("org", { projectId: "project" }),
      }),
      { wrapper: wrapper(queryClient) }
    );
    await waitFor(() => expect(mounted.result.current.docs.isReady).toBe(true));
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mounted.result.current.docs.designDocs).toHaveLength(2);
    expect(mounted.result.current.adrs.designDocs.map((doc) => doc.id)).toEqual(
      ["adr"]
    );
    queryClient.clear();
  });
  it("normalizes parameters and presents a successful empty read", async () => {
    mocks.request.mockResolvedValue(ok([]));
    const queryClient = client();
    const mounted = renderHook(
      () =>
        useDesignDocs("org", {
          tags: ["alpha", "beta"],
          includeSectionKeys: ["content"],
          page: 2,
          limit: 10,
        }),
      { wrapper: wrapper(queryClient) }
    );
    await waitFor(() => expect(mounted.result.current.isReady).toBe(true));
    expect(mounted.result.current.data).toEqual([]);
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          tags: "alpha,beta",
          includeSectionKeys: "content",
          page: 2,
          limit: 10,
        },
      })
    );
    queryClient.clear();
  });
  it("realtime refreshes mounted affected lists/library once and preserves other projects/details", async () => {
    mocks.request.mockResolvedValue(ok([]));
    mocks.library.mockResolvedValue(ok([]));
    const queryClient = client();
    const key = designDocKeys.list("org", { projectId: "project" });
    queryClient.setQueryData(
      designDocKeys.list("org", { projectId: "other" }),
      []
    );
    queryClient.setQueryData(
      designDocKeys.detail("org", "other"),
      doc("other")
    );
    const mounted = renderHook(
      () => ({
        one: useDesignDocs("org", { projectId: "project" }),
        two: useDesignDocs("org", { projectId: "project" }),
        library: useProjectLibrary("org", "project"),
      }),
      { wrapper: wrapper(queryClient) }
    );
    await waitFor(() =>
      expect(
        mounted.result.current.one.isReady &&
          mounted.result.current.library.isReady
      ).toBe(true)
    );
    const handler = new WebSocketHandler(createStore(), undefined, queryClient);
    act(() =>
      handler.handleEvent({
        type: "design_doc.created",
        organizationId: "org",
        projectId: "project",
        designDocId: "new",
        timestamp: "2026-01-01",
      })
    );
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.library).toHaveBeenCalledTimes(2));
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
    expect(
      queryClient.getQueryState(
        designDocKeys.list("org", { projectId: "other" })
      )?.isInvalidated
    ).toBe(false);
    expect(
      queryClient.getQueryState(designDocKeys.detail("org", "other"))
        ?.isInvalidated
    ).toBe(false);
    queryClient.clear();
  });
});
