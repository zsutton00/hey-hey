import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCapabilityCatalogForTests } from "../capabilityCatalog";
import {
  AgentSessionStatus,
  AgentSessionType,
  EntityType,
  type AgentSessionDto,
} from "../../../api";

const useAgentSessionsMock = vi.fn();
const createSessionMock = vi.fn();
const bindMachineMock = vi.fn();
const updateAgentSessionRecordMock = vi.fn();
const setSelectedMachineIdMock = vi.fn();
let submitFirstMessage: ((message: string) => Promise<void>) | undefined;
let renderedEntityChatProps: Record<string, unknown> | undefined;
let renderedModelSelectorProps: Record<string, unknown> | undefined;
let selectedMachineId: string | null = "machine-1";

vi.mock("../../../data/hooks/useAgentSessions", () => ({
  useAgentSessions: (...args: unknown[]) => useAgentSessionsMock(...args),
}));

vi.mock("../../../data/hooks/useCreateAgentSession", () => ({
  useCreateAgentSession: () => ({ mutate: createSessionMock }),
}));

vi.mock(
  "../../InteractionComponent/bindGraphConversationAgentSessionMachine",
  () => ({
    bindGraphConversationAgentSessionMachine: (...args: unknown[]) =>
      bindMachineMock(...args),
  }),
);

vi.mock("../runtime/coding/update-agent-session-record", () => ({
  updateAgentSessionRecord: (...args: unknown[]) =>
    updateAgentSessionRecordMock(...args),
}));

vi.mock("../runtime/coding/useMachineResolution", () => ({
  useMachineResolution: () => ({
    machines: [{ machineId: "machine-1", name: "Local machine" }],
    executionReadyMachines: [{ machineId: "machine-1", name: "Local machine" }],
    isReady: true,
    mode: "one",
    selectedMachine:
      selectedMachineId === null
        ? null
        : { machineId: selectedMachineId, name: "Local machine" },
    setSelectedMachineId: setSelectedMachineIdMock,
  }),
}));

vi.mock("../RuntimeModelSelector", () => ({
  RuntimeModelSelector: (props: Record<string, unknown>) => {
    renderedModelSelectorProps = props;
    return <div data-testid="runtime-model-selector" />;
  },
}));

vi.mock("../agentBridgeRecoveryState", () => ({
  resolveAgentBridgeRecoveryState: () => ({ type: "ready" }),
}));

vi.mock("../ChatSessionPendingPlaceholder", () => ({
  ChatSessionPendingPlaceholder: ({
    onSubmit,
  }: {
    onSubmit: (message: string) => Promise<void>;
  }) => {
    submitFirstMessage = onSubmit;
    return <div data-testid="pending-refiner" />;
  },
}));

vi.mock("../EntityConversationChat", () => ({
  EntityConversationChat: (props: Record<string, unknown>) => {
    renderedEntityChatProps = props;
    return <div data-testid="entity-conversation-chat-mock" />;
  },
}));

vi.mock("../LoadingPanel", () => ({
  LoadingPanel: () => <div data-testid="loading-refiner" />,
}));

import { RefinerChat } from "../RefinerChat";

const session = (conversationId: string | null = null): AgentSessionDto => ({
  id: "session-1",
  organizationId: "org-1",
  projectId: "project-1",
  userId: "user-1",
  type: AgentSessionType.EntityConversation,
  status: AgentSessionStatus.Pending,
  sessionDate: "2026-09-03T00:00:00.000Z",
  conversationId,
  entityType: EntityType.Task,
  entityId: "task-1",
  createdAt: "2026-09-03T00:00:00.000Z",
  updatedAt: "2026-09-03T00:00:00.000Z",
});

const renderRefiner = () =>
  render(
    <RefinerChat
      organizationId="org-1"
      projectId="project-1"
      entityType={EntityType.Task}
      entityId="task-1"
      entityName="Draft the launch"
      entitySummary="Ship the new workflow"
    />,
  );

