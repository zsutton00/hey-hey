import {
  AgentSessionCurrentState,
  AgentSessionStatus,
  AgentSessionType,
  MessageStatus,
  MessageType,
  type PaginatedAgentSessionItemDto,
} from "../../../api";
import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionListItem } from "../AgentSessionListItem";

const mocks = vi.hoisted(() => ({
  adapter: vi.fn(),
  currentStatePresentation: vi.fn(),
  currentStateIndicator: vi.fn(),
  entityListItem: vi.fn(),
  entityConversationTitle: vi.fn(),
  interstitialThought: vi.fn(),
  metadataDisclosure: vi.fn(),
  splitInterstitialThoughts: vi.fn(),
  systemMessage: vi.fn(),
}));

vi.mock("../../AgentSession/AgentSessionCurrentStateIndicator", () => ({
  AgentSessionCurrentStateIndicator: (props: {
    currentState: AgentSessionCurrentState;
    presentation: string;
  }) => {
    mocks.currentStateIndicator(props);
    return <span data-testid="current-state-indicator" />;
  },
}));

vi.mock("../../AgentSession/agentSessionCurrentStatePresentation", () => ({
  getAgentSessionCurrentStatePresentation: (currentState: string) => {
    mocks.currentStatePresentation(currentState);
    return { label: currentState };
  },
}));

vi.mock("../../Conversation/Components/SystemMessage", () => ({
  SystemMessage: (props: { text: string }) => {
    mocks.systemMessage(props);
    return <div data-testid="system-message">{props.text || "Reports"}</div>;
  },
}));

vi.mock("../../Entity/EntityListItem", () => ({
  EntityListItem: (props: {
    metadata?: readonly { label: string; value: string }[];
    onDelete?: () => void;
    status?: string;
    statusLeadingAdornment?: React.ReactNode;
    tags?: string[];
    title: React.ReactNode;
  }) => {
    mocks.entityListItem(props);
    return (
      <div data-testid="entity-list-item">
        {props.title}
        {props.status}
        {props.statusLeadingAdornment}
        {props.onDelete ? (
          <button onClick={props.onDelete} type="button">
            Delete
          </button>
        ) : null}
      </div>
    );
  },
}));

vi.mock("../EntityConversationTitle", () => ({
  EntityConversationTitle: (props: {
    conversationTitle: string;
    entityId?: string;
  }) => {
    mocks.entityConversationTitle(props);
    return <span data-testid="entity-conversation-title" />;
  },
}));

vi.mock("../../Entity/adapters", () => ({
  agentSessionAdapter: {
    toEntityListItemProps: (...args: unknown[]) => mocks.adapter(...args),
  },
}));

vi.mock("../../LlmForms/Registry/InterstitialField", () => ({
  InterstitialThought: (props: { thought: string }) => {
    mocks.interstitialThought(props);
    return <div data-testid="interstitial-thought">{props.thought}</div>;
  },
  isInterstitialMessageData: (messageData: {
    uiElements?: { type: string }[];
  }) =>
    messageData.uiElements?.some(
      (element) => element.type === "interstitial"
    ) === true,
  splitInterstitialThoughts: (body: string) =>
    mocks.splitInterstitialThoughts(body),
}));

vi.mock("../../shared/MarkdownRenderer", () => ({
  MarkdownRenderer: (props: { children: string }) => (
    <div data-testid="user-message">{props.children}</div>
  ),
}));

vi.mock("../../shared/MetadataDisclosure", () => ({
  MetadataDisclosure: (props: {
    rows: readonly { label: string; value: string }[];
  }) => {
    mocks.metadataDisclosure(props);
    return <div data-testid="metadata-disclosure">{props.rows[0]?.value}</div>;
  },
}));

