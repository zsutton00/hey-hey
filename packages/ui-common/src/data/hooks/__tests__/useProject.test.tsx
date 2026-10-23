import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProject } from "../useProject";
const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../../clients/serviceClients", () => ({
  platformClient: { findOneProject: read },
}));
vi.mock("../useWebsocketSubscriptions", () => ({
  useWebsocketSubscriptions: vi.fn(),
}));
describe("useProject query lifecycle", () => {
  beforeEach(() => vi.clearAllMocks());
  it("keeps a disabled read unstarted and non-error", async () => {
    const { result } = renderHook(() => useProject(undefined));
    expect(result.current.isFetched).toBe(false);
    expect(result.current.isReady).toBe(false);
    expect(result.current.error).toBeNull();
    expect(await result.current.refetch()).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
  it("shares the initial read and exposes a completed successful result", async () => {
    let finish!: (response: unknown) => void;
    read.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const { result } = renderHook(() => [
      useProject("org", "project"),
      useProject("org", "project"),
    ]);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(result.current[0].isLoading).toBe(true);
    expect(result.current[0].error).toBeNull();
    expect(result.current[0].isReady).toBe(false);
    await act(async () =>
      finish({ data: { data: { id: "project", name: "Project" } } })
    );
    await waitFor(() => expect(result.current[0].isReady).toBe(true));
    expect(result.current[1].isFetched).toBe(true);
    expect(result.current[0].data).toEqual({ id: "project", name: "Project" });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("exposes only a settled read failure and can explicitly recover", async () => {
    read.mockRejectedValue(
      Object.assign(new Error("forbidden"), { status: 403 })
    );
    const { result } = renderHook(() => useProject("org", "project"));
    await waitFor(() =>
      expect(result.current.error?.message).toBe("forbidden")
    );
    expect(result.current.isReady).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    read.mockResolvedValue({
      data: { data: { id: "project", name: "Project" } },
    });
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.error).toBeNull();
  });
});
