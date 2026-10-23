import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepositoryGroundingSubmission } from "../../../components/LlmForms/Registry/repositoryGroundingUtils";
import { RepositoryGroundingNextAction } from "../../../components/LlmForms/Registry/repositoryGroundingUtils";
import { useRepositoryGroundingAnalysisLaunch } from "../useRepositoryGroundingAnalysisLaunch";

const mocks = vi.hoisted(() => ({
  createAgentSession: vi.fn(),
  bindMachine: vi.fn(),
  createConversation: vi.fn(),
  getWorkflowConversations: vi.fn(),
  getAccess: vi.fn(),
  startSession: vi.fn(),
  submitWorkflowAnswer: vi.fn(),
}));

vi.mock("../useCreateAgentSession", () => ({
  useCreateAgentSession: () => ({ mutate: mocks.createAgentSession }),
}));
vi.mock("../useCreateAgentSessionConversation", () => ({
  useCreateAgentSessionConversation: () => ({
    mutate: mocks.createConversation,
  }),
}));
vi.mock(
  "../../../components/InteractionComponent/bindGraphConversationAgentSessionMachine",
  () => ({ bindGraphConversationAgentSessionMachine: mocks.bindMachine })
);
vi.mock(
  "../../../components/AgentSession/operations/useAgentSessionInteractionAccess",
  () => ({
    useAgentSessionInteractionAccessResolver: () => ({
      getAccess: mocks.getAccess,
    }),
  })
);
vi.mock("../../../clients/serviceClients", () => ({
  conversationsClient: {
    getWorkflowConversations: mocks.getWorkflowConversations,
  },
}));
vi.mock("../submitControllerAuthorizedWorkflowAnswer", () => ({
  submitControllerAuthorizedWorkflowAnswer: mocks.submitWorkflowAnswer,
}));

const submission = {
  entryMode: "existing",
  serviceId: "service-1",
  brief: "Analyze the selected service.",
  machineId: "machine-1",
  scope: "focused",
  focus: "Authorization boundaries",
  provider: "codex",
  model: "gpt-5.6-codex",
  reasoningEffort: "high",
  fastMode: false,
  bounds: {
    maxFiles: 100,
    maxTotalBytes: 1_000_000,
    maxFileBytes: 100_000,
    maxDepth: 8,
    maxGeneratedFiles: 20,
    maxIgnoredFiles: 20,
    maxUnsupportedFiles: 20,
    maxBinaryFiles: 20,
  },
  nextAction: RepositoryGroundingNextAction.StartAnalysis,
} satisfies RepositoryGroundingSubmission;

const launchInput = {
  organizationId: "org-1",
  projectId: "project-1",
  conversationId: "conversation-1",
  workflowId: "workflow-1",
  nodeId: "repository_grounding_configuration",
  parentMessageId: "parent-message-1",
  submission,
};

