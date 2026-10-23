import { http, HttpResponse } from "msw";
import type { AgentConversationViewProps } from "../AgentConversationView";
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
  MessageType,
  WorkflowName,
  type AgentSessionDto,
} from "../../../api";

/**
 * Start-run envelope regression for EntityConversationChat.
 *
 * Drives the chat through its eager-creation + deferred-dispatch flow with the
 * REAL useAgentRunLifecycle and useLaunchRunOrchestration so the dispatched
 * `ConversationStartRunRequestDto` can be inspected. The conversation is created
 * on mount (no user action); start-run fires only when the user sends a message
 * through AgentConversationView's onDirectTrigger → sendUserMessage.
 */

const startSessionMock = vi.fn();
const createAgentSessionConversationMock = vi.fn();
const seedConversationGreetingMock = vi.fn(async () => {});

vi.mock("../../../clients/client", () => ({
  apiClient: {
    postMessage: vi.fn(async () => {}),
    stopAgentSessionRun: vi.fn(async () => {}),
  },
}));

vi.mock("../operations/useAgentSessionInteractionAccess", () => ({
  useAgentSessionInteractionAccess: () => ({
    isDeviceEnabled: true,
    interactions: { startSession: startSessionMock, submitMessage: vi.fn() },
    unavailable: null,
  }),
  useAgentSessionInteractionAccessResolver: () => ({
    getAccess: () => ({
      isDeviceEnabled: true,
      interactions: { startSession: startSessionMock, submitMessage: vi.fn() },
      unavailable: null,
    }),
  }),
}));

// The active view wires a default new-conversation handler via the entity
// launcher (which pulls in useNavigate/usePathService). This test only exercises
// the start-run envelope, so stub the launcher out.
vi.mock("../../InteractionComponent/useEntityConversationLauncher", () => ({
  useEntityConversationLauncher: () => ({
    launch: vi.fn(async () => true),
    isLoading: false,
    error: null,
  }),
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
  useWorkItem: (_org: string, _kind: string, id: string) => ({
    workItem: {
      type: id === "goal-1" ? "GOAL" : id === "feature-1" ? "FEATURE" : "PLAN",
      sections: [
        {
          key: "description",
          materializedMarkdown: "Description loaded after page rehydration.",
          order: 0,
        },
      ],
      dueDate: "2026-09-30",
      trackedEntities: [],
    },
    isFetched: true,
  }),
}));

// A conflicting remembered selection proves durable session config wins after
// the chat is reconstructed.
vi.mock("../surfaceSelectionMemory", () => ({
  DISCUSS_SURFACE_ID: "discuss",
  buildDefaultSurfaceSelection: () => ({
    provider: "claude",
    model: "fallback-model",
    reasoningEffort: null,
  }),
  readSurfaceSelection: () => ({
    provider: "claude",
    model: "remembered-model",
    reasoningEffort: "high",
  }),
}));

// Greeting seed is a no-op in this test — we're only exercising the
// start-run envelope, not the greeting row.
vi.mock("../runtime/hooks/seedConversationGreeting", () => ({
  seedConversationGreeting: (...args: unknown[]) =>
    seedConversationGreetingMock(...args),
}));

// Return isFetched: true + data: null so the greeting seed effect can proceed
// (and immediately short-circuit since seedConversationGreeting is mocked).
vi.mock("../../../data/hooks/useLatestMessage", () => ({
  useLatestMessage: () => ({
    data: null,
    isFetched: true,
    isFetching: false,
    isLoading: false,
    isReady: true,
    isStale: false,
    error: null,
    markStale: vi.fn(),
    refetch: vi.fn(async () => null),
  }),
}));

// Capture onDirectTrigger so the test can drive user sends through it.
const wired: {
  onDirectTrigger?: (message: unknown) => Promise<void>;
  attachedAgent?: AgentConversationViewProps["attachedAgent"];
} = {};

