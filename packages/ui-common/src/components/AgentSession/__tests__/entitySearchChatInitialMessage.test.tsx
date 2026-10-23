import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentSessionStatus,
  AgentSessionType,
  ConversationStartRunRequestDtoProviderEnum,
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

const useLatestMessageMock = vi.fn();
vi.mock("../../../data/hooks/useLatestMessage", () => ({
  useLatestMessage: (...args: unknown[]) => useLatestMessageMock(...args),
}));

vi.mock("../../../data/hooks/useProject", () => ({
  useProject: () => ({ data: undefined, isFetched: true }),
}));

const useAgentRunLifecycleMock = vi.fn();
vi.mock("../useAgentRunLifecycle", () => ({
  useAgentRunLifecycle: (...args: unknown[]) =>
    useAgentRunLifecycleMock(...args),
}));

const { submitMessageMock } = vi.hoisted(() => ({
  submitMessageMock: vi.fn(),
}));
vi.mock("../operations/useAgentSessionInteractionAccess", () => ({
  useAgentSessionInteractionAccess: () => ({
    isDeviceEnabled: true,
    interactions: { startSession: vi.fn(), submitMessage: submitMessageMock },
    unavailable: null,
  }),
}));

vi.mock("../runtime/hooks/useCliRequired", () => ({
  useCliRequired: () => ({
    type: "ready",
    machine: { machineId: "machine-1" },
  }),
}));

vi.mock("../useLaunchRunOrchestration", () => ({
  useLaunchRunOrchestration: () => vi.fn(),
}));

vi.mock("../../../clients/client", () => ({
  apiClient: {
    postMessage: vi.fn(),
  },
}));

vi.mock("../AgentConversationView", () => ({
  AgentConversationView: () => <div data-testid="agent-conversation-view" />,
}));

vi.mock("../../../contexts/TrackingContext", () => ({
  TrackingProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useTracking: () => ({ track: vi.fn() }),
}));

vi.mock("../ChatSessionPendingPlaceholder", () => ({
  ChatSessionPendingPlaceholder: () => (
    <div data-testid="chat-session-pending-placeholder" />
  ),
}));

import { EntitySearchChat } from "../EntitySearchChat";
import { buildDefaultSurfaceSelection } from "../surfaceSelectionMemory";

const baseSession: AgentSessionDto = {
  id: "agent-session-1",
  projectId: "proj-1",
  organizationId: "org-1",
  userId: "user-1",
  type: AgentSessionType.AgentSearch,
  status: AgentSessionStatus.Started,
  sessionDate: "2026-05-07T00:00:00Z",
  conversationId: null,
  createdAt: "2026-05-07T00:00:00Z",
  updatedAt: "2026-05-07T00:00:01Z",
};

const createdConversationResponse = {
  agentSession: { ...baseSession, conversationId: "conv-new" },
  conversation: {
    id: "conv-new",
    organizationId: "org-1",
    projectId: "proj-1",
    status: ConversationStatus.Started,
    workflowName: WorkflowName.AgentSearch,
    workflowAboutId: baseSession.id,
    createdAt: "2026-05-07T00:00:02Z",
    updatedAt: "2026-05-07T00:00:02Z",
  },
};

describe("EntitySearchChat with initialUserMessage queued from AdvancedSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAgentSessionConversationMock.mockResolvedValue(
      createdConversationResponse
    );
    submitMessageMock.mockResolvedValue({
      operationId: "operation-1",
      fingerprint: "a".repeat(64),
      kind: "submit_message",
      state: "succeeded",
      messageId: "message-1",
      triggerMessageId: "trigger-1",
    });
    // Empty conversation so the initial-prompt useEffect will fire after
    // the conversation is created and the run becomes active.
    useLatestMessageMock.mockReturnValue({ data: null, isFetched: true });
    // Active run is available immediately; the conversationId arg flows in
    // from the parent so the initial-prompt useEffect can trigger.
    useAgentRunLifecycleMock.mockReturnValue({
      runId: "run-1",
      error: null,
      retryInit: vi.fn(),
      stopRun: vi.fn(),
      stoppingRun: false,
    });
  });

  it("auto-creates the conversation and posts the queued user message without a placeholder", async () => {
    const selection = {
      ...buildDefaultSurfaceSelection(),
      provider: ConversationStartRunRequestDtoProviderEnum.Codex,
      model: "gpt-5.6-sol",
      fastMode: true,
    };

    await act(async () => {
      render(
        <EntitySearchChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={baseSession}
          selection={selection}
          initialUserMessage="find onboarding tasks"
        />
      );
    });

    await waitFor(() => {
      expect(createAgentSessionConversationMock).toHaveBeenCalledTimes(1);
    });
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

    expect(useAgentRunLifecycleMock).toHaveBeenCalledWith(
      expect.objectContaining({ fastMode: true })
    );

    expect(
      screen.queryByTestId("chat-session-pending-placeholder")
    ).not.toBeInTheDocument();

    await waitFor(() => {
      expect(submitMessageMock).toHaveBeenCalledTimes(1);
    });
    const {
      organizationId: orgId,
      projectId,
      agentSessionId,
      conversationId,
      machineId,
      intent,
    } = submitMessageMock.mock.calls[0]![0];
    expect(orgId).toBe("org-1");
    expect(projectId).toBe("proj-1");
    expect(agentSessionId).toBe(baseSession.id);
    expect(conversationId).toBe("conv-new");
    expect(machineId).toBeUndefined();
    expect(intent.data).toEqual({
      agentInput: {
        promptType: "agent_search",
        payloadVersion: 1,
        userMessage: "find onboarding tasks",
      },
      references: { resolved: [], unresolved: [] },
    });
  });

  it("restores the selected Service from a reopened search session", async () => {
    const reopenedSession: AgentSessionDto = {
      ...baseSession,
      conversationId: "conv-existing",
      serviceIds: ["service-1"],
      launchServiceId: "service-1",
    };

    await act(async () => {
      render(
        <EntitySearchChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={reopenedSession}
          selection={buildDefaultSurfaceSelection()}
        />
      );
    });

    const lifecycleInput = useAgentRunLifecycleMock.mock.calls[0]?.[0] as {
      serviceIds?: string[];
      launchServiceId?: string;
    };
    expect(lifecycleInput.serviceIds).toEqual(["service-1"]);
    expect(lifecycleInput.launchServiceId).toBe("service-1");
  });
});
