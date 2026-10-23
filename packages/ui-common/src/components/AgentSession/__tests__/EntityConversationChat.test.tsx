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
  AgentSessionConfigEntityConversationV1TypeEnum,
  AgentSessionConfigEntityConversationV1VersionEnum,
  AgentSessionDtoProviderEnum,
  AgentSessionStatus,
  AgentSessionType,
  type AgentSessionDto,
} from "../../../api";
import type { AgentSessionMetadataValues } from "../AgentSessionMetadata";
import type { ConversationScrollPolicy } from "../../Conversation/ConversationViewer";

const createAgentSessionConversationMock = vi.fn();
const sendUserMessageMock = vi.fn(async () => ({ ok: true as const }));
const lifecycleArgs = vi.fn((..._args: unknown[]) => undefined);
const seedConversationGreetingMock = vi.fn(async () => {});
const useLatestMessageMock = vi.fn(() => ({
  data: null,
  isFetched: false,
  isFetching: false,
  isLoading: false,
  isReady: false,
  isStale: false,
  error: null,
  markStale: vi.fn(),
  refetch: vi.fn(async () => null),
}));
const useWorkItemMock = vi.fn((..._args: unknown[]) => ({
  workItem: null as { type: string } | null,
}));

vi.mock("../../../clients/client", () => ({
  apiClient: {
    startConversationRun: vi.fn(async () => ({})),
    postMessage: vi.fn(async () => {}),
    stopAgentSessionRun: vi.fn(async () => {}),
  },
}));

vi.mock("../../../data/hooks/useCreateAgentSessionConversation", () => ({
  useCreateAgentSessionConversation: () => ({
    mutate: createAgentSessionConversationMock,
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
}));

vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: (...args: unknown[]) => useWorkItemMock(...args),
}));

// Fixed provider/model/effort so the forwarded launch args are deterministic.
vi.mock("../surfaceSelectionMemory", () => ({
  DISCUSS_SURFACE_ID: "discuss",
  buildDefaultSurfaceSelection: () => ({
    provider: "claude",
    model: "fallback-model",
    reasoningEffort: null,
  }),
  readSurfaceSelection: () => ({
    provider: "claude",
    model: "claude-opus-4-7",
    reasoningEffort: "high",
  }),
}));

// Short-circuit the run machinery: a populated runId routes the component
// straight to AgentConversationView, where the new-conversation handler lives.
vi.mock("../useAgentRunLifecycle", () => ({
  useAgentRunLifecycle: (args: unknown) => {
    lifecycleArgs(args);
    return {
      runId: "run-1",
      error: null,
      errorCode: null,
      retryInit: vi.fn(),
      stopRun: vi.fn(),
      stoppingRun: false,
      sendUserMessage: sendUserMessageMock,
    };
  },
}));

// Prevent greeting-seed effects from firing unhandled promises.
vi.mock("../../../data/hooks/useLatestMessage", () => ({
  useLatestMessage: () => useLatestMessageMock(),
}));

vi.mock("../runtime/hooks/seedConversationGreeting", () => ({
  seedConversationGreeting: (...args: unknown[]) =>
    seedConversationGreetingMock(...args),
}));

vi.mock("../useLaunchRunOrchestration", () => ({
  useLaunchRunOrchestration: () => vi.fn(),
}));

vi.mock("../RunContextUsageCapsules", () => ({
  useLatestProviderSessionId: () => "selected-provider",
}));
vi.mock("../SessionContextUsageCapsules", () => ({
  SessionContextUsageCapsules: ({
    runId,
    providerSessionId,
    provider,
  }: {
    runId: string;
    providerSessionId: string | undefined;
    provider: string;
  }) => (
    <div
      data-testid="run-context-usage-capsules"
      data-run-id={runId}
      data-provider-session-id={providerSessionId}
      data-provider={provider}
    />
  ),
}));

