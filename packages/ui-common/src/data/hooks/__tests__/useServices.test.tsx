import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useServices } from "../useServices";
import { serviceKeys } from "../../collections/services";
import type { ServiceDto } from "../../../api";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../../clients", () => ({ dataClient: { request } }));

const services = [
  {
    id: "service-1",
    name: "Backend API",
    organizationId: "org-1",
    projectId: "project-1",
    status: "ACTIVE",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
] as unknown as ServiceDto[];

const ok = (data: unknown) => ({ data: { success: true, data } });

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  request.mockResolvedValue(ok(services));
});

describe("useServices", () => {
  it.each([
    [{ projectId: "project-1" }, { projectId: "project-1" }],
    [{ status: "ACTIVE" as const }, { status: "ACTIVE" }],
    [
      { projectId: "project-1", status: "ARCHIVED" as const },
      { projectId: "project-1", status: "ARCHIVED" },
    ],
  ])("reads services filtered by %o", async (filters, params) => {
    const { wrapper, queryClient } = createHarness();

    const { result } = renderHook(() => useServices("org-1", filters), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.services).toEqual(services);
    expect(result.current.data).toBe(result.current.services);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ url: "/organizations/org-1/services", params })
    );
    expect(queryClient.getQueryData(serviceKeys.list("org-1", filters))).toEqual(
      services
    );
  });

  it("serves a seeded cache without a request", () => {
    const { wrapper, queryClient } = createHarness();
    queryClient.setQueryData(serviceKeys.list("org-1"), services);

    const { result } = renderHook(() => useServices("org-1"), { wrapper });

    expect(result.current.services).toEqual(services);
    expect(request).not.toHaveBeenCalled();
  });

  it("shares one request between hooks on the same key", async () => {
    const { wrapper } = createHarness();

    const { result } = renderHook(
      () => ({
        a: useServices("org-1", { projectId: "project-1" }),
        b: useServices("org-1", { projectId: "project-1" }),
      }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.b.isReady).toBe(true));
    expect(result.current.a.services).toEqual(services);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["organization is missing", undefined, {}],
    ["the caller disables it", "org-1", { enabled: false }],
  ])("stays idle when %s", (_label, organizationId, options) => {
    const { wrapper } = createHarness();

    const { result } = renderHook(
      () => useServices(organizationId, { projectId: "project-1", ...options }),
      { wrapper }
    );

    expect(request).not.toHaveBeenCalled();
    expect(result.current.services).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isReady).toBe(false);
  });

  it("presents an in-flight first read as loading", () => {
    request.mockImplementation(() => new Promise(() => {}));
    const { wrapper } = createHarness();

    const { result } = renderHook(() => useServices("org-1"), { wrapper });

    expect(result.current.services).toEqual([]);
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isFetching).toBe(true);
    expect(result.current.isFetched).toBe(false);
    expect(result.current.isReady).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("surfaces failures without treating them as empty-and-ready", async () => {
    request.mockRejectedValue(new Error("Test error"));
    const { wrapper } = createHarness();

    const { result } = renderHook(() => useServices("org-1"), { wrapper });

    await waitFor(() => expect(result.current.error?.message).toBe("Test error"));
    expect(result.current.isReady).toBe(false);
    expect(result.current.services).toEqual([]);
  });
});
