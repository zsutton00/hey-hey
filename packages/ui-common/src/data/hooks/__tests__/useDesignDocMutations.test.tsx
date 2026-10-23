import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useCreateDesignDoc } from "../useCreateDesignDoc";
import { useUpdateDesignDoc } from "../useUpdateDesignDoc";
import { useDeleteDesignDoc } from "../useDeleteDesignDoc";
import { useCreateAdr } from "../useCreateAdr";
import { useUpdateAdr } from "../useUpdateAdr";
import { designDocKeys } from "../../collections/designDocs";
import { workItemKeys } from "../../collections/workItemLists";
import { loadConfig, resetConfig } from "../../relationships";
import { doc, ok, deferred, client, wrapper } from "./designDocTestUtils";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../../clients", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  dataClient: { request: mocks.request },
}));
beforeEach(() => {
  vi.clearAllMocks();
  resetConfig();
});
afterEach(() => resetConfig());
function setup() {
  const queryClient = client();
  const detail = designDocKeys.detail("org", "doc");
  const list = designDocKeys.list("org", { projectId: "project" });
  const parent = designDocKeys.list("org", { taskId: "old" });
  const other = designDocKeys.list("other-org");
  queryClient.setQueryData(
    detail,
    doc("doc", { parentEntityType: "TASK", parentEntityId: "old" })
  );
  queryClient.setQueryData(list, [
    doc("doc", { parentEntityType: "TASK", parentEntityId: "old" }),
  ]);
  queryClient.setQueryData(parent, [
    doc("doc", { parentEntityType: "TASK", parentEntityId: "old" }),
  ]);
  queryClient.setQueryData(other, []);
  return { queryClient, detail, list, parent, other };
}
describe("design-doc mutations", () => {
  it("creates into detail and every matching cached list, with callbacks and relationship invalidation", async () => {
    const { queryClient, list, other } = setup();
    const created = doc("new");
    mocks.request.mockResolvedValue(ok(created));
    loadConfig({
      version: "1",
      generatedAt: "2026-01-01",
      rules: [
        {
          sourceEntity: "DesignDoc",
          sourceFields: ["projectId"],
          targetCollections: ["Task"],
          relationshipPath: "DesignDoc.project.tasks",
          cardinality: "1:1",
          lookupField: "projectId",
          invalidationMode: "invalidate",
        },
      ],
    });
    const workList = workItemKeys.list("org", "project", {});
    queryClient.setQueryData(workList, []);
    const onSuccess = vi.fn();
    const mounted = renderHook(() => useCreateDesignDoc({ onSuccess }), {
      wrapper: wrapper(queryClient),
    });
    await act(async () =>
      expect(
        await mounted.result.current.mutate({
          organizationId: "org",
          designDoc: { name: "New", sections: [] },
        })
      ).toEqual(created)
    );
    expect(
      queryClient.getQueryData(designDocKeys.detail("org", "new"))
    ).toEqual(created);
    expect(queryClient.getQueryData(list)).toEqual(
      expect.arrayContaining([created])
    );
    expect(queryClient.getQueryData(other)).toEqual([]);
    expect(queryClient.getQueryState(workList)?.isInvalidated).toBe(true);
    expect(onSuccess).toHaveBeenCalledWith(created);
    expect(mounted.result.current.isSuccess).toBe(true);
    queryClient.clear();
  });
  it("writes applied updates to detail and filtered lists, moving status membership", async () => {
    const { queryClient, detail, list } = setup();
    const draft = designDocKeys.list("org", { status: "DRAFT" });
    const approved = designDocKeys.list("org", { status: "APPROVED" });
    queryClient.setQueryData(draft, [doc()]);
    queryClient.setQueryData(approved, []);
    const updated = doc("doc", { name: "Updated", status: "APPROVED" });
    mocks.request.mockResolvedValue(
      ok({ status: "APPLIED", designDoc: updated })
    );
    const mounted = renderHook(() => useUpdateDesignDoc(), {
      wrapper: wrapper(queryClient),
    });
    await act(async () =>
      mounted.result.current.mutate({
        organizationId: "org",
        designDocId: "doc",
        updates: { name: "Updated" },
      })
    );
    expect(queryClient.getQueryData(detail)).toEqual(updated);
    expect(queryClient.getQueryData(list)).toEqual([updated]);
    expect(queryClient.getQueryData(draft)).toEqual([]);
    expect(queryClient.getQueryData(approved)).toEqual([updated]);
    queryClient.clear();
  });
  it("keeps pending saves canonical and returns the proposal without relationship invalidation", async () => {
    const { queryClient, detail, list } = setup();
    const saved = queryClient.getQueryData(detail);
    const proposal = { id: "proposal" };
    mocks.request.mockResolvedValue(
      ok({ status: "PENDING", designDoc: saved, proposal })
    );
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const mounted = renderHook(() => useUpdateDesignDoc(), {
      wrapper: wrapper(queryClient),
    });
    await act(async () =>
      expect(
        await mounted.result.current.mutate({
          organizationId: "org",
          designDocId: "doc",
          updates: { name: "Proposed" },
        })
      ).toEqual({ status: "PENDING", designDoc: saved, proposal })
    );
    expect(queryClient.getQueryData(detail)).toEqual(saved);
    expect(queryClient.getQueryData(list)).toEqual([saved]);
    expect(invalidate).not.toHaveBeenCalled();
    queryClient.clear();
  });
  it("preserves bare-doc compatibility and rejects missing update data", async () => {
    const { queryClient, detail } = setup();
    mocks.request
      .mockResolvedValueOnce(ok(doc()))
      .mockResolvedValueOnce(ok(null));
    const mounted = renderHook(() => useUpdateDesignDoc(), {
      wrapper: wrapper(queryClient),
    });
    await act(async () =>
      expect(
        await mounted.result.current.mutate({
          organizationId: "org",
          designDocId: "doc",
          updates: {},
        })
      ).toEqual({ status: "APPLIED", designDoc: doc() })
    );
    await act(async () =>
      expect(
        mounted.result.current.mutate({
          organizationId: "org",
          designDocId: "doc",
          updates: {},
        })
      ).rejects.toThrow("No design doc")
    );
    expect(queryClient.getQueryData(detail)).toEqual(doc());
    queryClient.clear();
  });
  it("deletes optimistically across cached reads, restores on failure and emits failure callbacks", async () => {
    const { queryClient, detail, list, parent } = setup();
    const saved = queryClient.getQueryData(detail);
    const pending = deferred<ReturnType<typeof ok>>();
    mocks.request.mockReturnValue(pending.promise);
    const onError = vi.fn();
    const onSettled = vi.fn();
    const mounted = renderHook(
      () => useDeleteDesignDoc({ onError, onSettled }),
      { wrapper: wrapper(queryClient) }
    );
    let operation!: Promise<unknown>;
    act(() => {
      operation = mounted.result.current.mutate({
        organizationId: "org",
        designDocId: "doc",
      });
    });
    const rejected = expect(operation).rejects.toThrow("delete failed");
    await waitFor(() => expect(queryClient.getQueryData(list)).toEqual([]));
    expect(mounted.result.current.isPending).toBe(true);
    expect(queryClient.getQueryData(detail)).toBeNull();
    expect(queryClient.getQueryData(parent)).toEqual([]);
    await act(async () => {
      pending.reject(new Error("delete failed"));
      await rejected;
    });
    expect(queryClient.getQueryData(detail)).toEqual(saved);
    expect(queryClient.getQueryData(list)).toEqual([saved]);
    expect(queryClient.getQueryData(parent)).toEqual([saved]);
    expect(mounted.result.current.isError).toBe(true);
    expect(onError).toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledTimes(1);
    queryClient.clear();
  });
  it("keeps a successful deletion absent", async () => {
    const { queryClient, detail, list } = setup();
    mocks.request.mockResolvedValue(ok(doc("doc", { status: "ARCHIVED" })));
    const mounted = renderHook(() => useDeleteDesignDoc(), {
      wrapper: wrapper(queryClient),
    });
    await act(async () =>
      mounted.result.current.mutate({
        organizationId: "org",
        designDocId: "doc",
      })
    );
    expect(queryClient.getQueryData(detail)).toBeNull();
    expect(queryClient.getQueryData(list)).toEqual([]);
    queryClient.clear();
  });
  it("does not resurrect another successfully deleted doc when a deletion rolls back", async () => {
    const { queryClient, list } = setup();
    const first = doc();
    const second = doc("second");
    queryClient.setQueryData(list, [first, second]);
    const pending = deferred<ReturnType<typeof ok>>();
    mocks.request
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(ok({ ...second, status: "ARCHIVED" }));
    const mounted = renderHook(() => useDeleteDesignDoc(), {
      wrapper: wrapper(queryClient),
    });
    let operation!: Promise<unknown>;
    act(() => {
      operation = mounted.result.current.mutate({
        organizationId: "org",
        designDocId: first.id,
      });
    });
    const rejected = expect(operation).rejects.toThrow("delete failed");
    await waitFor(() => expect(queryClient.getQueryData(list)).toEqual([second]));
    await act(async () => {
      await mounted.result.current.mutate({
        organizationId: "org",
        designDocId: second.id,
      });
    });
    expect(queryClient.getQueryData(list)).toEqual([]);
    await act(async () => {
      pending.reject(new Error("delete failed"));
      await rejected;
    });
    expect(queryClient.getQueryData(list)).toEqual([first]);
    expect(
      queryClient.getQueryData(designDocKeys.detail("org", second.id))
    ).toBeNull();
    queryClient.clear();
  });
  it("wires ADR creation and section updates through the design-doc cache", async () => {
    const { queryClient, list, detail } = setup();
    const adr = doc("doc", { template: "ADR" });
    mocks.request
      .mockResolvedValueOnce(ok(adr))
      .mockResolvedValueOnce(ok({ status: "PENDING", designDoc: adr }));
    const mounted = renderHook(
      () => ({ create: useCreateAdr(), update: useUpdateAdr() }),
      { wrapper: wrapper(queryClient) }
    );
    await act(async () =>
      mounted.result.current.create.mutate({
        organizationId: "org",
        adr: { name: "ADR", content: { context: "Why" } },
      })
    );
    expect(mocks.request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          template: "ADR",
          sections: expect.arrayContaining([
            expect.objectContaining({ key: "context", content: "Why" }),
          ]),
        }),
      })
    );
    await act(async () =>
      mounted.result.current.update.mutate({
        organizationId: "org",
        adrId: "doc",
        updates: { content: { decision: "Choose" }, reason: "Reason" },
      })
    );
    expect(mocks.request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          reason: "Reason",
          sections: [{ key: "decision", content: "Choose", order: 0 }],
        }),
      })
    );
    expect(queryClient.getQueryData(detail)).toEqual(adr);
    expect(queryClient.getQueryData(list)).toEqual([adr]);
    queryClient.clear();
  });
});
