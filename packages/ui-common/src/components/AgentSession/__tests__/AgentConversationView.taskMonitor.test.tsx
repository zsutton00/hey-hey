import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { messageKeys } from "../../../data/collections/messages";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConversationStatus,
  InitiationType,
  MessageType,
  type ConversationResponseDto,
  type GoalPmRoutingSelectionPayload,
  type GoalPmRoutingEnactmentResponse,
} from "../../../api";
import type { ConversationFormResolver } from "../../Conversation/Components/conversationFormTypes";
import { AgentConversationView } from "../AgentConversationView";

const { submitMessageMock, markStaleMock, conversationState } = vi.hoisted(
  () => ({
    submitMessageMock: vi.fn(),
    markStaleMock: vi.fn(),
    conversationState: {
      current: null as ConversationResponseDto | null,
    },
  }),
);

vi.mock("../../../data/hooks/useAgentSession", () => ({
  useAgentSession: () => ({ agentSession: null }),
}));

vi.mock("../../../data/hooks/useConversation", () => ({
  useConversation: () => ({
    data: conversationState.current,
    isLoading: false,
    isFetching: false,
    isFetched: true,
    error: null,
  }),
}));

vi.mock("../../../data/hooks/useConversationMessages", () => ({
  useConversationMessages: () => ({
    data: [],
    orderedData: [],
    undatedInputs: [],
    isLoading: false,
    isFetching: false,
    isFetched: true,
    error: null,
    markStale: markStaleMock,
  }),
}));

vi.mock("../../../data/hooks/useAgentSessionCurrentState", () => ({
  useAgentSessionCurrentState: () => ({ currentState: null }),
}));

vi.mock("../../../data/hooks/useAgentSessionOutputAttention", () => ({
  useAcknowledgeAgentSessionOutputAttention: () => vi.fn(async () => {}),
}));

