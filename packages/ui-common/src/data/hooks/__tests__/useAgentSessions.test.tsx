import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentSessionDto } from "../../../api";
import { dataClient } from "../../../clients";
import { unifiedApiClient } from "../../../clients/serviceClients";
import { useAgentSessions } from "../useAgentSessions";

vi.mock("../../../clients", () => ({
  dataClient: { request: vi.fn() },
}));
vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: { deleteAgentSession: vi.fn() },
}));

const LIST_URL = "/organizations/org-1/projects/proj-1/agent-sessions";
const requestMock = vi.mocked(dataClient.request);
const deleteMock = vi.mocked(unifiedApiClient.deleteAgentSession);

const session = (id: string): AgentSessionDto =>
  ({
    id,
    organizationId: "org-1",
    projectId: "proj-1",
    userId: "user-1",
    status: "IN_PROGRESS",
    conversationId: null,
    sessionDate: "2026-01-01T00:00:00.000Z",
    title: id,
  }) as AgentSessionDto;

const createClient = () =>
  new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
const wrapperFor =
  (client: QueryClient) =>
  ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

const listCalls = () =>
  requestMock.mock.calls.filter(([config]) => config.url === LIST_URL);

describe("useAgentSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestMock.mockImplementation((config) =>
      Promise.resolve(
        config.method === "POST"
          ? ({ data: { data: { items: [] } } } as never)
          : ({ data: { data: [session("session-1"), session("session-2")] } } as never)
      )
    );
  });

  it("sends normalized filters and shares one read across consumers", async () => {
    const client = createClient();
    const { result } = renderHook(
      () => [
        useAgentSessions("org-1", "proj-1", {
          ids: ["session-2", "session-1"],
          entityType: "TASK" as never,
          entityId: "task-1",
        }),
        useAgentSessions("org-1", "proj-1", {
          ids: ["session-1", "session-2"],
          entityType: "TASK" as never,
          entityId: "task-1",
        }),
      ],
      { wrapper: wrapperFor(client) }
    );

    await waitFor(() => expect(result.current[0].isReady).toBe(true));
    expect(result.current[1].agentSessions).toEqual(
      result.current[0].agentSessions
    );
    expect(listCalls()).toHaveLength(1);
    expect(listCalls()[0][0].params).toEqual({
      ids: "session-1,session-2",
      entityType: "TASK",
      entityId: "task-1",
      includeService: true,
      includeUser: true,
    });
  });

  it("does not read without an organization", () => {
    const { result } = renderHook(
      () => useAgentSessions(undefined, undefined, { ids: ["session-1"] }),
      { wrapper: wrapperFor(createClient()) }
    );
    expect(requestMock).not.toHaveBeenCalled();
    expect(result.current.agentSessions).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("reads output attention only when asked", async () => {
    const client = createClient();
    const { result } = renderHook(
      () => useAgentSessions("org-1", "proj-1", { includeOutputAttention: true }),
      { wrapper: wrapperFor(client) }
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));
    await waitFor(() =>
      expect(
        requestMock.mock.calls.some(([config]) =>
          String(config.url).endsWith("output-attention:batch")
        )
      ).toBe(true)
    );

    requestMock.mockClear();
    renderHook(() => useAgentSessions("org-1", "proj-1", { userId: "u" }), {
      wrapper: wrapperFor(createClient()),
    });
    await waitFor(() => expect(listCalls()).toHaveLength(1));
    expect(
      requestMock.mock.calls.some(([config]) =>
        String(config.url).endsWith("output-attention:batch")
      )
    ).toBe(false);
  });

  it("hides a removed row while deleting and restores it on failure", async () => {
    const client = createClient();
    const { result } = renderHook(() => useAgentSessions("org-1", "proj-1"), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.agentSessions).toHaveLength(2));

    let rejectDelete!: (error: Error) => void;
    deleteMock.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectDelete = reject;
      }) as never
    );
    let removal!: Promise<void>;
    act(() => {
      removal = result.current.remove("session-1");
    });
    await waitFor(() =>
      expect(result.current.agentSessions.map((row) => row.id)).toEqual([
        "session-2",
      ])
    );

    await act(async () => {
      rejectDelete(new Error("Delete failed"));
      await expect(removal).rejects.toThrow("Delete failed");
    });
    await waitFor(() =>
      expect(result.current.agentSessions.map((row) => row.id)).toEqual([
        "session-1",
        "session-2",
      ])
    );
  });
});