vi.mock("../AgentConversationView", () => ({
  AgentConversationView: ({
    conversationId,
    onDirectTrigger,
    attachedAgent,
  }: {
    attachedAgent?: AgentConversationViewProps["attachedAgent"];
    conversationId: string;
    onDirectTrigger?: (message: unknown) => Promise<void>;
  }) => {
    wired.onDirectTrigger = onDirectTrigger;
    wired.attachedAgent = attachedAgent;
    const [value, setValue] = React.useState("");
    return (
      <div data-testid="agent-conversation-view">
        <span data-testid="conversation-id">{conversationId}</span>
        <input
          placeholder="Type your message…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          type="button"
          aria-label="Send"
          onClick={() => {
            if (onDirectTrigger) {
              void onDirectTrigger({
                type: MessageType.User,
                projectId: "proj-1",
                conversationId,
                data: {
                  agentInput: {
                    promptType: "coding_freeform",
                    userMessage: value,
                  },
                },
              });
            }
          }}
        >
          Send
        </button>
      </div>
    );
  },
}));

import { EntityConversationChat } from "../EntityConversationChat";

const baseSession: AgentSessionDto = {
  id: "agent-session-1",
  projectId: "proj-1",
  organizationId: "org-1",
  userId: "user-1",
  type: AgentSessionType.EntityConversation,
  provider: "codex",
  config: {
    type: "ENTITY_CONVERSATION",
    version: "v1",
    model: "persisted-model",
    effort: "low",
    projectAssistant: { enabled: false },
  },
  status: AgentSessionStatus.NotStarted,
  sessionDate: "2026-05-30T00:00:00Z",
  conversationId: null,
  machineId: "machine-1",
  createdAt: "2026-05-30T00:00:00Z",
  updatedAt: "2026-05-30T00:00:01Z",
};

