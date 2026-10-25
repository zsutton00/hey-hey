import { invalidateProjectQueries } from "../query/projectOrganizationInvalidation";
import type {
  InvalidateQueryFilters,
  QueryClient,
  QueryKey as TanStackQueryKey,
} from "@tanstack/react-query";
import { createStore } from "jotai/vanilla";
import {
  WebSocketSubscriptionRequestEventTypesEnum,
  type EvalAttemptUpdatedEvent,
  type EvalRunUpdatedEvent,
  type WebSocketProposalGroupLifecycleEvent,
  type WebSocketProposalApprovedEvent,
  type WebSocketConversationCreatedEvent,
  type WebSocketConversationStatusChangedEvent,
  type WebSocketConversationUpdatedEvent,
  type WebSocketDesignDocCreatedEvent,
  type WebSocketDesignDocStatusChangedEvent,
  type WebSocketDesignDocUpdatedEvent,
  type WebSocketInitiativeCreatedEvent,
  type WebSocketInitiativeUpdatedEvent,
  type WebSocketMessageCreatedEvent,
  type WebSocketMessageDeletedEvent,
  type WebSocketMessageRealtimeEvent,
  type WebSocketMessageUpdatedEvent,
  type WebSocketProjectCreatedEvent,
  type WebSocketProjectStatusChangedEvent,
  type WebSocketProjectUpdatedEvent,
  type WebSocketMachineRepoBindingsEvent,
  type WebSocketAgentSessionCreatedEvent,
  type WebSocketAgentSessionDeletedEvent,
  type WebSocketAgentSessionStatusChangedEvent,
  type WebSocketAgentSessionCurrentStateChangedEvent,
  type WebSocketAgentSessionContextSizeChangedEvent,
  type WebSocketAgentSessionOutputAttentionChangedEvent,
  type WebSocketConversationPhaseChangedEvent,
  type WebSocketSystemNotificationEvent,
} from "../../api";
import { getCurrentUser } from "../../services/authService";
import logger from "../../utils/logger";
import {
  invalidateConversation,
  invalidateConversationLists,
} from "../collections/conversations";
import {
  invalidateConversationMessages,
  messageKeys,
} from "../collections/messages";
import {
  agentSessionKeys,
  invalidateAgentSessionDetail,
  invalidateAgentSessionFeeds,
  removeAgentSession,
} from "../collections/agentSessions";
import {
  writeAgentSessionContextSize,
  writeAgentSessionCurrentState,
  writeAgentSessionOutputAttention,
} from "../collections/agentSessionLiveState";
import {
  createInitiativeInvalidator,
  initiativeKeys,
} from "../collections/initiatives";
import { createServiceInvalidator } from "../collections/services";
import {
  createWorkItemInvalidator,
  invalidateWorkItemHolders,
  removeWorkItem,
} from "../collections/workItemLists";
import { isProposalGroupLifecycleEventForScope } from "../collections/proposalGroups";
import { proposalKeys } from "../collections/proposals";
import {
  applyEvalAttemptUpdated,
  applyEvalRunUpdated,
} from "../collections/evalRuns";
import {
  mapNotificationDto,
  notificationKeys,
  writeNotificationRecords,
} from "../collections/notifications";
import { invalidateWithFollowUpRead } from "../query/invalidateWithFollowUpRead";
import {
  invalidateAllDataLayerQueries,
  invalidateInitiativeChange,
  invalidateEditHistoryUpdated,
  invalidateProjectWorkItemQueries,
} from "../query/dataLayerInvalidation";
import {
  createDesignDocInvalidator,
  invalidateDesignDocQueries,
} from "../collections/designDocs";
import {
  DataEventType,
  emitDataEvent,
  getLoadedConfig,
  invalidateForEntity,
  type EntityOperation,
  type InvalidationContext,
} from "../relationships";
import { webSocketDebugger } from "./debug";
import {
  applyRealtimeEvent,
  messageRealtimeByConversationAtom,
} from "./messageRealtimeState";
import {
  applyConversationPhaseEntries,
  removeConversationPhases,
  conversationPhaseByIdAtom,
} from "./conversationPhase";
import { machineRepoBindingsByMachineAtom } from "./machineRepoBindingsState";

type Store = ReturnType<typeof createStore>;

