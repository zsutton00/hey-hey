import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AgentSessionConfigEntityConversationV1TypeEnum,
  AgentSessionConfigEntityConversationV1VersionEnum,
  AgentSessionDtoProviderEnum,
  AgentSessionStatus,
  AgentSessionType,
  type AgentSessionDto,
} from "../../../api";
import type { AgentSessionMetadataValues } from "../AgentSessionMetadata";
import { CodingSession } from "../CodingSession";
import { SessionErrorAlert } from "../SessionErrorAlert";

let lifecycleError: string | null = "Failed to fetch";

const serviceQuery = vi.hoisted(() =>
  vi.fn(() => ({
    services: [
      { id: "api", name: "API" },
      { id: "web", name: "Web UI" },
    ],
  })),
);
vi.mock("../../../data/hooks/useServices", () => ({
  useServices: serviceQuery,
}));

vi.mock("../useAgentRunLifecycle", () => ({
  useAgentRunLifecycle: () => ({
    runId: null,
    hasSentInitialPrompt: false,
    error: lifecycleError,
    retryInit: vi.fn(),
    markInitialPromptSent: vi.fn(),
    stopRun: vi.fn(),
    stoppingRun: false,
  }),
}));

vi.mock("../useLaunchRunOrchestration", () => ({
  useLaunchRunOrchestration: () => ({
    startRun: vi.fn(),
    submitStartupPlanReview: vi.fn(),
    submitNodeDecision: vi.fn(),
  }),
}));

vi.mock("../../../data/hooks/useService", () => ({
  useService: () => ({ data: null, isLoading: false, error: null }),
}));

vi.mock("../../../data/hooks/useFullEntityContext", () => ({
  useFullEntityContext: () => ({
    data: null,
    isLoading: false,
    isFetching: false,
    isFetched: true,
    error: null,
  }),
}));

vi.mock("../../../data/hooks/usePlatformAdminAccess", () => ({
  usePlatformAdminAccess: () => ({ isPlatformAdmin: false, isResolved: true }),
}));

vi.mock("../runtime/coding/agent-bridge-telemetry", () => ({
  useAgentBridgeTelemetry: () => ({
    trackSubmitPromptTelemetry: vi.fn(),
    trackFollowupTelemetry: vi.fn(),
  }),
}));

vi.mock("../AgentConversationView", () => ({
  AgentConversationView: ({
    conversationId,
    hideComposer,
    onStopRun,
    actionsSlot,
    agentSessionMetadata,
  }: {
    conversationId: string;
    hideComposer?: boolean;
    onStopRun?: () => void;
    actionsSlot?: React.ReactNode;
    agentSessionMetadata?: AgentSessionMetadataValues;
  }) => (
    <div
      data-testid="agent-conversation-view"
      data-conversation-id={conversationId}
      data-hide-composer={hideComposer ? "true" : "false"}
      data-has-stop-run={onStopRun ? "true" : "false"}
      data-has-actions-slot={actionsSlot ? "true" : "false"}
      data-session-model={agentSessionMetadata?.model}
      data-session-effort={agentSessionMetadata?.effort}
      data-session-services={agentSessionMetadata?.serviceNames?.join(",")}
    >
      {hideComposer ? null : (
        <button data-testid="external-reply-composer-send">Send</button>
      )}
      {actionsSlot}
    </div>
  ),
}));

vi.mock("../TaskPreviewCard", () => ({
  TaskPreviewCard: ({ task }: { task: { id: string } }) => (
    <div data-testid="task-preview-card" data-task-id={task.id}>
      Task preview
    </div>
  ),
}));

vi.mock("../LocalRuntimeUnavailableAlert", () => ({
  LocalRuntimeUnavailableAlert: () => null,
}));

vi.mock("../../ActionsCapsule/CapsuleAction", () => ({
  CapsuleAction: ({ id, label }: { id: string; label: string }) => (
    <div data-testid={`capsule-action-${id}`}>{label}</div>
  ),
}));

const buildAgentSession = (
  overrides: Partial<AgentSessionDto> = {},
): AgentSessionDto => ({
  id: "agent-session-1",
  projectId: "proj-1",
  organizationId: "org-1",
  userId: "user-1",
  type: AgentSessionType.Coding,
  status: AgentSessionStatus.NotStarted,
  sessionDate: "2026-05-14T00:00:00Z",
  conversationId: "conv-1",
  createdAt: "2026-05-14T00:00:00Z",
  updatedAt: "2026-05-14T00:00:01Z",
  ...overrides,
});

const renderSession = (
  overrides: Partial<Parameters<typeof CodingSession>[0]> = {},
) => {
  return render(
    <CodingSession
      organizationId="org-1"
      agentSession={buildAgentSession()}
      projectId="proj-1"
      launchPlanId={null}
      launchStepId={null}
      launchStageId={null}
      taskData={null}
      planData={null}
      initiativeData={null}
      provider="codex"
      serviceId="svc-1"
      {...overrides}
    />,
  );
};

