import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { reportKeys } from "../../collections/reports";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProjectReportPreviewDto,
  ProjectReportPreviewRequestDto,
  ProjectReportRequestDto,
} from "../../../api";

const reportsClient = vi.hoisted(() => ({
  listReports: vi.fn(),
  listProjectReports: vi.fn(),
}));
const client = vi.hoisted(() => ({
  previewProjectReportRequest: vi.fn(),
  createProjectReportRequest: vi.fn(),
  getProjectReportRequest: vi.fn(),
  retryProjectReportRequest: vi.fn(),
}));
vi.mock("../../../clients/serviceClients", () => ({
  projectReportsClient: client,
  unifiedApiClient: reportsClient,
}));
import { useProjectReportPreview } from "../useProjectReportPreview";
import { useCreateProjectReportRequest } from "../useCreateProjectReportRequest";
import { useReports } from "../useReports";
import { useProjectReports } from "../useProjectReports";
import { useProjectReportRequestStatus } from "../useProjectReportRequestStatus";

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);
const previewRequest = (offset: number): ProjectReportPreviewRequestDto => ({
  scope: {
    projectId: "p",
    windowStart: "2026-09-26T00:00:00.000Z",
    windowEnd: "2026-09-27T00:00:00.000Z",
    timeZone: "UTC",
  },
  exclusions: [],
  limit: 10,
  offset,
});

const previewDto = (matching: number): ProjectReportPreviewDto => ({
  subjects: [],
  matchingSubjectCount: matching,
  includedSubjectCount: matching,
  excludedSubjectCount: 0,
  displayedSubjectCount: matching,
  queriedAt: "2026-09-27T00:00:00.000Z",
});

