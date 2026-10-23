import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  MessageStatus,
  SystemMessageDataTypeEnum,
  type MessageResponseDto,
} from "../../../api";
import { platformClient } from "../../../clients/serviceClients";
import {
  getCachedMessagesForConversation,
  messageKeys,
} from "../../collections/messages";
import {
  readCachedConversationMentionOptions,
  useCachedConversationMentionOptions,
} from "../useCachedConversationMentionOptions";

vi.mock("../../../clients/serviceClients", () => ({
  platformClient: { getMessages: vi.fn() },
}));

const userMessage = (
  id: string,
  comment: string,
  conversationId = "conversation-1"
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
  conversationId = "conversation-1"
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

const createQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });

/** Appends to the conversation's cached message list. */
const addMessage = (
  queryClient: QueryClient,
  message: MessageResponseDto
): void => {
  queryClient.setQueryData<MessageResponseDto[]>(
    messageKeys.list("org-1", "project-1", message.conversationId),
    (current = []) => [...current, message]
  );
};

/** Caches a single-message read, outside any list. */
const addSingleMessage = (
  queryClient: QueryClient,
  message: MessageResponseDto
): void => {
  queryClient.setQueryData(
    messageKeys.byId("org-1", "project-1", message.id),
    message
  );
};

const wrapper = (queryClient: QueryClient) =>
  function TestProvider({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

describe("useCachedConversationMentionOptions", () => {
  it("extracts USER and SYSTEM mentions, scopes by conversation, and deduplicates by type and id", () => {
    const queryClient = createQueryClient();
    addMessage(
      queryClient,
      userMessage(
        "user-1",
        "Review @[task:task-1|First title] and @[feature:feature-1|Feature one]."
      )
    );
    addSingleMessage(
      queryClient,
      systemMessage(
        "system-1",
        "Updated @[task:task-1|Canonical title] and @\\[service:service-1|API]."
      )
    );
    addMessage(
      queryClient,
      userMessage("other-1", "Ignore @[goal:goal-1|Other].", "conversation-2")
    );

    expect(
      readCachedConversationMentionOptions(
        getCachedMessagesForConversation(queryClient, "conversation-1")
      )
    ).toEqual([
      { id: "task-1", type: "task", name: "Canonical title" },
      { id: "feature-1", type: "feature", name: "Feature one" },
      { id: "service-1", type: "service", name: "API" },
    ]);
  });

  it("reacts to cached collection updates without issuing a message request", () => {
    const queryClient = createQueryClient();
    const { result } = renderHook(
      () => useCachedConversationMentionOptions("conversation-1"),
      { wrapper: wrapper(queryClient) }
    );
    expect(result.current).toEqual([]);

    act(() => {
      addMessage(
        queryClient,
        userMessage("user-1", "See @[workflow:workflow-1|Release flow].")
      );
    });

    expect(result.current).toEqual([
      { id: "workflow-1", type: "workflow", name: "Release flow" },
    ]);
    expect(platformClient.getMessages).not.toHaveBeenCalled();
  });

  it("does not scan serialized transport metadata", () => {
    const queryClient = createQueryClient();
    const message = userMessage("user-1", "Visible text");
    message.data.transportMetadata = {
      hidden: "@[task:hidden-task|Hidden task]",
    };
    addMessage(queryClient, message);

    expect(
      readCachedConversationMentionOptions(
        getCachedMessagesForConversation(queryClient, "conversation-1")
      )
    ).toEqual([]);
  });
});
