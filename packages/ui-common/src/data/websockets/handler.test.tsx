import { vi } from "vitest";
import { createStore } from "jotai";
import { platformClient } from "../../clients/serviceClients";
import { WebSocketHandler } from "./handler";
vi.mock("../../clients/serviceClients", () => ({
  platformClient: { getMessages: vi.fn(), getMessage: vi.fn() },
}));
import { QueryClient } from "@tanstack/react-query";
import { messageKeys } from "../collections/messages";
import { conversationKeys } from "../collections/conversations";

describe("WebSocketHandler conversation.updated boundary", () => {
  let store: ReturnType<typeof createStore>;
  let queryClient: QueryClient;
  let websocketHandler: WebSocketHandler;

  const isInvalidated = (queryKey: readonly unknown[]) =>
    queryClient.getQueryState(queryKey)?.isInvalidated ?? false;
  const invalidatedKeys = () =>
    queryClient
      .getQueryCache()
      .getAll()
      .filter((query) => query.state.isInvalidated)
      .map((query) => query.queryKey);

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(platformClient.getMessages).mockImplementation(vi.fn());
    vi.mocked(platformClient.getMessage).mockImplementation(vi.fn());
    store = createStore();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    websocketHandler = new WebSocketHandler(store, undefined, queryClient);
  });

  afterEach(() => {
    queryClient.clear();
  });

  it("marks only Messages stale without fetching", async () => {
    const envelopeQueryKey = conversationKeys.workflowList("org-1", "proj-1", {
      workflowName: "onboarding",
      workflowAboutId: "project-about-1",
    });
    queryClient.setQueryData(envelopeQueryKey, [{ id: "conv-1" }]);
    const listKey = messageKeys.list("org-1", "proj-1", "conv-1");
    queryClient.setQueryData(listKey, []);

    websocketHandler.handleEvent({
      type: "conversation.updated",
      timestamp: "2026-04-01T11:00:00Z",
      organizationId: "org-1",
      projectId: "proj-1",
      conversationId: "conv-1",
      previousVersion: 1,
      newVersion: 2,
      changeType: "message_added",
      latestMessageId: "msg-99",
    });

    expect(isInvalidated(listKey)).toBe(true);
    expect(isInvalidated(envelopeQueryKey)).toBe(false);

    await Promise.resolve();
    expect(platformClient.getMessages).not.toHaveBeenCalled();
    expect(platformClient.getMessage).not.toHaveBeenCalled();
  });

  it("leaves unrelated conversation envelopes and message scopes fresh", () => {
    const matchingEnvelopeQueryKey = conversationKeys.workflowList(
      "org-1",
      "proj-1",
      { workflowName: "onboarding", workflowAboutId: "project-about-1" }
    );
    const unrelatedEnvelopeQueryKey = conversationKeys.workflowList(
      "org-1",
      "proj-2",
      { workflowName: "onboarding", workflowAboutId: "project-about-2" }
    );
    queryClient.setQueryData(matchingEnvelopeQueryKey, [{ id: "conv-1" }]);
    queryClient.setQueryData(unrelatedEnvelopeQueryKey, [{ id: "conv-2" }]);

    const scopedQueryKey = messageKeys.list("org-1", "proj-1", "conv-1");
    const otherConversationQueryKey = messageKeys.list(
      "org-1",
      "proj-1",
      "conv-2"
    );
    const otherProjectQueryKey = messageKeys.list("org-1", "proj-2", "conv-1");
    for (const key of [
      scopedQueryKey,
      otherConversationQueryKey,
      otherProjectQueryKey,
    ]) {
      queryClient.setQueryData(key, []);
    }

    websocketHandler.handleEvent({
      type: "conversation.updated",
      timestamp: "2026-04-01T11:00:00Z",
      organizationId: "org-1",
      projectId: "proj-1",
      conversationId: "conv-1",
      previousVersion: 1,
      newVersion: 2,
      changeType: "message_added",
      latestMessageId: "final-message",
    });

    expect(invalidatedKeys()).toEqual([scopedQueryKey]);
    expect(isInvalidated(otherConversationQueryKey)).toBe(false);
    expect(isInvalidated(otherProjectQueryKey)).toBe(false);
    expect(isInvalidated(matchingEnvelopeQueryKey)).toBe(false);
    expect(isInvalidated(unrelatedEnvelopeQueryKey)).toBe(false);
  });

  it("ignores conversation.status_changed events — messages list not invalidated, no fetch", async () => {
    const queryKey = messageKeys.list("org-1", "proj-1", "conv-1");
    queryClient.setQueryData(queryKey, []);

    websocketHandler.handleEvent({
      type: "conversation.status_changed",
      timestamp: "2026-04-01T11:00:00Z",
      organizationId: "org-1",
      projectId: "proj-1",
      conversationId: "conv-1",
      previousStatus: "ACTIVE",
      newStatus: "COMPLETED",
    } as never);

    await Promise.resolve();
    expect(isInvalidated(queryKey)).toBe(false);
    expect(platformClient.getMessages).not.toHaveBeenCalled();
    expect(platformClient.getMessage).not.toHaveBeenCalled();
  });
});
import { CollectionMap } from "../core/CollectionMap";
import { ListQueryMap } from "../core/ListQueryMap";

