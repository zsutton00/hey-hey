import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationStatus } from "../../../api";
import { projectsClient } from "../../../clients/serviceClients";
import {
  conversationNode,
  FakeConversationServer,
  threadOf,
} from "../../../test/conversationGraphQL";
import { resetConversationMessageHistoryStateForTests } from "../../collections/conversationMessageHistoryState";
import { useConversation } from "../../hooks/useConversation";
import { useConversations } from "../../hooks/useConversations";
import { useConversationMessages } from "../../hooks/useConversationMessages";
import { useLatestMessage } from "../../hooks/useLatestMessage";
import { useMessage } from "../../hooks/useMessage";
import { WebSocketHandler } from "../handler";

vi.mock("../../../clients/serviceClients", () => ({
  projectsClient: {
    getQueuedConversationInputs: vi.fn(async () => ({ data: { data: [] } })),
  },
}));

vi.mock("../../../utils/logger", () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const timestamp = "2026-11-01T00:00:00.000Z";
const scope = {
  timestamp,
  organizationId: "org-1",
  projectId: "project-1",
  conversationId: "conv-1",
};

const ids = (messages: readonly { id: string }[]) =>
  messages.map((message) => message.id);

describe("conversation and message events over GraphQL", () => {
  let server: FakeConversationServer;
  let handler: WebSocketHandler;

  /** Two thread views, a detail view and a latest-message view of the same data. */
  const mountViews = async () => {
    vi.mocked(projectsClient.getQueuedConversationInputs).mockResolvedValue({
      data: { data: [] },
    } as never);
    const views = renderHook(
      () => ({
        first: useConversationMessages("org-1", "project-1", "conv-1"),
        second: useConversationMessages("org-1", "project-1", "conv-1"),
        detail: useMessage("org-1", "project-1", "m10"),
        latest: useLatestMessage("org-1", "project-1", "conv-1"),
        conversation: useConversation("org-1", "project-1", {
          conversationId: "conv-1",
        }),
      }),
      { wrapper: server.wrapper },
    );
    await waitFor(() => {
      expect(views.result.current.first.isReady).toBe(true);
      expect(views.result.current.detail.isReady).toBe(true);
      expect(views.result.current.latest.isReady).toBe(true);
      expect(views.result.current.conversation.isReady).toBe(true);
    });

    return views;
  };

  beforeEach(() => {
    resetConversationMessageHistoryStateForTests();
    server = new FakeConversationServer(threadOf(10));
    handler = new WebSocketHandler(
      createStore(),
      undefined,
      server.queryClient,
      server.graphql.apollo,
    );
  });

  it("brings every view of a conversation up to date when a message is created", async () => {
    const views = await mountViews();

    server.append(...threadOf(11).slice(10));
    act(() =>
      handler.handleEvent({
        type: "message.created",
        ...scope,
        messageId: "m11",
      }),
    );

    await waitFor(() => {
      expect(ids(views.result.current.first.orderedData)).toContain("m11");
      expect(ids(views.result.current.second.orderedData)).toContain("m11");
      expect(views.result.current.latest.data?.id).toBe("m11");
    });
  });

  it("shows an updated message to its thread and detail views", async () => {
    const views = await mountViews();

    server.rename("m10", { response: "revised" });
    act(() =>
      handler.handleEvent({
        type: "message.updated",
        ...scope,
        messageId: "m10",
      }),
    );

    await waitFor(() => {
      expect(views.result.current.detail.data?.data).toEqual({
        response: "revised",
      });
      expect(
        views.result.current.second.orderedData.find((m) => m.id === "m10")
          ?.data,
      ).toEqual({ response: "revised" });
    });
  });

  it("updates an older loaded message in two threads without a detail view", async () => {
    const { result } = renderHook(
      () => ({
        first: useConversationMessages("org-1", "project-1", "conv-1"),
        second: useConversationMessages("org-1", "project-1", "conv-1"),
      }),
      { wrapper: server.wrapper },
    );
    await waitFor(() => expect(result.current.second.isReady).toBe(true));
    await act(async () => result.current.first.loadOlder());
    await waitFor(() =>
      expect(ids(result.current.second.orderedData)).toEqual(ids(threadOf(10))),
    );

    server.rename("m1", { response: "edited older message" });
    act(() =>
      handler.handleEvent({
        type: "message.updated",
        ...scope,
        messageId: "m1",
      }),
    );

    await waitFor(() => {
      for (const view of [result.current.first, result.current.second]) {
        expect(
          view.orderedData.find((message) => message.id === "m1")?.data,
        ).toEqual({ response: "edited older message" });
        expect(ids(view.orderedData)).toEqual(ids(threadOf(10)));
      }
    });
    expect(server.received("GetMessage")).toEqual([{ id: "m1" }]);
  });

  it("removes a deleted message from every view on the delete event alone", async () => {
    const views = await mountViews();

    server.remove("m10");
    act(() =>
      handler.handleEvent({
        type: "message.deleted",
        ...scope,
        messageId: "m10",
      }),
    );

    await waitFor(() => {
      expect(ids(views.result.current.first.orderedData)).not.toContain("m10");
      expect(ids(views.result.current.second.orderedData)).not.toContain("m10");
      expect(views.result.current.detail.data).toBeNull();
      expect(views.result.current.latest.data?.id).toBe("m9");
    });
  });

  it("moves a conversation between mounted status lists in its project", async () => {
    server.conversationsByPath.set(
      "/organizations/org-1/projects/other-project/graphql",
      [
        {
          ...conversationNode,
          id: "other-conversation",
          projectId: "other-project",
        },
      ],
    );
    const { result } = renderHook(
      () => ({
        active: useConversations("org-1", "project-1"),
        completed: useConversations("org-1", "project-1", {
          statuses: [ConversationStatus.Completed],
        }),
        unrelated: useConversations("org-1", "other-project"),
      }),
      { wrapper: server.wrapper },
    );
    await waitFor(() => {
      expect(result.current.active.data?.map((item) => item.id)).toEqual([
        "conv-1",
      ]);
      expect(result.current.completed.data).toEqual([]);
      expect(result.current.unrelated.data?.map((item) => item.id)).toEqual([
        "other-conversation",
      ]);
    });

    server.conversations = [
      { ...conversationNode, status: ConversationStatus.Completed },
    ];
    act(() =>
      handler.handleEvent({
        type: "conversation.status_changed",
        ...scope,
        previousStatus: ConversationStatus.InProgress,
        newStatus: ConversationStatus.Completed,
      }),
    );

    await waitFor(() => {
      expect(result.current.active.data).toEqual([]);
      expect(result.current.completed.data?.map((item) => item.id)).toEqual([
        "conv-1",
      ]);
    });
    expect(server.received("GetActiveConversations")).toHaveLength(3);
  });

  it("shows a new reply and edits to it with only the parent detail mounted", async () => {
    const { result } = renderHook(
      () => useMessage("org-1", "project-1", "m10"),
      { wrapper: server.wrapper },
    );
    await waitFor(() => expect(result.current.data?.responses).toEqual([]));

    server.append({ ...threadOf(11)[10], parentMessageId: "m10" });
    act(() =>
      handler.handleEvent({
        type: "message.created",
        ...scope,
        messageId: "m11",
      }),
    );
    await waitFor(() =>
      expect(result.current.data?.responses?.[0]?.id).toBe("m11"),
    );

    server.rename("m11", { response: "edited reply" });
    act(() =>
      handler.handleEvent({
        type: "message.updated",
        ...scope,
        messageId: "m11",
      }),
    );
    await waitFor(() =>
      expect(result.current.data?.responses?.[0]?.data).toEqual({
        response: "edited reply",
      }),
    );
  });

  it("shows new messages on a conversation update without re-reading the conversation", async () => {
    const views = await mountViews();
    const readsBefore = server.received("GetConversation").length;

    server.append(...threadOf(11).slice(10));
    act(() =>
      handler.handleEvent({
        type: "conversation.updated",
        ...scope,
        previousVersion: 1,
        newVersion: 2,
        changeType: "message_updated",
      }),
    );

    await waitFor(() =>
      expect(ids(views.result.current.first.orderedData)).toContain("m11"),
    );
    expect(server.received("GetConversation")).toHaveLength(readsBefore);
  });

  it("adds a created conversation to the mounted lists of its project", async () => {
    const { result } = renderHook(
      () => useConversations("org-1", "project-1"),
      { wrapper: server.wrapper },
    );
    await waitFor(() =>
      expect(result.current.data?.map((item) => item.id)).toEqual(["conv-1"]),
    );

    server.conversations = [
      conversationNode,
      { ...conversationNode, id: "conv-new" },
    ];
    act(() =>
      handler.handleEvent({
        type: "conversation.created",
        ...scope,
        conversationId: "conv-new",
      }),
    );

    await waitFor(() =>
      expect(result.current.data?.map((item) => item.id)).toEqual([
        "conv-1",
        "conv-new",
      ]),
    );
  });
});