describe("CodingSession read-only render when CLI offline", () => {
  it("renders the conversation view in read-only mode when CLI is unavailable and a conversation exists", () => {
    lifecycleError = "Failed to fetch";

    renderSession();

    const view = screen.getByTestId("agent-conversation-view");
    expect(view).toBeInTheDocument();
    expect(view.getAttribute("data-hide-composer")).toBe("true");
    expect(view.getAttribute("data-has-stop-run")).toBe("false");
    expect(view.getAttribute("data-has-actions-slot")).toBe("false");
    expect(view.getAttribute("data-conversation-id")).toBe("conv-1");

    expect(
      screen.queryByTestId("external-reply-composer-send"),
    ).not.toBeInTheDocument();

    // Demoted: the launch-blocking "Local coding runtime unavailable" banner
    // is gone. The read-only branch still surfaces the conversation view;
    // missing-CLI guidance now lives on the start button via the platform's
    // useConversationCliStatus reading, not as a giant alert in the chat.
    expect(
      screen.queryByText(/Local coding runtime unavailable/i),
    ).not.toBeInTheDocument();

    expect(screen.queryByTestId("capsule-action-sync")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("capsule-action-review"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("capsule-action-commit"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("capsule-action-view-diffs"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("capsule-action-tools-used"),
    ).not.toBeInTheDocument();
  });

  it("keeps durable metadata on the read-only conversation view", () => {
    lifecycleError = "Failed to fetch";

    renderSession({
      agentSession: buildAgentSession({
        serviceIds: ["web", "api"],
        provider: AgentSessionDtoProviderEnum.Codex,
        config: {
          type: AgentSessionConfigEntityConversationV1TypeEnum.EntityConversation,
          version: AgentSessionConfigEntityConversationV1VersionEnum.V1,
          model: "gpt-5-codex",
          effort: "medium",
        },
      }),
    });

    const view = screen.getByTestId("agent-conversation-view");
    expect(view).toHaveAttribute("data-hide-composer", "true");
    expect(view).toHaveAttribute("data-session-model", "gpt-5-codex");
    expect(view).toHaveAttribute("data-session-effort", "medium");
    expect(view).toHaveAttribute("data-session-services", "Web UI,API");
    expect(serviceQuery).toHaveBeenCalledWith("org-1", {
      projectId: "proj-1",
      enabled: true,
    });
  });

  it("renders the TaskPreviewCard in the read-only branch when taskData is provided", () => {
    lifecycleError = "NetworkError when attempting to fetch resource.";

    renderSession({
      taskData: {
        id: "task-1",
        name: "Test task",
        projectId: "proj-1",
        organizationId: "org-1",
      } as unknown as Parameters<typeof CodingSession>[0]["taskData"],
    });

    expect(screen.getByTestId("task-preview-card")).toBeInTheDocument();
    expect(screen.getByTestId("agent-conversation-view")).toBeInTheDocument();
    // Demoted: the launch-blocking "Local coding runtime unavailable" banner
    // is gone. The read-only branch still surfaces the conversation view;
    // missing-CLI guidance now lives on the start button via the platform's
    // useConversationCliStatus reading, not as a giant alert in the chat.
    expect(
      screen.queryByText(/Local coding runtime unavailable/i),
    ).not.toBeInTheDocument();
  });

  it("preserves the parent null return when conversationId is empty even with the CLI offline", () => {
    lifecycleError = "Failed to fetch";

    const { container } = renderSession({
      agentSession: buildAgentSession({ conversationId: "" }),
    });

    expect(
      screen.queryByTestId("agent-conversation-view"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Local coding runtime unavailable/i),
    ).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("falls back to SessionErrorAlert when the error is not CLI-unavailable", () => {
    lifecycleError = "Unexpected server error: 500";

    renderSession();

    expect(
      screen.queryByTestId("agent-conversation-view"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Local coding runtime unavailable/i),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("hides only the current session failure and re-presents a changed failure", () => {
    const rendered = render(
      <SessionErrorAlert
        error="The first session failure."
        failureIdentity="failure-1"
        onDismiss={() => undefined}
      />,
    );

    fireEvent.click(screen.getByTestId("session-error-dismiss"));
    expect(screen.queryByTestId("session-error-alert")).not.toBeInTheDocument();

    rendered.rerender(
      <SessionErrorAlert
        error="The second session failure."
        failureIdentity="failure-2"
        onDismiss={() => undefined}
      />,
    );

    expect(screen.getByTestId("session-error-alert")).toHaveTextContent(
      "The second session failure.",
    );
  });
});
