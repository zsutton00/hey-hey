import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ConversationResponseDto } from "@hey-hey/ui-common/api";
import React from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationListTab } from "./ConversationListTab";

interface DiscussModalMockProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (submission: {
    prompt: string;
    provider: string;
    model: string | null;
    reasoningEffort: string | null;
    machineId: string;
  }) => void;
}

const mockUseConversations = vi.fn();
const mockUseWebsocketSubscriptions = vi.fn();
const mockLaunch = vi.fn();
const mockCreateNewConversation = vi.fn(async (_draftText: string) => {});

vi.mock("@hey-hey/ui-common/components", () => ({
  NewConversationConfirmationDialog: ({
    open,
    onClose,
    onConfirm,
  }: {
    open: boolean;
    onClose: () => void;
    onConfirm: () => void;
  }) =>
    open ? (
      <div data-testid="new-conversation-confirmation-dialog">
        <button
          type="button"
          data-testid="new-conversation-confirm"
          onClick={onConfirm}
        >
          Start new conversation
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    ) : null,
  EntityActionButton: ({
    verb,
    noun,
    loading,
    loadingLabel,
    entityType: _entityType,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    verb: string;
    noun: string;
    loading?: boolean;
    loadingLabel?: string;
    entityType?: string;
  }) => (
    <button type="button" {...props}>
      {loading ? loadingLabel : `${verb} ${noun}`}
    </button>
  ),
  useEntityConversationLauncher: () => ({
    launch: mockLaunch,
    isLoading: false,
    error: null,
  }),
  // The modal only renders when `open`; expose submit/close so the test can
  // drive each branch and assert the launcher fires only on submit.
  DiscussModal: ({ open, onClose, onSubmit }: DiscussModalMockProps) =>
    open ? (
      <div data-testid="discuss-modal">
        <button
          type="button"
          data-testid="discuss-modal-submit"
          onClick={() =>
            onSubmit({
              prompt: "Let's talk",
              provider: "CLAUDE",
              model: null,
              reasoningEffort: null,
              machineId: "svc-1",
            })
          }
        >
          submit
        </button>
        <button
          type="button"
          data-testid="discuss-modal-close"
          onClick={onClose}
        >
          close
        </button>
      </div>
    ) : null,
}));

vi.mock("@hey-hey/ui-common/i18n", () => ({
  TERMS: { Conversation: "Conversation" },
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useConversations: (...args: unknown[]) => mockUseConversations(...args),
  useWebsocketSubscriptions: (...args: unknown[]) =>
    mockUseWebsocketSubscriptions(...args),
}));

