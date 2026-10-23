import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionType, MessageType, WorkflowName } from "../../../api";
import { ConversationStartRunRequestDtoProviderEnum } from "../../../api";

const startConversationRunMutate = vi.fn();
const createSessionMutate = vi.fn();
const createSessionConversationMutate = vi.fn();
const { bindAgentSessionMachineMock } = vi.hoisted(() => ({
  bindAgentSessionMachineMock: vi.fn(),
}));
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
  })
);

vi.mock("../../../data/hooks/useCreateAgentSession", () => ({
  useCreateAgentSession: () => ({
    mutate: createSessionMutate,
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
}));

vi.mock("../../../data/hooks/useCreateAgentSessionConversation", () => ({
  useCreateAgentSessionConversation: () => ({
    mutate: createSessionConversationMutate,
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("../../../contexts", () => ({
  usePathService: () => ({
    agentSession: () => "/agent-session/route",
  }),
}));

import { useFeatureTreeConversationLauncher } from "../useFeatureTreeConversationLauncher";

const ORG_ID = "org-1";
const PROJECT_ID = "proj-1";

beforeEach(() => {
  startConversationRunMutate.mockReset();
  createSessionMutate.mockReset();
  createSessionConversationMutate.mockReset();
  bindAgentSessionMachineMock.mockReset();
  navigateMock.mockReset();

  createSessionMutate.mockResolvedValue({
    id: "session-feature-tree",
    conversationId: undefined,
  });
  createSessionConversationMutate.mockResolvedValue({
    conversation: { id: "conv-feature-tree" },
  });
  bindAgentSessionMachineMock.mockResolvedValue({
    id: "session-feature-tree",
    machineId: "machine-2",
  });
  startConversationRunMutate.mockResolvedValue({
    ok: true,
    dispatched: true,
    triggerMessageId: "msg-feature-tree",
  });
});

const renderLauncher = () =>
  renderHook(() =>
    useFeatureTreeConversationLauncher({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
    })
  );

const getDispatchedRequest = () => {
  expect(startConversationRunMutate).toHaveBeenCalledTimes(1);
  const [input] = startConversationRunMutate.mock.calls[0]!;
  return (
    input as {
      request: Record<string, unknown>;
    }
  ).request;
};

describe("useFeatureTreeConversationLauncher", () => {
  it("dispatches the project-scoped graph-only request and navigates on success", async () => {
    const { result } = renderLauncher();

    let launched: boolean | undefined;
    await act(async () => {
      launched = await result.current.launch({
        prompt: "analyze the feature hierarchy",
        provider: ConversationStartRunRequestDtoProviderEnum.Codex,
        model: "model-for-test",
        reasoningEffort: "high",
        machineId: "machine-2",
      });
    });

    expect(launched).toBe(true);
    expect(createSessionMutate).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      agentSession: expect.objectContaining({
        projectId: PROJECT_ID,
        title: "Discuss Feature Tree",
        type: AgentSessionType.ProjectConversation,
      }),
    });
    expect(createSessionConversationMutate).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      agentSessionId: "session-feature-tree",
      body: {
        workflowType: WorkflowName.FeatureTreeConversation,
      },
    });
    expect(bindAgentSessionMachineMock).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      agentSessionId: "session-feature-tree",
      machineId: "machine-2",
    });
    expect(
      bindAgentSessionMachineMock.mock.invocationCallOrder[0]
    ).toBeLessThan(
      createSessionConversationMutate.mock.invocationCallOrder[0]!
    );

    const request = getDispatchedRequest();
    expect(request).toEqual(
      expect.objectContaining({
        attachments: [],
        handlerPromptType: "feature_tree_conversation",
        payload: {
          entity: {
            entityId: PROJECT_ID,
            entityType: "PROJECT",
          },
          projectId: PROJECT_ID,
          userMessage: "analyze the feature hierarchy",
          promptType: "feature_tree_conversation",
        },
        model: "model-for-test",
        reasoningEffort: "high",
        provider: ConversationStartRunRequestDtoProviderEnum.Codex,
        machineId: "machine-2",
        agentSessionId: "session-feature-tree",
        initialMessage: { role: MessageType.User },
        contextMetadata: expect.objectContaining({
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          agentSessionId: "session-feature-tree",
          userComments: [],
          fileReferences: { resolved: [], unresolved: [] },
        }),
      })
    );
    expect(request).not.toHaveProperty("serviceIds");
    expect(request).not.toHaveProperty("launchServiceId");
    expect(navigateMock).toHaveBeenCalledWith("/agent-session/route");
  });

  it("persists and dispatches exactly the selected Service context", async () => {
    const { result } = renderLauncher();

    await act(async () => {
      await result.current.launch({
        prompt: "analyze the feature hierarchy",
        provider: ConversationStartRunRequestDtoProviderEnum.Codex,
        model: "model-for-test",
        reasoningEffort: "high",
        machineId: "machine-2",
        serviceId: "service-1",
      });
    });

    expect(createSessionMutate).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      agentSession: expect.objectContaining({
        serviceIds: ["service-1"],
        launchServiceId: "service-1",
      }),
    });
    const request = getDispatchedRequest();
    expect(request).toEqual(
      expect.objectContaining({
        serviceIds: ["service-1"],
        launchServiceId: "service-1",
        machineId: "machine-2",
      })
    );
  });
});
