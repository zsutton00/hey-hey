import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageAuthorCaption } from "../MessageAuthorCaption";
import { formatMessageTimestamp } from "../messageTimestamp";
import {
  UserMessageAgentInputProvenance,
  type SystemMessageData,
} from "../../../../api";

vi.mock("../../../shared/UserLink", () => ({
  UserLink: ({
    userId,
    children,
  }: {
    userId: string;
    projectId: string;
    children: React.ReactNode;
  }) => (
    <a href={`/users/${userId}`} data-testid={`user-link-${userId}`}>
      {children}
    </a>
  ),
}));

const renderCaption = (
  props: React.ComponentProps<typeof MessageAuthorCaption>
) =>
  render(
    <MemoryRouter>
      <MessageAuthorCaption {...props} />
    </MemoryRouter>
  );

const AGENT_MESSAGE_DATA: SystemMessageData = {
  type: "AGENT",
  providerSessionId: "provider-session-123",
  promptHandler: "coding_prompt",
};

describe("MessageAuthorCaption", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("agent variant", () => {
    it("renders agent caption with correct testid", () => {
      renderCaption({
        messageId: "msg-1",
        createdAt: "2024-01-01T12:00:00Z",
        messageData: AGENT_MESSAGE_DATA,
        projectId: "project-1",
      });

      expect(screen.getByTestId("agent-caption-msg-1")).toBeInTheDocument();
    });

    it("derives agent label from promptHandler in Title Case", () => {
      renderCaption({
        messageId: "msg-1",
        createdAt: "2024-01-01T12:00:00Z",
        messageData: AGENT_MESSAGE_DATA,
        projectId: "project-1",
      });

      expect(
        screen.getByTestId("agent-caption-tooltip-msg-1")
      ).toHaveTextContent("Coding Prompt agent");
    });

    it("renders tooltip anchor when both providerSessionId and promptHandler are present", () => {
      renderCaption({
        messageId: "msg-1",
        createdAt: "2024-01-01T12:00:00Z",
        messageData: AGENT_MESSAGE_DATA,
        projectId: "project-1",
      });

      expect(
        screen.getByTestId("agent-caption-tooltip-msg-1")
      ).toBeInTheDocument();
    });

    it("renders plain label without tooltip when providerSessionId is absent", () => {
      renderCaption({
        messageId: "msg-1",
        createdAt: "2024-01-01T12:00:00Z",
        messageData: {
          type: "AGENT",
          promptHandler: "coding_prompt",
        } as SystemMessageData,
        projectId: "project-1",
      });

      expect(
        screen.queryByTestId("agent-caption-tooltip-msg-1")
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("agent-caption-msg-1")).toHaveTextContent(
        "Coding Prompt agent"
      );
    });

    it("renders plain label without tooltip when promptHandler is absent", () => {
      renderCaption({
        messageId: "msg-1",
        createdAt: "2024-01-01T12:00:00Z",
        messageData: {
          type: "AGENT",
          providerSessionId: "sess-1",
        } as SystemMessageData,
        projectId: "project-1",
      });

      expect(
        screen.queryByTestId("agent-caption-tooltip-msg-1")
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("agent-caption-msg-1")).toHaveTextContent(
        "Agent"
      );
    });

    it("falls back to 'Agent' label when promptHandler is absent", () => {
      renderCaption({
        messageId: "msg-1",
        createdAt: "2024-01-01T12:00:00Z",
        messageData: { type: "AGENT" } as SystemMessageData,
        projectId: "project-1",
      });

      expect(screen.getByTestId("agent-caption-msg-1")).toHaveTextContent(
        "Agent"
      );
    });

    it("appends timestamp when renderTimestamp is true", () => {
      renderCaption({
        messageId: "msg-1",
        createdAt: "2024-01-01T12:00:00Z",
        messageData: { type: "AGENT" } as SystemMessageData,
        projectId: "project-1",
        renderTimestamp: true,
      });

      const caption = screen.getByTestId("agent-caption-msg-1");
      expect(caption.textContent).toMatch(/Agent\s*·/);
    });

    it("omits timestamp when renderTimestamp is false", () => {
      renderCaption({
        messageId: "msg-1",
        createdAt: "2024-01-01T12:00:00Z",
        messageData: { type: "AGENT" } as SystemMessageData,
        projectId: "project-1",
        renderTimestamp: false,
      });

      expect(screen.getByTestId("agent-caption-msg-1").textContent).toBe(
        "Agent"
      );
    });

    it("renders and updates the active interstitial duration", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-01T12:00:05Z"));

      renderCaption({
        messageId: "msg-1",
        createdAt: "2024-01-01T11:00:00Z",
        messageData: { type: "AGENT" } as SystemMessageData,
        projectId: "project-1",
        renderTimestamp: true,
        isInterstitialMessage: true,
        interstitialActive: true,
        interstitialTiming: {
          startAt: "2024-01-01T12:00:00Z",
        },
      });

      expect(screen.getByTestId("agent-caption-msg-1")).toHaveTextContent(
        "thinking for 5s"
      );

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(screen.getByTestId("agent-caption-msg-1")).toHaveTextContent(
        "thinking for 7s"
      );
      vi.useRealTimers();
    });

    it("renders the final sealed interstitial duration", () => {
      renderCaption({
        messageId: "msg-1",
        createdAt: "2024-01-01T11:00:00Z",
        messageData: { type: "AGENT" } as SystemMessageData,
        projectId: "project-1",
        renderTimestamp: true,
        isInterstitialMessage: true,
        interstitialActive: false,
        interstitialTiming: {
          startAt: "2024-01-01T12:00:00Z",
          endAt: "2024-01-01T12:01:02Z",
        },
      });

      expect(screen.getByTestId("agent-caption-msg-1")).toHaveTextContent(
        "thought for 1m 2s"
      );
      expect(screen.getByTestId("agent-caption-msg-1")).not.toHaveTextContent(
        "started"
      );
    });

    it("does not fall back to the creation timestamp for an interstitial", () => {
      renderCaption({
        messageId: "msg-1",
        createdAt: "2024-01-01T12:00:00Z",
        messageData: { type: "AGENT" } as SystemMessageData,
        projectId: "project-1",
        renderTimestamp: true,
        isInterstitialMessage: true,
        interstitialActive: false,
        interstitialTiming: null,
      });

      expect(screen.getByTestId("agent-caption-msg-1").textContent).toBe(
        "Agent"
      );
    });
  });

  describe("user variant", () => {
    it("renders user caption with correct testid when userName is present", () => {
      renderCaption({
        messageId: "msg-2",
        createdAt: "2024-01-01T12:00:00Z",
        userName: "Alice Smith",
        userId: "user-1",
        projectId: "project-1",
        renderTimestamp: false,
      });

      expect(screen.getByTestId("message-timestamp-msg-2")).toBeInTheDocument();
    });

    it("renders UserLink when userName and userId are present", () => {
      renderCaption({
        messageId: "msg-2",
        createdAt: "2024-01-01T12:00:00Z",
        userName: "Alice Smith",
        userId: "user-1",
        projectId: "project-1",
        renderTimestamp: false,
      });

      expect(screen.getByTestId("user-link-user-1")).toBeInTheDocument();
      expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    });

    it("appends timestamp to user caption when renderTimestamp is true", () => {
      renderCaption({
        messageId: "msg-2",
        createdAt: "2024-01-01T12:00:00Z",
        userName: "Alice Smith",
        userId: "user-1",
        projectId: "project-1",
        renderTimestamp: true,
      });

      const caption = screen.getByTestId("message-timestamp-msg-2");
      expect(caption.textContent).toMatch(/Alice Smith\s*·/);
    });

    it("renders timestamp without user name when only createdAt is available", () => {
      renderCaption({
        messageId: "msg-2",
        createdAt: "2024-01-01T12:00:00Z",
        projectId: "project-1",
        renderTimestamp: true,
      });

      expect(screen.getByTestId("message-timestamp-msg-2")).toBeInTheDocument();
    });

    it("renders agent caption for session-monitor authored user messages", () => {
      renderCaption({
        messageId: "msg-2",
        createdAt: "2024-01-01T12:00:00Z",
        userMessageProvenance: UserMessageAgentInputProvenance.SessionMonitor,
        userName: "Alice Smith",
        userId: "user-1",
        projectId: "project-1",
      });

      expect(screen.getByTestId("agent-caption-msg-2")).toHaveTextContent(
        "Auto-run Agent"
      );
      expect(screen.queryByTestId("user-link-user-1")).not.toBeInTheDocument();
    });

    it("renders agent caption for task-monitor authored user messages", () => {
      renderCaption({
        messageId: "msg-2",
        createdAt: "2024-01-01T12:00:00Z",
        userMessageProvenance: UserMessageAgentInputProvenance.TaskMonitor,
        userName: "Alice Smith",
        userId: "user-1",
        projectId: "project-1",
      });

      expect(screen.getByTestId("agent-caption-msg-2")).toHaveTextContent(
        "Auto-run Agent"
      );
      expect(screen.queryByTestId("user-link-user-1")).not.toBeInTheDocument();
    });

    it("returns null when no messageData, no userName, and renderTimestamp is false", () => {
      renderCaption({
        messageId: "msg-2",
        createdAt: "2024-01-01T12:00:00Z",
        projectId: "project-1",
        renderTimestamp: false,
      });

      expect(
        screen.queryByTestId("message-timestamp-msg-2")
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("agent-caption-msg-2")
      ).not.toBeInTheDocument();
    });
  });

  describe("formatMessageTimestamp", () => {
    it("returns the raw string for an invalid date", () => {
      expect(formatMessageTimestamp("not-a-date")).toBe("not-a-date");
    });

    it("returns a formatted time string for a valid ISO date", () => {
      const result = formatMessageTimestamp("2024-01-01T12:00:00Z");
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });
  });
});
