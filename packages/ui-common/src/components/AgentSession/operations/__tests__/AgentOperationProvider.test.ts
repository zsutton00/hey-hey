import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
  MessageType,
} from "../../../../api";
import {
  machinesClient,
  unifiedApiClient,
} from "../../../../clients/serviceClients";
import { executeControllerAuthorizedAction } from "../../../../data/hooks/useControllerAuthorizedAction";
import { defaultAgentOperationDependencies } from "../AgentOperationProvider";
import { fingerprintAgentOperation } from "../agentOperationFingerprint";

vi.mock("../../../../clients/serviceClients", () => ({
  projectsClient: { cancelAgentOperationInput: vi.fn() },
  machinesClient: { listMachines: vi.fn() },
  unifiedApiClient: {
    startConversationRun: vi.fn(),
    postMessage: vi.fn(),
    getAgentOperation: vi.fn(),
  },
}));

vi.mock("../../../../data/hooks/useControllerAuthorizedAction", () => ({
  executeControllerAuthorizedAction: vi.fn(),
}));

describe("defaultAgentOperationDependencies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(machinesClient.listMachines).mockResolvedValue({
      data: {
        data: {
          machines: [
            {
              machineId: "machine-1",
              name: "Studio Mac",
              active: true,
              authorizationProtocolVersion: "V2",
            },
          ],
        },
      },
    });
    vi.mocked(executeControllerAuthorizedAction).mockImplementation(
      async (variables) => {
        const data = await variables.submit({
          authorization: { kind: "bounded_grant", grantId: "grant-1" },
        });
        return { outcome: "ADMITTED", data };
      },
    );
    vi.mocked(unifiedApiClient.postMessage).mockResolvedValue({
      data: { data: {} },
    });
    vi.mocked(unifiedApiClient.startConversationRun).mockResolvedValue({
      data: {
        data: {
          operationId: "operation-1",
          operationFingerprint: "a".repeat(64),
          operationState: "SUCCEEDED",
          dispatched: true,
          triggerMessageId: "trigger-1",
        },
      },
    });
    vi.mocked(unifiedApiClient.getAgentOperation).mockResolvedValue({
      data: {
        data: {
          operationId: "operation-1",
          fingerprint: "a".repeat(64),
          kind: "DIRECT_TRIGGER",
          state: "SUCCEEDED",
          messageId: "message-1",
          triggerMessageId: "trigger-1",
        },
      },
    });
  });

  it("binds start authorization to the Agent Session action contract", async () => {
    await defaultAgentOperationDependencies.startSession({
      operationId: "operation-1",
      fingerprint: "a".repeat(64),
      input: {
        organizationId: "organization-1",
        projectId: "project-1",
        agentSessionId: "agent-session-1",
        conversationId: "conversation-1",
        machineId: "machine-1",
        intent: {},
      },
    });

    expect(executeControllerAuthorizedAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({
          actionCategory: HostActionCategory.Conversation,
          actionType: HostAffectingActionType.ConversationTrigger,
          targetKind: HostActionTargetKind.AgentSession,
          targetId: "agent-session-1",
        }),
      }),
    );
    expect(
      vi.mocked(executeControllerAuthorizedAction).mock.calls[0][0].action,
    ).not.toHaveProperty("targetRevision");
    expect(unifiedApiClient.startConversationRun).toHaveBeenCalledWith({
      organizationId: "organization-1",
      projectId: "project-1",
      conversationId: "conversation-1",
      conversationStartRunRequestDto: expect.objectContaining({
        agentSessionId: "agent-session-1",
        operationId: "operation-1",
      }),
    });
  });

  it("fingerprints the complete semantic start request", async () => {
    const input = {
      organizationId: "organization-1",
      projectId: "project-1",
      agentSessionId: "agent-session-1",
      conversationId: "conversation-1",
      machineId: "machine-1",
      intent: {
        model: "claude-opus-4-7",
        provider: "claude" as const,
        reasoningEffort: "medium" as const,
      },
    };

    await expect(
      defaultAgentOperationDependencies.fingerprintStart(input),
    ).resolves.toBe(
      await fingerprintAgentOperation({
        kind: "START_RUN",
        organizationId: "organization-1",
        projectId: "project-1",
        conversationId: "conversation-1",
        request: {
          agentSessionId: "agent-session-1",
          machineId: "machine-1",
          model: "claude-opus-4-7",
          provider: "claude",
          reasoningEffort: "medium",
        },
      }),
    );
  });

  it("returns committed pending work for coordinator reconciliation", async () => {
    vi.mocked(unifiedApiClient.startConversationRun).mockResolvedValueOnce({
      data: {
        data: {
          operationId: "operation-1",
          operationFingerprint: "a".repeat(64),
          operationState: "DISPATCH_PENDING",
          dispatched: false,
          triggerMessageId: "trigger-1",
        },
      },
    });
    vi.mocked(unifiedApiClient.getAgentOperation).mockResolvedValueOnce({
      data: {
        data: {
          operationId: "operation-1",
          fingerprint: "a".repeat(64),
          kind: "START_RUN",
          state: "SUCCEEDED",
          messageId: "trigger-1",
          triggerMessageId: "trigger-1",
        },
      },
    });

    await expect(
      defaultAgentOperationDependencies.startSession({
        operationId: "operation-1",
        fingerprint: "a".repeat(64),
        input: {
          organizationId: "organization-1",
          projectId: "project-1",
          agentSessionId: "agent-session-1",
          conversationId: "conversation-1",
          machineId: "machine-1",
          intent: {},
        },
      }),
    ).resolves.toEqual(expect.objectContaining({ state: "dispatch_pending" }));
    expect(unifiedApiClient.getAgentOperation).not.toHaveBeenCalled();
  });

  it("maps terminal start outcomes without treating denial as success", async () => {
    vi.mocked(unifiedApiClient.startConversationRun).mockResolvedValueOnce({
      data: {
        data: {
          operationId: "operation-1",
          operationFingerprint: "a".repeat(64),
          operationState: "DENIED",
          dispatched: false,
          triggerMessageId: "trigger-1",
        },
      },
    });

    await expect(
      defaultAgentOperationDependencies.startSession({
        operationId: "operation-1",
        fingerprint: "a".repeat(64),
        input: {
          organizationId: "organization-1",
          projectId: "project-1",
          agentSessionId: "agent-session-1",
          conversationId: "conversation-1",
          machineId: "machine-1",
          intent: {},
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({ state: "denied", code: "DENIED" }),
    );
  });

  it("binds follow-up authorization to the Agent Session action contract", async () => {
    await defaultAgentOperationDependencies.submitMessage({
      operationId: "operation-1",
      fingerprint: "a".repeat(64),
      input: {
        organizationId: "organization-1",
        projectId: "project-1",
        agentSessionId: "agent-session-1",
        conversationId: "conversation-1",
        machineId: "machine-1",
        intent: {
          projectId: "project-1",
          conversationId: "conversation-1",
          parentMessageId: null,
          data: {
            promptType: "coding_freeform",
            userMessage: "continue",
          },
        },
      },
    });

    expect(executeControllerAuthorizedAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({
          actionCategory: HostActionCategory.Conversation,
          actionType: HostAffectingActionType.ConversationTrigger,
          targetKind: HostActionTargetKind.AgentSession,
          targetId: "agent-session-1",
        }),
      }),
    );
    expect(
      vi.mocked(executeControllerAuthorizedAction).mock.calls[0][0].action,
    ).not.toHaveProperty("targetRevision");
    expect(unifiedApiClient.postMessage).toHaveBeenCalledWith({
      organizationId: "organization-1",
      projectId: "project-1",
      postMessageRequest: expect.objectContaining({
        type: MessageType.User,
        agentSessionId: "agent-session-1",
        operationId: "operation-1",
      }),
    });
  });
});