// Capture the callback at the view boundary so tests can prove that fresh-thread
// creation is only wired when the embedding surface explicitly opts in.
const wired: {
  onCreateNewConversation?: (draftText: string) => Promise<void>;
  scrollable?: boolean;
  scrollPolicy?: ConversationScrollPolicy;
  fileReferenceScope?: { kind: string };
  agentSessionMetadata?: AgentSessionMetadataValues;
  confirmBeforeNewConversation?: boolean;
  actionsSlot?: React.ReactNode;
} = {};

vi.mock("../AgentConversationView", () => ({
  AgentConversationView: ({
    conversationId,
    onCreateNewConversation,
    scrollable,
    scrollPolicy,
    fileReferenceScope,
    agentSessionMetadata,
    confirmBeforeNewConversation,
    actionsSlot,
  }: {
    conversationId: string;
    onCreateNewConversation?: (draftText: string) => Promise<void>;
    scrollable?: boolean;
    fileReferenceScope?: { kind: string };
    agentSessionMetadata?: AgentSessionMetadataValues;
    confirmBeforeNewConversation?: boolean;
    actionsSlot?: React.ReactNode;
  }) => {
    wired.onCreateNewConversation = onCreateNewConversation;
    wired.scrollable = scrollable;
    wired.scrollPolicy = scrollPolicy;
    wired.fileReferenceScope = fileReferenceScope;
    wired.agentSessionMetadata = agentSessionMetadata;
    wired.confirmBeforeNewConversation = confirmBeforeNewConversation;
    wired.actionsSlot = actionsSlot;
    return (
      <div data-testid="agent-conversation-view">
        <span data-testid="conversation-id">{conversationId}</span>
        <button
          type="button"
          aria-label="new-with-draft"
          onClick={() => onCreateNewConversation?.("carry this draft forward")}
        >
          new-with-draft
        </button>
        <button
          type="button"
          aria-label="new-empty"
          onClick={() => onCreateNewConversation?.("")}
        >
          new-empty
        </button>
      </div>
    );
  },
}));

import { EntityConversationChat } from "../EntityConversationChat";

const boundSession: AgentSessionDto = {
  id: "agent-session-1",
  projectId: "proj-1",
  organizationId: "org-1",
  userId: "user-1",
  type: AgentSessionType.EntityConversation,
  status: AgentSessionStatus.Running,
  sessionDate: "2026-05-30T00:00:00Z",
  conversationId: "conv-existing",
  createdAt: "2026-05-30T00:00:00Z",
  updatedAt: "2026-05-30T00:00:01Z",
};

const renderChat = async (
  scrollable = false,
  confirmBeforeNewConversation = false,
  onCreateNewConversation?: (draftText: string) => Promise<void>,
) => {
  await act(async () => {
    render(
      <EntityConversationChat
        organizationId="org-1"
        projectId="proj-1"
        agentSession={boundSession}
        entityId="plan-1"
        entityType="TASK"
        scrollable={scrollable}
        onCreateNewConversation={onCreateNewConversation}
        confirmBeforeNewConversation={confirmBeforeNewConversation}
      />,
    );
  });
  await screen.findByTestId("agent-conversation-view");
};

