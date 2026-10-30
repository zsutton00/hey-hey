import {
  conversationFixture,
  fixtureMessages,
  flattenFixtureMessages,
} from "../../../test/conversationFixtures";
import { messageKeys } from "../../../data/collections/messages";
import { resetConversationMessageHistoryStateForTests } from "../../../data/collections/conversationMessageHistoryState";
const canonicalMessageRead = vi.hoisted(() => vi.fn());
const queuedInputsRead = vi.hoisted(() =>
  vi.fn(async () => ({ data: { data: [] } })),
);
const approveProposal = vi.hoisted(() => vi.fn());
const liveToolCalls = vi.hoisted(() => ({
  current: {
    status: "idle",
  } as import("../../AgentSession/runtime/hooks/useLatestTurnToolCalls").LatestTurnToolCallsState,
}));
vi.mock("../../AgentSession/runtime/hooks/useLatestTurnToolCalls", () => ({
  useLatestTurnToolCalls: () => liveToolCalls.current,
}));
const readDesignDoc = vi.hoisted(() => vi.fn());
const routedCreation = {
  config: {
    type: "ENTITY_CONVERSATION" as const,
    version: "v1" as const,
    model: "model-1",
  },
  provider: "claude" as const,
  machineId: "machine-1",
};
vi.mock("../../LlmForms/Registry/GoalPmNewConversationAction", () => ({
  GoalPmNewConversationAction: ({
    disabled,
    label,
    optionId,
    onStart,
  }: {
    disabled: boolean;
    label: string;
    optionId: string;
    onStart: (creation: unknown) => void;
  }) => (
    <button
      data-testid="goal-pm-record-choice"
      data-option-id={optionId}
      disabled={disabled}
      onClick={() => onStart(routedCreation)}
    >
      {label}
    </button>
  ),
}));
vi.mock("../../../clients/serviceClients", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../clients/serviceClients")>();
  return {
    ...original,
    proposalsClient: {
      ...original.proposalsClient,
      updateProposal: approveProposal,
      getProposalReconciliation: vi.fn(async () => ({
        data: {
          data: {
            status: "CURRENT",
            currentBases: [],
            revisions: [],
            conflictingPaths: [],
            interveningProposals: [],
            overlaps: [],
          },
        },
      })),
    },
    unifiedApiClient: {
      ...original.unifiedApiClient,
      getDesignDoc: readDesignDoc,
    },
    platformClient: {
      ...original.platformClient,
      getMessages: canonicalMessageRead,
    },
    projectsClient: {
      ...original.projectsClient,
      getQueuedConversationInputs: queuedInputsRead,
    },
  };
});
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { I18nextProvider } from "react-i18next";
import i18n from "../../../i18n";
import { ConversationViewer } from "../ConversationViewer";
import {
  TriageApplicationCoordinator,
  type TriageApplicationPorts,
} from "../../../data/triage/application";
import { EntityType } from "../../../api";
import type {
  ConversationResponseDto,
  ProjectResponseDto,
  MessageResponseDto,
  CreateUserMessage,
  ReportDto,
  ProposalResponseDto,
} from "../../../api";
import type {
  VersionedConversationResponseDto,
  VersionConflictError,
} from "../../../types/conversation";
import {
  AgentSessionCurrentState,
  ExtendedUIFieldType,
  MessageType,
  MessageStatus,
  ReportAudience,
  ReportType,
} from "../../../api";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type LexicalEditor,
} from "lexical";
import { __resetForTests as resetProposalCache } from "../../ProposalDispatchers/proposalSelectedStateCache";
// Mock the API client
const mockPostMessage = vi.hoisted(() => vi.fn());
vi.mock("../../../clients", () => ({
  apiClient: {
    postMessage: mockPostMessage,
  },
}));
// Mock hooks
vi.mock("../../../hooks/useUserIdentity", () => ({
  useUserIdentity: () => ({ userId: "user-123" }),
}));
vi.mock("../../../hooks/useWorkflowStatus", () => ({
  useWorkflowStatus: () => ({ status: "open", canSubmit: true }),
}));
// Mock WebSocket hook
vi.mock("../useConversationWebSocket", () => ({
  useConversationWebSocket: vi.fn(() => ({
    isConnected: true,
    isAuthenticated: true,
    connectionError: null,
    disconnect: vi.fn(),
    resetVersionTracking: vi.fn(),
    getCurrentVersion: vi.fn(),
    setCurrentVersion: vi.fn(),
  })),
}));
// Mock retry hook
const mockRetryWithBackoff = vi.hoisted(() => vi.fn());
vi.mock("../../../hooks/useRetryWithBackoff", () => ({
  useRetryWithBackoff: vi.fn(() => ({
    retryWithBackoff: mockRetryWithBackoff,
  })),
}));
const mockTrackUI = vi.hoisted(() => vi.fn());
vi.mock("../../../contexts/TrackingContext", () => ({
  useFormTracking: () => ({
    trackFormStart: vi.fn(),
    trackSubmitSuccess: vi.fn(),
  }),
  useUserAction: () => ({
    trackUI: mockTrackUI,
  }),
}));
/**
 * One QueryClient per test, shared by every wrapper the test creates, so
 * messages seeded by `withCanonicalMessages` are what the viewer reads.
 */
