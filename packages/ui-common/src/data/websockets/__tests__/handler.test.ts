import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStore } from "jotai";
import { WebSocketHandler } from "../handler";
import { WebSocketDebugger } from "../debug";
import { QueryClient } from "@tanstack/react-query";
import { conversationKeys } from "../../collections/conversations";
import { messageKeys } from "../../collections/messages";
import {
  agentSessionKeys,
  type PaginatedAgentSessionsData,
} from "../../collections/agentSessions";
import { initiativeKeys } from "../../collections/initiatives";
import { workItemKeys } from "../../collections/workItemLists";
import { machineRepoBindingsByMachineAtom } from "../machineRepoBindingsState";
import { dataClient } from "../../../clients";
import {
  AgentSessionStatus,
  AgentSessionType,
  WebSocketSubscriptionRequestEventTypesEnum,
  type AgentSessionDto,
  type ConversationResponseDto,
  type WebSocketConversationUpdatedEvent,
} from "../../../api";

const createAgentSession = (id: string): AgentSessionDto => ({
  id,
  organizationId: "org-1",
  projectId: "project-1",
  userId: "current-user",
  status: AgentSessionStatus.InProgress,
  conversationId: null,
  sessionDate: "2026-07-18T00:00:00.000Z",
  title: "Session",
  hasUnsyncedChanges: false,
  monitoringEnabled: false,
  autoDecide: false,
  type: AgentSessionType.Coding,
});

const feedWith = (session: AgentSessionDto): PaginatedAgentSessionsData => ({
  pages: [
    {
      items: [
        {
          agentSession: session,
          lastMessage: null,
          parentEntity: null,
          services: [],
          reports: [],
        },
      ],
      nextCursor: "next",
    },
    { items: [], nextCursor: null },
  ],
  pageParams: [null, "next"],
});

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });

const isInvalidated = (
  queryClient: QueryClient,
  queryKey: readonly unknown[]
) => queryClient.getQueryState(queryKey)?.isInvalidated ?? false;

