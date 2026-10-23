import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentSessionType,
  EntityType,
  MessageType,
  TargetEntityType,
  type TrackedEntitySnapshot,
} from "../../../api";
import { ConversationStartRunRequestDtoProviderEnum } from "../../../api";

// ---------------------------------------------------------------------------
// Module mocks — capture the request submitted to the platform so the test
// can assert how the launcher decorates the entity block when launching from
// a goal vs from a non-goal task.
// ---------------------------------------------------------------------------

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
  }),
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
    entityConversation: () => "/conv/route",
  }),
}));

import { useEntityConversationLauncher } from "../useEntityConversationLauncher";

const ORG_ID = "org-1";
const PROJECT_ID = "proj-1";
const GOAL_ID = "goal-7";

const TRACKED_ENTITIES: TrackedEntitySnapshot[] = [
  {
    targetEntityId: "feature-1",
    targetEntityType: EntityType.Task,
    title: "Ship onboarding",
  },
];

beforeEach(() => {
  startConversationRunMutate.mockReset();
  createSessionMutate.mockReset();
  createSessionConversationMutate.mockReset();
  bindAgentSessionMachineMock.mockReset();
  navigateMock.mockReset();

  createSessionMutate.mockResolvedValue({
    id: "session-1",
    conversationId: "stale-plan-conversation",
  });
  bindAgentSessionMachineMock.mockResolvedValue({
    id: "session-1",
    machineId: "machine-1",
  });
  createSessionConversationMutate.mockResolvedValue({
    conversation: { id: "conv-1" },
  });
  startConversationRunMutate.mockResolvedValue({
    ok: true,
    dispatched: true,
    triggerMessageId: "msg-1",
  });
});

const renderLauncher = () =>
  renderHook(() =>
    useEntityConversationLauncher({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
    }),
  );

const getDispatchedEntity = () => {
  expect(startConversationRunMutate).toHaveBeenCalledTimes(1);
  const [input] = startConversationRunMutate.mock.calls[0]!;
  const payload = (
    input as {
      request: { payload: { entity: Record<string, unknown> } };
    }
  ).request.payload;
  return payload.entity;
};

const getDispatchedRequest = () => {
  expect(startConversationRunMutate).toHaveBeenCalledTimes(1);
  const [input] = startConversationRunMutate.mock.calls[0]!;
  return (
    input as {
      request: Record<string, unknown>;
    }
  ).request;
};

