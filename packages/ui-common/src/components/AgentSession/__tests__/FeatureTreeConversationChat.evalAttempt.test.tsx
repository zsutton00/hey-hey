import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionDto } from "../../../api";
import { FeatureTreeConversationChat } from "../FeatureTreeConversationChat";

const mocks = vi.hoisted(() => ({
  reports: vi.fn(),
  lifecycle: vi.fn(),
  cli: vi.fn(),
}));
vi.mock("../../../data/hooks/useReports", () => ({
  useReports: mocks.reports,
}));
vi.mock("../useAgentRunLifecycle", () => ({
  useAgentRunLifecycle: mocks.lifecycle,
}));
vi.mock("../useLaunchRunOrchestration", () => ({
  useLaunchRunOrchestration: () => vi.fn(),
}));
vi.mock("../runtime/hooks/useCliRequired", () => ({
  useCliRequired: mocks.cli,
}));
vi.mock("../AgentConversationView", () => ({
  AgentConversationView: (props: {
    readOnly?: boolean;
    hideComposer?: boolean;
    conversationId: string;
  }) => (
    <div
      data-testid="conversation-history"
      data-conversation-id={props.conversationId}
      data-hide-composer={String(props.hideComposer ?? false)}
    >
      {props.readOnly ? "Read only history" : "Interactive"}
    </div>
  ),
}));

vi.mock("../useSurfaceSelection", () => ({
  useSurfaceSelection: () => ({ selection: null }),
}));
vi.mock("../useSurfaceCatalogNotice", () => ({
  useSurfaceCatalogNotice: () => null,
}));
vi.mock("../../../data/hooks/useCreateAgentSessionConversation", () => ({
  useCreateAgentSessionConversation: () => ({ mutate: vi.fn() }),
}));
vi.mock("../operations/useAgentSessionInteractionAccess", () => ({
  useAgentSessionInteractionAccess: () => ({ isDeviceEnabled: false }),
}));

const session = {
  id: "session",
  conversationId: "conversation",
  machineId: null,
  type: "PROJECT_CONVERSATION",
  status: "NOT_STARTED",
} as AgentSessionDto;
const attempt = {
  id: "attempt",
  payload: {
    reportType: "EVAL_ATTEMPT",
    targetSessionId: "session",
    status: "COMPLETED",
    completedAt: "2026-10-26T03:45:09Z",
    summary: {
      outputText: JSON.stringify({
        analysis: "Actual judged research answer",
        frame: { nodes: [] },
      }),
    },
  },
};
const renderSession = (
  machineId: string | null = null,
  conversationId: string | null = "conversation",
) =>
  render(
    <FeatureTreeConversationChat
      organizationId="org"
      projectId="project"
      agentSession={{ ...session, machineId, conversationId }}
    />,
  );

beforeEach(() => vi.clearAllMocks());
describe("eval attempt session navigation", () => {
  it.each([null, "execution-machine"])(
    "opens the target conversation read-only without launching or resolving CLI access (machine %s)",
    (machineId) => {
      mocks.reports.mockReturnValue({
        reports: [attempt],
        isFetched: true,
        error: null,
      });
      renderSession(machineId);
      const history = screen.getByTestId("conversation-history");
      expect(history).toHaveTextContent("Read only history");
      expect(history).toHaveAttribute("data-conversation-id", "conversation");
      expect(history).toHaveAttribute("data-hide-composer", "true");
      expect(
        screen.queryByText("Actual judged research answer"),
      ).not.toBeInTheDocument();
      expect(mocks.lifecycle).not.toHaveBeenCalled();
      expect(mocks.cli).not.toHaveBeenCalled();
      expect(mocks.reports).toHaveBeenCalledWith(
        "org",
        expect.objectContaining({
          projectId: "project",
          reportType: "EVAL_ATTEMPT",
          entityType: "AGENT_SESSION",
          entityId: "session",
        }),
      );
    },
  );
  it("never launches an eval attempt that has no conversation", () => {
    mocks.reports.mockReturnValue({
      reports: [attempt],
      isFetched: true,
      error: null,
    });
    renderSession("execution-machine", null);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "no saved conversation",
    );
    expect(mocks.lifecycle).not.toHaveBeenCalled();
    expect(mocks.cli).not.toHaveBeenCalled();
  });
  it("does not start a session while its eval relationship is loading", () => {
    mocks.reports.mockReturnValue({
      reports: [],
      isFetched: false,
      error: null,
    });
    renderSession();
    expect(mocks.lifecycle).not.toHaveBeenCalled();
  });
  it("keeps a failed relationship lookup visible without starting a run", () => {
    mocks.reports.mockReturnValue({
      reports: [],
      isFetched: true,
      error: new Error("unavailable"),
    });
    renderSession();
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to determine");
    expect(mocks.lifecycle).not.toHaveBeenCalled();
  });
  it("reads an ordinary unbound session without attempting execution", () => {
    mocks.reports.mockReturnValue({
      reports: [],
      isFetched: true,
      error: null,
    });
    renderSession();
    const history = screen.getByTestId("conversation-history");
    expect(history).toHaveTextContent("Read only history");
    expect(history).toHaveAttribute("data-hide-composer", "false");
    expect(mocks.lifecycle).not.toHaveBeenCalled();
  });
  it("keeps the normal runtime path for an ordinary machine-bound conversation", () => {
    mocks.reports.mockReturnValue({
      reports: [],
      isFetched: true,
      error: null,
    });
    mocks.cli.mockReturnValue({ type: "loading" });
    mocks.lifecycle.mockReturnValue({ runId: null });
    renderSession("execution-machine");
    expect(mocks.lifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSessionId: "session",
        agentSessionConversationId: "conversation",
      }),
    );
    expect(
      screen.queryByTestId("conversation-history"),
    ).not.toBeInTheDocument();
  });
});
