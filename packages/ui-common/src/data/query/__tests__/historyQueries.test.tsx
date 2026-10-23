import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkItemEditHistory } from "../../hooks/useWorkItemEditHistory";
import { useInitiativeEditHistory } from "../../hooks/useInitiativeEditHistory";
import { useFileTaskHistory, useServiceFileHistory, useFileTouchHistory } from "../../hooks/useFileTouchHistory";
import { editHistoryKeys } from "../../collections/editHistory";
import { fileHistoryKeys } from "../../collections/fileTouchHistory";
import { WebSocketHandler } from "../../websockets/handler";
import { dataLayerQueryRoots } from "../dataLayerInvalidation";

const mocks = vi.hoisted(() => ({ edit: vi.fn(), work: vi.fn(), file: vi.fn(), service: vi.fn() }));
vi.mock("../../../clients/serviceClients", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  platformClient: { getInitiativeEditHistory: mocks.edit },
  reportsClient: {
    listReportFileTouchesByWork: mocks.work,
    listReportFileHistoryByFile: mocks.file,
    listReportFileHistoryByService: mocks.service,
  },
}));
vi.mock("../../hooks/useWebsocketSubscriptions", () => ({ useWebsocketSubscriptions: vi.fn() }));

const entry = (content: string) => ({
  id: "edit", workItemId: "item", timestamp: "2026-10-01T00:00:00Z",
  section: "description", previousContent: "before", newContent: content, changeType: "edit",
});
const editResponse = (content: string) => ({ data: { data: { entries: [entry(content)] } } });
const workInput = { organizationId: "org", projectId: "project", scope: { kind: "task" as const, taskId: "item" }, active: true };
const fileInput = { organizationId: "org", projectId: "project", serviceId: "service", normalizedPath: "src/index.ts", active: true };
const serviceInput = { ...fileInput, pathFilter: "", sortBy: "lastTouchedAt" as const, sortOrder: "DESC" as const };
const editInput = { organizationId: "org", workItemId: "item", entityType: "initiative" as const };
const event = { type: "edit-history.updated" as const, organizationId: "org", initiativeId: "item", timestamp: "2026-10-01T00:01:00Z" };
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const handler = new WebSocketHandler(createStore(), undefined, client);
  return { client, wrapper, handler };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.edit.mockResolvedValue(editResponse("first"));
  mocks.work.mockResolvedValue({ data: { data: { files: [] } } });
  mocks.file.mockResolvedValue({ data: { data: { tasks: [] } } });
  mocks.service.mockResolvedValue({ data: { data: { files: [], nextCursor: null } } });
});