describe("RefinerChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    submitFirstMessage = undefined;
    renderedEntityChatProps = undefined;
    renderedModelSelectorProps = undefined;
    selectedMachineId = "machine-1";
    bindMachineMock.mockImplementation(async () => ({
      ...session(),
      machineId: "machine-1",
    }));
    updateAgentSessionRecordMock.mockResolvedValue({
      ok: true,
      session: { ...session(), machineId: "machine-1" },
    });
    useAgentSessionsMock.mockReturnValue({
      agentSessions: [],
      isFetched: true,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("looks up only the entity-scoped Entity Conversation and does not create on mount", () => {
    renderRefiner();

    expect(useAgentSessionsMock).toHaveBeenCalledWith("org-1", "project-1", {
      entityType: EntityType.Task,
      entityId: "task-1",
      type: AgentSessionType.EntityConversation,
      enabled: true,
    });
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("pending-refiner")).toBeInTheDocument();
    expect(screen.getByTestId("runtime-model-selector")).toBeInTheDocument();
    expect(screen.getByTestId("editor-refiner-runtime-controls")).toHaveStyle({
      minWidth: "0",
      width: "100%",
      maxWidth: "100%",
      overflow: "hidden",
    });
    expect(
      screen
        .getByTestId("pending-refiner")
        .compareDocumentPosition(
          screen.getByTestId("editor-refiner-runtime-controls"),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(renderedModelSelectorProps?.machineSelection).toEqual(
      expect.objectContaining({ selectedMachineId: "machine-1" }),
    );
  });

  it("deduplicates concurrent first submits and retains the first message", async () => {
    let resolveCreation: ((value: AgentSessionDto) => void) | undefined;
    createSessionMock.mockReturnValue(
      new Promise<AgentSessionDto>((resolve) => {
        resolveCreation = resolve;
      }),
    );
    renderRefiner();

    let firstPromise: Promise<void> | undefined;
    let repeatedPromise: Promise<void> | undefined;
    act(() => {
      firstPromise = submitFirstMessage?.("first retained message");
      repeatedPromise = submitFirstMessage?.("second ignored message");
    });

    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(createSessionMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      agentSession: expect.objectContaining({
        projectId: "project-1",
        type: AgentSessionType.EntityConversation,
        entityType: EntityType.Task,
        entityId: "task-1",
        provider: expect.any(String),
        config: expect.any(Object),
      }),
    });

    await act(async () => {
      resolveCreation?.(session());
      await Promise.all([firstPromise, repeatedPromise]);
    });

    expect(
      await screen.findByTestId("entity-conversation-chat-mock"),
    ).toBeInTheDocument();
    expect(renderedEntityChatProps?.initialUserMessage).toBe(
      "first retained message",
    );
    expect(bindMachineMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionId: "session-1",
      machineId: "machine-1",
    });
  });

  it("requires an execution-ready machine before creating the session", async () => {
    selectedMachineId = null;
    renderRefiner();

    await expect(submitFirstMessage?.("start this")).rejects.toThrow(
      "Select an execution-ready machine to continue.",
    );
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("addresses the picked machine's CLI and holds no selection before its catalog loads", async () => {
    resetCapabilityCatalogForTests();
    renderRefiner();

    expect(renderedModelSelectorProps).toEqual(
      expect.objectContaining({
        catalogSource: {
          organizationId: "org-1",
          projectId: "project-1",
          machineId: "machine-1",
        },
        provider: null,
        model: null,
        reasoningEffort: null,
      }),
    );
    await expect(submitFirstMessage?.("start this")).rejects.toThrow(
      "Wait for the machine's model choices to load.",
    );
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("addresses no CLI while no machine is picked", () => {
    selectedMachineId = null;
    renderRefiner();

    expect(renderedModelSelectorProps?.catalogSource).toBeNull();
  });

  it("leaves a failed first message retryable", async () => {
    createSessionMock
      .mockRejectedValueOnce(new Error("creation failed"))
      .mockResolvedValueOnce(session());
    renderRefiner();

    await act(async () => {
      await expect(submitFirstMessage?.("retry me")).rejects.toThrow(
        "creation failed",
      );
    });
    expect(screen.getByTestId("pending-refiner")).toBeInTheDocument();

    await act(async () => {
      await submitFirstMessage?.("retry me");
    });

    expect(createSessionMock).toHaveBeenCalledTimes(2);
    expect(renderedEntityChatProps?.initialUserMessage).toBe("retry me");
  });

  it("resumes an existing session without creating another one", async () => {
    useAgentSessionsMock.mockReturnValue({
      agentSessions: [session("conversation-1")],
      isFetched: true,
      error: null,
      refetch: vi.fn(),
    });
    renderRefiner();

    await waitFor(() =>
      expect(
        screen.getByTestId("entity-conversation-chat-mock"),
      ).toBeInTheDocument(),
    );
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(renderedEntityChatProps?.initialUserMessage).toBeUndefined();
    expect(renderedEntityChatProps).toEqual(
      expect.objectContaining({
        machineId: "machine-1",
        runtimeSelection: expect.any(Object),
        onBeforeLocalExecution: expect.any(Function),
        actionsSlot: expect.any(Object),
      }),
    );

    await (
      renderedEntityChatProps?.onBeforeLocalExecution as () => Promise<void>
    )();
    expect(updateAgentSessionRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSessionId: "session-1",
        machineId: "machine-1",
        provider: expect.any(String),
        config: expect.any(Object),
      }),
    );
  });
});
