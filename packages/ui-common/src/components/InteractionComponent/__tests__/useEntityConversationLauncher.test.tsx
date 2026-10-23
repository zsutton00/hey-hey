import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TargetEntityType } from "../../../api";
import { ConversationStartRunRequestDtoProviderEnum } from "../../../api";

const startConversationRunMutate = vi.fn();
const createSessionMutate = vi.fn();
const createSessionConversationMutate = vi.fn();
const { bindAgentSessionMachineMock, entityConversationPathMock } = vi.hoisted(
  () => ({
    bindAgentSessionMachineMock: vi.fn(),
    entityConversationPathMock: vi.fn(() => "/conversation/route"),
  }),
);
const navigateMock = vi.fn();

vi.mock("../bindGraphConversationAgentSessionMachine", () => ({
  bindGraphConversationAgentSessionMachine: bindAgentSessionMachineMock,
}));

vi.mock(
  "../../AgentSession/operations/useAgentSessionInteractionAccess",
  () => ({
    useAgentSessionInteractionAccessResolver: () => ({
      getAccess: (machineId: string) => ({
        isDeviceEnabled: true,
        interactions: {
          startSession: async (input: Record<string, unknown>) => {
            const result = await startConversationRunMutate({
              organizationId: input.organizationId,
              projectId: input.projectId,
              conversationId: input.conversationId,
              request: {
                ...(input.intent as Record<string, unknown>),
                agentSessionId: input.agentSessionId,
                machineId,
              },
            });
            return result.ok
              ? {
                  state: "succeeded",
                  triggerMessageId: result.triggerMessageId,
                }
              : { state: "failed", code: result.code, message: result.error };
          },
        },
        unavailable: null,
      }),
    }),
  }),
);

vi.mock("../../../data/hooks/useCreateAgentSession", () => ({
  useCreateAgentSession: () => ({ mutate: createSessionMutate }),
}));

