import {
  WorkflowName,
  type ConversationResponseDto,
} from "@hey-hey/ui-common/api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GoalConversationToc } from "./GoalConversationToc";

const { mockDeleteConversation, mockUseUserIdentity } = vi.hoisted(() => ({
  mockDeleteConversation: vi.fn(),
  mockUseUserIdentity: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useDeleteConversation: () => ({
    mutate: mockDeleteConversation,
    isPending: false,
  }),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => mockUseUserIdentity(),
}));

const createConversation = (
  id: string,
  title: string | undefined,
  updatedAt: string
): ConversationResponseDto =>
  ({
    id,
    title,
    updatedAt,
    createdAt: updatedAt,
    projectId: "project-1",
    organizationId: "org-1",
    createdBy: null,
    messages: [],
  }) as ConversationResponseDto;

describe("GoalConversationToc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteConversation.mockResolvedValue(undefined);
    mockUseUserIdentity.mockReturnValue({ userId: "creator-1" });
  });

  it("renders canonical conversations newest-first with active state and bounded scrolling", () => {
    const onConversationSelect = vi.fn();
    render(
      <GoalConversationToc
        organizationId="org-1"
        projectId="project-1"
        conversations={[
          createConversation(
            "conversation-older",
            undefined,
            "2026-08-01T12:00:00.000Z"
          ),
          createConversation(
            "conversation-active",
            "Launch coordination",
            "2026-09-01T12:00:00.000Z"
          ),
        ]}
        activeConversationId="conversation-active"
        isLoading={false}
        onConversationSelect={onConversationSelect}
        onConversationArchived={vi.fn()}
      />
    );

    const rows = screen
      .getAllByRole("button")
      .filter((row) => row.hasAttribute("data-testid"));
    expect(rows[0]).toHaveTextContent("Launch coordination");
    expect(
      screen.getByTestId("goal-conversation-toc-row-conversation-active")
    ).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("goal-conversation-toc")).toHaveStyle({
      maxHeight: "50%",
    });
    expect(screen.getByTestId("goal-conversation-toc-scrollport")).toHaveStyle({
      overflowY: "auto",
    });

    fireEvent.click(
      screen.getByTestId("goal-conversation-toc-row-conversation-older")
    );
    expect(onConversationSelect).toHaveBeenCalledWith("conversation-older");
  });

  it("renders loading and empty states", () => {
    const { rerender } = render(
      <GoalConversationToc
        organizationId="org-1"
        projectId="project-1"
        conversations={[]}
        activeConversationId={null}
        isLoading
        onConversationSelect={vi.fn()}
        onConversationArchived={vi.fn()}
      />
    );
    expect(
      screen.getByTestId("goal-conversation-toc-loading")
    ).toBeInTheDocument();

    rerender(
      <GoalConversationToc
        organizationId="org-1"
        projectId="project-1"
        conversations={[]}
        activeConversationId={null}
        isLoading={false}
        onConversationSelect={vi.fn()}
        onConversationArchived={vi.fn()}
      />
    );
    expect(screen.getByTestId("goal-conversation-toc-empty")).toHaveTextContent(
      "No conversations yet."
    );
  });

  it("puts the canonical PM first and offers navigation only", () => {
    const onConversationSelect = vi.fn();
    render(
      <GoalConversationToc
        organizationId="org-1"
        projectId="project-1"
        conversations={[
          createConversation("child", "Goal PM Conversation", "2026-09-02"),
          {
            ...createConversation("root", "Different title", "2026-09-01"),
            workflowName: WorkflowName.GoalPm,
          },
        ]}
        activeConversationId="root"
        isLoading={false}
        onConversationSelect={onConversationSelect}
        onConversationArchived={vi.fn()}
      />
    );
    const rows = screen.getAllByRole("button");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute(
      "data-testid",
      "goal-conversation-toc-row-root"
    );
    expect(rows[0]).toHaveTextContent("Goal PM Conversation");
    expect(
      screen.queryByTestId("goal-conversation-toc-new")
    ).not.toBeInTheDocument();
    fireEvent.click(rows[1]);
    expect(onConversationSelect).toHaveBeenCalledExactlyOnceWith("child");
  });

  it("shows archive only for the creator and never for Goal PM or creatorless threads", () => {
    render(
      <GoalConversationToc
        organizationId="org-1"
        projectId="project-1"
        conversations={[
          {
            ...createConversation("owned", "Owned thread", "2026-09-04"),
            createdBy: "creator-1",
          },
          {
            ...createConversation("other", "Other thread", "2026-09-03"),
            createdBy: "creator-2",
          },
          {
            ...createConversation("creatorless", "Legacy thread", "2026-09-02"),
            createdBy: null,
          },
          {
            ...createConversation("root", "Root title", "2026-09-01"),
            workflowName: WorkflowName.GoalPm,
          },
        ]}
        activeConversationId="root"
        isLoading={false}
        onConversationSelect={vi.fn()}
        onConversationArchived={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Archive Owned thread" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Archive Other thread" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Archive Legacy thread" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Archive Goal PM Conversation" }),
    ).not.toBeInTheDocument();
  });

  it("confirms the named recoverable archive, leaves cancellation untouched, and requests a soft archive", async () => {
    const onConversationArchived = vi.fn();
    render(
      <GoalConversationToc
        organizationId="org-1"
        projectId="project-1"
        conversations={[
          {
            ...createConversation(
              "owned",
              "Owned launch thread",
              "2026-09-04",
            ),
            createdBy: "creator-1",
          },
        ]}
        activeConversationId="owned"
        isLoading={false}
        onConversationSelect={vi.fn()}
        onConversationArchived={onConversationArchived}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Archive Owned launch thread" }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Owned launch thread",
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "removed from this goal’s conversation list",
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "You can restore it later. No messages will be deleted.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(mockDeleteConversation).not.toHaveBeenCalled();
    expect(onConversationArchived).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Archive Owned launch thread" }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Owned launch thread",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Archive", exact: true }),
    );

    await waitFor(() =>
      expect(mockDeleteConversation).toHaveBeenCalledWith({
        organizationId: "org-1",
        projectId: "project-1",
        conversationId: "owned",
        deleteRequest: { hardDelete: false },
      }),
    );
    await waitFor(() =>
      expect(onConversationArchived).toHaveBeenCalledExactlyOnceWith("owned"),
    );
  });
});
