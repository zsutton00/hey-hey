import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  MessageStatus,
  SystemMessageDataTypeEnum,
  type MessageResponseDto,
} from "../../../api";
import { GetConversationMessageHistoryDocument } from "../../../graphql/generated/graphql";
import {
  FakeConversationServer,
  threadOf,
} from "../../../test/conversationGraphQL";
import {
  readCachedConversationMentionOptions,
  useCachedConversationMentionOptions,
} from "../useCachedConversationMentionOptions";

const userMessage = (
  id: string,
  comment: string,
  conversationId = "conversation-1",
): MessageResponseDto => ({
  id,
  projectId: "project-1",
  conversationId,
  type: "USER",
  status: MessageStatus.Completed,
  createdAt: "2026-08-09T12:00:00.000Z",
  data: { comment },
});

const systemMessage = (
  id: string,
  response: string,
  conversationId = "conversation-1",
): MessageResponseDto => ({
  id,
  projectId: "project-1",
  conversationId,
  type: "SYSTEM",
  status: MessageStatus.Completed,
  createdAt: "2026-08-09T12:01:00.000Z",
  awaitingResponse: false,
  data: { type: SystemMessageDataTypeEnum.Agent, response },
});

describe("useCachedConversationMentionOptions", () => {
  it("extracts USER and SYSTEM mentions and deduplicates by type and id", () => {
    expect(
      readCachedConversationMentionOptions([
        userMessage(
          "user-1",
          "Review @[task:task-1|First title] and @[feature:feature-1|Feature one].",
        ),
        systemMessage(
          "system-1",
          "Updated @[task:task-1|Canonical title] and @\\[service:service-1|API].",
        ),
      ]),
    ).toEqual([
      { id: "task-1", type: "task", name: "Canonical title" },
      { id: "feature-1", type: "feature", name: "Feature one" },
      { id: "service-1", type: "service", name: "API" },
    ]);
  });

  it("observes only the selected project's cached thread without fetching", async () => {
    const scope = { organizationId: "org-1", projectId: "project-1" };
    const server = new FakeConversationServer(threadOf(1));
    server.rename("m1", {
      response: "See @[workflow:workflow-1|Release flow].",
    });
    const { result } = renderHook(
      () =>
        useCachedConversationMentionOptions(
          scope.organizationId,
          scope.projectId,
          "conv-1",
        ),
      { wrapper: server.wrapper },
    );
    expect(result.current).toEqual([]);

    const loadThread = (projectId: string) => {
      const project = { ...scope, projectId };
      return server.graphql.forProject(project).query({
        query: GetConversationMessageHistoryDocument,
        variables: { id: "conv-1", last: 8 },
        context: project,
      });
    };
    await act(async () => {
      await loadThread("project-2");
    });
    expect(result.current).toEqual([]);

    await act(async () => {
      await loadThread("project-1");
    });
    await waitFor(() =>
      expect(result.current).toEqual([
        { id: "workflow-1", type: "workflow", name: "Release flow" },
      ]),
    );
    expect(server.requests).toHaveLength(2);
  });

  it("does not scan serialized transport metadata", () => {
    const message = userMessage("user-1", "Visible text");
    message.data.transportMetadata = {
      hidden: "@[task:hidden-task|Hidden task]",
    };
    expect(readCachedConversationMentionOptions([message])).toEqual([]);
  });
});
