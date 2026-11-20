import { createUnreachableGraphQLClient } from "../../../test/graphqlTestClient";
import { reportKeys } from "../../collections/reports";
import type { ReportDto, WebSocketSystemNotificationEvent } from "../../../api";
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
import { featureContentKeys } from "../../collections/featureDocumentContent";
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
  queryKey: readonly unknown[],
) => queryClient.getQueryState(queryKey)?.isInvalidated ?? false;

describe("WebSocketHandler", () => {
  let mockDebugger: WebSocketDebugger;
  let logEventSpy: ReturnType<typeof vi.spyOn>;
  let logQueryInvalidationSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Create proper debugger instance with mocked methods
    mockDebugger = new WebSocketDebugger();
    logEventSpy = vi
      .spyOn(mockDebugger, "logEvent")
      .mockImplementation(() => {});
    logQueryInvalidationSpy = vi
      .spyOn(mockDebugger, "logQueryInvalidation")
      .mockImplementation(() => {});
  });

  it("refreshes only canonical reports for the signalled selected session", async () => {
    const client = createQueryClient();
    const reports: ReportDto[] = [
      {
        id: "report-1",
        organizationId: "org-1",
        projectId: "project-1",
        title: "Implementation evidence",
        reportType: "IMPLEMENT",
        audience: "PROJECT_VISIBLE",
        version: 1,
        schemaVersion: 1,
        sourceExecutionId: "session-1",
        createdAt: "2026-11-18T12:00:00Z",
        expiresAt: null,
        payload: {
          reportType: "IMPLEMENT",
          summary:
            "The selected task implementation is complete with feature-level checks and recorded limitations.",
          filesChanged: ["src/feature.ts"],
        },
        entities: [
          {
            entityType: "AGENT_SESSION",
            entityId: "session-1",
            relation: "PRIMARY",
          },
        ],
      },
    ];
    const selected = [
      ...reportKeys.entityList("org-1", "project-1"),
      { entityType: "AGENT_SESSION", entityId: "session-1" },
    ];
    const unrelated = [
      ...reportKeys.entityList("org-1", "project-1"),
      { entityType: "AGENT_SESSION", entityId: "session-2" },
    ];
    const otherProject = [
      ...reportKeys.entityList("org-1", "project-2"),
      { entityType: "AGENT_SESSION", entityId: "session-1" },
    ];
    [selected, unrelated, otherProject].forEach((key) =>
      client.setQueryData(key, reports),
    );
    const handler = new WebSocketHandler(createStore(), mockDebugger, client);
    const event = {
      type: "system.notification",
      timestamp: "2026-11-18T12:01:00Z",
      organizationId: "org-1",
      projectId: "project-1",
      notification: {
        id: "notification-1",
        entityId: "session-1",
        entityType: "AGENT_SESSION",
        entityTitle: "Implement restricted conversations",
        eventType: "session_report_ready",
        status: "UNREAD",
        createdAt: "2026-11-18T12:01:00Z",
        affectedEntities: [],
        payload: {
          sessionId: "session-1",
          sessionTitle: "Implement restricted conversations",
          reportId: "report-1",
          reportTitle: "Implementation evidence",
          reportType: "IMPLEMENT",
        },
      },
      delivery: { channel: "in-app", transport: "websocket" },
      clientHints: { shouldBadge: true },
    } satisfies WebSocketSystemNotificationEvent;
    handler.handleEvent(event);
    expect(isInvalidated(client, selected)).toBe(true);
    expect(isInvalidated(client, unrelated)).toBe(false);
    expect(isInvalidated(client, otherProject)).toBe(false);
    expect(client.getQueryData(selected)).toEqual(reports);
    client.clear();
  });

  describe("Agent Session events", () => {
    const session = createAgentSession("session-1");
    const detailKey = agentSessionKeys.detail(
      "org-1",
      "project-1",
      "session-1",
    );
    const listKey = agentSessionKeys.list("org-1", "project-1", {});
    const otherProjectListKey = agentSessionKeys.list("org-1", "project-2", {});
    const feedKey = agentSessionKeys.paginated("org-1", "project-1", {});
    const currentStateKey = agentSessionKeys.currentState(
      "org-1",
      "project-1",
      "session-1",
    );
    const contextSizeKey = agentSessionKeys.contextSize(
      "org-1",
      "project-1",
      "session-1",
    );
    const outputAttentionKey = agentSessionKeys.outputAttention(
      "org-1",
      "project-1",
      "session-1",
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
        queryClient,
        createUnreachableGraphQLClient(),
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
        AgentSessionStatus.InProgress,
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
        "project-1",
      );
      expect(isInvalidated(queryClient, currentStateKey)).toBe(true);
      expect(isInvalidated(queryClient, outputAttentionKey)).toBe(false);
      expect(isInvalidated(queryClient, detailKey)).toBe(false);
      await handler.refreshLoadedAgentSessionOutputAttention(
        "org-1",
        "project-1",
      );
      expect(isInvalidated(queryClient, outputAttentionKey)).toBe(true);

      handler.markAllStale();
      for (const key of [detailKey, listKey, feedKey, otherProjectListKey]) {
        expect(isInvalidated(queryClient, key)).toBe(true);
      }
    });
  });

  it("should require store parameter", () => {
    expect(
      () =>
        new WebSocketHandler(
          null as any,
          mockDebugger,
          createQueryClient(),
          createUnreachableGraphQLClient(),
        ),
    ).toThrow("WebSocketHandler requires a store instance");
  });

  it("invalidates the conversation's messages, not its envelope, on conversation.updated", () => {
    const mockStore = createStore();
    const queryClient = createQueryClient();
    const envelopeKey = conversationKeys.envelope(
      "org-456",
      "proj-789",
      "test-123",
    );
    const listKey = messageKeys.list("org-456", "proj-789", "test-123");
    const latestKey = messageKeys.latest("org-456", "proj-789", "test-123");
    const otherListKey = messageKeys.list("org-456", "proj-789", "other");
    queryClient.setQueryData(envelopeKey, { id: "test-123" });
    queryClient.setQueryData(listKey, []);
    queryClient.setQueryData(latestKey, null);
    queryClient.setQueryData(otherListKey, []);

    const handler = new WebSocketHandler(
      mockStore,
      mockDebugger,
      queryClient,
      createUnreachableGraphQLClient(),
    );
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
      {},
    );
    queryClient.setQueryData(conversationListKey, []);
    const initiativeListKey = initiativeKeys.list("org-456", {
      projectId: "proj-789",
    });
    queryClient.setQueryData(initiativeListKey, []);

    const handler = new WebSocketHandler(
      mockStore,
      mockDebugger,
      queryClient,
      createUnreachableGraphQLClient(),
    );

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
      queryClient1,
      createUnreachableGraphQLClient(),
    );
    new WebSocketHandler(
      createStore(),
      mockDebugger,
      queryClient2,
      createUnreachableGraphQLClient(),
    );

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
      } as WebSocketConversationUpdatedEvent),
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
      "conv-shared",
    );
    sharedQueryClient.setQueryData(listKey, [conversation]);
    sharedQueryClient.setQueryData(singleKey, conversation);

    const handler = new WebSocketHandler(
      createStore(),
      mockDebugger,
      sharedQueryClient,
      createUnreachableGraphQLClient(),
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
    // What each event does to shown work-item views is covered by
    // handler-workItemsGraphql.test.tsx; these cover the handler's own routing.
    const createHandler = (queryClient: QueryClient) =>
      new WebSocketHandler(
        createStore(),
        mockDebugger,
        queryClient,
        createUnreachableGraphQLClient(),
      );
    const taskEvent = (type: string, extra: object = {}) =>
      ({
        type,
        taskId: "task-123",
        initiativeId: "init-456",
        organizationId: "org-789",
        projectId: "project-1",
        timestamp: new Date().toISOString(),
        ...extra,
      }) as any;

    it("records each task event under work items", () => {
      const handler = createHandler(createQueryClient());

      handler.handleEvent(taskEvent("task.created", { taskId: "task-new" }));
      handler.handleEvent(taskEvent("task.deleted"));

      expect(logQueryInvalidationSpy).toHaveBeenCalledWith(
        "workItems",
        "new-item",
        expect.objectContaining({
          eventType: "task.created",
          taskId: "task-new",
        }),
      );
      expect(logQueryInvalidationSpy).toHaveBeenCalledWith(
        "workItems",
        "deleted:task-123",
        expect.objectContaining({ eventType: "task.deleted" }),
      );
    });

    it("invalidates the TanStack data that depends on a task, only in its project", () => {
      const queryClient = createQueryClient();
      const content = featureContentKeys.byId(
        "org-789",
        "project-1",
        "document",
        "task-123",
      );
      const otherContent = featureContentKeys.byId(
        "org-789",
        "project-1",
        "document",
        "task-other",
      );
      const otherProject = featureContentKeys.byId(
        "org-789",
        "project-2",
        "document",
        "task-123",
      );
      for (const key of [content, otherContent, otherProject]) {
        queryClient.setQueryData(key, { id: "x" });
      }
      const handler = createHandler(queryClient);

      handler.handleEvent(
        taskEvent("task.status_changed", {
          previousStatus: "BACKLOG",
          newStatus: "ACTIVE",
        }),
      );

      expect(isInvalidated(queryClient, content)).toBe(true);
      expect(isInvalidated(queryClient, otherContent)).toBe(false);
      expect(isInvalidated(queryClient, otherProject)).toBe(false);
    });

    it("logs a reconnect refresh", () => {
      createHandler(createQueryClient()).markAllStale();

      expect(logQueryInvalidationSpy).toHaveBeenCalledWith(
        "all",
        "all-queries",
        expect.objectContaining({
          reason: expect.stringContaining("reconnected"),
        }),
      );
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
      const handler = new WebSocketHandler(
        store,
        mockDebugger,
        createQueryClient(),
        createUnreachableGraphQLClient(),
      );

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
      const handler = new WebSocketHandler(
        store,
        mockDebugger,
        createQueryClient(),
        createUnreachableGraphQLClient(),
      );

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