type WebSocketEventUnion =
  | WebSocketProposalApprovedEvent
  | WebSocketProposalGroupLifecycleEvent
  | EvalRunUpdatedEvent
  | EvalAttemptUpdatedEvent
  | WebSocketConversationCreatedEvent
  | WebSocketConversationUpdatedEvent
  | WebSocketConversationStatusChangedEvent
  | WebSocketInitiativeCreatedEvent
  | WebSocketInitiativeUpdatedEvent
  | WebSocketDesignDocCreatedEvent
  | WebSocketDesignDocUpdatedEvent
  | WebSocketDesignDocStatusChangedEvent
  | WebSocketProjectCreatedEvent
  | WebSocketProjectUpdatedEvent
  | WebSocketProjectStatusChangedEvent
  | WebSocketMessageCreatedEvent
  | WebSocketMessageUpdatedEvent
  | WebSocketMessageRealtimeEvent
  | WebSocketMessageDeletedEvent
  | WebSocketAgentSessionCreatedEvent
  | WebSocketAgentSessionDeletedEvent
  | WebSocketAgentSessionStatusChangedEvent
  | {
      type: "daily_session.updated";
      timestamp: string;
      organizationId: string;
      projectId: string;
      sessionId: string;
      updateType: string;
    }
  | {
      type: "edit-history.updated";
      timestamp: string;
      organizationId: string;
      projectId?: string;
      initiativeId?: string;
    }
  | {
      type: "initiative.deleted";
      timestamp: string;
      organizationId: string;
      projectId?: string;
      id?: string;
    }
  | {
      type: "task.created";
      timestamp: string;
      organizationId: string;
      projectId?: string;
      initiativeId?: string;
      taskId: string;
    }
  | {
      type: "task.updated";
      timestamp: string;
      organizationId: string;
      projectId?: string;
      initiativeId?: string;
      taskId: string;
      changedFields?: string[];
      totalFieldsChanged?: number;
      changedBy?: { userId?: string; email?: string; name?: string };
    }
  | {
      type: "task.deleted";
      timestamp: string;
      organizationId: string;
      projectId?: string;
      initiativeId?: string;
      taskId: string;
    }
  | {
      type: "task.status_changed";
      timestamp: string;
      organizationId: string;
      projectId?: string;
      initiativeId?: string;
      taskId: string;
      previousStatus: string;
      newStatus: string;
    }
  | {
      type: "design_doc.created";
      timestamp: string;
      organizationId: string;
      projectId?: string;
      designDocId: string;
    }
  | {
      type: "design_doc.updated";
      timestamp: string;
      organizationId: string;
      projectId?: string;
      designDocId: string;
      changedFields?: string[];
      totalFieldsChanged?: number;
      changedBy?: { userId?: string; email?: string; name?: string };
    }
  | WebSocketAgentSessionCurrentStateChangedEvent
  | WebSocketAgentSessionContextSizeChangedEvent
  | WebSocketAgentSessionOutputAttentionChangedEvent
  | WebSocketConversationPhaseChangedEvent
  | WebSocketMachineRepoBindingsEvent
  | WebSocketSystemNotificationEvent;

export class WebSocketHandler {
  private store: Store;
  private debuggerInstance?: typeof webSocketDebugger;
  private queryClient: QueryClient;
  private authUnsubscribe?: () => void;

  constructor(
    store: Store, // REQUIRED - no default
    debuggerInstance: typeof webSocketDebugger | undefined,
    queryClient: QueryClient,
  ) {
    if (!store) {
      throw new Error("WebSocketHandler requires a store instance");
    }
    this.store = store;
    this.debuggerInstance = debuggerInstance;
    this.queryClient = queryClient;
  }

  private get debugger() {
    return this.debuggerInstance || webSocketDebugger;
  }

  // Cleanup method to unsubscribe from auth changes
  destroy() {
    if (this.authUnsubscribe) {
      this.authUnsubscribe();
      this.authUnsubscribe = undefined;
    }
  }

  /**
   * After joining a project room, events may have been missed: mounted
   * current-state reads in the project re-read through the paced batch.
   */
  refreshLoadedAgentSessionCurrentStates(
    organizationId: string,
    projectId: string,
  ): Promise<void> {
    return this.invalidateAgentSessionLiveState(
      organizationId,
      projectId,
      "currentState",
    );
  }

  /** As above, for mounted output-attention reads. */
  refreshLoadedAgentSessionOutputAttention(
    organizationId: string,
    projectId: string,
  ): Promise<void> {
    return this.invalidateAgentSessionLiveState(
      organizationId,
      projectId,
      "outputAttention",
    );
  }

  private invalidateAgentSessionLiveState(
    organizationId: string,
    projectId: string,
    dataset: "currentState" | "outputAttention",
  ): Promise<void> {
    // Keys are [root, org, project, "session", id, dataset].
    return invalidateWithFollowUpRead(this.queryClient, {
      queryKey: agentSessionKeys.project(organizationId, projectId),
      predicate: ({ queryKey }) => queryKey[5] === dataset,
    });
  }

  /** Conversation envelopes and the lists holding the conversation. */
  private invalidateConversation = (conversationId: string): void => {
    void invalidateConversation(this.queryClient, conversationId);
  };