let testQueryClient: QueryClient;
beforeEach(() => {
  // Transient-failure retries still run (the Data Layer policy owns them),
  // without real backoff delays.
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
});
afterEach(() => {
  testQueryClient.clear();
});
// Test wrapper component
const createTestWrapper = () => {
  const queryClient = testQueryClient;
  const theme = createTheme();
  (theme.palette as Record<string, unknown>).attention = {
    main: "#1976d2",
    light: "#63a4ff",
    dark: "#004ba0",
    contrastText: "#ffffff",
  };
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};
describe("ConversationViewer width containment", () => {
  it("passes triage ownership through the production conversation/form/registry path without submitting a form answer", async () => {
    const project = {
      id: "triage-project",
      organizationId: "triage-org",
      name: "Triage",
    } as ProjectResponseDto;
    const item = {
      entityType: EntityType.Task,
      entityId: "task",
      title: "Delivered work",
    };
    const payload = {
      summary: "Clean up delivered work.",
      suggestions: [
        {
          suggestionId: "remove",
          kind: "removeOpenItems" as const,
          items: [item],
          rationale: "Already delivered",
          evidence: [
            { kind: "attention" as const, summary: "Not viewed this week" },
          ],
        },
      ],
    };
    const source: MessageResponseDto = {
      id: "triage-reply",
      projectId: project.id,
      conversationId: "triage-conversation",
      type: MessageType.System,
      status: MessageStatus.Open,
      createdAt: "2026-10-13T00:00:00Z",
      awaitingResponse: false,
      responses: [],
      data: {
        type: "QUESTIONS",
        response: "Suggestions",
        uiElements: [{ id: "triage", type: "open_items_triage", payload }],
      },
    };
    const metadata = {
      id: source.conversationId,
      organizationId: project.organizationId,
      projectId: project.id,
      createdAt: source.createdAt,
      updatedAt: source.createdAt,
    } as ConversationResponseDto;
    const remove = vi.fn().mockResolvedValue(undefined);
    const ports: TriageApplicationPorts = {
      refresh: vi.fn().mockResolvedValue(undefined),
      target: () => ({ open: true, groupId: null, pinned: false }),
      groupExists: () => false,
      remove,
      reopen: vi.fn(),
      createGroup: vi.fn(),
      group: vi.fn(),
      createGoal: vi.fn(),
      track: vi.fn(),
      promote: vi.fn(),
      revalidateGoals: vi.fn().mockResolvedValue(undefined),
    };
    const application = new TriageApplicationCoordinator(ports);
    render(
      <ConversationViewer
        conversation={withCanonicalMessages(
          conversationFixture(metadata, [source]),
        )}
        project={project}
        triageApplication={application}
        triageItemHref={() => "/tasks/task"}
        timelineAnimationMode="none"
      />,
      { wrapper: createTestWrapper() },
    );
    expect(
      await screen.findByTestId("open-items-triage-field"),
    ).toHaveTextContent(payload.summary);
    expect(remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("triage-apply"));
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith(item, expect.any(String)),
    );
    await waitFor(() =>
      expect(screen.getByTestId("triage-outcome")).toHaveTextContent("Applied"),
    );
    expect(mockPostMessage).not.toHaveBeenCalled();
  });
  it("passes a live Goal PM choice through the real viewer and restores its immutable linked answer", async () => {
    const project = {
      id: "routing-project",
      name: "Routing",
      organizationId: "routing-org",
      createdAt: "2026-09-27T00:00:00Z",
      updatedAt: "2026-09-27T00:00:00Z",
    } as ProjectResponseDto;
    const option = {
      kind: "startNewConversation" as const,
      optionId: "new",
      title: "Launch",
      rationale: "A new topic",
      requiresConfirmation: true as const,
    };
    const answer = {
      type: "GOAL_PM_ROUTING" as const,
      state: "COMPLETED" as const,
      selectedOption: option,
      operationId: "routing-operation",
      requestedAt: "2026-09-27T00:00:00Z",
      pendingRequest: "Discuss launch",
      outcome: {
        entityType: "CONVERSATION" as const,
        entityId: "actual-destination",
        agentSessionId: "actual-session",
        title: "Launch",
      },
    };
    const source: MessageResponseDto = {
      id: "routing-system",
      projectId: project.id,
      conversationId: "routing-conversation",
      type: MessageType.System,
      status: MessageStatus.Open,
      createdAt: "2026-09-27T00:00:00Z",
      awaitingResponse: true,
      responses: [],
      data: {
        type: "QUESTIONS",
        response: "Choose a destination",
        uiElements: [
          {
            id: "route",
            type: "goal_pm_action",
            payload: { goalId: "goal", options: [option] },
          },
        ],
      },
    };
    const metadata = {
      id: source.conversationId,
      organizationId: project.organizationId,
      projectId: project.id,
      createdAt: source.createdAt,
      updatedAt: source.createdAt,
    } as ConversationResponseDto;
    const result = {
      sourceConversationId: metadata.id,
      sourceMessageId: source.id,
      uiElementId: "route",
      answerMessageId: "routing-answer",
      answer,
    };
    const onGoalPmAction = vi.fn().mockResolvedValue(result);
    const first = render(
      <ConversationViewer
        conversation={withCanonicalMessages(
          conversationFixture(metadata, [source]),
        )}
        project={project}
        onGoalPmAction={onGoalPmAction}
        timelineAnimationMode="none"
      />,
      { wrapper: createTestWrapper() },
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Start Conversation" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start Conversation" }));
    await waitFor(() =>
      expect(onGoalPmAction).toHaveBeenCalledWith(
        {
          sourceMessageId: source.id,
          uiElementId: "route",
          selectedOptionId: "new",
        },
        metadata.id,
        routedCreation,
      ),
    );
    first.unmount();
    const reply: MessageResponseDto = {
      id: "routing-answer",
      projectId: project.id,
      conversationId: metadata.id,
      parentMessageId: source.id,
      type: MessageType.User,
      createdAt: "2026-09-27T00:00:01Z",
      data: { route: answer },
    };
    render(
      <ConversationViewer
        conversation={withCanonicalMessages(
          conversationFixture(metadata, [{ ...source, responses: [reply] }]),
        )}
        project={project}
        onGoalPmAction={onGoalPmAction}
        timelineAnimationMode="none"
      />,
      { wrapper: createTestWrapper() },
    );
    expect(
      await screen.findByTestId("goal-pm-record-choice"),
    ).toHaveTextContent("Created");
    expect(screen.getByRole("button", { name: "Created" })).toBeDisabled();
    expect(screen.queryByText("Discuss launch")).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-message-id="routing-answer"]'),
    ).toBeNull();
    expect(onGoalPmAction).toHaveBeenCalledTimes(1);
    expect(mockPostMessage).not.toHaveBeenCalled();
  });
  it("renders no row or content for a response-bearing hidden SYSTEM message", () => {
    const project = {
      id: "proj-hidden",
      name: "Test Project",
      organizationId: "org-123",
      createdAt: "2023-01-01T00:00:00Z",
      updatedAt: "2023-01-01T00:00:00Z",
    } as ProjectResponseDto;
    const hidden: MessageResponseDto = {
      id: "hidden-system",
      projectId: project.id,
      type: MessageType.System,
      status: MessageStatus.Open,
      conversationId: "conv-hidden",
      responses: [],
      createdAt: "2023-01-01T00:00:00Z",
      awaitingResponse: true,
      data: {
        type: "QUESTIONS",
        response: "Starting...",
        uiElements: [
          {
            id: "marker",
            type: "agent_hidden",
            label: "Hidden",
            influences: [],
          },
        ],
      },
    };
    const conversation = conversationFixture(
      {
        id: "conv-hidden",
        projectId: project.id,
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T00:00:00Z",
      } as ConversationResponseDto,
      [hidden],
    );
    render(
      <ConversationViewer
        conversation={withCanonicalMessages(conversation)}
        project={project}
        showNavigation
        timelineAnimationMode="none"
      />,
      { wrapper: createTestWrapper() },
    );
    expect(screen.queryByText("Starting...")).not.toBeInTheDocument();
    expect(screen.queryByTestId("hidden-system")).not.toBeInTheDocument();
    expect(
      screen
        .getByTestId("conversation-timeline")
        .querySelectorAll("[data-message-id]"),
    ).toHaveLength(0);
  });
  it("keeps wide inline content inside the viewer content region", () => {
    const project = {
      id: "proj-456",
      name: "Test Project",
      organizationId: "org-123",
      createdAt: "2023-01-01T00:00:00Z",
      updatedAt: "2023-01-01T00:00:00Z",
    } as ProjectResponseDto;
    const conversation = conversationFixture(
      {
        id: "conv-wide",
        projectId: project.id,
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T00:00:00Z",
      },
      [],
    ) as ConversationResponseDto;
    render(
      <ConversationViewer
        conversation={withCanonicalMessages(conversation)}
        project={project}
        showNavigation={false}
        slotProps={{
          paper: {
            "data-testid": "wide-conversation-content",
          },
        }}
      />,
      { wrapper: createTestWrapper() },
    );
    expect(screen.getByTestId("conversation-viewer-cont")).toHaveStyle({
      minWidth: "0",
      width: "100%",
      maxWidth: "100%",
      overflowX: "hidden",
    });
    expect(screen.getByTestId("wide-conversation-content")).toHaveStyle({
      minWidth: "0",
      maxWidth: "100%",
      overflow: "auto",
    });
  });
});
describe("ConversationViewer explicit message associations", () => {
  const project = {
    id: "proj-explicit-associations",
    name: "Explicit Associations Project",
    organizationId: "org-explicit-associations",
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
  } as ProjectResponseDto;
  const snapshotReport: ReportDto = {
    id: "inline-report",
    organizationId: project.organizationId,
    projectId: project.id,
    reportType: ReportType.Snapshot,
    audience: ReportAudience.ProjectVisible,
    title: "Inline snapshot",
    payload: {
      reportType: "SNAPSHOT",
      summary: "The final response is fully assembled.",
    },
    version: 1,
    schemaVersion: 1,
    createdAt: "2026-08-31T00:00:01.000Z",
    expiresAt: "2026-09-01T00:00:01.000Z",
    entities: [],
  };
  const planReport: ReportDto = {
    id: "interactive-report",
    organizationId: project.organizationId,
    projectId: project.id,
    reportType: ReportType.Plan,
    audience: ReportAudience.ProjectVisible,
    title: "Interactive plan",
    payload: {
      reportType: "PLAN",
      summary: "The plan is ready for review.",
      sessionTitle: "Explicit association review",
      requiredServiceIds: new Set<string>(),
      primaryImplementations: [],
      executionPlan: [],
      discrepancies: [],
      clarificationQuestions: [],
    },
    version: 1,
    schemaVersion: 1,
    createdAt: "2026-08-31T00:00:02.000Z",
    expiresAt: "2026-09-01T00:00:02.000Z",
    entities: [],
  };
  const finalMessage: Extract<
    MessageResponseDto,
    {
      type: "SYSTEM";
    }
  > = {
    id: "final-message",
    projectId: project.id,
    type: "SYSTEM",
    status: MessageStatus.Completed,
    data: {
      type: "AGENT",
      response: "Completed response.",
      actionHint: "task_complete",
      uiElements: [
        {
          id: "startup-plan-field",
          type: ExtendedUIFieldType.CodingPromptStartupPlan,
          label: "Startup plan",
        },
      ],
    },
    conversationId: "conv-explicit-associations",
    responses: [],
    createdAt: "2026-08-31T00:00:03.000Z",
    awaitingResponse: false,
    reports: [snapshotReport, planReport],
  };
  const conversation = conversationFixture(
    {
      id: finalMessage.conversationId,
      projectId: project.id,
      organizationId: project.organizationId,
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:03.000Z",
    },
    [finalMessage],
  ) as ConversationResponseDto;
  const expectRenderedAttachments = () => {
    expect(screen.getAllByTestId("final-message")).toHaveLength(1);
    expect(screen.getAllByTestId("report-viewer-inline-report")).toHaveLength(
      1,
    );
    expect(
      screen.getAllByTestId("report-viewer-interactive-report"),
    ).toHaveLength(1);
    expect(
      screen.getByTestId("report-viewer-interactive-report-plan-interactive"),
    ).toBeInTheDocument();
  };
  it("renders each report from the completed message once after a payload reload", () => {
    const { rerender } = render(
      <ConversationViewer
        conversation={withCanonicalMessages(conversation)}
        project={project}
        showNavigation={false}
        timelineAnimationMode="none"
      />,
      { wrapper: createTestWrapper() },
    );
    expectRenderedAttachments();
    const reloadedConversation: ConversationResponseDto = conversationFixture(
      {
        ...conversation,
      },
      [
        {
          ...finalMessage,
          data: {
            ...finalMessage.data,
            response: "Completed response after reload.",
          },
          reports: finalMessage.reports?.map((report) => ({ ...report })),
        },
      ],
    );
    rerender(
      <ConversationViewer
        conversation={withCanonicalMessages(reloadedConversation)}
        project={project}
        showNavigation={false}
        timelineAnimationMode="none"
      />,
    );
    expectRenderedAttachments();
    expect(screen.getByTestId("final-message")).toHaveTextContent(
      "Completed response after reload.",
    );
  });
});
describe("ConversationViewer agent session current state", () => {
  const project = {
    id: "proj-agent-session-state",
    name: "Agent Session State Project",
    organizationId: "org-agent-session-state",
    createdAt: "2023-01-01T00:00:00Z",
    updatedAt: "2023-01-01T00:00:00Z",
  } as ProjectResponseDto;
  const conversation = {
    id: "conv-agent-session-state",
    projectId: project.id,
    messages: [],
    createdAt: "2023-01-01T00:00:00Z",
    updatedAt: "2023-01-01T00:00:00Z",
  } as ConversationResponseDto;

  it.each([
    AgentSessionCurrentState.Starting,
    AgentSessionCurrentState.AwaitingApproval,
  ])("renders the shared indicator for $currentState", (currentState) => {
    render(
      <ConversationViewer
        conversation={conversation}
        project={project}
        showNavigation={false}
        agentSessionId="agent-session-state"
        agentSessionCurrentState={currentState}
        showAgentSessionCurrentStateIndicator
      />,
      { wrapper: createTestWrapper() },
    );

    expect(
      screen.getByTestId("agent-session-current-state-indicator"),
    ).toHaveAttribute("data-current-state", currentState);
  });

  it("does not render the indicator for an idle session", () => {
    render(
      <ConversationViewer
        conversation={conversation}
        project={project}
        showNavigation={false}
        agentSessionId="agent-session-state"
        agentSessionCurrentState={AgentSessionCurrentState.Idle}
        showAgentSessionCurrentStateIndicator
      />,
      { wrapper: createTestWrapper() },
    );

    expect(
      screen.queryByTestId("agent-session-current-state-indicator"),
    ).not.toBeInTheDocument();
  });

  describe("live tool calls before narration exists", () => {
    const availableCalls = {
      status: "available" as const,
      result: {
        state: "available" as const,
        runId: "agent-session-state",
        turnId: "turn-1",
        omittedEarlierCount: 0,
        evictedCount: 0,
        toolCalls: [
          {
            entryId: "entry-1",
            toolUseId: "use-1",
            toolName: "Read",
            summary: "src/early.ts",
            status: "running" as const,
            exitCode: null,
            lane: {
              subagentTurnId: null,
              providerThreadId: null,
              parentToolUseId: null,
            },
            createdAt: "2026-10-20T00:00:00.000Z",
            updatedAt: "2026-10-20T00:00:00.000Z",
            detail: { input: null, output: null, result: null },
          },
        ],
      },
    };
    const renderState = (currentState: AgentSessionCurrentState) =>
      render(
        <ConversationViewer
          conversation={conversation}
          project={project}
          showNavigation={false}
          agentSessionId="agent-session-state"
          agentSessionCurrentState={currentState}
          showAgentSessionCurrentStateIndicator
        />,
        { wrapper: createTestWrapper() },
      );
    afterEach(() => {
      liveToolCalls.current = { status: "idle" };
    });

    it("shows the polled tool calls under the timeline while the Turn is active", () => {
      liveToolCalls.current = availableCalls;
      renderState(AgentSessionCurrentState.Writing);

      expect(screen.getByTestId("latest-turn-tool-calls")).toHaveTextContent(
        "src/early.ts",
      );
    });

    it("shows nothing once the Turn is no longer active", () => {
      liveToolCalls.current = availableCalls;
      renderState(AgentSessionCurrentState.Idle);

      expect(
        screen.queryByTestId("latest-turn-tool-calls"),
      ).not.toBeInTheDocument();
    });

    it.each([
      { status: "idle" } as const,
      { status: "disabled" } as const,
      { status: "unavailable", error: "boom" } as const,
    ])("shows nothing for the $status outcome", (state) => {
      liveToolCalls.current = state;
      renderState(AgentSessionCurrentState.Writing);

      expect(
        screen.queryByTestId("latest-turn-tool-calls"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("boom")).not.toBeInTheDocument();
    });
  });
});

describe("ConversationViewer new conversation confirmation", () => {
  const project = {
    id: "proj-confirmation",
    name: "Confirmation Project",
    organizationId: "org-confirmation",
    createdAt: "2023-01-01T00:00:00Z",
    updatedAt: "2023-01-01T00:00:00Z",
  } as ProjectResponseDto;
  const conversation = conversationFixture(
    {
      id: "conv-confirmation",
      projectId: project.id,
      createdAt: "2023-01-01T00:00:00Z",
      updatedAt: "2023-01-01T00:00:00Z",
    },
    [],
  ) as ConversationResponseDto;
  it("opens, cancels, and confirms without deleting the current thread", async () => {
    const user = userEvent.setup();
    const onCreateNewConversation = vi.fn(async (_draftText: string) => {});
    render(
      <ConversationViewer
        conversation={withCanonicalMessages(conversation)}
        project={project}
        showNavigation={false}
        onCreateNewConversation={onCreateNewConversation}
        confirmBeforeNewConversation
      />,
      { wrapper: createTestWrapper() },
    );
    await user.click(screen.getByRole("button", { name: "New conversation" }));
    expect(
      screen.getByRole("heading", { name: "Are your sure?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog").textContent).toContain(
      "remains available in the Conversations tab",
    );
    expect(onCreateNewConversation).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Are your sure?" }),
      ).not.toBeInTheDocument();
    });
    expect(onCreateNewConversation).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "New conversation" }));
    await user.click(
      screen.getByRole("button", { name: "Start new conversation" }),
    );
    await waitFor(() => {
      expect(onCreateNewConversation).toHaveBeenCalledWith("");
    });
  });
  it("can start a new conversation without confirmation", async () => {
    const user = userEvent.setup();
    const onCreateNewConversation = vi.fn(async (_draftText: string) => {});
    render(
      <ConversationViewer
        conversation={withCanonicalMessages(conversation)}
        project={project}
        showNavigation={false}
        onCreateNewConversation={onCreateNewConversation}
        confirmBeforeNewConversation={false}
      />,
      { wrapper: createTestWrapper() },
    );
    await user.click(screen.getByRole("button", { name: "New conversation" }));
    await waitFor(() => {
      expect(onCreateNewConversation).toHaveBeenCalledWith("");
    });
    expect(
      screen.queryByRole("heading", { name: "Are your sure?" }),
    ).not.toBeInTheDocument();
  });
});
describe.skip("ConversationViewer Integration Tests - Version Conflicts", () => {
  const mockProject: ProjectResponseDto = {
    id: "proj-456",
    name: "Test Project",
    organizationId: "org-123",
    createdAt: "2023-01-01T00:00:00Z",
    updatedAt: "2023-01-01T00:00:00Z",
  } as ProjectResponseDto;
  const createMockMessage = (
    id: string,
    content: string,
    type: MessageType = MessageType.System,
    status: MessageStatus = MessageStatus.Open,
    awaitingResponse = true,
  ): MessageResponseDto =>
    ({
      id,
      content,
      type,
      status,
      awaitingResponse,
      createdAt: "2023-01-01T00:00:00Z",
      updatedAt: "2023-01-01T00:00:00Z",
      responses: [],
      data: {
        response: content,
        type: type,
        fields: [
          {
            id: "message",
            type: "textarea",
            label: "Your response",
            required: true,
          },
        ],
      },
    }) as MessageResponseDto;
  const createVersionedConversation = (
    version: number,
    messages: MessageResponseDto[] = [],
  ): VersionedConversationResponseDto =>
    conversationFixture(
      {
        id: "conv-123",
        version,
        projectId: "proj-456",
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T00:00:00Z",
      },
      messages.length > 0
        ? messages
        : [createMockMessage("msg-1", "Test question")],
    ) as VersionedConversationResponseDto;
  beforeEach(() => {
    vi.clearAllMocks();
    mockRetryWithBackoff.mockImplementation(async (operation) => {
      return await operation();
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });
  describe("Version conflict handling during message submission", () => {
    it("should handle version conflict and show resolution dialog", async () => {
      const user = userEvent.setup();
      const originalConversation = createVersionedConversation(5);
      const versionConflictError: VersionConflictError = {
        error: "VERSION_CONFLICT",
        currentVersion: 8,
        expectedVersion: 5,
        latestConversation: createVersionedConversation(8, [
          createMockMessage("msg-1", "Test question"),
          createMockMessage("msg-2", "New message from another user"),
        ]),
      };
      // Mock API to throw version conflict on first try, succeed on retry
      let callCount = 0;
      mockPostMessage.mockImplementation(() => {
        if (callCount === 0) {
          callCount++;
          return Promise.reject(versionConflictError);
        }
        return Promise.resolve();
      });
      // Mock retry hook to immediately throw the error (no retries for UI testing)
      mockRetryWithBackoff.mockImplementation(async (operation) => {
        try {
          return await operation();
        } catch (error) {
          throw error; // Let the error bubble up to trigger dialog
        }
      });
      render(
        <ConversationViewer
          conversation={withCanonicalMessages(originalConversation)}
          project={mockProject}
          showNavigation={true}
        />,
        { wrapper: createTestWrapper() },
      );
      // Find the form textarea and submit button
      const textarea = screen.getByRole("textbox");
      expect(textarea).toBeInTheDocument();
      // Fill in the form
      await user.type(textarea, "My response");
      // Submit the form
      const submitButton = screen.getByRole("button", { name: /submit/i });
      await user.click(submitButton);
      // Should show version conflict dialog
      await waitFor(() => {
        expect(screen.getByText(/version conflict/i)).toBeInTheDocument();
      });
      // Check that dialog shows conflict information
      expect(screen.getByText(/another user has updated/i)).toBeInTheDocument();
      expect(screen.getByText(/review the changes/i)).toBeInTheDocument();
      // Should show retry and cancel options
      expect(
        screen.getByRole("button", { name: /retry/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /cancel/i }),
      ).toBeInTheDocument();
    });
    it("should retry submission with updated version after conflict resolution", async () => {
      const user = userEvent.setup();
      const originalConversation = createVersionedConversation(3);
      const versionConflictError: VersionConflictError = {
        error: "VERSION_CONFLICT",
        currentVersion: 6,
        expectedVersion: 3,
        latestConversation: createVersionedConversation(6),
      };
      // Mock the retry hook to handle the conflict properly
      let isRetrying = false;
      mockRetryWithBackoff.mockImplementation(async (operation, options) => {
        try {
          return await operation();
        } catch (error) {
          if (!isRetrying && options?.onRetry) {
            isRetrying = true;
            options.onRetry(1, error);
            // Simulate successful retry
            return Promise.resolve();
          }
          throw error;
        }
      });
      mockPostMessage
        .mockRejectedValueOnce(versionConflictError)
        .mockResolvedValueOnce(undefined);
      render(
        <ConversationViewer
          conversation={withCanonicalMessages(originalConversation)}
          project={mockProject}
          showNavigation={true}
        />,
        { wrapper: createTestWrapper() },
      );
      const textarea = screen.getByRole("textbox");
      await user.type(textarea, "Test message");
      const submitButton = screen.getByRole("button", { name: /submit/i });
      await user.click(submitButton);
      // Should eventually succeed after retry
      await waitFor(() => {
        expect(mockPostMessage).toHaveBeenCalledTimes(2);
      });
      // Check that the second call used the updated version
      const secondCall = mockPostMessage.mock.calls[1]?.[0]
        ?.createMessageDto as CreateUserMessage;
      expect(secondCall.expectedConversationVersion).toBe(6);
    });
    it("should cancel version conflict and reset form state", async () => {
      const user = userEvent.setup();
      const originalConversation = createVersionedConversation(2);
      const versionConflictError: VersionConflictError = {
        error: "VERSION_CONFLICT",
        currentVersion: 4,
        expectedVersion: 2,
        latestConversation: createVersionedConversation(4),
      };
      mockRetryWithBackoff.mockRejectedValue(versionConflictError);
      render(
        <ConversationViewer
          conversation={withCanonicalMessages(originalConversation)}
          project={mockProject}
          showNavigation={true}
        />,
        { wrapper: createTestWrapper() },
      );
      const textarea = screen.getByRole("textbox");
      await user.type(textarea, "Test message");
      const submitButton = screen.getByRole("button", { name: /submit/i });
      await user.click(submitButton);
      // Wait for version conflict dialog
      await waitFor(() => {
        expect(screen.getByText(/version conflict/i)).toBeInTheDocument();
      });
      // Click cancel
      const cancelButton = screen.getByRole("button", { name: /cancel/i });
      await user.click(cancelButton);
      // Dialog should close
      await waitFor(() => {
        expect(screen.queryByText(/version conflict/i)).not.toBeInTheDocument();
      });
      // Form should be in normal state (not submitting)
      expect(textarea).not.toBeDisabled();
    });
  });
  describe("Integration with smart polling and WebSocket", () => {
    it("should trigger aggressive polling after successful message submission", async () => {
      const user = userEvent.setup();
      const conversation = createVersionedConversation(1);
      mockPostMessage.mockResolvedValue(undefined);
      render(
        <ConversationViewer
          conversation={withCanonicalMessages(conversation)}
          project={mockProject}
          showNavigation={true}
        />,
        { wrapper: createTestWrapper() },
      );
      const textarea = screen.getByRole("textbox");
      await user.type(textarea, "Test message");
      const submitButton = screen.getByRole("button", { name: /submit/i });
      await user.click(submitButton);
      await waitFor(() => {
        expect(mockTriggerAggressivePolling).toHaveBeenCalled();
      });
    });
    it("should handle version conflicts from WebSocket updates during form submission", async () => {
      const user = userEvent.setup();
      const conversation = createVersionedConversation(5);
      // Simulate a slow API call that gets a version conflict
      const versionConflictError: VersionConflictError = {
        error: "VERSION_CONFLICT",
        currentVersion: 7,
        expectedVersion: 5,
        latestConversation: createVersionedConversation(7),
      };
      mockPostMessage.mockImplementation(() => {
        // Simulate delay, then throw conflict
        return new Promise((_, reject) => {
          setTimeout(() => reject(versionConflictError), 100);
        });
      });
      mockRetryWithBackoff.mockImplementation(async (operation) => {
        return await operation();
      });
      render(
        <ConversationViewer
          conversation={withCanonicalMessages(conversation)}
          project={mockProject}
          showNavigation={true}
        />,
        { wrapper: createTestWrapper() },
      );
      const textarea = screen.getByRole("textbox");
      await user.type(textarea, "Message that will conflict");
      const submitButton = screen.getByRole("button", { name: /submit/i });
      await user.click(submitButton);
      // Should eventually show version conflict dialog
      await waitFor(
        () => {
          expect(screen.getByText(/version conflict/i)).toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    });
  });
  describe("Complex version conflict scenarios", () => {
    it("should handle multiple rapid submissions with version conflicts", async () => {
      const user = userEvent.setup();
      const conversation = createVersionedConversation(1);
      const conflicts = [
        {
          error: "VERSION_CONFLICT" as const,
          currentVersion: 2,
          expectedVersion: 1,
          latestConversation: createVersionedConversation(2),
        },
        {
          error: "VERSION_CONFLICT" as const,
          currentVersion: 3,
          expectedVersion: 2,
          latestConversation: createVersionedConversation(3),
        },
      ];
      let conflictIndex = 0;
      mockPostMessage.mockImplementation(() => {
        if (conflictIndex < conflicts.length) {
          return Promise.reject(conflicts[conflictIndex++]);
        }
        return Promise.resolve();
      });
      // Mock retry to eventually succeed
      mockRetryWithBackoff.mockImplementation(async (operation, options) => {
        let attempts = 0;
        const maxAttempts = 3;
        while (attempts < maxAttempts) {
          try {
            return await operation();
          } catch (error) {
            attempts++;
            if (attempts < maxAttempts && options?.onRetry) {
              options.onRetry(attempts, error);
              // Update the expected version for retry
              if (
                error &&
                typeof error === "object" &&
                "latestConversation" in error
              ) {
                // Simulate version update logic
                continue;
              }
            }
            if (attempts >= maxAttempts) {
              throw error;
            }
          }
        }
      });
      render(
        <ConversationViewer
          conversation={withCanonicalMessages(conversation)}
          project={mockProject}
          showNavigation={true}
        />,
        { wrapper: createTestWrapper() },
      );
      const textarea = screen.getByRole("textbox");
      await user.type(textarea, "Rapid submission test");
      const submitButton = screen.getByRole("button", { name: /submit/i });
      await user.click(submitButton);
      // Should eventually succeed after multiple retries
      await waitFor(
        () => {
          expect(mockPostMessage).toHaveBeenCalledTimes(3); // 2 conflicts + 1 success
        },
        { timeout: 5000 },
      );
    });
    it("should handle version conflicts with non-versioned fallback", async () => {
      const user = userEvent.setup();
      // Start with non-versioned conversation
      const legacyConversation: ConversationResponseDto = conversationFixture(
        {
          id: "conv-legacy",
          projectId: "proj-456",
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-01T00:00:00Z",
        },
        [createMockMessage("msg-1", "Legacy question")],
      ) as ConversationResponseDto;
      mockPostMessage.mockResolvedValue(undefined);
      render(
        <ConversationViewer
          conversation={withCanonicalMessages(legacyConversation)}
          project={mockProject}
          showNavigation={true}
        />,
        { wrapper: createTestWrapper() },
      );
      const textarea = screen.getByRole("textbox");
      await user.type(textarea, "Response to legacy conversation");
      const submitButton = screen.getByRole("button", { name: /submit/i });
      await user.click(submitButton);
      await waitFor(() => {
        expect(mockPostMessage).toHaveBeenCalled();
      });
      // Check that message was created without version
      const submittedMessage = mockPostMessage.mock.calls[0]?.[0]
        ?.createMessageDto as CreateUserMessage;
      expect(submittedMessage.expectedConversationVersion).toBeUndefined();
    });
    it("should handle mixed versioned and non-versioned message flows", async () => {
      const user = userEvent.setup();
      const isVersioned = false;
      // Start with non-versioned, then switch to versioned
      const { rerender } = render(
        <ConversationViewer
          conversation={withCanonicalMessages(
            conversationFixture(
              {
                id: "conv-mixed",
                projectId: "proj-456",
              },
              [createMockMessage("msg-1", "Question 1")],
            ) as ConversationResponseDto,
          )}
          project={mockProject}
          showNavigation={true}
        />,
        { wrapper: createTestWrapper() },
      );
      // First submission (non-versioned)
      let textarea = screen.getByRole("textbox");
      await user.type(textarea, "First response");
      let submitButton = screen.getByRole("button", { name: /submit/i });
      await user.click(submitButton);
      await waitFor(() => {
        expect(mockPostMessage).toHaveBeenCalledTimes(1);
      });
      // Switch to versioned conversation
      rerender(
        <ConversationViewer
          conversation={withCanonicalMessages(
            createVersionedConversation(5, [
              createMockMessage("msg-1", "Question 1"),
              createMockMessage("msg-2", "Question 2"),
            ]),
          )}
          project={mockProject}
          showNavigation={true}
        />,
      );
      // Second submission (versioned)
      textarea = screen.getByRole("textbox");
      await user.clear(textarea);
      await user.type(textarea, "Second response");
      submitButton = screen.getByRole("button", { name: /submit/i });
      await user.click(submitButton);
      await waitFor(() => {
        expect(mockPostMessage).toHaveBeenCalledTimes(2);
      });
      // Check version awareness in submissions
      const firstSubmission = mockPostMessage.mock.calls[0]?.[0]
        ?.createMessageDto as CreateUserMessage;
      const secondSubmission = mockPostMessage.mock.calls[1]?.[0]
        ?.createMessageDto as CreateUserMessage;
      expect(firstSubmission.expectedConversationVersion).toBeUndefined();
      expect(secondSubmission.expectedConversationVersion).toBe(5);
    });
  });
  describe("Error recovery and resilience", () => {
    it("should recover gracefully from malformed version conflict errors", async () => {
      const user = userEvent.setup();
      const conversation = createVersionedConversation(1);
      // Malformed version conflict error
      const malformedError = {
        error: "VERSION_CONFLICT",
        // Missing required fields
        currentVersion: "not-a-number",
      };
      mockRetryWithBackoff.mockRejectedValue(malformedError);
      render(
        <ConversationViewer
          conversation={withCanonicalMessages(conversation)}
          project={mockProject}
          showNavigation={true}
        />,
        { wrapper: createTestWrapper() },
      );
      const textarea = screen.getByRole("textbox");
      await user.type(textarea, "Test message");
      const submitButton = screen.getByRole("button", { name: /submit/i });
      await user.click(submitButton);
      // Should handle error gracefully (not show version conflict dialog)
      await waitFor(() => {
        // The form should be back to normal state since the error isn't a proper version conflict
        expect(textarea).not.toBeDisabled();
      });
      // Should not show version conflict dialog for malformed errors
      expect(screen.queryByText(/version conflict/i)).not.toBeInTheDocument();
    });
    it("should handle network errors during version conflict resolution", async () => {
      const user = userEvent.setup();
      const conversation = createVersionedConversation(3);
      const networkError = new Error("Network request failed");
      mockRetryWithBackoff.mockRejectedValue(networkError);
      render(
        <ConversationViewer
          conversation={withCanonicalMessages(conversation)}
          project={mockProject}
          showNavigation={true}
        />,
        { wrapper: createTestWrapper() },
      );
      const textarea = screen.getByRole("textbox");
      await user.type(textarea, "Test message");
      const submitButton = screen.getByRole("button", { name: /submit/i });
      await user.click(submitButton);
      // Should handle network error without version conflict dialog
      await waitFor(() => {
        expect(textarea).not.toBeDisabled();
      });
      expect(screen.queryByText(/version conflict/i)).not.toBeInTheDocument();
    });
    it("should maintain form state during version conflict resolution", async () => {
      const user = userEvent.setup();
      const conversation = createVersionedConversation(1);
      const versionConflictError: VersionConflictError = {
        error: "VERSION_CONFLICT",
        currentVersion: 3,
        expectedVersion: 1,
        latestConversation: createVersionedConversation(3),
      };
      mockRetryWithBackoff.mockRejectedValue(versionConflictError);
      render(
        <ConversationViewer
          conversation={withCanonicalMessages(conversation)}
          project={mockProject}
          showNavigation={true}
        />,
        { wrapper: createTestWrapper() },
      );
      const testMessage = "Important message that should be preserved";
      const textarea = screen.getByRole("textbox");
      await user.type(textarea, testMessage);
      const submitButton = screen.getByRole("button", { name: /submit/i });
      await user.click(submitButton);
      // Wait for version conflict dialog
      await waitFor(() => {
        expect(screen.getByText(/version conflict/i)).toBeInTheDocument();
      });
      // The form data should be preserved and available for retry
      // This is implementation-specific and depends on how the dialog shows the form data
      expect(screen.getByText(testMessage)).toBeInTheDocument();
    });
  });
});

function withCanonicalMessages(conversation: ConversationResponseDto) {
  const messages = flattenFixtureMessages(fixtureMessages(conversation));
  canonicalMessageRead.mockResolvedValue({ data: { data: { messages } } });
  testQueryClient.setQueryData(
    messageKeys.list(
      conversation.organizationId,
      conversation.projectId,
      conversation.id,
    ),
    messages,
  );
  return conversation;
}

describe("current response target publication", () => {
  it("publishes semantic replacement, completion, and empty-conversation changes from canonical Messages", async () => {
    const project = {
      id: "target-project",
      organizationId: "target-organization",
      name: "Project",
      createdAt: "2026-09-28T00:00:00Z",
      updatedAt: "2026-09-28T00:00:00Z",
    } as ProjectResponseDto;
    const metadata = {
      id: "target-conversation",
      projectId: project.id,
      organizationId: project.organizationId,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    } as ConversationResponseDto;
    const first: MessageResponseDto = {
      id: "target-first",
      projectId: project.id,
      conversationId: metadata.id,
      type: MessageType.System,
      status: MessageStatus.Open,
      awaitingResponse: true,
      createdAt: project.createdAt,
      responses: [],
      data: {
        type: "QUESTIONS",
        uiElements: [{ id: "reply", type: "textarea" }],
      },
    };
    const onResponseTargetChange = vi.fn();
    const renderViewer = (
      messages: MessageResponseDto[],
      conversation = metadata,
    ) => (
      <ConversationViewer
        conversation={withCanonicalMessages(
          conversationFixture(conversation, messages),
        )}
        project={project}
        readOnly
        timelineAnimationMode="none"
        onResponseTargetChange={onResponseTargetChange}
      />
    );
    const BaseWrapper = createTestWrapper();
    const view = render(renderViewer([first]), {
      wrapper: ({ children }) => (
        <MemoryRouter>
          <BaseWrapper>{children}</BaseWrapper>
        </MemoryRouter>
      ),
    });
    await waitFor(() =>
      expect(onResponseTargetChange).toHaveBeenLastCalledWith(
        {
          ownership: "exclusive",
          messageId: first.id,
          currentFieldId: "reply",
          submissionKind: "field",
          usable: false,
        },
        metadata.id,
        true,
      ),
    );
    const count = onResponseTargetChange.mock.calls.length;
    view.rerender(renderViewer([first]));
    expect(onResponseTargetChange).toHaveBeenCalledTimes(count);
    const second = {
      ...first,
      id: "target-second",
      createdAt: "2026-09-28T00:01:00Z",
    };
    view.rerender(renderViewer([first, second]));
    await waitFor(() =>
      expect(onResponseTargetChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ messageId: second.id }),
        metadata.id,
        true,
      ),
    );
    const answer: MessageResponseDto = {
      id: "target-answer",
      projectId: project.id,
      conversationId: metadata.id,
      parentMessageId: second.id,
      type: MessageType.User,
      createdAt: "2026-09-28T00:02:00Z",
      data: { reply: "Answered" },
    };
    view.rerender(renderViewer([first, { ...second, responses: [answer] }]));
    await waitFor(() =>
      expect(onResponseTargetChange).toHaveBeenLastCalledWith(
        { ownership: "none" },
        metadata.id,
        true,
      ),
    );
    view.rerender(
      renderViewer([], { ...metadata, id: "target-empty-conversation" }),
    );
    await waitFor(() =>
      expect(onResponseTargetChange).toHaveBeenLastCalledWith(
        { ownership: "none" },
        "target-empty-conversation",
        true,
      ),
    );
  });
});
afterEach(() => {
  resetConversationMessageHistoryStateForTests();
});

describe("canonical Message lifecycle", () => {
  const metadata: ConversationResponseDto = {
    id: "canonical-lifecycle",
    organizationId: "org-lifecycle",
    projectId: "project-lifecycle",
    initiatedBy: "USER",
    status: "IN_PROGRESS",
    workflowName: "onboarding",
    version: 1,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  };
  const project = {
    id: metadata.projectId,
    organizationId: metadata.organizationId,
    name: "Lifecycle",
  } as ProjectResponseDto;
  it("renders read-only content from the Message endpoint with no embedded field", async () => {
    canonicalMessageRead.mockResolvedValue({
      data: {
        data: {
          messages: [
            {
              id: "canonical-read-only",
              projectId: project.id,
              conversationId: metadata.id,
              type: "SYSTEM",
              status: "completed",
              createdAt: metadata.createdAt,
              awaitingResponse: false,
              data: {
                type: "AGENT",
                response: "Canonical read-only response",
                title: "Canonical step",
              },
            },
          ],
        },
      },
    });
    render(
      <ConversationViewer
        conversation={metadata}
        project={project}
        readOnly
        showNavigation
        timelineAnimationMode="none"
        animationType="minimal"
        scrollPolicy={{ mode: "disabled" }}
      />,
      { wrapper: createTestWrapper() },
    );
    await waitFor(() =>
      expect(
        screen.getByText("Canonical read-only response"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Canonical step")).toBeInTheDocument();
    expect(canonicalMessageRead).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: metadata.id,
        includeProposals: true,
        includeReports: true,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(
      screen.queryByLabelText("Retry last message"),
    ).not.toBeInTheDocument();
  });
  it.each([
    "Service Example isn't bound to a folder on this machine. Bind a folder, then send your message again.",
    "The session could not start because its preparation failed. Please try again.",
    "The session failed while working on your message. Please try again.",
    "A response was generated but could not be published. Please try again.",
  ])(
    "renders one persistent terminal explanation after reload: %s",
    async (response) => {
      const conversation = { ...metadata, id: "terminal-failure-read" };
      canonicalMessageRead.mockResolvedValue({
        data: {
          data: {
            messages: [
              {
                id: "terminal-explanation",
                projectId: project.id,
                conversationId: conversation.id,
                type: "SYSTEM",
                status: "completed",
                parentMessageId: null,
                createdAt: metadata.createdAt,
                awaitingResponse: false,
                data: {
                  type: "AGENT",
                  response,
                  detectedIntent: "agent_response",
                  intentConfidence: 1,
                },
              },
            ],
          },
        },
      });
      const viewer = () =>
        render(
          <ConversationViewer
            conversation={conversation}
            project={project}
            readOnly
            timelineAnimationMode="none"
            animationType="minimal"
            scrollPolicy={{ mode: "disabled" }}
          />,
          { wrapper: createTestWrapper() },
        );
      const first = viewer();
      await screen.findByText(response);
      expect(screen.getAllByText(response)).toHaveLength(1);
      first.unmount();
      testQueryClient.clear();
      viewer();
      await screen.findByText(response);
      expect(screen.getAllByText(response)).toHaveLength(1);
      expect(canonicalMessageRead.mock.calls.length).toBeGreaterThanOrEqual(2);
    },
  );

  it("keeps a preview outside persisted reads", async () => {
    canonicalMessageRead.mockClear();
    render(
      <ConversationViewer
        preview={{
          kind: "preview",
          text: "Starting a new session",
          isThinking: false,
        }}
      />,
      { wrapper: createTestWrapper() },
    );
    expect(screen.getByText("Starting a new session")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(canonicalMessageRead).not.toHaveBeenCalled();
  });
  it("presents failed Message reads explicitly", async () => {
    canonicalMessageRead.mockRejectedValue(new Error("Messages unavailable"));
    render(
      <ConversationViewer
        conversation={{ ...metadata, id: "failed-message-read" }}
        project={project}
        readOnly
        animationType="minimal"
        scrollPolicy={{ mode: "disabled" }}
      />,
      { wrapper: createTestWrapper() },
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("conversation-messages-error"),
      ).toHaveTextContent("Messages unavailable"),
    );
  });
  it("renders an empty timeline without a placeholder for empty Message reads", async () => {
    canonicalMessageRead.mockResolvedValue({
      data: { data: { messages: [] } },
    });
    render(
      <ConversationViewer
        conversation={{ ...metadata, id: "empty-message-read" }}
        project={project}
        readOnly
        animationType="minimal"
        scrollPolicy={{ mode: "disabled" }}
      />,
      { wrapper: createTestWrapper() },
    );
    await waitFor(() =>
      expect(screen.getByTestId("conversation-timeline")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/No messages yet/)).not.toBeInTheDocument();
  });

  it("prepends older history into the same rendered timeline", async () => {
    const conversation = { ...metadata, id: "paged-message-read" };
    const message = (id: string, response: string, createdAt: string) => ({
      id,
      projectId: project.id,
      conversationId: conversation.id,
      type: "SYSTEM" as const,
      status: "completed",
      createdAt,
      awaitingResponse: false,
      data: { type: "AGENT", response },
    });
    canonicalMessageRead
      .mockResolvedValueOnce({
        data: {
          data: {
            messages: [
              message("recent", "Recent response", "2026-09-02T00:00:00Z"),
            ],
            nextCursor: "older-page",
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            messages: [
              message("older", "Older response", "2026-09-01T00:00:00Z"),
            ],
          },
        },
      });
    const user = userEvent.setup();

    render(
      <ConversationViewer
        conversation={conversation}
        project={project}
        readOnly
        animationType="minimal"
        timelineAnimationMode="none"
        scrollPolicy={{ mode: "disabled" }}
      />,
      { wrapper: createTestWrapper() },
    );
    await screen.findByTestId("recent");
    await user.click(screen.getByTestId("show-older-messages-button"));

    await screen.findByTestId("older");
    const timelineMessageIds = Array.from(
      screen
        .getByTestId("conversation-timeline")
        .querySelectorAll("[data-message-id]"),
    ).map((element) => element.getAttribute("data-message-id"));
    expect(timelineMessageIds).toEqual(["older", "recent"]);
  });

  it("prepends history without repeating reveal or overriding native anchoring", async () => {
    const conversation = { ...metadata, id: "anchored-paged-message-read" };
    const message = (id: string, response: string, createdAt: string) => ({
      id,
      projectId: project.id,
      conversationId: conversation.id,
      type: "SYSTEM" as const,
      status: "completed",
      createdAt,
      awaitingResponse: false,
      data: { type: "AGENT", response },
    });
    canonicalMessageRead
      .mockResolvedValueOnce({
        data: {
          data: {
            messages: [
              message(
                "anchor-recent",
                "Recent response",
                "2026-09-02T00:00:00Z",
              ),
            ],
            nextCursor: "older-page",
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            messages: [
              message("anchor-older", "Older response", "2026-09-01T00:00:00Z"),
            ],
          },
        },
      });
    const ownerRef: { current: HTMLElement | null } = { current: null };
    const ownerScrollTo = vi.fn(({ top }: ScrollToOptions) => {
      if (ownerRef.current && typeof top === "number") {
        ownerRef.current.scrollTop = top;
      }
    });
    const user = userEvent.setup();

    render(
      <div
        ref={(owner) => {
          ownerRef.current = owner;
          if (owner) {
            Object.defineProperties(owner, {
              scrollHeight: { configurable: true, value: 2000 },
              clientHeight: { configurable: true, value: 500 },
              scrollTo: { configurable: true, value: ownerScrollTo },
            });
          }
        }}
      >
        <ConversationViewer
          conversation={conversation}
          project={project}
          readOnly
          animationType="minimal"
          timelineAnimationMode="none"
          scrollPolicy={{ mode: "owned", ownerRef }}
        />
      </div>,
      { wrapper: createTestWrapper() },
    );

    const boundaryMessage = await screen.findByTestId("anchor-recent");
    await waitFor(() => expect(ownerScrollTo).toHaveBeenCalled());
    // Let initial positioning finish before the reader chooses their position.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    ownerScrollTo.mockClear();
    if (!ownerRef.current) throw new Error("Owned scrollport did not mount");
    ownerRef.current.scrollTop = 40;
    await user.click(screen.getByTestId("show-older-messages-button"));
    await screen.findByTestId("anchor-older");

    expect(ownerScrollTo).not.toHaveBeenCalled();
    expect(screen.getByTestId("anchor-recent")).toBe(boundaryMessage);
    expect(ownerRef.current.style.overflowAnchor).toBe("");
    // Browser coverage owns the viewport-offset assertion; jsdom has no native anchoring.
  });

  it("keeps recent history visible when loading an older page fails", async () => {
    const conversation = { ...metadata, id: "failed-older-page" };
    canonicalMessageRead
      .mockResolvedValueOnce({
        data: {
          data: {
            messages: [
              {
                id: "recent-after-failure",
                projectId: project.id,
                conversationId: conversation.id,
                type: "SYSTEM",
                status: "completed",
                createdAt: "2026-09-02T00:00:00Z",
                awaitingResponse: false,
                data: { type: "AGENT", response: "Still visible" },
              },
            ],
            nextCursor: "older-page",
          },
        },
      })
      .mockRejectedValueOnce(new Error("older history unavailable"));
    const user = userEvent.setup();

    render(
      <ConversationViewer
        conversation={conversation}
        project={project}
        readOnly
        animationType="minimal"
        timelineAnimationMode="none"
        scrollPolicy={{ mode: "disabled" }}
      />,
      { wrapper: createTestWrapper() },
    );
    await screen.findByTestId("recent-after-failure");
    await user.click(screen.getByTestId("show-older-messages-button"));

    expect(await screen.findByTestId("older-messages-error")).toBeVisible();
    expect(screen.getByTestId("recent-after-failure")).toBeVisible();
    expect(screen.getByTestId("show-older-messages-button")).toBeEnabled();
  });
});

function buildApprovalConversation(outcome: string) {
  const proposal = (id: string): ProposalResponseDto => ({
    id,
    organizationId: "resize-org",
    projectId: "resize-project",
    type: "SINGLE",
    action: "UPDATE",
    status: "PENDING",
    targetEntityId: "resize-doc",
    targetEntityType: "DESIGN_DOC",
    title: "Update review document",
    updates: { content: "Applied content" },
    requestorId: "reader",
    requiredApprovals: 1,
    approvals: [],
    influences: [],
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  });
  const proposals = [proposal("resize-first"), proposal("resize-second")];
  const project = {
    id: "resize-project",
    organizationId: "resize-org",
    name: "Resize project",
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  } as ProjectResponseDto;
  const conversation = conversationFixture(
    {
      id: "resize-conversation-" + outcome,
      organizationId: project.organizationId,
      projectId: project.id,
      initiatedBy: "USER",
      status: "IN_PROGRESS",
      workflowName: "review",
      version: 1,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    },
    [
      {
        id: "resize-message",
        conversationId: "resize-conversation-" + outcome,
        projectId: project.id,
        type: "SYSTEM",
        status: "COMPLETED",
        data: { type: "AGENT", response: "Review both proposals" },
        proposals,
        createdAt: "2026-09-01T00:00:00Z",
        awaitingResponse: false,
      },
    ],
  );
  return { project, conversation, proposals };
}

function renderApprovalViewer(
  seededConversation: ConversationResponseDto,
  project: ProjectResponseDto,
  ownerRef: { current: HTMLDivElement | null },
  accepted: () => void,
  disabled: boolean,
) {
  return render(
    <MemoryRouter>
      <div
        ref={(owner) => {
          ownerRef.current = owner;
          if (owner)
            Object.defineProperties(owner, {
              scrollHeight: { configurable: true, value: 2400 },
              clientHeight: { configurable: true, value: 500 },
              scrollTo: {
                configurable: true,
                value: ({ top }: ScrollToOptions) => {
                  owner.scrollTop = top ?? 0;
                },
              },
            });
        }}
      >
        <ConversationViewer
          conversation={seededConversation}
          project={project}
          scrollPolicy={
            disabled ? { mode: "disabled" } : { mode: "owned", ownerRef }
          }
          timelineAnimationMode="none"
          animationType="minimal"
          onProposalsAccepted={accepted}
        />
      </div>
    </MemoryRouter>,
    { wrapper: createTestWrapper() },
  );
}

describe("inline approval through production viewer wiring", () => {
  it.each(["success", "failure", "cancel", "disabled"] as const)(
    "leaves anchoring to the browser through %s approval",
    async (outcome) => {
      resetProposalCache();
      const { project, conversation, proposals } =
        buildApprovalConversation(outcome);
      let finish: () => void = () => {
        throw new Error("Approval has not started");
      };
      approveProposal.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            finish = () =>
              outcome === "failure"
                ? reject(new Error("Approval unavailable"))
                : resolve({
                    data: {
                      data: { ...proposals[1], status: "APPROVED" },
                    },
                  });
          }),
      );
      readDesignDoc.mockResolvedValue({
        data: {
          data: {
            id: "resize-doc",
            name: "Review document",
            content: "Original long content",
            projectId: "resize-project",
            organizationId: "resize-org",
          },
        },
      });
      const ownerRef: { current: HTMLDivElement | null } = { current: null };
      const accepted = vi.fn();
      const seededConversation = withCanonicalMessages(conversation);
      canonicalMessageRead.mockResolvedValue({
        data: {
          data: {
            messages: flattenFixtureMessages(fixtureMessages(conversation)),
          },
        },
      });
      const { unmount } = renderApprovalViewer(
        seededConversation,
        project,
        ownerRef,
        accepted,
        outcome === "disabled",
      );
      const buttons = await screen.findAllByTestId("proposal-approve");
      await waitFor(() =>
        expect(screen.getAllByTestId("proposal-action-anchor")).toHaveLength(2),
      );
      const owner = ownerRef.current!;
      // Let initial positioning finish before the reader chooses their position.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      owner.scrollTop = 800;
      const anchor = screen.getAllByTestId("proposal-action-anchor")[1];
      fireEvent.click(buttons[1]);
      expect(approveProposal).toHaveBeenLastCalledWith(
        expect.objectContaining({
          proposalId: "resize-second",
          updateProposalDto: { status: "APPROVED" },
        }),
      );
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
      expect(screen.getAllByTestId("proposal-action-anchor")[1]).toBe(anchor);
      if (outcome === "cancel") fireEvent.wheel(owner);
      await act(async () => finish());
      if (outcome === "failure") {
        expect(await screen.findByText("Approval unavailable")).toBeVisible();
      } else {
        expect(await screen.findByText("Updated")).toBeVisible();
      }
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 650));
      });
      expect(owner.scrollTop).toBe(800);
      expect(owner.style.overflowAnchor).toBe("");
      expect(accepted).not.toHaveBeenCalled(); // The other proposal is still pending.
      expect(screen.getAllByTestId("proposal-action-anchor")[1]).toBe(anchor);
      unmount();
    },
  );
});

