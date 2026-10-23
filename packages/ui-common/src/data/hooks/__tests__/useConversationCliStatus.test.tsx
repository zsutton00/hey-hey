import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { unifiedApiClient } from "../../../clients/serviceClients";
import { invalidateAllDataLayerQueries } from "../../query/dataLayerInvalidation";
import { useConversationCliStatus } from "../useConversationCliStatus";

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: { getConversationCliStatus: vi.fn() },
}));

const getStatusMock = vi.mocked(unifiedApiClient.getConversationCliStatus);
const status = (connected: boolean) => ({
  connected,
  selectedMachineId: null,
  authorizationProtocolVersion: null,
  executionReadiness: "READY",
});

const createClient = () =>
  new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
const wrapperFor =
  (client: QueryClient) =>
  ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

describe("useConversationCliStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStatusMock.mockResolvedValue({ data: { data: status(true) } } as never);
  });

  it("returns the status and shares one read across consumers", async () => {
    const { result } = renderHook(
      () => [
        useConversationCliStatus("org-1", "proj-1", "conv-1"),
        useConversationCliStatus("org-1", "proj-1", "conv-1"),
      ],
      { wrapper: wrapperFor(createClient()) }
    );
    await waitFor(() => expect(result.current[0].isReady).toBe(true));
    expect(result.current[0].data?.connected).toBe(true);
    expect(result.current[1].data?.connected).toBe(true);
    expect(getStatusMock).toHaveBeenCalledOnce();
    expect(getStatusMock).toHaveBeenCalledWith(
      { organizationId: "org-1", projectId: "proj-1", conversationId: "conv-1" },
      expect.anything()
    );
  });

  it("returns null data when the server has no status", async () => {
    getStatusMock.mockResolvedValue({ data: { data: undefined } } as never);
    const { result } = renderHook(
      () => useConversationCliStatus("org-1", "proj-1", "conv-1"),
      { wrapper: wrapperFor(createClient()) }
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it.each([
    ["an id is missing", ["org-1", "proj-1", undefined], {}],
    ["the caller opts out", ["org-1", "proj-1", "conv-1"], { enabled: false }],
  ] as const)("does not read when %s", (_label, args, options) => {
    const { result } = renderHook(
      () => useConversationCliStatus(args[0], args[1], args[2], options),
      { wrapper: wrapperFor(createClient()) }
    );
    expect(getStatusMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("surfaces a failed read as an error", async () => {
    getStatusMock.mockRejectedValue({ response: { status: 403 } });
    const { result } = renderHook(
      () => useConversationCliStatus("org-1", "proj-1", "conv-1"),
      { wrapper: wrapperFor(createClient()) }
    );
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.isReady).toBe(false);
  });

  it("re-reads once when the websocket reconnects", async () => {
    const client = createClient();
    const { result } = renderHook(
      () => useConversationCliStatus("org-1", "proj-1", "conv-1"),
      { wrapper: wrapperFor(client) }
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));
    getStatusMock.mockResolvedValue({ data: { data: status(false) } } as never);

    await act(async () => {
      await invalidateAllDataLayerQueries(client);
    });
    await waitFor(() => expect(result.current.data?.connected).toBe(false));
    expect(getStatusMock).toHaveBeenCalledTimes(2);
  });
});
