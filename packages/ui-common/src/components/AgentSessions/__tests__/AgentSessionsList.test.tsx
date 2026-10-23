import { BrowserRouter } from "react-router-dom";
import { Provider, createStore } from "jotai";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  AgentSessionCurrentState,
  AgentSessionOutputAttentionState,
  AgentSessionStatus,
  AgentSessionType,
  ConversationPhase,
  type AgentSessionDto,
} from "../../../api";
import { conversationPhaseByIdAtom } from "../../../data/websockets/conversationPhase";
import { AgentSessionsList } from "../AgentSessionsList";

const useAgentSessionsMock = vi.hoisted(() => vi.fn());
const useUserIdentityMock = vi.hoisted(() => vi.fn());

vi.mock("../../../data/hooks/useAgentSessions", () => ({
  useAgentSessions: useAgentSessionsMock,
}));

vi.mock("../../../hooks/useUserIdentity", () => ({
  useUserIdentity: useUserIdentityMock,
}));

vi.mock("../../../contexts", () => ({
  usePathService: () => ({
    agentSession: ({
      projectId,
      agentSessionId,
    }: {
      projectId: string;
      agentSessionId: string;
    }) => `/projects/${projectId}/sessions/${agentSessionId}`,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

beforeAll(() => {
  useUserIdentityMock.mockReturnValue({
    userId: "user-1",
    email: "user@example.com",
    name: "User",
    currentOrgId: "org-1",
    orgMemberships: [],
    isDevAdmin: false,
    devAdminMode: false,
    isTokenExpired: false,
    currentOrgRole: null,
  });

  if (!global.ResizeObserver) {
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }

  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  }
});

const createSession = (
  currentState: AgentSessionCurrentState,
): AgentSessionDto => ({
  id: "session-1",
  organizationId: "org-1",
  projectId: "project-1",
  userId: "user-1",
  status: AgentSessionStatus.InProgress,
  currentState,
  conversationId: "conversation-1",
  sessionDate: "2026-08-12T00:00:00.000Z",
  title: "Agent session",
  hasUnsyncedChanges: false,
  monitoringEnabled: false,
  autoDecide: false,
  type: AgentSessionType.Coding,
});

const outputAttentionById = {
  "session-1": {
    state: AgentSessionOutputAttentionState.MessageReady,
    revision: 2,
  },
};

const renderList = (
  currentState: AgentSessionCurrentState,
  phase: ConversationPhase = ConversationPhase.Reviewing,
  onSessionClick?: (session: AgentSessionDto) => void,
) => {
  const store = createStore();
  store.set(conversationPhaseByIdAtom, {
    "conversation-1": {
      phase,
      revision: 1,
      transitionedAt: "2026-08-27T00:00:00.000Z",
    },
  });
  useAgentSessionsMock.mockReturnValue({
    agentSessions: [createSession(currentState)],
    outputAttentionById,
    isLoading: false,
    remove: vi.fn(),
  });

  return render(
    <Provider store={store}>
      <BrowserRouter>
        <AgentSessionsList
          organizationId="org-1"
          projectId="project-1"
          onSessionClick={onSessionClick}
        />
      </BrowserRouter>
    </Provider>,
  );
};

describe("AgentSessionsList row signals", () => {
  it("filters to the signed-in user by default and can show all sessions", async () => {
    const user = userEvent.setup();
    renderList(AgentSessionCurrentState.Idle);

    expect(useAgentSessionsMock).toHaveBeenLastCalledWith(
      "org-1",
      "project-1",
      expect.objectContaining({ enabled: true, userId: "user-1" }),
    );

    await user.click(screen.getByRole("combobox", { name: "User" }));
    await user.click(screen.getByRole("option", { name: "All" }));

    expect(useAgentSessionsMock).toHaveBeenLastCalledWith(
      "org-1",
      "project-1",
      expect.objectContaining({ enabled: true, userId: undefined }),
    );
  });

  it("keeps lifecycle status and deletion alongside the current-state signal", () => {
    renderList(AgentSessionCurrentState.Thinking, ConversationPhase.Idle);

    expect(
      screen.getByTestId("agent-session-current-state-indicator"),
    ).toHaveAttribute("aria-label", "Thinking");
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it.each([
    AgentSessionCurrentState.Starting,
    AgentSessionCurrentState.Thinking,
    AgentSessionCurrentState.Writing,
    AgentSessionCurrentState.AwaitingApproval,
  ])("keeps canonical %s alongside independent attention", (currentState) => {
    renderList(currentState, ConversationPhase.Reviewing);

    expect(
      screen.queryByTestId("conversation-phase-indicator"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("agent-session-current-state-indicator"),
    ).toHaveAttribute("data-current-state", currentState);
    expect(
      screen.getByTestId("agent-session-output-attention-indicator"),
    ).toBeInTheDocument();
  });

  it("shows current state and attention when conversation phase is idle", () => {
    renderList(AgentSessionCurrentState.Thinking, ConversationPhase.Idle);

    expect(
      screen.queryByTestId("conversation-phase-indicator"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("agent-session-current-state-indicator")).toHaveAttribute(
      "data-current-state",
      AgentSessionCurrentState.Thinking,
    );
    expect(
      screen.getByTestId("agent-session-output-attention-indicator"),
    ).toBeInTheDocument();
  });

  it("uses REVIEWING as a fallback while canonical state is IDLE", () => {
    renderList(AgentSessionCurrentState.Idle, ConversationPhase.Reviewing);

    expect(screen.getByTestId("conversation-phase-indicator")).toHaveAttribute(
      "data-phase",
      ConversationPhase.Reviewing,
    );
    expect(
      screen.queryByTestId("agent-session-current-state-indicator"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("agent-session-output-attention-indicator"),
    ).toBeInTheDocument();
  });

  it("keeps active current state after opening acknowledges attention", () => {
    const onSessionClick = vi.fn();
    const result = renderList(
      AgentSessionCurrentState.Thinking,
      ConversationPhase.Thinking,
      onSessionClick,
    );

    expect(
      screen.getByTestId("agent-session-current-state-indicator"),
    ).toHaveAttribute("data-current-state", AgentSessionCurrentState.Thinking);
    expect(
      screen.getByTestId("agent-session-output-attention-indicator"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /Agent session/i }));
    expect(onSessionClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: "session-1" }),
    );

    useAgentSessionsMock.mockReturnValue({
      agentSessions: [createSession(AgentSessionCurrentState.Thinking)],
      outputAttentionById: {},
      isLoading: false,
      remove: vi.fn(),
    });
    result.rerender(
      <Provider store={createStore()}>
        <BrowserRouter>
          <AgentSessionsList
            organizationId="org-1"
            projectId="project-1"
            onSessionClick={onSessionClick}
          />
        </BrowserRouter>
      </Provider>,
    );

    expect(
      screen.getByTestId("agent-session-current-state-indicator"),
    ).toHaveAttribute("data-current-state", AgentSessionCurrentState.Thinking);
    expect(
      screen.queryByTestId("agent-session-output-attention-indicator"),
    ).not.toBeInTheDocument();
  });

  it("renders the unacknowledged readiness signal when state is IDLE", () => {
    renderList(AgentSessionCurrentState.Idle, ConversationPhase.Idle);

    expect(
      screen.queryByTestId("agent-session-current-state-indicator"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("agent-session-output-attention-indicator"),
    ).toBeInTheDocument();
  });
});
