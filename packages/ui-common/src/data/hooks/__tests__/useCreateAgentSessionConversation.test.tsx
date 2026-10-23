import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  AgentSessionStatus,
  AgentSessionType,
  ConversationStatus,
  WorkflowName,
} from "../../../api";
import { agentSessionsClient } from "../../../clients/serviceClients";
import { useCreateAgentSessionConversation } from "../useCreateAgentSessionConversation";

vi.mock("../../../clients/serviceClients", () => ({
  agentSessionsClient: {
    createAgentSessionConversation:
      vi.fn(),
  },
}));

import { agentSessionKeys } from "../../collections/agentSessions";
import { conversationKeys } from "../../collections/conversations";

const mockEndpoint =
  agentSessionsClient.createAgentSessionConversation as Mock;

describe("useCreateAgentSessionConversation", () => {
  const organizationId = "org-1";
  const projectId = "proj-1";
  const agentSessionId = "agent-session-1";

  const agentSession = {
    id: agentSessionId,
    projectId,
    organizationId,
    userId: "user-1",
    type: AgentSessionType.TaskRefining,
    status: AgentSessionStatus.Started,
    sessionDate: "2026-04-18T00:00:00Z",
    conversationId: "conv-1",
    createdAt: "2026-04-18T00:00:00Z",
    updatedAt: "2026-04-18T00:00:01Z",
  };

  const conversation = {
    id: "conv-1",
    organizationId,
    projectId,
    status: ConversationStatus.Started,
    workflowName: WorkflowName.AgentTaskRefining,
    workflowAboutId: "task-1",
    workflowAboutType: "task",
    createdAt: "2026-04-18T00:00:00Z",
    updatedAt: "2026-04-18T00:00:01Z",
  };

  const responseData = { agentSession, conversation };

  let queryClient: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const listKey = conversationKeys.list(organizationId, projectId, {});
  const envelopeKey = conversationKeys.envelope(
    organizationId,
    projectId,
    conversation.id
  );
  const detailKey = agentSessionKeys.detail(
    organizationId,
    projectId,
    agentSessionId
  );
  const cachedSession = { ...agentSession, conversationId: null };
  const expectConversationsUntouched = () => {
    expect(queryClient.getQueryData(envelopeKey)).toBeUndefined();
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
    });
    queryClient.setQueryData(listKey, []);
    queryClient.setQueryData(detailKey, cachedSession);
    mockEndpoint.mockResolvedValue({
      data: {
        success: true,
        data: responseData,
        statusCode: 201,
        timestamp: "2026-04-18T00:00:01Z",
        path: "/",
      },
    });
  });

  it("writes the conversation, sets the agent session, and invalidates conversation lists", async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useCreateAgentSessionConversation({ onSuccess }), {
      wrapper,
    });

    const payload = await result.current.mutate({
      organizationId,
      projectId,
      agentSessionId,
      body: {
        workflowType: WorkflowName.AgentTaskRefining,
        workflowAboutType: "task",
        workflowAboutId: "task-1",
      },
    });

    expect(payload).toBe(responseData);
    expect(mockEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: organizationId,
        projectId: projectId,
        agentSessionId: agentSessionId,
        createAgentSessionConversationDto: {
          workflowType: WorkflowName.AgentTaskRefining,
          workflowAboutType: "task",
          workflowAboutId: "task-1",
        },
      })
    );

    expect(queryClient.getQueryData(envelopeKey)).toEqual(conversation);

    expect(queryClient.getQueryData(detailKey)).toEqual(agentSession);

    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);

    expect(onSuccess).toHaveBeenCalledWith(responseData);
  });

  it("throws when the endpoint returns no data", async () => {
    mockEndpoint.mockResolvedValue({
      data: {
        success: false,
        data: null,
        statusCode: 201,
        timestamp: "2026-04-18T00:00:01Z",
        path: "/",
      },
    });

    const { result } = renderHook(() => useCreateAgentSessionConversation(), {
      wrapper,
    });
    await expect(
      result.current.mutate({
        organizationId,
        projectId,
        agentSessionId,
        body: { workflowType: WorkflowName.AgentTaskRefining },
      })
    ).rejects.toThrow(
      "No data returned from create-agent-session-conversation endpoint"
    );
    expect(queryClient.getQueryData(detailKey)).toBe(cachedSession);
    expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(false);
    expectConversationsUntouched();
  });

  it("marks the agent session stale on 409 and re-throws", async () => {
    const error = Object.assign(new Error("conflict"), {
      response: { status: 409 },
    });
    mockEndpoint.mockRejectedValue(error);

    const onError = vi.fn();
    const { result } = renderHook(() =>
      useCreateAgentSessionConversation({ onError }), {
      wrapper,
    });

    await expect(
      result.current.mutate({
        organizationId,
        projectId,
        agentSessionId,
        body: { workflowType: WorkflowName.AgentTaskRefining },
      })
    ).rejects.toBe(error);

    expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true);
    expectConversationsUntouched();
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("propagates non-409 errors without touching the session", async () => {
    const error = Object.assign(new Error("server error"), {
      response: { status: 500 },
    });
    mockEndpoint.mockRejectedValue(error);

    const { result } = renderHook(() => useCreateAgentSessionConversation(), {
      wrapper,
    });
    await expect(
      result.current.mutate({
        organizationId,
        projectId,
        agentSessionId,
        body: { workflowType: WorkflowName.AgentTaskRefining },
      })
    ).rejects.toBe(error);

    expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(false);
    expectConversationsUntouched();
  });
});
