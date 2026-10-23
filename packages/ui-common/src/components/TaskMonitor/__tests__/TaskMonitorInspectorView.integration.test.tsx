import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationResponseDto, ProjectResponseDto } from "../../../api";
import { TaskMonitorConversationPane } from "../TaskMonitorConversationPane";

const conversationViewerState = vi.hoisted(() => ({ shouldThrow: false }));

vi.mock("../../Conversation", () => ({
  ConversationViewer: (props: {
    readOnly?: boolean;
    conversation: ConversationResponseDto;
    scrollPolicy: {
      mode: string;
      ownerRef?: { current: HTMLElement | null };
    };
  }) => (
    conversationViewerState.shouldThrow ? (
      (() => {
        throw new Error("conversation renderer failed");
      })()
    ) : (
      <div
        data-testid="read-only-conversation"
        data-read-only={String(props.readOnly)}
        data-scroll-mode={props.scrollPolicy.mode}
        data-has-scroll-owner={String(Boolean(props.scrollPolicy.ownerRef?.current))}
      >
        {props.conversation.id}
      </div>
    )
  ),
}));

const conversation = {
  id: "44444444-4444-4444-8444-444444444444",
  messages: [],
} as ConversationResponseDto;
const project = {
  id: "55555555-5555-4555-8555-555555555555",
  name: "Project",
} as ProjectResponseDto;

describe("TaskMonitorConversationPane", () => {
  beforeEach(() => {
    conversationViewerState.shouldThrow = false;
  });

  it("uses the shared readiness boundary before rendering conversation data", () => {
    const { rerender } = render(
      <TaskMonitorConversationPane
        title="Second task session"
        conversation={null}
        project={null}
        readOnly
        loading
        fetched={false}
        errorMessage={null}
        emptyMessage="No conversation."
        testId="test-pane"
        sessionHref="/projects/project-1/resolve-agent-session-by-id/33333333-3333-4333-8333-333333333333"
        agentSessionMetadata={{
          provider: "codex",
          model: "gpt-5-codex",
          effort: "high",
        }}
      />
    );
    expect(screen.getByTestId("data-state-boundary-loading")).toBeVisible();
    expect(screen.getByTestId("task-monitor-session-title-link")).toHaveAttribute(
      "href",
      "/projects/project-1/resolve-agent-session-by-id/33333333-3333-4333-8333-333333333333"
    );
    expect(screen.getByTestId("task-monitor-session-title-link")).toHaveClass(
      "MuiTypography-subtitle1"
    );
    expect(screen.getByTestId("task-monitor-session-icon")).toBeVisible();
    expect(screen.getByTestId("agent-session-metadata")).toHaveAttribute(
      "data-placement",
      "below-conversation"
    );
    expect(screen.getByTestId("test-pane")).toHaveStyle({
      backgroundColor: "rgba(0, 0, 0, 0.04)",
    });

    rerender(
      <TaskMonitorConversationPane
        title="Second task session"
        conversation={conversation}
        project={project}
        readOnly
        loading={false}
        fetched
        errorMessage={null}
        emptyMessage="No conversation."
        testId="test-pane"
        sessionHref="/projects/project-1/resolve-agent-session-by-id/33333333-3333-4333-8333-333333333333"
        agentSessionMetadata={{
          provider: "codex",
          model: "gpt-5-codex",
          effort: "high",
        }}
      />
    );
    expect(screen.getByRole("link", { name: "Second task session" })).toHaveAttribute(
      "href",
      "/projects/project-1/resolve-agent-session-by-id/33333333-3333-4333-8333-333333333333"
    );
    expect(screen.queryByTestId("task-monitor-open-session")).not.toBeInTheDocument();
    expect(screen.getByTestId("agent-session-metadata-model")).toHaveTextContent(
      "gpt-5-codex"
    );
    expect(screen.getByTestId("read-only-conversation")).toHaveAttribute(
      "data-read-only",
      "true"
    );
    expect(screen.getByTestId("read-only-conversation")).toHaveAttribute(
      "data-scroll-mode",
      "owned"
    );
    expect(screen.getByTestId("read-only-conversation")).toHaveAttribute(
      "data-has-scroll-owner",
      "true"
    );
  });

  it("renders explicit error and empty states after readiness", () => {
    const { rerender } = render(
      <TaskMonitorConversationPane
        title="Monitor activity"
        conversation={null}
        project={null}
        readOnly={false}
        loading={false}
        fetched
        errorMessage="Monitor activity could not be loaded."
        emptyMessage="No activity."
        testId="test-pane"
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");

    rerender(
      <TaskMonitorConversationPane
        title="Monitor activity"
        conversation={null}
        project={project}
        readOnly={false}
        loading={false}
        fetched
        errorMessage={null}
        emptyMessage="No activity."
        testId="test-pane"
      />
    );
    expect(screen.getByText("No activity.")).toBeVisible();
  });

  it("renders the session title as the only navigation affordance", () => {
    render(
      <TaskMonitorConversationPane
        title="Second task session"
        conversation={null}
        project={null}
        readOnly
        loading={false}
        fetched
        errorMessage={null}
        emptyMessage="This session does not have a conversation."
        testId="test-pane"
        sessionHref="/projects/project-1/resolve-agent-session-by-id/33333333-3333-4333-8333-333333333333"
      />
    );

    expect(
      screen.getByRole("link", { name: "Second task session" })
    ).toHaveAttribute(
      "href",
      "/projects/project-1/resolve-agent-session-by-id/33333333-3333-4333-8333-333333333333"
    );
    expect(screen.getByTestId("task-monitor-session-icon")).toBeVisible();
    expect(screen.queryByTestId("task-monitor-open-session")).not.toBeInTheDocument();
    expect(screen.getByText("This session does not have a conversation.")).toBeVisible();
  });

  it("can expose the coordinator activity conversation for replies", () => {
    render(
      <TaskMonitorConversationPane
        title="Monitor activity"
        conversation={conversation}
        project={project}
        readOnly={false}
        loading={false}
        fetched
        errorMessage={null}
        emptyMessage="No activity."
        testId="activity-pane"
      />
    );

    expect(screen.getByTestId("read-only-conversation")).toHaveAttribute(
      "data-read-only",
      "false"
    );
  });

  it("contains conversation rendering failures inside the pane", () => {
    conversationViewerState.shouldThrow = true;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      render(
        <TaskMonitorConversationPane
          title="Monitor activity"
          conversation={conversation}
          project={project}
          readOnly={false}
          loading={false}
          fetched
          errorMessage={null}
          emptyMessage="No activity."
          testId="activity-pane"
        />
      );

      expect(screen.getByTestId("activity-pane-conversation-error")).toHaveTextContent(
        "rest of the Task Monitor remains available"
      );
      expect(screen.getByTestId("activity-pane")).toBeVisible();
    } finally {
      consoleError.mockRestore();
    }
  });
});
