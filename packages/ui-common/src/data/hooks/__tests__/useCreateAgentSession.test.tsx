import React from "react";
import { act, renderHook } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  type InfiniteData,
} from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { useCreateAgentSession } from "../useCreateAgentSession";
import type { CreateAgentSessionVariables } from "../useCreateAgentSession";
import { unifiedApiClient } from "../../../clients/serviceClients";
import {
  agentSessionKeys,
  type PaginatedAgentSessionsPage,
} from "../../collections/agentSessions";

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    createAgentSession: vi.fn(),
  },
}));

const mockCreateAgentSession = unifiedApiClient.createAgentSession as Mock;

const wrapperFor =
  (client: QueryClient) =>
  ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

describe("useCreateAgentSession", () => {
  const mockSession = {
    id: "session-1",
    organizationId: "org-1",
    projectId: "proj-1",
    userId: "user-1",
    entityType: "task",
    entityId: "task-1",
    status: "active",
    sessionDate: "2026-01-01T00:00:00.000Z",
    title: "Create endpoint test",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T01:00:00.000Z",
  };

  const variables: CreateAgentSessionVariables = {
    organizationId: "org-1",
    agentSession: {
      projectId: "proj-1",
      sessionDate: "2026-01-01T00:00:00.000Z",
      title: "Create endpoint test",
      entityType: "task",
      entityId: "task-1",
      provider: "codex",
    },
  } as CreateAgentSessionVariables;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAgentSession.mockResolvedValue({
      data: {
        success: true,
        message: "created",
        data: mockSession,
      },
    });
  });

  it("caches the created session's own read and writes nothing into lists or feeds", async () => {
    const client = new QueryClient();
    const listKey = agentSessionKeys.list("org-1", "proj-1", {});
    const feedKey = agentSessionKeys.paginated("org-1", "proj-1", {});
    const existingList = [{ ...mockSession, id: "older" }];
    const existingFeed: InfiniteData<PaginatedAgentSessionsPage, string | null> =
      { pages: [{ items: [], nextCursor: null }], pageParams: [null] };
    client.setQueryData(listKey, existingList);
    client.setQueryData(feedKey, existingFeed);

    const { result } = renderHook(() => useCreateAgentSession(), {
      wrapper: wrapperFor(client),
    });

    let response: unknown;
    await act(async () => {
      response = await result.current.mutate(variables);
    });

    expect(response).toEqual(mockSession);
    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: variables.organizationId,
        projectId: variables.agentSession.projectId,
        createAgentSessionDto: variables.agentSession,
      })
    );
    expect(
      client.getQueryData(agentSessionKeys.detail("org-1", "proj-1", "session-1"))
    ).toEqual(mockSession);
    expect(client.getQueryData(listKey)).toBe(existingList);
    expect(client.getQueryData(feedKey)).toBe(existingFeed);
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(false);
    expect(client.getQueryState(feedKey)?.isInvalidated).toBe(false);
  });

  it("throws when create response lacks data", async () => {
    mockCreateAgentSession.mockResolvedValue({
      data: {
        success: true,
        message: "created",
      },
    });

    const { result } = renderHook(() => useCreateAgentSession(), {
      wrapper: wrapperFor(new QueryClient()),
    });

    await act(async () => {
      await expect(result.current.mutate(variables)).rejects.toThrow(
        "No agent session returned from create endpoint"
      );
    });
  });
});
