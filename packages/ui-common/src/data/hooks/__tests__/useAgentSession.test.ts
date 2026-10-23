import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import type { ReactNode } from "react";
import { useAgentSession } from "../useAgentSession";
import type { AgentSessionDto } from "../../../api";
import { dataClient } from "../../../clients";
import { agentSessionKeys } from "../../collections/agentSessions";

vi.mock("../../../clients", () => ({
  dataClient: {
    request: vi.fn(),
  },
}));

vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const DETAIL_URL =
  "/organizations/org-456/projects/proj-100/agent-sessions/session-123";
const CURRENT_STATE_URL =
  "/organizations/org-456/projects/proj-100/agent-sessions/current-state:batch";

const createClient = () =>
  new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
const wrapperFor =
  (client: QueryClient) =>
  ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);

const requestMock = vi.mocked(dataClient.request);
const callsTo = (url: string) =>
  requestMock.mock.calls.filter(([request]) => request.url === url);

describe("useAgentSession hook", () => {
  const mockAgentSession: AgentSessionDto = {
    id: "session-123",
    organizationId: "org-456",
    projectId: "proj-100",
    userId: "user-789",
    status: "IN_PROGRESS" as AgentSessionDto["status"],
    conversationId: "conv-404",
    sessionDate: "2024-01-01",
    title: "Test coding session",
    currentState: "IDLE" as AgentSessionDto["currentState"],
    createdAt: "2024-01-01T10:00:00Z",
    updatedAt: "2024-01-01T11:00:00Z",
  } as AgentSessionDto;

  const answer = (
    session: AgentSessionDto = mockAgentSession,
    liveItems: unknown[] = []
  ) =>
    requestMock.mockImplementation((config) =>
      Promise.resolve(
        config.method === "POST"
          ? ({ data: { data: { items: liveItems } } } as never)
          : ({ data: { data: session } } as never)
      )
    );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports an unstarted read as loading without error", () => {
    answer();
    const { result } = renderHook(
      () => useAgentSession("org-456", "proj-100", "session-123"),
      { wrapper: wrapperFor(createClient()) }
    );
    expect(result.current.agentSession).toBeNull();
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isReady).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("reads the session with service and user and becomes ready", async () => {
    answer();
    const { result } = renderHook(
      () => useAgentSession("org-456", "proj-100", "session-123"),
      { wrapper: wrapperFor(createClient()) }
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.agentSession).toEqual(mockAgentSession);
    expect(result.current.data).toEqual(mockAgentSession);
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        url: DETAIL_URL,
        params: { includeService: true, includeUser: true },
      })
    );
  });

  it("reports a failed read as an error", async () => {
    requestMock.mockRejectedValue({ response: { status: 404 } });
    const { result } = renderHook(
      () => useAgentSession("org-456", "proj-100", "session-123"),
      { wrapper: wrapperFor(createClient()) }
    );
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.isReady).toBe(false);
    expect(result.current.agentSession).toBeNull();
  });

  it.each([
    ["the session id is missing", ["org-456", "proj-100", undefined], {}],
    ["the organization is missing", [undefined, "proj-100", "session-123"], {}],
    ["the caller disables it", ["org-456", "proj-100", "session-123"], { enabled: false }],
  ] as const)("does not read when %s", (_label, args, options) => {
    answer();
    const { result } = renderHook(
      () => useAgentSession(args[0], args[1], args[2], options),
      { wrapper: wrapperFor(createClient()) }
    );
    expect(requestMock).not.toHaveBeenCalled();
    expect(result.current.agentSession).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("shares one session read and one current-state read across consumers and remounts", async () => {
    answer(mockAgentSession, [
      {
        agentSessionId: "session-123",
        currentState: "THINKING",
        revision: 1,
        transitionedAt: "2026-08-07T00:00:00.000Z",
      },
    ]);
    const client = createClient();
    const firstMount = renderHook(
      () => [
        useAgentSession("org-456", "proj-100", "session-123"),
        useAgentSession("org-456", "proj-100", "session-123"),
      ],
      { wrapper: wrapperFor(client) }
    );
    await waitFor(() =>
      expect(firstMount.result.current[0].agentSession?.currentState).toBe(
        "THINKING"
      )
    );
    expect(firstMount.result.current[1].agentSession?.currentState).toBe(
      "THINKING"
    );
    firstMount.unmount();

    const remount = renderHook(
      () => useAgentSession("org-456", "proj-100", "session-123"),
      { wrapper: wrapperFor(client) }
    );
    expect(remount.result.current.isReady).toBe(true);
    expect(callsTo(DETAIL_URL)).toHaveLength(1);
    expect(callsTo(CURRENT_STATE_URL)).toHaveLength(1);
  });

  it("re-reads on refetch and after markStale", async () => {
    answer();
    const { result } = renderHook(
      () => useAgentSession("org-456", "proj-100", "session-123"),
      { wrapper: wrapperFor(createClient()) }
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));

    const renamed = { ...mockAgentSession, title: "Renamed" };
    answer(renamed);
    await act(async () => {
      await expect(result.current.refetch()).resolves.toEqual(renamed);
    });
    expect(callsTo(DETAIL_URL)).toHaveLength(2);

    act(() => result.current.markStale());
    await waitFor(() => expect(callsTo(DETAIL_URL)).toHaveLength(3));
  });

  it("reads the new key when the session id changes", async () => {
    answer();
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useAgentSession("org-456", "proj-100", id),
      {
        wrapper: wrapperFor(createClient()),
        initialProps: { id: "session-123" },
      }
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));
    rerender({ id: "session-999" });
    await waitFor(() =>
      expect(
        callsTo(
          "/organizations/org-456/projects/proj-100/agent-sessions/session-999"
        )
      ).toHaveLength(1)
    );
  });

  it("overlays a realtime current-state write without another read", async () => {
    answer();
    const client = createClient();
    const { result } = renderHook(
      () => useAgentSession("org-456", "proj-100", "session-123"),
      { wrapper: wrapperFor(client) }
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));
    const requests = requestMock.mock.calls.length;

    act(() => {
      client.setQueryData(
        agentSessionKeys.currentState("org-456", "proj-100", "session-123"),
        {
          currentState: "WRITING",
          revision: 7,
          transitionedAt: "2026-08-07T00:00:07.000Z",
        }
      );
    });
    await waitFor(() =>
      expect(result.current.agentSession?.currentState).toBe("WRITING")
    );
    expect(requestMock.mock.calls.length).toBe(requests);
  });
});
