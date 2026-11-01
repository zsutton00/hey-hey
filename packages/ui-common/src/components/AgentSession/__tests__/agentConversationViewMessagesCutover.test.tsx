import { useConversationMessages } from "../../../data/hooks/useConversationMessages";
import { act, render, screen, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import React, { type ReactNode } from "react";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
  type MockedFunction,
} from "vitest";

import {
  AgentSessionCurrentState,
  ConversationStatus,
  InitiationType,
  MessageStatus,
  MessageType,
  WebSocketSubscriptionRequestEventTypesEnum,
  type ConversationResponseDto,
  type CreateUserMessage,
  type MessageResponseDto,
  type WebSocketConversationUpdatedEvent,
  type WebSocketAgentSessionCurrentStateChangedEvent,
} from "../../../api";
import {
  platformClient,
  projectsClient,
} from "../../../clients/serviceClients";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { messageKeys } from "../../../data/collections/messages";
import { WebSocketHandler } from "../../../data/websockets/handler";
import {
  AgentConversationView,
  type AgentConversationViewProps,
} from "../AgentConversationView";
import type { AgentBridgeRecoveryState } from "../agentBridgeRecoveryState";
import type { ConversationScrollPolicy } from "../../Conversation/ConversationViewer";
import type { ResponseTargetChangeHandler } from "../../Conversation/Components/conversationFormTypes";
import { NO_RESPONSE_TARGET } from "../../Conversation/utils/conversationResponseModel";

vi.mock("../../../clients/serviceClients", () => ({
  projectsClient: { getQueuedConversationInputs: vi.fn() },
  platformClient: {
    getMessages: vi.fn(),
    getMessage: vi.fn(),
  },
}));

const useConversationRefetchSpy = vi.fn(async () => null);
const useConversationMarkStaleSpy = vi.fn();
const conversationViewerPropsSpy = vi.hoisted(() => vi.fn());
let useConversationReturnValue: {
  data: ConversationResponseDto | null;
  isLoading: boolean;
  isFetching: boolean;
  isFetched: boolean;
  isReady: boolean;
  error: Error | null;
  isStale: boolean;
  refetch: typeof useConversationRefetchSpy;
  markStale: typeof useConversationMarkStaleSpy;
  workflowId?: string | null;
  retryCount: number;
};

vi.mock("../../../data/hooks/useConversation", () => ({
  useConversation: () => useConversationReturnValue,
}));

vi.mock("../../../data/hooks/useProject", () => ({
  useProject: () => ({
    data: { id: "proj-1", organizationId: "org-1", name: "Project" },
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: true,
    error: null,
    isStale: false,
    refetch: vi.fn(async () => null),
    markStale: vi.fn(),
  }),
}));

vi.mock("../../../data/hooks/usePlatformAdminAccess", () => ({
  usePlatformAdminAccess: () => ({ isPlatformAdmin: false, isResolved: true }),
}));

vi.mock("../../Conversation/ConversationViewer", () => ({
  ConversationViewer: (props: {
    conversation: ConversationResponseDto;
    onResponseTargetChange?: ResponseTargetChangeHandler;
    scrollPolicy:
      | { mode: "owned"; ownerRef: React.RefObject<HTMLElement | null> }
      | { mode: "disabled" };
    slotProps?: {
      paper?: {
        sx?: {
          backgroundColor?: unknown;
          backgroundImage?: unknown;
        };
      };
    };
  }) => {
    const { conversation, scrollPolicy } = props;
    const { data: messages } = useConversationMessages(
      conversation.organizationId,
      conversation.projectId,
      conversation.id,
    );
    expect(conversation).not.toHaveProperty("messages");
    conversationViewerPropsSpy(props);
    React.useEffect(() => {
      props.onResponseTargetChange?.(NO_RESPONSE_TARGET, conversation.id, true);
    }, [props.onResponseTargetChange, conversation.id]);

    React.useEffect(() => {
      if (scrollPolicy.mode !== "owned" || messages.length === 0) {
        return;
      }
      const owner = scrollPolicy.ownerRef.current;
      owner?.scrollTo({ top: owner.scrollHeight, behavior: "instant" });
    }, [messages.length, scrollPolicy]);

    return (
      <div
        data-testid="conversation-viewer"
        data-scroll-policy={scrollPolicy.mode}
      >
        <ul data-testid="viewer-messages">
          {messages.map((message) => (
            <li
              key={message.id}
              data-testid={`viewer-message-${message.id}`}
              data-execution-status={message.executionStatus}
            >
              {message.id}
            </li>
          ))}
        </ul>
      </div>
    );
  },
}));

