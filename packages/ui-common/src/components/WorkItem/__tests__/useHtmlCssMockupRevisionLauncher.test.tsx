import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHtmlCssMockupRevisionLauncher } from "../useHtmlCssMockupRevisionLauncher";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  conversation: vi.fn(),
  bind: vi.fn(),
  start: vi.fn(),
  navigate: vi.fn(),
  access: vi.fn(),
  path: vi.fn(() => "/revision-conversation"),
}));

vi.mock("../../../data/hooks/useCreateAgentSession", () => ({
  useCreateAgentSession: () => ({ mutate: mocks.create }),
}));

vi.mock("../../../data/hooks/useCreateAgentSessionConversation", () => ({
  useCreateAgentSessionConversation: () => ({ mutate: mocks.conversation }),
}));

vi.mock(
  "../../InteractionComponent/bindGraphConversationAgentSessionMachine",
  () => ({
    bindGraphConversationAgentSessionMachine: mocks.bind,
  })
);

vi.mock(
  "../../AgentSession/operations/useAgentSessionInteractionAccess",
  () => ({
    useAgentSessionInteractionAccessResolver: () => ({
      getAccess: mocks.access,
    }),
  })
);

vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));

vi.mock("../../../contexts", () => ({
  usePathService: () => ({ entityConversation: mocks.path }),
}));

const payload = {
  promptType: "html_css_mockup_revision" as const,
  entity: { entityType: "TASK" as const, entityId: "task-1" },
  payloadVersion: 1 as const,
  section: {
    key: "visual",
    html: '<main data-hh-id="hero">Hello</main>',
    css: "main {}",
    sizeKey: "desktop",
    renderedSize: { width: 1200, height: 800 },
    materializedProposalId: "proposal-1",
  },
  annotations: [
    {
      id: "annotation-1",
      note: "Increase contrast",
      category: "issue" as const,
      lifecycle: "open" as const,
      authoredProposalId: "proposal-1",
      authoredSizeKey: "desktop",
      target: {
        type: "position" as const,
        x: 0.5,
        y: 0.25,
        sizeKey: "desktop",
      },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ id: "session-1" });
  mocks.conversation.mockResolvedValue({
    conversation: { id: "conversation-1" },
  });
  mocks.bind.mockResolvedValue(undefined);
  mocks.start.mockResolvedValue({ state: "succeeded" });
  mocks.access.mockReturnValue({
    isDeviceEnabled: true,
    interactions: { startSession: mocks.start },
  });
});

describe("useHtmlCssMockupRevisionLauncher", () => {
  it("launches the dedicated prompt with the generated snapshot payload", async () => {
    const { result } = renderHook(() =>
      useHtmlCssMockupRevisionLauncher({
        organizationId: "org-1",
        projectId: "project-1",
      })
    );

    await act(async () => {
      expect(
        await result.current.launch({
          taskId: "task-1",
          taskTitle: "Mockup task",
          payload,
          provider: "codex",
          model: "gpt-5",
          reasoningEffort: "high",
          machineId: "machine-1",
          serviceId: "service-1",
        })
      ).toBe(true);
    });

    expect(mocks.bind).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionId: "session-1",
      machineId: "machine-1",
    });
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSessionId: "session-1",
        conversationId: "conversation-1",
        intent: expect.objectContaining({
          handlerPromptType: "html_css_mockup_revision",
          payload,
          serviceIds: ["service-1"],
          launchServiceId: "service-1",
        }),
      })
    );
    expect(mocks.navigate).toHaveBeenCalledWith("/revision-conversation");
  });

  it("fails closed when the selected machine is unavailable", async () => {
    mocks.access.mockReturnValue({
      isDeviceEnabled: false,
      unavailable: { message: "Machine unavailable" },
    });
    const { result } = renderHook(() =>
      useHtmlCssMockupRevisionLauncher({
        organizationId: "org-1",
        projectId: "project-1",
      })
    );

    await act(async () => {
      expect(
        await result.current.launch({
          taskId: "task-1",
          taskTitle: "Mockup task",
          payload,
          provider: "codex",
          model: "gpt-5",
          reasoningEffort: null,
          machineId: "machine-1",
        })
      ).toBe(false);
    });

    expect(result.current.error).toBe("Machine unavailable");
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