describe("EntityConversationChat start-run envelope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wired.onDirectTrigger = undefined;
    createAgentSessionConversationMock.mockImplementation(async () => ({
      agentSession: { ...baseSession, conversationId: "conv-new" },
      conversation: {
        id: "conv-new",
        organizationId: "org-1",
        projectId: "proj-1",
        status: ConversationStatus.Started,
        workflowName: WorkflowName.AgentEntityConversation,
        createdAt: "2026-05-30T00:00:02Z",
        updatedAt: "2026-05-30T00:00:02Z",
      },
    }));
    startSessionMock.mockResolvedValue({
      operationId: "operation-1",
      fingerprint: "fingerprint-1",
      kind: "start_run",
      state: "succeeded",
      messageId: "message-1",
      triggerMessageId: "msg-1",
    });
  });

  it("offers a catalog before the first reply and carries its selection through the real launch owner", async () => {
    await act(async () => {
      render(
        <EntityConversationChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={{
            ...baseSession,
            conversationId: "existing-conversation",
          }}
          entityId="plan-1"
          entityType="TASK"
        />
      );
    });
    await screen.findByTestId("agent-conversation-view");
    expect(wired.attachedAgent).toMatchObject({
      machineId: "machine-1",
      provider: "codex",
      catalogContext: { policy: "non_repository" },
    });
    expect(startSessionMock).not.toHaveBeenCalled();
    const skillSelection = {
      provider: "codex",
      name: "personal",
      catalogScope: "user",
    };
    await act(async () => {
      await wired.onDirectTrigger?.({
        type: MessageType.User,
        projectId: "proj-1",
        conversationId: "existing-conversation",
        data: {
          agentInput: {
            promptType: "coding_freeform",
            userMessage: "Use personal Skill",
            skillSelection,
          },
        },
      });
    });
    expect(startSessionMock).toHaveBeenCalledTimes(1);
    expect(startSessionMock.mock.calls[0]![0].intent).toMatchObject({
      skillSelection,
    });
  });

  it("creates conversation on mount, then dispatches the entity_conversation start-run after a user message", async () => {
    await act(async () => {
      render(
        <EntityConversationChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={baseSession}
          entityId="plan-1"
          entityType="TASK"
        />
      );
    });

    // Conversation is created eagerly on mount — no user action needed.
    await waitFor(() => {
      expect(createAgentSessionConversationMock).toHaveBeenCalledTimes(1);
    });
    expect(createAgentSessionConversationMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "proj-1",
      agentSessionId: "agent-session-1",
      body: {
        workflowType: WorkflowName.AgentEntityConversation,
        workflowAboutType: "task",
        workflowAboutId: "plan-1",
      },
    });

    // AgentConversationView is shown once the conversation is bound.
    await screen.findByTestId("agent-conversation-view");

    // Start-run has NOT fired yet — deferred until user sends.
    expect(startSessionMock).not.toHaveBeenCalled();

    // User sends a message through AgentConversationView.
    const input = screen.getByPlaceholderText(
      "Type your message…"
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "tell me about this plan" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });

    // sendUserMessage fires the start-run with the full entity_conversation envelope.
    await waitFor(() => {
      expect(startSessionMock).toHaveBeenCalledTimes(1);
    });

    const [variables] = startSessionMock.mock.calls[0]!;
    const {
      organizationId: orgId,
      projectId,
      conversationId,
      intent,
    } = variables as {
      organizationId: string;
      projectId: string;
      conversationId: string;
      intent: Record<string, unknown>;
    };
    expect(orgId).toBe("org-1");
    expect(projectId).toBe("proj-1");
    expect(conversationId).toBe("conv-new");

    const dto = intent;
    expect(dto.handlerPromptType).toBe("entity_conversation");
    expect(dto.provider).toBe("codex");
    expect(dto.model).toBe("persisted-model");
    expect(dto.reasoningEffort).toBe("low");
    expect(dto.config).toEqual(baseSession.config);
    // Non-coding session: no service is carried.
    expect(dto).not.toHaveProperty("serviceId");

    const payload = dto.payload as {
      promptType: string;
      entity: { entityId: string; entityType: string };
    };
    expect(payload.promptType).toBe("entity_conversation");
    expect(payload.entity).toEqual({
      entityId: "plan-1",
      entityType: "TASK",
      taskType: "PLAN",
    });
  });

  it("rehydrates legacy work-item Run identity as TASK with its subtype", async () => {
    await act(async () => {
      render(
        <EntityConversationChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={baseSession}
          entityId="feature-1"
          entityType="feature"
        />
      );
    });

    await screen.findByTestId("agent-conversation-view");
    const input = screen.getByPlaceholderText(
      "Type your message…"
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "continue this feature" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });

    await waitFor(() => {
      expect(startSessionMock).toHaveBeenCalledTimes(1);
    });

    const payload = startSessionMock.mock.calls[0]![0].intent.payload as {
      entity: { entityId: string; entityType: string; taskType?: string };
    };
    expect(payload.entity).toEqual({
      entityId: "feature-1",
      entityType: "TASK",
      taskType: "FEATURE",
    });
    expect(createAgentSessionConversationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ workflowAboutType: "task" }),
      })
    );
  });

  it("includes the caller-owned goal snapshot in the embedded conversation's first run", async () => {
    await act(async () => {
      render(
        <EntityConversationChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={baseSession}
          entityId="goal-1"
          entityType="TASK"
          goalSnapshot={{
            description: "Coordinate the launch across teams.",
            dueDate: "2026-08-31",
            trackedEntities: [],
          }}
        />
      );
    });

    await screen.findByTestId("agent-conversation-view");
    const input = screen.getByPlaceholderText(
      "Type your message…"
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "What should happen next?" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });

    await waitFor(() => {
      expect(startSessionMock).toHaveBeenCalledTimes(1);
    });
    const request = startSessionMock.mock.calls[0]![0].intent;
    const payload = (request as Record<string, unknown>).payload as {
      entity: Record<string, unknown>;
    };
    expect(payload.entity).toEqual({
      entityId: "goal-1",
      entityType: "TASK",
      taskType: "GOAL",
      description: "Coordinate the launch across teams.",
      dueDate: "2026-08-31",
      trackedEntities: [],
    });
  });

  it("carries the caller-owned conversation inventory into the Goal PM launch envelope", async () => {
    const conversationInventory = [
      {
        conversationId: "11111111-1111-4111-8111-111111111111",
        title: "Launch planning",
        owner: {
          entityType: "TASK" as const,
          entityId: "22222222-2222-4222-8222-222222222222",
          taskType: "GOAL" as const,
        },
        workflowName: WorkflowName.EntityConversation,
      },
    ];
    await act(async () => {
      render(
        <EntityConversationChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={{
            ...baseSession,
            conversationId: "goal-pm-conversation",
          }}
          entityId="goal-1"
          entityType="TASK"
          goalPm={{ conversationInventory }}
        />
      );
    });

    await screen.findByTestId("agent-conversation-view");
    await act(async () => {
      await wired.onDirectTrigger?.({
        type: MessageType.User,
        projectId: "proj-1",
        conversationId: "goal-pm-conversation",
        data: {
          agentInput: {
            promptType: "coding_freeform",
            userMessage: "Where should this go?",
          },
        },
      });
    });

    const request = startSessionMock.mock.calls[0]![0].intent;
    expect((request as Record<string, unknown>).payload).toMatchObject({
      promptType: "goal_pm",
      activeConversationId: "goal-pm-conversation",
      conversationInventory,
    });
  });

  it("rehydrates goal context for the first run when the page caller has no snapshot", async () => {
    await act(async () => {
      render(
        <EntityConversationChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={baseSession}
          entityId="goal-1"
          entityType="TASK"
        />
      );
    });

    await screen.findByTestId("agent-conversation-view");
    const input = screen.getByPlaceholderText(
      "Type your message…"
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "What should happen next?" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });

    await waitFor(() => {
      expect(startSessionMock).toHaveBeenCalledTimes(1);
    });
    const request = startSessionMock.mock.calls[0]![0].intent;
    const payload = (request as Record<string, unknown>).payload as {
      entity: Record<string, unknown>;
    };
    expect(payload.entity).toEqual({
      entityId: "goal-1",
      entityType: "TASK",
      taskType: "GOAL",
      description: "Description loaded after page rehydration.",
      dueDate: "2026-09-30",
      trackedEntities: [],
    });
  });

  it("waits for the entity to hydrate before creating the conversation — never creates with an empty entityId", async () => {
    // Regression for the hydration race: the entity-conversation page resolves
    // `entityId` from a second fetch that lands after `conversationId`, so the
    // chat first renders with an empty entityId. The eager conversation creation
    // must NOT fire with an empty entityId; it must wait until the entity hydrates.
    const boundSession: AgentSessionDto = {
      ...baseSession,
      conversationId: "conv-existing",
    };

    let rerender: (ui: React.ReactElement) => void = () => {};
    await act(async () => {
      ({ rerender } = render(
        <EntityConversationChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={boundSession}
          entityId=""
          entityType="TASK"
        />
      ));
    });

    // Empty entity → conversation creation is gated, nothing dispatched.
    expect(createAgentSessionConversationMock).not.toHaveBeenCalled();
    expect(startSessionMock).not.toHaveBeenCalled();

    // The conversation fetch resolves and the entity hydrates.
    await act(async () => {
      rerender(
        <EntityConversationChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={boundSession}
          entityId="plan-1"
          entityType="TASK"
        />
      );
    });

    // Conversation already exists — no new conversation is created.
    expect(createAgentSessionConversationMock).not.toHaveBeenCalled();

    // AgentConversationView is shown with the existing conversation.
    await screen.findByTestId("agent-conversation-view");
    expect(screen.getByTestId("conversation-id")).toHaveTextContent(
      "conv-existing"
    );

    // Start-run is deferred — fires only when the user sends a message.
    expect(startSessionMock).not.toHaveBeenCalled();

    // User sends → start-run fires with the correctly hydrated entityId.
    const input = screen.getByPlaceholderText(
      "Type your message…"
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "tell me about this plan" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });

    await waitFor(() => {
      expect(startSessionMock).toHaveBeenCalledTimes(1);
    });

    const request = startSessionMock.mock.calls[0]![0].intent;
    const payload = (request as Record<string, unknown>).payload as {
      entity: { entityId: string; entityType: string };
    };
    expect(payload.entity).toEqual({
      entityId: "plan-1",
      entityType: "TASK",
      taskType: "PLAN",
    });
  });

  it("hydrates an explicit Service from the durable session into the first turn", async () => {
    const selectedServiceSession: AgentSessionDto = {
      ...baseSession,
      serviceIds: ["service-1"],
      launchServiceId: "service-1",
    };

    await act(async () => {
      render(
        <EntityConversationChat
          organizationId="org-1"
          projectId="proj-1"
          agentSession={selectedServiceSession}
          entityId="plan-1"
          entityType="TASK"
        />
      );
    });

    await screen.findByTestId("agent-conversation-view");
    const input = screen.getByPlaceholderText(
      "Type your message…"
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "use the repository" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });

    await waitFor(() => {
      expect(startSessionMock).toHaveBeenCalledTimes(1);
    });
    const request = startSessionMock.mock.calls[0]![0].intent;
    expect(request).toEqual(
      expect.objectContaining({
        serviceIds: ["service-1"],
        launchServiceId: "service-1",
      })
    );
  });
});

beforeEach(() => {
  globalThis.mswServer.use(
    http.get("*/api/v1/organizations/org-1/projects/proj-1/messages", () =>
      HttpResponse.json({ success: true, data: [] })
    )
  );
});
