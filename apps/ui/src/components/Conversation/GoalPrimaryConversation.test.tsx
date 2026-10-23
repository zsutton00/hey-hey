import type { AgentSessionDto, TaskResponseDto } from "@hey-hey/ui-common/api";
import { EntityType, WorkStatus } from "@hey-hey/ui-common/api";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GoalPrimaryConversation } from "./GoalPrimaryConversation";

const {
  mockEntityConversationChat,
  mockAgentSessions,
  mockMarkStale,
  mockRemoveSession,
  mockCreateNewConversation,
  mockCreateSession,
  mockBind,
  mockUpdateSession,
  mockTrackingProvider,
} = vi.hoisted(() => ({
  mockEntityConversationChat: vi.fn(() => null),
  mockAgentSessions: [
    {
      id: "agent-session-1",
      conversationId: "conversation-1",
      entityId: "goal-1",
      entityType: "TASK" as AgentSessionDto["entityType"],
    } as AgentSessionDto,
  ],
  mockCreateSession: vi.fn(),
  mockBind: vi.fn(),
  mockUpdateSession: vi.fn(),
  mockTrackingProvider: vi.fn((_context: unknown) => undefined),
  mockMarkStale: vi.fn(),
  mockRemoveSession: vi.fn(),
  mockCreateNewConversation: vi.fn(async (_draftText: string) => {}),
}));

const runtimeSelection = {
  provider: "claude" as const,
  model: "claude-opus-4-7",
  reasoningEffort: "medium" as const,
};
const machineSelection = {
  machines: [],
  machineMode: "one" as const,
  selectedMachineId: "machine-1",
  onSelectMachine: vi.fn(),
  readinessNotice: null,
};
const onRuntimeSelectionChange = vi.fn();
const goalPm = {
  conversationInventory: [
    {
      conversationId: "11111111-1111-4111-8111-111111111111",
      title: "Launch planning",
      owner: {
        entityType: EntityType.Task,
        entityId: "22222222-2222-4222-8222-222222222222",
        taskType: "GOAL" as const,
      },
      workflowName: "entity-conversation" as const,
    },
  ],
};

vi.mock("@hey-hey/ui-common/components", () => ({
  EntityConversationChat: (props: Record<string, unknown>) => {
    mockEntityConversationChat(props);
    return <>{props.actionsSlot as React.ReactNode}</>;
  },
  ChatSessionPendingPlaceholder: (props: {
    onSubmit: (text: string) => Promise<void>;
  }) => (
    <button onClick={() => void props.onSubmit("Find missing work")}>
      First message
    </button>
  ),
  RuntimeModelSelector: (props: {
    disabled?: boolean;
    onProviderChange: (provider: "codex") => void;
    onModelChange: (model: string) => void;
    onReasoningEffortChange: (effort: "high") => void;
  }) => (
    <button
      data-testid="goal-runtime-model-selector"
      disabled={props.disabled}
      onClick={() => {
        props.onProviderChange("codex");
        props.onModelChange("gpt-5.6-codex");
        props.onReasoningEffortChange("high");
      }}
    >
      Change to Codex
    </button>
  ),
  resolveEntityConversationRuntimeSelection: (
    session: AgentSessionDto,
    selection: {
      provider: "claude";
      model: string;
      reasoningEffort: "medium";
    },
  ) => ({
    ...selection,
    provider: session.provider ?? selection.provider,
    model:
      session.config && "model" in session.config
        ? session.config.model
        : selection.model,
  }),
  buildEntityConversationSessionConfig: (selection: {
    model: string;
    reasoningEffort: "medium";
  }) => ({
    type: "ENTITY_CONVERSATION",
    version: "v1",
    model: selection.model,
  }),
  bindGraphConversationAgentSessionMachine: mockBind,
  updateAgentSessionRecord: mockUpdateSession,
  isMachineExecutionReady: () => true,
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  TrackingProvider: ({
    children,
    context,
  }: {
    children: React.ReactNode;
    context: unknown;
  }) => {
    mockTrackingProvider(context);
    return children;
  },
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useAgentSessions: () => ({
    agentSessions: mockAgentSessions,
    isFetched: true,
    markStale: mockMarkStale,
    remove: mockRemoveSession,
  }),
  useCreateAgentSession: () => ({ mutate: mockCreateSession }),
}));

const goalTask = {
  id: "goal-1",
  name: "Goal",
  status: WorkStatus.Active,
  sections: [
    {
      key: "description",
      materializedMarkdown: "Coordinate the launch across teams.",
      order: 0,
    },
  ],
  dueDate: "2026-08-31",
  trackedEntities: [],
} as unknown as TaskResponseDto;

