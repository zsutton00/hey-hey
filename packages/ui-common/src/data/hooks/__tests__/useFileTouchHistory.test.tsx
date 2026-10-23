import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useFileTaskHistory,
  useServiceFileHistory,
  useWorkItemFileHistory,
} from "../useFileTouchHistory";

vi.mock("../../query/useDataLayerQuery", () => ({ useDataLayerQuery: vi.fn() }));
import { useDataLayerQuery } from "../../query/useDataLayerQuery";
const mockQueryState = vi.fn();
const mockUseQuery = vi.mocked(useDataLayerQuery);

describe("file touch history hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockImplementation(() => { const query = mockQueryState(); return { result: { data: query.data }, state: query }; });
    mockQueryState.mockReturnValue({
      data: null,
      isLoading: false,
      isFetching: false,
      isFetched: false,
      error: null,
    });
  });

  it("keeps work history disabled until the host activates it", () => {
    const { result } = renderHook(() =>
      useWorkItemFileHistory({ active: false })
    );

    expect(result.current).toEqual({
      status: "disabled",
      history: null,
      isFetching: false,
    });
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ enabled: false })
    );
  });

  it("exposes loading, empty, updating, and ready task states", () => {
    const history = { kind: "task" as const, files: [] };
    for (const [status, queryState] of [
      [
        "loading",
        {
          data: null,
          isLoading: true,
          isFetching: true,
          isFetched: false,
          error: null,
        },
      ],
      [
        "empty",
        {
          data: history,
          isLoading: false,
          isFetching: false,
          isFetched: true,
          error: null,
        },
      ],
      [
        "updating",
        {
          data: {
            kind: "task" as const,
            files: [
              {
                serviceId: "s",
                serviceName: "UI",
                normalizedPath: "src/index.ts",
              },
            ],
          },
          isLoading: false,
          isFetching: true,
          isFetched: true,
          error: null,
        },
      ],
      [
        "ready",
        {
          data: {
            kind: "task" as const,
            files: [
              {
                serviceId: "s",
                serviceName: "UI",
                normalizedPath: "src/index.ts",
              },
            ],
          },
          isLoading: false,
          isFetching: false,
          isFetched: true,
          error: null,
        },
      ],
    ] as const) {
      mockQueryState.mockReturnValue(queryState);
      const { result } = renderHook(() =>
        useWorkItemFileHistory({
          organizationId: "org-1",
          projectId: "project-1",
          scope: { kind: "task", taskId: "task-1" },
          active: true,
        })
      );
      expect(result.current.status).toBe(status);
    }
  });

  it("keeps reverse history disabled without the complete file key", () => {
    const { result } = renderHook(() =>
      useFileTaskHistory({
        organizationId: "org-1",
        projectId: "project-1",
        serviceId: "service-1",
        normalizedPath: "",
        active: true,
      })
    );
    expect(result.current.status).toBe("disabled");
  });

  it("exposes disabled, loading, empty, updating, error, and ready service states", () => {
    const input = {
      organizationId: "org-1",
      projectId: "project-1",
      serviceId: "service-1",
      pathFilter: "",
      sortBy: "lastTouchedAt" as const,
      sortOrder: "DESC" as const,
      active: true,
    };
    const cases = [
      [
        "loading",
        {
          data: null,
          isLoading: true,
          isFetching: true,
          isFetched: false,
          error: null,
        },
      ],
      [
        "empty",
        {
          data: { files: [], nextCursor: null },
          isLoading: false,
          isFetching: false,
          isFetched: true,
          error: null,
        },
      ],
      [
        "updating",
        {
          data: {
            files: [{ normalizedPath: "src/index.ts" }],
            nextCursor: "next",
          },
          isLoading: false,
          isFetching: true,
          isFetched: true,
          error: null,
        },
      ],
      [
        "ready",
        {
          data: {
            files: [{ normalizedPath: "src/index.ts" }],
            nextCursor: "next",
          },
          isLoading: false,
          isFetching: false,
          isFetched: true,
          error: null,
        },
      ],
      [
        "error",
        {
          data: null,
          isLoading: false,
          isFetching: false,
          isFetched: true,
          error: new Error("failed"),
        },
      ],
    ] as const;
    for (const [status, query] of cases) {
      mockQueryState.mockReturnValue(query);
      const { result, unmount } = renderHook(() =>
        useServiceFileHistory(input)
      );
      expect(result.current.status).toBe(status);
      unmount();
    }

    const { result } = renderHook(() =>
      useServiceFileHistory({ ...input, active: false })
    );
    expect(result.current.status).toBe("disabled");
  });
});
