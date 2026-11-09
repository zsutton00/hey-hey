import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import i18n from "@hey-hey/ui-common/i18n";
import type { AgentSessionDto } from "@hey-hey/ui-common/api";
import LocalOnboardingPage from "./LocalOnboardingPage";

const organizationId = "ceb49be5-bd93-4f7e-a59b-58de0793a1c8";
const projectId = "cc354f44-b317-4d87-afcd-7caf6b4a170c";
const conversationId = "09663832-e014-4a98-b3bd-f8f32b888ab8";

const state = vi.hoisted(() => ({
  session: null as AgentSessionDto | null,
  conversationError: null as Error | null,
  sessionsError: null as Error | null,
  refetchConversation: vi.fn(),
  refetchSessions: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/components", async (original) => ({
  ...(await original<typeof import("@hey-hey/ui-common/components")>()),
  HeyHeyBranding: () => <span>Hey Hey</span>,
  Conversation: () => <div data-testid="conversation-timeline" />,
}));
vi.mock("../Onboarding/components/ProjectDetailsForm", () => ({
  ProjectDetailsForm: () => null,
}));
vi.mock("@hey-hey/ui-common/context", async (original) => ({
  ...(await original<typeof import("@hey-hey/ui-common/context")>()),
  useOrganization: () => ({ currentOrganization: { id: organizationId } }),
  usePageTracking: vi.fn(),
  TrackingProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@hey-hey/ui-common/data", async (original) => ({
  ...(await original<typeof import("@hey-hey/ui-common/data")>()),
  useProject: () => ({
    data: { id: projectId, organizationId, status: "ONBOARDING" },
    isFetched: true,
    refetch: vi.fn(),
  }),
  useConversationByWorkflow: () => ({
    data: state.conversationError
      ? null
      : { id: conversationId, workflowId: "workflow-1" },
    error: state.conversationError,
    refetch: state.refetchConversation,
  }),
  useAgentSessions: () => ({
    agentSessions: state.session ? [state.session] : [],
    isLoading: false,
    error: state.sessionsError,
    refetch: state.refetchSessions,
  }),
}));

vi.mock(
  "../../../../../packages/ui-common/src/data/hooks/useUserPairedMachines",
  () => ({
    useUserPairedMachines: () => ({
      machines: [],
      isReady: true,
      isFetched: true,
      isLoading: false,
      error: null,
    }),
  }),
);

const session = (status: AgentSessionDto["status"]): AgentSessionDto => ({
  id: "3dc3faeb-dbc4-45bf-97fe-dfd928750d71",
  organizationId,
  projectId,
  userId: "0ed78103-c072-4c97-8749-4740d456c403",
  conversationId,
  machineId: "d70c8dd6-ff8b-4a0d-827c-926dcaf06150",
  status,
  currentState: "IDLE",
  sessionDate: "2026-11-05T00:00:00Z",
  title: "Local onboarding",
  hasUnsyncedChanges: false,
  monitoringEnabled: true,
  autoDecide: false,
  type: "CODING",
  provider: "codex",
  config: {
    type: "CODING_SESSION",
    version: "v2",
    model: "selected-model",
    effort: "high",
  },
});

function Location() {
  const location = useLocation();
  return (
    <div data-testid="location">{`${location.pathname}${location.search}`}</div>
  );
}

const renderPage = () => render(<Page />);

const Page = () => (
  <QueryClientProvider client={new QueryClient()}>
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={createTheme()}>
        <MemoryRouter initialEntries={[`/projects/${projectId}/onboarding`]}>
          <Routes>
            <Route
              path="/projects/:projectId/onboarding"
              element={<LocalOnboardingPage />}
            />
            <Route path="/welcome" element={<Location />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </I18nextProvider>
  </QueryClientProvider>
);

beforeEach(() => {
  state.session = null;
  state.conversationError = null;
  state.sessionsError = null;
  state.refetchConversation = vi.fn(async () => {
    state.conversationError = null;
  });
  state.refetchSessions = vi.fn(async () => {
    state.sessionsError = null;
  });
});

afterEach(() => {
  cleanup();
});

describe("local onboarding page", () => {
  it("shows the running session with its saved runtime and no way to choose or start one", async () => {
    state.session = session("IN_PROGRESS");
    renderPage();

    const conversation = await screen.findByTestId("conversation-timeline");
    const model = screen.getByTestId("agent-session-metadata-model");
    expect(model).toHaveTextContent("selected-model");
    expect(
      conversation.compareDocumentPosition(model) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.queryByTestId("onboarding-model-provider-select"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("local-onboarding-launch"),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["no session", null],
    ["an unstarted session", session("NOT_STARTED")],
  ])("sends the person back to /welcome when there is %s", async (_, saved) => {
    state.session = saved;
    renderPage();

    expect(await screen.findByTestId("location")).toHaveTextContent(
      `/welcome?projectId=${projectId}`,
    );
  });

  it.each([
    ["conversation", "conversationError"],
    ["session list", "sessionsError"],
  ] as const)(
    "shows a failed %s read with a retry that recovers the running session",
    async (_, failingRead) => {
      state.session = session("IN_PROGRESS");
      state[failingRead] = new Error("Network request failed");
      const { rerender } = renderPage();

      const failure = await screen.findByTestId("local-onboarding-read-error");
      expect(failure).toHaveTextContent("Network request failed");
      expect(screen.queryByTestId("location")).not.toBeInTheDocument();

      await userEvent.click(screen.getByTestId("local-onboarding-read-retry"));
      rerender(<Page />);

      expect(
        await screen.findByTestId("conversation-timeline"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("local-onboarding-read-error"),
      ).not.toBeInTheDocument();
    },
  );
});
