import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CliReadProjectSessionCostRow,
  CliReadProjectSessionCostsResult,
} from "../../../api";
import {
  agentSessionsClient,
  dataClient,
  machinesClient,
} from "../../../clients";
import {
  buildProjectSessionCostsParams,
  fetchProjectSessionCosts,
} from "../../collections/projectSessionCosts";
import { useDataLayerQuery } from "../../query/useDataLayerQuery";
import { useProjectSessionCosts } from "../useProjectSessionCosts";
import { executeControllerAuthorizedAction } from "../useControllerAuthorizedAction";

vi.mock("../../query/useDataLayerQuery", () => ({
  useDataLayerQuery: vi.fn(),
}));
vi.mock("../../../clients", () => ({
  agentSessionsClient: {
    readAgentSessionCliState: vi.fn(),
  },
  dataClient: {
    request: vi.fn(),
  },
  machinesClient: {
    listMachines: vi.fn(),
  },
}));
vi.mock("../useControllerAuthorizedAction", () => ({
  executeControllerAuthorizedAction: vi.fn(),
}));

const useQueryMock = vi.mocked(useDataLayerQuery);
const readCostsMock = vi.mocked(agentSessionsClient.readAgentSessionCliState);
const readSessionMock = vi.mocked(dataClient.request);
const listMachinesMock = vi.mocked(machinesClient.listMachines);
const authorizeMock = vi.mocked(executeControllerAuthorizedAction);

const row = (agentSessionId: string): CliReadProjectSessionCostRow => ({
  agentSessionId,
  conversationId: "22222222-2222-4222-8222-222222222222",
  context: {
    entityType: "TASK",
    entityId: "33333333-3333-4333-8333-333333333333",
    entityTitle: `Session ${agentSessionId}`,
    promptType: "coding",
  },
  providerSessions: [],
  knownCostUsd: 1.25,
  completeness: "complete",
  latestActivityAt: "2026-07-28T12:00:00.000Z",
  costReadAt: "2026-07-28T12:05:00.000Z",
});

const successPage = (
  requestId: string,
  items: CliReadProjectSessionCostRow[],
  nextCursor: string | null = null
) => ({
  id: requestId,
  response: {
    requestId,
    operation: "project.session_costs.list" as const,
    status: "success" as const,
    result: {
      items,
      nextCursor,
      sourceAvailability: "available" as const,
      costReadAt: "2026-07-28T12:05:00.000Z",
    } satisfies CliReadProjectSessionCostsResult,
  },
});

const queryResult = (data: ReturnType<typeof successPage> | null) => ({
  result: { data },
  state: {
    isLoading: false,
    isFetching: false,
    isFetched: data !== null,
    error: null,
    isStale: false,
    refetch: vi.fn().mockResolvedValue(data),
    markStale: vi.fn(),
  },
});