vi.mock("../../Conversation/Components/ThinkingText", () => ({
  ThinkingText: ({ text }: { text: string }) => (
    <div data-testid="mock-thinking-text">{text}</div>
  ),
}));

vi.mock("../ExternalReplyComposer", () => ({
  ExternalReplyComposer: ({
    runProcessing,
    agentSessionMetadata,
    editorReplacement,
  }: {
    runProcessing?: boolean;
    agentSessionMetadata?: {
      provider: "codex";
      model: string;
      effort?: string;
    };
    editorReplacement?: React.ReactNode;
  }) => (
    <div
      data-testid="reply-composer"
      data-run-processing={String(runProcessing ?? false)}
      data-metadata-placement={agentSessionMetadata ? "below-composer" : "none"}
    >
      {editorReplacement}
    </div>
  ),
}));

const cliResultRef = vi.hoisted<{ current: AgentBridgeRecoveryState }>(() => ({
  current: {
    type: "ready",
    machine: {
      machineId: "machine-1",
      name: "Orbit",
      executionReadiness: "READY",
      currentControllerEligibility: "ELIGIBLE",
    },
  },
}));

vi.mock("../runtime/hooks/useCliRequired", () => ({
  useCliRequired: () => cliResultRef.current,
}));

const buildMessage = (
  overrides: Partial<MessageResponseDto> = {},
): MessageResponseDto =>
  ({
    id: "msg-1",
    conversationId: "conv-1",
    organizationId: "org-1",
    projectId: "proj-1",
    type: MessageType.System,
    status: MessageStatus.Completed,
    data: { text: "" },
    createdAt: "2026-04-01T10:00:00.000Z",
    updatedAt: "2026-04-01T10:00:00.000Z",
    ...overrides,
  }) as unknown as MessageResponseDto;

const okMessagesResponse = (messages: MessageResponseDto[]) => ({
  data: {
    data: { messages, nextCursor: null },
    success: true,
    message: "ok",
    timestamp: "now",
  },
  status: 200,
  statusText: "OK",
  headers: {},
  config: {},
});

const okDeltaResponse = (messages: MessageResponseDto[]) => ({
  data: { data: messages, success: true, message: "ok", timestamp: "now" },
  status: 200,
  statusText: "OK",
  headers: {},
  config: {},
});

const buildConversationEnvelope = (
  overrides: Partial<ConversationResponseDto> = {},
): ConversationResponseDto =>
  ({
    id: "conv-1",
    projectId: "proj-1",
    organizationId: "org-1",
    initiatedBy: InitiationType.User,
    status: ConversationStatus.Started,
    version: 1,
    createdAt: "2026-04-01T09:00:00.000Z",
    updatedAt: "2026-04-01T09:00:00.000Z",
    ...overrides,
  }) as unknown as ConversationResponseDto;

/** Shared by every render and handler in a test, like the app's one client. */
let queryClient: QueryClient;

const onPostMessage = vi.fn(async (_message: CreateUserMessage) => {});

const renderView = (
  store: ReturnType<typeof createStore>,
  props: Pick<
    AgentConversationViewProps,
    "hideComposer" | "agentSessionMetadata" | "scrollable" | "scrollPolicy"
  > = {},
) =>
  render(
    <AgentConversationView
      organizationId="org-1"
      projectId="proj-1"
      agentSessionId="agent-session-1"
      conversationId="conv-1"
      onPostMessage={onPostMessage}
      {...props}
    />,
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          <Provider store={store}>{children}</Provider>
        </QueryClientProvider>
      ),
    },
  );