const makeItem = (
  messageData: Record<string, unknown> = {
    response: "Completed",
    type: "AGENT",
  }
): PaginatedAgentSessionItemDto => ({
  agentSession: {
    id: "session-1",
    organizationId: "org-1",
    projectId: "project-1",
    userId: "user-1",
    status: AgentSessionStatus.Completed,
    currentState: AgentSessionCurrentState.Thinking,
    conversationId: "conversation-1",
    serviceIds: ["service-1"],
    launchServiceId: "service-1",
    sessionDate: "2026-08-12T00:00:00.000Z",
    title: "Agent session",
    hasUnsyncedChanges: false,
    monitoringEnabled: false,
    autoDecide: false,
    type: AgentSessionType.Coding,
  },
  lastMessage: {
    id: "message-1",
    conversationId: "conversation-1",
    type: MessageType.System,
    status: MessageStatus.Completed,
    data: messageData,
    createdAt: "2026-08-12T00:01:00.000Z",
  },
  parentEntity: null,
  services: [{ id: "service-1", name: "API" }],
  reports: [
    {
      id: "report-1",
      organizationId: "org-1",
      reportType: "IMPLEMENT",
      audience: "PROJECT_VISIBLE",
      title: "Implementation report",
      payload: {},
      version: 1,
      schemaVersion: 1,
      createdAt: "2026-08-12T00:01:01.000Z",
      expiresAt: "2026-09-12T00:01:01.000Z",
      entities: [],
    },
  ],
});