/** Mirrors the API's response envelope around every DTO. */
const wrapped = <T,>(data: T) => ({
  data: {
    success: true,
    message: "Request processed successfully",
    data,
    timestamp: "2026-09-27T00:00:00.000Z",
    statusCode: 200,
  },
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

const requestDto = (
  status: ProjectReportRequestDto["status"],
  reportId?: string
): ProjectReportRequestDto => ({
  id: "req-1",
  organizationId: "org",
  projectId: "p",
  userId: "user",
  submission: {
    question: "q",
    scope: previewRequest(0).scope,
    exclusions: [],
    launch: {
      machineId: "machine",
      provider: "claude",
      model: "opus",
      effort: "medium",
    },
    idempotencyKey: "k",
  },
  status,
  attempts: [
    {
      id: "attempt-1",
      attemptNumber: 1,
      status,
      idempotencyKey: "k",
      createdAt: "2026-09-27T00:00:00.000Z",
      ...(reportId ? { reportId } : {}),
    },
  ],
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
});
afterEach(() => queryClient.clear());
beforeEach(() => {
  Object.values(client).forEach((fn) => fn.mockReset());
  Object.values(reportsClient).forEach((fn) => fn.mockReset());
  queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
});

describe("useProjectReportPreview", () => {
  it("discards a response for a superseded request and never reports it as current", async () => {
    const first =
      deferred<ReturnType<typeof wrapped<ProjectReportPreviewDto>>>();
    const second =
      deferred<ReturnType<typeof wrapped<ProjectReportPreviewDto>>>();
    client.previewProjectReportRequest
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(
      ({ request }) => useProjectReportPreview("org", "p", request),
      { wrapper, initialProps: { request: previewRequest(0) } }
    );
    rerender({ request: previewRequest(10) });
    await act(async () => first.resolve(wrapped(previewDto(1))));
    expect(result.current.data).toBeNull();
    expect(result.current.isLoading).toBe(true);

    await act(async () => second.resolve(wrapped(previewDto(2))));
    await waitFor(() =>
      expect(result.current.data?.matchingSubjectCount).toBe(2)
    );
    expect(client.previewProjectReportRequest).toHaveBeenLastCalledWith(
      {
        organizationId: "org",
        projectId: "p",
        projectReportPreviewRequestDto: previewRequest(10),
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("refresh re-runs the same request without presenting the old counts", async () => {
    client.previewProjectReportRequest.mockResolvedValueOnce(
      wrapped(previewDto(1))
    );
    const refreshed =
      deferred<ReturnType<typeof wrapped<ProjectReportPreviewDto>>>();
    client.previewProjectReportRequest.mockReturnValueOnce(refreshed.promise);
    const request = previewRequest(0);
    const { result } = renderHook(
      () => useProjectReportPreview("org", "p", request),
      { wrapper }
    );
    await waitFor(() =>
      expect(result.current.data?.matchingSubjectCount).toBe(1)
    );

    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.data).toBeNull());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.lastSettled?.data.matchingSubjectCount).toBe(1);
    await act(async () => refreshed.resolve(wrapped(previewDto(4))));
    await waitFor(() =>
      expect(result.current.data?.matchingSubjectCount).toBe(4)
    );
    expect(
      client.previewProjectReportRequest.mock.calls[1][0]
        .projectReportPreviewRequestDto
    ).toEqual(request);
  });

  it("exposes failures for the current request", async () => {
    client.previewProjectReportRequest.mockRejectedValue(
      Object.assign(new Error("down"), { status: 403 })
    );
    const { result } = renderHook(
      () => useProjectReportPreview("org", "p", previewRequest(0)),
      { wrapper }
    );
    await waitFor(() => expect(result.current.error?.message).toBe("down"));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeNull();
  });
});

describe("useCreateProjectReportRequest", () => {
  it("posts the generated create DTO and returns the durable request", async () => {
    client.createProjectReportRequest.mockResolvedValueOnce(
      wrapped(requestDto("QUEUED"))
    );
    const { result } = renderHook(() => useCreateProjectReportRequest(), {
      wrapper,
    });
    const body = requestDto("QUEUED").submission;
    let created: ProjectReportRequestDto | undefined;
    await act(async () => {
      created = await result.current.mutate({
        organizationId: "org",
        projectId: "p",
        request: body,
      });
    });
    expect(created?.id).toBe("req-1");
    expect(
      queryClient.getQueryData(reportKeys.projectRequest("org", "p", "req-1"))
    ).toEqual(created);
    expect(client.createProjectReportRequest).toHaveBeenCalledWith({
      organizationId: "org",
      projectId: "p",
      createProjectReportRequestDto: body,
    });
  });
});

describe("useProjectReportRequestStatus", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const flush = async () => {
    await act(async () => {});
    await act(async () => vi.advanceTimersByTime(1));
  };
  it("shares polling, stops on completion, and invalidates each project list once", async () => {
    client.getProjectReportRequest
      .mockResolvedValueOnce(wrapped(requestDto("RUNNING")))
      .mockResolvedValueOnce(wrapped(requestDto("COMPLETED", "report-1")));
    queryClient.setQueryData([...reportKeys.projectList("org", "p"), {}], []);
    queryClient.setQueryData([...reportKeys.entityList("org", "p"), {}], []);
    queryClient.setQueryData(
      [...reportKeys.projectList("org", "other"), {}],
      []
    );
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(
      () => ({
        a: useProjectReportRequestStatus("org", "p", "req-1", {
          pollIntervalMs: 1000,
        }),
        b: useProjectReportRequestStatus("org", "p", "req-1", {
          pollIntervalMs: 1000,
        }),
      }),
      { wrapper }
    );
    await flush();
    expect(result.current.a.request?.status).toBe("RUNNING");
    expect(result.current.b.request?.status).toBe("RUNNING");
    expect(client.getProjectReportRequest).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1000));
    await flush();
    expect(result.current.a.request?.status).toBe("COMPLETED");
    expect(result.current.b.request?.status).toBe("COMPLETED");
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(
      queryClient.getQueryState([...reportKeys.projectList("org", "p"), {}])
        ?.isInvalidated
    ).toBe(true);
    expect(
      queryClient.getQueryState([...reportKeys.entityList("org", "p"), {}])
        ?.isInvalidated
    ).toBe(true);
    expect(
      queryClient.getQueryState([...reportKeys.projectList("org", "other"), {}])
        ?.isInvalidated
    ).toBe(false);
    await act(async () => vi.advanceTimersByTime(5000));
    expect(client.getProjectReportRequest).toHaveBeenCalledTimes(2);
  });
  it("seeds matching initial data without an immediate duplicate read", async () => {
    client.getProjectReportRequest.mockResolvedValue(
      wrapped(requestDto("RUNNING"))
    );
    const { result } = renderHook(
      () =>
        useProjectReportRequestStatus("org", "p", "req-1", {
          initialRequest: requestDto("QUEUED"),
          pollIntervalMs: 1000,
        }),
      { wrapper }
    );
    expect(result.current.request?.status).toBe("QUEUED");
    expect(client.getProjectReportRequest).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1000));
    await flush();
    expect(result.current.request?.status).toBe("RUNNING");
  });
  it("stops on failure and resumes polling after accept across observers", async () => {
    client.getProjectReportRequest
      .mockResolvedValueOnce(wrapped(requestDto("FAILED")))
      .mockResolvedValue(wrapped(requestDto("RUNNING")));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(
      () => ({
        a: useProjectReportRequestStatus("org", "p", "req-1", {
          pollIntervalMs: 1000,
        }),
        b: useProjectReportRequestStatus("org", "p", "req-1", {
          pollIntervalMs: 1000,
        }),
      }),
      { wrapper }
    );
    await flush();
    expect(result.current.a.request?.status).toBe("FAILED");
    await act(async () => vi.advanceTimersByTime(2000));
    expect(client.getProjectReportRequest).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
    act(() => result.current.a.accept(requestDto("QUEUED")));
    await flush();
    expect(result.current.b.request?.status).toBe("QUEUED");
    await act(async () => vi.advanceTimersByTime(1000));
    await flush();
    expect(result.current.b.request?.status).toBe("RUNNING");
  });
  it("does not adopt a seed or response from another request", async () => {
    const pending =
      deferred<ReturnType<typeof wrapped<ProjectReportRequestDto>>>();
    client.getProjectReportRequest.mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(
      ({ id }) =>
        useProjectReportRequestStatus("org", "p", id, {
          initialRequest: requestDto("QUEUED"),
        }),
      { wrapper, initialProps: { id: "req-1" } }
    );
    rerender({ id: "req-2" });
    expect(result.current.request).toBeNull();
    act(() => result.current.accept(requestDto("RUNNING")));
    expect(result.current.request).toBeNull();
  });
});

