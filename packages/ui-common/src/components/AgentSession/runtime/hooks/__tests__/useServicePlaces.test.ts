import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useServicePlaces } from "../useServicePlaces";

const mocks = vi.hoisted(() => ({
  machines: [{ machineId: "machine-1", executionReadiness: "READY" }],
  authorize: vi.fn(),
  read: vi.fn(),
  recent: vi.fn(),
}));

vi.mock("../../../../../clients", () => ({
  agentSessionsClient: {
    listMachineServicePlaces: mocks.read,
    listRecentServicePlaces: mocks.recent,
  },
}));
vi.mock("../../../../../data/hooks/useUserPairedMachines", () => ({
  useUserPairedMachines: () => ({
    machines: mocks.machines,
    isLoading: false,
    isFetched: true,
    error: null,
  }),
}));
vi.mock("../../../../../data/hooks/useControllerAuthorizedAction", () => ({
  executeControllerAuthorizedAction: mocks.authorize,
}));

const options = {
  enabled: true,
  organizationId: "org-1",
  projectId: "project-1",
  machineId: "machine-1",
  serviceIds: ["svc-a", "svc-b"],
};

const placesResponse = (services: unknown[]) => ({
  data: {
    data: {
      requestId: "r",
      operation: "workspace.service_places.list",
      status: "success",
      result: { services },
    },
  },
});

const okEntry = (serviceId: string, branchMatches: string[] = []) => ({
  serviceId,
  status: "ok",
  mainFolder: { path: `/${serviceId}`, branch: "main" },
  worktrees: [],
  branchMatches,
  branchMatchesTruncated: false,
});

beforeEach(() => {
  mocks.authorize.mockReset();
  mocks.read.mockReset();
  mocks.recent.mockReset();
  mocks.authorize.mockImplementation(async ({ submit }) => ({
    outcome: "ADMITTED",
    data: await submit({
      authorization: { kind: "bounded_grant", grantId: "grant-1" },
    }),
  }));
  mocks.recent.mockResolvedValue({
    data: {
      data: {
        services: [
          {
            serviceId: "svc-a",
            branches: [
              {
                branch: "old",
                kind: "WORKTREE",
                lastRecordedAt: "2026-10-01T00:00:00Z",
              },
            ],
          },
          { serviceId: "svc-b", branches: [] },
        ],
      },
    },
  });
});

describe("useServicePlaces", () => {
  it("does not re-read places, which would close an open name field, when only the heartbeat changes", async () => {
    mocks.read.mockResolvedValue(
      placesResponse([okEntry("svc-a"), okEntry("svc-b")]),
    );
    const { result, rerender } = renderHook(() => useServicePlaces(options));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    mocks.machines = [
      { ...mocks.machines[0]!, lastSeen: "2026-11-25T00:00:00Z" },
    ];
    rerender();

    expect(result.current.status).toBe("ready");
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it("keeps one Service's read error from blocking the others", async () => {
    mocks.read.mockResolvedValue(
      placesResponse([
        okEntry("svc-a"),
        {
          serviceId: "svc-b",
          status: "error",
          code: "NOT_A_GIT_REPOSITORY",
          message: "Not a git repository",
        },
      ]),
    );

    const { result } = renderHook(() => useServicePlaces(options));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") {
      throw new Error("expected ready");
    }
    expect(result.current.byServiceId["svc-a"]).toMatchObject({
      status: "ready",
      recentBranches: [{ branch: "old" }],
    });
    expect(result.current.byServiceId["svc-b"]).toEqual({
      status: "error",
      message: "Not a git repository",
    });
    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({
        machineId: "machine-1",
        cliReadWorkspaceServicePlacesListRequest: expect.objectContaining({
          serviceIds: ["svc-a", "svc-b"],
          authorization: { kind: "bounded_grant", grantId: "grant-1" },
        }),
      }),
    );
  });

  it("searches branches with the typed text after a pause", async () => {
    mocks.read.mockImplementation(async (request) => {
      const query =
        request.cliReadWorkspaceServicePlacesListRequest.branchQuery;

      return placesResponse([
        okEntry("svc-a", query ? ["fix/login"] : []),
        okEntry("svc-b"),
      ]);
    });

    const { result, rerender } = renderHook(
      ({ branchQuery }) => useServicePlaces({ ...options, branchQuery }),
      { initialProps: { branchQuery: "" } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(mocks.read).toHaveBeenCalledTimes(1);

    rerender({ branchQuery: "fix" });

    await waitFor(() => {
      if (result.current.status !== "ready") {
        throw new Error("expected ready");
      }
      expect(result.current.byServiceId["svc-a"]).toMatchObject({
        branchMatches: ["fix/login"],
      });
    });
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it("reports the whole read as unavailable when it fails", async () => {
    mocks.read.mockRejectedValue(new Error("machine offline"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { result } = renderHook(() => useServicePlaces(options));

    await waitFor(() =>
      expect(result.current).toEqual({
        status: "unavailable",
        message: "machine offline",
      }),
    );
  });

  it("reports a failed branch search without staying in flight", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.read.mockImplementation(async (request) => {
      if (request.cliReadWorkspaceServicePlacesListRequest.branchQuery) {
        throw new Error("search blew up");
      }

      return placesResponse([okEntry("svc-a"), okEntry("svc-b")]);
    });

    const { result, rerender } = renderHook(
      ({ branchQuery }) => useServicePlaces({ ...options, branchQuery }),
      { initialProps: { branchQuery: "" } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));

    rerender({ branchQuery: "fix" });

    await waitFor(() =>
      expect(result.current).toMatchObject({
        status: "ready",
        searching: false,
        searchError: "search blew up",
      }),
    );
  });

  it("treats a successful search with no matches as empty, not failed", async () => {
    mocks.read.mockResolvedValue(
      placesResponse([okEntry("svc-a"), okEntry("svc-b")]),
    );

    const { result, rerender } = renderHook(
      ({ branchQuery }) => useServicePlaces({ ...options, branchQuery }),
      { initialProps: { branchQuery: "" } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));

    rerender({ branchQuery: "zzz" });

    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(result.current).toMatchObject({
        searching: false,
        searchError: null,
      }),
    );
    if (result.current.status !== "ready") {
      throw new Error("expected ready");
    }
    expect(result.current.byServiceId["svc-a"]).toMatchObject({
      branchMatches: [],
    });
  });
});