describe("Repository Import enrichment reply through production viewer wiring", () => {
  const project = {
    id: "enrichment-project",
    organizationId: "enrichment-organization",
    name: "Project",
    createdAt: "2026-10-30T00:00:00Z",
    updatedAt: "2026-10-30T00:00:00Z",
  } as ProjectResponseDto;
  const metadata = {
    id: "enrichment-conversation",
    projectId: project.id,
    organizationId: project.organizationId,
    workflowId: "import-workflow",
    workflowName: "repository-import",
    createdAt: project.createdAt,
    updatedAt: project.createdAt,
  } as ConversationResponseDto;
  const question: MessageResponseDto = {
    id: "enrichment-question",
    projectId: project.id,
    conversationId: metadata.id,
    type: MessageType.System,
    status: MessageStatus.Open,
    createdAt: "2026-10-30T00:00:00Z",
    awaitingResponse: true,
    responses: [],
    data: {
      type: "QUESTIONS",
      response: "1. What does Billing do?",
      uiElements: [
        {
          id: "reply",
          type: ExtendedUIFieldType.RepositoryFeatureEnrichmentReply,
          label: "Your answer",
          required: true,
          submitText: "Send",
        },
      ],
    },
  };
  const savedReply: MessageResponseDto = {
    id: "enrichment-reply",
    projectId: project.id,
    conversationId: metadata.id,
    parentMessageId: question.id,
    type: MessageType.User,
    createdAt: "2026-10-30T00:00:01Z",
    data: { reply: "It charges customers monthly." },
  };

  beforeEach(() => {
    // jsdom has no selection geometry, which the Lexical editor reads.
    Object.defineProperty(Node.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(),
    });
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(),
    });
  });

  const renderViewer = (
    owners: {
      onDirectTrigger: (message: CreateUserMessage) => Promise<void>;
      onSubmitRepositoryImportReply: () => Promise<void>;
    },
    messages: MessageResponseDto[] = [question],
  ) => {
    const view = (nextMessages: MessageResponseDto[]) => (
      <ConversationViewer
        conversation={withCanonicalMessages(
          conversationFixture(metadata, nextMessages),
        )}
        project={project}
        timelineAnimationMode="none"
        {...owners}
      />
    );
    const Providers = createTestWrapper();
    const rendered = render(view(messages), {
      wrapper: ({ children }) => (
        <Providers>
          <MemoryRouter>{children}</MemoryRouter>
        </Providers>
      ),
    });
    return {
      showMessages: (nextMessages: MessageResponseDto[]) =>
        rendered.rerender(view(nextMessages)),
    };
  };

  const replyEditor = () =>
    within(
      screen.getByTestId("repository-feature-enrichment-reply-reply"),
    ).getByRole("textbox");

  const typeAnswer = async () => {
    const input = await screen.findByTestId("smarter-textarea-input");
    await waitFor(() =>
      expect(input).toHaveAttribute("contenteditable", "true"),
    );
    // jsdom gives Lexical no caret, so typing is a no-op; write the text into
    // the mounted editor the way the editor itself would.
    const { __lexicalEditor: editor } = input as HTMLElement & {
      __lexicalEditor: LexicalEditor;
    };
    act(() => {
      editor.update(() => {
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode("It charges customers monthly."));
        $getRoot().clear().append(paragraph);
      });
    });
    await waitFor(() =>
      expect(input).toHaveTextContent("It charges customers monthly."),
    );
    return input;
  };

  it("sends the answer as an ordinary message with a non-empty userMessage, stays locked until the reply is saved, then shows it read-only", async () => {
    const sent: CreateUserMessage[] = [];
    const onDirectTrigger = vi.fn(async (message: CreateUserMessage) => {
      sent.push(message);
    });
    const onSubmitRepositoryImportReply = vi.fn().mockResolvedValue(undefined);
    const { showMessages } = renderViewer({
      onDirectTrigger,
      onSubmitRepositoryImportReply,
    });

    const input = await typeAnswer();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(onDirectTrigger).toHaveBeenCalledTimes(1));
    expect(onSubmitRepositoryImportReply).not.toHaveBeenCalled();
    expect(sent[0]).toMatchObject({
      parentMessageId: question.id,
      conversationId: metadata.id,
      data: {
        agentInput: { userMessage: "It charges customers monthly." },
      },
    });

    // Delivery succeeded, but the saved reply has not arrived yet.
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(input).toHaveAttribute("contenteditable", "false");

    showMessages([{ ...question, responses: [savedReply] }]);

    await waitFor(() =>
      expect(replyEditor()).toHaveTextContent("It charges customers monthly."),
    );
    expect(replyEditor()).toHaveAttribute("contenteditable", "false");
  });

  it("unlocks immediately when the answer is rejected", async () => {
    const onDirectTrigger = vi.fn().mockRejectedValue(new Error("rejected"));
    renderViewer({
      onDirectTrigger,
      onSubmitRepositoryImportReply: vi.fn(),
    });

    const input = await typeAnswer();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(onDirectTrigger).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(input).toHaveAttribute("contenteditable", "true"),
    );
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it("unlocks immediately on a version conflict", async () => {
    const conflict: VersionConflictError = {
      error: "VERSION_CONFLICT",
      currentVersion: 2,
      expectedVersion: 1,
      latestConversation: conversationFixture(metadata, [
        question,
      ]) as VersionedConversationResponseDto,
    };
    const onDirectTrigger = vi.fn().mockRejectedValue(conflict);
    renderViewer({
      onDirectTrigger,
      onSubmitRepositoryImportReply: vi.fn(),
    });

    const input = await typeAnswer();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(onDirectTrigger).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(input).toHaveAttribute("contenteditable", "true"),
    );
  });
});