vi.mock("../../../data/hooks/useProject", () => ({
  useProject: () => ({
    data: { id: "project-1", organizationId: "org-1", name: "Project" },
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../runtime/hooks/useCliRequired", () => ({
  useCliRequired: () => ({
    type: "ready",
    machine: {
      machineId: "machine-1",
      name: "Local machine",
      executionReadiness: "READY",
      currentControllerEligibility: "ELIGIBLE",
    },
  }),
}));

vi.mock("../operations/useAgentSessionInteractionAccess", () => ({
  useAgentSessionInteractionAccess: () => ({
    isDeviceEnabled: true,
    interactions: {
      startSession: vi.fn(),
      submitMessage: submitMessageMock,
    },
    unavailable: null,
  }),
}));

vi.mock("../../Conversation/ConversationViewer", () => ({
  ConversationViewer: ({
    taskMonitorId,
    conversationFormResolver,
    onGoalPmAction,
  }: {
    taskMonitorId?: string;
    conversationFormResolver?: ConversationFormResolver;
    onGoalPmAction?: (
      option: GoalPmRoutingSelectionPayload,
      sourceConversationId: string,
    ) => Promise<GoalPmRoutingEnactmentResponse>;
  }) => (
    <div
      data-testid="conversation-viewer"
      data-task-monitor-id={taskMonitorId}
      data-form-resolver={conversationFormResolver ? "provided" : "missing"}
    >
      <button
        onClick={() =>
          void onGoalPmAction?.(
            {
              sourceMessageId: "source-message",
              uiElementId: "route",
              selectedOptionId: "start-new",
            },
            "conversation-1",
            routedCreation,
          )
        }
      >
        Routed action
      </button>
    </div>
  ),
}));

const routedCreation = vi.hoisted(() => ({
  config: {
    type: "ENTITY_CONVERSATION" as const,
    version: "v1" as const,
    model: "model-1",
  },
  provider: "claude" as const,
  machineId: "machine-1",
}));

vi.mock("../ExternalReplyComposer", () => ({
  ExternalReplyComposer: ({
    messageContext,
    onSubmitReply,
    onDraftChange,
  }: {
    messageContext: { conversationId: string } | null;
    onSubmitReply: (text: string) => Promise<void>;
    onDraftChange?: (draft: string) => void;
  }) => (
    <>
      <button onClick={() => onDraftChange?.("Unsent follow-up")}>
        Edit draft
      </button>
      <button
        data-testid="task-monitor-reply-submit"
        disabled={messageContext === null}
        onClick={() => {
          void onSubmitReply("ordinary monitor discussion");
        }}
      >
        Send reply
      </button>
    </>
  ),
}));

const buildConversation = (): ConversationResponseDto =>
  ({
    id: "conversation-1",
    organizationId: "org-1",
    projectId: "project-1",
    initiatedBy: InitiationType.User,
    status: ConversationStatus.Started,
    version: 1,
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
  }) as unknown as ConversationResponseDto;

describe("AgentConversationView Task Monitor replies", () => {
  beforeEach(() => {
    conversationState.current = buildConversation();
    submitMessageMock.mockReset();
    submitMessageMock.mockResolvedValue({
      state: "succeeded",
      operationId: "operation-1",
      fingerprint: "fingerprint-1",
      kind: "submit_message",
      messageId: "message-1",
      triggerMessageId: "trigger-1",
    });
    markStaleMock.mockReset();
  });

  it("routes a built typed reply through the existing direct-message operation", async () => {
    const buildReplyMessage = vi.fn((text: string) => ({
      projectId: "project-1",
      conversationId: "conversation-1",
      type: MessageType.User,
      data: {
        agentInput: {
          monitorId: "monitor-1",
          userMessage: text.trim(),
          cause: "CONTINUE",
          correlationId: "correlation-1",
          promptType: "task_monitor",
        },
      },
    }));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const messagesKey = messageKeys.list(
      "org-1",
      "project-1",
      conversationState.current!.id,
    );
    queryClient.setQueryData(messagesKey, []);

    render(
      <QueryClientProvider client={queryClient}>
        <AgentConversationView
          organizationId="org-1"
          projectId="project-1"
          agentSessionId="agent-session-1"
          conversationId="conversation-1"
          buildReplyMessage={buildReplyMessage}
        />
      </QueryClientProvider>,
    );

    screen.getByTestId("task-monitor-reply-submit").click();

    await vi.waitFor(() => {
      expect(buildReplyMessage).toHaveBeenCalledWith(
        "ordinary monitor discussion",
        undefined,
        [],
      );
      expect(submitMessageMock).toHaveBeenCalledTimes(1);
    });
    expect(submitMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        agentSessionId: "agent-session-1",
        conversationId: "conversation-1",
        intent: {
          projectId: "project-1",
          conversationId: "conversation-1",
          type: MessageType.User,
          data: {
            attachments: [],
            agentInput: {
              monitorId: "monitor-1",
              userMessage: "ordinary monitor discussion",
              cause: "CONTINUE",
              correlationId: "correlation-1",
              promptType: "task_monitor",
            },
          },
        },
      }),
    );
    await waitFor(() =>
      expect(queryClient.getQueryState(messagesKey)?.isInvalidated).toBe(true),
    );
  });

  it("forwards the Task Monitor command target to the shared conversation viewer", () => {
    render(
      <AgentConversationView
        organizationId="org-1"
        projectId="project-1"
        agentSessionId="agent-session-1"
        conversationId="conversation-1"
        taskMonitorId="monitor-1"
      />,
    );

    expect(screen.getByTestId("conversation-viewer")).toHaveAttribute(
      "data-task-monitor-id",
      "monitor-1",
    );
  });

  it("forwards an owner-supplied conversation form resolver", () => {
    const conversationFormResolver: ConversationFormResolver = () => null;

    render(
      <AgentConversationView
        organizationId="org-1"
        projectId="project-1"
        agentSessionId="agent-session-1"
        conversationId="conversation-1"
        conversationFormResolver={conversationFormResolver}
      />,
    );

    expect(screen.getByTestId("conversation-viewer")).toHaveAttribute(
      "data-form-resolver",
      "provided",
    );
  });

  it("keeps the coding follow-up fallback when no typed builder is supplied", async () => {
    render(
      <AgentConversationView
        organizationId="org-1"
        projectId="project-1"
        agentSessionId="agent-session-1"
        conversationId="conversation-1"
      />,
    );

    screen.getByTestId("task-monitor-reply-submit").click();

    await vi.waitFor(() => expect(submitMessageMock).toHaveBeenCalledTimes(1));
    expect(submitMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: expect.objectContaining({
          data: {
            attachments: [],
            agentInput: {
              promptType: "coding_freeform",
              userMessage: "ordinary monitor discussion",
            },
          },
        }),
      }),
    );
  });

  it("rejects a reply while the canonical conversation input is incomplete", () => {
    conversationState.current = null;

    render(
      <AgentConversationView
        organizationId="org-1"
        projectId="project-1"
        agentSessionId="agent-session-1"
        conversationId="conversation-1"
      />,
    );

    expect(screen.getByTestId("task-monitor-reply-submit")).toBeDisabled();
    expect(submitMessageMock).not.toHaveBeenCalled();
  });
  it("passes the unsent composer draft with a selected routing action", async () => {
    conversationState.current = buildConversation();
    const onGoalPmAction =
      vi.fn<
        NonNullable<
          React.ComponentProps<typeof AgentConversationView>["onGoalPmAction"]
        >
      >();
    render(
      <AgentConversationView
        organizationId="org-1"
        projectId="project-1"
        agentSessionId="session-1"
        conversationId="conversation-1"
        machineId="machine-1"
        onGoalPmAction={onGoalPmAction}
      />,
    );
    fireEvent.click(screen.getByText("Edit draft"));
    expect(onGoalPmAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Routed action"));
    await waitFor(() =>
      expect(onGoalPmAction).toHaveBeenCalledWith(
        expect.objectContaining({
          selectedOptionId: "start-new",
          sourceMessageId: "source-message",
          uiElementId: "route",
        }),
        "conversation-1",
        "Unsent follow-up",
        routedCreation,
      ),
    );
  });
});