describe("EntityConversationChat new-conversation opt-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wired.scrollable = undefined;
    wired.scrollPolicy = undefined;
    wired.fileReferenceScope = undefined;
    wired.agentSessionMetadata = undefined;
    wired.onCreateNewConversation = undefined;
    wired.confirmBeforeNewConversation = undefined;
    wired.actionsSlot = undefined;
    useWorkItemMock.mockReturnValue({ workItem: null });
    useLatestMessageMock.mockReturnValue({
      data: null,
      isFetched: false,
      isFetching: false,
      isLoading: false,
      isReady: false,
      isStale: false,
      error: null,
      markStale: vi.fn(),
      refetch: vi.fn(async () => null),
    });
  });

  it("forwards the bounded-scroll layout contract to the conversation view", async () => {
    await renderChat(true);

    expect(wired.scrollable).toBe(true);
    expect(screen.getByTestId("entity-conversation-chat")).toHaveStyle({
      minWidth: "0",
      width: "100%",
      maxWidth: "100%",
      overflowX: "hidden",
    });
  });

  it("mounts the Context capsule for the active entity conversation run", async () => {
    await renderChat();

    expect(screen.getByTestId("run-context-usage-capsules")).toHaveAttribute(
      "data-run-id",
      "run-1",
    );
    expect(screen.getByTestId("run-context-usage-capsules")).toHaveAttribute(
      "data-provider-session-id",
      "selected-provider",
    );
    expect(screen.getByTestId("run-context-usage-capsules")).toHaveAttribute(
      "data-provider",
      "claude",
    );
  });

  it("passes the runtime-selected provider to the Context capsule", async () => {
    await act(async () => {
      render(
        <EntityConversationChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={boundSession}
          entityId="plan-1"
          entityType="TASK"
          runtimeSelection={{
            provider: AgentSessionDtoProviderEnum.Codex,
            model: "gpt-5-codex",
            reasoningEffort: "high",
          }}
        />,
      );
    });
    await screen.findByTestId("agent-conversation-view");

    expect(screen.getByTestId("run-context-usage-capsules")).toHaveAttribute(
      "data-provider",
      "codex",
    );
  });

  it("forwards a caller-owned scroll policy without enabling the legacy scrollport", async () => {
    const ownerRef = { current: null as HTMLElement | null };
    const scrollPolicy = {
      mode: "owned",
      ownerRef,
    } as const satisfies ConversationScrollPolicy;

    await act(async () => {
      render(
        <EntityConversationChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={boundSession}
          entityId="plan-1"
          entityType="TASK"
          scrollPolicy={scrollPolicy}
        />,
      );
    });
    await screen.findByTestId("agent-conversation-view");

    expect(wired.scrollPolicy).toBe(scrollPolicy);
    expect(wired.scrollable).toBe(false);
  });

  it("does not provide a fallback fresh-thread handler", async () => {
    await renderChat(false, true);

    expect(wired.onCreateNewConversation).toBeUndefined();
    expect(wired.confirmBeforeNewConversation).toBe(true);
  });

  it("forwards an explicitly owned fresh-thread handler", async () => {
    const onCreateNewConversation = vi.fn(async (_draftText: string) => {});

    await renderChat(false, true, onCreateNewConversation);

    expect(wired.onCreateNewConversation).toBe(onCreateNewConversation);
    expect(wired.confirmBeforeNewConversation).toBe(true);
  });

  it("places caller controls in the slot below the reply composer", async () => {
    const actionsSlot = <div data-testid="runtime-controls" />;

    await act(async () => {
      render(
        <EntityConversationChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={boundSession}
          entityId="plan-1"
          entityType="TASK"
          actionsSlot={actionsSlot}
        />,
      );
    });
    await screen.findByTestId("agent-conversation-view");

    expect(wired.actionsSlot).toBe(actionsSlot);
  });

  it("forwards task and feature scope to the ongoing conversation composer", async () => {
    useWorkItemMock.mockReturnValue({ workItem: { type: "FEATURE" } });

    await act(async () => {
      render(
        <EntityConversationChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={boundSession}
          entityId="feature-1"
          entityType="FEATURE"
        />,
      );
    });
    await screen.findByTestId("agent-conversation-view");

    expect(wired.fileReferenceScope).toEqual({
      kind: "feature",
      featureId: "feature-1",
    });
  });

  it("forwards metadata from the durable session config", async () => {
    const durableSession: AgentSessionDto = {
      ...boundSession,
      provider: AgentSessionDtoProviderEnum.Codex,
      config: {
        type: AgentSessionConfigEntityConversationV1TypeEnum.EntityConversation,
        version: AgentSessionConfigEntityConversationV1VersionEnum.V1,
        model: "gpt-5-codex",
        effort: "high",
      },
    };

    await act(async () => {
      render(
        <EntityConversationChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={durableSession}
          entityId="plan-1"
          entityType="TASK"
        />,
      );
    });
    await screen.findByTestId("agent-conversation-view");

    expect(wired.agentSessionMetadata).toEqual({
      provider: "codex",
      model: "gpt-5-codex",
      effort: "high",
    });
  });

  it("keeps replies in the entity conversation mode for an ordinary session", async () => {
    await act(async () => {
      render(
        <EntityConversationChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={boundSession}
          entityId="feature-1"
          entityType="FEATURE"
        />,
      );
    });
    await screen.findByTestId("agent-conversation-view");

    expect(lifecycleArgs.mock.lastCall?.[0]).toMatchObject({
      arm: { kind: "handler", promptType: "entity_conversation" },
    });
  });

  it("keeps replies in the Verify Feature mode for a session that carries the marker", async () => {
    const verifyFeature = {
      concern: "The retry loop shipped without a requirement.",
      parentAgentSessionId: "9d6c4a8e-2f0b-4a53-8d1e-7c3b5a1f2e40",
      impactedEntities: [
        {
          entityType: "TASK",
          entityId: "5b1e2c3d-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
        },
      ],
    };
    const verifySession: AgentSessionDto = {
      ...boundSession,
      config: {
        type: AgentSessionConfigEntityConversationV1TypeEnum.EntityConversation,
        version: AgentSessionConfigEntityConversationV1VersionEnum.V1,
        model: "claude-opus-4-7",
        verifyFeature,
      },
    };

    await act(async () => {
      render(
        <EntityConversationChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={verifySession}
          entityId="feature-1"
          entityType="FEATURE"
        />,
      );
    });
    await screen.findByTestId("agent-conversation-view");

    expect(lifecycleArgs.mock.lastCall?.[0]).toMatchObject({
      arm: {
        kind: "handler",
        promptType: "verify_feature",
        payload: {
          promptType: "verify_feature",
          entity: { entityType: "TASK", entityId: "feature-1" },
          ...verifyFeature,
        },
      },
    });
  });

  it("derives generic task scope from the loaded work-item subtype", async () => {
    useWorkItemMock.mockReturnValue({ workItem: { type: "STANDARD" } });

    await act(async () => {
      render(
        <EntityConversationChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={boundSession}
          entityId="task-1"
          entityType="TASK"
        />,
      );
    });
    await screen.findByTestId("agent-conversation-view");

    expect(useWorkItemMock).toHaveBeenCalledWith("org-1", "task", "task-1", {
      projectId: "proj-1",
      enabled: true,
    });
    expect(wired.fileReferenceScope).toEqual({
      kind: "task",
      taskId: "task-1",
    });
  });

  it("notifies once after binding the conversation and sends the retained message after greeting", async () => {
    const events: string[] = [];
    createAgentSessionConversationMock.mockResolvedValue({
      conversation: { id: "conv-created" },
    });
    const onConversationReady = vi.fn((conversationId: string) => {
      events.push(`ready:${conversationId}`);
    });
    seedConversationGreetingMock.mockImplementation(async () => {
      events.push("greeting");
    });
    sendUserMessageMock.mockImplementation(async (message: string) => {
      events.push(`message:${message}`);
      return { ok: true as const };
    });
    useLatestMessageMock.mockReturnValue({
      data: null,
      isFetched: true,
      isFetching: false,
      isLoading: false,
      isReady: true,
      isStale: false,
      error: null,
      markStale: vi.fn(),
      refetch: vi.fn(async () => null),
    });

    const { rerender } = render(
      <EntityConversationChat
        organizationId="org-1"
        projectId="proj-1"
        agentSession={{ ...boundSession, conversationId: null }}
        entityId="task-1"
        entityType="TASK"
        initialUserMessage="retain this"
        onConversationReady={onConversationReady}
      />,
    );

    await waitFor(() =>
      expect(sendUserMessageMock).toHaveBeenCalledWith("retain this"),
    );
    rerender(
      <EntityConversationChat
        organizationId="org-1"
        projectId="proj-1"
        agentSession={{ ...boundSession, conversationId: null }}
        entityId="task-1"
        entityType="TASK"
        initialUserMessage="retain this"
        onConversationReady={onConversationReady}
      />,
    );

    expect(events).toEqual([
      "ready:conv-created",
      "greeting",
      "message:retain this",
    ]);
    expect(onConversationReady).toHaveBeenCalledTimes(1);
    expect(sendUserMessageMock).toHaveBeenCalledTimes(1);
    expect(createAgentSessionConversationMock).toHaveBeenCalledTimes(1);
  });
  it("transfers a request once into an existing thread without seeding another greeting", async () => {
    useLatestMessageMock.mockReturnValue({
      data: { id: "existing-message" },
      isFetched: true,
      markStale: vi.fn(),
    });
    const onSent = vi.fn();
    const onRequest = vi.fn();
    const props = {
      organizationId: "org-1",
      projectId: "proj-1",
      agentSession: boundSession,
      entityId: "task-1",
      entityType: "TASK",
      initialUserMessage: "Continue this discussion",
      onInitialUserMessageSent: onSent,
      onGoalPmRequestSubmitted: onRequest,
    };
    const { rerender } = render(<EntityConversationChat {...props} />);
    await waitFor(() =>
      expect(sendUserMessageMock).toHaveBeenCalledExactlyOnceWith(
        "Continue this discussion",
      ),
    );
    rerender(<EntityConversationChat {...props} />);
    expect(seedConversationGreetingMock).not.toHaveBeenCalled();
    expect(sendUserMessageMock).toHaveBeenCalledTimes(1);
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(onRequest).not.toHaveBeenCalled();
  });
  it("retains the first message for retry when runtime persistence fails", async () => {
    useLatestMessageMock.mockReturnValue({
      data: { id: "existing-message" },
      isFetched: true,
      markStale: vi.fn(),
    });
    const persist = vi
      .fn()
      .mockRejectedValueOnce(new Error("Temporary failure"))
      .mockResolvedValue(undefined);
    const onSent = vi.fn();
    render(
      <EntityConversationChat
        organizationId="org-1"
        projectId="proj-1"
        agentSession={boundSession}
        entityId="task-1"
        entityType="TASK"
        initialUserMessage="Keep this request"
        onBeforeLocalExecution={persist}
        onInitialUserMessageSent={onSent}
      />,
    );
    await screen.findByTestId("session-error-retry");
    expect(sendUserMessageMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("session-error-retry"));
    await waitFor(() =>
      expect(sendUserMessageMock).toHaveBeenCalledExactlyOnceWith(
        "Keep this request",
      ),
    );
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it("holds the retained first message until the CLI's catalog has named a runtime selection", async () => {
    useLatestMessageMock.mockReturnValue({
      data: { id: "existing-message" },
      isFetched: true,
      markStale: vi.fn(),
    });
    const props = {
      organizationId: "org-1",
      projectId: "proj-1",
      agentSession: boundSession,
      entityId: "task-1",
      entityType: "TASK" as const,
      initialUserMessage: "Keep this request",
    };
    const { rerender } = render(
      <EntityConversationChat {...props} runtimeSelection={null} />,
    );
    await screen.findByTestId("agent-conversation-view");
    expect(sendUserMessageMock).not.toHaveBeenCalled();

    rerender(
      <EntityConversationChat
        {...props}
        runtimeSelection={{
          provider: AgentSessionDtoProviderEnum.Codex,
          model: "gpt-5-codex",
          reasoningEffort: "high",
        }}
      />,
    );
    await waitFor(() =>
      expect(sendUserMessageMock).toHaveBeenCalledExactlyOnceWith(
        "Keep this request",
      ),
    );
  });
});