describe("AgentSessionListItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.adapter.mockReturnValue({
      href: "/projects/project-1/agent-sessions/session-1",
      metadata: [{ label: "Provider", value: "Codex" }],
      status: "Completed",
      tags: ["Coding"],
      title: "Agent session",
    });
    mocks.splitInterstitialThoughts.mockReturnValue(["Final thought"]);
  });

  it("renders coding rows with lifecycle, current state, latest message, and metadata", () => {
    const item = makeItem();
    render(
      <MemoryRouter>
        <AgentSessionListItem
          item={item}
          projectId="project-1"
          variant="coding"
        />
      </MemoryRouter>
    );

    expect(mocks.entityListItem).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "Completed",
        statusLeadingAdornment: expect.anything(),
        tags: undefined,
      })
    );
    expect(mocks.currentStateIndicator).toHaveBeenCalledWith({
      currentState: AgentSessionCurrentState.Thinking,
      presentation: "icon",
    });
    expect(mocks.systemMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        inlineReports: item.reports,
        text: "Completed",
      })
    );
    expect(mocks.metadataDisclosure).toHaveBeenCalledWith(
      expect.objectContaining({ rows: [{ label: "Provider", value: "Codex" }] })
    );
  });

  it("passes the coding-session title and entity id to the conversation title", () => {
    const item = makeItem();
    item.agentSession = {
      ...item.agentSession,
      entityId: "feature-1",
      entityType: "TASK",
      title: "Implement Search",
    };
    item.parentEntity = {
      id: "feature-1",
      name: "Search",
      type: "TASK",
    };

    render(
      <MemoryRouter>
        <AgentSessionListItem
          item={item}
          projectId="project-1"
          variant="coding"
        />
      </MemoryRouter>
    );

    expect(mocks.entityConversationTitle).toHaveBeenCalledWith({
      conversationTitle: "Implement Search",
      entityId: "feature-1",
    });
  });

  it("renders conversation rows with state metadata and service context", () => {
    const item = makeItem();
    render(
      <MemoryRouter>
        <AgentSessionListItem
          item={item}
          projectId="project-1"
          variant="conversations"
        />
      </MemoryRouter>
    );

    expect(mocks.entityListItem).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: [{ label: "Provider", value: "Codex" }],
        status: AgentSessionCurrentState.Thinking,
        tags: ["Coding", "Launch service: API"],
        statusLeadingAdornment: undefined,
      })
    );
    expect(mocks.currentStatePresentation).toHaveBeenCalledWith(
      AgentSessionCurrentState.Thinking
    );
    expect(screen.queryByTestId("metadata-disclosure")).not.toBeInTheDocument();
  });

  it("passes the conversation title and entity id for entity conversations", () => {
    const item = makeItem();
    item.agentSession = {
      ...item.agentSession,
      entityId: "task-1",
      entityType: "TASK",
      title: "Discuss Search",
      type: AgentSessionType.EntityConversation,
    };
    item.parentEntity = { id: "task-1", name: "Search", type: "TASK" };

    render(
      <MemoryRouter>
        <AgentSessionListItem
          item={item}
          projectId="project-1"
          variant="conversations"
        />
      </MemoryRouter>
    );

    expect(mocks.entityConversationTitle).toHaveBeenCalledWith({
      conversationTitle: "Discuss Search",
      entityId: "task-1",
    });
  });

  it("uses the session title and id when the parent entity differs", () => {
    const item = makeItem();
    item.agentSession = {
      ...item.agentSession,
      entityId: "task-1",
      entityType: "TASK",
      title: "Discuss Search",
      type: AgentSessionType.EntityConversation,
    };
    item.parentEntity = { id: "other-task", name: "Other", type: "TASK" };

    render(
      <MemoryRouter>
        <AgentSessionListItem
          item={item}
          projectId="project-1"
          variant="conversations"
        />
      </MemoryRouter>
    );

    expect(mocks.entityConversationTitle).toHaveBeenCalledWith({
      conversationTitle: "Discuss Search",
      entityId: "task-1",
    });
  });

  it("uses the final interstitial thought and keeps the full row navigable", () => {
    const item = makeItem({
      response: "First\n\n──────────\n\nFinal",
      type: "AGENT",
      uiElements: [{ id: "interstitial", type: "interstitial", label: "" }],
    });
    const onSessionNavigate = vi.fn();
    render(
      <MemoryRouter>
        <AgentSessionListItem
          buildSessionPath={() => "/custom-session-path"}
          item={item}
          onSessionNavigate={onSessionNavigate}
          projectId="project-1"
          variant="coding"
        />
      </MemoryRouter>
    );

    expect(mocks.interstitialThought).toHaveBeenCalledWith(
      expect.objectContaining({ thought: "Final thought" })
    );
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/custom-session-path"
    );
    expect(mocks.systemMessage).not.toHaveBeenCalled();
  });

  it.each(["coding", "conversations"] as const)(
    "renders the latest user message text in %s rows",
    (variant) => {
      const item = makeItem({
        agentInput: { promptType: "direct", userMessage: "Can we ship this?" },
      });
      item.lastMessage = { ...item.lastMessage!, type: MessageType.User };
      render(
        <MemoryRouter>
          <AgentSessionListItem
            item={item}
            projectId="project-1"
            variant={variant}
          />
        </MemoryRouter>
      );

      const itemName = variant === "coding" ? "coding-session" : "conversation";
      expect(
        screen.getByTestId(`${itemName}-message-content-session-1`)
      ).toHaveTextContent("Can we ship this?");
      expect(screen.getByTestId("user-message")).toBeInTheDocument();
      expect(screen.getByRole("link")).toContainElement(
        screen.getByTestId("user-message")
      );
      expect(mocks.systemMessage).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["without text", { type: "approve" }],
    [
      "with blank text",
      { agentInput: { promptType: "direct", userMessage: "  " } },
    ],
  ])("renders no preview for a user message %s", (_label, data) => {
    const item = makeItem(data);
    item.lastMessage = { ...item.lastMessage!, type: MessageType.User };
    render(
      <MemoryRouter>
        <AgentSessionListItem
          item={item}
          projectId="project-1"
          variant="conversations"
        />
      </MemoryRouter>
    );

    expect(
      screen.queryByTestId("conversation-message-session-1")
    ).not.toBeInTheDocument();
    expect(mocks.systemMessage).not.toHaveBeenCalled();
  });
});
