import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentSessionType,
  MessageType,
  WorkflowName,
  type AgentSessionConfigEntityConversationV1,
} from "../../../api";
import {
  useFeatureSyncConversationLauncher,
  type FeatureSyncLaunchInput,
} from "../useFeatureSyncConversationLauncher";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  conversation: vi.fn(),
  bind: vi.fn(),
  start: vi.fn(),
  navigate: vi.fn(),
  access: vi.fn(),
  entityConversationPath: vi.fn(() => "/fresh-verification"),
}));

vi.mock("../../../data/hooks/useCreateAgentSession", () => ({
  useCreateAgentSession: () => ({ mutate: mocks.create }),
}));

vi.mock("../../../data/hooks/useCreateAgentSessionConversation", () => ({
  useCreateAgentSessionConversation: () => ({ mutate: mocks.conversation }),
}));

vi.mock("../bindGraphConversationAgentSessionMachine", () => ({
  bindGraphConversationAgentSessionMachine: mocks.bind,
}));

vi.mock(
  "../../AgentSession/operations/useAgentSessionInteractionAccess",
  () => ({
    useAgentSessionInteractionAccessResolver: () => ({
      getAccess: mocks.access,
    }),
  }),
);

vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));

vi.mock("../../../contexts", () => ({
  usePathService: () => ({
    entityConversation: mocks.entityConversationPath,
  }),
}));

const featureId = "3782302e-54ad-4908-b168-0b2260a89b3c";
const parentAgentSessionId = "9d6c4a8e-2f0b-4a53-8d1e-7c3b5a1f2e40";
const impactedEntities = [
  { entityType: "MOCKUP", entityId: "5b1e2c3d-4f5a-4b6c-8d7e-9f0a1b2c3d4e" },
];
const input: FeatureSyncLaunchInput = {
  check: {
    feature: {
      entityType: "FEATURE",
      entityId: featureId,
    },
    explanation: "Delivered behavior changed.",
    impactedEntities,
  },
  parentAgentSessionId,
  provider: "claude",
  prompt: "Verify this feature with the reviewed launch text.",
  model: "claude-opus-4-7",
  reasoningEffort: "medium",
  machineId: "machine",
};