const newerMessageEvent = (
  latestMessageId: string,
): WebSocketConversationUpdatedEvent =>
  ({
    type: "conversation.updated",
    timestamp: "2026-04-01T11:00:00.000Z",
    organizationId: "org-1",
    projectId: "proj-1",
    conversationId: "conv-1",
    previousVersion: 1,
    newVersion: 2,
    changeType: "message_added",
    latestMessageId,
  }) as unknown as WebSocketConversationUpdatedEvent;

const currentStateEvent = (
  currentState: AgentSessionCurrentState,
  revision = 1,
) => ({
  type: WebSocketSubscriptionRequestEventTypesEnum.AgentSessionCurrentStateChanged,
  timestamp: "2026-04-01T11:00:00.000Z",
  organizationId: "org-1",
  projectId: "proj-1",
  agentSessionId: "agent-session-1",
  currentState,
  revision,
  transitionedAt: "2026-04-01T11:00:00.000Z",
});

describe("AgentConversationView messages-collection cutover", () => {
  let getMessagesMock: MockedFunction<typeof platformClient.getMessages>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(projectsClient.getQueuedConversationInputs).mockResolvedValue({
      data: { data: [] },
    } as never);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    useConversationRefetchSpy.mockClear();
    useConversationMarkStaleSpy.mockClear();
    onPostMessage.mockClear();
    cliResultRef.current = {
      type: "ready",
      machine: {
        machineId: "machine-1",
        name: "Orbit",
        executionReadiness: "READY",
      },
    };

    useConversationReturnValue = {
      data: buildConversationEnvelope(),
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: useConversationRefetchSpy,
      markStale: useConversationMarkStaleSpy,
      retryCount: 0,
    };

    getMessagesMock = platformClient.getMessages as Mock;
  });

  it("clears sending on message.updated before any agent response or conversation.updated", async () => {
    const pending = buildMessage({
      id: "pending-input",
      type: MessageType.User,
      data: { comment: "Please continue" },
      executionStatus: "queued",
      executionQueueConfirmed: false,
    });
    vi.mocked(projectsClient.getQueuedConversationInputs).mockResolvedValue({
      data: { data: [pending] },
    } as never);
    getMessagesMock.mockResolvedValue(okMessagesResponse([pending]));
    const store = createStore();
    renderView(store);
    await screen.findByTestId("viewer-message-pending-input");
    expect(
      screen.queryByLabelText("Sending / awaiting delivery"),
    ).not.toBeInTheDocument();

    const started = { ...pending, executionStatus: "started" as const };
    vi.mocked(projectsClient.getQueuedConversationInputs).mockResolvedValue({
      data: { data: [] },
    } as never);
    vi.mocked(platformClient.getMessage).mockResolvedValue({
      data: { data: started },
    } as never);
    getMessagesMock.mockResolvedValue(okMessagesResponse([started]));
    const handler = new WebSocketHandler(
      store,
      {
        logEvent: vi.fn(),
        logQueryInvalidation: vi.fn(),
      },
      queryClient,
    );
    act(() =>
      handler.handleEvent({
        type: "message.updated",
        timestamp: new Date().toISOString(),
        organizationId: "org-1",
        projectId: "proj-1",
        conversationId: pending.conversationId,
        messageId: pending.id,
        changedFields: [],
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("viewer-message-pending-input"),
      ).toHaveAttribute("data-execution-status", "started"),
    );
    expect(screen.getAllByTestId("viewer-message-pending-input")).toHaveLength(
      1,
    );
    expect(screen.queryByLabelText("Queued messages")).not.toBeInTheDocument();
  });

  it("keys shared metadata placement off the hideComposer boundary", async () => {
    getMessagesMock.mockResolvedValue(okMessagesResponse([]));

    const store = createStore();
    renderView(store, {
      agentSessionMetadata: {
        provider: "codex",
        model: "gpt-5-codex",
        effort: "high",
      },
    });

    expect(await screen.findByTestId("reply-composer")).toHaveAttribute(
      "data-metadata-placement",
      "below-composer",
    );
  });

  it("places shared metadata below the conversation when the composer is hidden", async () => {
    getMessagesMock.mockResolvedValue(okMessagesResponse([]));

    const store = createStore();
    renderView(store, {
      hideComposer: true,
      scrollable: true,
      agentSessionMetadata: {
        provider: "codex",
        model: "gpt-5-codex",
        effort: "high",
      },
    });

    expect(screen.queryByTestId("reply-composer")).not.toBeInTheDocument();
    const metadata = await screen.findByTestId("agent-session-metadata");
    expect(metadata).toHaveAttribute("data-placement", "below-conversation");
    expect(metadata).toHaveTextContent("gpt-5-codex");
    expect(
      screen.getByTestId("agent-conversation-scrollport"),
    ).not.toContainElement(metadata);
    expect(screen.getByTestId("agent-conversation-view")).toHaveStyle({
      flexDirection: "column",
    });
  });

  it("renders messages from the messages collection on initial mount", async () => {
    const initial = [
      buildMessage({ id: "msg-1", createdAt: "2026-04-01T10:00:00.000Z" }),
      buildMessage({
        id: "msg-2",
        createdAt: "2026-04-01T10:05:00.000Z",
      }),
    ];
    getMessagesMock.mockResolvedValue(okMessagesResponse(initial));

    const store = createStore();
    renderView(store);

    await waitFor(() => {
      expect(screen.getByTestId("viewer-message-msg-1")).toBeInTheDocument();
      expect(screen.getByTestId("viewer-message-msg-2")).toBeInTheDocument();
    });

    expect(getMessagesMock).toHaveBeenCalledTimes(1);
    expect(getMessagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        conversationId: "conv-1",
        includeProposals: true,
        includeReports: true,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("shows cached Agent Session messages immediately and appends responses missed while unmounted", async () => {
    const cached = [
      buildMessage({ id: "msg-1", createdAt: "2026-04-01T10:00:00.000Z" }),
      buildMessage({ id: "msg-2", createdAt: "2026-04-01T10:05:00.000Z" }),
    ];
    getMessagesMock.mockResolvedValueOnce(okMessagesResponse(cached));

    const store = createStore();
    const firstMount = renderView(store);

    await screen.findByTestId("viewer-message-msg-2");
    firstMount.unmount();
    // Let the departure settle (the list is marked stale once no view holds it).
    await act(async () => {});

    let resolveRevalidation:
      ((response: ReturnType<typeof okDeltaResponse>) => void) | undefined;
    const revalidation = new Promise<ReturnType<typeof okDeltaResponse>>(
      (resolve) => {
        resolveRevalidation = resolve;
      },
    );
    getMessagesMock.mockReturnValueOnce(revalidation);

    renderView(store);

    // Cached content is synchronously available on the returning surface;
    // the authoritative read remains pending in the background.
    expect(screen.getByTestId("viewer-message-msg-1")).toBeInTheDocument();
    expect(screen.getByTestId("viewer-message-msg-2")).toBeInTheDocument();

    await waitFor(() => {
      expect(getMessagesMock).toHaveBeenCalledTimes(2);
    });
    expect(getMessagesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        conversationId: "conv-1",
        since: "msg-1",
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await act(async () => {
      resolveRevalidation?.(
        okDeltaResponse([
          cached[1]!,
          buildMessage({
            id: "msg-3",
            createdAt: "2026-04-01T10:10:00.000Z",
          }),
        ]),
      );
      await revalidation;
    });

    await screen.findByTestId("viewer-message-msg-3");
    expect(screen.getAllByTestId("viewer-message-msg-2")).toHaveLength(1);
  });

  it("passes a persisted launch USER message to the viewer exactly once in order", async () => {
    const launchMessage = buildMessage({
      id: "launch-user",
      type: MessageType.User,
      data: { comment: "Start this coding session" },
      createdAt: "2026-04-01T09:59:00.000Z",
    });
    const firstAgentMessage = buildMessage({
      id: "first-agent-response",
      createdAt: "2026-04-01T10:00:00.000Z",
    });
    getMessagesMock.mockResolvedValue(
      okMessagesResponse([launchMessage, firstAgentMessage]),
    );

    const store = createStore();
    renderView(store);

    await waitFor(() => {
      expect(
        screen.getByTestId("viewer-message-launch-user"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("viewer-message-first-agent-response"),
      ).toBeInTheDocument();
    });

    const renderedMessageIds = Array.from(
      screen.getByTestId("viewer-messages").querySelectorAll("li"),
      (message) => message.textContent,
    );
    expect(renderedMessageIds).toEqual(["launch-user", "first-agent-response"]);
    expect(screen.getAllByTestId("viewer-message-launch-user")).toHaveLength(1);
  });

  it("does not synthesize a launch USER message when none was persisted", async () => {
    getMessagesMock.mockResolvedValue(
      okMessagesResponse([buildMessage({ id: "first-agent-response" })]),
    );

    const store = createStore();
    renderView(store);

    await screen.findByTestId("viewer-message-first-agent-response");

    expect(
      screen.queryByTestId("viewer-message-launch-user"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("viewer-messages").querySelectorAll("li"),
    ).toHaveLength(1);
  });

  it("scrolls only the bounded conversation scrollport after messages render", async () => {
    let resolveMessages:
      ((response: ReturnType<typeof okMessagesResponse>) => void) | undefined;
    const messagesResponsePromise = new Promise<
      ReturnType<typeof okMessagesResponse>
    >((resolve) => {
      resolveMessages = resolve;
    });
    getMessagesMock.mockReturnValue(messagesResponsePromise);

    const store = createStore();
    render(
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <div data-testid="page-scroll-container">
            <AgentConversationView
              organizationId="org-1"
              projectId="proj-1"
              agentSessionId="agent-session-1"
              conversationId="conv-1"
              onPostMessage={onPostMessage}
              scrollable
            />
          </div>
        </Provider>
      </QueryClientProvider>,
    );

    const ancestor = screen.getByTestId("page-scroll-container");
    const ancestorScrollTo = vi.fn();
    Object.defineProperties(ancestor, {
      scrollTop: { configurable: true, value: 77, writable: true },
      scrollTo: { configurable: true, value: ancestorScrollTo },
    });
    const scrollport = screen.getByTestId("agent-conversation-scrollport");
    expect(screen.getByTestId("conversation-viewer")).toHaveAttribute(
      "data-scroll-policy",
      "owned",
    );
    const scrollTo = vi.fn();
    Object.defineProperties(scrollport, {
      scrollHeight: { configurable: true, value: 1200 },
      scrollTo: { configurable: true, value: scrollTo },
    });

    expect(scrollTo).not.toHaveBeenCalled();

    await act(async () => {
      resolveMessages?.(
        okMessagesResponse([
          buildMessage({
            id: "msg-1",
            createdAt: "2026-04-01T10:00:00.000Z",
          }),
        ]),
      );
      await messagesResponsePromise;
    });

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({
        top: 1200,
        behavior: "instant",
      });
    });
    expect(ancestorScrollTo).not.toHaveBeenCalled();
    expect(ancestor.scrollTop).toBe(77);
  });

  it("uses a supplied embedding scrollport as the only owner", async () => {
    getMessagesMock.mockResolvedValue(
      okMessagesResponse([
        buildMessage({
          id: "msg-1",
          createdAt: "2026-04-01T10:00:00.000Z",
        }),
      ]),
    );

    const ownerRef = { current: null as HTMLElement | null };
    const scrollPolicy = {
      mode: "owned",
      ownerRef,
    } as const satisfies ConversationScrollPolicy;
    const store = createStore();
    render(
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <div data-testid="page-scroll-container">
            <div
              data-testid="embedding-scrollport"
              ref={(element) => {
                ownerRef.current = element;
              }}
            >
              <AgentConversationView
                organizationId="org-1"
                projectId="proj-1"
                agentSessionId="agent-session-1"
                conversationId="conv-1"
                onPostMessage={onPostMessage}
                scrollPolicy={scrollPolicy}
              />
            </div>
          </div>
        </Provider>
      </QueryClientProvider>,
    );

    const ancestor = screen.getByTestId("page-scroll-container");
    const ancestorScrollTo = vi.fn();
    Object.defineProperties(ancestor, {
      scrollTo: { configurable: true, value: ancestorScrollTo },
    });
    const owner = screen.getByTestId("embedding-scrollport");
    const scrollTo = vi.fn();
    Object.defineProperties(owner, {
      scrollHeight: { configurable: true, value: 1200 },
      scrollTo: { configurable: true, value: scrollTo },
    });

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({
        top: 1200,
        behavior: "instant",
      });
    });
    expect(ancestorScrollTo).not.toHaveBeenCalled();
    expect(screen.queryByTestId("agent-conversation-scrollport")).toBeNull();
  });

  it("contains intrinsically wide inline content in embedded mode", async () => {
    getMessagesMock.mockResolvedValue(
      okMessagesResponse([
        buildMessage({
          id: "wide-message",
          createdAt: "2026-04-01T10:00:00.000Z",
        }),
      ]),
    );

    const store = createStore();
    render(
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <AgentConversationView
            organizationId="org-1"
            projectId="proj-1"
            agentSessionId="agent-session-1"
            conversationId="conv-1"
            onPostMessage={onPostMessage}
          />
        </Provider>
      </QueryClientProvider>,
    );

    await screen.findByTestId("viewer-message-wide-message");

    const conversationView = screen.getByTestId("agent-conversation-view");
    expect(conversationView).toHaveStyle({
      minWidth: "0",
      width: "100%",
      maxWidth: "100%",
      overflowX: "hidden",
    });
    expect(getComputedStyle(conversationView).backgroundColor).toBe(
      "rgba(0, 0, 0, 0)",
    );
    expect(conversationViewerPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        slotProps: expect.objectContaining({
          paper: expect.objectContaining({
            sx: expect.objectContaining({
              backgroundColor: "transparent",
              backgroundImage: "none",
            }),
          }),
        }),
      }),
    );
  });

  it("appends a delta on conversation.updated without refetching the envelope", async () => {
    const initial = [
      buildMessage({ id: "msg-1", createdAt: "2026-04-01T10:00:00.000Z" }),
      buildMessage({ id: "msg-2", createdAt: "2026-04-01T10:05:00.000Z" }),
    ];
    const delta = [
      buildMessage({ id: "msg-3", createdAt: "2026-04-01T10:10:00.000Z" }),
    ];
    getMessagesMock
      .mockResolvedValueOnce(okMessagesResponse(initial))
      .mockResolvedValueOnce(okDeltaResponse(delta));

    const store = createStore();
    renderView(store);

    await waitFor(() => {
      expect(getMessagesMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId("viewer-message-msg-2")).toBeInTheDocument();
    });

    const handler = new WebSocketHandler(store, undefined, queryClient);
    await act(async () => {
      handler.handleEvent(newerMessageEvent("msg-3"));
    });

    await waitFor(() => {
      expect(getMessagesMock).toHaveBeenCalledTimes(2);
    });
    // Second call carries the boundary terminal message (one before the
    // latest) as the `since` cursor, so a late edit to the most recent
    // already-terminal message is pulled back in and re-merged.
    expect(getMessagesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        conversationId: "conv-1",
        since: "msg-1",
        includeProposals: true,
        includeReports: true,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("viewer-message-msg-3")).toBeInTheDocument();
    });

    expect(useConversationRefetchSpy).not.toHaveBeenCalled();
    expect(useConversationMarkStaleSpy).not.toHaveBeenCalled();
  });

  it("shares a single delta fetch across two simultaneously mounted views", async () => {
    const initial = [
      buildMessage({ id: "msg-1", createdAt: "2026-04-01T10:00:00.000Z" }),
      buildMessage({ id: "msg-2", createdAt: "2026-04-01T10:05:00.000Z" }),
    ];
    const delta = [
      buildMessage({ id: "msg-3", createdAt: "2026-04-01T10:10:00.000Z" }),
    ];
    getMessagesMock
      .mockResolvedValueOnce(okMessagesResponse(initial))
      .mockResolvedValueOnce(okDeltaResponse(delta));

    const store = createStore();

    render(
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <AgentConversationView
            organizationId="org-1"
            projectId="proj-1"
            agentSessionId="agent-session-a"
            conversationId="conv-1"
            onPostMessage={onPostMessage}
          />
          <AgentConversationView
            organizationId="org-1"
            projectId="proj-1"
            agentSessionId="agent-session-b"
            conversationId="conv-1"
            onPostMessage={onPostMessage}
          />
        </Provider>
      </QueryClientProvider>,
    );

    // Both views read the same messages query; the collection dedupes the
    // initial fetch into a single platformClient.getMessages call.
    await waitFor(() => {
      expect(getMessagesMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(
        screen.getAllByTestId("viewer-message-msg-2").length,
      ).toBeGreaterThanOrEqual(2);
    });

    const handler = new WebSocketHandler(store, undefined, queryClient);
    await act(async () => {
      handler.handleEvent(newerMessageEvent("msg-3"));
    });

    // Single delta fetch services both mounted views.
    await waitFor(() => {
      expect(getMessagesMock).toHaveBeenCalledTimes(2);
    });

    // Cache is the shared source for both readers.
    const cached = queryClient.getQueryData<{ id: string }[]>(
      messageKeys.list("org-1", "proj-1", "conv-1"),
    );
    expect(cached?.map((message) => message.id)).toEqual([
      "msg-1",
      "msg-2",
      "msg-3",
    ]);
    await waitFor(() => {
      expect(screen.getAllByTestId("viewer-message-msg-3")).toHaveLength(2);
    });
    expect(getMessagesMock).toHaveBeenCalledTimes(2);
  });

  it("renders the reply composer by default", async () => {
    getMessagesMock.mockResolvedValue(
      okMessagesResponse([
        buildMessage({ id: "msg-1", createdAt: "2026-04-01T10:00:00.000Z" }),
      ]),
    );

    const store = createStore();
    renderView(store);

    await waitFor(() => {
      expect(screen.getByTestId("reply-composer")).toBeInTheDocument();
    });
  });

  it("replaces the reply editor with guidance for the bound machine", async () => {
    getMessagesMock.mockResolvedValue(okMessagesResponse([]));
    cliResultRef.current = {
      type: "disconnected",
      machine: {
        machineId: "machine-1",
        name: "Orbit",
        executionReadiness: "DISCONNECTED",
        currentControllerEligibility: "ELIGIBLE",
      },
    };

    const store = createStore();
    renderView(store);

    const notice = await screen.findByTestId("agent-bridge-recovery-notice");
    expect(screen.getByTestId("reply-composer")).toContainElement(notice);
    expect(notice).toHaveTextContent("Orbit");
    expect(notice).toHaveTextContent("Disconnected");
  });

  it("renders the thinking indicator from the Agent Session current-state channel", async () => {
    getMessagesMock.mockResolvedValue(okMessagesResponse([]));

    const store = createStore();
    renderView(store);

    const handler = new WebSocketHandler(store, undefined, queryClient);
    await act(async () => {
      handler.handleEvent(currentStateEvent(AgentSessionCurrentState.Thinking));
    });

    await waitFor(() => {
      expect(screen.getByTestId("mock-thinking-text")).toHaveTextContent(
        "Thinking...",
      );
    });
    expect(
      screen.getByTestId("agent-session-current-state-indicator"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("agent-session-current-state-approval-icon"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("reply-composer")).toHaveAttribute(
      "data-run-processing",
      "true",
    );
  });

  it("renders the starting indicator from the Agent Session current-state channel", async () => {
    getMessagesMock.mockResolvedValue(okMessagesResponse([]));

    const store = createStore();
    renderView(store);

    const handler = new WebSocketHandler(store, undefined, queryClient);
    await act(async () => {
      handler.handleEvent(currentStateEvent(AgentSessionCurrentState.Starting));
    });

    await waitFor(() => {
      expect(screen.getByTestId("mock-thinking-text")).toHaveTextContent(
        "Starting conversation...",
      );
    });
    expect(
      screen.getByTestId("agent-session-current-state-indicator"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("agent-session-current-state-approval-icon"),
    ).not.toBeInTheDocument();
  });

  it("renders the writing indicator from the Agent Session current-state channel", async () => {
    getMessagesMock.mockResolvedValue(okMessagesResponse([]));

    const store = createStore();
    renderView(store);

    const handler = new WebSocketHandler(store, undefined, queryClient);
    await act(async () => {
      handler.handleEvent(currentStateEvent(AgentSessionCurrentState.Writing));
    });

    await waitFor(() => {
      expect(screen.getByTestId("mock-thinking-text")).toHaveTextContent(
        "Writing Response...",
      );
    });
    expect(
      screen.getByTestId("agent-session-current-state-indicator"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("agent-session-current-state-approval-icon"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("reply-composer")).toHaveAttribute(
      "data-run-processing",
      "true",
    );
  });

  it("renders the awaiting approval indicator from the Agent Session current-state channel", async () => {
    getMessagesMock.mockResolvedValue(okMessagesResponse([]));

    const store = createStore();
    renderView(store);

    const handler = new WebSocketHandler(store, undefined, queryClient);
    await act(async () => {
      handler.handleEvent(
        currentStateEvent(AgentSessionCurrentState.AwaitingApproval),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("agent-session-current-state-indicator"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("agent-session-current-state-approval-icon"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("agent-session-current-state-label"),
    ).toHaveTextContent("Awaiting approval");
    expect(
      screen.getByTestId("agent-session-current-state-indicator"),
    ).toHaveAttribute(
      "data-current-state",
      AgentSessionCurrentState.AwaitingApproval,
    );
    expect(screen.queryByTestId("mock-thinking-text")).not.toBeInTheDocument();
  });

  it.each([
    {
      currentState: AgentSessionCurrentState.PlanReady,
      label: "Plan ready",
    },
    {
      currentState: AgentSessionCurrentState.ImplementationReady,
      label: "Implementation ready",
    },
  ])(
    "renders the distinct $label label without a review control",
    async ({ currentState, label }) => {
      getMessagesMock.mockResolvedValue(okMessagesResponse([]));

      const store = createStore();
      renderView(store);

      const handler = new WebSocketHandler(store, undefined, queryClient);
      await act(async () => {
        handler.handleEvent(currentStateEvent(currentState));
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("agent-session-current-state-label"),
        ).toHaveTextContent(label);
      });
      expect(
        screen.getByTestId("agent-session-current-state-indicator"),
      ).toHaveAttribute("data-actionable", "true");
      expect(
        screen.queryByTestId("mock-thinking-text"),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.getByTestId("reply-composer")).toHaveAttribute(
        "data-run-processing",
        "false",
      );
    },
  );

  it("does not render a thinking indicator before any platform phase arrives", async () => {
    getMessagesMock.mockResolvedValue(okMessagesResponse([]));

    const store = createStore();
    renderView(store);

    await waitFor(() => {
      expect(screen.getByTestId("conversation-viewer")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("agent-session-current-state-indicator"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("mock-thinking-text")).not.toBeInTheDocument();
    expect(screen.getByTestId("reply-composer")).toHaveAttribute(
      "data-run-processing",
      "false",
    );
  });

  it("hides the reply composer when hideComposer is set", async () => {
    getMessagesMock.mockResolvedValue(
      okMessagesResponse([
        buildMessage({ id: "msg-1", createdAt: "2026-04-01T10:00:00.000Z" }),
      ]),
    );

    const store = createStore();
    render(
      <AgentConversationView
        organizationId="org-1"
        projectId="proj-1"
        agentSessionId="agent-session-1"
        conversationId="conv-1"
        onPostMessage={onPostMessage}
        hideComposer
      />,
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={queryClient}>
            <Provider store={store}>{children}</Provider>
          </QueryClientProvider>
        ),
      },
    );

    await waitFor(() => {
      expect(screen.getByTestId("conversation-viewer")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("reply-composer")).not.toBeInTheDocument();
  });
});
