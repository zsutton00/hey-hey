import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOrganizationsDirectory } from "../useOrganizationsDirectory";
const { read, identity } = vi.hoisted(() => ({
  read: vi.fn(),
  identity: vi.fn(),
}));
vi.mock("../../../services/authService", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getCurrentUser: identity,
}));
vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: { listOrganizationDirectory: read },
}));
vi.mock("../useWebsocketSubscriptions", () => ({
  useWebsocketSubscriptions: vi.fn(),
}));
describe("useOrganizationsDirectory query lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    identity.mockReturnValue(null);
  });
  it("keeps a disabled read unstarted and non-error", async () => {
    const { result } = renderHook(() =>
      useOrganizationsDirectory({ enabled: false })
    );
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
      useOrganizationsDirectory({}),
      useOrganizationsDirectory({}),
    ]);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(result.current[0].isLoading).toBe(true);
    expect(result.current[0].error).toBeNull();
    expect(result.current[0].isReady).toBe(false);
    await act(async () =>
      finish({
        data: { data: { organizations: [], totalCount: 0, nextCursor: null } },
      })
    );
    await waitFor(() => expect(result.current[0].isReady).toBe(true));
    expect(result.current[1].isFetched).toBe(true);
    expect(result.current[0].organizations).toEqual([]);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("exposes only a settled read failure and can explicitly recover", async () => {
    read.mockRejectedValue(
      Object.assign(new Error("forbidden"), { status: 403 })
    );
    const { result } = renderHook(() => useOrganizationsDirectory({}));
    await waitFor(() =>
      expect(result.current.error?.message).toBe("forbidden")
    );
    expect(result.current.isReady).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    read.mockResolvedValue({
      data: { data: { organizations: [], totalCount: 0, nextCursor: null } },
    });
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.error).toBeNull();
  });
  it("isolates signed-in identities and withholds prior authorized rows after a forbidden read", async () => {
    identity.mockReturnValue({ id: "administrator", isDevAdmin: true });
    const page = {
      organizations: [
        {
          id: "org",
          name: "Organization",
          createdAt: "2026-01-01T00:00:00Z",
          memberCount: 1,
          subscriptionType: "BETA",
          accessStatus: "ACTIVE",
        },
      ],
      totalCount: 1,
      nextCursor: null,
    };
    read.mockResolvedValue({ data: { data: page } });
    const { result, rerender } = renderHook(() => useOrganizationsDirectory());
    await waitFor(() => expect(result.current.organizations).toHaveLength(1));
    identity.mockReturnValue({ id: "other-user", isDevAdmin: false });
    read.mockRejectedValue(
      Object.assign(new Error("forbidden"), { status: 403 })
    );
    rerender();
    expect(result.current.organizations).toEqual([]);
    await waitFor(() => expect(result.current.isForbidden).toBe(true));
    expect(result.current.page).toBeNull();
    expect(result.current.isReady).toBe(false);
  });
  it("withholds cached rows when the protected read is disabled", async () => {
    read.mockResolvedValue({
      data: { data: { organizations: [], totalCount: 0, nextCursor: null } },
    });
    const { result, rerender } = renderHook(
      ({ enabled }) => useOrganizationsDirectory({ enabled }),
      { initialProps: { enabled: true } }
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));
    rerender({ enabled: false });
    expect(result.current.page).toBeNull();
    expect(result.current.isReady).toBe(false);
  });
});
