import { act, render, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentSessionStatus,
  AgentSessionType,
  ConversationStatus,
  WorkflowName,
  type AgentSkillSelection,
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
  useLatestMessage: () => ({ data: null, isFetched: true }),
}));

const useAgentRunLifecycleMock = vi.fn();
const { sendUserMessageMock } = vi.hoisted(() => ({
  sendUserMessageMock: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("../useAgentRunLifecycle", () => ({
  useAgentRunLifecycle: (...args: unknown[]) =>
    useAgentRunLifecycleMock(...args),
}));

vi.mock("../useLaunchRunOrchestration", () => ({
  useLaunchRunOrchestration: () => vi.fn(),
}));

const { submitMessageMock } = vi.hoisted(() => ({
  submitMessageMock: vi.fn(),
}));
vi.mock("../../../clients/client", () => ({
  apiClient: {},
}));
vi.mock("../runtime/hooks/useCliRequired", () => ({
  useCliRequired: () => ({
    type: "ready",
    machine: { machineId: "machine-1" },
  }),
}));
vi.mock("../operations/useAgentSessionInteractionAccess", () => ({
  useAgentSessionInteractionAccess: () => ({
    isDeviceEnabled: true,
    interactions: { startSession: vi.fn(), submitMessage: submitMessageMock },
    unavailable: null,
  }),
}));

let capturedConversationViewProps: {
  onSubmitReply?: (
    text: string,
    skillSelection?: AgentSkillSelection
  ) => Promise<void>;
  onStopRun?: () => void;
  stoppingRun?: boolean;
  runProcessing?: boolean;
  scrollable?: boolean;
} | null = null;

vi.mock("../AgentConversationView", () => ({
  AgentConversationView: (props: {
    onSubmitReply?: (
      text: string,
      skillSelection?: AgentSkillSelection
    ) => Promise<void>;
    onStopRun?: () => void;
    stoppingRun?: boolean;
    runProcessing?: boolean;
    scrollable?: boolean;
  }) => {
    capturedConversationViewProps = {
      ...(props.onSubmitReply
        ? { onSubmitReply: props.onSubmitReply }
        : {}),
      ...(props.onStopRun ? { onStopRun: props.onStopRun } : {}),
      ...(props.stoppingRun !== undefined
        ? { stoppingRun: props.stoppingRun }
        : {}),
      ...(props.runProcessing !== undefined
        ? { runProcessing: props.runProcessing }
        : {}),
      ...(props.scrollable !== undefined
        ? { scrollable: props.scrollable }
        : {}),
    };
    return <div data-testid="agent-conversation-view" />;
  },
}));

vi.mock("../ChatSessionPendingPlaceholder", () => ({
  ChatSessionPendingPlaceholder: ({
    onSubmit,
  }: {
    onSubmit: (text: string) => Promise<void>;
  }) => (
    <button
      data-testid="placeholder-submit"
      onClick={() => {
        void onSubmit("explore the tree");
      }}
    >
      Submit
    </button>
  ),
}));

import { FeatureTreeConversationChat } from "../FeatureTreeConversationChat";

const baseSession: AgentSessionDto = {
  id: "agent-session-ftc",
  projectId: "proj-1",
  organizationId: "org-1",
  userId: "user-1",
  type: AgentSessionType.ProjectConversation,
  status: AgentSessionStatus.Started,
  sessionDate: "2026-05-17T00:00:00Z",
  conversationId: null,
  createdAt: "2026-05-17T00:00:00Z",
  updatedAt: "2026-05-17T00:00:01Z",
};

const createdConversationResponse = {
  agentSession: { ...baseSession, conversationId: "conv-new" },
  conversation: {
    id: "conv-new",
    organizationId: "org-1",
    projectId: "proj-1",
    status: ConversationStatus.Started,
    workflowName: WorkflowName.FeatureTreeConversation,
    workflowAboutId: "proj-1",
    createdAt: "2026-05-17T00:00:02Z",
    updatedAt: "2026-05-17T00:00:02Z",
  },
};

describe("FeatureTreeConversationChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedConversationViewProps = null;
    createAgentSessionConversationMock.mockResolvedValue(
      createdConversationResponse
    );
    submitMessageMock.mockResolvedValue({
      state: "succeeded",
      operationId: "operation-1",
      fingerprint: "a".repeat(64),
      kind: "submit_message",
      messageId: "message-1",
      triggerMessageId: "trigger-1",
    });
    useAgentRunLifecycleMock.mockReturnValue({
      runId: "run-ftc",
      sendUserMessage: sendUserMessageMock,
      error: null,
      retryInit: vi.fn(),
      stopRun: vi.fn(),
      stoppingRun: false,
    });
  });

  it("passes lifecycle stop wiring through to AgentConversationView", async () => {
    const stopRun = vi.fn();
    useAgentRunLifecycleMock.mockReturnValue({
      runId: "run-ftc",
      sendUserMessage: sendUserMessageMock,
      error: null,
      retryInit: vi.fn(),
      stopRun,
      stoppingRun: false,
    });

    const sessionWithConversation: AgentSessionDto = {
      ...baseSession,
      conversationId: "conv-existing",
    };

    await act(async () => {
      render(
        <FeatureTreeConversationChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={sessionWithConversation}
        />
      );
    });

    await waitFor(() => {
      expect(capturedConversationViewProps).not.toBeNull();
    });

    expect(capturedConversationViewProps?.onStopRun).toBe(stopRun);
    expect(capturedConversationViewProps?.stoppingRun).toBe(false);
    expect(capturedConversationViewProps?.scrollable).toBe(false);

    capturedConversationViewProps?.onStopRun?.();
    expect(stopRun).toHaveBeenCalledTimes(1);
  });

  it("hydrates the selected Service into the lifecycle start-run input", async () => {
    const sessionWithService: AgentSessionDto = {
      ...baseSession,
      conversationId: "conv-existing",
      serviceIds: ["service-1"],
      launchServiceId: "service-1",
    };

    await act(async () => {
      render(
        <FeatureTreeConversationChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={sessionWithService}
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

  it("passes the owned scrollport mode through for Preview mounts", async () => {
    const sessionWithConversation: AgentSessionDto = {
      ...baseSession,
      conversationId: "conv-existing",
    };

    await act(async () => {
      render(
        <FeatureTreeConversationChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={sessionWithConversation}
          scrollable
        />
      );
    });

    await waitFor(() => {
      expect(capturedConversationViewProps).not.toBeNull();
    });

    expect(capturedConversationViewProps?.scrollable).toBe(true);
  });

  it("creates the FTC conversation on first message with project workflowAbout", async () => {
    let rendered: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(
        <FeatureTreeConversationChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={baseSession}
        />
      );
    });

    const placeholder = rendered!.getByTestId("placeholder-submit");
    await act(async () => {
      placeholder.click();
    });

    await waitFor(() => {
      expect(createAgentSessionConversationMock).toHaveBeenCalledTimes(1);
    });
    expect(createAgentSessionConversationMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "proj-1",
      agentSessionId: baseSession.id,
      body: {
        workflowType: WorkflowName.FeatureTreeConversation,
        workflowAboutType: "project",
        workflowAboutId: "proj-1",
      },
    });
  });

  it("forwards the placeholder first message into the FTC payload once the run is active", async () => {
    let rendered: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(
        <FeatureTreeConversationChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={baseSession}
        />
      );
    });

    const placeholder = rendered!.getByTestId("placeholder-submit");
    await act(async () => {
      placeholder.click();
    });

    await waitFor(() => {
      expect(submitMessageMock).toHaveBeenCalledTimes(1);
    });
    const {
      organizationId: orgId,
      projectId: projectId,
      intent: message,
    } = submitMessageMock.mock.calls[0]![0];
    expect(orgId).toBe("org-1");
    expect(projectId).toBe("proj-1");
    expect(message.type).toBe("USER");
    expect(message.conversationId).toBe("conv-new");
    expect(message.parentMessageId).toBeNull();
    expect(message.data).toEqual({
      agentInput: {
        promptType: "feature_tree_conversation",
        projectId: "proj-1",
        userMessage: "explore the tree",
      },
      references: { resolved: [], unresolved: [] },
    });
  });

  it("leaves live conversation replies to AgentConversationView", async () => {
    const sessionWithConversation: AgentSessionDto = {
      ...baseSession,
      conversationId: "conv-existing",
    };

    await act(async () => {
      render(
        <FeatureTreeConversationChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={sessionWithConversation}
        />
      );
    });

    expect(capturedConversationViewProps).not.toBeNull();
    expect(submitMessageMock).not.toHaveBeenCalled();
  });

  it("routes live replies through the Feature Tree lifecycle handler", async () => {
    const sessionWithConversation: AgentSessionDto = {
      ...baseSession,
      conversationId: "conv-existing",
    };

    await act(async () => {
      render(
        <FeatureTreeConversationChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={sessionWithConversation}
        />
      );
    });

    expect(capturedConversationViewProps?.onSubmitReply).toBeDefined();
    await act(async () => {
      await capturedConversationViewProps?.onSubmitReply?.("keep exploring");
    });

    expect(sendUserMessageMock).toHaveBeenCalledExactlyOnceWith(
      "keep exploring",
      undefined,
      []
    );
  });
});