vi.mock("../../../data/hooks/useCreateAgentSessionConversation", () => ({
  useCreateAgentSessionConversation: () => ({
    mutate: createSessionConversationMutate,
  }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("../../../contexts", () => ({
  usePathService: () => ({
    entityConversation: entityConversationPathMock,
  }),
}));

import { useEntityConversationLauncher } from "../useEntityConversationLauncher";

const launchInput = {
  prompt: "Discuss this task",
  context: {
    entityId: "task-1",
    entityType: TargetEntityType.Task,
  },
  provider: ConversationStartRunRequestDtoProviderEnum.Claude,
  machineId: "machine-1",
};

const renderLauncher = () =>
  renderHook(() =>
    useEntityConversationLauncher({
      organizationId: "org-1",
      projectId: "project-1",
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  createSessionMutate.mockResolvedValue({
    id: "session-1",
    conversationId: "stale-plan-conversation",
  });
  createSessionConversationMutate.mockResolvedValue({
    conversation: { id: "conversation-1" },
  });
  bindAgentSessionMachineMock.mockResolvedValue({
    id: "session-1",
    machineId: "machine-1",
  });
});

describe("useEntityConversationLauncher errors", () => {
  it("binds an Agent Session focal entity with the canonical workflow-about type", async () => {
    startConversationRunMutate.mockResolvedValue({
      ok: true,
      dispatched: true,
      triggerMessageId: "trigger-1",
    });
    const { result } = renderLauncher();

    await act(async () => {
      await result.current.launch({
        ...launchInput,
        context: {
          entityId: "source-agent-session-1",
          entityType: "AGENT_SESSION",
        },
      });
    });

    expect(createSessionConversationMutate).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionId: "session-1",
      body: {
        workflowType: "agent-entity-conversation",
        workflowAboutType: "agent-session",
        workflowAboutId: "source-agent-session-1",
      },
    });
    expect(bindAgentSessionMachineMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionId: "session-1",
      machineId: "machine-1",
    });
    expect(
      bindAgentSessionMachineMock.mock.invocationCallOrder[0],
    ).toBeLessThan(
      createSessionConversationMutate.mock.invocationCallOrder[0]!,
    );
    expect(startConversationRunMutate).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conversation-1" }),
    );
  });

  it("persists the selected provider, model, and optional effort on the session", async () => {
    startConversationRunMutate.mockResolvedValue({
      ok: true,
      dispatched: true,
      triggerMessageId: "trigger-1",
    });
    const { result } = renderLauncher();

    await act(async () => {
      await result.current.launch({
        ...launchInput,
        provider: ConversationStartRunRequestDtoProviderEnum.Codex,
        model: "selected-model",
        reasoningEffort: "high",
      });
    });

    expect(createSessionMutate).toHaveBeenCalledWith({
      organizationId: "org-1",
      agentSession: expect.objectContaining({
        provider: ConversationStartRunRequestDtoProviderEnum.Codex,
        config: {
          type: "ENTITY_CONVERSATION",
          version: "v1",
          model: "selected-model",
          effort: "high",
        },
      }),
    });
  });

  it("persists the required default model while omitting unconfigured effort", async () => {
    startConversationRunMutate.mockResolvedValue({
      ok: true,
      dispatched: true,
      triggerMessageId: "trigger-1",
    });
    const { result } = renderLauncher();

    await act(async () => {
      await result.current.launch(launchInput);
    });

    const [{ agentSession }] = createSessionMutate.mock.calls[0]!;
    expect(agentSession.config).toEqual({
      type: "ENTITY_CONVERSATION",
      version: "v1",
      model: "claude-opus-4-7",
    });
    expect(agentSession.config).not.toHaveProperty("effort");
    expect(agentSession.config).not.toHaveProperty("projectAssistant");
  });

  it("persists and forwards an explicit Project Assistant opt-out", async () => {
    startConversationRunMutate.mockResolvedValue({
      ok: true,
      dispatched: true,
      triggerMessageId: "trigger-1",
    });
    const { result } = renderLauncher();

    await act(async () => {
      await result.current.launch({
        ...launchInput,
        projectAssistant: { enabled: false },
      });
    });

    const [{ agentSession }] = createSessionMutate.mock.calls[0]!;
    expect(agentSession.config).toEqual({
      type: "ENTITY_CONVERSATION",
      version: "v1",
      model: "claude-opus-4-7",
      projectAssistant: { enabled: false },
    });
    const [{ request }] = startConversationRunMutate.mock.calls[0]!;
    expect(request).toEqual(
      expect.objectContaining({
        config: {
          type: "ENTITY_CONVERSATION",
          version: "v1",
          model: "claude-opus-4-7",
          projectAssistant: { enabled: false },
        },
      }),
    );
  });

  it("sends uploaded attachment references, or an empty list, on the start-run request", async () => {
    startConversationRunMutate.mockResolvedValue({
      ok: true,
      dispatched: true,
      triggerMessageId: "trigger-1",
    });
    const { result } = renderLauncher();
    const references = [{ attachmentId: "att-1", fileName: "notes.txt" }];

    await act(async () => {
      await result.current.launch({ ...launchInput, attachments: references });
      await result.current.launch(launchInput);
    });

    expect(
      startConversationRunMutate.mock.calls[0]![0].request.attachments,
    ).toEqual(references);
    expect(
      startConversationRunMutate.mock.calls[1]![0].request.attachments,
    ).toEqual([]);
  });

  it("preserves explicit Codex system-prompt pilot values in session config", async () => {
    startConversationRunMutate.mockResolvedValue({
      ok: true,
      dispatched: true,
      triggerMessageId: "trigger-1",
    });
    const { result } = renderLauncher();

    await act(async () => {
      await result.current.launch({
        ...launchInput,
        provider: ConversationStartRunRequestDtoProviderEnum.Codex,
        disableCodexSystemPrompt: false,
      });
    });

    const [{ agentSession }] = createSessionMutate.mock.calls[0]!;
    expect(agentSession.config).toEqual({
      type: "ENTITY_CONVERSATION",
      version: "v1",
      model: "claude-opus-4-7",
      disableCodexSystemPrompt: false,
    });
  });

  it("persists and dispatches exactly the selected Service context", async () => {
    startConversationRunMutate.mockResolvedValue({
      ok: true,
      dispatched: true,
      triggerMessageId: "trigger-1",
    });
    const { result } = renderLauncher();

    await act(async () => {
      await result.current.launch({ ...launchInput, serviceId: "service-1" });
    });

    expect(createSessionMutate).toHaveBeenCalledWith({
      organizationId: "org-1",
      agentSession: expect.objectContaining({
        serviceIds: ["service-1"],
        launchServiceId: "service-1",
      }),
    });
    const [{ request }] = startConversationRunMutate.mock.calls[0]!;
    expect(request).toEqual(
      expect.objectContaining({
        serviceIds: ["service-1"],
        launchServiceId: "service-1",
        machineId: "machine-1",
      }),
    );
  });

  it("launches a Service conversation with canonical subject and repository scope", async () => {
    startConversationRunMutate.mockResolvedValue({
      ok: true,
      dispatched: true,
      triggerMessageId: "trigger-1",
    });
    const { result } = renderLauncher();

    await act(async () => {
      await result.current.launch({
        ...launchInput,
        context: {
          entityId: "service-1",
          entityType: TargetEntityType.Service,
          entityTitle: "UI",
        },
        serviceId: "service-1",
      });
    });

    expect(createSessionMutate).toHaveBeenCalledWith({
      organizationId: "org-1",
      agentSession: expect.objectContaining({
        projectId: "project-1",
        entityId: "service-1",
        entityType: "SERVICE",
        title: "Discuss UI",
        serviceIds: ["service-1"],
        launchServiceId: "service-1",
      }),
    });
    expect(bindAgentSessionMachineMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionId: "session-1",
      machineId: "machine-1",
    });
    expect(createSessionConversationMutate).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionId: "session-1",
      body: {
        workflowType: "agent-entity-conversation",
        workflowAboutType: "service",
        workflowAboutId: "service-1",
      },
    });
    expect(startConversationRunMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conversation-1",
        request: expect.objectContaining({
          agentSessionId: "session-1",
          machineId: "machine-1",
          serviceIds: ["service-1"],
          launchServiceId: "service-1",
          payload: expect.objectContaining({
            entity: expect.objectContaining({
              entityId: "service-1",
              entityType: "SERVICE",
            }),
          }),
        }),
      }),
    );
    expect(
      bindAgentSessionMachineMock.mock.invocationCallOrder[0],
    ).toBeLessThan(
      createSessionConversationMutate.mock.invocationCallOrder[0]!,
    );
    expect(
      createSessionConversationMutate.mock.invocationCallOrder[0],
    ).toBeLessThan(startConversationRunMutate.mock.invocationCallOrder[0]!);
    expect(entityConversationPathMock).toHaveBeenCalledWith({
      projectId: "project-1",
      agentSessionId: "session-1",
      conversationId: "conversation-1",
      entityId: "service-1",
      entityType: "service",
    });
    expect(navigateMock).toHaveBeenCalledWith("/conversation/route");
  });

  it("preserves the failed start-run code and message", async () => {
    startConversationRunMutate.mockResolvedValue({
      ok: false,
      code: "NO_CLI_CONNECTION",
      error: "Conversation owner has no active CLI websocket connection",
    });
    const { result } = renderLauncher();

    let launched: boolean | undefined;
    await act(async () => {
      launched = await result.current.launch(launchInput);
    });

    expect(launched).toBe(false);
    expect(result.current.error).toEqual({
      code: "NO_CLI_CONNECTION",
      message: "Conversation owner has no active CLI websocket connection",
    });
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("preserves a generic start-run failure with a null code", async () => {
    startConversationRunMutate.mockResolvedValue({
      ok: false,
      code: null,
      error: "Unable to start this conversation",
    });
    const { result } = renderLauncher();

    await act(async () => {
      await result.current.launch(launchInput);
    });

    expect(result.current.error).toEqual({
      code: null,
      message: "Unable to start this conversation",
    });
  });

  it("normalizes pre-dispatch exceptions to a null code and clears them explicitly", async () => {
    createSessionMutate.mockRejectedValue({
      message: "Request failed with status code 500",
      response: { data: { message: "Session creation failed" } },
    });
    const { result } = renderLauncher();

    await act(async () => {
      await result.current.launch(launchInput);
    });

    expect(result.current.error).toEqual({
      code: null,
      message: "Session creation failed",
    });

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });
});

describe("initial Skill selection", () => {
  it.each([undefined, "service-1"])(
    "preserves pathless Skill identity with Service %s",
    async (serviceId) => {
      startConversationRunMutate.mockResolvedValue({
        ok: true,
        dispatched: true,
        triggerMessageId: "trigger-1",
      });
      const { result } = renderLauncher();
      const skillSelection = {
        provider: "codex" as const,
        name: "personal",
        catalogScope: "user" as const,
      };
      await act(async () => {
        await result.current.launch({
          ...launchInput,
          provider: "codex",
          skillSelection,
          ...(serviceId ? { serviceId } : {}),
        });
      });
      const [{ request }] = startConversationRunMutate.mock.calls[0]!;
      expect(request.skillSelection).toEqual(skillSelection);
      expect(Object.keys(request.skillSelection).sort()).toEqual([
        "catalogScope",
        "name",
        "provider",
      ]);
      expect(request.machineId).toBe("machine-1");
      if (serviceId) {
        expect(request.serviceIds).toEqual([serviceId]);
        expect(request.launchServiceId).toBe(serviceId);
      } else {
        expect(request).not.toHaveProperty("serviceIds");
        expect(request).not.toHaveProperty("launchServiceId");
      }
    },
  );
});