describe("WebSocketHandler", () => {
  let mockDebugger: WebSocketDebugger;
  let logEventSpy: ReturnType<typeof vi.spyOn>;
  let logCollectionActionSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Create proper debugger instance with mocked methods
    mockDebugger = new WebSocketDebugger();
    logEventSpy = vi
      .spyOn(mockDebugger, "logEvent")
      .mockImplementation(() => {});
    logCollectionActionSpy = vi
      .spyOn(mockDebugger, "logCollectionAction")
      .mockImplementation(() => {});
  });

  describe("Agent Session events", () => {
    const session = createAgentSession("session-1");
    const detailKey = agentSessionKeys.detail(
      "org-1",
      "project-1",
      "session-1"
    );
    const listKey = agentSessionKeys.list("org-1", "project-1", {});
    const otherProjectListKey = agentSessionKeys.list("org-1", "project-2", {});
    const feedKey = agentSessionKeys.paginated("org-1", "project-1", {});
    const currentStateKey = agentSessionKeys.currentState(
      "org-1",
      "project-1",
      "session-1"
    );
    const contextSizeKey = agentSessionKeys.contextSize(
      "org-1",
      "project-1",
      "session-1"
    );
    const outputAttentionKey = agentSessionKeys.outputAttention(
      "org-1",
      "project-1",
      "session-1"
    );
    const lifecycle = {
      timestamp: "2026-07-18T00:00:00.000Z",
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionId: "session-1",
    };

    const seed = () => {
      const queryClient = createQueryClient();
      queryClient.setQueryData(detailKey, session);
      queryClient.setQueryData(listKey, [session]);
      queryClient.setQueryData(otherProjectListKey, []);
      queryClient.setQueryData(feedKey, feedWith(session));
      queryClient.setQueryData(currentStateKey, {
        currentState: "THINKING",
        revision: 3,
        transitionedAt: "2026-07-18T00:00:03.000Z",
      });
      const handler = new WebSocketHandler(
        createStore(),
        mockDebugger,
        queryClient
      );
      return { queryClient, handler };
    };

    it("re-reads the session and the project's lists and feeds on creation", () => {
      const { queryClient, handler } = seed();
      handler.handleEvent({
        ...lifecycle,
        type: WebSocketSubscriptionRequestEventTypesEnum.AgentSessionCreated,
      } as never);

      expect(isInvalidated(queryClient, detailKey)).toBe(true);
      expect(isInvalidated(queryClient, listKey)).toBe(true);
      expect(isInvalidated(queryClient, feedKey)).toBe(true);
      expect(isInvalidated(queryClient, otherProjectListKey)).toBe(false);
      expect(isInvalidated(queryClient, currentStateKey)).toBe(false);
      // Nothing is written from the event.
      expect(queryClient.getQueryData(listKey)).toEqual([session]);
    });

    it("re-reads the session, lists and feeds on a status change without touching live state", () => {
      const { queryClient, handler } = seed();
      handler.handleEvent({
        ...lifecycle,
        type: WebSocketSubscriptionRequestEventTypesEnum.AgentSessionStatusChanged,
        previousStatus: AgentSessionStatus.InProgress,
        newStatus: AgentSessionStatus.Completed,
      } as never);

      expect(isInvalidated(queryClient, detailKey)).toBe(true);
      expect(isInvalidated(queryClient, listKey)).toBe(true);
      expect(isInvalidated(queryClient, feedKey)).toBe(true);
      expect(isInvalidated(queryClient, currentStateKey)).toBe(false);
      expect(queryClient.getQueryData<AgentSessionDto>(detailKey)?.status).toBe(
        AgentSessionStatus.InProgress
      );
    });

    it("drops everything held for a deleted session and re-reads lists and feeds", () => {
      const { queryClient, handler } = seed();
      queryClient.setQueryData(contextSizeKey, { totalTokens: 1 });
      queryClient.setQueryData(outputAttentionKey, { state: "NONE" });
      handler.handleEvent({
        ...lifecycle,
        type: WebSocketSubscriptionRequestEventTypesEnum.AgentSessionDeleted,
      } as never);

      for (const key of [
        detailKey,
        currentStateKey,
        contextSizeKey,
        outputAttentionKey,
      ]) {
        expect(queryClient.getQueryState(key)).toBeUndefined();
      }
      expect(queryClient.getQueryData(listKey)).toEqual([]);
      expect(isInvalidated(queryClient, listKey)).toBe(true);
      expect(isInvalidated(queryClient, feedKey)).toBe(true);
    });

    it("scopes project-less lifecycle events to the organization", () => {
      const { queryClient, handler } = seed();
      handler.handleEvent({
        ...lifecycle,
        projectId: undefined,
        type: WebSocketSubscriptionRequestEventTypesEnum.AgentSessionCreated,
      } as never);
      expect(isInvalidated(queryClient, listKey)).toBe(true);
      expect(isInvalidated(queryClient, otherProjectListKey)).toBe(true);
    });

    it("writes carried live values with no read, current state only when newer", () => {
      const { queryClient, handler } = seed();
      const requestSpy = vi.spyOn(dataClient, "request");
      handler.handleEvent({
        ...lifecycle,
        type: WebSocketSubscriptionRequestEventTypesEnum.AgentSessionCurrentStateChanged,
        currentState: "IDLE",
        revision: 2,
        transitionedAt: "2026-07-18T00:00:02.000Z",
      } as never);
      expect(queryClient.getQueryData(currentStateKey)).toMatchObject({
        currentState: "THINKING",
        revision: 3,
      });
      handler.handleEvent({
        ...lifecycle,
        type: WebSocketSubscriptionRequestEventTypesEnum.AgentSessionCurrentStateChanged,
        currentState: "WRITING",
        revision: 4,
        transitionedAt: "2026-07-18T00:00:04.000Z",
      } as never);
      expect(queryClient.getQueryData(currentStateKey)).toEqual({
        currentState: "WRITING",
        revision: 4,
        transitionedAt: "2026-07-18T00:00:04.000Z",
      });

      const reading = {
        totalTokens: 20_000,
        runId: "run-1",
        providerSessionId: "provider-1",
        observedAt: "2026-07-18T00:00:05.000Z",
      };
      handler.handleEvent({
        ...lifecycle,
        type: WebSocketSubscriptionRequestEventTypesEnum.AgentSessionContextSizeChanged,
        contextSize: reading,
      } as never);
      handler.handleEvent({
        ...lifecycle,
        type: WebSocketSubscriptionRequestEventTypesEnum.AgentSessionContextSizeChanged,
        contextSize: {
          ...reading,
          totalTokens: 1,
          observedAt: "2026-07-18T00:00:01.000Z",
        },
      } as never);
      expect(queryClient.getQueryData(contextSizeKey)).toEqual(reading);

      handler.handleEvent({
        ...lifecycle,
        type: WebSocketSubscriptionRequestEventTypesEnum.AgentSessionOutputAttentionChanged,
        userId: "current-user",
        state: "MESSAGE_READY",
        revision: 1,
        changedAt: "2026-07-18T00:00:06.000Z",
      } as never);
      expect(queryClient.getQueryData(outputAttentionKey)).toMatchObject({
        state: "MESSAGE_READY",
        revision: 1,
      });

      // Live writes never invalidate canonical reads or trigger reads.
      expect(isInvalidated(queryClient, detailKey)).toBe(false);
      expect(isInvalidated(queryClient, listKey)).toBe(false);
      expect(isInvalidated(queryClient, feedKey)).toBe(false);
      expect(requestSpy).not.toHaveBeenCalled();
    });

    it("re-reads only discovery lists in the project on a Daily Session update", () => {
      const { queryClient, handler } = seed();
      handler.handleEvent({
        type: "daily_session.updated",
        timestamp: "2026-07-18T00:00:00.000Z",
        organizationId: "org-1",
        projectId: "project-1",
        sessionId: "daily-1",
      } as never);
      expect(isInvalidated(queryClient, listKey)).toBe(true);
      expect(isInvalidated(queryClient, otherProjectListKey)).toBe(false);
      expect(isInvalidated(queryClient, feedKey)).toBe(false);
      expect(isInvalidated(queryClient, detailKey)).toBe(false);
    });

    it("refreshes the project's live state after a room join and everything on reconnect", async () => {
      const { queryClient, handler } = seed();
      queryClient.setQueryData(outputAttentionKey, { state: "NONE" });
      await handler.refreshLoadedAgentSessionCurrentStates(
        "org-1",
        "project-1"
      );
      expect(isInvalidated(queryClient, currentStateKey)).toBe(true);
      expect(isInvalidated(queryClient, outputAttentionKey)).toBe(false);
      expect(isInvalidated(queryClient, detailKey)).toBe(false);
      await handler.refreshLoadedAgentSessionOutputAttention(
        "org-1",
        "project-1"
      );
      expect(isInvalidated(queryClient, outputAttentionKey)).toBe(true);

      handler.markAllStale();
      for (const key of [detailKey, listKey, feedKey, otherProjectListKey]) {
        expect(isInvalidated(queryClient, key)).toBe(true);
      }
    });
  });

  it("should require store parameter", () => {
    expect(() => new WebSocketHandler(null as any, mockDebugger)).toThrow(
      "WebSocketHandler requires a store instance"
    );
  });

  it("invalidates the conversation's messages, not its envelope, on conversation.updated", () => {
    const mockStore = createStore();
    const queryClient = createQueryClient();
    const envelopeKey = conversationKeys.envelope(
      "org-456",
      "proj-789",
      "test-123"
    );
    const listKey = messageKeys.list("org-456", "proj-789", "test-123");
    const latestKey = messageKeys.latest("org-456", "proj-789", "test-123");
    const otherListKey = messageKeys.list("org-456", "proj-789", "other");
    queryClient.setQueryData(envelopeKey, { id: "test-123" });
    queryClient.setQueryData(listKey, []);
    queryClient.setQueryData(latestKey, null);
    queryClient.setQueryData(otherListKey, []);

    const handler = new WebSocketHandler(mockStore, mockDebugger, queryClient);
    handler.handleEvent({
      type: "conversation.updated",
      conversationId: "test-123",
      organizationId: "org-456",
      projectId: "proj-789",
      timestamp: new Date().toISOString(),
      changedFields: ["status"],
    } as WebSocketConversationUpdatedEvent);

    expect(isInvalidated(queryClient, envelopeKey)).toBe(false);
    expect(isInvalidated(queryClient, listKey)).toBe(true);
    expect(isInvalidated(queryClient, latestKey)).toBe(true);
    expect(isInvalidated(queryClient, otherListKey)).toBe(false);
  });

  it("routes conversation and initiative creation to their caches", () => {
    const mockStore = createStore();
    const setSpy = vi.spyOn(mockStore, "set");
    const queryClient = createQueryClient();
    const conversationListKey = conversationKeys.list(
      "org-456",
      "proj-789",
      {}
    );
    queryClient.setQueryData(conversationListKey, []);
    const initiativeListKey = initiativeKeys.list("org-456", {
      projectId: "proj-789",
    });
    queryClient.setQueryData(initiativeListKey, []);

    const handler = new WebSocketHandler(mockStore, mockDebugger, queryClient);

    // Test conversation dispatch
    handler.handleEvent({
      type: "conversation.created",
      conversationId: "conv-123",
      organizationId: "org-456",
      projectId: "proj-789",
      timestamp: new Date().toISOString(),
    } as any);

    // Test initiative dispatch
    handler.handleEvent({
      type: "initiative.created",
      initiativeId: "init-123",
      organizationId: "org-456",
      projectId: "proj-789",
      timestamp: new Date().toISOString(),
    } as any);

    expect(isInvalidated(queryClient, conversationListKey)).toBe(true);
    expect(isInvalidated(queryClient, initiativeListKey)).toBe(true);
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("should allow different handlers to use different query clients", () => {
    const queryClient1 = createQueryClient();
    const queryClient2 = createQueryClient();
    const handler1 = new WebSocketHandler(
      createStore(),
      mockDebugger,
      queryClient1
    );
    new WebSocketHandler(createStore(), mockDebugger, queryClient2);

    const listKey = conversationKeys.list("org-456", "proj-789", {});
    const conversation = { id: "conv-123" } as ConversationResponseDto;
    queryClient1.setQueryData(listKey, [conversation]);
    queryClient2.setQueryData(listKey, [conversation]);

    handler1.handleEvent({
      type: "conversation.status_changed",
      conversationId: "conv-123",
      organizationId: "org-456",
      projectId: "proj-789",
      timestamp: new Date().toISOString(),
      previousStatus: "ACTIVE",
      newStatus: "COMPLETED",
    });

    expect(isInvalidated(queryClient1, listKey)).toBe(true);
    expect(isInvalidated(queryClient2, listKey)).toBe(false);

    expect(() =>
      handler1.handleEvent({
        type: "conversation.updated",
        conversationId: "conv-123",
        organizationId: "org-456",
        projectId: "proj-789",
        timestamp: new Date().toISOString(),
        changedFields: ["status"],
      } as WebSocketConversationUpdatedEvent)
    ).not.toThrow();
  });

  it("should successfully share the query cache between handler and React hooks", () => {
    // Hooks and the handler read and invalidate the same QueryClient.
    const sharedQueryClient = createQueryClient();
    const conversation = {
      id: "conv-shared",
      projectId: "proj-123",
      organizationId: "org-456",
    } as ConversationResponseDto;
    const listKey = conversationKeys.list("org-456", "proj-123", {});
    const singleKey = conversationKeys.envelope(
      "org-456",
      "proj-123",
      "conv-shared"
    );
    sharedQueryClient.setQueryData(listKey, [conversation]);
    sharedQueryClient.setQueryData(singleKey, conversation);

    const handler = new WebSocketHandler(
      createStore(),
      mockDebugger,
      sharedQueryClient
    );

    handler.handleEvent({
      type: "conversation.status_changed",
      conversationId: "conv-shared",
      organizationId: "org-456",
      projectId: "proj-123",
      timestamp: new Date().toISOString(),
      previousStatus: "ACTIVE",
      newStatus: "COMPLETED",
    });

    expect(isInvalidated(sharedQueryClient, listKey)).toBe(true);
    expect(isInvalidated(sharedQueryClient, singleKey)).toBe(true);
  });

  describe("Task Event Handlers", () => {
    const seedWorkItemCaches = (queryClient: QueryClient) => {
      const keys = {
        list: workItemKeys.list("org-789", "project-1", {
          taskType: "FEATURE",
        }),
        changedDetail: workItemKeys.detail("org-789", "project-1", "task-123"),
        changedDetailWithEdges: workItemKeys.detail(
          "org-789",
          "project-1",
          "task-123",
          { includeEdges: true }
        ),
        projectlessDetail: workItemKeys.detail("org-789", "", "task-123"),
        otherDetail: workItemKeys.detail("org-789", "project-1", "task-other"),
        hierarchy: workItemKeys.hierarchy("org-789", "project-1", "parent-1"),
        otherProjectList: workItemKeys.list("org-789", "project-2", {}),
      };
      const task = { id: "task-123", name: "Task" };
      queryClient.setQueryData(keys.list, [task]);
      queryClient.setQueryData(keys.changedDetail, task);
      queryClient.setQueryData(keys.changedDetailWithEdges, task);
      queryClient.setQueryData(keys.projectlessDetail, task);
      queryClient.setQueryData(keys.otherDetail, { id: "task-other" });
      queryClient.setQueryData(keys.hierarchy, {
        task: { id: "parent-1" },
        children: [task],
      });
      queryClient.setQueryData(keys.otherProjectList, []);
      return keys;
    };

    it("invalidates project lists and hierarchies on task.created", () => {
      const queryClient = createQueryClient();
      const keys = seedWorkItemCaches(queryClient);
      const handler = new WebSocketHandler(
        createStore(),
        mockDebugger,
        queryClient
      );

      handler.handleEvent({
        type: "task.created",
        taskId: "task-new",
        initiativeId: "init-456",
        organizationId: "org-789",
        projectId: "project-1",
        timestamp: new Date().toISOString(),
      } as any);

      expect(isInvalidated(queryClient, keys.list)).toBe(true);
      expect(isInvalidated(queryClient, keys.hierarchy)).toBe(true);
      expect(isInvalidated(queryClient, keys.changedDetail)).toBe(false);
      expect(isInvalidated(queryClient, keys.otherProjectList)).toBe(false);
      expect(logCollectionActionSpy).toHaveBeenCalledWith(
        "workItems",
        "INVALIDATE",
        "new-item",
        expect.objectContaining({
          eventType: "task.created",
          taskId: "task-new",
        })
      );
    });

    it.each(["task.updated", "task.status_changed"])(
      "invalidates the item's single reads in every variant and project on %s",
      (type) => {
        const queryClient = createQueryClient();
        const keys = seedWorkItemCaches(queryClient);
        const handler = new WebSocketHandler(
          createStore(),
          mockDebugger,
          queryClient
        );

        handler.handleEvent({
          type,
          taskId: "task-123",
          initiativeId: "init-456",
          organizationId: "org-789",
          projectId: "project-1",
          timestamp: new Date().toISOString(),
          previousStatus: "BACKLOG",
          newStatus: "ACTIVE",
          changedBy: { userId: "user-999" },
        } as any);

        expect(isInvalidated(queryClient, keys.changedDetail)).toBe(true);
        expect(isInvalidated(queryClient, keys.changedDetailWithEdges)).toBe(
          true
        );
        expect(isInvalidated(queryClient, keys.projectlessDetail)).toBe(true);
        expect(isInvalidated(queryClient, keys.list)).toBe(true);
        expect(isInvalidated(queryClient, keys.hierarchy)).toBe(true);
        expect(isInvalidated(queryClient, keys.otherDetail)).toBe(false);
        expect(isInvalidated(queryClient, keys.otherProjectList)).toBe(false);
      }
    );

    it("removes a deleted item from cached lists, hierarchies and single reads", () => {
      const queryClient = createQueryClient();
      const keys = seedWorkItemCaches(queryClient);
      const handler = new WebSocketHandler(
        createStore(),
        mockDebugger,
        queryClient
      );

      handler.handleEvent({
        type: "task.deleted",
        taskId: "task-123",
        organizationId: "org-789",
        projectId: "project-1",
        timestamp: new Date().toISOString(),
      } as any);

      expect(queryClient.getQueryData(keys.list)).toEqual([]);
      expect(
        (queryClient.getQueryData(keys.hierarchy) as { children: unknown[] })
          .children
      ).toEqual([]);
      expect(queryClient.getQueryState(keys.changedDetail)).toBeUndefined();
      expect(queryClient.getQueryState(keys.projectlessDetail)).toBeUndefined();
      expect(isInvalidated(queryClient, keys.list)).toBe(true);
      expect(logCollectionActionSpy).toHaveBeenCalledWith(
        "workItems",
        "DELETE_ITEM",
        "deleted:task-123",
        expect.objectContaining({ eventType: "task.deleted" })
      );
    });

    it("invalidates every work-item read on reconnect", () => {
      const queryClient = createQueryClient();
      const keys = seedWorkItemCaches(queryClient);
      const handler = new WebSocketHandler(
        createStore(),
        mockDebugger,
        queryClient
      );

      handler.markAllStale();

      for (const queryKey of Object.values(keys)) {
        expect(isInvalidated(queryClient, queryKey)).toBe(true);
      }
      expect(logCollectionActionSpy).toHaveBeenCalledWith(
        "workItems",
        "MARK_ALL_STALE",
        "all-queries",
        expect.objectContaining({
          reason: expect.stringContaining("work item"),
        })
      );
    });

    it("routes task and conversation events through one handler", () => {
      const queryClient = createQueryClient();
      const conversationListKey = conversationKeys.list(
        "org-456",
        "proj-789",
        {}
      );
      queryClient.setQueryData(conversationListKey, []);
      const initiativeListKey = initiativeKeys.list("org-456", {
        projectId: "proj-789",
      });
      queryClient.setQueryData(initiativeListKey, []);
      const workItemListKey = workItemKeys.list("org-789", "proj-789", {});
      queryClient.setQueryData(workItemListKey, []);

      const handler = new WebSocketHandler(
        createStore(),
        mockDebugger,
        queryClient
      );

      handler.handleEvent({
        type: "task.created",
        taskId: "task-123",
        initiativeId: "init-456",
        organizationId: "org-789",
        projectId: "proj-789",
        timestamp: new Date().toISOString(),
      } as any);
      handler.handleEvent({
        type: "conversation.created",
        conversationId: "conv-123",
        organizationId: "org-456",
        projectId: "proj-789",
        timestamp: new Date().toISOString(),
      } as any);

      expect(isInvalidated(queryClient, workItemListKey)).toBe(true);
      expect(isInvalidated(queryClient, conversationListKey)).toBe(true);
    });
  });

  describe("machine.repo_bindings", () => {
    const bindings = [
      {
        serviceId: "svc-1",
        repositoryPath: "/home/user/repo",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];

    it("keys the latest bindings by machineId", () => {
      const store = createStore();
      const handler = new WebSocketHandler(store, mockDebugger);

      handler.handleEvent({
        type: "machine.repo_bindings",
        machineId: "machine-1",
        organizationId: "org-1",
        bindings,
        timestamp: new Date().toISOString(),
      } as any);

      expect(store.get(machineRepoBindingsByMachineAtom)).toEqual({
        "machine-1": bindings,
      });
    });

    it("does not clobber other machines and overwrites with empty bindings on disconnect", () => {
      const store = createStore();
      const handler = new WebSocketHandler(store, mockDebugger);

      handler.handleEvent({
        type: "machine.repo_bindings",
        machineId: "machine-1",
        organizationId: "org-1",
        bindings,
        timestamp: new Date().toISOString(),
      } as any);
      handler.handleEvent({
        type: "machine.repo_bindings",
        machineId: "machine-2",
        organizationId: "org-1",
        bindings,
        timestamp: new Date().toISOString(),
      } as any);
      // Disconnect of machine-1 fans out empty bindings for machine-1 only.
      handler.handleEvent({
        type: "machine.repo_bindings",
        machineId: "machine-1",
        organizationId: "org-1",
        bindings: [],
        timestamp: new Date().toISOString(),
      } as any);

      expect(store.get(machineRepoBindingsByMachineAtom)).toEqual({
        "machine-1": [],
        "machine-2": bindings,
      });
    });
  });
});
