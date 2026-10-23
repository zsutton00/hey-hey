import type { ConversationResponseDto } from "@hey-hey/ui-common/api";
import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationArchiveListProps } from "./ConversationArchiveList";
import { ConversationArchiveList } from "./ConversationArchiveList";

const { mockDeleteMutation, mockUseUserIdentity } = vi.hoisted(() => ({
  mockDeleteMutation: vi.fn(),
  mockUseUserIdentity: vi.fn(),
}));

let mockDeleteOptions:
  { onSuccess?: () => void; onError?: (error: Error) => void } | undefined;

vi.mock("@hey-hey/ui-common/components", () => ({
  EntityGrid: <T extends { id: string }>({
    items,
    renderItem,
  }: {
    items: T[];
    renderItem: (item: T) => React.ReactNode;
  }) => (
    <div>
      {items.map((item) => (
        <React.Fragment key={item.id}>{renderItem(item)}</React.Fragment>
      ))}
    </div>
  ),
  EntityListItem: ({
    conversationId,
    contentSlot,
    onClick,
  }: {
    conversationId?: string;
    contentSlot?: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLDivElement>;
  }) => (
    <div data-testid={`conversation-row-${conversationId}`} onClick={onClick}>
      {contentSlot}
    </div>
  ),
  conversationAdapter: {
    toEntityListItemProps: (
      conversation: ConversationResponseDto,
      options?: {
        onClick?: React.MouseEventHandler<HTMLDivElement>;
        fallbackTitle?: string;
      },
    ) => ({
      title:
        conversation.title || options?.fallbackTitle || "Untitled Conversation",
      status: "3 days ago",
      conversationId: conversation.id,
      onClick: options?.onClick,
    }),
  },
}));

vi.mock("@hey-hey/ui-common/i18n", () => ({
  TERMS: { Conversation: "Conversation" },
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useDeleteConversation: (options: {
    onSuccess?: () => void;
    onError?: (error: Error) => void;
  }) => {
    mockDeleteOptions = options;
    return { mutate: mockDeleteMutation, isPending: false };
  },
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => mockUseUserIdentity(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const makeConversation = (
  id: string,
  createdBy: string | null,
  title: string,
): ConversationResponseDto =>
  ({
    id,
    createdBy,
    title,
    status: "COMPLETED",
    workflowName: "task-refinement",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
  }) as ConversationResponseDto;

const renderArchiveList = (
  props: Partial<ConversationArchiveListProps> = {},
) => {
  const defaults: ConversationArchiveListProps = {
    organizationId: "org-1",
    projectId: "project-1",
    conversations: [],
    activeConversationId: "",
    onConversationSelect: vi.fn(),
    isLoading: false,
    markStale: vi.fn(),
  };
  return render(<ConversationArchiveList {...defaults} {...props} />);
};

describe("ConversationArchiveList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteOptions = undefined;
    mockUseUserIdentity.mockReturnValue({ userId: "creator-1" });
  });

  it("titles untitled conversations after the entity and shows when they were created", () => {
    renderArchiveList({
      entityName: "Jev Integration",
      conversations: [makeConversation("untitled", "creator-1", "")],
    });

    expect(
      screen.getByText("Jev Integration Conversation"),
    ).toBeInTheDocument();
    expect(screen.getByText("3 days ago")).toBeInTheDocument();
    expect(screen.queryByText("COMPLETED")).not.toBeInTheDocument();
  });

  it("shows archive controls only for the creator and hides them when creator identity is absent", () => {
    const { unmount } = renderArchiveList({
      conversations: [
        makeConversation("owned", "creator-1", "Owned thread"),
        makeConversation("other", "creator-2", "Other thread"),
        makeConversation("legacy", null, "Legacy thread"),
      ],
    });

    expect(
      screen.getByRole("button", { name: "Archive Owned thread" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Archive Other thread" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Archive Legacy thread" }),
    ).not.toBeInTheDocument();

    unmount();
    mockUseUserIdentity.mockReturnValue(null);
    renderArchiveList({
      conversations: [makeConversation("owned", "creator-1", "Owned thread")],
    });
    expect(
      screen.queryByRole("button", { name: "Archive Owned thread" }),
    ).not.toBeInTheDocument();
  });

  it("does not mutate when archive confirmation is cancelled", async () => {
    renderArchiveList({
      conversations: [makeConversation("owned", "creator-1", "Owned thread")],
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Archive Owned thread" }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(mockDeleteMutation).not.toHaveBeenCalled();
  });

  it("soft archives after confirmation and refreshes the current results", () => {
    const markStale = vi.fn();
    const owned = makeConversation("owned", "creator-1", "Owned thread");
    const other = makeConversation("other", "creator-2", "Other thread");
    const { rerender } = renderArchiveList({
      conversations: [owned, other],
      markStale,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Archive Owned thread" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Archive", exact: true }),
    );

    expect(mockDeleteMutation).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      conversationId: "owned",
      deleteRequest: { hardDelete: false },
    });
    act(() => mockDeleteOptions?.onSuccess?.());
    expect(markStale).toHaveBeenCalledOnce();

    rerender(
      <ConversationArchiveList
        organizationId="org-1"
        projectId="project-1"
        conversations={[other]}
        activeConversationId=""
        onConversationSelect={vi.fn()}
        isLoading={false}
        markStale={markStale}
      />,
    );
    expect(screen.queryByText("Owned thread")).not.toBeInTheDocument();
    expect(screen.getByText("Other thread")).toBeInTheDocument();
  });
});
