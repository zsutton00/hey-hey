import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationResponseDto } from "../../api";
import {
  conversationNode,
  FakeConversationServer,
  type FakeMessage,
} from "../../test/conversationGraphQL";
import { WebSocketHandler } from "../websockets/handler";
import { useConversationByWorkflow } from "./useConversationByWorkflow";

vi.mock("../../clients/serviceClients", () => ({
  projectsClient: {
    getQueuedConversationInputs: vi.fn(async () => ({ data: { data: [] } })),
  },
}));
vi.mock("./useWebsocketSubscriptions", () => ({
  useWebsocketSubscriptions: vi.fn(),
}));

const workflowConversation = (
  id: string,
  createdAt = "2026-09-01T00:00:00Z",
) => ({
  ...conversationNode,
  id,
  workflowName: "onboarding",
  createdAt,
  updatedAt: createdAt,
});
const message = (conversationId: string, response = "Ready"): FakeMessage => ({
  id: `message-${conversationId}`,
  createdAt: "2026-09-01T00:00:01Z",
  awaitingResponse: false,
  data: {
    type: "QUESTIONS",
    response,
    uiElements: [{ id: "question", type: "text", label: "Question" }],
  },
});
const options = { requireFirstMessage: true, requireUiElements: true };

const THREAD_READS = [
  "GetConversationMessages",
  "GetConversationMessageHistory",
];

let server: FakeConversationServer;
const threadReads = (conversationId?: string) =>
  server.requests.filter(
    (request) =>
      THREAD_READS.includes(request.operationName) &&
      (conversationId === undefined || request.variables.id === conversationId),
  );
const conversationListReads = () =>
  server.received("GetActiveConversations").length;
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const notify = (handler: WebSocketHandler, changeType = "message_updated") =>
  handler.handleEvent({
    type: "conversation.updated",
    organizationId: "org-1",
    projectId: "project-1",
    conversationId: "new",
    timestamp: "2026-09-01T00:00:02Z",
    previousVersion: 1,
    newVersion: 2,
    changeType,
  });
const mountHook = (project = "project-1") =>
  renderHook(
    ({ project }) =>
      useConversationByWorkflow("org-1", project, "onboarding", options),
    { wrapper: server.wrapper, initialProps: { project } },
  );
const createHandler = () =>
  new WebSocketHandler(
    createStore(),
    undefined,
    server.queryClient,
    server.graphql.apollo,
  );

beforeEach(() => {
  vi.clearAllMocks();
  server = new FakeConversationServer([message("new")]);
  server.conversations = [workflowConversation("new")];
});
afterEach(() => {
  vi.useRealTimers();
  server.queryClient.clear();
});

describe("canonical workflow conversation readiness", () => {
  it("reads metadata and canonical Messages separately", async () => {
    const { result } = mountHook();
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(result.current.data?.id).toBe("new");
    expect(result.current.messages[0].data.response).toBe("Ready");
    expect(conversationListReads()).toBe(1);
    expect(threadReads("new").length).toBeGreaterThan(0);
  });

  it("keeps the newer unready candidate instead of displaying an older ready conversation", async () => {
    server.conversations = [
      workflowConversation("old"),
      workflowConversation("new", "2026-09-02T00:00:00Z"),
    ];
    server.thread = [];
    const { result } = mountHook();

    await waitFor(() => expect(result.current.isFetched).toBe(true));

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(threadReads("new").length).toBeGreaterThan(0);
    expect(threadReads("old")).toEqual([]);
  });

  it("does not expose previous Messages when scope changes", async () => {
    server.conversationsByPath.set(
      "/organizations/org-1/projects/other/graphql",
      [],
    );
    const { result, rerender } = mountHook();
    await waitFor(() => expect(result.current.isReady).toBe(true));

    rerender({ project: "other" });

    expect(result.current.data).toBeNull();
    expect(result.current.messages).toEqual([]);
  });

  it("surfaces Message failures as errors", async () => {
    server.failingOperations.add("GetConversationMessageHistory");
    server.failingOperations.add("GetConversationMessages");
    const { result } = mountHook();

    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeNull();
  });

  it("refetch checks Messages belonging to the newly selected candidate", async () => {
    const { result } = mountHook();
    await waitFor(() => expect(result.current.isReady).toBe(true));
    server.conversations = [workflowConversation("replacement")];
    server.thread = [message("replacement")];

    let refreshed: ConversationResponseDto | null = null;
    await act(async () => {
      refreshed = await result.current.refetch();
    });

    expect(refreshed).toMatchObject({ id: "replacement" });
    expect(threadReads("replacement").length).toBeGreaterThan(0);
  });

  it("discovers an absent conversation after a missed notification", async () => {
    vi.useFakeTimers();
    server.conversations = [];
    const { result } = mountHook();
    await advance(100);
    expect(result.current.data).toBeNull();

    server.conversations = [workflowConversation("new")];
    await advance(3000);
    await advance(100);

    expect(result.current.data?.id).toBe("new");
  });

  it("recovers pending Messages on a fixed deadline without a conversation list refresh", async () => {
    vi.useFakeTimers();
    server.thread = [];
    const { result } = mountHook();
    await advance(200);
    expect(result.current.data).toBeNull();

    server.thread = [message("new")];
    await advance(3000);
    await advance(100);

    expect(result.current.data?.id).toBe("new");
    expect(conversationListReads()).toBe(1);
  });

  it("brings in a completed update from duplicate notifications without re-reading conversations", async () => {
    const { result } = mountHook();
    await waitFor(() => expect(result.current.isReady).toBe(true));
    server.thread = [message("new", "Completed update")];
    const handler = createHandler();

    act(() => {
      for (let i = 0; i < 3; i++) {
        notify(handler, "message_added");
      }
    });

    await waitFor(() =>
      expect(result.current.messages[0].data.response).toBe("Completed update"),
    );
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(conversationListReads()).toBe(1);
    expect(server.received("GetConversation")).toEqual([]);
  });

  it("applies the latest state after notifications during an in-flight read", async () => {
    const { result } = mountHook();
    await waitFor(() => expect(result.current.isReady).toBe(true));
    server.thread = [message("new", "Authoritative completion")];
    const handler = createHandler();

    act(() => {
      notify(handler);
      notify(handler);
      notify(handler);
    });

    await waitFor(() =>
      expect(result.current.messages[0].data.response).toBe(
        "Authoritative completion",
      ),
    );
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.messages[0].data.response).toBe(
      "Authoritative completion",
    );
    expect(conversationListReads()).toBe(1);
  });

  it("does not postpone pending-content recovery during continuous notifications", async () => {
    vi.useFakeTimers();
    server.thread = [];
    const { result } = mountHook();
    await advance(200);
    const handler = createHandler();

    // Notify continuously up to just before the 3s recovery deadline.
    for (let elapsed = 0; elapsed < 2700; elapsed += 100) {
      act(() => notify(handler));
      await advance(100);
    }
    server.thread = [message("new")];
    await advance(500);

    expect(result.current.data?.id).toBe("new");
    expect(conversationListReads()).toBe(1);
  });
});
