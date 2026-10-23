import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentSessionsClient,
  dataClient,
  machinesClient,
} from "../../../clients";
import { fetchProviderUsage } from "../../collections/providerUsage";
import { useDataLayerQuery } from "../../query/useDataLayerQuery";
import { useProviderUsage } from "../useProviderUsage";
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
const readCliStateMock = vi.mocked(
  agentSessionsClient.readAgentSessionCliState,
);
const readSessionMock = vi.mocked(dataClient.request);
const listMachinesMock = vi.mocked(machinesClient.listMachines);
const authorizeMock = vi.mocked(executeControllerAuthorizedAction);

const queryResult = (data: unknown, isLoading = false) =>
  ({
    result: { data },
    state: {
      isLoading,
      isFetching: isLoading,
      isFetched: data !== null,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    },
  }) as unknown as ReturnType<typeof useDataLayerQuery>;

describe("useProviderUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readSessionMock.mockResolvedValue({
      data: { data: { machineId: "machine-1" } },
    });
    listMachinesMock.mockResolvedValue({
      data: { data: { machines: [{ machineId: "machine-1" }] } },
    } as never);
    authorizeMock.mockImplementation(async ({ submit }) => ({
      outcome: "ADMITTED",
      data: await submit({
        authorization: { kind: "bounded_grant", grantId: "grant-1" },
      }),
    }));
  });

  it("routes provider.usage.get through the authorized agent-session read", async () => {
    readCliStateMock.mockResolvedValue({
      data: {
        data: {
          requestId: "req-1",
          operation: "provider.usage.get",
          status: "success",
          result: { providers: [] },
        },
      },
    } as never);

    const read = await fetchProviderUsage({
      organizationId: "org-1",
      projectId: "project-1",
      routingAgentSessionId: "routing-session-1",
    });

    expect(readCliStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSessionId: "routing-session-1",
        cliReadRequestDto: {
          operation: "provider.usage.get",
          authorization: { kind: "bounded_grant", grantId: "grant-1" },
        },
      }),
      expect.anything(),
    );
    expect(read.id).toBe("req-1");
  });

  it("surfaces a typed CLI error without providers", () => {
    useQueryMock.mockReturnValue(
      queryResult({
        id: "req-2",
        response: {
          requestId: "req-2",
          operation: "provider.usage.get",
          status: "error",
          error: { code: "TIMEOUT", message: "Slow." },
        },
      }),
    );
    const { result } = renderHook(() =>
      useProviderUsage("org-1", "project-1", "routing-session-1"),
    );
    expect(result.current.providers).toBeNull();
    expect(result.current.typedError?.code).toBe("TIMEOUT");
  });

  it("does not read without a routing session", () => {
    useQueryMock.mockReturnValue(queryResult(undefined));
    renderHook(() => useProviderUsage("org-1", "project-1", undefined));
    expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), {
      enabled: false,
    });
  });

  it("passes a mount refetch request through to the Data Layer query", () => {
    useQueryMock.mockReturnValue(queryResult(undefined));
    renderHook(() =>
      useProviderUsage("org-1", "project-1", "routing-session-1", {
        refetchOnMount: true,
      }),
    );

    expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), {
      enabled: true,
      refetchOnMount: true,
    });
  });
});
