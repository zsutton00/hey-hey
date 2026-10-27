import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProposalConversationsTab } from "./ProposalConversationsTab";

const { navigateMock, useProposalMock, useAgentSessionsMock } = vi.hoisted(
  () => ({
    navigateMock: vi.fn(),
    useProposalMock: vi.fn(),
    useAgentSessionsMock: vi.fn(),
  }),
);

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigateMock,
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  usePathService: () => ({
    conversation: ({ conversationId }: { conversationId: string }) =>
      `/conversations/${conversationId}`,
    agentSession: ({ agentSessionId }: { agentSessionId: string }) =>
      `/sessions/${agentSessionId}`,
  }),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useProposal: useProposalMock,
  useAgentSessions: useAgentSessionsMock,
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
    useAgentSessionsMock.mockReturnValue({
      agentSessions: [
        {
          id: "session-1",
          type: "PROPOSAL_REFINING",
          title: "Agent fix",
          sessionDate: "2026-10-26T22:00:00.000Z",
          updatedAt: "2026-10-26T22:30:00.000Z",
        },
      ],
      isLoading: false,
    });
  });

  it("lists the origin conversation and agent sessions without review actions", () => {
    renderTab();

    expect(useAgentSessionsMock).toHaveBeenCalledWith("org-1", "project-1", {
      entityType: "PROPOSAL",
      entityId: "proposal-1",
    });
    const rows = screen.getAllByTestId("proposal-conversation-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Update launch policy");
    expect(rows[0]).toHaveTextContent("Origin conversation");
    expect(rows[1]).toHaveTextContent("Agent fix");
    expect(rows[1]).toHaveTextContent("Proposal Refining");
    expect(rows[1]).toHaveTextContent("Last active");
    expect(screen.queryByRole("button", { name: /accept|reject/i })).toBeNull();
  });

  it("opens the origin conversation and the session from their rows", async () => {
    const user = userEvent.setup();
    renderTab();

    const rows = screen.getAllByTestId("proposal-conversation-row");
    await user.click(rows[0]!);
    expect(navigateMock).toHaveBeenLastCalledWith(
      "/conversations/conversation-1",
    );
    await user.click(rows[1]!);
    expect(navigateMock).toHaveBeenLastCalledWith("/sessions/session-1");
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
    renderTab();

    expect(
      screen.getByText("No conversations about this proposal yet."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("proposal-conversation-row")).toBeNull();
  });
});
