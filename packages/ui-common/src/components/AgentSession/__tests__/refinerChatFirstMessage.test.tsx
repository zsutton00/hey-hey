import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentSessionStatus,
  AgentSessionType,
  ConversationStatus,
  WorkflowName,
  type AgentSessionDto,
} from "../../../api";

const createAgentSessionConversationMock = vi.fn();

vi.mock("../../../data/hooks/useCreateAgentSessionConversation", () => ({
  useCreateAgentSessionConversation: () => ({
    mutate: createAgentSessionConversationMock,
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
}));

vi.mock("../../../data/hooks/useLatestMessage", () => ({
  useLatestMessage: () => ({
    data: null,
    isFetched: false,
    markStale: vi.fn(),
  }),
}));

// Entity hydration and usage badges are outside conversation creation.
vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: () => ({ workItem: undefined, isFetched: true }),
}));

vi.mock("../RunContextUsageCapsules", () => ({
  useLatestProviderSessionId: () => null,
}));

vi.mock("../SessionContextUsageCapsules", () => ({
  SessionContextUsageCapsules: () => null,
}));

vi.mock("../../../data/hooks/useProject", () => ({
  useProject: () => ({ project: undefined, isFetched: true }),
}));

vi.mock("../useAgentRunLifecycle", () => ({
  useAgentRunLifecycle: () => ({
    runId: null,
    error: null,
    retryInit: vi.fn(),
    stopRun: vi.fn(),
    stoppingRun: false,
    startRunSettled: true,
    sendUserMessage: vi.fn(async () => ({ ok: true })),
  }),
}));

vi.mock("../useLaunchRunOrchestration", () => ({
  useLaunchRunOrchestration: () => vi.fn(),
}));

vi.mock("../../InteractionComponent/useEntityConversationLauncher", () => ({
  useEntityConversationLauncher: () => ({
    launch: vi.fn(async () => true),
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../AgentConversationView", () => ({
  AgentConversationView: ({ conversationId }: { conversationId: string }) => (
    <div data-testid="agent-conversation-view">{conversationId}</div>
  ),
}));

vi.mock("../runtime/hooks/seedConversationGreeting", () => ({
  seedConversationGreeting: vi.fn(async () => {}),
}));

vi.mock("../../Conversation/Components/SystemMessage", () => ({
  SystemMessage: ({ text }: { text: string }) => <div>{text}</div>,
}));

vi.mock("../../../contexts/TrackingContext", () => ({
  TrackingProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useTracking: () => ({ track: vi.fn() }),
}));

vi.mock("../ChatSessionPendingPlaceholder", () => ({
  ChatSessionPendingPlaceholder: ({
    message,
    onSubmit,
    isLoading = false,
  }: {
    message: string;
    onSubmit?: (text: string) => Promise<void>;
    isLoading?: boolean;
  }) => {
    const [value, setValue] = React.useState("");
    return (
      <div data-testid="chat-session-pending-placeholder">
        <div data-testid="chat-session-pending-message">{message}</div>
        {isLoading ? (
          <div data-testid="chat-session-pending-loading">loading</div>
        ) : null}
        <input
          placeholder="Type your first message…"
          value={value}
          disabled={isLoading}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          type="button"
          aria-label="Send"
          disabled={isLoading}
          onClick={() => {
            if (onSubmit) void onSubmit(value);
          }}
        >
          Send
        </button>
      </div>
    );
  },
}));

const useAgentSessionsMock = vi.fn();
vi.mock("../../../data/hooks/useAgentSessions", () => ({
  useAgentSessions: (...args: unknown[]) => useAgentSessionsMock(...args),
}));

const useCreateAgentSessionMock = vi.fn();
vi.mock("../../../data/hooks/useCreateAgentSession", () => ({
  useCreateAgentSession: (opts?: { onSuccess?: () => void }) => {
    useCreateAgentSessionMock(opts);
    return {
      mutate: vi.fn(),
      isPending: false,
      isSuccess: false,
      isError: false,
      error: null,
    };
  },
}));

import { EntityConversationChat } from "../EntityConversationChat";
import { EntitySearchChat } from "../EntitySearchChat";
import { buildDefaultSurfaceSelection } from "../surfaceSelectionMemory";

const baseSession: AgentSessionDto = {
  id: "agent-session-1",
  projectId: "proj-1",
  organizationId: "org-1",
  userId: "user-1",
  type: AgentSessionType.TaskRefining,
  status: AgentSessionStatus.Started,
  sessionDate: "2026-04-18T00:00:00Z",
  conversationId: null,
  createdAt: "2026-04-18T00:00:00Z",
  updatedAt: "2026-04-18T00:00:01Z",
};

const createdResponse = (workflowName: WorkflowName) => ({
  agentSession: { ...baseSession, conversationId: "conv-new" },
  conversation: {
    id: "conv-new",
    organizationId: "org-1",
    projectId: "proj-1",
    status: ConversationStatus.Started,
    workflowName,
    createdAt: "2026-04-18T00:00:02Z",
    updatedAt: "2026-04-18T00:00:02Z",
  },
});

const submitFirstMessage = async (text: string) => {
  const input = screen.getByPlaceholderText(
    "Type your first message…",
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => {
    expect(createAgentSessionConversationMock).toHaveBeenCalled();
  });
};

describe("refiner chat first-message submissions use useCreateAgentSessionConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAgentSessionConversationMock.mockImplementation(
      async ({ body }: { body: { workflowType: WorkflowName } }) =>
        createdResponse(body.workflowType),
    );
    useAgentSessionsMock.mockReturnValue({
      agentSessions: [{ ...baseSession, type: AgentSessionType.TaskRefining }],
      isFetched: true,
      markStale: vi.fn(),
      remove: vi.fn(),
    });
  });

  // TaskRefinerChat / DesignDocRefinerChat / ProposalRefinerChat were removed
  // with the legacy refiner surfaces; the surviving chat components below carry
  // the shared conversation-creation coverage.

  it("EntityConversationChat creates conversation eagerly on mount with AgentEntityConversation + entity about", async () => {
    // EntityConversationChat no longer waits for a user message — it creates
    // the conversation on mount as soon as entityId is available, so no submit
    // step is needed here.
    await act(async () => {
      render(
        <EntityConversationChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={baseSession}
          entityId="ent-1"
          entityType="task"
        />,
      );
    });

    await waitFor(() => {
      expect(createAgentSessionConversationMock).toHaveBeenCalled();
    });

    expect(createAgentSessionConversationMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "proj-1",
      agentSessionId: baseSession.id,
      body: {
        workflowType: WorkflowName.AgentEntityConversation,
        workflowAboutType: "task",
        workflowAboutId: "ent-1",
      },
    });
  });

  it("EntitySearchChat submits with AgentSearch and agent-search about", async () => {
    await act(async () => {
      render(
        <EntitySearchChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={baseSession}
          selection={buildDefaultSurfaceSelection()}
        />,
      );
    });
    await submitFirstMessage("search");
    expect(createAgentSessionConversationMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "proj-1",
      agentSessionId: baseSession.id,
      body: {
        workflowType: WorkflowName.AgentSearch,
        workflowAboutType: "agent-search",
        workflowAboutId: baseSession.id,
      },
    });
  });
});
