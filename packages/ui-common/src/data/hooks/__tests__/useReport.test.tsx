import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportType, type ReportDto } from "../../../api";
import { useReport } from "../useReport";
import { useReports } from "../useReports";
import { useProjectReports } from "../useProjectReports";
import {
  reportKeys,
  reportsQueryOptions,
  projectReportsQueryOptions,
} from "../../collections/reports";
import {
  dataLayerQueryRoots,
  invalidateAllDataLayerQueries,
} from "../../query/dataLayerInvalidation";

const api = vi.hoisted(() => ({
  getReport: vi.fn(),
  listReports: vi.fn(),
  listProjectReports: vi.fn(),
}));
vi.mock("../../../clients/serviceClients", async (original) => ({
  ...(await original<object>()),
  unifiedApiClient: api,
}));
const wrap = <T,>(data: T) => ({ data: { data } });
const report = (id: string, date = "2026-01-01", version = 1): ReportDto => ({
  id,
  organizationId: "org",
  reportType: ReportType.Snapshot,
  payload: {},
  schemaVersion: version,
  createdAt: date,
  expiresAt: "2026-12-01",
  entities: [],
});
const clients: QueryClient[] = [];
const setup = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
};
beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.useRealTimers();
});
describe("report reads", () => {
  it("shares details and both list reads across consumers and fresh remounts", async () => {
    api.getReport.mockResolvedValue(wrap(report("r")));
    api.listReports.mockResolvedValue(wrap([report("r")]));
    api.listProjectReports.mockResolvedValue(wrap([report("r")]));
    const { wrapper } = setup();
    const useAll = () => ({
      detail: useReport("org", "r"),
      entities: useReports("org", { projectId: "p" }),
      project: useProjectReports("org", "p"),
    });
    const first = renderHook(() => ({ a: useAll(), b: useAll() }), { wrapper });
    await waitFor(() =>
      expect(first.result.current.b.project.isReady).toBe(true)
    );
    expect(api.getReport).toHaveBeenCalledTimes(1);
    expect(api.listReports).toHaveBeenCalledTimes(1);
    expect(api.listProjectReports).toHaveBeenCalledTimes(1);
    first.unmount();
    const second = renderHook(useAll, { wrapper });
    expect(second.result.current.detail.data?.id).toBe("r");
    expect(api.getReport).toHaveBeenCalledTimes(1);
    expect(api.listReports).toHaveBeenCalledTimes(1);
    expect(api.listProjectReports).toHaveBeenCalledTimes(1);
  });
  it("sorts client-side without creating a second dataset", async () => {
    api.listReports.mockResolvedValue(
      wrap([report("old", "2026-01-01", 3), report("new", "2026-02-01", 1)])
    );
    const { wrapper } = setup();
    const { result } = renderHook(
      () => ({
        a: useReports("org"),
        b: useReports("org", { sortBy: "schemaVersion", sortDirection: "asc" }),
      }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.a.isReady).toBe(true));
    expect(result.current.a.reports.map((r) => r.id)).toEqual(["new", "old"]);
    expect(result.current.b.reports.map((r) => r.id)).toEqual(["new", "old"]);
    expect(api.listReports).toHaveBeenCalledTimes(1);
  });
  it("distinguishes disabled, pending, empty and failed reads and recovers on refetch", async () => {
    const { wrapper } = setup();
    let resolve!: (data: ReturnType<typeof wrap<ReportDto[]>>) => void;
    api.listReports.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      })
    );
    const { result, rerender } = renderHook(({ org }) => useReports(org), {
      wrapper,
      initialProps: { org: undefined as string | undefined },
    });
    expect(result.current).toMatchObject({
      isFetched: false,
      isReady: false,
      isLoading: false,
      error: null,
    });
    expect(api.listReports).not.toHaveBeenCalled();
    rerender({ org: "org" });
    expect(result.current).toMatchObject({
      isLoading: true,
      isFetched: false,
      error: null,
    });
    await act(async () => resolve(wrap([])));
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.reports).toEqual([]);
    api.listReports.mockRejectedValue(
      Object.assign(new Error("denied"), { status: 403 })
    );
    await act(async () => {
      await result.current.refetch().catch(() => {});
    });
    await waitFor(() => expect(result.current.error?.message).toBe("denied"));
    expect(result.current.isReady).toBe(false);
    api.listReports.mockResolvedValue(wrap([report("recovered")]));
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.data[0]?.id).toBe("recovered"));
    expect(result.current.error).toBeNull();
  });
  it("keeps a 404 cached for the freshness window", async () => {
    api.getReport.mockRejectedValue(
      Object.assign(new Error("missing"), { status: 404 })
    );
    const { wrapper } = setup();
    const first = renderHook(() => useReport("org", "absent"), { wrapper });
    await waitFor(() =>
      expect(first.result.current.error?.message).toBe("missing")
    );
    first.unmount();
    renderHook(() => useReport("org", "absent"), { wrapper });
    expect(api.getReport).toHaveBeenCalledTimes(1);
  });
  it("refreshes the report root on global invalidation", async () => {
    api.listReports.mockResolvedValue(wrap([]));
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useReports("org", { projectId: "p" }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(dataLayerQueryRoots()).toContainEqual(reportKeys.root());
    await act(async () => invalidateAllDataLayerQueries(client));
    expect(api.listReports).toHaveBeenCalledTimes(2);
  });
  it("canonicalizes project types while preserving genuine server variants", () => {
    expect(
      projectReportsQueryOptions("org", "p", {
        types: [ReportType.Snapshot, ReportType.CodingResearch],
      }).queryKey
    ).toEqual(
      projectReportsQueryOptions("org", "p", {
        types: [ReportType.CodingResearch, ReportType.Snapshot],
      }).queryKey
    );
    expect(
      reportsQueryOptions("org", { projectId: "p", limit: 1 }).queryKey
    ).not.toEqual(
      reportsQueryOptions("org", { projectId: "p", limit: 2 }).queryKey
    );
  });

  it("keeps expired report data visible while one fresh read runs", async () => {
    const { client, wrapper } = setup();
    const key = reportsQueryOptions("org", { projectId: "p" }).queryKey;
    client.setQueryData(key, [report("old")], {
      updatedAt: Date.now() - 10000,
    });
    let resolve!: (value: ReturnType<typeof wrap<ReportDto[]>>) => void;
    api.listReports.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      })
    );
    const { result } = renderHook(
      () => useReports("org", { projectId: "p", maxCacheAgeMs: 5000 }),
      { wrapper }
    );
    expect(result.current.data[0]?.id).toBe("old");
    expect(result.current).toMatchObject({
      isFetching: true,
      isStale: true,
      error: null,
    });
    expect(api.listReports).toHaveBeenCalledTimes(1);
    await act(async () => resolve(wrap([report("new")])));
    await waitFor(() => expect(result.current.data[0]?.id).toBe("new"));
    expect(result.current.isFetching).toBe(false);
  });
});
