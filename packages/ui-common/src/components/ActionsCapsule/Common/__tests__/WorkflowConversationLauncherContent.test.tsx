import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ConversationResponseDto,
  CreateConversationDto,
} from "../../../../api";
import {
  ConversationStatus,
  InitiationType,
  WorkflowName,
} from "../../../../api";
import { WorkflowConversationLauncherContent } from "../WorkflowConversationLauncherContent";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useWorkflowConversations: vi.fn(),
  useCreateConversation: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom"
  );

  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("../../../../data/hooks/useWorkflowConversations", () => ({
  useWorkflowConversations: mocks.useWorkflowConversations,
}));

vi.mock("../../../../data/hooks/useCreateConversation", () => ({
  useCreateConversation: mocks.useCreateConversation,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const buildConversation = (
  conversationId: string,
  title: string
): ConversationResponseDto => ({
  id: conversationId,
  projectId: "project-1",
  organizationId: "org-1",
  initiatedBy: InitiationType.User,
  status: ConversationStatus.Started,
  version: 1,
  workflowName: WorkflowName.PlanUpdate,
  workflowAboutId: "plan-1",
  workflowAboutType: "plan",
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
  title,
  messages: [],
});

const defaultCreateConversationDto: CreateConversationDto = {
  projectId: "project-1",
  organizationId: "org-1",
  initiatedBy: InitiationType.User,
  status: ConversationStatus.Started,
  workflowName: WorkflowName.PlanUpdate,
  workflowAboutId: "plan-1",
  workflowAboutType: "plan",
  title: "Plan Update: Plan",
};

const setupWorkflowConversations = (
  conversations: ConversationResponseDto[]
): void => {
  mocks.useWorkflowConversations.mockReturnValue({
    data: conversations,
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: true,
    error: null,
    isStale: false,
    refetch: vi.fn(),
    markStale: vi.fn(),
  });
};

describe("WorkflowConversationLauncherContent", () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("navigates to a selected existing conversation", async () => {
    const user = userEvent.setup();
    const existingConversation = buildConversation(
      "conversation-1",
      "Existing Plan Update"
    );

    setupWorkflowConversations([existingConversation]);
    mocks.useCreateConversation.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });

    render(
      <WorkflowConversationLauncherContent
        organizationId="org-1"
        projectId="project-1"
        workflowName={WorkflowName.PlanUpdate}
        workflowAboutId="plan-1"
        createConversationDto={() => defaultCreateConversationDto}
      />
    );

    await user.click(screen.getByText("Existing Plan Update"));

    expect(mocks.navigate).toHaveBeenCalledWith(
      "/projects/project-1/resolve-agent-session/conversation-1"
    );
  });

  it("creates a new conversation then navigates to it", async () => {
    const user = userEvent.setup();
    const createConversationMutate = vi.fn();
    const createdConversation = buildConversation(
      "conversation-2",
      "New Plan Update"
    );

    setupWorkflowConversations([]);
    mocks.useCreateConversation.mockImplementation(
      (options?: {
        onSuccess?: (conversation: ConversationResponseDto) => void;
      }) => ({
        mutate: (variables: {
          organizationId: string;
          projectId: string;
          conversationDto: CreateConversationDto;
        }) => {
          createConversationMutate(variables);
          options?.onSuccess?.(createdConversation);
        },
        isPending: false,
      })
    );

    render(
      <WorkflowConversationLauncherContent
        organizationId="org-1"
        projectId="project-1"
        workflowName={WorkflowName.PlanUpdate}
        workflowAboutId="plan-1"
        createConversationDto={() => defaultCreateConversationDto}
      />
    );

    await user.click(
      screen.getByTestId("workflow-conversation-launcher-content-create-button")
    );

    expect(createConversationMutate).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      conversationDto: defaultCreateConversationDto,
    });
    expect(mocks.navigate).toHaveBeenCalledWith(
      "/projects/project-1/resolve-agent-session/conversation-2"
    );
  });
});
