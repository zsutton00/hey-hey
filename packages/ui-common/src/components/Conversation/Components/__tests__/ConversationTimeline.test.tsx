import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createMockConversationMessage,
  createMockMessage,
  renderWithConversationProvider,
  mockShouldShowForm,
  mockCalculateMessageStatus,
} from "./conversationTestUtils";
import { ConversationTimeline } from "../ConversationTimeline";
import type { QuestionsSystemMessageData } from "../../../../api";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../../../animations", () => ({
  FadeIn: ({
    children,
    delay,
  }: {
    children: React.ReactNode;
    delay: number;
  }) => (
    <div data-testid="fade-in" data-delay={delay}>
      {children}
    </div>
  ),
}));

vi.mock("../SystemMessageWithRetry", () => ({
  SystemMessageWithRetry: ({
    message,
    state,
  }: {
    message: { id: string };
    state: string;
  }) => (
    <div data-testid={`system-message-${message.id}`} data-state={state}>
      retry message
    </div>
  ),
}));

vi.mock("../../../LlmForms/DynamicForm", () => ({
  DynamicForm: ({
    onNext,
  }: {
    onNext: (data: Record<string, unknown>) => void;
  }) => (
    <button
      type="button"
      data-testid="dynamic-form"
      onClick={() => onNext({ test: "data" })}
    >
      dynamic form
    </button>
  ),
}));

vi.mock("../../../LlmForms/SkeletonForm", () => ({
  SkeletonForm: () => <div data-testid="skeleton-form">skeleton</div>,
}));

describe("ConversationTimeline", () => {
  it.each([false, true])(
    "keeps mounted messages visible only when initial scroll readiness is %s",
    async (initialScrollReady) => {
      await renderWithConversationProvider(
        <ConversationTimeline
          data-testid="conversation-timeline"
          messageAnimationMode="none"
        />,
        { initialScrollReady }
      );
      const timeline = screen.getByTestId("conversation-timeline");
      expect(timeline.querySelector("[data-message-id]")).not.toBeNull();
      if (initialScrollReady) expect(timeline).toBeVisible();
      else expect(timeline).not.toBeVisible();
    }
  );
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders each conversation message with incremental fade delays", async () => {
    const firstMessage = createMockConversationMessage({
      message: createMockMessage({ id: "msg-1" }),
    });
    const secondMessage = createMockConversationMessage({
      message: createMockMessage({ id: "msg-2" }),
    });

    await renderWithConversationProvider(<ConversationTimeline />, {
      timeline: [firstMessage, secondMessage],
    });

    const fadeWrappers = screen.getAllByTestId("fade-in");
    expect(fadeWrappers).toHaveLength(2);
    expect(fadeWrappers[0]).toHaveAttribute("data-delay", "0");
    expect(fadeWrappers[1]).toHaveAttribute("data-delay", "0.1");

    expect(screen.getByTestId("msg-1")).toBeInTheDocument();
    expect(screen.getByTestId("msg-2")).toBeInTheDocument();
  });

  it("does not wrap messages in FadeIn when animation mode is none", async () => {
    const firstMessage = createMockConversationMessage({
      message: createMockMessage({ id: "msg-1" }),
    });
    const secondMessage = createMockConversationMessage({
      message: createMockMessage({ id: "msg-2" }),
    });

    await renderWithConversationProvider(
      <ConversationTimeline messageAnimationMode="none" />,
      {
        timeline: [firstMessage, secondMessage],
      }
    );

    expect(screen.queryByTestId("fade-in")).not.toBeInTheDocument();
    expect(screen.getByTestId("msg-1")).toBeInTheDocument();
    expect(screen.getByTestId("msg-2")).toBeInTheDocument();
  });

  it("renders SystemMessageWithRetry when a system response is available", async () => {
    const responseMessage = createMockConversationMessage({
      message: createMockMessage({
        id: "response-id",
        data: {
          type: "QUESTIONS",
          response: "Hello world",
        } as QuestionsSystemMessageData,
      }),
    });

    await renderWithConversationProvider(<ConversationTimeline />, {
      timeline: [responseMessage],
    });

    const systemMessage = screen.getByTestId("system-message-response-id");
    expect(systemMessage).toBeInTheDocument();
    expect(systemMessage).toHaveAttribute("data-state", "completed");
  });

  it("does not render forms when shouldShowForm returns false", async () => {
    const formMessage = createMockConversationMessage({
      message: createMockMessage({
        data: {
          type: "QUESTIONS",
          uiElements: [{ id: "field-1" }],
        } as QuestionsSystemMessageData,
      }),
    });

    await renderWithConversationProvider(<ConversationTimeline />, {
      timeline: [formMessage],
      shouldShowForm: false,
    });

    expect(mockShouldShowForm).toHaveBeenCalled();
    expect(screen.queryByTestId("dynamic-form")).not.toBeInTheDocument();
  });

  it("passes submission callbacks through the context when forms are rendered", async () => {
    const formMessage = createMockConversationMessage({
      message: createMockMessage({
        id: "form-message",
        data: {
          type: "QUESTIONS",
          uiElements: [{ id: "field-1" }],
        } as QuestionsSystemMessageData,
      }),
    });

    const { onNext } = await renderWithConversationProvider(
      <ConversationTimeline />,
      {
        timeline: [formMessage],
        calculateMessageStatus: "ready",
      }
    );

    expect(mockCalculateMessageStatus).toHaveBeenCalled();

    const form = screen.getByTestId("dynamic-form");
    form.click();

    expect(onNext).toHaveBeenCalledWith({ test: "data" }, "form-message");
  });

  it("uses the top-of-thread control to load the canonical older page", async () => {
    await renderWithConversationProvider(<ConversationTimeline />, {
      timeline: [
        createMockConversationMessage({
          message: createMockMessage({ id: "recent-message" }),
        }),
      ],
      historyCursor: "older-page",
    });

    const button = screen.getByTestId("show-older-messages-button");
    fireEvent.click(button);

    await waitFor(() => {
      expect(
        screen.queryByTestId("show-older-messages-button")
      ).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("recent-message")).toBeInTheDocument();
  });
});
