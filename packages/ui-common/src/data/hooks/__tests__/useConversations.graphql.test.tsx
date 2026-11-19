import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  conversationNode,
  FakeConversationServer,
  threadOf,
} from "../../../test/conversationGraphQL";
import { useConversation } from "../useConversation";
import { useConversations } from "../useConversations";
import { useWorkflowConversations } from "../useWorkflowConversations";

vi.mock("../../../clients/serviceClients", () => ({
  projectsClient: { getQueuedConversationInputs: vi.fn() },
}));

vi.mock("../../../utils/logger", () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe("conversation reads over GraphQL", () => {
  let server: FakeConversationServer;

  beforeEach(() => {
    server = new FakeConversationServer(threadOf(1));
    server.conversations = [
      conversationNode,
      { ...conversationNode, id: "conv-2", title: "Another" },
    ];
  });

  it("lists active conversations without a status filter", async () => {
    const { result } = renderHook(
      () =>
        useConversations("org-1", "project-1", {
          workflowName: ["task_workflow", "plan_workflow"],
          search: "needle",
        }),
      { wrapper: server.wrapper },
    );

    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(result.current.data?.map((c) => c.id)).toEqual(["conv-1", "conv-2"]);
    expect(server.received("GetActiveConversations")).toEqual([
      {
        workflowNames: ["task_workflow", "plan_workflow"],
        search: "needle",
        page: 1,
        limit: 100,
      },
    ]);
  });

  it("lists the conversations matching the requested statuses", async () => {
    const { result } = renderHook(
      () =>
        useConversations("org-1", "project-1", {
          statuses: ["COMPLETED" as never],
        }),
      { wrapper: server.wrapper },
    );

    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(server.received("GetConversations")).toEqual([
      { statuses: ["COMPLETED"], page: 1, limit: 100 },
    ]);
    expect(result.current.data).toHaveLength(2);
  });

  it("returns a conversation in the REST shape, without absent fields", async () => {
    const { result } = renderHook(
      () => useConversation("org-1", "project-1", { conversationId: "conv-1" }),
      { wrapper: server.wrapper },
    );

    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(result.current.data).toMatchObject({
      id: "conv-1",
      title: "A conversation",
      createdBy: null,
      version: 1,
    });
    expect(result.current.data).not.toHaveProperty("workflowId");
  });

  it("reads the conversations of a workflow entity", async () => {
    const { result } = renderHook(
      () =>
        useWorkflowConversations(
          "org-1",
          "project-1",
          "task_workflow",
          "task-1",
          { status: "ACTIVE" as never },
        ),
      { wrapper: server.wrapper },
    );

    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(result.current.data.map((c) => c.id)).toEqual(["conv-1", "conv-2"]);
    expect(server.received("GetWorkflowConversations")).toEqual([
      {
        workflowName: "task_workflow",
        workflowAboutId: "task-1",
        statuses: ["ACTIVE"],
        sortBy: "createdAt",
        sortOrder: "desc",
        page: 1,
        limit: 50,
      },
    ]);
  });

  it("reads the new project when a mounted conversation list switches projects", async () => {
    server.conversationsByPath.set(
      "/organizations/org-1/projects/project-2/graphql",
      [{ ...conversationNode, title: "Project two" }],
    );
    const { result, rerender } = renderHook(
      ({ projectId }) => useConversations("org-1", projectId),
      { initialProps: { projectId: "project-1" }, wrapper: server.wrapper },
    );
    await waitFor(() =>
      expect(result.current.data?.[0]?.title).toBe("A conversation"),
    );

    rerender({ projectId: "project-2" });
    expect(result.current.data?.[0]?.title).not.toBe("A conversation");
    await waitFor(() =>
      expect(result.current.data?.[0]?.title).toBe("Project two"),
    );
    expect(server.received("GetActiveConversations")).toHaveLength(2);
  });

  it("keeps simultaneous reads with identical filters independent across organizations and projects", async () => {
    server.conversationsByPath.set(
      "/organizations/org-1/projects/project-2/graphql",
      [{ ...conversationNode, title: "Project two" }],
    );
    server.conversationsByPath.set(
      "/organizations/org-2/projects/project-1/graphql",
      [{ ...conversationNode, title: "Organization two" }],
    );
    const { result } = renderHook(
      () => ({
        first: useConversations("org-1", "project-1"),
        second: useConversations("org-1", "project-2"),
        third: useConversations("org-2", "project-1"),
      }),
      { wrapper: server.wrapper },
    );

    await waitFor(() => {
      expect(result.current.first.data?.[0]?.title).toBe("A conversation");
      expect(result.current.second.data?.[0]?.title).toBe("Project two");
      expect(result.current.third.data?.[0]?.title).toBe("Organization two");
    });
    expect(server.received("GetActiveConversations")).toHaveLength(3);
  });

  it("revalidates opted-in views on visibility recovery while their data is fresh", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    try {
      const { result } = renderHook(
        () => ({
          first: useConversations("org-1", "project-1", {
            refetchOnWindowFocus: true,
          }),
          second: useConversations("org-1", "project-1", {
            refetchOnWindowFocus: true,
          }),
        }),
        { wrapper: server.wrapper },
      );
      await waitFor(() =>
        expect(result.current.second.data?.[0]?.title).toBe("A conversation"),
      );
      expect(result.current.first.isStale).toBe(false);
      expect(server.received("GetActiveConversations")).toHaveLength(1);

      server.conversations = [
        { ...conversationNode, title: "Changed while hidden" },
      ];
      act(() => {
        visibility.mockReturnValue("hidden");
        document.dispatchEvent(new Event("visibilitychange"));
        visibility.mockReturnValue("visible");
        document.dispatchEvent(new Event("visibilitychange"));
        expect(result.current.first.data?.[0]?.title).toBe("A conversation");
      });

      await waitFor(() => {
        expect(result.current.first.data?.[0]?.title).toBe(
          "Changed while hidden",
        );
        expect(result.current.second.data?.[0]?.title).toBe(
          "Changed while hidden",
        );
      });
      expect(server.received("GetActiveConversations")).toHaveLength(2);
    } finally {
      visibility.mockRestore();
    }
  });

  it("shares one cached record between a list and the detail view", async () => {
    const { result } = renderHook(
      () => ({
        list: useConversations("org-1", "project-1"),
        detail: useConversation("org-1", "project-1", {
          conversationId: "conv-1",
        }),
      }),
      { wrapper: server.wrapper },
    );
    await waitFor(() => {
      expect(result.current.list.isReady).toBe(true);
      expect(result.current.detail.isReady).toBe(true);
    });

    expect(result.current.detail.data?.title).toBe("A conversation");
    const cache = server.graphql
      .forProject({
        organizationId: "org-1",
        projectId: "project-1",
      })
      .cache.extract();
    expect(cache['Conversation:{"id":"conv-1"}']).toBeDefined();
    expect(
      Object.keys(cache).filter((key) => key.startsWith("Conversation:")),
    ).toHaveLength(2);
  });
});
