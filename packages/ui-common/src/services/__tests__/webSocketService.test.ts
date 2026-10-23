import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStore } from "jotai";
import { WebSocketService } from "../webSocketService";
import { WebSocketHandler } from "../../data/websockets/handler";
import type { WebSocketDebugger } from "../../data/websockets/debug";
import { logger } from "../../utils/logger";
import { QueryClient } from "@tanstack/react-query";
import { messageKeys } from "../../data/collections/messages";
import { agentSessionKeys } from "../../data/collections/agentSessions";
import { conversationPhaseByIdAtom } from "../../data/websockets/conversationPhase";
import { ToastService } from "../toastService";
import type {
  WebSocketAgentSessionCurrentStateChangedEvent,
  WebSocketAgentSessionStatusChangedEvent,
  WebSocketConversationUpdatedEvent,
  WebSocketMessageRealtimeEvent,
  WebSocketMessageUpdatedEvent,
  WebSocketProposalGroupLifecycleEvent,
} from "../../api";
import { WebSocketSubscriptionRequestEventTypesEnum } from "../../api";
import { dataClient } from "../../clients";

const authServiceMocks = vi.hoisted(() => ({
  refreshAuthToken: vi.fn(),
}));

vi.mock("../authService", () => authServiceMocks);

// Mock Socket.IO
const mockSocket = {
  connected: false,
  on: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
};

mockSocket.disconnect.mockImplementation(() => {
  mockSocket.connected = false;
});

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => mockSocket),
}));

const createMockDebugger = (): WebSocketDebugger =>
  ({
    logEvent: vi.fn(),
    logCollectionAction: vi.fn(),
  }) as unknown as WebSocketDebugger;

const authenticateMockSocket = (): void => {
  mockSocket.connected = true;
  const connectCall = mockSocket.on.mock.calls.find(
    (call) => call[0] === "connect",
  );
  expect(connectCall).toBeDefined();
  connectCall![1]();

  const authenticatedCall = mockSocket.on.mock.calls.find(
    (call) => call[0] === "authenticated",
  );
  expect(authenticatedCall).toBeDefined();
  authenticatedCall![1]({
    status: "success",
    connectionId: "connection-1",
    userId: "test-user",
    projectIds: [],
    conversationIds: [],
    initiativeIds: [],
    designDocIds: [],
  });
};