describe("useEntityConversationLauncher — goal context forwarding", () => {
  it("dispatches a graph-only request with machine and entity context intact", async () => {
    const { result } = renderLauncher();

    let launched: boolean | undefined;
    await act(async () => {
      launched = await result.current.launch({
        prompt: "what's the status on this goal?",
        context: {
          entityId: GOAL_ID,
          entityType: TargetEntityType.Task,
          entityTitle: "Ship onboarding",
          goalSnapshot: {
            description: "Ship the onboarding experience.",
            dueDate: "2026-06-01T00:00:00.000Z",
            trackedEntities: TRACKED_ENTITIES,
          },
        },
        provider: ConversationStartRunRequestDtoProviderEnum.Codex,
        model: "model-for-test",
        reasoningEffort: "high",
        machineId: "machine-1",
        fastMode: true,
      });
    });

    expect(launched).toBe(true);
    expect(createSessionMutate).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      agentSession: expect.objectContaining({
        projectId: PROJECT_ID,
        title: "Discuss Ship onboarding",
        entityId: GOAL_ID,
        entityType: EntityType.Task,
        type: AgentSessionType.EntityConversation,
      }),
    });

    const request = getDispatchedRequest();
    expect(request).toEqual(
      expect.objectContaining({
        attachments: [],
        handlerPromptType: "entity_conversation",
        payload: {
          entity: {
            entityId: GOAL_ID,
            entityType: "TASK",
            taskType: "GOAL",
            description: "Ship the onboarding experience.",
            dueDate: "2026-06-01T00:00:00.000Z",
            trackedEntities: TRACKED_ENTITIES,
          },
          userMessage: "what's the status on this goal?",
          promptType: "entity_conversation",
        },
        model: "model-for-test",
        reasoningEffort: "high",
        provider: ConversationStartRunRequestDtoProviderEnum.Codex,
        fastMode: true,
        machineId: "machine-1",
        agentSessionId: "session-1",
        initialMessage: { role: MessageType.User },
        contextMetadata: expect.objectContaining({
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          agentSessionId: "session-1",
          userComments: [],
          fileReferences: { resolved: [], unresolved: [] },
        }),
      }),
    );
    expect(request).not.toHaveProperty("serviceIds");
    expect(request).not.toHaveProperty("launchServiceId");
    expect(navigateMock).toHaveBeenCalledWith("/conv/route");
  });

  it("forwards description with the other goal context when launching from a goal", async () => {
    const { result } = renderLauncher();

    await act(async () => {
      await result.current.launch({
        prompt: "what's the status on this goal?",
        context: {
          entityId: GOAL_ID,
          entityType: TargetEntityType.Task,
          entityTitle: "Ship onboarding",
          goalSnapshot: {
            description: "Ship the refreshed onboarding experience.",
            dueDate: "2026-06-01T00:00:00.000Z",
            trackedEntities: TRACKED_ENTITIES,
          },
        },
        provider: ConversationStartRunRequestDtoProviderEnum.Claude,
        machineId: "machine-1",
      });
    });

    const entity = getDispatchedEntity();
    expect(entity).toEqual({
      entityId: GOAL_ID,
      entityType: "TASK",
      taskType: "GOAL",
      description: "Ship the refreshed onboarding experience.",
      dueDate: "2026-06-01T00:00:00.000Z",
      trackedEntities: TRACKED_ENTITIES,
    });
  });

  it("omits the goal-only fields for a non-goal task launch", async () => {
    const { result } = renderLauncher();

    await act(async () => {
      await result.current.launch({
        prompt: "discuss this task",
        context: {
          entityId: "task-2",
          entityType: TargetEntityType.Task,
          entityTitle: "Some standard task",
        },
        provider: ConversationStartRunRequestDtoProviderEnum.Claude,
        machineId: "machine-1",
      });
    });

    const entity = getDispatchedEntity();
    expect(entity).toEqual({
      entityId: "task-2",
      entityType: "TASK",
    });
    expect(entity).not.toHaveProperty("taskType");
    expect(entity).not.toHaveProperty("description");
    expect(entity).not.toHaveProperty("dueDate");
    expect(entity).not.toHaveProperty("trackedEntities");
  });

  it("carries an arbitrary work-item subtype separately from TASK identity", async () => {
    const { result } = renderLauncher();

    await act(async () => {
      await result.current.launch({
        prompt: "discuss this custom work item",
        context: {
          entityId: "custom-work-item",
          entityType: TargetEntityType.Task,
          entityTitle: "Custom work item",
          entitySubtype: "PROJECT_DEFINED_WORK",
        },
        provider: ConversationStartRunRequestDtoProviderEnum.Claude,
        machineId: "machine-1",
      });
    });

    expect(getDispatchedEntity()).toEqual({
      entityId: "custom-work-item",
      entityType: "TASK",
      taskType: "PROJECT_DEFINED_WORK",
    });
  });

  it("does not decorate the entity block for non-task launches even if goalSnapshot is supplied", async () => {
    const { result } = renderLauncher();

    await act(async () => {
      await result.current.launch({
        prompt: "discuss this plan",
        context: {
          entityId: "plan-3",
          entityType: TargetEntityType.DesignDoc,
          entityTitle: "Q4 plan",
          // A defensive caller might pass a goalSnapshot for a non-task entity;
          // the launcher gates on TASK so the new fields stay absent.
          goalSnapshot: {
            description: "This must not reach a plan launch.",
            dueDate: "2026-06-01T00:00:00.000Z",
            trackedEntities: TRACKED_ENTITIES,
          },
        },
        provider: ConversationStartRunRequestDtoProviderEnum.Claude,
        machineId: "machine-1",
      });
    });

    const entity = getDispatchedEntity();
    expect(entity).toEqual({
      entityId: "plan-3",
      entityType: "DESIGN_DOC",
    });
  });
});
