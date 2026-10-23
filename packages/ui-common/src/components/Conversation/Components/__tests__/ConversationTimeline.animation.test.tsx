import React from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageType } from "../../../../api";
import type { ConversationMessage as ConversationMessageType } from "../../../../types/conversation";
import { ConversationTimeline } from "../ConversationTimeline";

type MockConversationMessageProps = {
  conversationMessage: ConversationMessageType;

};

const mockUseConversationContext = vi.fn();
const mockConversationMessage = vi.fn();

vi.mock("../ConversationContext", () => ({
  useConversationContext: () => mockUseConversationContext(),
}));

vi.mock("../ConversationMessage", () => ({
  ConversationMessage: (props: MockConversationMessageProps) => {
    mockConversationMessage(props);
    return (
      <div data-testid={`message-${props.conversationMessage.message.id}`} />
    );
  },
}));

vi.mock("../../../../animations", () => ({
  FadeIn: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="fade-in">{children}</div>
  ),
}));

const createTimelineMessage = (id: string): ConversationMessageType =>
  ({
    message: {
      id,
      type: MessageType.System,
      data: { type: "QUESTIONS" },
    },
    state: "completed",
    canEdit: false,
  } as unknown as ConversationMessageType);

describe("ConversationTimeline history animation", () => {
  const getContextValue = (
    timeline: ConversationMessageType[],
    conversationId = "conversation-1"
  ) => ({
    project: { id: "project", organizationId: "organization" },
    activeConversation: { id: conversationId },
    conversationTimeline: timeline,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not animate initial history in new-only mode, but animates later messages", () => {
    const timelineState = {
      timeline: [
        createTimelineMessage("msg-1"),
        createTimelineMessage("msg-2"),
      ],
      conversationId: "conversation-1",
    };

    mockUseConversationContext.mockImplementation(() =>
      getContextValue(timelineState.timeline, timelineState.conversationId)
    );

    const { rerender } = render(
      <ConversationTimeline
        messageAnimationMode="new-only"
        data-testid="timeline-initial"
      />
    );

    expect(mockConversationMessage).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('[data-testid="fade-in"]')).toHaveLength(
      0
    );

    timelineState.timeline = [
      createTimelineMessage("msg-1"),
      createTimelineMessage("msg-2"),
      createTimelineMessage("msg-3"),
    ];

    rerender(
      <ConversationTimeline
        messageAnimationMode="new-only"
        data-testid="timeline-updated"
      />
    );

    expect(mockConversationMessage).toHaveBeenCalledTimes(5);
    expect(document.querySelectorAll('[data-testid="fade-in"]')).toHaveLength(
      1
    );
  });
});