describe("useRepositoryGroundingAnalysisLaunch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAgentSession.mockResolvedValue({
      id: "session-1",
      conversationId: "conversation-1",
    });
    mocks.bindMachine.mockResolvedValue({
      id: "session-1",
      conversationId: "conversation-1",
      machineId: "machine-1",
    });
    mocks.createConversation.mockResolvedValue({
      agentSession: {
        id: "session-1",
        conversationId: "conversation-1",
      },
      conversation: {
        id: "conversation-1",
        workflowId: "workflow-1",
        workflowName: "repository-import",
        workflowAboutType: "project",
        workflowAboutId: "project-1",
      },
    });
    mocks.getWorkflowConversations.mockResolvedValue({
      data: {
        data: {
          data: [
            {
              id: "conversation-1",
              workflowId: "workflow-1",
              workflowName: "repository-import",
            },
          ],
        },
      },
    });
    mocks.getAccess.mockReturnValue({
      isDeviceEnabled: true,
      unavailable: null,
      interactions: { startSession: mocks.startSession },
    });
    mocks.startSession.mockResolvedValue({
      state: "succeeded",
      triggerMessageId: "trigger-1",
    });
    mocks.submitWorkflowAnswer.mockResolvedValue(undefined);
  });

  it("materializes readiness before submitting the repository import answer", async () => {
    const { result } = renderHook(() => useRepositoryGroundingAnalysisLaunch());

    await act(async () => {
      await result.current.launchRepositoryGroundingAnalysis(launchInput);
    });

    expect(mocks.createAgentSession).toHaveBeenCalledWith({
      organizationId: "org-1",
      agentSession: expect.objectContaining({
        projectId: "project-1",
        type: "CODING",
        serviceIds: ["service-1"],
        launchServiceId: "service-1",
        provider: "codex",
        existingWorkflowBinding: {
          conversationId: "conversation-1",
          workflowId: "workflow-1",
        },
        config: {
          type: "CODING_SESSION",
          version: "v2",
          model: "gpt-5.6-codex",
          effort: "high",
          fastMode: false,
        },
      }),
    });
    expect(mocks.bindMachine).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionId: "session-1",
      machineId: "machine-1",
    });
    expect(mocks.createConversation).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionId: "session-1",
      body: {
        workflowType: "repository-import",
        workflowAboutType: "project",
        workflowAboutId: "project-1",
      },
    });
    expect(mocks.getWorkflowConversations).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      workflowName: "project",
      workflowAboutId: "project-1",
      workflowName2: "repository-import",
    });
    expect(mocks.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        agentSessionId: "session-1",
        conversationId: "conversation-1",
        intent: expect.objectContaining({
          workflowName: "repository-import",
          serviceIds: ["service-1"],
          launchServiceId: "service-1",
          model: "gpt-5.6-codex",
          provider: "codex",
          reasoningEffort: "high",
        }),
      })
    );
    expect(mocks.submitWorkflowAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSessionId: "session-1",
        conversationId: "conversation-1",
        workflowName: "repository-import",
        action: "START_ANALYSIS",
      })
    );
    expect(mocks.startSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.submitWorkflowAnswer.mock.invocationCallOrder[0]!
    );
  });

  it.each([
    {
      state: "failed",
      code: "OFFLINE",
      message: "The selected machine is offline.",
    },
    {
      state: "denied",
      code: "DENIED",
      message: "Controller authorization was denied.",
    },
  ])("does not advance after $state readiness", async (readiness) => {
    mocks.startSession.mockResolvedValue(readiness);
    const { result } = renderHook(() => useRepositoryGroundingAnalysisLaunch());

    await expect(
      result.current.launchRepositoryGroundingAnalysis(launchInput)
    ).rejects.toThrow(readiness.message);
    expect(mocks.submitWorkflowAnswer).not.toHaveBeenCalled();
  });

  it("joins duplicate clicks onto one immutable launch", async () => {
    let resolveStart:
      | ((value: { state: "succeeded"; triggerMessageId: string }) => void)
      | undefined;
    mocks.startSession.mockReturnValue(
      new Promise((resolve) => {
        resolveStart = resolve;
      })
    );
    const { result } = renderHook(() => useRepositoryGroundingAnalysisLaunch());

    let first: Promise<unknown>;
    let second: Promise<unknown>;
    await act(async () => {
      first = result.current.launchRepositoryGroundingAnalysis(launchInput);
      second = result.current.launchRepositoryGroundingAnalysis(launchInput);
      await vi.waitFor(() =>
        expect(mocks.startSession).toHaveBeenCalledTimes(1)
      );
      resolveStart?.({ state: "succeeded", triggerMessageId: "trigger-1" });
      await Promise.all([first, second]);
    });

    expect(mocks.createAgentSession).toHaveBeenCalledTimes(1);
    expect(mocks.submitWorkflowAnswer).toHaveBeenCalledTimes(1);
  });
});
