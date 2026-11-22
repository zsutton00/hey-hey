import { createUnreachableGraphQLClient } from "../../test/graphqlTestClient";
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

import { loadConfig, resetConfig } from "../relationships";
import { designDocKeys } from "../collections/designDocs";
import { QueryClient } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { FakeWorkItemServer } from "../../test/workItemGraphQL";
import { useWorkItem } from "../hooks/useWorkItem";
import { useWorkItems } from "../hooks/useWorkItems";
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
    websocketHandler = new WebSocketHandler(
      store,
      undefined,
      queryClient,
      createUnreachableGraphQLClient(),
    );

    queryClient.setQueryData(initiativeKeys.list("org-1"), []);
    queryClient.setQueryData(
      initiativeKeys.list("org-1", { projectId: "proj-1" }),
      [],
    );

    loggerWarnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    resetConfig();
    loggerWarnSpy.mockRestore();
  });

  const isInvalidated = (queryKey: readonly unknown[]) =>
    queryClient.getQueryState(queryKey)?.isInvalidated ?? false;

  /** A handler on a server's clients, with the work-item reads views make. */
  const withWorkItemServer = () => {
    const server = new FakeWorkItemServer([
      { id: "task-1", name: "One", type: "STANDARD", status: "BACKLOG" },
      { id: "task-2", name: "Two", type: "STANDARD", status: "BACKLOG" },
    ]);
    const handler = new WebSocketHandler(
      createStore(),
      undefined,
      server.queryClient,
      server.graphql.apollo,
    );

    return { server, handler };
  };

  it("fans out to related collections on initiative.updated when config is loaded", async () => {
    const { server, handler } = withWorkItemServer();
    const views = renderHook(
      () => useWorkItems("org-1", "task", "proj-1", undefined, {}),
      { wrapper: server.wrapper },
    );
    await waitFor(() => expect(views.result.current.isReady).toBe(true));
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

    handler.handleEvent({
      type: "initiative.updated",
      timestamp: "2026-05-18T11:00:00Z",
      organizationId: "org-1",
      projectId: "proj-1",
      initiativeId: "init-1",
      changedFields: ["name"],
    });

    // Work-item lists are in the GraphQL cache: the project's lists re-read.
    await waitFor(() =>
      expect(server.received("GetWorkItems")).toHaveLength(2),
    );
  });

  it("fans out from task.updated to design doc collection per loaded rule", async () => {
    const { server, handler } = withWorkItemServer();
    const views = renderHook(
      () => useWorkItem("org-1", "task", "task-1", { projectId: "proj-1" }),
      { wrapper: server.wrapper },
    );
    await waitFor(() => expect(views.result.current.isReady).toBe(true));
    const expectedKey = designDocKeys.list("org-1", { taskId: "task-1" });
    server.queryClient.setQueryData(expectedKey, []);
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

    handler.handleEvent({
      type: "task.updated",
      timestamp: "2026-05-18T11:00:00Z",
      organizationId: "org-1",
      projectId: "proj-1",
      initiativeId: "init-1",
      taskId: "task-1",
      changedFields: ["status"],
    });

    expect(server.queryClient.getQueryState(expectedKey)?.isInvalidated).toBe(
      true,
    );
    // The task's own read asks the server again too.
    await waitFor(() => expect(server.received("GetWorkItem")).toHaveLength(2));
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
      isInvalidated(initiativeKeys.list("org-1", { projectId: "proj-1" })),
    ).toBe(true);

    await Promise.resolve();
    expect(isInvalidated(detailKey)).toBe(true);
  });

  it("uses the event project id for task detail cascade invalidations", async () => {
    const { server, handler } = withWorkItemServer();
    const views = renderHook(
      () => ({
        first: useWorkItem("org-1", "task", "task-1", { projectId: "proj-1" }),
        other: useWorkItem("org-1", "task", "task-2", { projectId: "proj-1" }),
      }),
      { wrapper: server.wrapper },
    );
    await waitFor(() => {
      expect(views.result.current.first.isReady).toBe(true);
      expect(views.result.current.other.isReady).toBe(true);
    });
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

    handler.handleEvent({
      type: "initiative.updated",
      timestamp: "2026-05-18T11:00:00Z",
      organizationId: "org-1",
      projectId: "proj-1",
      initiativeId: "task-1",
      changedFields: ["status"],
    });

    await waitFor(() =>
      expect(
        server.received("GetWorkItem").filter((v) => v.id === "task-1"),
      ).toHaveLength(2),
    );
    expect(
      server.received("GetWorkItem").filter((v) => v.id === "task-2"),
    ).toHaveLength(1);
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
      }),
    );
  });

  it("drops the relationship dispatch with a warning when the event has no id", () => {
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
      queryClient.getQueryCache().findAll({ queryKey: designDocKeys.root() }),
    ).toHaveLength(0);
  });
});