describe("shared report query wiring", () => {
  it("reads each mounted affected list once when a request produces a report", async () => {
    reportsClient.listReports.mockResolvedValue(wrapped([]));
    reportsClient.listProjectReports.mockResolvedValue(wrapped([]));
    const { result } = renderHook(
      () => ({
        project: useProjectReports("org", "p"),
        duplicate: useProjectReports("org", "p"),
        other: useProjectReports("org", "other"),
        entity: useReports("org", { projectId: "p", entityId: "entity" }),
        otherEntity: useReports("org", { projectId: "other" }),
        request: useProjectReportRequestStatus("org", "p", "req-1", {
          initialRequest: requestDto("QUEUED"),
        }),
        duplicateRequest: useProjectReportRequestStatus("org", "p", "req-1"),
      }),
      { wrapper }
    );
    await waitFor(() =>
      expect(
        result.current.project.isReady &&
          result.current.entity.isReady &&
          result.current.other.isReady &&
          result.current.otherEntity.isReady
      ).toBe(true)
    );
    expect(reportsClient.listProjectReports).toHaveBeenCalledTimes(2);
    expect(reportsClient.listReports).toHaveBeenCalledTimes(2);
    act(() =>
      result.current.request.accept(requestDto("COMPLETED", "report-1"))
    );
    await waitFor(() =>
      expect(reportsClient.listProjectReports).toHaveBeenCalledTimes(3)
    );
    await waitFor(() =>
      expect(reportsClient.listReports).toHaveBeenCalledTimes(3)
    );
    expect(
      reportsClient.listProjectReports.mock.calls.filter(
        ([params]) => params.projectId === "other"
      )
    ).toHaveLength(1);
    expect(
      reportsClient.listReports.mock.calls.filter(
        ([params]) => params.projectId === "other"
      )
    ).toHaveLength(1);
    act(() =>
      result.current.duplicateRequest.accept(
        requestDto("COMPLETED", "report-1")
      )
    );
    await act(async () => {});
    expect(reportsClient.listProjectReports).toHaveBeenCalledTimes(3);
    expect(reportsClient.listReports).toHaveBeenCalledTimes(3);
  });
  it("cancels an older in-flight poll before accepting a newer request", async () => {
    const pending =
      deferred<ReturnType<typeof wrapped<ProjectReportRequestDto>>>();
    client.getProjectReportRequest.mockReturnValue(pending.promise);
    const { result } = renderHook(
      () => ({
        a: useProjectReportRequestStatus("org", "p", "req-1"),
        b: useProjectReportRequestStatus("org", "p", "req-1"),
      }),
      { wrapper }
    );
    act(() => result.current.a.accept(requestDto("COMPLETED", "report-1")));
    await waitFor(() =>
      expect(result.current.b.request?.status).toBe("COMPLETED")
    );
    await act(async () => pending.resolve(wrapped(requestDto("RUNNING"))));
    expect(
      queryClient.getQueryData(reportKeys.projectRequest("org", "p", "req-1"))
    ).toEqual(requestDto("COMPLETED", "report-1"));
  });
  it("shares previews and reuses fresh data when returning to an earlier request", async () => {
    client.previewProjectReportRequest.mockResolvedValue(
      wrapped(previewDto(2))
    );
    const { result, rerender } = renderHook(
      ({ offset }) => ({
        a: useProjectReportPreview("org", "p", previewRequest(offset)),
        b: useProjectReportPreview("org", "p", previewRequest(offset)),
      }),
      { wrapper, initialProps: { offset: 0 } }
    );
    await waitFor(() =>
      expect(result.current.b.data?.matchingSubjectCount).toBe(2)
    );
    expect(client.previewProjectReportRequest).toHaveBeenCalledTimes(1);
    rerender({ offset: 10 });
    expect(result.current.a.data).toBeNull();
    expect(result.current.a.lastSettled?.data.matchingSubjectCount).toBe(2);
    await waitFor(() =>
      expect(result.current.b.data?.matchingSubjectCount).toBe(2)
    );
    expect(client.previewProjectReportRequest).toHaveBeenCalledTimes(2);
    rerender({ offset: 0 });
    expect(result.current.a.data?.matchingSubjectCount).toBe(2);
    expect(client.previewProjectReportRequest).toHaveBeenCalledTimes(2);
  });
  it("exposes only a settled status-read failure and recovers on explicit refetch", async () => {
    client.getProjectReportRequest.mockRejectedValue(
      Object.assign(new Error("denied"), { status: 403 })
    );
    const { result } = renderHook(
      () => useProjectReportRequestStatus("org", "p", "req-1"),
      { wrapper }
    );
    expect(result.current.error).toBeNull();
    await waitFor(() => expect(result.current.error?.message).toBe("denied"));
    client.getProjectReportRequest.mockResolvedValue(
      wrapped(requestDto("FAILED"))
    );
    await act(async () => result.current.refetch());
    await waitFor(() => expect(result.current.request?.status).toBe("FAILED"));
    expect(result.current.error).toBeNull();
  });
});
