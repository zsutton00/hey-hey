import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useReparentDesignDoc } from "../useReparentDesignDoc";
import { designDocKeys } from "../../collections/designDocs";
import { doc, ok, deferred, client, wrapper } from "./designDocTestUtils";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../../clients", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  dataClient: { request: mocks.request },
}));
beforeEach(() => vi.clearAllMocks());
function setup() {
  const queryClient = client();
  const saved = doc("doc", { parentEntityType: "TASK", parentEntityId: "old" });
  const detail = designDocKeys.detail("org", "doc");
  const oldList = designDocKeys.list("org", { taskId: "old" });
  const newList = designDocKeys.list("org", { taskId: "new" });
  queryClient.setQueryData(detail, saved);
  queryClient.setQueryData(oldList, [saved]);
  queryClient.setQueryData(newList, []);
  return { queryClient, saved, detail, oldList, newList };
}
describe("reparent design docs", () => {
  it("moves cached list membership while pending and commits the applied response", async () => {
    const { queryClient, saved, detail, oldList, newList } = setup();
    const pending = deferred<ReturnType<typeof ok>>();
    mocks.request.mockReturnValue(pending.promise);
    const mounted = renderHook(() => useReparentDesignDoc("org"), {
      wrapper: wrapper(queryClient),
    });
    let operation!: Promise<void>;
    act(() => {
      operation = mounted.result.current.reparent("doc", "new", "TASK");
    });
    await waitFor(() => expect(queryClient.getQueryData(oldList)).toEqual([]));
    expect(queryClient.getQueryData(newList)).toEqual([
      { ...saved, parentEntityId: "new" },
    ]);
    await act(async () => {
      pending.resolve(
        ok({
          status: "APPLIED",
          designDoc: { ...saved, parentEntityId: "new" },
        })
      );
      await operation;
    });
    expect(queryClient.getQueryData(detail)).toEqual({
      ...saved,
      parentEntityId: "new",
    });
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PATCH",
        data: { parentEntityId: "new", parentEntityType: "TASK" },
      })
    );
    queryClient.clear();
  });
  it.each(["failure", "pending"] as const)(
    "restores all cached membership after %s",
    async (outcome) => {
      const { queryClient, saved, detail, oldList, newList } = setup();
      if (outcome === "failure")
        mocks.request.mockRejectedValue(new Error("failed"));
      else
        mocks.request.mockResolvedValue(
          ok({
            status: "PENDING",
            designDoc: saved,
            proposal: { id: "proposal" },
          })
        );
      const mounted = renderHook(() => useReparentDesignDoc("org"), {
        wrapper: wrapper(queryClient),
      });
      await act(async () => {
        const operation = mounted.result.current.reparent("doc", "new", "TASK");
        if (outcome === "failure")
          await expect(operation).rejects.toThrow("failed");
        else await operation;
      });
      expect(queryClient.getQueryData(detail)).toEqual(saved);
      expect(queryClient.getQueryData(oldList)).toEqual([saved]);
      expect(queryClient.getQueryData(newList)).toEqual([]);
      queryClient.clear();
    }
  );
  it("rejects self and descendant drops and skips unchanged parents", async () => {
    const { queryClient } = setup();
    queryClient.setQueryData(
      designDocKeys.detail("org", "child"),
      doc("child", { parentEntityType: "DESIGN_DOC", parentEntityId: "doc" })
    );
    const mounted = renderHook(() => useReparentDesignDoc("org"), {
      wrapper: wrapper(queryClient),
    });
    await expect(
      mounted.result.current.reparent("doc", "doc", "DESIGN_DOC")
    ).rejects.toThrow("itself");
    await expect(
      mounted.result.current.reparent("doc", "child", "DESIGN_DOC")
    ).rejects.toThrow("descendants");
    await mounted.result.current.reparent("doc", "old", "TASK");
    expect(mocks.request).not.toHaveBeenCalled();
    queryClient.clear();
  });
  it("uses full documents from the library when no detail or list is mounted", async () => {
    const queryClient = client();
    const saved = doc();
    queryClient.setQueryData(designDocKeys.library("org", "project"), [
      {
        id: "doc",
        type: "design-doc",
        name: saved.name,
        designDoc: saved,
        children: [],
      },
    ]);
    mocks.request.mockResolvedValue(
      ok({ ...saved, parentEntityId: "new", parentEntityType: "TASK" })
    );
    const mounted = renderHook(() => useReparentDesignDoc("org"), {
      wrapper: wrapper(queryClient),
    });
    await act(async () =>
      mounted.result.current.reparent("doc", "new", "TASK")
    );
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(
      queryClient.getQueryState(designDocKeys.library("org", "project"))
        ?.isInvalidated
    ).toBe(true);
    queryClient.clear();
  });
});
