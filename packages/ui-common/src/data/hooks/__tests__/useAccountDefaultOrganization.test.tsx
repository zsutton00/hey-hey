import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../../clients";
import { useAccountDefaultOrganization } from "../useAccountDefaultOrganization";

vi.mock("../../../clients", () => ({
  apiClient: {
    getAccountDefaultOrganization: vi.fn(),
    setAccountDefaultOrganization: vi.fn(),
  },
}));

const read = vi.mocked(apiClient.getAccountDefaultOrganization);
const save = vi.mocked(apiClient.setAccountDefaultOrganization);
const response = (organizationId: string | null) => ({
  data: { data: { organizationId } },
});

describe("account organization preference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the default unknown while loading, then confirms only a successful explicit save", async () => {
    read.mockResolvedValue(response(null) as Awaited<ReturnType<typeof read>>);
    let finish: (value: Awaited<ReturnType<typeof save>>) => void = () => {};
    save.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const { result } = renderHook(() =>
      useAccountDefaultOrganization("account-a")
    );
    expect(result.current.state.status).toBe("loading");
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    act(() => {
      void result.current.save("00000000-0000-4000-8000-000000000002");
    });
    expect(save).toHaveBeenCalledWith({
      setAccountDefaultOrganizationDto: {
        organizationId: "00000000-0000-4000-8000-000000000002",
      },
    });
    expect(result.current.state).toEqual({
      status: "saving",
      preference: { organizationId: null },
    });
    await act(async () =>
      finish(
        response("00000000-0000-4000-8000-000000000002") as Awaited<
          ReturnType<typeof save>
        >
      )
    );
    expect(result.current.state).toEqual({
      status: "saved",
      preference: { organizationId: "00000000-0000-4000-8000-000000000002" },
    });
  });

  it("preserves the known preference after a failed save and supports retry", async () => {
    read.mockResolvedValue(
      response("00000000-0000-4000-8000-000000000001") as Awaited<
        ReturnType<typeof read>
      >
    );
    save.mockRejectedValueOnce(new Error("denied"));
    const { result } = renderHook(() =>
      useAccountDefaultOrganization("account-a")
    );
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    await act(() =>
      result.current.save("00000000-0000-4000-8000-000000000002")
    );
    expect(result.current.state).toMatchObject({
      status: "save-error",
      preference: { organizationId: "00000000-0000-4000-8000-000000000001" },
    });
    save.mockResolvedValue(
      response("00000000-0000-4000-8000-000000000002") as Awaited<
        ReturnType<typeof save>
      >
    );
    await act(() =>
      result.current.save("00000000-0000-4000-8000-000000000002")
    );
    expect(result.current.state.status).toBe("saved");
  });

  it("discards an old account response after identity changes", async () => {
    let finish: (value: Awaited<ReturnType<typeof read>>) => void = () => {};
    read.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    read.mockResolvedValueOnce(
      response(null) as Awaited<ReturnType<typeof read>>
    );
    const { result, rerender } = renderHook(
      ({ account }) => useAccountDefaultOrganization(account),
      { initialProps: { account: "account-a" } }
    );
    rerender({ account: "account-b" });
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    await act(async () =>
      finish(
        response("00000000-0000-4000-8000-000000000001") as Awaited<
          ReturnType<typeof read>
        >
      )
    );
    expect(result.current.state).toEqual({
      status: "ready",
      preference: { organizationId: null },
    });
  });

  it("exposes load failure without implying an absent default", async () => {
    read.mockRejectedValueOnce(new Error("unavailable"));
    const { result } = renderHook(() =>
      useAccountDefaultOrganization("account-a")
    );
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    await act(() =>
      result.current.save("00000000-0000-4000-8000-000000000002")
    );
    expect(save).not.toHaveBeenCalled();
    read.mockResolvedValue(response(null) as Awaited<ReturnType<typeof read>>);
    await act(() => result.current.reload());
    expect(result.current.state.status).toBe("ready");
  });
});
