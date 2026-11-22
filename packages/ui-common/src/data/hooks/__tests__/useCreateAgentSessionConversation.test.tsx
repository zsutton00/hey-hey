import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  AgentSessionStatus,
  AgentSessionType,
  ConversationStatus,
  WorkflowName,
} from "../../../api";
import { agentSessionsClient } from "../../../clients/serviceClients";
import {
  conversationNode,
  FakeConversationServer,
  threadOf,
} from "../../../test/conversationGraphQL";
import { useConversations } from "../useConversations";
import { useCreateAgentSessionConversation } from "../useCreateAgentSessionConversation";

vi.mock("../../../clients/serviceClients", () => ({
  agentSessionsClient: {
    createAgentSessionConversation: vi.fn(),
  },
}));

import { agentSessionKeys } from "../../collections/agentSessions";

const mockEndpoint = agentSessionsClient.createAgentSessionConversation as Mock;

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

  let server: FakeConversationServer;
  let queryClient: FakeConversationServer["queryClient"];
  const detailKey = agentSessionKeys.detail(
    organizationId,
    projectId,
    agentSessionId,
  );
  const cachedSession = { ...agentSession, conversationId: null };
  const listReads = () => server.received("GetActiveConversations").length;

  /** Mounts the hook beside a conversation list, as the app does. */
  const mountHook = async (
    options?: Parameters<typeof useCreateAgentSessionConversation>[0],
  ) => {
    const view = renderHook(
      () => ({
        create: useCreateAgentSessionConversation(options),
        list: useConversations(organizationId, projectId),
      }),
      { wrapper: server.wrapper },
    );
    await waitFor(() => expect(view.result.current.list.isReady).toBe(true));
    return view;
  };

  /** Conversation lists are left alone: no further list read happens. */
  const expectConversationsUntouched = async (readsBefore: number) => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(listReads()).toBe(readsBefore);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    server = new FakeConversationServer(threadOf(1));
    server.conversations = [];
    queryClient = server.queryClient;
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

  it("sets the agent session and refreshes conversation lists", async () => {
    const onSuccess = vi.fn();
    const { result } = await mountHook({ onSuccess });
    expect(result.current.list.data).toEqual([]);
    server.conversations = [{ ...conversationNode, id: conversation.id }];

    const payload = await result.current.create.mutate({
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
      }),
    );

    expect(queryClient.getQueryData(detailKey)).toEqual(agentSession);

    await waitFor(() =>
      expect(result.current.list.data?.map((c) => c.id)).toEqual([
        conversation.id,
      ]),
    );

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

    const { result } = await mountHook();
    const readsBefore = listReads();
    await expect(
      result.current.create.mutate({
        organizationId,
        projectId,
        agentSessionId,
        body: { workflowType: WorkflowName.AgentTaskRefining },
      }),
    ).rejects.toThrow(
      "No data returned from create-agent-session-conversation endpoint",
    );
    expect(queryClient.getQueryData(detailKey)).toBe(cachedSession);
    expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(false);
    await expectConversationsUntouched(readsBefore);
  });

  it("marks the agent session stale on 409 and re-throws", async () => {
    const error = Object.assign(new Error("conflict"), {
      response: { status: 409 },
    });
    mockEndpoint.mockRejectedValue(error);

    const onError = vi.fn();
    const { result } = await mountHook({ onError });
    const readsBefore = listReads();

    await expect(
      result.current.create.mutate({
        organizationId,
        projectId,
        agentSessionId,
        body: { workflowType: WorkflowName.AgentTaskRefining },
      }),
    ).rejects.toBe(error);

    expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true);
    await expectConversationsUntouched(readsBefore);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("propagates non-409 errors without touching the session", async () => {
    const error = Object.assign(new Error("server error"), {
      response: { status: 500 },
    });
    mockEndpoint.mockRejectedValue(error);

    const { result } = await mountHook();
    const readsBefore = listReads();
    await expect(
      result.current.create.mutate({
        organizationId,
        projectId,
        agentSessionId,
        body: { workflowType: WorkflowName.AgentTaskRefining },
      }),
    ).rejects.toBe(error);

    expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(false);
    await expectConversationsUntouched(readsBefore);
  });
});
