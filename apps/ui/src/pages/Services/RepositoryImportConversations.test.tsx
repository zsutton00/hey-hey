import React from "react";
import {
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConversationStatus,
  InitiationType,
  type ConversationResponseDto,
} from "@hey-hey/ui-common/api";
import { RepositoryImportConversations } from "./RepositoryImportConversations";

const mocks = vi.hoisted(() => ({
  conversations: [] as ConversationResponseDto[],
  isLoading: false,
  error: null as Error | null,
  deleteConversation: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useConversations: () => ({
    data: mocks.conversations,
    isLoading: mocks.isLoading,
    error: mocks.error,
    refetch: mocks.refetch,
  }),
  useDeleteConversation: () => ({
    mutate: mocks.deleteConversation,
    isPending: false,
  }),
}));

const conversation = (
  id: string,
  status: ConversationStatus,
  overrides: Partial<ConversationResponseDto> = {},
): ConversationResponseDto => ({
  id,
  organizationId: "organization-1",
  projectId: "project-1",
  initiatedBy: InitiationType.User,
  status,
  version: 1,
  workflowName: "repository-import",
  workflowAboutId: "project-1",
  workflowAboutType: "project",
  title: `Import ${id}`,
  createdAt: "2026-09-12T08:00:00.000Z",
  updatedAt: "2026-09-13T08:00:00.000Z",
  messages: [],
  ...overrides,
});

const renderList = (onOpen = vi.fn()) => {
  render(
    <RepositoryImportConversations
      organizationId="organization-1"
      projectId="project-1"
      onOpen={onOpen}
    />,
  );
  return onOpen;
};

describe("RepositoryImportConversations", () => {
  beforeEach(() => {
    mocks.conversations = [];
    mocks.isLoading = false;
    mocks.error = null;
    mocks.deleteConversation.mockReset();
    mocks.refetch.mockReset();
  });

  it("renders loading and empty states", () => {
    mocks.isLoading = true;
    renderList();
    expect(screen.getByText("Loading imports...")).toBeInTheDocument();

    mocks.isLoading = false;
  });

  it("shows an empty state when no imports match", () => {
    mocks.conversations = [
      conversation("other", ConversationStatus.Started, {
        workflowName: "onboarding",
        triggerEvent: "new_project",
      }),
    ];
    renderList();
    expect(screen.getByText("No repository imports yet")).toBeInTheDocument();
  });

  it("protects completed imports and opens them from the title by conversation identity", async () => {
    const onOpen = vi.fn();
    mocks.conversations = [conversation("completed", ConversationStatus.Completed)];
    renderList(onOpen);
    const user = userEvent.setup();

    expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Import completed" }));
    expect(onOpen).toHaveBeenCalledWith("completed");
    expect(
      screen.queryByRole("button", { name: "Open" }),
    ).not.toBeInTheDocument();
  });

  it("confirms deletion of unfinished imports by conversation identity", async () => {
    const onOpen = vi.fn();
    mocks.conversations = [conversation("unfinished", ConversationStatus.InProgress)];
    renderList(onOpen);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Import unfinished" }));
    expect(onOpen).toHaveBeenCalledWith("unfinished");
    expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete Import unfinished" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Import unfinished");
    expect(mocks.deleteConversation).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitForElementToBeRemoved(() => screen.queryByRole("dialog"));
    expect(mocks.deleteConversation).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete Import unfinished" }));
    await user.click(
      screen.getByRole("button", { name: "Delete", exact: true }),
    );
    expect(mocks.deleteConversation).toHaveBeenCalledWith({
      organizationId: "organization-1",
      projectId: "project-1",
      conversationId: "unfinished",
    });
  });

  it("does not delete an import that completes while confirmation is open", async () => {
    mocks.conversations = [conversation("finishing", ConversationStatus.InProgress)];
    const { rerender } = render(
      <RepositoryImportConversations
        organizationId="organization-1"
        projectId="project-1"
        onOpen={vi.fn()}
      />,
    );
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "Delete Import finishing" }),
    );
    mocks.conversations = [
      conversation("finishing", ConversationStatus.Completed),
    ];
    rerender(
      <RepositoryImportConversations
        organizationId="organization-1"
        projectId="project-1"
        onOpen={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete", exact: true }));

    expect(mocks.deleteConversation).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

});