const renderLauncher = () =>
  renderHook(() =>
    useFeatureSyncConversationLauncher({
      organizationId: "org",
      projectId: "project",
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({
    id: "fresh-session",
    conversationId: "stale-conversation",
  });
  mocks.conversation.mockResolvedValue({
    conversation: { id: "fresh-conversation" },
  });
  mocks.bind.mockResolvedValue(undefined);
  mocks.start.mockResolvedValue({
    state: "succeeded",
    triggerMessageId: "trigger",
  });
  mocks.access.mockReturnValue({
    isDeviceEnabled: true,
    interactions: { startSession: mocks.start },
  });
});

describe("fresh feature verification", () => {
  it("launches the dedicated Verify Feature mode on the affected feature with the full reviewed context", async () => {
    const config: AgentSessionConfigEntityConversationV1 = {
      type: "ENTITY_CONVERSATION",
      version: "v1",
      model: "selected-model",
      effort: "high",
      projectAssistant: { enabled: false },
      disableCodexSystemPrompt: false,
      verifyFeature: {
        concern: "Delivered behavior changed.",
        parentAgentSessionId,
        impactedEntities,
      },
    };
    const { result } = renderLauncher();
    const skillSelection = {
      provider: "codex" as const,
      name: "personal",
      catalogScope: "user" as const,
    };

    await act(async () => {
      expect(
        await result.current.launch({
          ...input,
          provider: "codex",
          prompt: "Use the edited verification prompt.",
          model: config.model,
          reasoningEffort: config.effort,
          projectAssistant: config.projectAssistant,
          disableCodexSystemPrompt: config.disableCodexSystemPrompt,
          skillSelection,
          fastMode: true,
          serviceIds: ["one", "two"],
          launchServiceId: "two",
        }),
      ).toBe(true);
    });

    expect(mocks.access).toHaveBeenCalledWith("machine");
    expect(mocks.create).toHaveBeenCalledWith({
      organizationId: "org",
      agentSession: {
        projectId: "project",
        sessionDate: expect.any(String),
        title: "Verify Feature",
        type: AgentSessionType.EntityConversation,
        entityType: "TASK",
        entityId: featureId,
        provider: "codex",
        config,
        serviceIds: ["one", "two"],
        launchServiceId: "two",
      },
    });
    expect(mocks.bind).toHaveBeenCalledWith({
      organizationId: "org",
      projectId: "project",
      agentSessionId: "fresh-session",
      machineId: "machine",
    });
    expect(mocks.conversation).toHaveBeenCalledWith({
      organizationId: "org",
      projectId: "project",
      agentSessionId: "fresh-session",
      body: {
        workflowType: WorkflowName.AgentEntityConversation,
        workflowAboutType: "task",
        workflowAboutId: featureId,
      },
    });

    const request = mocks.start.mock.calls[0]![0];
    expect(request).toEqual({
      organizationId: "org",
      projectId: "project",
      agentSessionId: "fresh-session",
      conversationId: "fresh-conversation",
      intent: {
        attachments: [],
        handlerPromptType: "verify_feature",
        payload: {
          promptType: "verify_feature",
          entity: { entityType: "TASK", entityId: featureId },
          concern: "Delivered behavior changed.",
          parentAgentSessionId,
          impactedEntities,
          userMessage: "Use the edited verification prompt.",
        },
        provider: "codex",
        model: "selected-model",
        config,
        reasoningEffort: "high",
        skillSelection,
        fastMode: true,
        serviceIds: ["one", "two"],
        launchServiceId: "two",
        contextMetadata: {
          capturedAt: expect.any(String),
          organizationId: "org",
          projectId: "project",
          agentSessionId: "fresh-session",
          userComments: [],
          fileReferences: { resolved: [], unresolved: [] },
        },
        initialMessage: { role: MessageType.User },
      },
    });
    expect(mocks.create.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.bind.mock.invocationCallOrder[0]!,
    );
    expect(mocks.bind.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.conversation.mock.invocationCallOrder[0]!,
    );
    expect(mocks.conversation.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.start.mock.invocationCallOrder[0]!,
    );
    expect(mocks.entityConversationPath).toHaveBeenCalledWith({
      projectId: "project",
      agentSessionId: "fresh-session",
      conversationId: "fresh-conversation",
      entityId: featureId,
      entityType: "FEATURE",
    });
    expect(mocks.navigate).toHaveBeenCalledWith("/fresh-verification");
  });

  it("omits absent optional Service context and Project Assistant configuration", async () => {
    const { result } = renderLauncher();

    await act(async () => {
      await result.current.launch(input);
    });

    const [{ agentSession }] = mocks.create.mock.calls[0]!;
    expect(agentSession).toMatchObject({
      type: AgentSessionType.EntityConversation,
      config: {
        type: "ENTITY_CONVERSATION",
        version: "v1",
        model: "claude-opus-4-7",
        effort: "medium",
        verifyFeature: {
          concern: "Delivered behavior changed.",
          parentAgentSessionId,
          impactedEntities,
        },
      },
    });
    expect(agentSession.config).not.toHaveProperty("projectAssistant");
    expect(agentSession).not.toHaveProperty("serviceIds");
    expect(agentSession).not.toHaveProperty("launchServiceId");
    expect(mocks.start.mock.calls[0]![0].intent).not.toHaveProperty(
      "serviceIds",
    );
    expect(mocks.start.mock.calls[0]![0].intent).not.toHaveProperty(
      "launchServiceId",
    );
  });

  it.each(["failed", "cancelled"])(
    "keeps a %s first-turn launch retryable without navigation",
    async (state) => {
      mocks.start.mockResolvedValue({ state, message: "Try again" });
      const { result } = renderLauncher();

      await act(async () => {
        expect(await result.current.launch(input)).toBe(false);
      });
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeTruthy();
      expect(mocks.navigate).not.toHaveBeenCalled();

      mocks.start.mockResolvedValue({ state: "succeeded" });
      await act(async () => {
        expect(await result.current.launch(input)).toBe(true);
      });
      expect(result.current.error).toBeNull();
      expect(mocks.navigate).toHaveBeenCalledTimes(1);
    },
  );

  it("exposes pending state and prevents duplicate launches", async () => {
    let resolve!: (value: { state: string }) => void;
    mocks.start.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { result } = renderLauncher();
    let pending!: Promise<boolean>;

    await act(async () => {
      pending = result.current.launch(input);
    });
    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      expect(await result.current.launch(input)).toBe(false);
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve({ state: "succeeded" });
      await pending;
    });
    expect(result.current.isLoading).toBe(false);
  });
});
