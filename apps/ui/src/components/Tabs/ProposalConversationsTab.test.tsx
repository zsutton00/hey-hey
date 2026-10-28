import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProposalConversationsTab } from "./ProposalConversationsTab";

const {
  navigateMock,
  useProposalMock,
  useAgentSessionsMock,
  useConversationsMock,
  useConversationMessagesMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  useProposalMock: vi.fn(),
  useAgentSessionsMock: vi.fn(),
  useConversationsMock: vi.fn(),
  useConversationMessagesMock: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigateMock,
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  usePathService: () => ({
    conversation: ({ conversationId }: { conversationId: string }) =>
      `/conversations/${conversationId}`,
    resolveAgentSession: ({ conversationId }: { conversationId: string }) =>
      `/resolve-sessions/${conversationId}`,
    agentSession: ({ agentSessionId }: { agentSessionId: string }) =>
      `/sessions/${agentSessionId}`,
  }),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useProposal: useProposalMock,
  useAgentSessions: useAgentSessionsMock,
  useConversations: useConversationsMock,
  useConversationMessages: useConversationMessagesMock,
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  AgentSessionListItem: ({
    buildSessionPath,
    item,
  }: {
    buildSessionPath: (id: string) => string;
    item: {
      agentSession: { id: string; title: string };
      lastMessage: { data: { response?: string } } | null;
    };
  }) => (
    <button
      data-testid="shared-session-item"
      onClick={() => navigateMock(buildSessionPath(item.agentSession.id))}
    >
      {item.agentSession.title}
      {item.lastMessage?.data.response}
    </button>
  ),
  EntityListItem: ({ href, title }: { href: string; title: string }) => (
    <button
      data-testid="shared-conversation-item"
      onClick={() => navigateMock(href)}
    >
      {title}
    </button>
  ),
  conversationAdapter: {
    toEntityListItemProps: (conversation: { title: string }) => ({
      title: conversation.title,
    }),
  },
}));

const renderTab = () =>
  render(
    <MemoryRouter>
      <ProposalConversationsTab
        organizationId="org-1"
        projectId="project-1"
        proposalId="proposal-1"
      />
    </MemoryRouter>,
  );

describe("ProposalConversationsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProposalMock.mockReturnValue({
      proposal: {
        title: "Update launch policy",
        conversationId: "conversation-1",
        createdAt: "2026-10-26T21:05:04.535Z",
      },
      isLoading: false,
    });
    useAgentSessionsMock.mockImplementation(
      (
        _organizationId: string,
        _projectId: string,
        options?: { conversationId?: string },
      ) => ({
        agentSessions:
          options?.conversationId === "conversation-1"
            ? [
                {
                  id: "origin-session",
                  type: "CODING",
                  title: "Origin session",
                  conversationId: "conversation-1",
                  sessionDate: "2026-10-26T21:00:00.000Z",
                },
              ]
            : options?.conversationId === "refinement-conversation-1"
              ? [
                  {
                    id: "refinement-session",
                    type: "ENTITY_CONVERSATION",
                    title: "Proposal refinement",
                    conversationId: "refinement-conversation-1",
                    sessionDate: "2026-10-26T22:00:00.000Z",
                  },
                ]
              : [
                  {
                    id: "session-1",
                    type: "PROPOSAL_REFINING",
                    title: "Agent fix",
                    conversationId: "session-conversation-1",
                    sessionDate: "2026-10-26T22:00:00.000Z",
                    updatedAt: "2026-10-26T22:30:00.000Z",
                  },
                ],
        isLoading: false,
      }),
    );
    useConversationsMock.mockReturnValue({ data: [], isLoading: false });
    useConversationMessagesMock.mockImplementation(
      (
        _organizationId: string,
        _projectId: string,
        conversationId: string,
      ) => ({
        orderedData: [
          {
            id: `message-${conversationId}`,
            conversationId,
            type: "SYSTEM",
            status: "COMPLETED",
            data: {
              response:
                conversationId === "conversation-1"
                  ? "Origin latest message."
                  : "Agent fix completed.",
            },
            createdAt: "2026-10-26T22:30:00.000Z",
          },
        ],
      }),
    );
  });

  it("lists the origin conversation and agent sessions without review actions", () => {
    renderTab();

    expect(useAgentSessionsMock).toHaveBeenCalledWith("org-1", "project-1", {
      entityType: "PROPOSAL",
      entityId: "proposal-1",
    });
    const rows = screen.getAllByTestId("proposal-conversation-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Origin session");
    expect(rows[0]).toHaveTextContent("Origin latest message.");
    expect(screen.getByText("Origin conversation")).toBeInTheDocument();
    expect(screen.getByText("Proposal conversations")).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent("Agent fix");
    expect(rows[1]).toHaveTextContent("Agent fix completed.");
    expect(screen.queryByRole("button", { name: /accept|reject/i })).toBeNull();
  });

  it("opens the origin conversation and the session from their rows", async () => {
    const user = userEvent.setup();
    renderTab();

    const sessionRows = screen.getAllByTestId("shared-session-item");
    await user.click(sessionRows[0]!);
    expect(navigateMock).toHaveBeenLastCalledWith("/sessions/origin-session");
    await user.click(sessionRows[1]!);
    expect(navigateMock).toHaveBeenLastCalledWith("/sessions/session-1");
  });

  it("separates the origin from proposal-scoped conversations and opens those directly", async () => {
    const user = userEvent.setup();
    useConversationsMock.mockReturnValue({
      data: [
        {
          id: "refinement-conversation-1",
          title: "Proposal refinement",
          createdAt: "2026-10-26T22:30:00.000Z",
        },
      ],
      isLoading: false,
    });
    renderTab();

    expect(screen.getByText("Origin conversation")).toBeInTheDocument();
    expect(screen.getByText("Proposal conversations")).toBeInTheDocument();
    await user.click(screen.getByText("Proposal refinement"));
    expect(navigateMock).toHaveBeenLastCalledWith(
      "/sessions/refinement-session",
    );
  });

  it("says so when there are no conversations", () => {
    useProposalMock.mockReturnValue({
      proposal: { title: "Update launch policy", conversationId: null },
      isLoading: false,
    });
    useAgentSessionsMock.mockReturnValue({
      agentSessions: [],
      isLoading: false,
    });
    useConversationsMock.mockReturnValue({ data: [], isLoading: false });
    useConversationMessagesMock.mockReturnValue({ orderedData: [] });
    renderTab();

    expect(
      screen.getByText("No conversations about this proposal yet."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("proposal-conversation-row")).toBeNull();
  });
});