describe("useProjectSessionCosts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readSessionMock.mockResolvedValue({
      data: { data: { machineId: "machine-1" } },
    });
    listMachinesMock.mockResolvedValue({
      data: {
        data: {
          machines: [
            {
              machineId: "machine-1",
              name: "Studio Mac",
              pairedAt: "2026-07-01T00:00:00.000Z",
              active: true,
              authorizationProtocolVersion: "V2",
              executionReadiness: "READY",
            },
          ],
        },
      },
    });
    authorizeMock.mockImplementation(async ({ submit }) => ({
      outcome: "ADMITTED",
      data: await submit({
        authorization: { kind: "bounded_grant", grantId: "grant-1" },
      }),
    }));
  });

  it("normalizes all source filters and routing identity into the cache key", () => {
    const key = buildProjectSessionCostsParams(
      "org-1",
      "project-1",
      "routing-session-1",
      {
        activityFrom: " 2026-07-01T00:00:00.000Z ",
        activityTo: "2026-07-28T23:59:59.999Z",
        minKnownCostUsd: 0,
        limit: 500,
        cursor: " next-page ",
      }
    );

    expect(key.routingAgentSessionId).toBe("routing-session-1");
    expect(key.activityFrom).toBe("2026-07-01T00:00:00.000Z");
    expect(key.minKnownCostUsd).toBeNull();
    expect(key.limit).toBe(100);
    expect(key.cursor).toBe("next-page");
  });

  it("sends one generated project collection request through the routing session", async () => {
    const requestId = "44444444-4444-4444-8444-444444444444";
    readCostsMock.mockResolvedValue({
      data: {
        success: true,
        message: "ok",
        timestamp: "2026-07-28T12:05:00.000Z",
        statusCode: 200,
        data: {
          requestId,
          operation: "project.session_costs.list",
          status: "success",
          result: {
            items: [],
            nextCursor: null,
            sourceAvailability: "available",
            costReadAt: "2026-07-28T12:05:00.000Z",
          },
        },
      },
    } as Awaited<ReturnType<typeof readCostsMock>>);
    const key = buildProjectSessionCostsParams(
      "org-1",
      "project-1",
      "routing-session-1",
      {
        activityFrom: "2026-07-01T00:00:00.000Z",
        minKnownCostUsd: 2.5,
        limit: 25,
      }
    );

    await expect(fetchProjectSessionCosts(key)).resolves.toMatchObject({
      id: requestId,
      response: { status: "success" },
    });
    expect(readCostsMock).toHaveBeenCalledWith(
      {
        organizationId: "org-1",
        projectId: "project-1",
        agentSessionId: "routing-session-1",
        cliReadRequestDto: {
          operation: "project.session_costs.list",
          projectId: "project-1",
          activityFrom: "2026-07-01T00:00:00.000Z",
          activityTo: undefined,
          minKnownCostUsd: 2.5,
          limit: 25,
          cursor: null,
          authorization: { kind: "bounded_grant", grantId: "grant-1" },
        },
      },
      {}
    );
  });

  it("appends cursor pages in source order without duplicate sessions", async () => {
    useQueryMock.mockImplementation(({ queryKey }) => {
      const cursor = queryKey[4].cursor;
      return queryResult(
        cursor === "next-page"
          ? successPage("request-2", [row("session-2"), row("session-3")])
          : successPage(
              "request-1",
              [row("session-1"), row("session-2")],
              "next-page"
            )
      );
    });

    const { result } = renderHook(() =>
      useProjectSessionCosts("org-1", "project-1", "routing-session-1")
    );
    await waitFor(() => expect(result.current.result?.items).toHaveLength(2));

    act(() => result.current.loadNextPage());

    await waitFor(() =>
      expect(
        result.current.result?.items.map((item) => item.agentSessionId)
      ).toEqual(["session-1", "session-2", "session-3"])
    );
  });

  it("deduplicates cursor pages by agent session ID instead of fallback titles", async () => {
    const duplicateTitle = "Session context unavailable";
    useQueryMock.mockImplementation(({ queryKey }) => {
      const cursor = queryKey[4].cursor;
      const firstRow = {
        ...row("session-1"),
        context: { ...row("session-1").context, entityTitle: duplicateTitle },
      };
      const secondRow = {
        ...row("session-2"),
        context: { ...row("session-2").context, entityTitle: duplicateTitle },
      };
      return queryResult(
        cursor === "next-page"
          ? successPage("request-2", [firstRow, secondRow])
          : successPage("request-1", [firstRow], "next-page")
      );
    });

    const { result } = renderHook(() =>
      useProjectSessionCosts("org-1", "project-1", "routing-session-1")
    );
    await waitFor(() => expect(result.current.result?.items).toHaveLength(1));

    act(() => result.current.loadNextPage());

    await waitFor(() =>
      expect(
        result.current.result?.items.map((item) => item.agentSessionId)
      ).toEqual(["session-1", "session-2"])
    );
  });

  it("hides prior pages immediately when normalized filters change", async () => {
    useQueryMock.mockImplementation(({ queryKey }) => {
      const minimum = queryKey[4].minKnownCostUsd;
      if (minimum === 2) {
        return queryResult(null);
      }
      return queryResult(successPage("all-request", [row("all-session")]));
    });

    const { result, rerender } = renderHook(
      ({ minKnownCostUsd }: { minKnownCostUsd?: number }) =>
        useProjectSessionCosts("org-1", "project-1", "routing-session-1", {
          minKnownCostUsd,
        }),
      { initialProps: { minKnownCostUsd: undefined } }
    );
    await waitFor(() =>
      expect(result.current.result?.items[0]?.agentSessionId).toBe(
        "all-session"
      )
    );

    rerender({ minKnownCostUsd: 2 });
    expect(result.current.result).toBeNull();
  });

  it("replaces accumulated results when the first page refreshes", async () => {
    let firstPage = successPage(
      "request-before-refresh",
      [row("session-old")],
      "next-page"
    );
    useQueryMock.mockImplementation(() => queryResult(firstPage));

    const { result, rerender } = renderHook(() =>
      useProjectSessionCosts("org-1", "project-1", "routing-session-1")
    );
    await waitFor(() =>
      expect(result.current.result?.items[0]?.agentSessionId).toBe(
        "session-old"
      )
    );

    firstPage = successPage("request-after-refresh", [row("session-new")]);
    rerender();

    await waitFor(() =>
      expect(
        result.current.result?.items.map((item) => item.agentSessionId)
      ).toEqual(["session-new"])
    );
  });
});
