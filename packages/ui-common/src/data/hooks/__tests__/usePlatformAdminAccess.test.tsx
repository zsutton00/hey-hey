import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ getPlatformAdminAccess: vi.fn() }));
const identity = vi.hoisted(() => ({
  current: null as { userId: string } | null,
}));

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: client,
}));
vi.mock("../../../hooks/useUserIdentity", () => ({
  useUserIdentity: () => identity.current,
}));

import { usePlatformAdminAccess } from "../usePlatformAdminAccess";

const ok = (isPlatformAdmin: boolean) => ({
  data: { success: true, data: { isPlatformAdmin } },
});

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe("usePlatformAdminAccess", () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.getPlatformAdminAccess.mockReset();
    identity.current = { userId: "user-1" };
  });

  afterEach(() => queryClient.clear());

  it("is unresolved and not admin while the server has not answered", () => {
    client.getPlatformAdminAccess.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => usePlatformAdminAccess(), {
      wrapper,
    });

    expect(result.current).toEqual({
      isPlatformAdmin: false,
      isResolved: false,
    });
  });

  it.each([true, false])(
    "reports the server's answer (%s)",
    async (isPlatformAdmin) => {
      client.getPlatformAdminAccess.mockResolvedValue(ok(isPlatformAdmin));

      const { result } = renderHook(
        () => ({ access: usePlatformAdminAccess() }),
        { wrapper },
      );

      await waitFor(() => expect(result.current.access.isResolved).toBe(true));
      expect(result.current.access.isPlatformAdmin).toBe(isPlatformAdmin);
    },
  );

  it("fails closed when the server refuses the read", async () => {
    client.getPlatformAdminAccess.mockRejectedValue(
      Object.assign(new Error("HTTP 401"), {
        isAxiosError: true,
        response: { status: 401 },
      }),
    );

    const { result } = renderHook(() => usePlatformAdminAccess(), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isResolved).toBe(true));
    expect(result.current.isPlatformAdmin).toBe(false);
  });

  it("does not ask the server when nobody is signed in", () => {
    identity.current = null;

    const { result } = renderHook(() => usePlatformAdminAccess(), {
      wrapper,
    });

    expect(result.current).toEqual({
      isPlatformAdmin: false,
      isResolved: true,
    });
    expect(client.getPlatformAdminAccess).not.toHaveBeenCalled();
  });
});