vi.mock("../CardHeader", () => ({
  CardHeader: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock("./TabContainer", () => ({
  TabContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("./ConversationArchiveList", () => ({
  ConversationArchiveList: ({
    conversations,
    onConversationSelect,
  }: {
    conversations: ConversationResponseDto[];
    onConversationSelect: (conversation: ConversationResponseDto) => void;
  }) => (
    <div data-testid="conversation-archive-list">
      {conversations.map((conversation) => (
        <button
          type="button"
          key={conversation.id}
          onClick={() => onConversationSelect(conversation)}
        >
          {conversation.title}
        </button>
      ))}
    </div>
  ),
}));

const LocationProbe = () => {
  const location = useLocation();
  return <span data-testid="current-path">{location.pathname}</span>;
};

const renderConversationListTab = (
  props: Partial<React.ComponentProps<typeof ConversationListTab>> = {},
) =>
  render(
    <MemoryRouter>
      <ConversationListTab
        organizationId="org-1"
        projectId="project-1"
        workflowAboutId="task-1"
        workflowAboutType="task"
        conversationPathForId={(conversationId) =>
          `/conversations/${conversationId}`
        }
        {...props}
      />
      <LocationProbe />
    </MemoryRouter>,
  );

describe("ConversationListTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseConversations.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      markStale: vi.fn(),
    });
    mockUseWebsocketSubscriptions.mockReturnValue(undefined);
    mockLaunch.mockResolvedValue(true);
  });

  it("opens the Discuss modal directly for generic callers", () => {
    renderConversationListTab();

    fireEvent.click(screen.getByTestId("start-conversation-button"));

    expect(screen.getByTestId("discuss-modal")).toBeInTheDocument();
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("launches an entity conversation when the modal is submitted", async () => {
    renderConversationListTab({
      workflowAboutId: "task-1",
      workflowAboutType: "task",
    });

    fireEvent.click(screen.getByTestId("start-conversation-button"));
    fireEvent.click(screen.getByTestId("discuss-modal-submit"));

    await waitFor(() => {
      expect(mockLaunch).toHaveBeenCalledWith({
        prompt: "Let's talk",
        context: { entityId: "task-1", entityType: "TASK" },
        provider: "CLAUDE",
        model: null,
        reasoningEffort: null,
        machineId: "svc-1",
      });
    });
  });

  it("maps hyphenated workflowAboutType to the registry entity key", async () => {
    renderConversationListTab({
      workflowAboutId: "doc-1",
      workflowAboutType: "design-doc",
    });

    fireEvent.click(screen.getByTestId("start-conversation-button"));
    fireEvent.click(screen.getByTestId("discuss-modal-submit"));

    await waitFor(() => {
      expect(mockLaunch).toHaveBeenCalledWith({
        prompt: "Let's talk",
        context: { entityId: "doc-1", entityType: "DESIGN_DOC" },
        provider: "CLAUDE",
        model: null,
        reasoningEffort: null,
        machineId: "svc-1",
      });
    });
  });

  it("dismissing the opted-in confirmation launches nothing and closes it", () => {
    renderConversationListTab({
      onCreateNewConversation: mockCreateNewConversation,
      confirmBeforeNewConversation: true,
    });

    fireEvent.click(screen.getByTestId("start-conversation-button"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.queryByTestId("new-conversation-confirmation-dialog"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("discuss-modal")).not.toBeInTheDocument();
    expect(mockLaunch).not.toHaveBeenCalled();
    expect(mockCreateNewConversation).not.toHaveBeenCalled();
  });

  it("direct-launches opted-in callers after confirmation", async () => {
    renderConversationListTab({
      onCreateNewConversation: mockCreateNewConversation,
      confirmBeforeNewConversation: true,
    });

    fireEvent.click(screen.getByTestId("start-conversation-button"));

    expect(
      screen.getByTestId("new-conversation-confirmation-dialog"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("discuss-modal")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("new-conversation-confirm"));

    await waitFor(() => {
      expect(mockCreateNewConversation).toHaveBeenCalledWith("");
    });
    expect(screen.queryByTestId("discuss-modal")).not.toBeInTheDocument();
  });

  it("disables the trigger when there is no entity to discuss", () => {
    renderConversationListTab({
      workflowAboutId: undefined,
      workflowAboutType: undefined,
    });

    const trigger = screen.getByTestId("start-conversation-button");
    expect(trigger).toBeDisabled();

    fireEvent.click(trigger);

    expect(screen.queryByTestId("discuss-modal")).not.toBeInTheDocument();
  });

  it("keeps conversation selection and navigation in the shared list", () => {
    const conversation = {
      id: "conversation-1",
      title: "Existing thread",
      workflowName: "task-refinement",
    } as ConversationResponseDto;
    mockUseConversations.mockReturnValue({
      data: [conversation],
      isLoading: false,
      error: null,
      markStale: vi.fn(),
    });

    renderConversationListTab();

    expect(screen.getByTestId("conversation-archive-list")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Existing thread" }));

    expect(screen.getByTestId("current-path")).toHaveTextContent(
      "/conversations/conversation-1",
    );
  });

  it("keeps agent conversation routing in the shared list", () => {
    const conversation = {
      id: "agent-conversation-1",
      title: "Agent conversation",
      workflowName: "agent-coding",
    } as ConversationResponseDto;
    mockUseConversations.mockReturnValue({
      data: [conversation],
      isLoading: false,
      error: null,
      markStale: vi.fn(),
    });

    renderConversationListTab();

    fireEvent.click(screen.getByRole("button", { name: "Agent conversation" }));

    expect(screen.getByTestId("current-path")).toHaveTextContent(
      "/projects/project-1/resolve-agent-session/agent-conversation-1",
    );
  });
});

it("supports a navigation-only index without a fallback creation control", () => {
  render(
    <MemoryRouter>
      <ConversationListTab
        organizationId="org-1"
        projectId="project-1"
        workflowAboutId="goal-1"
        workflowAboutType="task"
        conversationPathForId={(id) => id}
        onCreateNewConversation={null}
      />
    </MemoryRouter>,
  );
  expect(
    screen.queryByRole("button", { name: /new/i }),
  ).not.toBeInTheDocument();
  expect(screen.queryByTestId("discuss-modal")).not.toBeInTheDocument();
  describe("search", () => {
    const lastSearchArg = (): unknown =>
      mockUseConversations.mock.calls.at(-1)?.[2]?.search;

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("filters as the user types after the debounce, without Enter", () => {
      renderConversationListTab();
      const input = screen.getByTestId("conversation-search-input");

      fireEvent.change(input, { target: { value: " roadmap " } });
      expect(lastSearchArg()).toBe("");

      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(lastSearchArg()).toBe("roadmap");
    });

    it("returns the full list when the field is cleared", () => {
      renderConversationListTab();
      const input = screen.getByTestId("conversation-search-input");

      fireEvent.change(input, { target: { value: "roadmap" } });
      act(() => {
        vi.advanceTimersByTime(300);
      });
      fireEvent.change(input, { target: { value: "" } });
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(lastSearchArg()).toBe("");
    });

    it("does not render a Search button", () => {
      renderConversationListTab();

      expect(
        screen.queryByRole("button", { name: "Search" }),
      ).not.toBeInTheDocument();
    });
  });
});