describe("WebSocketService", () => {
  let mockStore: ReturnType<typeof createStore>;
  let mockHandler: WebSocketHandler;
  let mockDebugger: WebSocketDebugger;

  beforeEach(() => {
    mockStore = createStore();
    mockDebugger = createMockDebugger();
    mockHandler = new WebSocketHandler(mockStore, mockDebugger);
    vi.clearAllMocks();

    // Reset mock socket state
    mockSocket.connected = false;
    mockSocket.on.mockClear();
    mockSocket.emit.mockClear();
    mockSocket.disconnect.mockClear();
    authServiceMocks.refreshAuthToken.mockRejectedValue(
      new Error("terminal browser session"),
    );
  });

  afterEach(() => {
    mockHandler.destroy();
    vi.clearAllMocks();
  });

  it("joins and leaves private Open Items rooms through acknowledged reconciliation", () => {
    const service = new WebSocketService(mockHandler);
    const changed = vi.fn();
    const joined = vi.fn();
    const id = service.subscribe({
      openItemsProjectIds: ["project"],
      events: { onOpenItemsChanged: changed, onOpenItemsRoomJoined: joined },
    });
    service.initialize({ userId: "test-user" });
    authenticateMockSocket();
    const join = mockSocket.emit.mock.calls.find((call) => call[0] === "join")!;
    expect(join[1]).toEqual({ openItemsProjectId: "project" });
    join[2]({ status: "success", openItemsProjectId: "project" });
    expect(joined).toHaveBeenCalledWith("project");
    const signal = {
      type: "open_items.changed",
      projectId: "project",
      revision: 2,
    };
    mockSocket.on.mock.calls.find(
      (call) => call[0] === "open_items.changed",
    )![1](signal);
    expect(changed).toHaveBeenCalledWith(signal);
    service.unsubscribe(id);
    const leave = mockSocket.emit.mock.calls.find(
      (call) => call[0] === "leave",
    )!;
    expect(leave[1]).toEqual({ roomType: "open_items", roomId: "project" });
    leave[2]({ status: "success", roomType: "open_items", roomId: "project" });
    expect(mockSocket.disconnect).not.toHaveBeenCalled();
    service.disconnect();
  });

  it("should accept custom handler", () => {
    const service = new WebSocketService(mockHandler);

    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(WebSocketService);
  });

  it("converges to the latest update while a join is pending", () => {
    const service = new WebSocketService(mockHandler);
    const id = service.subscribe({ projectIds: ["old"] });
    service.initialize({ userId: "test-user" });
    authenticateMockSocket();
    const joins = () =>
      mockSocket.emit.mock.calls.filter((call) => call[0] === "join");
    service.updateSubscription(id, { projectIds: ["intermediate"] });
    service.updateSubscription(id, { projectIds: ["latest"] });
    joins()[0]![2]({ status: "success", projectId: "old" });
    expect(joins()).toHaveLength(1);
    mockSocket.emit.mock.calls.find((call) => call[0] === "leave")![2]({
      status: "success",
      roomType: "project",
      roomId: "old",
    });
    expect(joins()[1]?.[1]).toEqual({ projectId: "latest" });
    expect(mockSocket.disconnect).not.toHaveBeenCalled();
    service.disconnect();
  });

  it("times out a pending leave without accepting its late success", () => {
    vi.useFakeTimers();
    const service = new WebSocketService(mockHandler);
    const id = service.subscribe({ projectIds: ["project"] });
    service.initialize({ userId: "test-user" });
    authenticateMockSocket();
    mockSocket.emit.mock.calls.find((call) => call[0] === "join")![2]({
      status: "success",
      projectId: "project",
    });
    service.unsubscribe(id);
    const leave = mockSocket.emit.mock.calls.find(
      (call) => call[0] === "leave",
    )!;
    vi.advanceTimersByTime(10000);
    expect(mockSocket.disconnect).toHaveBeenCalledTimes(1);
    leave[2]({ status: "success", roomType: "project", roomId: "project" });
    expect(mockSocket.disconnect).toHaveBeenCalledTimes(1);
    service.disconnect();
    vi.useRealTimers();
  });

  it.each([
    { userId: "replacement-user" },
    { userId: "test-user", serverUrl: "http://replacement.example" },
    {},
  ])(
    "retires live membership on security configuration changes %j",
    (config) => {
      const service = new WebSocketService(mockHandler);
      service.subscribe({ conversationIds: ["conversation"] });
      service.initialize({ userId: "test-user" });
      authenticateMockSocket();
      const oldJoin = mockSocket.emit.mock.calls.find(
        (call) => call[0] === "join",
      )!;
      service.initialize(config);
      expect(mockSocket.disconnect).toHaveBeenCalledTimes(1);
      oldJoin[2]({ status: "success", conversationId: "conversation" });
      expect(service.getState().isAuthenticated).toBe(false);
      service.disconnect();
    },
  );

  it("retains shared rooms and settles re-added rooms after pending departure", () => {
    const service = new WebSocketService(mockHandler);
    const stale = vi.spyOn(mockHandler, "markAllStale");
    const first = service.subscribe({ conversationIds: ["conversation-1"] });
    const second = service.subscribe({ conversationIds: ["conversation-1"] });
    service.initialize({ userId: "test-user" });
    authenticateMockSocket();
    const joins = () =>
      mockSocket.emit.mock.calls.filter((call) => call[0] === "join");
    joins()[0]![2]({ status: "success", conversationId: "conversation-1" });
    service.unsubscribe(first);
    expect(
      mockSocket.emit.mock.calls.filter((call) => call[0] === "leave"),
    ).toHaveLength(0);
    service.unsubscribe(second);
    const leave = mockSocket.emit.mock.calls.find(
      (call) => call[0] === "leave",
    )!;
    service.subscribe({ conversationIds: ["conversation-1"] });
    expect(joins()).toHaveLength(1);
    leave[2]({
      status: "success",
      roomType: "conversation",
      roomId: "conversation-1",
    });
    expect(joins()).toHaveLength(2);
    expect(mockSocket.disconnect).not.toHaveBeenCalled();
    expect(stale).not.toHaveBeenCalled();
    expect(
      mockSocket.emit.mock.calls.filter((call) => call[0] === "authenticate"),
    ).toHaveLength(1);
    service.disconnect();
  });

  it("clears the actual phase store immediately and accepts only new replay on rejoin", () => {
    const service = new WebSocketService(mockHandler);
    const first = service.subscribe({ conversationIds: ["conversation-1"] });
    service.initialize({ userId: "test-user" });
    authenticateMockSocket();
    const phase = mockSocket.on.mock.calls.find(
      (call) => call[0] === "conversation.phase_changed",
    )![1];
    const event = {
      type: "conversation.phase_changed",
      conversationId: "conversation-1",
      phase: "working",
      revision: 1,
      transitionedAt: new Date().toISOString(),
    };
    phase(event);
    expect(
      mockStore.get(conversationPhaseByIdAtom)["conversation-1"],
    ).toBeDefined();
    const retained = service.subscribe({ conversationIds: ["conversation-1"] });
    service.unsubscribe(first);
    expect(
      mockStore.get(conversationPhaseByIdAtom)["conversation-1"],
    ).toBeDefined();
    service.unsubscribe(retained);
    expect(mockStore.get(conversationPhaseByIdAtom)).toEqual({});
    phase({ ...event, revision: 2 });
    expect(mockStore.get(conversationPhaseByIdAtom)).toEqual({});
    service.subscribe({ conversationIds: ["conversation-1"] });
    const joins = () =>
      mockSocket.emit.mock.calls.filter((call) => call[0] === "join");
    joins()[0]![2]({ status: "success", conversationId: "conversation-1" });
    const leave = mockSocket.emit.mock.calls.find(
      (call) => call[0] === "leave",
    )!;
    leave[2]({
      status: "success",
      roomType: "conversation",
      roomId: "conversation-1",
    });
    expect(mockStore.get(conversationPhaseByIdAtom)).toEqual({});
    phase({ ...event, revision: 3 });
    expect(
      mockStore.get(conversationPhaseByIdAtom)["conversation-1"]?.revision,
    ).toBe(3);
    service.disconnect();
    expect(mockStore.get(conversationPhaseByIdAtom)).toEqual({});
  });

  it.each([
    { status: "error", reason: "access_denied", message: "Access denied" },
    { status: "success", roomType: "project", roomId: "wrong" },
    undefined,
  ])(
    "fails closed on uncertain departure %j and ignores retired callbacks",
    (response) => {
      const service = new WebSocketService(mockHandler);
      const id = service.subscribe({ projectIds: ["project-1"] });
      service.initialize({ userId: "test-user" });
      authenticateMockSocket();
      mockSocket.emit.mock.calls.find((call) => call[0] === "join")![2]({
        status: "success",
        projectId: "project-1",
      });
      service.unsubscribe(id);
      const leave = mockSocket.emit.mock.calls.find(
        (call) => call[0] === "leave",
      )!;
      leave[2](response);
      expect(mockSocket.disconnect).toHaveBeenCalledTimes(1);
      leave[2]({ status: "success", roomType: "project", roomId: "project-1" });
      expect(mockSocket.disconnect).toHaveBeenCalledTimes(1);
      service.disconnect();
    },
  );

  it("bounds uncertain joins with a timeout and recovers after reconnect", () => {
    vi.useFakeTimers();
    const service = new WebSocketService(mockHandler);
    const stale = vi.spyOn(mockHandler, "markAllStale");
    service.subscribe({ projectIds: ["project-1"] });
    service.initialize({ userId: "test-user" });
    authenticateMockSocket();
    vi.advanceTimersByTime(10000);
    expect(mockSocket.disconnect).toHaveBeenCalledTimes(1);
    mockSocket.connected = true;
    mockSocket.on.mock.calls
      .filter((call) => call[0] === "connect")
      .at(-1)![1]();
    expect(stale).toHaveBeenCalledTimes(1);
    service.disconnect();
    vi.useRealTimers();
  });

  it("does not loop on denied demand, but retries when demand is removed and restored", () => {
    const service = new WebSocketService(mockHandler);
    const first = service.subscribe({ projectIds: ["project-1"] });
    service.initialize({ userId: "test-user" });
    authenticateMockSocket();
    const joins = () =>
      mockSocket.emit.mock.calls.filter((call) => call[0] === "join");
    joins()[0]![2]({
      status: "error",
      reason: "access_denied",
      message: "Access denied",
    });
    const shared = service.subscribe({ projectIds: ["project-1"] });
    expect(joins()).toHaveLength(1);
    service.unsubscribe(first);
    service.unsubscribe(shared);
    service.subscribe({ projectIds: ["project-1"] });
    expect(joins()).toHaveLength(2);
    service.disconnect();
  });

  it("should use default handler when none provided", () => {
    const loggerSpy = vi
      .spyOn(logger, "warn")
      .mockImplementation(() => undefined);

    const service = new WebSocketService();

    expect(service).toBeDefined();
    expect(loggerSpy).toHaveBeenCalledWith(
      "services_websockets",
      "[DEPRECATED] Creating WebSocketService without handler. This will be required in next version.",
    );

    loggerSpy.mockRestore();
  });

  it("routes authenticated message updates to the collection immediately, including empty changedFields", () => {
    const service = new WebSocketService(mockHandler);
    const handleEventSpy = vi.spyOn(mockHandler, "handleEvent");
    service.initialize({ userId: "test-user" });
    const listener = mockSocket.on.mock.calls.find(
      (call) => call[0] === "message.updated",
    )![1];
    const event: WebSocketMessageUpdatedEvent = {
      type: "message.updated",
      timestamp: new Date().toISOString(),
      organizationId: "org",
      projectId: "project",
      conversationId: "conversation",
      messageId: "message",
      changedFields: [],
    };
    listener(event);
    expect(handleEventSpy).not.toHaveBeenCalled();
    authenticateMockSocket();
    listener(event);
    listener({ ...event, messageId: "second-message" });
    expect(handleEventSpy).toHaveBeenCalledWith(event);
    expect(handleEventSpy).toHaveBeenCalledWith({
      ...event,
      messageId: "second-message",
    });
    service.disconnect();
  });

  it("should use injected handler for WebSocket events", () => {
    const service = new WebSocketService(mockHandler);
    const handleEventSpy = vi.spyOn(mockHandler, "handleEvent");

    // Initialize to set up event listeners
    service.initialize({ userId: "test-user" });
    authenticateMockSocket();

    // Simulate socket connection
    mockSocket.connected = true;

    // Find and call the conversation.updated event listener
    const conversationUpdatedCall = mockSocket.on.mock.calls.find(
      (call) => call[0] === "conversation.updated",
    );

    expect(conversationUpdatedCall).toBeDefined();

    const eventHandler = conversationUpdatedCall![1];
    const mockEvent: WebSocketConversationUpdatedEvent = {
      type: "conversation.updated",
      conversationId: "conv-123",
      organizationId: "org-456",
      projectId: "proj-789",
      timestamp: new Date().toISOString(),
      changedFields: ["status"],
      previousVersion: 1,
      newVersion: 2,
      changeType: "UPDATE",
    };

    // Call the event handler
    eventHandler(mockEvent);

    // Verify handler was called with correct event
    expect(handleEventSpy).toHaveBeenCalledWith({
      type: "conversation.updated",
      organizationId: "org-456",
      projectId: "proj-789",
      conversationId: "conv-123",
      timestamp: mockEvent.timestamp,
      previousVersion: 1,
      newVersion: 2,
      changeType: "UPDATE",
      lastModifiedBy: undefined,
      changedFields: ["status"],
    });
  });

  it("should route message.realtime events through handler and callbacks", () => {
    const service = new WebSocketService(mockHandler);
    const handleEventSpy = vi.spyOn(mockHandler, "handleEvent");
    const onMessageRealtime = vi.fn();

    service.subscribe({
      events: {
        onMessageRealtime,
      },
    });
    service.initialize({ userId: "test-user" });
    authenticateMockSocket();

    const realtimeCall = mockSocket.on.mock.calls.find(
      (call) => call[0] === "message.realtime",
    );
    expect(realtimeCall).toBeDefined();

    const realtimeHandler = realtimeCall![1];
    const event: WebSocketMessageRealtimeEvent = {
      type: "message.realtime",
      timestamp: new Date().toISOString(),
      organizationId: "org-1",
      projectId: "proj-1",
      conversationId: "conv-1",
      messageId: "msg-1",
      requestId: "req-1",
      sequence: 1,
      kind: "loading.update",
      source: "api",
      payload: {
        loadingText: "Working...",
      },
    };

    realtimeHandler(event);

    expect(handleEventSpy).toHaveBeenCalledWith(event);
    expect(onMessageRealtime).toHaveBeenCalledWith(event);
  });

  it("should subscribe to and dispatch Agent Session lifecycle events", () => {
    const service = new WebSocketService(mockHandler);
    const handleEventSpy = vi.spyOn(mockHandler, "handleEvent");
    const onAgentSessionStatusChanged = vi.fn();

    service.subscribe({
      projectIds: ["project-1"],
      events: { onAgentSessionStatusChanged },
    });
    service.initialize({ userId: "test-user" });
    mockSocket.connected = true;

    const authenticatedCall = mockSocket.on.mock.calls.find(
      (call) => call[0] === "authenticated",
    );
    expect(authenticatedCall).toBeDefined();
    authenticatedCall![1]({
      status: "success",
      connectionId: "connection-1",
      userId: "test-user",
      projectIds: ["project-1"],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
    });

    expect(mockSocket.emit).toHaveBeenCalledWith(
      "subscribe",
      expect.objectContaining({
        eventTypes: expect.arrayContaining([
          WebSocketSubscriptionRequestEventTypesEnum.AgentSessionCreated,
          WebSocketSubscriptionRequestEventTypesEnum.AgentSessionDeleted,
          WebSocketSubscriptionRequestEventTypesEnum.AgentSessionStatusChanged,
        ]),
        projectIds: [],
      }),
    );

    const statusChangedCall = mockSocket.on.mock.calls.find(
      (call) =>
        call[0] ===
        WebSocketSubscriptionRequestEventTypesEnum.AgentSessionStatusChanged,
    );
    expect(statusChangedCall).toBeDefined();

    const event: WebSocketAgentSessionStatusChangedEvent = {
      type: WebSocketSubscriptionRequestEventTypesEnum.AgentSessionStatusChanged,
      timestamp: new Date().toISOString(),
      organizationId: "org-1",
      projectId: "project-1",
      userId: "test-user",
      agentSessionId: "session-1",
      previousStatus: "IN_PROGRESS",
      newStatus: "COMPLETED",
    };
    statusChangedCall![1](event);

    expect(handleEventSpy).toHaveBeenCalledWith(event);
    expect(onAgentSessionStatusChanged).toHaveBeenCalledWith(event);
  });

  it("applies complete current-state events without invalidating Agent Session collections", () => {
    const queryClient = new QueryClient();
    mockHandler = new WebSocketHandler(mockStore, mockDebugger, queryClient);
    const service = new WebSocketService(mockHandler);
    const markAllStaleSpy = vi.spyOn(mockHandler, "markAllStale");
    const batchRequestSpy = vi.spyOn(dataClient, "request");
    service.subscribe({ projectIds: ["project-1"] });
    service.initialize({ userId: "test-user" });
    authenticateMockSocket();

    const eventHandler = mockSocket.on.mock.calls.find(
      (call) =>
        call[0] ===
        WebSocketSubscriptionRequestEventTypesEnum.AgentSessionCurrentStateChanged,
    )?.[1];
    expect(eventHandler).toBeDefined();

    const event: WebSocketAgentSessionCurrentStateChangedEvent = {
      type: WebSocketSubscriptionRequestEventTypesEnum.AgentSessionCurrentStateChanged,
      timestamp: "2026-08-07T00:00:00.000Z",
      organizationId: "organization-1",
      projectId: "project-1",
      agentSessionId: "session-1",
      currentState: "THINKING",
      revision: 4,
      transitionedAt: "2026-08-07T00:00:00.000Z",
    };
    eventHandler!(event);

    expect(
      queryClient.getQueryData(
        agentSessionKeys.currentState(
          "organization-1",
          "project-1",
          "session-1",
        ),
      ),
    ).toEqual({
      currentState: "THINKING",
      revision: 4,
      transitionedAt: "2026-08-07T00:00:00.000Z",
    });
    expect(markAllStaleSpy).not.toHaveBeenCalled();
    expect(batchRequestSpy).not.toHaveBeenCalled();
  });

  it("hydrates loaded Agent Session state after an authenticated project-room join", async () => {
    const service = new WebSocketService(mockHandler);
    const refreshSpy = vi
      .spyOn(mockHandler, "refreshLoadedAgentSessionCurrentStates")
      .mockResolvedValue();

    service.initialize({
      userId: "test-user",
      organizationId: "organization-1",
    });
    service.subscribe({ projectIds: ["project-1"] });
    authenticateMockSocket();
    const join = mockSocket.emit.mock.calls.find((call) => call[0] === "join");
    join![2]({ status: "success", projectId: "project-1" });

    await vi.waitFor(() => {
      expect(refreshSpy).toHaveBeenCalledWith("organization-1", "project-1");
    });
  });

  it("subscribes to eval progress and hands every event to the data layer", () => {
    const handleEventSpy = vi.spyOn(mockHandler, "handleEvent");
    const service = new WebSocketService(mockHandler);
    service.subscribe({ projectIds: ["project-1"], events: {} });
    service.initialize({ userId: "test-user" });
    mockSocket.connected = true;
    mockSocket.on.mock.calls.find((call) => call[0] === "authenticated")![1]({
      status: "success",
      connectionId: "connection-1",
      userId: "test-user",
      projectIds: ["project-1"],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
    });
    expect(mockSocket.emit).toHaveBeenCalledWith(
      "subscribe",
      expect.objectContaining({
        eventTypes: expect.arrayContaining([
          WebSocketSubscriptionRequestEventTypesEnum.EvalRunUpdated,
          WebSocketSubscriptionRequestEventTypesEnum.EvalAttemptUpdated,
        ]),
      }),
    );
    const listener = mockSocket.on.mock.calls.find(
      (call) =>
        call[0] ===
        WebSocketSubscriptionRequestEventTypesEnum.EvalAttemptUpdated,
    )![1];
    const event = (id: string) => ({
      id,
      type: WebSocketSubscriptionRequestEventTypesEnum.EvalAttemptUpdated,
      aggregateId: "run-1",
      payload: {},
    });
    listener(event("a"));
    listener(event("b"));
    expect(handleEventSpy.mock.calls.map(([value]) => value)).toEqual([
      event("a"),
      event("b"),
    ]);
  });

  it("subscribes to and dispatches proposal group lifecycle events", () => {
    const handleEventSpy = vi.spyOn(mockHandler, "handleEvent");
    const service = new WebSocketService(mockHandler);
    const onProposalGroupLifecycle = vi.fn();

    const subscriptionId = service.subscribe({
      projectIds: ["project-1"],
      events: { onProposalGroupLifecycle },
    });
    service.initialize({ userId: "test-user" });
    mockSocket.connected = true;

    const authenticatedCall = mockSocket.on.mock.calls.find(
      (call) => call[0] === "authenticated",
    );
    authenticatedCall![1]({
      status: "success",
      connectionId: "connection-1",
      userId: "test-user",
      projectIds: ["project-1"],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
    });
    expect(mockSocket.emit).toHaveBeenCalledWith(
      "subscribe",
      expect.objectContaining({
        eventTypes: expect.arrayContaining([
          WebSocketSubscriptionRequestEventTypesEnum.ProposalGroupLifecycle,
        ]),
      }),
    );

    const lifecycleCall = mockSocket.on.mock.calls.find(
      (call) =>
        call[0] ===
        WebSocketSubscriptionRequestEventTypesEnum.ProposalGroupLifecycle,
    );
    const event: WebSocketProposalGroupLifecycleEvent = {
      type: WebSocketSubscriptionRequestEventTypesEnum.ProposalGroupLifecycle,
      timestamp: "2026-07-27T00:00:00Z",
      organizationId: "org-1",
      projectId: "project-1",
      groupId: "group-1",
      revision: 5,
      changedMemberIds: new Set(["member-1"]),
    };
    lifecycleCall![1](event);
    expect(handleEventSpy).toHaveBeenCalledWith(event);
    expect(onProposalGroupLifecycle).toHaveBeenCalledWith(event);

    service.unsubscribe(subscriptionId);
    lifecycleCall![1](event);
    expect(onProposalGroupLifecycle).toHaveBeenCalledTimes(1);
  });

  it("dispatches every proposal group lifecycle event in a rapid cross-group burst", () => {
    const service = new WebSocketService(mockHandler);
    const onProposalGroupLifecycle = vi.fn();

    service.subscribe({
      projectIds: ["project-1"],
      events: { onProposalGroupLifecycle },
    });
    service.initialize({ userId: "test-user" });

    const lifecycleCall = mockSocket.on.mock.calls.find(
      (call) =>
        call[0] ===
        WebSocketSubscriptionRequestEventTypesEnum.ProposalGroupLifecycle,
    );
    const event: WebSocketProposalGroupLifecycleEvent = {
      type: WebSocketSubscriptionRequestEventTypesEnum.ProposalGroupLifecycle,
      timestamp: "2026-07-27T00:00:00Z",
      organizationId: "org-1",
      projectId: "project-1",
      groupId: "group-1",
      revision: 5,
      changedMemberIds: new Set(["member-1"]),
    };

    lifecycleCall![1](event);
    lifecycleCall![1]({ ...event, groupId: "group-2" });
    lifecycleCall![1]({ ...event, groupId: "group-3" });

    expect(
      onProposalGroupLifecycle.mock.calls.map(([value]) => value.groupId),
    ).toEqual(["group-1", "group-2", "group-3"]);
  });

  it("authenticates the browser against the selected organization before joining rooms", () => {
    const service = new WebSocketService(mockHandler);

    service.subscribe({ projectIds: ["project-private"] });
    service.initialize({
      userId: "test-user",
      organizationId: "organization-selected",
    });
    mockSocket.connected = true;

    const connectCall = mockSocket.on.mock.calls.find(
      (call) => call[0] === "connect",
    );
    expect(connectCall).toBeDefined();
    connectCall![1]();

    const authenticateCall = mockSocket.emit.mock.calls.find(
      (call) => call[0] === "authenticate",
    );
    expect(authenticateCall).toBeDefined();
    expect(authenticateCall![1]).toEqual(
      expect.objectContaining({
        organizationId: "organization-selected",
        clientType: "browser",
        projectIds: [],
      }),
    );
    expect(authenticateCall![1]).not.toHaveProperty("userId");
    expect(authenticateCall![1]).not.toHaveProperty("accessToken");
    expect(authenticateCall![1]).not.toHaveProperty("machineId");
    expect(authenticateCall![1]).not.toHaveProperty("machineCredential");
    expect(
      mockSocket.emit.mock.calls.filter((call) => call[0] === "join"),
    ).toHaveLength(0);

    const authenticatedCall = mockSocket.on.mock.calls.find(
      (call) => call[0] === "authenticated",
    );
    expect(authenticatedCall).toBeDefined();
    authenticatedCall![1]({
      status: "success",
      connectionId: "connection-1",
      userId: "test-user",
      organizationId: "organization-selected",
      projectIds: ["project-private"],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
    });

    expect(
      mockSocket.emit.mock.calls.filter((call) => call[0] === "join"),
    ).toEqual([
      ["join", { projectId: "project-private" }, expect.any(Function)],
    ]);
  });

  it("handles terminal authentication failure without showing a room denial", () => {
    const service = new WebSocketService(mockHandler);
    const toastSpy = vi
      .spyOn(ToastService, "error")
      .mockImplementation(() => undefined);

    service.initialize({ userId: "test-user" });
    const authenticatedCall = mockSocket.on.mock.calls.find(
      (call) => call[0] === "authenticated",
    );
    expect(authenticatedCall).toBeDefined();

    authenticatedCall![1]({
      status: "error",
      reason: "authentication_required",
      message: "Authentication required",
    });

    expect(service.getState()).toMatchObject({
      isConnected: false,
      isAuthenticated: false,
      connectionError: "Authentication failed",
    });
    expect(toastSpy).not.toHaveBeenCalled();
    toastSpy.mockRestore();
  });

  it("renews browser access once and reconnects after terminal live authentication", async () => {
    authServiceMocks.refreshAuthToken.mockResolvedValue({
      user: {
        id: "user-1",
        email: "test@example.com",
        name: "Test User",
        isActive: true,
        createdAt: "2026-07-31T00:00:00.000Z",
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
      accessToken: "renewed-access-token",
      expiresIn: 900,
    });
    const service = new WebSocketService(mockHandler);

    service.initialize({ userId: "test-user" });
    const authenticatedCall = mockSocket.on.mock.calls.find(
      (call) => call[0] === "authenticated",
    );
    expect(authenticatedCall).toBeDefined();

    authenticatedCall![1]({
      status: "error",
      reason: "authentication_required",
      message: "Authentication required",
    });

    await vi.waitFor(() => {
      expect(authServiceMocks.refreshAuthToken).toHaveBeenCalledOnce();
      expect(
        mockSocket.on.mock.calls.filter(([event]) => event === "connect"),
      ).toHaveLength(2);
    });
  });

  it("keeps the transport open and shows a generic initial room denial", () => {
    const service = new WebSocketService(mockHandler);
    const toastSpy = vi
      .spyOn(ToastService, "error")
      .mockImplementation(() => undefined);

    service.initialize({ userId: "test-user" });
    const authenticatedCall = mockSocket.on.mock.calls.find(
      (call) => call[0] === "authenticated",
    );
    expect(authenticatedCall).toBeDefined();

    authenticatedCall![1]({
      status: "error",
      reason: "access_denied",
      message: "Access denied",
    });

    expect(service.getState()).toMatchObject({
      isAuthenticated: false,
      connectionError: null,
    });
    expect(mockSocket.disconnect).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledWith(
      "You do not have access to this live workspace.",
      { toastId: "websocket-room-access-denied" },
    );
    toastSpy.mockRestore();
  });

  it("deduplicates generic subscription and room authorization errors", () => {
    const service = new WebSocketService(mockHandler);
    const toastSpy = vi
      .spyOn(ToastService, "error")
      .mockImplementation(() => undefined);

    service.initialize({ userId: "test-user" });
    const subscribedCall = mockSocket.on.mock.calls.find(
      (call) => call[0] === "subscribed",
    );
    service.subscribe({ projectIds: ["project-private"] });
    authenticateMockSocket();
    const joinedCall = mockSocket.emit.mock.calls.find(
      (call) => call[0] === "join",
    );
    subscribedCall![1]({
      status: "error",
      reason: "access_denied",
      message: "Access denied",
    });
    joinedCall![2]({
      status: "error",
      reason: "access_denied",
      message: "Access denied",
    });

    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy.mock.calls[0]?.[0]).toBe(
      "You do not have access to this live workspace.",
    );
    expect(toastSpy.mock.calls[0]?.[0]).not.toContain("project-private");
    toastSpy.mockRestore();
  });

  it("reauthenticates when the selected organization changes", () => {
    const service = new WebSocketService(mockHandler);
    service.subscribe({ projectIds: ["project-private"] });
    service.initialize({
      userId: "test-user",
      organizationId: "organization-a",
    });
    mockSocket.connected = true;

    const connectCall = mockSocket.on.mock.calls.find(
      (call) => call[0] === "connect",
    );
    connectCall![1]();
    const authenticatedCall = mockSocket.on.mock.calls.find(
      (call) => call[0] === "authenticated",
    );
    authenticatedCall![1]({
      status: "success",
      connectionId: "connection-1",
      userId: "test-user",
      organizationId: "organization-a",
      projectIds: ["project-private"],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
    });
    mockSocket.emit.mockClear();

    service.initialize({
      userId: "test-user",
      organizationId: "organization-b",
    });

    expect(mockSocket.disconnect).toHaveBeenCalledTimes(1);
  });

  it("does not deliver throttled events after authorization is cleared", () => {
    vi.useFakeTimers();
    try {
      const service = new WebSocketService(mockHandler);
      const onProjectUpdated = vi.fn();

      service.subscribe({ events: { onProjectUpdated } });
      service.initialize({ userId: "test-user" });
      authenticateMockSocket();

      const projectUpdatedCall = mockSocket.on.mock.calls.find(
        (call) => call[0] === "project.updated",
      );
      expect(projectUpdatedCall).toBeDefined();

      const event = {
        type: "project.updated",
        organizationId: "organization-1",
        projectId: "project-1",
        timestamp: new Date().toISOString(),
      };
      projectUpdatedCall![1](event);
      projectUpdatedCall![1](event);

      service.disconnect();
      vi.advanceTimersByTime(1200);

      expect(onProjectUpdated).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("acknowledges departure without restarting the connection", () => {
    const service = new WebSocketService(mockHandler);
    const subscriptionId = service.subscribe({
      projectIds: ["project-private"],
    });
    service.initialize({ userId: "test-user" });
    authenticateMockSocket();
    mockSocket.disconnect.mockClear();

    const join = mockSocket.emit.mock.calls.find((call) => call[0] === "join");
    join![2]({ status: "success", projectId: "project-private" });
    service.unsubscribe(subscriptionId);
    const leave = mockSocket.emit.mock.calls.find(
      (call) => call[0] === "leave",
    );
    expect(leave?.[1]).toEqual({
      roomType: "project",
      roomId: "project-private",
    });
    leave![2]({
      status: "success",
      roomType: "project",
      roomId: "project-private",
    });
    expect(mockSocket.disconnect).not.toHaveBeenCalled();
    service.disconnect();
  });

  it("should call handler markAllStale on reconnect but not on first connect", () => {
    const service = new WebSocketService(mockHandler);
    const markAllStaleSpy = vi.spyOn(mockHandler, "markAllStale");

    // Initialize to set up event listeners
    service.initialize({ userId: "test-user" });

    // Find the connect event listener
    const connectCall = mockSocket.on.mock.calls.find(
      (call) => call[0] === "connect",
    );

    expect(connectCall).toBeDefined();

    const connectHandler = connectCall![1];

    // First connect: no missed-event gap to recover from, so no invalidation
    connectHandler();
    expect(markAllStaleSpy).not.toHaveBeenCalled();

    // Second connect (reconnection): all collections must be invalidated
    connectHandler();
    expect(markAllStaleSpy).toHaveBeenCalledTimes(1);
  });

  it("should use same handler for all event types", () => {
    const service = new WebSocketService(mockHandler);
    const handleEventSpy = vi.spyOn(mockHandler, "handleEvent");

    // Initialize to set up event listeners
    service.initialize({ userId: "test-user" });
    authenticateMockSocket();

    // Test different event types
    const eventTypes = [
      "conversation.created",
      "conversation.updated",
      "conversation.status_changed",
      "initiative.created",
      "initiative.updated",
      "project.created",
      "project.updated",
    ];

    eventTypes.forEach((eventType) => {
      const eventCall = mockSocket.on.mock.calls.find(
        (call) => call[0] === eventType,
      );

      if (eventCall) {
        const eventHandler = eventCall[1];
        const mockEvent = {
          type: eventType,
          organizationId: "org-123",
          projectId: "proj-456",
          timestamp: new Date().toISOString(),
        };

        eventHandler(mockEvent);
      }
    });

    // Verify handler was called for each event (some events might not have handlers)
    expect(handleEventSpy.mock.calls.length).toBeGreaterThan(0);

    // All calls should be to the same handler instance
    handleEventSpy.mock.calls.forEach((call) => {
      expect(call[0]).toHaveProperty("type");
      expect(call[0]).toHaveProperty("organizationId", "org-123");
    });
  });

  it("should allow different services to use different handlers", () => {
    const store1 = createStore();
    const store2 = createStore();
    const handler1 = new WebSocketHandler(store1, createMockDebugger());
    const handler2 = new WebSocketHandler(store2, createMockDebugger());

    const service1 = new WebSocketService(handler1);
    const service2 = new WebSocketService(handler2);

    const handler1Spy = vi.spyOn(handler1, "handleEvent");
    const handler2Spy = vi.spyOn(handler2, "handleEvent");

    // Both services should be independent
    expect(service1).not.toBe(service2);

    // Initialize both services
    service1.initialize({ userId: "user-1" });
    service2.initialize({ userId: "user-2" });

    // Each service should use its own handler
    expect(handler1Spy).not.toHaveBeenCalled();
    expect(handler2Spy).not.toHaveBeenCalled();

    // When events are triggered, each service should use its own handler
    // This is more of a conceptual test - the actual event triggering would
    // happen through socket events in a real scenario
  });

  it("should properly clean up on disconnect", () => {
    const service = new WebSocketService(mockHandler);

    // Initialize service
    service.initialize({ userId: "test-user" });
    authenticateMockSocket();

    // Disconnect
    service.disconnect();

    // Verify socket disconnect was called
    expect(mockSocket.disconnect).toHaveBeenCalled();

    // Verify state is cleaned up
    const state = service.getState();
    expect(state.isConnected).toBe(false);
    expect(state.isAuthenticated).toBe(false);
    expect(state.connectionError).toBe(null);
  });

  it("should demonstrate the solution - handler and service share same store", () => {
    // This test shows how the solution works - when both handler and service
    // operate on the same store, WebSocket events can properly mark items stale
    const sharedStore = createStore();
    const sharedQueryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const messagesKey = messageKeys.list("org-456", "proj-123", "conv-shared");
    // Simulates a React hook having read the conversation's messages.
    sharedQueryClient.setQueryData(messagesKey, []);

    const sharedHandler = new WebSocketHandler(
      sharedStore,
      createMockDebugger(),
      sharedQueryClient,
    );
    const service = new WebSocketService(sharedHandler);
    service.initialize({ userId: "test-user" });

    sharedHandler.handleEvent({
      type: "conversation.updated",
      conversationId: "conv-shared",
      organizationId: "org-456",
      projectId: "proj-123",
      timestamp: new Date().toISOString(),
      changedFields: ["status"],
    } as any);

    expect(sharedQueryClient.getQueryState(messagesKey)?.isInvalidated).toBe(
      true,
    );

    // This demonstrates the fix - the same store is used by both
    // React hooks and WebSocket events, so state synchronization works!
  });
});