import { loadConfig, resetConfig } from "../relationships";
import { designDocKeys } from "../collections/designDocs";
import { QueryClient } from "@tanstack/react-query";
import { workItemKeys } from "../collections/workItemLists";
import { initiativeKeys } from "../collections/initiatives";
import logger from "../../utils/logger";

describe("WebSocketHandler relationship-config invalidations", () => {
  let store: ReturnType<typeof createStore>;
  let websocketHandler: WebSocketHandler;
  let queryClient: QueryClient;
  let loggerWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    resetConfig();
    store = createStore();
    queryClient = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity } },
    });
    websocketHandler = new WebSocketHandler(store, undefined, queryClient);

    queryClient.setQueryData(initiativeKeys.list("org-1"), []);
    queryClient.setQueryData(
      initiativeKeys.list("org-1", { projectId: "proj-1" }),
      []
    );

    loggerWarnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    resetConfig();
    loggerWarnSpy.mockRestore();
  });

  const isInvalidated = (queryKey: readonly unknown[]) =>
    queryClient.getQueryState(queryKey)?.isInvalidated ?? false;

  it("fans out to related collections on initiative.updated when config is loaded", async () => {
    const projectLists = workItemKeys.list("org-1", "proj-1", {
      initiativeId: "init-1",
    });
    queryClient.setQueryData(projectLists, []);
    loadConfig({
      version: "test",
      generatedAt: "2026-05-18T00:00:00.000Z",
      rules: [
        {
          sourceEntity: "Initiative",
          sourceFields: ["id"],
          targetCollections: ["Task"],
          relationshipPath: "tasks",
          cardinality: "1:1",
          lookupField: "initiativeId",
          invalidationMode: "invalidate",
        },
      ],
    });

    websocketHandler.handleEvent({
      type: "initiative.updated",
      timestamp: "2026-05-18T11:00:00Z",
      organizationId: "org-1",
      projectId: "proj-1",
      initiativeId: "init-1",
      changedFields: ["name"],
    });

    // Work-item lists are on TanStack Query: the project's lists re-read.
    await Promise.resolve();
    expect(isInvalidated(projectLists)).toBe(true);
    expect(isInvalidated(initiativeKeys.list("org-1"))).toBe(true);
  });

  it("fans out from task.updated to design doc collection per loaded rule", async () => {
    const taskDetail = workItemKeys.detail("org-1", "proj-1", "task-1");
    queryClient.setQueryData(taskDetail, { id: "task-1" });
    const expectedKey = designDocKeys.list("org-1", { taskId: "task-1" });
    queryClient.setQueryData(expectedKey, []);
    loadConfig({
      version: "test",
      generatedAt: "2026-05-18T00:00:00.000Z",
      rules: [
        {
          sourceEntity: "Task",
          sourceFields: ["id"],
          targetCollections: ["DesignDoc"],
          relationshipPath: "designDocs",
          cardinality: "1:many",
          lookupField: "taskId",
          invalidationMode: "invalidate",
        },
      ],
    });

    websocketHandler.handleEvent({
      type: "task.updated",
      timestamp: "2026-05-18T11:00:00Z",
      organizationId: "org-1",
      projectId: "proj-1",
      initiativeId: "init-1",
      taskId: "task-1",
      changedFields: ["status"],
    });

    await Promise.resolve();
    expect(isInvalidated(expectedKey)).toBe(true);
    // The task's own reads are invalidated too.
    await Promise.resolve();
    expect(isInvalidated(taskDetail)).toBe(true);
  });

  it("fans out from design_doc.updated to Initiative list scope per loaded rule", async () => {
    const detailKey = designDocKeys.detail("org-1", "dd-1");
    queryClient.setQueryData(detailKey, { id: "dd-1" });
    loadConfig({
      version: "test",
      generatedAt: "2026-05-18T00:00:00.000Z",
      rules: [
        {
          sourceEntity: "DesignDoc",
          sourceFields: ["projectId"],
          targetCollections: ["Initiative"],
          relationshipPath: "initiatives",
          cardinality: "1:1",
          lookupField: "projectId",
          invalidationMode: "invalidate",
        },
      ],
    });

    websocketHandler.handleEvent({
      type: "design_doc.updated",
      timestamp: "2026-05-18T11:00:00Z",
      organizationId: "org-1",
      projectId: "proj-1",
      designDocId: "dd-1",
      changedFields: ["status"],
    });

    expect(
      isInvalidated(initiativeKeys.list("org-1", { projectId: "proj-1" }))
    ).toBe(true);

    await Promise.resolve();
    expect(isInvalidated(detailKey)).toBe(true);
  });

  it("uses the event project id for task detail cascade invalidations", async () => {
    const taskDetail = workItemKeys.detail("org-1", "proj-1", "task-1");
    const otherDetail = workItemKeys.detail("org-1", "proj-1", "task-2");
    queryClient.setQueryData(taskDetail, { id: "task-1" });
    queryClient.setQueryData(otherDetail, { id: "task-2" });
    loadConfig({
      version: "test",
      generatedAt: "2026-05-18T00:00:00.000Z",
      rules: [
        {
          sourceEntity: "Initiative",
          sourceFields: ["id"],
          targetCollections: ["Task"],
          relationshipPath: "tasks",
          cardinality: "1:1",
          lookupField: "id",
          invalidationMode: "cascade",
        },
      ],
    });

    websocketHandler.handleEvent({
      type: "initiative.updated",
      timestamp: "2026-05-18T11:00:00Z",
      organizationId: "org-1",
      projectId: "proj-1",
      initiativeId: "task-1",
      changedFields: ["status"],
    });

    await Promise.resolve();
    expect(isInvalidated(taskDetail)).toBe(true);
    expect(isInvalidated(otherDetail)).toBe(false);
  });

  it("warns and preserves direct initiative invalidation when config has not been loaded", () => {
    // No loadConfig() call here.

    websocketHandler.handleEvent({
      type: "initiative.updated",
      timestamp: "2026-05-18T11:00:00Z",
      organizationId: "org-1",
      projectId: "proj-1",
      initiativeId: "init-1",
      changedFields: ["name"],
    });

    expect(isInvalidated(initiativeKeys.list("org-1"))).toBe(true);

    expect(loggerWarnSpy).toHaveBeenCalledWith(
      "data_websockets",
      expect.stringContaining("relationship config not loaded"),
      expect.objectContaining({
        entityType: "Initiative",
        operation: "update",
      })
    );
  });

  it("drops the relationship dispatch with a warning when the event has no id", () => {
    const projectList = workItemKeys.list("org-1", "proj-1", {});
    queryClient.setQueryData(projectList, []);
    loadConfig({
      version: "test",
      generatedAt: "2026-05-18T00:00:00.000Z",
      rules: [
        {
          sourceEntity: "Task",
          sourceFields: ["id"],
          targetCollections: ["DesignDoc"],
          relationshipPath: "designDocs",
          cardinality: "1:1",
          lookupField: "taskId",
          invalidationMode: "invalidate",
        },
      ],
    });

    websocketHandler.handleEvent({
      type: "task.updated",
      timestamp: "2026-05-18T11:00:00Z",
      organizationId: "org-1",
      projectId: "proj-1",
      taskId: "", // missing id discriminator
      changedFields: ["status"],
    });

    // No design-doc stale entries: the missing-id guard fired.
    expect(
      queryClient.getQueryCache().findAll({ queryKey: designDocKeys.root() })
    ).toHaveLength(0);
    // The handler's own early-return on missing taskId fires before our
    // helper, so no work-item dispatches either.
    expect(isInvalidated(projectList)).toBe(false);
  });
});
