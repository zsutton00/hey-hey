import {
  roomKey,
  selectRoomOperation,
  settleRoomOperation,
  type Room,
  type RoomKey,
  type RoomOperation,
} from "./webSocketRoomReconciliation";
import { io, type Socket } from "socket.io-client";
import throttle from "lodash/throttle.js";
import {
  WebSocketAuthRequestClientTypeEnum,
  WebSocketTerminalAuthenticationErrorResponseReasonEnum,
  WebSocketSubscriptionRequestEventTypesEnum,
  type WebSocketAuthRequest,
  type WebSocketAuthResponse,
  type WebSocketJoinRoomRequest,
  type WebSocketSubscribedResponse,
  type WebSocketInitiativeCreatedEvent,
  type WebSocketInitiativeUpdatedEvent,
  type WebSocketInitiativeStatusChangedEvent,
  type WebSocketConversationCreatedEvent,
  type WebSocketConversationUpdatedEvent,
  type WebSocketConversationStatusChangedEvent,
  type WebSocketMachineRepoBindingsEvent,
  type WebSocketMessageCreatedEvent,
  type WebSocketMessageRealtimeEvent,
  type WebSocketMessageUpdatedEvent,
  type WebSocketMessageDeletedEvent,
  type WebSocketProjectCreatedEvent,
  type WebSocketProjectUpdatedEvent,
  type WebSocketProjectStatusChangedEvent,
  type WebSocketDesignDocCreatedEvent,
  type WebSocketDesignDocUpdatedEvent,
  type WebSocketDesignDocStatusChangedEvent,
  type WebSocketSystemNotificationEvent,
  type WebSocketTaskCreatedEvent,
  type WebSocketTaskUpdatedEvent,
  type WebSocketTaskStatusChangedEvent,
  type WebSocketAgentSessionCreatedEvent,
  type WebSocketAgentSessionDeletedEvent,
  type WebSocketAgentSessionStatusChangedEvent,
  type WebSocketAgentSessionCurrentStateChangedEvent,
  type WebSocketAgentSessionContextSizeChangedEvent,
  type WebSocketAgentSessionOutputAttentionChangedEvent,
  type WebSocketConversationPhaseChangedEvent,
  type WebSocketProposalGroupLifecycleEvent,
  type EvalAttemptUpdatedEvent,
  type EvalRunUpdatedEvent,
} from "../api";
import { debugEventStore } from "../data/websockets/debug";
import type { WebSocketEvent as DebugWebSocketEvent } from "../data/websockets/debug";

import type { WebSocketHandler } from "../data/websockets/handler";
import { logger } from "../utils/logger";
import { ToastService } from "./toastService";
import { refreshAuthToken } from "./authService";

export interface WebSocketEvents {
  onOpenItemsRoomJoined?: (projectId: string) => void;
  onOpenItemsChanged?: (
    event: import("../api").WebSocketOpenItemsChangedEvent,
  ) => void;
  onMessageCreated?: (event: WebSocketMessageCreatedEvent) => void;
  onMessageUpdated?: (event: WebSocketMessageUpdatedEvent) => void;
  onMessageRealtime?: (event: WebSocketMessageRealtimeEvent) => void;
  onMessageDeleted?: (event: WebSocketMessageDeletedEvent) => void;
  onConversationCreated?: (event: WebSocketConversationCreatedEvent) => void;
  onConversationUpdated?: (event: WebSocketConversationUpdatedEvent) => void;
  onConversationStatusChanged?: (
    event: WebSocketConversationStatusChangedEvent,
  ) => void;
  onConversationPhaseChanged?: (
    event: WebSocketConversationPhaseChangedEvent,
  ) => void;
  onInitiativeCreated?: (event: WebSocketInitiativeCreatedEvent) => void;
  onInitiativeUpdated?: (event: WebSocketInitiativeUpdatedEvent) => void;
  onInitiativeStatusChanged?: (
    event: WebSocketInitiativeStatusChangedEvent,
  ) => void;
  onProjectCreated?: (event: WebSocketProjectCreatedEvent) => void;
  onProjectUpdated?: (event: WebSocketProjectUpdatedEvent) => void;
  onProjectStatusChanged?: (event: WebSocketProjectStatusChangedEvent) => void;
  onDesignDocCreated?: (event: WebSocketDesignDocCreatedEvent) => void;
  onDesignDocUpdated?: (event: WebSocketDesignDocUpdatedEvent) => void;
  onDesignDocStatusChanged?: (
    event: WebSocketDesignDocStatusChangedEvent,
  ) => void;
  onTaskCreated?: (event: WebSocketTaskCreatedEvent) => void;
  onTaskUpdated?: (event: WebSocketTaskUpdatedEvent) => void;
  onTaskStatusChanged?: (event: WebSocketTaskStatusChangedEvent) => void;
  onAgentSessionCreated?: (event: WebSocketAgentSessionCreatedEvent) => void;
  onAgentSessionDeleted?: (event: WebSocketAgentSessionDeletedEvent) => void;
  onAgentSessionStatusChanged?: (
    event: WebSocketAgentSessionStatusChangedEvent,
  ) => void;
  onSystemNotification?: (event: WebSocketSystemNotificationEvent) => void;
  onProposalGroupLifecycle?: (
    event: WebSocketProposalGroupLifecycleEvent,
  ) => void;
}

export interface WebSocketConfig {
  serverUrl?: string;
  userId?: string;
  organizationId?: string;
}

export interface SubscriptionConfig {
  openItemsProjectIds?: string[];
  projectIds?: string[];
  conversationIds?: string[];
  initiativeIds?: string[];
  designDocIds?: string[];
  events?: WebSocketEvents;
}

interface WebSocketState {
  isConnected: boolean;
  isAuthenticated: boolean;
  connectionError: string | null;
  userId?: string;
}

type EventHandler = (event: unknown) => void;
type SubscriptionId = string;

interface Subscription {
  id: SubscriptionId;
  config: SubscriptionConfig;
  handlers: Partial<WebSocketEvents>;
}

const ROOM_ACCESS_DENIED_MESSAGE =
  "You do not have access to this live workspace.";

const getRuntimeOrigin = (): string => {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }

  return "http://localhost:3000";
};

export class WebSocketService {
  private socket: Socket | null = null;
  private handler: WebSocketHandler;
  private state: WebSocketState = {
    isConnected: false,
    isAuthenticated: false,
    connectionError: null,
  };
  private config: WebSocketConfig = {};
  private subscriptions = new Map<SubscriptionId, Subscription>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private hasEverConnected = false;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private periodicPingInterval: ReturnType<typeof setInterval> | null = null;
  private performanceSnapshotInterval: ReturnType<typeof setInterval> | null =
    null;
  private stateListeners = new Set<(state: WebSocketState) => void>();
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private subscriptionHandlers = new Map<
    SubscriptionId,
    Map<string, EventHandler>
  >();
  // Throttled event dispatchers
  private throttledDispatchers = new Map<string, ReturnType<typeof throttle>>();