describe("query-backed history", () => {
  it("shares file reads across consumers and fresh remounts, including normalized file paths", async () => {
    const { wrapper, client } = setup();
    const read = () => ({
      work: useFileTouchHistory(workInput), work2: useFileTouchHistory(workInput),
      file: useFileTaskHistory(fileInput), file2: useFileTaskHistory({ ...fileInput, normalizedPath: "/src\\index.ts" }),
      service: useServiceFileHistory(serviceInput), service2: useServiceFileHistory({ ...serviceInput, pathFilter: "  " }),
    });
    const first = renderHook(read, { wrapper });
    expect(first.result.current.work.status).toBe("loading");
    await waitFor(() => {
      expect(first.result.current.work.status).toBe("empty");
      expect(first.result.current.file.status).toBe("empty");
      expect(first.result.current.service.status).toBe("empty");
    });
    first.unmount();
    const next = renderHook(read, { wrapper });
    expect(next.result.current.work.status).toBe("empty");
    expect(mocks.work).toHaveBeenCalledTimes(1);
    expect(mocks.file).toHaveBeenCalledTimes(1);
    expect(mocks.service).toHaveBeenCalledTimes(1);
    next.unmount(); client.clear();
  });

  it("shares initiative reads and refreshes only the edited entity through the actual websocket handler", async () => {
    const { wrapper, handler, client } = setup();
    const { result, unmount } = renderHook(() => ({
      first: useWorkItemEditHistory(editInput),
      second: useInitiativeEditHistory({ organizationId: "org", initiativeId: "item" }),
      task: useWorkItemEditHistory({ ...editInput, entityType: "task" }),
      other: useWorkItemEditHistory({ ...editInput, workItemId: "other" }),
      otherOrg: useWorkItemEditHistory({ ...editInput, organizationId: "other-org" }),
      file: useFileTouchHistory(workInput),
    }), { wrapper });
    await waitFor(() => expect(result.current.otherOrg.editHistory).toHaveLength(1));
    expect(mocks.edit).toHaveBeenCalledTimes(4);
    const pending = deferred<ReturnType<typeof editResponse>>();
    mocks.edit.mockImplementation(() => pending.promise);
    act(() => handler.handleEvent(event));
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(6));
    expect(result.current.first.editHistory[0].newContent).toBe("first");
    expect(result.current.first.error).toBeNull();
    await act(async () => pending.resolve(editResponse("updated")));
    await waitFor(() => expect(result.current.second.editHistory[0].newContent).toBe("updated"));
    expect(result.current.task.editHistory[0].newContent).toBe("updated");
    expect(result.current.other.editHistory[0].newContent).toBe("first");
    expect(result.current.otherOrg.editHistory[0].newContent).toBe("first");
    expect(mocks.work).toHaveBeenCalledTimes(1);
    unmount(); client.clear();
  });

  it("starts a follow-up read when an edit arrives during the first read", async () => {
    const first = deferred<ReturnType<typeof editResponse>>();
    mocks.edit.mockReturnValueOnce(first.promise).mockResolvedValue(editResponse("after event"));
    const { wrapper, handler, client } = setup();
    const { result, unmount } = renderHook(() => useWorkItemEditHistory(editInput), { wrapper });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
    act(() => handler.handleEvent(event));
    await waitFor(() => expect(result.current.editHistory[0]?.newContent).toBe("after event"));
    await act(async () => first.resolve(editResponse("obsolete")));
    expect(result.current.editHistory[0].newContent).toBe("after event");
    expect(mocks.edit).toHaveBeenCalledTimes(2);
    unmount(); client.clear();
  });

  it("reconnect invalidates both roots, refetching mounted histories and retaining inactive entries as stale", async () => {
    const { wrapper, client, handler } = setup();
    const inactiveKey = editHistoryKeys.entity("org", "initiative", "inactive");
    client.setQueryData(inactiveKey, []);
    const { result, unmount } = renderHook(() => ({ edit: useWorkItemEditHistory(editInput), file: useFileTouchHistory(workInput) }), { wrapper });
    await waitFor(() => expect(result.current.file.status).toBe("empty"));
    act(() => handler.markAllStale());
    await waitFor(() => {
      expect(mocks.edit).toHaveBeenCalledTimes(2);
      expect(mocks.work).toHaveBeenCalledTimes(2);
    });
    expect(client.getQueryState(inactiveKey)?.isInvalidated).toBe(true);
    expect(dataLayerQueryRoots()).toContainEqual(fileHistoryKeys.root());
    expect(dataLayerQueryRoots()).toContainEqual(editHistoryKeys.root());
    unmount(); client.clear();
  });

  it("keeps disabled reads non-error and caches an explicit 4xx failure across remounts", async () => {
    const { wrapper, client } = setup();
    const disabled = renderHook(() => useFileTouchHistory({ active: false }), { wrapper });
    expect(disabled.result.current.status).toBe("disabled");
    expect(mocks.work).not.toHaveBeenCalled(); disabled.unmount();
    const failure = Object.assign(new Error("Forbidden"), { status: 403 });
    mocks.work.mockRejectedValue(failure);
    const first = renderHook(() => useFileTouchHistory(workInput), { wrapper });
    expect(first.result.current.status).toBe("loading");
    await waitFor(() => expect(first.result.current).toMatchObject({ status: "error", error: failure }));
    first.unmount();
    const second = renderHook(() => useFileTouchHistory(workInput), { wrapper });
    expect(second.result.current.status).toBe("error");
    expect(mocks.work).toHaveBeenCalledTimes(1);
    second.unmount(); client.clear();
  });

  it("retains populated file history while refreshing and presents empty only after success", async () => {
    mocks.work.mockResolvedValueOnce({ data: { data: { files: [{ serviceId: "service", serviceName: "UI Common", normalizedPath: "src/index.ts" }] } } });
    const { wrapper, handler, client } = setup();
    const { result, unmount } = renderHook(() => useFileTouchHistory(workInput), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const pending = deferred<{ data: { data: { files: [] } } }>();
    mocks.work.mockReturnValueOnce(pending.promise);
    act(() => handler.markAllStale());
    await waitFor(() => expect(result.current).toMatchObject({ status: "updating", history: { files: [{ serviceName: "UI Common" }] } }));
    await act(async () => pending.resolve({ data: { data: { files: [] } } }));
    await waitFor(() => expect(result.current.status).toBe("empty"));
    unmount(); client.clear();
  });
});