describe("GoalPrimaryConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentSessions.splice(0, mockAgentSessions.length, {
      id: "agent-session-1",
      conversationId: "conversation-1",
      entityId: "goal-1",
      entityType: EntityType.Task,
    } as AgentSessionDto);
  });

  it("creates no records until first submit and passes the first message once", async () => {
    mockAgentSessions.splice(0);
    mockCreateSession.mockResolvedValue({
      id: "created",
      conversationId: null,
    });
    mockBind.mockResolvedValue({
      id: "created",
      conversationId: null,
      machineId: "machine-1",
    });
    render(
      <GoalPrimaryConversation
        organizationId="org-1"
        projectId="project-1"
        goalId="goal-1"
        goalTask={goalTask}
        runtimeSelection={runtimeSelection}
        onRuntimeSelectionChange={onRuntimeSelectionChange}
        machineSelection={machineSelection}
        goalPm={goalPm}
      />,
    );
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockBind).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByText("First message"));
    });
    await waitFor(() =>
      expect(mockEntityConversationChat).toHaveBeenCalledWith(
        expect.objectContaining({
          initialUserMessage: "Find missing work",
          goalPm,
        }),
      ),
    );
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    expect(mockBind).toHaveBeenCalledTimes(1);
    expect(
      mockEntityConversationChat.mock.calls.at(-1)?.[0],
    ).not.toHaveProperty("onCreateNewConversation");
  });

  it("declares the embedded conversation as the owned scroll surface", () => {
    render(
      <GoalPrimaryConversation
        organizationId="org-1"
        projectId="project-1"
        goalId="goal-1"
        goalTask={goalTask}
        selectedAgentSessionId="agent-session-1"
        runtimeSelection={runtimeSelection}
        onRuntimeSelectionChange={onRuntimeSelectionChange}
        machineSelection={machineSelection}
      />,
    );

    expect(mockEntityConversationChat).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "goal-1",
        entityType: "task",
        scrollable: true,
        entitySummary: "Coordinate the launch across teams.",
        goalSnapshot: {
          description: "Coordinate the launch across teams.",
          dueDate: "2026-08-31",
          trackedEntities: [],
        },
      }),
    );
    expect(mockTrackingProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        page: {
          name: "goal-conversation",
          path: "/projects/project-1/tasks/goal-1",
          section: "conversation",
        },
      }),
    );
  });

  it("selects the newly created session and carries its draft into the composer", () => {
    render(
      <GoalPrimaryConversation
        organizationId="org-1"
        projectId="project-1"
        goalId="goal-1"
        goalTask={goalTask}
        selectedAgentSessionId="agent-session-1"
        runtimeSelection={runtimeSelection}
        onRuntimeSelectionChange={onRuntimeSelectionChange}
        machineSelection={machineSelection}
        initialDraft="carry this draft forward"
      />,
    );

    expect(mockEntityConversationChat).toHaveBeenCalledWith(
      expect.objectContaining({
        initialDraft: "carry this draft forward",
      }),
    );
  });

  it("does not fall back to the previous session while the selected session refreshes", () => {
    render(
      <GoalPrimaryConversation
        organizationId="org-1"
        projectId="project-1"
        goalId="goal-1"
        goalTask={goalTask}
        runtimeSelection={runtimeSelection}
        onRuntimeSelectionChange={onRuntimeSelectionChange}
        machineSelection={machineSelection}
        selectedAgentSessionId="new-agent-session"
      />,
    );

    expect(mockEntityConversationChat).not.toHaveBeenCalled();
  });

  it("accumulates coordinated provider changes before the parent rerenders", () => {
    render(
      <GoalPrimaryConversation
        organizationId="org-1"
        projectId="project-1"
        goalId="goal-1"
        goalTask={goalTask}
        runtimeSelection={runtimeSelection}
        onRuntimeSelectionChange={onRuntimeSelectionChange}
        machineSelection={machineSelection}
      />,
    );

    fireEvent.click(screen.getByTestId("goal-runtime-model-selector"));

    expect(onRuntimeSelectionChange).toHaveBeenLastCalledWith({
      provider: "codex",
      model: "gpt-5.6-codex",
      reasoningEffort: "high",
    });
  });

  it("keeps a reopened model fixed when remembered setup changes and only persists the machine", async () => {
    mockAgentSessions[0] = {
      ...mockAgentSessions[0],
      provider: "codex",
      config: {
        type: "ENTITY_CONVERSATION",
        version: "v1",
        model: "saved-model",
      },
    } as AgentSessionDto;
    mockUpdateSession.mockResolvedValue({
      ok: true,
      session: mockAgentSessions[0],
    });
    const props = {
      organizationId: "org-1",
      projectId: "project-1",
      goalId: "goal-1",
      goalTask,
      selectedAgentSessionId: "agent-session-1",
      runtimeSelection,
      onRuntimeSelectionChange,
      machineSelection,
    };
    const { rerender } = render(<GoalPrimaryConversation {...props} />);
    rerender(
      <GoalPrimaryConversation
        {...props}
        runtimeSelection={{ ...runtimeSelection, model: "different-model" }}
      />,
    );

    expect(
      screen.queryByTestId("goal-runtime-model-selector"),
    ).not.toBeInTheDocument();
    const chat = mockEntityConversationChat.mock.calls.at(
      -1,
    )?.[0] as unknown as {
      runtimeSelection: { provider: string; model: string };
      onBeforeLocalExecution: () => Promise<void>;
      actionsSlot?: unknown;
    };
    expect(chat.runtimeSelection).toMatchObject({
      provider: "codex",
      model: "saved-model",
    });
    expect(chat.actionsSlot).toBeUndefined();
    await chat.onBeforeLocalExecution();
    expect(mockUpdateSession).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionId: "agent-session-1",
      machineId: "machine-1",
    });
  });

  it("does not unlock model selection when an existing session needs a machine", () => {
    render(
      <GoalPrimaryConversation
        organizationId="org-1"
        projectId="project-1"
        goalId="goal-1"
        goalTask={goalTask}
        selectedAgentSessionId="agent-session-1"
        runtimeSelection={runtimeSelection}
        onRuntimeSelectionChange={onRuntimeSelectionChange}
        machineSelection={{ ...machineSelection, selectedMachineId: null }}
      />,
    );
    expect(screen.getByTestId("goal-runtime-model-selector")).toBeDisabled();
  });
});