  private confirmedRooms = new Map<RoomKey, Room>();
  private deniedRooms = new Set<RoomKey>();
  private desiredRooms = new Map<RoomKey, Room>();
  private authorizationEpoch = 0;
  private operationSequence = 0;
  private pendingRoom:
    | {
        operation: RoomOperation;
        epoch: number;
        sequence: number;
        socket: Socket;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  private observedConversations = new Set<string>();
  private retiredRooms = new Set<RoomKey>();
  private hasShownRoomAccessDeniedToast = false;
  private hasAttemptedLiveAccessRenewal = false;

  // Performance tracking for debug events
  private connectionStartTime?: number;
  private performanceTracker = {
    messageProcessingTimes: [] as number[],
    connectionAttempts: [] as { timestamp: number; success: boolean }[],
    subscriptionCounts: new Map<string, number>(),
  };

  constructor(handler: WebSocketHandler) {
    this.handler = handler;
  }

  private logDebugEvent(
    type: string,
    eventName: string,
    data: unknown,
    metadata?: {
      success?: boolean;
      duration?: number;
      error?: string;
      subscriptionId?: string;
    },
  ): void {
    if (process.env.NODE_ENV !== "development") return;

    // Create event with custom debug type structure
    const debugEvent: DebugWebSocketEvent = {
      type: type,
      source: "WebSocketService",
      timestamp: new Date().toISOString(),
      data: {
        event: eventName,
        ...(typeof data === "object" && data !== null ? data : { data }),
      },
      metadata: {
        success: true,
        ...metadata,
      },
    };

    // Record the event for debugging tools
    debugEventStore.addEvent(debugEvent);
  }

  private logError(category: string, error: Error, context: unknown): void {
    if (process.env.NODE_ENV !== "development") return;

    this.logDebugEvent(
      "websocket_event",
      "error",
      {
        category,
        message: error.message,
        stack: error.stack,
        context,
      },
      {
        success: false,
        error: error.message,
      },
    );
  }

  private getAverageProcessingTime(): number {
    const times = this.performanceTracker.messageProcessingTimes;
    if (times.length === 0) return 0;
    return times.reduce((sum, time) => sum + time, 0) / times.length;
  }

  private logPerformanceSnapshot(): void {
    if (process.env.NODE_ENV !== "development") return;

    this.logDebugEvent("websocket_event", "performance_snapshot", {
      avgMessageProcessing: this.getAverageProcessingTime(),
      activeSubscriptions: this.subscriptions.size,
      connectionUptime: this.connectionStartTime
        ? Date.now() - this.connectionStartTime
        : 0,
      recentConnectionAttempts:
        this.performanceTracker.connectionAttempts.slice(-10),
      totalMessageProcessingTimes:
        this.performanceTracker.messageProcessingTimes.length,
    });
  }

  private createThrottledDispatcher(
    eventType: string,
  ): ReturnType<typeof throttle> {
    return throttle(
      (event: unknown) => {
        // The trailing edge can run after authentication has been revoked.
        // Re-check here so queued private events are never delivered after a
        // disconnect or failed re-authentication.
        if (!this.state.isAuthenticated) return;

        this.notifyEventHandlers(eventType, event);
      },
      1200,
      { leading: true, trailing: true },
    );
  }

  private notifyEventHandlers(eventType: string, event: unknown): void {
    const handlers = this.eventHandlers.get(eventType);
    logger.info(
      "services_websockets",
      `[WEBSOCKET SERVICE] Dispatching ${eventType}`,
      {
        eventType,
        handlerCount: handlers?.size || 0,
        event,
      },
    );
    if (!handlers) return;

    logger.info(
      "services_websockets",
      `[WEBSOCKET SERVICE] Calling ${handlers.size} handlers for ${eventType}`,
    );
    let handlerIndex = 0;
    handlers.forEach((handler) => {
      handlerIndex++;
      logger.info(
        "services_websockets",
        `[WEBSOCKET SERVICE] Calling handler ${handlerIndex}/${handlers.size} for ${eventType}`,
      );
      handler(event);
      logger.info(
        "services_websockets",
        `[WEBSOCKET SERVICE] Handler ${handlerIndex}/${handlers.size} completed for ${eventType}`,
      );
    });
  }

  private getThrottledDispatcher(
    eventType: string,
  ): ReturnType<typeof throttle> {
    if (!this.throttledDispatchers.has(eventType)) {
      this.throttledDispatchers.set(
        eventType,
        this.createThrottledDispatcher(eventType),
      );
    }
    return this.throttledDispatchers.get(eventType)!;
  }

  private dispatchEvent(eventType: string, event: unknown): void {
    if (!this.state.isAuthenticated) return;

    const dispatcher = this.getThrottledDispatcher(eventType);
    dispatcher(event);
  }

  private handleAuthorizedEvent<
    T extends Parameters<WebSocketHandler["handleEvent"]>[0],
  >(event: T): void {
    if (!this.state.isAuthenticated) return;

    const handler = this.handler;
    handler.handleEvent(event);
  }

  private addEventHandler(
    subscriptionId: SubscriptionId,
    eventType: string,
    handler: EventHandler,
  ): void {
    // Track subscription-specific handlers
    if (!this.subscriptionHandlers.has(subscriptionId)) {
      this.subscriptionHandlers.set(subscriptionId, new Map());
    }
    this.subscriptionHandlers.get(subscriptionId)!.set(eventType, handler);

    // Add to global event handlers for dispatch
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    this.eventHandlers.get(eventType)!.add(handler);
  }

  private removeEventHandler(eventType: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.eventHandlers.delete(eventType);
      }
    }
  }

  private removeSubscriptionHandlers(subscriptionId: SubscriptionId): void {
    const handlers = this.subscriptionHandlers.get(subscriptionId);
    if (handlers) {
      handlers.forEach((handler, eventType) => {
        const eventHandlers = this.eventHandlers.get(eventType);
        if (eventHandlers) {
          eventHandlers.delete(handler);
          if (eventHandlers.size === 0) {
            this.eventHandlers.delete(eventType);
            // Also clean up throttled dispatcher
            this.throttledDispatchers.delete(eventType);
          }
        }
      });
      this.subscriptionHandlers.delete(subscriptionId);
    }
  }

  private setState(newState: Partial<WebSocketState>): void {
    this.state = { ...this.state, ...newState };
    this.stateListeners.forEach((listener) => listener(this.state));
  }

  private clearAuthorizationState(): void {
    this.authorizationEpoch += 1;
    if (this.pendingRoom) clearTimeout(this.pendingRoom.timer);
    this.pendingRoom = undefined;
    this.confirmedRooms.clear();
    this.retiredRooms.clear();
    this.deniedRooms.clear();
    this.observedConversations.clear();
    this.handler.clearConversationPhases();
    this.throttledDispatchers.forEach((dispatcher) => dispatcher.cancel());
  }

  private updateDesiredRooms(): void {
    const desired = new Map<RoomKey, Room>();
    const fields = {
      project: "projectIds",
      conversation: "conversationIds",
      initiative: "initiativeIds",
      design_doc: "designDocIds",
      open_items: "openItemsProjectIds",
    } as const;
    for (const subscription of this.subscriptions.values()) {
      for (const type of Object.keys(fields) as Array<keyof typeof fields>) {
        for (const id of subscription.config[fields[type]] ?? []) {
          const room = { roomType: type, roomId: id };
          desired.set(roomKey(room), room);
        }
      }
    }
    for (const [key, room] of this.desiredRooms) {
      if (!desired.has(key)) {
        this.deniedRooms.delete(key);
        if (
          this.pendingRoom?.operation.kind === "join" &&
          roomKey(this.pendingRoom.operation.room) === key
        )
          this.retiredRooms.add(key);
        if (room.roomType === "conversation") {
          this.observedConversations.delete(room.roomId);
          this.handler.clearConversationPhases([room.roomId]);
          this.throttledDispatchers.get("onConversationPhaseChanged")?.cancel();
        }
      }
    }
    this.desiredRooms = desired;
    this.reconcileRooms();
  }

  private reconcileRooms(): void {
    const socket = this.socket;
    if (!socket?.connected || !this.state.isAuthenticated || this.pendingRoom)
      return;
    const desired = new Map(this.desiredRooms);
    for (const key of this.retiredRooms) desired.delete(key);
    const operation = selectRoomOperation(
      desired,
      this.confirmedRooms,
      this.deniedRooms,
    );
    if (!operation) return;
    const pending = {
      operation,
      socket,
      epoch: this.authorizationEpoch,
      sequence: ++this.operationSequence,
      timer: setTimeout(() => {
        if (this.pendingRoom === pending) this.restartConnection();
      }, 10000),
    };
    this.pendingRoom = pending;
    // Authoritative replay may arrive before its join acknowledgement.
    if (
      operation.room.roomType === "conversation" &&
      operation.kind === "join"
    ) {
      this.observedConversations.add(operation.room.roomId);
    }
    const acknowledge = (response: unknown) => {
      if (
        this.pendingRoom !== pending ||
        this.socket !== socket ||
        pending.epoch !== this.authorizationEpoch
      )
        return;
      this.settleRoomResponse(operation, response);
    };
    if (operation.kind === "leave")
      socket.emit("leave", operation.room, acknowledge);
    else {
      const fields = {
        project: "projectId",
        conversation: "conversationId",
        initiative: "initiativeId",
        design_doc: "designDocId",
        open_items: "openItemsProjectId",
      } as const;
      const request: WebSocketJoinRoomRequest = {
        [fields[operation.room.roomType]]: operation.room.roomId,
      };
      socket.emit("join", request, acknowledge);
    }
  }

  private settleRoomResponse(
    operation: RoomOperation,
    response: unknown,
  ): void {
    if (!response || typeof response !== "object" || !("status" in response)) {
      this.restartConnection();
      return;
    }
    if (
      response.status === "error" &&
      operation.kind === "join" &&
      "reason" in response &&
      response.reason === "access_denied" &&
      "message" in response &&
      response.message === "Access denied" &&
      Object.keys(response).length === 3
    ) {
      const retired = this.retiredRooms.delete(roomKey(operation.room));
      if (!retired && this.desiredRooms.has(roomKey(operation.room)))
        this.deniedRooms.add(roomKey(operation.room));
      if (operation.room.roomType === "conversation") {
        this.observedConversations.delete(operation.room.roomId);
        this.handler.clearConversationPhases([operation.room.roomId]);
      }
      this.showRoomAccessDenied();
    } else if (
      response.status === "success" &&
      this.matchesRoomResponse(operation, response)
    ) {
      this.confirmedRooms = settleRoomOperation(this.confirmedRooms, operation);
      if (operation.kind === "leave")
        this.retiredRooms.delete(roomKey(operation.room));
      if (operation.kind === "join") {
        this.refreshJoinedProject(operation.room);
        if (operation.room.roomType === "open_items")
          this.dispatchEvent("onOpenItemsRoomJoined", operation.room.roomId);
      }
    } else {
      this.restartConnection();
      return;
    }
    if (this.pendingRoom) clearTimeout(this.pendingRoom.timer);
    this.pendingRoom = undefined;
    this.reconcileRooms();
  }

  private matchesRoomResponse(
    operation: RoomOperation,
    response: object,
  ): boolean {
    if (operation.kind === "leave")
      return (
        Object.keys(response).length === 3 &&
        "roomType" in response &&
        "roomId" in response &&
        response.roomType === operation.room.roomType &&
        response.roomId === operation.room.roomId
      );
    const fields = {
      project: "projectId",
      conversation: "conversationId",
      initiative: "initiativeId",
      design_doc: "designDocId",
      open_items: "openItemsProjectId",
    } as const;
    const field = fields[operation.room.roomType];
    return (
      Object.entries(response).filter(
        ([key, value]) => key !== "status" && value !== undefined,
      ).length === 1 &&
      Object.entries(response).some(
        ([key, value]) => key === field && value === operation.room.roomId,
      )
    );
  }

  private showRoomAccessDenied(): void {
    if (this.hasShownRoomAccessDeniedToast) return;

    this.hasShownRoomAccessDeniedToast = true;
    ToastService.error(ROOM_ACCESS_DENIED_MESSAGE, {
      toastId: "websocket-room-access-denied",
    });
  }

  private handleSubscriptionResponse(
    response: WebSocketSubscribedResponse,
  ): void {
    if (response.status === "success") {
      this.logDebugEvent(
        "websocket_event",
        "subscription_success",
        { eventTypes: response.eventTypes.length },
        { success: true },
      );
      return;
    }

    if (response.reason === "access_denied") {
      this.showRoomAccessDenied();
    }

    this.logDebugEvent(
      "websocket_event",
      "subscription_failed",
      { reason: response.reason },
      { success: false, error: "Subscription failed" },
    );
  }

  private refreshJoinedProject(room: Room): void {
    const organizationId = this.config.organizationId;
    if (room.roomType !== "project" || !organizationId) return;
    void Promise.all([
      this.handler.refreshLoadedAgentSessionCurrentStates(
        organizationId,
        room.roomId,
      ),
      this.handler.refreshLoadedAgentSessionOutputAttention(
        organizationId,
        room.roomId,
      ),
    ]).catch((error: unknown) => {
      logger.warn(
        "services_websockets",
        "Agent Session refresh failed after room join",
        { error },
      );
    });
  }

  private logCurrentSubscriptions(
    action: string,
    subscriptionId?: string,
  ): void {
    const allProjectIds = new Set<string>();
    const allConversationIds = new Set<string>();
    const allInitiativeIds = new Set<string>();
    const allDesignDocIds = new Set<string>();

    // Collect all unique IDs from all subscriptions
    this.subscriptions.forEach((subscription) => {
      subscription.config.projectIds?.forEach((id) => allProjectIds.add(id));
      subscription.config.conversationIds?.forEach((id) =>
        allConversationIds.add(id),
      );
      subscription.config.initiativeIds?.forEach((id) =>
        allInitiativeIds.add(id),
      );
      subscription.config.designDocIds?.forEach((id) =>
        allDesignDocIds.add(id),
      );
    });

    const activeSubscriptions = Array.from(this.subscriptions.keys());

    logger.info(
      "services_websockets",
      `[logCurrentSubscriptions] ${action} Current WebSocket Subscriptions:`,
      {
        action,
        subscriptionId: subscriptionId || "N/A",
        totalSubscriptions: this.subscriptions.size,
        activeSubscriptionIds: activeSubscriptions,
        channels: {
          projects: Array.from(allProjectIds),
          conversations: Array.from(allConversationIds),
          initiatives: Array.from(allInitiativeIds),
          designDocs: Array.from(allDesignDocIds),
        },
        channelCounts: {
          projects: allProjectIds.size,
          conversations: allConversationIds.size,
          initiatives: allInitiativeIds.size,
          designDocs: allDesignDocIds.size,
        },
      },
    );
  }

  private connect(): void {
    if (this.socket?.connected) {
      return;
    }

    // A failed or superseded socket can still be present while a reconnect is
    // being scheduled. Dispose of it before creating the replacement so its
    // callbacks cannot act on the replacement connection's authorization
    // state.
    if (this.socket) {
      const previousSocket = this.socket;
      this.socket = null;
      previousSocket.disconnect();
    }

    const serverUrl =
      this.config.serverUrl ||
      (process.env.NODE_ENV === "development"
        ? "http://localhost:3000"
        : getRuntimeOrigin());

    logger.info("services_websockets", "Connecting to WebSocket", {
      serverUrl,
    });

    // Log connection attempt
    this.logDebugEvent("websocket_event", "connection_attempt", {
      serverUrl,
      userId: this.config.userId,
    });

    this.connectionStartTime = Date.now();

    // Track connection attempt
    this.performanceTracker.connectionAttempts.push({
      timestamp: Date.now(),
      success: false, // Will be updated on success
    });

    this.socket = io(`${serverUrl}/events`, {
      transports: ["websocket"],
      autoConnect: true,
      reconnection: false, // Manual reconnection
      withCredentials: true,
    });

    this.setupSocketEventListeners();
  }

  private setupSocketEventListeners(): void {
    const socket = this.socket;
    if (!socket) return;

    // Connection events
    socket.on("connect", () => {
      if (this.socket !== socket) return;

      logger.info("services_websockets", "WebSocket connected");

      // Log successful connection
      this.logDebugEvent(
        "websocket_event",
        "connected",
        {
          socketId: this.socket?.id,
          serverUrl:
            this.config.serverUrl ||
            (process.env.NODE_ENV === "development" ||
            process.env.NODE_ENV === "test"
              ? "http://localhost:3000"
              : getRuntimeOrigin()),
          connectionDuration: this.connectionStartTime
            ? Date.now() - this.connectionStartTime
            : 0,
        },
        { success: true },
      );

      // Update last connection attempt as successful
      const lastAttempt =
        this.performanceTracker.connectionAttempts[
          this.performanceTracker.connectionAttempts.length - 1
        ];
      if (lastAttempt) {
        lastAttempt.success = true;
      }

      this.setState({
        isConnected: true,
        connectionError: null,
      });
      this.reconnectAttempts = 0;

      // Mark all data as stale on RE-connection only, to refetch whatever the
      // missed events would have invalidated. On the first connect there is no
      // event gap to recover from — invalidating there refetches everything the
      // initial page load just fetched.
      if (this.hasEverConnected) {
        logger.info(
          "services_websockets",
          "WebSocket reconnected - marking all collections stale",
        );

        this.handler.markAllStale();
      }
      this.hasEverConnected = true;

      if (this.config.userId) {
        this.authenticate();
      }
    });

    socket.on("disconnect", (reason: string) => {
      if (this.socket !== socket) return;

      this.socket = null;
      logger.info("services_websockets", "WebSocket disconnected", { reason });
      ToastService.debug(`WebSocket disconnected ${reason}`, {
        autoClose: false,
      });

      // Log disconnection
      this.logDebugEvent("websocket_event", "disconnected", {
        reason,
        wasAuthenticated: this.state.isAuthenticated,
      });

      this.setState({
        isConnected: false,
        isAuthenticated: false,
      });
      this.clearAuthorizationState();

      if (
        reason !== "io client disconnect" &&
        this.reconnectAttempts < this.maxReconnectAttempts
      ) {
        this.scheduleReconnect();
      }
    });

    socket.on("connect_error", (error: Error) => {
      if (this.socket !== socket) return;

      logger.error("services_websockets", "WebSocket connection error", {
        error: error.message,
      });

      // Log connection error
      this.logDebugEvent(
        "websocket_event",
        "connection_failed",
        {
          error: error.message,
          attempts: this.reconnectAttempts,
        },
        { success: false, error: error.message },
      );

      this.setState({ connectionError: error.message });
      this.scheduleReconnect();
    });

    // Authentication response
    socket.on("authenticated", (response: WebSocketAuthResponse) => {
      if (this.socket !== socket) return;

      const isRoomAccessDenied =
        response.status === "error" &&
        Object.is(response.reason, "access_denied");
      const isTerminalAuthentication =
        response.status === "error" &&
        Object.is(
          response.reason,
          WebSocketTerminalAuthenticationErrorResponseReasonEnum.AuthenticationRequired,
        );

      if (response.status === "success") {
        this.hasAttemptedLiveAccessRenewal = false;
        logger.info(
          "services_websockets",
          "WebSocket authenticated successfully",
        );

        // Log successful authentication
        this.logDebugEvent(
          "websocket_event",
          "auth_success",
          {
            userId: this.config.userId,
          },
          { success: true },
        );

        this.setState({
          isAuthenticated: true,
          connectionError: null,
        });
        this.logCurrentSubscriptions("AUTHENTICATION_SUCCESS", "auth_success");
        this.subscribeToAllEvents();
        this.reconcileRooms();
      } else {
        logger.error("services_websockets", "WebSocket authentication failed", {
          response,
        });

        // Log authentication failure
        this.logDebugEvent(
          "websocket_event",
          "auth_failed",
          {
            userId: this.config.userId,
            reason: response.reason,
          },
          {
            success: false,
            error: isRoomAccessDenied
              ? "Room access denied"
              : "Authentication failed",
          },
        );

        this.clearAuthorizationState();
        this.setState({
          isAuthenticated: false,
          connectionError: isRoomAccessDenied ? null : "Authentication failed",
        });

        if (isRoomAccessDenied) {
          this.showRoomAccessDenied();
        } else if (isTerminalAuthentication) {
          this.closeCurrentSocket();
          void this.recoverLiveAccess();
        } else {
          this.closeCurrentSocket();
        }
      }
    });

    socket.on("subscribed", (response: WebSocketSubscribedResponse) => {
      if (this.socket !== socket) return;

      this.handleSubscriptionResponse(response);
    });

    // Event listeners
    socket.on(
      WebSocketSubscriptionRequestEventTypesEnum.MessageCreated,
      (event: WebSocketMessageCreatedEvent) => {
        const startTime = performance.now();
        try {
          logger.info("services_websockets", "Message created event", {
            event,
          });

          // Log message received
          const processingTime = performance.now() - startTime;

          // Track processing time
          this.performanceTracker.messageProcessingTimes.push(processingTime);
          // Keep only recent times (last 100)
          if (this.performanceTracker.messageProcessingTimes.length > 100) {
            this.performanceTracker.messageProcessingTimes.shift();
          }

          this.logDebugEvent(
            "websocket_event",
            "message_received",
            {
              eventType: "message.created",
              dataSize: JSON.stringify(event).length,
              messageId: event.messageId,
              conversationId: event.conversationId,
            },
            {
              success: true,
              duration: processingTime,
            },
          );

          this.dispatchEvent("onMessageCreated", event);
        } catch (error) {
          this.logError("message_processing", error as Error, {
            eventType: "message.created",
            messageId: event.messageId,
          });
        }
      },
    );

    socket.on(
      WebSocketSubscriptionRequestEventTypesEnum.MessageUpdated,
      (event: WebSocketMessageUpdatedEvent) => {
        const startTime = performance.now();
        try {
          logger.info("services_websockets", "Message updated event", {
            event,
          });

          // Log message received
          const processingTime = performance.now() - startTime;
          this.logDebugEvent(
            "websocket_event",
            "message_received",
            {
              eventType: "message.updated",
              dataSize: JSON.stringify(event).length,
              messageId: event.messageId,
              conversationId: event.conversationId,
            },
            {
              success: true,
              duration: processingTime,
            },
          );

          // Canonical collection invalidation must not wait for a later
          // conversation event or the throttled subscriber callbacks.
          this.handleAuthorizedEvent(event);
          this.dispatchEvent("onMessageUpdated", event);
        } catch (error) {
          this.logError("message_processing", error as Error, {
            eventType: "message.updated",
            messageId: event.messageId,
          });
        }
      },
    );

    socket.on(
      WebSocketSubscriptionRequestEventTypesEnum.MessageRealtime,
      (event: WebSocketMessageRealtimeEvent) => {
        const startTime = performance.now();
        try {
          logger.info("services_websockets", "Message realtime event", {
            event,
          });

          const processingTime = performance.now() - startTime;
          this.logDebugEvent(
            "websocket_event",
            "message_received",
            {
              eventType: "message.realtime",
              dataSize: JSON.stringify(event).length,
              messageId: event.messageId,
              conversationId: event.conversationId,
              sequence: event.sequence,
              kind: event.kind,
            },
            {
              success: true,
              duration: processingTime,
            },
          );

          this.handleAuthorizedEvent(event);
          this.dispatchEvent("onMessageRealtime", event);
        } catch (error) {
          this.logError("message_processing", error as Error, {
            eventType: "message.realtime",
            messageId: event.messageId,
          });
        }
      },
    );

    socket.on(
      WebSocketSubscriptionRequestEventTypesEnum.MessageDeleted,
      (event: WebSocketMessageDeletedEvent) => {
        const startTime = performance.now();
        try {
          logger.info("services_websockets", "Message deleted event", {
            event,
          });

          // Log message received
          const processingTime = performance.now() - startTime;
          this.logDebugEvent(
            "websocket_event",
            "message_received",
            {
              eventType: "message.deleted",
              dataSize: JSON.stringify(event).length,
              messageId: event.messageId,
              conversationId: event.conversationId,
            },
            {
              success: true,
              duration: processingTime,
            },
          );

          this.dispatchEvent("onMessageDeleted", event);
        } catch (error) {
          this.logError("message_processing", error as Error, {
            eventType: "message.deleted",
            messageId: event.messageId,
          });
        }
      },
    );

    socket.on(
      "conversation.created",
      (event: WebSocketConversationCreatedEvent) => {
        const startTime = performance.now();
        logger.info("services_websockets", "Conversation created event", {
          event,
        });

        // Log message received
        const processingTime = performance.now() - startTime;
        this.logDebugEvent(
          "websocket_event",
          "message_received",
          {
            eventType: "conversation.created",
            dataSize: JSON.stringify(event).length,
            conversationId: event.conversationId,
            projectId: event.projectId,
          },
          {
            success: true,
            duration: processingTime,
          },
        );

        this.handleAuthorizedEvent(event);
        this.dispatchEvent("onConversationCreated", event);
      },
    );

    socket.on(
      "conversation.updated",
      (event: WebSocketConversationUpdatedEvent) => {
        logger.info("services_websockets", "Conversation updated event", {
          event,
        });
        ToastService.debug(`Conversation Updated ${JSON.stringify(event)}`);
        this.handleAuthorizedEvent(event);
        this.dispatchEvent("onConversationUpdated", event);
      },
    );

    socket.on(
      "conversation.status_changed",
      (event: WebSocketConversationStatusChangedEvent) => {
        logger.info(
          "services_websockets",
          "Conversation status changed event",
          { event },
        );
        this.handleAuthorizedEvent(event);
        this.dispatchEvent("onConversationStatusChanged", event);
      },
    );

    // Repo-bindings fan-out is also room-based: a socket joined to
    // `conversation:${id}` receives the host machine's bindings on subscribe
    // and on every change, so remote devices can read them without a host-local
    // API call.
    socket.on(
      "machine.repo_bindings",
      (event: WebSocketMachineRepoBindingsEvent) => {
        this.handleAuthorizedEvent(event);
      },
    );

    socket.on(
      "initiative.created",
      (event: WebSocketInitiativeCreatedEvent) => {
        logger.info("services_websockets", "initiative.created", { event });
        this.handleAuthorizedEvent(event);
      },
    );

    socket.on(
      "initiative.updated",
      (event: WebSocketInitiativeUpdatedEvent) => {
        logger.info("services_websockets", "initiative.updated", { event });
        this.handleAuthorizedEvent(event);
      },
    );

    socket.on(
      "initiative.status_changed",
      (event: WebSocketInitiativeStatusChangedEvent) => {
        this.handleAuthorizedEvent({
          type: "initiative.updated", // Status change is treated as update
          organizationId: event.organizationId,
          projectId: event.projectId ?? undefined,
          initiativeId: event.initiativeId,
          timestamp: event.timestamp,
          // Status changes can be treated as a special case of field changes
          changedFields: ["status"],
          changedBy: { userId: event.userId },
        });
      },
    );

    socket.on(
      "open_items.changed",
      (event: import("../api").WebSocketOpenItemsChangedEvent) => {
        this.dispatchEvent("onOpenItemsChanged", event);
      },
    );

    // Project event handlers
    socket.on("project.created", (event: WebSocketProjectCreatedEvent) => {
      logger.info("services_websockets", "project.created", { event });
      this.handleAuthorizedEvent(event);
      this.dispatchEvent("onProjectCreated", event);
    });

    socket.on("project.updated", (event: WebSocketProjectUpdatedEvent) => {
      logger.info("services_websockets", "project.updated", { event });
      this.handleAuthorizedEvent(event);
      this.dispatchEvent("onProjectUpdated", event);
    });

    socket.on(
      "project.status_changed",
      (event: WebSocketProjectStatusChangedEvent) => {
        logger.info("services_websockets", "project.status_changed", { event });
        this.handleAuthorizedEvent(event);
        this.dispatchEvent("onProjectStatusChanged", event);
      },
    );

    // Design doc event handlers
    socket.on("design_doc.created", (event: WebSocketDesignDocCreatedEvent) => {
      logger.info("services_websockets", "design_doc.created", { event });
      this.handleAuthorizedEvent(event);
      this.dispatchEvent("onDesignDocCreated", event);
    });

    socket.on("design_doc.updated", (event: WebSocketDesignDocUpdatedEvent) => {
      logger.info("services_websockets", "design_doc.updated", { event });
      this.handleAuthorizedEvent(event);
      this.dispatchEvent("onDesignDocUpdated", event);
    });

    socket.on(
      "design_doc.status_changed",
      (event: WebSocketDesignDocStatusChangedEvent) => {
        logger.info("services_websockets", "design_doc.status_changed", {
          event,
        });
        this.handleAuthorizedEvent({
          type: "design_doc.updated", // Status change is treated as update
          organizationId: event.organizationId,
          projectId: event.projectId ?? undefined,
          designDocId: event.designDocId,
          timestamp: event.timestamp,
          // Status changes can be treated as a special case of field changes
          changedFields: ["status"],
          changedBy: { userId: event.userId },
        });
        this.dispatchEvent("onDesignDocStatusChanged", event);
      },
    );

    // Task event handlers
    socket.on("task.created", (event: WebSocketTaskCreatedEvent) => {
      logger.info("services_websockets", "task.created", { event });
      this.handleAuthorizedEvent(event);
      this.dispatchEvent("onTaskCreated", event);
    });

    socket.on("task.updated", (event: WebSocketTaskUpdatedEvent) => {
      logger.info("services_websockets", "task.updated", { event });
      this.handleAuthorizedEvent(event);
      this.dispatchEvent("onTaskUpdated", event);
    });

    socket.on("task.deleted", (event: unknown) => {
      logger.info("services_websockets", "task.deleted", { event });
      const taskEvent = event as {
        taskId: string;
        initiativeId?: string;
        organizationId: string;
        projectId?: string;
        timestamp: string;
      };
      this.handleAuthorizedEvent({
        type: "task.deleted",
        organizationId: taskEvent.organizationId,
        projectId: taskEvent.projectId ?? undefined,
        initiativeId: taskEvent.initiativeId,
        taskId: taskEvent.taskId,
        timestamp: taskEvent.timestamp,
      });
    });

    socket.on(
      "task.status_changed",
      (event: WebSocketTaskStatusChangedEvent) => {
        logger.info("services_websockets", "task.status_changed", { event });
        this.handleAuthorizedEvent({
          type: "task.updated", // Status change is treated as update
          organizationId: event.organizationId,
          projectId: event.projectId ?? undefined,
          initiativeId: event.initiativeId,
          taskId: event.taskId,
          timestamp: event.timestamp,
          // Status changes can be treated as a special case of field changes
          changedFields: ["status"],
          changedBy: { userId: event.userId },
        });
        this.dispatchEvent("onTaskStatusChanged", event);
      },
    );

    // Agent Session lifecycle events are invalidation signals. The handler
    // owns cache reconciliation and receives the generated event unchanged so
    // its payload cannot become a second source of state.
    socket.on(
      WebSocketSubscriptionRequestEventTypesEnum.AgentSessionCreated,
      (event: WebSocketAgentSessionCreatedEvent) => {
        logger.info("services_websockets", "agent_session.created", { event });
        this.handleAuthorizedEvent(event);
        this.dispatchEvent("onAgentSessionCreated", event);
      },
    );

    socket.on(
      WebSocketSubscriptionRequestEventTypesEnum.AgentSessionDeleted,
      (event: WebSocketAgentSessionDeletedEvent) => {
        logger.info("services_websockets", "agent_session.deleted", { event });
        this.handleAuthorizedEvent(event);
        this.dispatchEvent("onAgentSessionDeleted", event);
      },
    );

    socket.on(
      WebSocketSubscriptionRequestEventTypesEnum.AgentSessionStatusChanged,
      (event: WebSocketAgentSessionStatusChangedEvent) => {
        logger.info("services_websockets", "agent_session.status_changed", {
          event,
        });
        this.handleAuthorizedEvent(event);
        this.dispatchEvent("onAgentSessionStatusChanged", event);
      },
    );

    socket.on(
      WebSocketSubscriptionRequestEventTypesEnum.AgentSessionCurrentStateChanged,
      (event: WebSocketAgentSessionCurrentStateChangedEvent) => {
        logger.info(
          "services_websockets",
          WebSocketSubscriptionRequestEventTypesEnum.AgentSessionCurrentStateChanged,
          { event },
        );
        this.handleAuthorizedEvent(event);
      },
    );

    socket.on(
      WebSocketSubscriptionRequestEventTypesEnum.AgentSessionContextSizeChanged,
      (event: WebSocketAgentSessionContextSizeChangedEvent) => {
        logger.info(
          "services_websockets",
          WebSocketSubscriptionRequestEventTypesEnum.AgentSessionContextSizeChanged,
          { event },
        );
        this.handleAuthorizedEvent(event);
      },
    );

    socket.on(
      WebSocketSubscriptionRequestEventTypesEnum.AgentSessionOutputAttentionChanged,
      (event: WebSocketAgentSessionOutputAttentionChangedEvent) => {
        logger.info(
          "services_websockets",
          WebSocketSubscriptionRequestEventTypesEnum.AgentSessionOutputAttentionChanged,
          { event },
        );
        this.handleAuthorizedEvent(event);
      },
    );

    socket.on(
      WebSocketSubscriptionRequestEventTypesEnum.ConversationPhaseChanged,
      (event: WebSocketConversationPhaseChangedEvent) => {
        if (
          this.socket !== socket ||
          !this.state.isAuthenticated ||
          !this.observedConversations.has(event.conversationId)
        )
          return;
        logger.info(
          "services_websockets",
          WebSocketSubscriptionRequestEventTypesEnum.ConversationPhaseChanged,
          { event },
        );
        this.handleAuthorizedEvent(event);
        this.dispatchEvent("onConversationPhaseChanged", event);
      },
    );

    socket.on(
      "system.notification",
      (event: WebSocketSystemNotificationEvent) => {
        logger.info("services_websockets", "System notification", { event });
        this.handleAuthorizedEvent(event);
        this.dispatchEvent("onSystemNotification", event);
      },
    );

    socket.on(
      WebSocketSubscriptionRequestEventTypesEnum.ProposalGroupLifecycle,
      (event: WebSocketProposalGroupLifecycleEvent) => {
        logger.info("services_websockets", "Proposal group lifecycle", {
          event,
        });
        // Lifecycle events are independently scoped by group. A global
        // event-type throttle can discard the middle event in a burst for
        // several groups, leaving that group's canonical review stale.
        this.handleAuthorizedEvent(event);
        this.notifyEventHandlers("onProposalGroupLifecycle", event);
      },
    );

    // Each event carries one run or attempt; throttling by type would drop
    // progress for other attempts in the same burst.
    socket.on(
      WebSocketSubscriptionRequestEventTypesEnum.EvalRunUpdated,
      (event: EvalRunUpdatedEvent) => this.handleAuthorizedEvent(event),
    );
    socket.on(
      WebSocketSubscriptionRequestEventTypesEnum.EvalAttemptUpdated,
      (event: EvalAttemptUpdatedEvent) => this.handleAuthorizedEvent(event),
    );

    socket.on("pong", (data: { timestamp: number }) => {
      logger.info("services_websockets", "Pong received", {
        timestamp: data.timestamp,
      });
    });
  }

  private authenticate(): void {
    if (!this.socket?.connected) {
      logger.warn(
        "services_websockets",
        "Cannot authenticate - socket not connected",
      );
      return;
    }

    this.setState({ isAuthenticated: false, connectionError: null });
    this.clearAuthorizationState();

    const authData: WebSocketAuthRequest = {
      ...(this.config.organizationId
        ? { organizationId: this.config.organizationId }
        : {}),
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
      clientType: WebSocketAuthRequestClientTypeEnum.Browser,
    };

    logger.info("services_websockets", "Authenticating WebSocket", {
      authData,
    });

    // Log authentication attempt
    this.logDebugEvent("websocket_event", "auth_attempt", {
      userId: this.config.userId,
    });

    this.socket.emit("authenticate", authData);

    // Log current subscriptions during authentication
    this.logCurrentSubscriptions("AUTHENTICATION", "auth_request");
  }

  private closeCurrentSocket(): void {
    const socket = this.socket;
    if (!socket) return;

    this.socket = null;
    this.setState({
      isConnected: false,
      isAuthenticated: false,
    });
    socket.disconnect();
  }

  private async recoverLiveAccess(): Promise<void> {
    if (this.hasAttemptedLiveAccessRenewal) {
      return;
    }

    this.hasAttemptedLiveAccessRenewal = true;

    try {
      await refreshAuthToken();
      if (this.config.userId && !this.socket) {
        this.connect();
      }
    } catch {
      // authService owns the terminal unauthenticated transition and clears
      // the shared in-memory browser access state.
    }
  }

  private restartConnection(): void {
    if (!this.config.userId) return;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.reconnectAttempts = 0;
    this.setState({
      isConnected: false,
      isAuthenticated: false,
      connectionError: null,
    });
    this.clearAuthorizationState();
    this.closeCurrentSocket();
    this.connect();
  }

  private subscribeToAllEvents(): void {
    if (!this.socket?.connected || !this.state.isAuthenticated) {
      logger.warn(
        "services_websockets",
        "Cannot subscribe - socket not connected",
      );
      return;
    }

    const eventTypes = [
      WebSocketSubscriptionRequestEventTypesEnum.MessageCreated,
      WebSocketSubscriptionRequestEventTypesEnum.MessageUpdated,
      WebSocketSubscriptionRequestEventTypesEnum.MessageRealtime,
      WebSocketSubscriptionRequestEventTypesEnum.MessageDeleted,
      WebSocketSubscriptionRequestEventTypesEnum.ConversationCreated,
      WebSocketSubscriptionRequestEventTypesEnum.ConversationUpdated,
      WebSocketSubscriptionRequestEventTypesEnum.ConversationStatusChanged,
      WebSocketSubscriptionRequestEventTypesEnum.ProjectCreated,
      WebSocketSubscriptionRequestEventTypesEnum.ProjectUpdated,
      WebSocketSubscriptionRequestEventTypesEnum.ProjectStatusChanged,
      WebSocketSubscriptionRequestEventTypesEnum.InitiativeCreated,
      WebSocketSubscriptionRequestEventTypesEnum.InitiativeUpdated,
      WebSocketSubscriptionRequestEventTypesEnum.InitiativeStatusChanged,
      WebSocketSubscriptionRequestEventTypesEnum.DesignDocCreated,
      WebSocketSubscriptionRequestEventTypesEnum.DesignDocUpdated,
      WebSocketSubscriptionRequestEventTypesEnum.DesignDocStatusChanged,
      WebSocketSubscriptionRequestEventTypesEnum.TaskCreated,
      WebSocketSubscriptionRequestEventTypesEnum.TaskUpdated,
      WebSocketSubscriptionRequestEventTypesEnum.TaskStatusChanged,
      WebSocketSubscriptionRequestEventTypesEnum.AgentSessionCreated,
      WebSocketSubscriptionRequestEventTypesEnum.AgentSessionDeleted,
      WebSocketSubscriptionRequestEventTypesEnum.AgentSessionStatusChanged,
      WebSocketSubscriptionRequestEventTypesEnum.AgentSessionCurrentStateChanged,
      WebSocketSubscriptionRequestEventTypesEnum.AgentSessionContextSizeChanged,
      WebSocketSubscriptionRequestEventTypesEnum.AgentSessionOutputAttentionChanged,
      WebSocketSubscriptionRequestEventTypesEnum.ConversationPhaseChanged,
      WebSocketSubscriptionRequestEventTypesEnum.ProposalGroupLifecycle,
      WebSocketSubscriptionRequestEventTypesEnum.EvalRunUpdated,
      WebSocketSubscriptionRequestEventTypesEnum.EvalAttemptUpdated,
      WebSocketSubscriptionRequestEventTypesEnum.SystemNotification,
    ];

    const subscriptionData = {
      eventTypes,
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
    };

    logger.info("services_websockets", "Subscribing to events", {
      subscriptionData,
    });
    this.socket.emit("subscribe", subscriptionData);

    // Log current subscriptions during event subscription
    this.logCurrentSubscriptions("EVENT_SUBSCRIPTION", "subscribe_request");
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectAttempts += 1;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    logger.info("services_websockets", "Scheduling reconnect attempt", {
      attempt: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
      delay,
    });

    // Log reconnection attempt
    this.logDebugEvent("websocket_event", "reconnection_attempt", {
      attempt: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
      delay,
    });

    this.reconnectTimeout = setTimeout(() => {
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.connect();
      } else {
        logger.error(
          "services_websockets",
          "Max reconnection attempts reached",
        );
        this.setState({
          connectionError: "Failed to reconnect after multiple attempts",
        });
      }
    }, delay);
  }

  // Public API
  initialize(config: WebSocketConfig): void {
    if (!config.userId) {
      this.config = config;
      this.clearAuthorizationState();
      this.closeCurrentSocket();
      this.setState({
        isConnected: false,
        isAuthenticated: false,
        connectionError: null,
      });
      return;
    }
    if (config.userId) {
      const configChanged =
        this.config.userId !== config.userId ||
        this.config.organizationId !== config.organizationId ||
        this.config.serverUrl !== config.serverUrl;
      const shouldReconnect = Boolean(this.socket && configChanged);

      this.config = config;
      logger.info(
        "services_websockets",
        "Initializing WebSocket service with config",
        { config },
      );
      this.logCurrentSubscriptions("SERVICE_INITIALIZED", "init");
      if (shouldReconnect) {
        this.hasShownRoomAccessDeniedToast = false;
        this.restartConnection();
      } else if (!this.socket?.connected) {
        this.connect();
      }
      this.setupPeriodicPing();
    }
  }

  private setupPeriodicPing(): void {
    if (this.periodicPingInterval || this.performanceSnapshotInterval) return;

    this.periodicPingInterval = setInterval(() => {
      if (this.socket?.connected) {
        this.socket.emit("ping");
      }
    }, 30000);

    // Log performance snapshot every 2 minutes
    this.performanceSnapshotInterval = setInterval(() => {
      if (this.socket?.connected && process.env.NODE_ENV === "development") {
        this.logPerformanceSnapshot();
      }
    }, 120000);
  }

  subscribe(config: SubscriptionConfig): SubscriptionId {
    const subscriptionId = `sub_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 11)}`;

    logger.info(
      "services_websockets",
      `[WEBSOCKET SERVICE] Creating subscription ${subscriptionId} - connection state`,
      {
        socketExists: !!this.socket,
        isConnected: this.state.isConnected,
        isAuthenticated: this.state.isAuthenticated,
        initiativeIds: config.initiativeIds,
        projectIds: config.projectIds,
        conversationIds: config.conversationIds,
      },
    );

    const subscription: Subscription = {
      id: subscriptionId,
      config,
      handlers: {},
    };

    // Register event handlers
    const events = config.events || {};
    logger.info(
      "services_websockets",
      `[WEBSOCKET SERVICE] Registering event handlers for subscription ${subscriptionId}`,
      {
        eventTypes: Object.keys(events),
        initiativeIds: config.initiativeIds,
        projectIds: config.projectIds,
        conversationIds: config.conversationIds,
      },
    );

    Object.entries(events).forEach(([eventType, handler]) => {
      if (handler) {
        logger.info(
          "services_websockets",
          `[WEBSOCKET SERVICE] Registering handler for ${eventType} in subscription ${subscriptionId}`,
        );
        subscription.handlers[eventType as keyof WebSocketEvents] = handler;
        this.addEventHandler(subscriptionId, eventType, handler);
      }
    });

    this.subscriptions.set(subscriptionId, subscription);

    // Log subscription creation
    this.logDebugEvent(
      "subscription_created",
      "subscription_created",
      {
        subscriptionId,
        projectIds: config.projectIds,
        conversationIds: config.conversationIds,
        initiativeIds: config.initiativeIds,
        eventTypes: Object.keys(config.events || {}),
      },
      { subscriptionId },
    );

    // Track subscription count
    this.performanceTracker.subscriptionCounts.set(subscriptionId, Date.now());

    // Log current subscriptions after adding
    this.logCurrentSubscriptions("SUBSCRIPTION_ADDED", subscriptionId);

    this.updateDesiredRooms();

    return subscriptionId;
  }

  unsubscribe(subscriptionId: SubscriptionId): void {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      logger.warn(
        "services_websockets",
        `Subscription ${subscriptionId} not found`,
      );
      return;
    }

    // Remove event handlers using the improved cleanup method
    this.removeSubscriptionHandlers(subscriptionId);

    this.subscriptions.delete(subscriptionId);

    this.updateDesiredRooms();

    // Calculate subscription duration
    const subscriptionStartTime =
      this.performanceTracker.subscriptionCounts.get(subscriptionId) ||
      Date.now();
    const subscriptionDuration = Date.now() - subscriptionStartTime;

    // Log subscription removal
    this.logDebugEvent(
      "subscription_removed",
      "subscription_removed",
      {
        subscriptionId,
        duration: subscriptionDuration,
      },
      { subscriptionId },
    );

    // Remove from tracking
    this.performanceTracker.subscriptionCounts.delete(subscriptionId);

    // Log current subscriptions after removal
    this.logCurrentSubscriptions("SUBSCRIPTION_REMOVED", subscriptionId);

    logger.info(
      "services_websockets",
      `Removed subscription ${subscriptionId}`,
    );
  }

  updateSubscription(
    subscriptionId: SubscriptionId,
    config: SubscriptionConfig,
  ): void {
    const existingSubscription = this.subscriptions.get(subscriptionId);
    if (!existingSubscription) {
      logger.warn(
        "services_websockets",
        `Subscription ${subscriptionId} not found for update`,
      );
      return;
    }

    // Remove old event handlers
    Object.entries(existingSubscription.handlers).forEach(
      ([eventType, handler]) => {
        if (handler) {
          this.removeEventHandler(eventType, handler as EventHandler);
        }
      },
    );

    // Update subscription
    existingSubscription.config = config;
    existingSubscription.handlers = {};

    // Register new event handlers
    const events = config.events || {};
    Object.entries(events).forEach(([eventType, handler]) => {
      if (handler) {
        existingSubscription.handlers[eventType as keyof WebSocketEvents] =
          handler;
        this.addEventHandler(subscriptionId, eventType, handler);
      }
    });

    // Log subscription update
    this.logDebugEvent(
      "subscription_updated",
      "subscription_updated",
      {
        subscriptionId,
        projectIds: config.projectIds,
        conversationIds: config.conversationIds,
        initiativeIds: config.initiativeIds,
        eventTypes: Object.keys(config.events || {}),
      },
      { subscriptionId },
    );

    // Log current subscriptions after update
    this.logCurrentSubscriptions("SUBSCRIPTION_UPDATED", subscriptionId);

    this.updateDesiredRooms();

    logger.info(
      "services_websockets",
      `Updated subscription ${subscriptionId}`,
      { config },
    );
  }

  // Room management
  // State management
  getState(): WebSocketState {
    return { ...this.state };
  }

  onStateChange(listener: (state: WebSocketState) => void): () => void {
    this.stateListeners.add(listener);

    return () => {
      this.stateListeners.delete(listener);
    };
  }

  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.periodicPingInterval) {
      clearInterval(this.periodicPingInterval);
      this.periodicPingInterval = null;
    }
    if (this.performanceSnapshotInterval) {
      clearInterval(this.performanceSnapshotInterval);
      this.performanceSnapshotInterval = null;
    }

    if (this.socket) {
      logger.info("services_websockets", "Disconnecting WebSocket");
      this.socket.disconnect();
      this.socket = null;
    }

    this.setState({
      isConnected: false,
      isAuthenticated: false,
      connectionError: null,
    });

    this.subscriptions.clear();
    this.desiredRooms.clear();
    this.eventHandlers.clear();
    this.subscriptionHandlers.clear();
    this.throttledDispatchers.clear();
    this.clearAuthorizationState();
    this.hasShownRoomAccessDeniedToast = false;
    this.hasAttemptedLiveAccessRenewal = false;
  }

  ping(): void {
    if (this.socket?.connected) {
      this.socket.emit("ping");
    }
  }
}
