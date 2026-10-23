import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useService } from "../useService";
import { serviceKeys } from "../../collections/services";
import type { ServiceDto } from "../../../api";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../../clients", () => ({ dataClient: { request } }));

const service = {
  id: "service-1",
  name: "Backend API",
  organizationId: "org-1",
  projectId: "project-1",
  status: "ACTIVE",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
} as unknown as ServiceDto;

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
  request.mockResolvedValue(ok(service));
});

describe("useService", () => {
  it("reads the service by id", async () => {
    const { wrapper, queryClient } = createHarness();

    const { result } = renderHook(() => useService("org-1", "service-1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.data).toEqual(service);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/organizations/org-1/services/service-1",
      })
    );
    expect(
      queryClient.getQueryData(serviceKeys.byId("org-1", "service-1"))
    ).toEqual(service);
  });

  it("serves a seeded cache without a request", () => {
    const { wrapper, queryClient } = createHarness();
    queryClient.setQueryData(serviceKeys.byId("org-1", "service-1"), service);

    const { result } = renderHook(() => useService("org-1", "service-1"), {
      wrapper,
    });

    expect(result.current.data).toEqual(service);
    expect(request).not.toHaveBeenCalled();
  });

  it("shares one request between hooks on the same id", async () => {
    const { wrapper } = createHarness();

    const { result } = renderHook(
      () => ({
        a: useService("org-1", "service-1"),
        b: useService("org-1", "service-1"),
      }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.b.isReady).toBe(true));
    expect(result.current.a.data).toEqual(service);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["both identifiers", undefined, undefined],
    ["organizationId", undefined, "service-1"],
    ["serviceId", "org-1", undefined],
  ])("stays idle without %s", (_label, organizationId, serviceId) => {
    const { wrapper } = createHarness();

    const { result } = renderHook(
      () => useService(organizationId, serviceId),
      { wrapper }
    );

    expect(request).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isReady).toBe(false);
  });

  it("presents an in-flight first read as loading", () => {
    request.mockImplementation(() => new Promise(() => {}));
    const { wrapper } = createHarness();

    const { result } = renderHook(() => useService("org-1", "service-1"), {
      wrapper,
    });

    expect(result.current.data).toBeNull();
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isFetching).toBe(true);
    expect(result.current.isFetched).toBe(false);
    expect(result.current.isReady).toBe(false);
  });

  it("surfaces a missing service as an error, not a null success", async () => {
    request.mockResolvedValue(ok(null));
    const { wrapper } = createHarness();

    const { result } = renderHook(() => useService("org-1", "missing"), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current.error?.message).toBe("Service not found: missing")
    );
    expect(result.current.data).toBeNull();
    expect(result.current.isReady).toBe(false);
  });

  it("refetch re-reads the service", async () => {
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useService("org-1", "service-1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));

    const updated = { ...service, name: "Renamed" };
    request.mockResolvedValue(ok(updated));
    let refetched: unknown;
    await act(async () => {
      refetched = await result.current.refetch();
    });

    expect(refetched).toEqual(updated);
    expect(request).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.data).toEqual(updated));
  });
});