  /** Invalidates a TanStack key prefix; only mounted queries re-read. */
  private invalidateQueryKey = (queryKey: TanStackQueryKey): void => {
    void this.queryClient.invalidateQueries({ queryKey });
  };

  private invalidateQueryFilters = (filters: InvalidateQueryFilters): void => {
    void invalidateWithFollowUpRead(this.queryClient, filters);
  };

  /**
   * Entries holding one work item (its single-item reads, and the lists and
   * hierarchies containing it), for changes to the item's own data.
   */
  private invalidateWorkItem = (
    organizationId: string,
    taskId: string,
  ): void => {
    void invalidateWorkItemHolders(this.queryClient, organizationId, taskId);
  };

  private invalidateProjectWorkItemQueries(
    organizationId: string,
    projectId: string | undefined,
    eventType: string,
    taskId: string,
  ): void {
    void invalidateProjectWorkItemQueries(
      this.queryClient,
      organizationId,
      projectId,
      taskId || undefined,
    );

    this.debugger.logQueryInvalidation(
      "workItemReferences",
      `${eventType}:${taskId}`,
      {
        eventType,
        reason:
          "Work-item lifecycle change, invalidating references, feature content and lists",
        organizationId,
        projectId,
        taskId,
      },
    );
  }

  /**
   * Translates a WebSocket update into the relationship-config-driven
   * `invalidateForEntity` dispatch. Each handler still emits its
   * hand-coded MARK_STALE dispatches for the entity's own collection;
   * this layers any additional cross-collection invalidations the loaded
   * `InvalidationConfig` declares (e.g. a Task update fanning out to
   * DesignDoc lists). It is intentionally additive — a missing config or
   * missing identifiers warn and bail rather than throw, so legacy
   * dispatches remain the source of truth until rules are loaded.
   */
  private dispatchRelationshipInvalidations(
    entityType: string,
    operation: EntityOperation,
    sourceEntity:
      | (Record<string, unknown> & {
          id?: string;
          organizationId?: string;
          projectId?: string;
          originatingProjectId?: string;
        })
      | undefined,
  ): void {
    if (!entityType) {
      logger.warn(
        "data_websockets",
        "[dispatchRelationshipInvalidations] Skipping: missing entityType",
        { entityType, sourceEntity },
      );
      return;
    }
    if (
      !sourceEntity ||
      typeof sourceEntity.id !== "string" ||
      !sourceEntity.id
    ) {
      logger.warn(
        "data_websockets",
        "[dispatchRelationshipInvalidations] Skipping: missing source entity id",
        { entityType, sourceEntity },
      );
      return;
    }
    if (getLoadedConfig() === null) {
      logger.warn(
        "data_websockets",
        "[dispatchRelationshipInvalidations] Skipping: relationship config not loaded",
        { entityType, operation },
      );
      return;
    }

    const stringValue = (value: unknown): string | undefined =>
      typeof value === "string" && value.length > 0 ? value : undefined;

    const orgId = stringValue(sourceEntity.organizationId) ?? "";
    const projectId =
      stringValue(sourceEntity.projectId) ??
      stringValue(sourceEntity.originatingProjectId);

    const context: InvalidationContext = {
      Initiative: createInitiativeInvalidator(
        orgId,
        projectId,
        this.invalidateQueryFilters,
        entityType === "Initiative"
          ? { projectId, initiativeId: sourceEntity.id }
          : undefined,
      ),
      // Task events already ran invalidateProjectWorkItemQueries.
      Task: createWorkItemInvalidator(
        orgId,
        projectId,
        this.invalidateQueryFilters,
        { listsInvalidated: entityType === "Task" },
      ),
      DesignDoc: createDesignDocInvalidator(
        orgId,
        projectId,
        this.invalidateQueryFilters,
      ),
      Service: createServiceInvalidator(orgId, this.invalidateQueryKey),
    };

    try {
      invalidateForEntity(entityType, operation, sourceEntity, context);
    } catch (error) {
      logger.warn(
        "data_websockets",
        "[dispatchRelationshipInvalidations] invalidateForEntity threw; skipping",
        {
          entityType,
          operation,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  handleEvent(event: WebSocketEventUnion) {
    const startTime = Date.now();

    // Debug logging
    this.debugger.logEvent({
      type: event.type as string,
      source: "websocket-handler",
      data: event,
      metadata: {
        success: true, // Will be updated if there's an error
      },
    });

    try {
      switch (event.type) {
        case "proposal.approved":
          this.invalidateQueryFilters({
            queryKey: event.projectId
              ? proposalKeys.project(event.organizationId, event.projectId)
              : [...proposalKeys.root(), event.organizationId],
          });
          break;
        case "proposal_group.lifecycle":
          this.invalidateQueryFilters({
            queryKey: proposalKeys.lists(event.organizationId, event.projectId),
          });
          this.invalidateQueryFilters({
            queryKey: proposalKeys.group(
              event.organizationId,
              event.projectId,
              event.groupId,
            ),
            exact: true,
            predicate: ({ queryKey }) => {
              const [, organizationId, projectId, , groupId] = queryKey;
              return (
                typeof organizationId === "string" &&
                typeof projectId === "string" &&
                typeof groupId === "string" &&
                isProposalGroupLifecycleEventForScope(event, {
                  organizationId,
                  projectId,
                  groupId,
                })
              );
            },
          });
          break;
        case "initiative.created":
          this.handleInitiativeCreated(event);
          break;
        case "initiative.updated":
          this.handleInitiativeUpdated(event);
          break;
        case "initiative.deleted":
          this.handleInitiativeDeleted(event);
          break;
        case "task.created":
          this.handleTaskCreated(event);
          break;
        case "task.updated":
          this.handleTaskUpdated(event);
          break;
        case "task.deleted":
          this.handleTaskDeleted(event);
          break;
        case "task.status_changed":
          this.handleTaskStatusChanged(event);
          break;
        case "edit-history.updated":
          this.handleEditHistoryUpdated(event);
          break;
        case "conversation.created":
          this.handleConversationCreated(event);
          break;
        case "conversation.updated":
        case "conversation.status_changed":
          this.handleConversationUpdated(event);
          break;
        case "message.updated":
          this.markConversationMessagesStale(event);
          break;
        case "message.created":
        case "message.deleted":
          this.markLatestMessageStale(event);
          break;
        case "message.realtime":
          this.handleMessageRealtime(event);
          break;
        case "agent_session.created":
          this.handleAgentSessionCreated(event);
          break;
        case "agent_session.deleted":
          this.handleAgentSessionDeleted(event);
          break;
        case "agent_session.status_changed":
          this.handleAgentSessionStatusChanged(event);
          break;
        case WebSocketSubscriptionRequestEventTypesEnum.DailySessionUpdated:
          this.handleDailySessionUpdated(event);
          break;
        case "project.created":
          this.handleProjectCreated(event);
          break;
        case "project.updated":
          this.handleProjectUpdated(event);
          break;
        case "project.status_changed":
          this.handleProjectStatusChanged(event);
          break;
        case "design_doc.created":
          this.handleDesignDocCreated(event);
          break;
        case "design_doc.status_changed":
        case "design_doc.updated":
          this.handleDesignDocUpdated(event);
          break;
        case WebSocketSubscriptionRequestEventTypesEnum.AgentSessionCurrentStateChanged:
          this.handleAgentSessionCurrentStateChanged(event);
          break;
        case WebSocketSubscriptionRequestEventTypesEnum.AgentSessionContextSizeChanged:
          this.handleAgentSessionContextSizeChanged(event);
          break;
        case WebSocketSubscriptionRequestEventTypesEnum.AgentSessionOutputAttentionChanged:
          this.handleAgentSessionOutputAttentionChanged(event);
          break;
        case WebSocketSubscriptionRequestEventTypesEnum.ConversationPhaseChanged:
          this.handleConversationPhaseChanged(event);
          break;
        case "machine.repo_bindings":
          this.handleMachineRepoBindings(event);
          break;
        case "system.notification":
          this.handleSystemNotification(event);
          break;
        case WebSocketSubscriptionRequestEventTypesEnum.EvalRunUpdated:
          void applyEvalRunUpdated(this.queryClient, event);
          break;
        case WebSocketSubscriptionRequestEventTypesEnum.EvalAttemptUpdated:
          void applyEvalAttemptUpdated(this.queryClient, event);
          break;
      }

      // Log successful processing
      const duration = Date.now() - startTime;
      this.debugger.logEvent({
        type: event.type,
        source: "websocket-handler-success",
        data: { originalEvent: event, duration },
        metadata: {
          success: true,
          duration,
        },
      });
    } catch (error) {
      // Log error
      const duration = Date.now() - startTime;
      this.debugger.logEvent({
        type: event.type,
        source: "websocket-handler-error",
        data: { originalEvent: event, error },
        metadata: {
          success: false,
          duration,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });

      // Re-throw to maintain error handling behavior
      throw error;
    }
  }

  private handleInitiativeCreated(event: WebSocketInitiativeCreatedEvent) {
    logger.info(
      "data_websockets",
      "[handleInitiativeCreated] Initiative created",
      { initiativeId: event.initiativeId },
    );

    void invalidateInitiativeChange(
      this.queryClient,
      event.organizationId,
      event.projectId,
      event.initiativeId,
    );

    this.debugger.logQueryInvalidation("initiatives", "new-item", {
      eventType: "initiative.created",
      reason: "New initiative created, invalidating list scopes",
      organizationId: event.organizationId,
      projectId: event.projectId,
    });
  }

  private handleInitiativeUpdated(event: WebSocketInitiativeUpdatedEvent) {
    if (!event.initiativeId) return;

    logger.info(
      "data_websockets",
      "[handleInitiativeUpdated] Initiative updated",
      {
        event,
        initiativeId: event.initiativeId,
        changedFields: event.changedFields,
      },
    );

    const currentUserId = getCurrentUser()?.id;

    // Skip updates from current user to avoid unnecessary UI refreshes
    if (currentUserId && event.changedBy?.userId === currentUserId) {
      logger.info(
        "data_websockets",
        `[handleInitiativeUpdated] Skipping initiative update from current user: ${event.initiativeId}`,
      );
      return;
    }

    const changedFields = event.changedFields || [];
    void invalidateInitiativeChange(
      this.queryClient,
      event.organizationId,
      event.projectId,
      event.initiativeId,
    );
    this.dispatchRelationshipInvalidations("Initiative", "update", {
      id: event.initiativeId,
      organizationId: event.organizationId,
      projectId: event.projectId,
      changedFields,
    });
  }

  private handleInitiativeDeleted(event: {
    type: "initiative.deleted";
    timestamp: string;
    organizationId: string;
    projectId?: string;
    id?: string;
  }) {
    if (!event.id) return;

    this.queryClient.setQueryData(
      initiativeKeys.detail(event.organizationId, event.id),
      null,
    );
    void invalidateInitiativeChange(
      this.queryClient,
      event.organizationId,
      event.projectId,
      event.id,
    );
  }

  private handleTaskCreated(event: {
    type: "task.created";
    timestamp: string;
    organizationId: string;
    projectId?: string;
    initiativeId?: string;
    taskId: string;
  }) {
    logger.info("data_websockets", "[handleTaskCreated] Task created", {
      initiativeId: event.initiativeId,
      taskId: event.taskId,
    });

    this.invalidateProjectWorkItemQueries(
      event.organizationId,
      event.projectId,
      event.type,
      event.taskId,
    );

    this.debugger.logQueryInvalidation("workItems", "new-item", {
      eventType: "task.created",
      reason: "New task created, invalidating project work-item lists",
      taskId: event.taskId,
      initiativeId: event.initiativeId,
    });
  }

  private handleTaskUpdated(event: {
    type: "task.updated";
    timestamp: string;
    organizationId: string;
    projectId?: string;
    initiativeId?: string;
    taskId: string;
    changedFields?: string[];
    totalFieldsChanged?: number;
    changedBy?: { userId?: string; email?: string; name?: string };
  }) {
    if (!event.taskId) return;

    const currentUserId = getCurrentUser()?.id;

    logger.info("data_websockets", "[handleTaskUpdated] Task updated", {
      event,
      taskId: event.taskId,
      initiativeId: event.initiativeId,
      changedFields: event.changedFields,
      currentUserId,
      changedBy: event.changedBy?.userId,
    });

    this.invalidateProjectWorkItemQueries(
      event.organizationId,
      event.projectId,
      event.type,
      event.taskId,
    );

    // Skip updates from current user to avoid unnecessary UI refreshes
    if (currentUserId && event.changedBy?.userId === currentUserId) {
      logger.info(
        "data_websockets",
        `[handleTaskUpdated] Skipping task update from current user: ${event.taskId}`,
      );
      return;
    }

    this.debugger.logQueryInvalidation("workItems", `item:${event.taskId}`, {
      eventType: "task.updated",
      reason: "Task updated, invalidating its reads and project lists",
      taskId: event.taskId,
      initiativeId: event.initiativeId,
      changedFields: event.changedFields,
      changedBy: event.changedBy?.email,
      timestamp: event.timestamp,
    });

    this.dispatchRelationshipInvalidations("Task", "update", {
      id: event.taskId,
      organizationId: event.organizationId,
      projectId: event.projectId,
      initiativeId: event.initiativeId,
      changedFields: event.changedFields,
    });
  }

  private handleTaskDeleted(event: {
    type: "task.deleted";
    timestamp: string;
    organizationId: string;
    projectId?: string;
    initiativeId?: string;
    taskId: string;
  }) {
    if (!event.taskId) return;

    logger.info("data_websockets", "[handleTaskDeleted] Task deleted", {
      initiativeId: event.initiativeId,
      taskId: event.taskId,
    });

    // Drop the item before invalidating so no read of it is restarted.
    if (event.projectId) {
      removeWorkItem(
        this.queryClient,
        event.organizationId,
        event.projectId,
        event.taskId,
      );
    }

    this.invalidateProjectWorkItemQueries(
      event.organizationId,
      event.projectId,
      event.type,
      event.taskId,
    );

    this.debugger.logQueryInvalidation("workItems", `deleted:${event.taskId}`, {
      eventType: "task.deleted",
      reason: "Task deleted, removing it from cached work-item reads",
      taskId: event.taskId,
      initiativeId: event.initiativeId,
    });
  }

  private handleTaskStatusChanged(event: {
    type: "task.status_changed";
    timestamp: string;
    organizationId: string;
    projectId?: string;
    initiativeId?: string;
    taskId: string;
    previousStatus: string;
    newStatus: string;
  }) {
    if (!event.taskId) return;

    logger.info(
      "data_websockets",
      "[handleTaskStatusChanged] Task status changed",
      {
        taskId: event.taskId,
        initiativeId: event.initiativeId,
        previousStatus: event.previousStatus,
        newStatus: event.newStatus,
      },
    );

    this.invalidateProjectWorkItemQueries(
      event.organizationId,
      event.projectId,
      event.type,
      event.taskId,
    );

    this.debugger.logQueryInvalidation("workItems", `item:${event.taskId}`, {
      eventType: "task.status_changed",
      reason: "Task status changed, invalidating its reads and project lists",
      taskId: event.taskId,
      initiativeId: event.initiativeId,
      previousStatus: event.previousStatus,
      newStatus: event.newStatus,
    });
  }

  private handleEditHistoryUpdated(event: {
    type: "edit-history.updated";
    timestamp: string;
    organizationId: string;
    projectId?: string;
    initiativeId?: string;
  }) {
    if (!event.initiativeId) return;

    void invalidateEditHistoryUpdated(this.queryClient, event);
  }

  private handleConversationCreated(event: WebSocketConversationCreatedEvent) {
    if (!event.projectId) return;

    logger.info(
      "data_websockets",
      "[handleConversationCreated] Conversation created",
      { conversationId: event.conversationId },
    );

    void invalidateConversationLists(
      this.queryClient,
      event.organizationId,
      event.projectId,
    );

    this.debugger.logQueryInvalidation("conversations", "new-item", {
      eventType: "conversation.created",
      reason: "New conversation created, invalidating list scopes",
      conversationId: event.conversationId,
      timestamp: event.timestamp,
    });
  }

  private handleAgentSessionCurrentStateChanged(
    event: WebSocketAgentSessionCurrentStateChangedEvent,
  ) {
    const queryClient = this.queryClient;
    writeAgentSessionCurrentState(
      queryClient,
      event.organizationId,
      event.projectId,
      event,
    );
  }

  private handleAgentSessionContextSizeChanged(
    event: WebSocketAgentSessionContextSizeChangedEvent,
  ) {
    const queryClient = this.queryClient;
    writeAgentSessionContextSize(
      queryClient,
      event.organizationId,
      event.projectId,
      event.agentSessionId,
      event.contextSize,
    );
  }

  private handleAgentSessionOutputAttentionChanged(
    event: WebSocketAgentSessionOutputAttentionChangedEvent,
  ) {
    const queryClient = this.queryClient;
    writeAgentSessionOutputAttention(
      queryClient,
      event.organizationId,
      event.projectId,
      event,
    );
  }

  clearConversationPhases(conversationIds?: readonly string[]): void {
    this.store.set(conversationPhaseByIdAtom, (current) =>
      conversationIds
        ? removeConversationPhases(current, new Set(conversationIds))
        : {},
    );
  }

  private handleConversationPhaseChanged(
    event: WebSocketConversationPhaseChangedEvent,
  ) {
    this.store.set(conversationPhaseByIdAtom, (current) =>
      applyConversationPhaseEntries(current, [event]),
    );
  }

  /**
   * The event carries the full notification: it is upserted by id into the
   * loaded lists for its user, then those lists re-read once so pagination
   * and ordering beyond the loaded page settle on the server's answer.
   */
  private handleSystemNotification(event: WebSocketSystemNotificationEvent) {
    const queryClient = this.queryClient;
    writeNotificationRecords(
      queryClient,
      event.organizationId,
      [mapNotificationDto(event.notification)],
      { userId: event.userId, channel: event.delivery?.channel },
    );
    void queryClient.invalidateQueries({
      queryKey: notificationKeys.lists(event.organizationId),
      predicate: ({ queryKey }) => {
        const listUserId = (
          queryKey[3] as { userId: string | null } | undefined
        )?.userId;
        return !listUserId || !event.userId || listUserId === event.userId;
      },
    });
  }

  private handleMachineRepoBindings(event: WebSocketMachineRepoBindingsEvent) {
    if (!event.machineId) return;

    const current = this.store.get(machineRepoBindingsByMachineAtom);
    this.store.set(machineRepoBindingsByMachineAtom, {
      ...current,
      [event.machineId]: event.bindings,
    });
  }

  private handleAgentSessionCreated(
    event: WebSocketAgentSessionCreatedEvent,
  ): void {
    const queryClient = this.queryClient;
    void invalidateAgentSessionDetail(
      queryClient,
      event.organizationId,
      event.projectId,
      event.agentSessionId,
    );
    void invalidateAgentSessionFeeds(
      queryClient,
      event.organizationId,
      event.projectId,
    );

    this.debugger.logQueryInvalidation(
      "agentSessions",
      `agent_session.created:${event.agentSessionId}`,
      {
        eventType: event.type,
        reason: "New agent session created, re-reading loaded lists and feeds",
        agentSessionId: event.agentSessionId,
        organizationId: event.organizationId,
        projectId: event.projectId,
      },
    );
  }

  private handleDailySessionUpdated(event: {
    type: "daily_session.updated";
    organizationId: string;
    projectId: string;
    sessionId: string;
  }): void {
    const queryClient = this.queryClient;
    void invalidateWithFollowUpRead(queryClient, {
      queryKey: agentSessionKeys.lists(event.organizationId, event.projectId),
    });

    this.debugger.logQueryInvalidation(
      "agentSessions",
      `daily_session.updated:${event.sessionId}`,
      {
        eventType: event.type,
        reason:
          "Daily Session state changed, re-reading loaded discovery lists",
        organizationId: event.organizationId,
        projectId: event.projectId,
      },
    );
  }

  private handleAgentSessionDeleted(
    event: WebSocketAgentSessionDeletedEvent,
  ): void {
    const queryClient = this.queryClient;
    void removeAgentSession(
      queryClient,
      event.organizationId,
      event.projectId,
      event.agentSessionId,
    );

    this.debugger.logQueryInvalidation(
      "agentSessions",
      `item:${event.agentSessionId}`,
      {
        eventType: event.type,
        reason:
          "Agent session deleted, removing its cached data and re-reading loaded lists",
        agentSessionId: event.agentSessionId,
      },
    );
  }

  private handleAgentSessionStatusChanged(
    event: WebSocketAgentSessionStatusChangedEvent,
  ): void {
    const queryClient = this.queryClient;
    void invalidateAgentSessionDetail(
      queryClient,
      event.organizationId,
      event.projectId,
      event.agentSessionId,
    );
    void invalidateAgentSessionFeeds(
      queryClient,
      event.organizationId,
      event.projectId,
    );

    this.debugger.logQueryInvalidation(
      "agentSessions",
      `item:${event.agentSessionId}`,
      {
        eventType: event.type,
        reason:
          "Agent session status changed, re-reading so the API remains authoritative",
        agentSessionId: event.agentSessionId,
        previousStatus: event.previousStatus,
        newStatus: event.newStatus,
        userId: event.userId,
      },
    );
  }

  private handleConversationUpdated(
    event:
      | WebSocketConversationUpdatedEvent
      | WebSocketConversationStatusChangedEvent,
  ) {
    if (!event.conversationId) return;

    logger.info(
      "data_websockets",
      "[handleConversationUpdated] Conversation updated",
      { conversationId: event.conversationId },
    );

    if (event.type === "conversation.updated") {
      this.markConversationMessagesStale(event);
      return;
    }

    emitDataEvent(
      {
        type: DataEventType.ConversationUpdated,
        conversationId: event.conversationId,
      },
      {
        invalidateWorkItem: this.invalidateWorkItem,
        invalidateConversation: this.invalidateConversation,
      },
    );

    this.debugger.logQueryInvalidation(
      "conversations",
      `item:${event.conversationId}`,
      {
        eventType: event.type,
        reason:
          "Conversation status changed, marking cached envelope queries stale",
        conversationId: event.conversationId,
        timestamp: event.timestamp,
      },
    );
  }

  /**
   * Message notifications invalidate the conversation's message reads; only
   * mounted reads re-run. The list read owns the `since=<cursor>` delta and
   * merge (`collections/messages.ts`). Concurrent consumers share one
   * in-flight read per key, and an event arriving mid-read cancels and
   * restarts it, so the read that lands starts after the event.
   */
  private markConversationMessagesStale(
    event: WebSocketConversationUpdatedEvent | WebSocketMessageUpdatedEvent,
  ) {
    const { conversationId, organizationId, projectId } = event;
    if (!conversationId || !organizationId || !projectId) return;

    logger.info(
      "data_websockets",
      "[message notification] invalidating conversation messages",
      { cid: conversationId, eventType: event.type },
    );
    void invalidateConversationMessages(
      this.queryClient,
      organizationId,
      projectId,
      conversationId,
    );
  }

  /**
   * A message was created or deleted. The loaded message list follows
   * `conversation.updated`; only the standalone latest-message read (used
   * when the list is not loaded) is invalidated here.
   */
  private markLatestMessageStale(
    event: WebSocketMessageCreatedEvent | WebSocketMessageDeletedEvent,
  ) {
    const { conversationId, organizationId, projectId } = event;
    if (!conversationId || !organizationId || !projectId) return;
    this.invalidateQueryKey(
      messageKeys.latest(organizationId, projectId, conversationId),
    );
  }

  private handleMessageRealtime(event: WebSocketMessageRealtimeEvent) {
    const currentState = this.store.get(messageRealtimeByConversationAtom);
    const result = applyRealtimeEvent(currentState, event);

    if (result.applied) {
      this.store.set(messageRealtimeByConversationAtom, result.nextState);
    }

    if (result.unknownKind) {
      logger.debug(
        "data_websockets",
        "Ignoring message.realtime with unknown kind",
        {
          kind: event.kind,
          messageId: event.messageId,
          conversationId: event.conversationId,
        },
      );
      return;
    }

    if (result.shouldRefetchConversation && event.conversationId) {
      emitDataEvent(
        {
          type: DataEventType.ConversationUpdated,
          conversationId: event.conversationId,
        },
        {
          invalidateWorkItem: this.invalidateWorkItem,
          invalidateConversation: this.invalidateConversation,
        },
      );

      this.debugger.logQueryInvalidation(
        "conversations",
        `item:${event.conversationId}`,
        {
          eventType: event.type,
          reason:
            "Realtime sequence gap detected, marking conversation stale for refetch",
          conversationId: event.conversationId,
          messageId: event.messageId,
          sequence: event.sequence,
        },
      );
    }
  }

  private handleProjectCreated(event: WebSocketProjectCreatedEvent) {
    logger.info("data_websockets", "[handleProjectCreated] Project created", {
      projectId: event.projectId,
    });

    void invalidateProjectQueries(
      this.queryClient,
      event.organizationId,
      event.projectId,
    );
    this.debugger.logEvent({
      type: "project.created",
      source: "websocket-handler",
      data: {
        projectId: event.projectId,
        organizationId: event.organizationId,
        timestamp: event.timestamp,
      },
      metadata: {
        success: true,
      },
    });
  }

  private handleProjectUpdated(event: WebSocketProjectUpdatedEvent) {
    if (!event.projectId) return;

    logger.info("data_websockets", "[handleProjectUpdated] Project updated", {
      projectId: event.projectId,
      changedFields: event.changedFields,
      timestamp: event.timestamp,
    });

    void invalidateProjectQueries(
      this.queryClient,
      event.organizationId,
      event.projectId,
    );
    this.debugger.logEvent({
      type: "project.updated",
      source: "websocket-handler",
      data: {
        projectId: event.projectId,
        organizationId: event.organizationId,
        changedFields: event.changedFields,
        timestamp: event.timestamp,
      },
      metadata: {
        success: true,
      },
    });
  }

  private handleProjectStatusChanged(
    event: WebSocketProjectStatusChangedEvent,
  ) {
    if (!event.projectId) return;

    logger.info(
      "data_websockets",
      "[handleProjectStatusChanged] Project status changed",
      {
        projectId: event.projectId,
        previousStatus: event.previousStatus,
        newStatus: event.newStatus,
      },
    );

    void invalidateProjectQueries(
      this.queryClient,
      event.organizationId,
      event.projectId,
    );
    this.debugger.logEvent({
      type: "project.status_changed",
      source: "websocket-handler",
      data: {
        projectId: event.projectId,
        organizationId: event.organizationId,
        previousStatus: event.previousStatus,
        newStatus: event.newStatus,
        timestamp: event.timestamp,
      },
      metadata: {
        success: true,
      },
    });
  }

  private handleDesignDocCreated(event: WebSocketDesignDocCreatedEvent) {
    void invalidateDesignDocQueries(
      this.queryClient,
      event.organizationId,
      event.projectId ?? undefined,
      event.designDocId,
    );
  }

  private handleDesignDocUpdated(event: {
    organizationId: string;
    projectId?: string;
    designDocId: string;
    changedFields?: string[];
  }) {
    if (!event.designDocId) return;
    this.invalidateQueryFilters({
      queryKey: event.projectId
        ? proposalKeys.lists(event.organizationId, event.projectId)
        : [...proposalKeys.root(), event.organizationId],
    });
    void invalidateDesignDocQueries(
      this.queryClient,
      event.organizationId,
      event.projectId ?? undefined,
      event.designDocId,
    );
    this.dispatchRelationshipInvalidations("DesignDoc", "update", {
      id: event.designDocId,
      organizationId: event.organizationId,
      projectId: event.projectId,
      changedFields: event.changedFields,
    });
  }

  /** Reconnects and forced refreshes: only mounted queries re-read. */
  markAllStale() {
    void invalidateAllDataLayerQueries(this.queryClient);

    this.debugger.logQueryInvalidation("all", "all-queries", {
      reason: "WebSocket reconnected or forced refresh",
    });
  }
}
