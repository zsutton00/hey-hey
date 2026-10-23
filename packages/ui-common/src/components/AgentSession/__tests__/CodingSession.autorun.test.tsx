import { http, HttpResponse } from "msw";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ElementType, ReactNode } from "react";
import {
  AgentSessionConfigV2TypeEnum,
  AgentSessionCurrentState,
  AgentSessionDtoProviderEnum,
  AgentSessionStatus,
  AgentSessionType,
  ProjectModeFilesSchemaVersionEnum,
  ProjectModeSelectionSchemaVersionEnum,
  ProjectModeSnapshotSchemaVersionEnum,
  type AgentSessionConfigV2,
  type ContextRelatedEntityDto,
  type AgentSessionDto,
} from "../../../api";
import { apiClient } from "../../../clients/client";
import { CodingSession } from "../CodingSession";
import type { WorkItemResponseDto } from "../../../data/collections/workItems";

const submitPromptForRunMock = vi.hoisted(() => vi.fn());
const submitFollowupByTextMock = vi.hoisted(() => vi.fn());
const useSubmitFollowupByTextMock = vi.hoisted(() =>
  vi.fn(() => submitFollowupByTextMock),
);
const useFullEntityContextMock = vi.hoisted(() =>
  vi.fn(() => ({
    data: null,
    isLoading: false,
    isFetched: true,
    error: null,
    refetch: vi.fn(),
  })),
);
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("../operations/useAgentSessionInteractionAccess", () => ({
  useAgentSessionInteractionAccess: () => ({
    isDeviceEnabled: true,
    interactions: { startSession: vi.fn(), submitMessage: vi.fn() },
    unavailable: null,
  }),
  useAgentSessionInteractionAccessResolver: () => ({
    getAccess: () => ({
      isDeviceEnabled: true,
      interactions: { startSession: vi.fn(), submitMessage: vi.fn() },
      unavailable: null,
    }),
  }),
}));

vi.mock("../../../data/hooks/useFullEntityContext", () => ({
  useFullEntityContext: useFullEntityContextMock,
}));
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigateMock,
}));

vi.mock("../runtime/hooks/usePromptRunSubmission", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../runtime/hooks/usePromptRunSubmission")
  >()),
  submitPromptForRun: submitPromptForRunMock,
}));

// Stub registration so tests can inspect capsule actions without mounting the
// application-wide ActionsCapsule provider.
vi.mock("../../ActionsCapsule/CapsuleAction", () => ({
  CapsuleAction: ({
    disabled,
    id,
    label,
    onClick,
    behavior,
    menuItems,
    renderContent,
    icon: ActionIcon,
    feedback,
  }: {
    disabled?: boolean;
    id: string;
    label: string;
    onClick?: () => void;
    behavior?: "click" | "expand";
    menuItems?: Array<{ id: string; label: string }>;
    renderContent?: () => ReactNode;
    icon?: ElementType;
    feedback?: {
      reason: string;
      retryable: boolean;
      retry: () => void;
      isRetrying: boolean;
    };
  }) => (
    <div>
      <button
        data-testid={`capsule-action-${id}`}
        disabled={disabled}
        onClick={onClick}
      >
        {ActionIcon ? <ActionIcon data-testid={`capsule-icon-${id}`} /> : null}
        {label}
      </button>
      {feedback ? (
        <div data-testid="coding-session-action-feedback">
          <span>{feedback.reason}</span>
          {feedback.retryable ? (
            <button onClick={feedback.retry} disabled={feedback.isRetrying}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {behavior === "expand"
        ? menuItems?.map((item) => (
            <button key={item.id} data-testid={`capsule-menu-item-${item.id}`}>
              {item.label}
            </button>
          ))
        : null}
      {behavior === "expand" ? renderContent?.() : null}
    </div>
  ),
}));

vi.mock("../../SmarterTextAreaCard", () => ({
  SmarterTextAreaCard: () => (
    <textarea aria-label="Additional review instructions" />
  ),
}));

vi.mock("../FollowupActionModal", () => ({
  FollowupActionModal: ({
    open,
    surfaceId,
    onSubmit,
    title,
    submitLabel,
  }: {
    open: boolean;
    surfaceId: string;
    onSubmit: (submission: {
      additionalInstructions: undefined;
      provider: "codex";
      model: string;
      reasoningEffort: "medium";
      fastMode: boolean;
    }) => void;
    title: string;
    submitLabel: string;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <button
          onClick={() =>
            onSubmit({
              additionalInstructions: undefined,
              provider: "codex",
              model: "gpt-5.4",
              reasoningEffort: "medium",
              fastMode: surfaceId === "code-review",
            })
          }
        >
          {submitLabel}
        </button>
      </div>
    ) : null,
}));

let remoteChangedFilesCount: number | null = null;
let remoteChangedFilesError: string | null = null;

const autoRunLifecycleMock = vi.hoisted(() => ({
  hasSentInitialPrompt: true,
  dispatchStartRunWithMessage: vi.fn(),
  retryInit: vi.fn(),
  markInitialPromptSent: vi.fn(),
}));
const useAgentRunLifecycleMock = vi.hoisted(() =>
  vi.fn(() => ({
    runId: "run-1",
    hasSentInitialPrompt: autoRunLifecycleMock.hasSentInitialPrompt,
    error: null,
    errorCode: null,
    retryInit: autoRunLifecycleMock.retryInit,
    markInitialPromptSent: autoRunLifecycleMock.markInitialPromptSent,
    dispatchStartRunWithMessage:
      autoRunLifecycleMock.dispatchStartRunWithMessage,
    stopRun: vi.fn(),
    stoppingRun: false,
  })),
);
const changedFilesBoundaryMock = vi.hoisted(() => ({
  currentState: undefined as AgentSessionCurrentState | undefined,
  retryCount: vi.fn(),
  retryDiff: vi.fn(),
}));

vi.mock("../../../data/hooks/useAgentSessionCurrentState", () => ({
  getCanonicalAgentSessionCurrentState: () => undefined,
  useAgentSessionCurrentState: () => ({
    currentState: changedFilesBoundaryMock.currentState,
    revision: undefined,
    transitionedAt: undefined,
    isFetching: false,
  }),
}));

vi.mock("../runtime/hooks/useRemoteChangedFilesCount", () => ({
  useRemoteChangedFilesCount: () => ({
    status: remoteChangedFilesError
      ? "unavailable"
      : remoteChangedFilesCount === null
        ? "loading"
        : "success",
    count: remoteChangedFilesCount,
    error: remoteChangedFilesError,
    errorCode: null,
    retryable: true,
    failureIdentity: { reason: remoteChangedFilesError ?? "failure" },
    retry: changedFilesBoundaryMock.retryCount,
  }),
}));

vi.mock("../runtime/hooks/useRemoteChangedFilesInventory", () => ({
  useRemoteChangedFilesInventory: () => ({
    status: "success",
    entries: [
      {
        serviceId: "svc-1",
        repoPath: "/tmp/repository",
        filePath: "src/example.ts",
        status: "modify",
      },
    ],
    error: null,
    errorCode: null,
    retry: changedFilesBoundaryMock.retryDiff,
  }),
}));

vi.mock("../useAgentRunLifecycle", () => ({
  useAgentRunLifecycle: useAgentRunLifecycleMock,
}));

vi.mock("../useLaunchRunOrchestration", () => ({
  useLaunchRunOrchestration: () => ({
    startRun: vi.fn(),
    submitStartupPlanReview: vi.fn(),
    submitNodeDecision: vi.fn(),
  }),
}));

vi.mock("../useSubmitFollowupByText", () => ({
  useSubmitFollowupByText: useSubmitFollowupByTextMock,
}));

vi.mock("../../../data/hooks/useService", () => ({
  useService: () => ({ data: null, isLoading: false, error: null }),
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
    scrollable,
    scrollPolicy,
    agentSessionMetadata,
    onSubmitReply,
  }: {
    scrollable?: boolean;
    scrollPolicy?: { mode: string };
    agentSessionMetadata?: {
      provider: string;
      model: string;
      effort?: string;
    };
    onSubmitReply?: (text: string) => Promise<void>;
  }) => (
    <div
      data-testid="agent-conversation-view"
      data-scrollable={scrollable ? "true" : "false"}
      data-scroll-policy={scrollPolicy?.mode ?? ""}
      data-agent-session-provider={agentSessionMetadata?.provider ?? ""}
      data-agent-session-model={agentSessionMetadata?.model ?? ""}
      data-agent-session-effort={agentSessionMetadata?.effort ?? ""}
    >
      {scrollable ? <div data-testid="agent-conversation-scrollport" /> : null}
      <button onClick={() => void onSubmitReply?.("  review answer  ")}>
        Submit composer reply
      </button>
    </div>
  ),
}));

vi.mock("../OpenBrowserCapsuleAction", () => ({
  OpenBrowserCapsuleAction: () => null,
}));

vi.mock("../TaskPreviewCard", () => ({
  TaskPreviewCard: () => <div data-testid="task-preview-card" />,
}));

vi.mock("../LocalRuntimeUnavailableAlert", () => ({
  LocalRuntimeUnavailableAlert: () => null,
}));

const markStale = vi.fn();
vi.mock("../../../data/hooks/useAgentSession", () => ({
  useAgentSession: () => ({ markStale }),
}));

vi.mock("../../../data/hooks/useReports", () => ({
  useReports: () => ({ reports: [] }),
}));

vi.mock("../../../data/hooks/useServices", () => ({
  useServices: () => ({
    services: [{ id: "svc-1", name: "Example service" }],
    error: null,
    isFetched: true,
    isLoading: false,
  }),
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
  autoDecide: false,
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
      machineId="machine-1"
      {...overrides}
    />,
  );
};

afterEach(() => {
  remoteChangedFilesCount = null;
  remoteChangedFilesError = null;
  changedFilesBoundaryMock.currentState = undefined;
  changedFilesBoundaryMock.retryCount.mockReset();
  changedFilesBoundaryMock.retryDiff.mockReset();
  autoRunLifecycleMock.hasSentInitialPrompt = true;
  autoRunLifecycleMock.dispatchStartRunWithMessage.mockReset();
  autoRunLifecycleMock.retryInit.mockReset();
  autoRunLifecycleMock.markInitialPromptSent.mockReset();
  useAgentRunLifecycleMock.mockClear();
  submitPromptForRunMock.mockReset();
  submitFollowupByTextMock.mockReset();
  useSubmitFollowupByTextMock.mockClear();
  useFullEntityContextMock.mockReset();
  useFullEntityContextMock.mockReturnValue({
    data: null,
    isLoading: false,
    isFetched: true,
    error: null,
    refetch: vi.fn(),
  });
  navigateMock.mockReset();
});

describe("CodingSession run lifecycle wiring", () => {
  it("provides the platform client required by the lifecycle-owned stop operation", () => {
    renderSession();

    const lifecycleInput = useAgentRunLifecycleMock.mock.calls[0]?.[0];
    expect(lifecycleInput).toBeDefined();
    expect(lifecycleInput?.apiClient).toBe(apiClient);
  });

  it("routes a persisted project mode to project_mode after reload", () => {
    const projectModeConfig: AgentSessionConfigV2 = {
      type: AgentSessionConfigV2TypeEnum.CodingSession,
      version: "v2",
      model: "gpt-5",
      projectModeSelection: {
        schemaVersion:
          ProjectModeSelectionSchemaVersionEnum.ProjectModeSelectionV1,
        modeId: "mode-review",
      },
      projectModeSnapshot: {
        schemaVersion:
          ProjectModeSnapshotSchemaVersionEnum.ProjectModeSnapshotV1,
        modeId: "mode-review",
        catalogDescription: "Review mode",
        applicableWorkItemTypeKeys: ["STANDARD"],
        files: {
          schemaVersion: ProjectModeFilesSchemaVersionEnum.ProjectModeFilesV1,
          files: { "MODE.md": "Review the implementation carefully." },
        },
        snapshotHash: "snapshot-hash",
      },
    };

    renderSession({
      agentSession: buildAgentSession({
        config: projectModeConfig,
      }),
      taskData: {
        id: "task-1",
        name: "Task context",
        type: "STANDARD",
        organizationId: "org-1",
        projectId: "proj-1",
        status: "ACTIVE",
        sections: [
          {
            key: "description",
            materializedMarkdown: "Implement the selected project mode.",
          },
          {
            key: "acceptanceCriteria",
            materializedMarkdown: "The selected mode starts successfully.",
          },
        ],
      } as unknown as WorkItemResponseDto,
    });

    const lifecycleInput = useAgentRunLifecycleMock.mock.calls[0]?.[0];
    expect(lifecycleInput?.arm).toEqual({
      kind: "handler",
      promptType: "project_mode",
      payload: {
        entity: { entityType: "TASK", entityId: "task-1" },
        promptType: "project_mode",
        userMessage: "",
      },
    });
    expect(lifecycleInput?.config).toBe(projectModeConfig);
  });

  it("launches a project-defined work-item type that has no acceptance criteria", () => {
    renderSession({
      taskData: {
        id: "job-application-1",
        name: "Application to Acme",
        type: "JOB_APPLICATION_RECORD",
        organizationId: "org-1",
        projectId: "proj-1",
        status: "ACTIVE",
        sections: [
          {
            key: "description",
            materializedMarkdown: "Track the Acme application.",
          },
        ],
      } as unknown as WorkItemResponseDto,
    });

    expect(screen.queryByTestId("session-error-alert")).not.toBeInTheDocument();
    const lifecycleInput = useAgentRunLifecycleMock.mock.calls[0]?.[0];
    expect(lifecycleInput?.arm).toMatchObject({
      kind: "handler",
      promptType: "startup_session",
      payload: {
        entity: { entityType: "TASK", entityId: "job-application-1" },
      },
    });
    expect(lifecycleInput?.arm?.payload).not.toHaveProperty("startupInput");
  });

  it("launches a persisted project mode for a project-defined work-item type", () => {
    const projectModeConfig: AgentSessionConfigV2 = {
      type: AgentSessionConfigV2TypeEnum.CodingSession,
      version: "v2",
      model: "gpt-5",
      projectModeSelection: {
        schemaVersion:
          ProjectModeSelectionSchemaVersionEnum.ProjectModeSelectionV1,
        modeId: "mode-review",
      },
      projectModeSnapshot: {
        schemaVersion:
          ProjectModeSnapshotSchemaVersionEnum.ProjectModeSnapshotV1,
        modeId: "mode-review",
        catalogDescription: "Review mode",
        applicableWorkItemTypeKeys: ["JOB_APPLICATION_RECORD"],
        files: {
          schemaVersion: ProjectModeFilesSchemaVersionEnum.ProjectModeFilesV1,
          files: { "MODE.md": "Review the application carefully." },
        },
        snapshotHash: "snapshot-hash",
      },
    };

    renderSession({
      agentSession: buildAgentSession({ config: projectModeConfig }),
      taskData: {
        id: "job-application-1",
        name: "Application to Acme",
        type: "JOB_APPLICATION_RECORD",
        organizationId: "org-1",
        projectId: "proj-1",
        status: "ACTIVE",
        sections: [
          {
            key: "description",
            materializedMarkdown: "Track the Acme application.",
          },
        ],
      } as unknown as WorkItemResponseDto,
    });

    expect(screen.queryByTestId("session-error-alert")).not.toBeInTheDocument();
    const lifecycleInput = useAgentRunLifecycleMock.mock.calls[0]?.[0];
    expect(lifecycleInput?.arm).toEqual({
      kind: "handler",
      promptType: "project_mode",
      payload: {
        entity: { entityType: "TASK", entityId: "job-application-1" },
        promptType: "project_mode",
        userMessage: "",
      },
    });
  });

  it("shows a captured-mode error and skips dispatch when the snapshot is missing", () => {
    autoRunLifecycleMock.hasSentInitialPrompt = false;

    renderSession({
      initialPromptDraft: "Review the implementation.",
      agentSession: buildAgentSession({
        config: {
          type: AgentSessionConfigV2TypeEnum.CodingSession,
          version: "v2",
          model: "gpt-5",
          projectModeSelection: {
            schemaVersion:
              ProjectModeSelectionSchemaVersionEnum.ProjectModeSelectionV1,
            modeId: "mode-review",
          },
        },
      }),
      taskData: {
        id: "task-1",
        name: "Task context",
        type: "STANDARD",
        organizationId: "org-1",
        projectId: "proj-1",
        status: "ACTIVE",
        sections: [
          {
            key: "description",
            materializedMarkdown: "Implement the selected project mode.",
          },
          {
            key: "acceptanceCriteria",
            materializedMarkdown: "The selected mode starts successfully.",
          },
        ],
      } as unknown as WorkItemResponseDto,
    });

    expect(screen.getByTestId("session-error-alert")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Cannot start project mode: the captured selection and snapshot are missing or incomplete.",
      ),
    ).toBeInTheDocument();
    expect(
      autoRunLifecycleMock.dispatchStartRunWithMessage,
    ).not.toHaveBeenCalled();
  });
});

describe("CodingSession changed-file refresh boundary", () => {
  it("requests the count again when the conversation returns to idle", () => {
    changedFilesBoundaryMock.currentState = AgentSessionCurrentState.Thinking;
    const { rerender } = renderSession({
      agentSession: buildAgentSession({
        status: AgentSessionStatus.InProgress,
        serviceIds: ["svc-1"],
      }),
    });

    expect(changedFilesBoundaryMock.retryCount).not.toHaveBeenCalled();

    changedFilesBoundaryMock.currentState = AgentSessionCurrentState.Idle;
    rerender(
      <CodingSession
        organizationId="org-1"
        agentSession={buildAgentSession({
          status: AgentSessionStatus.InProgress,
          serviceIds: ["svc-1"],
        })}
        projectId="proj-1"
        launchPlanId={null}
        launchStepId={null}
        launchStageId={null}
        taskData={null}
        planData={null}
        initiativeData={null}
        provider="codex"
        serviceId="svc-1"
      />,
    );

    expect(changedFilesBoundaryMock.retryCount).toHaveBeenCalledOnce();
    expect(changedFilesBoundaryMock.retryDiff).not.toHaveBeenCalled();
  });
});

describe("CodingSession Task Monitor navigation", () => {
  it("lists every graph-matched monitor and routes through its work-item path", async () => {
    const monitorA = "11111111-1111-4111-8111-111111111111";
    const monitorB = "22222222-2222-4222-8222-222222222222";
    const relatedEntities = [
      {
        entityId: monitorA,
        entityType: "TASK",
        displayName: "Release monitor",
        relationship: "related-to",
        source: "agent",
        taskType: "TASK_MONITOR",
      },
      {
        entityId: monitorB,
        entityType: "TASK",
        displayName: "Hotfix monitor",
        relationship: "related-to",
        source: "agent",
        taskType: "TASK_MONITOR",
      },
    ] as ContextRelatedEntityDto[];
    useFullEntityContextMock.mockReturnValue({
      data: { relatedEntities } as never,
      isLoading: false,
      isFetched: true,
      error: null,
      refetch: vi.fn(),
    });

    renderSession({
      taskData: {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Selected task",
        type: "STANDARD",
        organizationId: "org-1",
        projectId: "proj-1",
        status: "ACTIVE",
        sections: [
          {
            key: "description",
            materializedMarkdown: "Monitor the selected task.",
          },
          {
            key: "acceptanceCriteria",
            materializedMarkdown: "The task monitor is visible.",
          },
        ],
      } as unknown as WorkItemResponseDto,
    });

    expect(
      screen.getByTestId("capsule-action-task-monitor-context"),
    ).toHaveTextContent("Task Monitors");
    expect(
      screen.getByTestId(`capsule-menu-item-${monitorA}`),
    ).toHaveTextContent("Release monitor");
    expect(
      screen.getByTestId(`capsule-menu-item-${monitorB}`),
    ).toHaveTextContent("Hotfix monitor");

    await userEvent
      .setup()
      .click(screen.getByTestId(`coding-session-task-monitor-${monitorB}`));
    expect(navigateMock).toHaveBeenCalledWith(
      `/projects/proj-1/tasks/${monitorB}`,
    );
  });
});

describe("CodingSession Review action", () => {
  it("opens the changed-file diff modal from the authoritative remote count", async () => {
    remoteChangedFilesCount = 1;
    const user = userEvent.setup();

    renderSession({
      agentSession: buildAgentSession({
        status: AgentSessionStatus.InProgress,
        serviceIds: ["svc-1"],
      }),
      serviceId: "svc-1",
    });

    await user.click(screen.getByTestId("capsule-action-view-diffs"));
    expect(screen.getByTestId("collated-file-diff-modal")).toBeVisible();
  });

  it("keeps Files clickable and presents unavailable feedback at the action", async () => {
    remoteChangedFilesError =
      "The selected machine is not ready for controller-authorized work.";
    const user = userEvent.setup();

    renderSession({
      agentSession: buildAgentSession({
        status: AgentSessionStatus.InProgress,
        serviceIds: ["svc-1"],
      }),
      serviceId: "svc-1",
    });

    const action = screen.getByTestId("capsule-action-view-diffs");
    expect(action).toBeEnabled();
    expect(action).toHaveTextContent("Files");
    expect(screen.getByTestId("capsule-icon-view-diffs")).toBeInTheDocument();

    await user.click(action);

    expect(
      screen.getByTestId("coding-session-action-feedback"),
    ).toHaveTextContent(
      "The selected machine is not ready for controller-authorized work.",
    );
    expect(
      screen.queryByTestId("collated-file-diff-modal"),
    ).not.toBeInTheDocument();
  });

  it("keeps Review failures on the initiating action and retries the same submission", async () => {
    submitPromptForRunMock
      .mockResolvedValueOnce({
        ok: false,
        error: "The review service is unavailable.",
        telemetry: { agentInvocation: null },
      })
      .mockResolvedValueOnce({
        ok: true,
        telemetry: { agentInvocation: null },
      });
    const user = userEvent.setup();

    renderSession();
    await user.click(screen.getByTestId("capsule-action-review"));
    await user.click(
      within(screen.getByRole("dialog", { name: "Code Review" })).getByRole(
        "button",
        { name: "Review" },
      ),
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("coding-session-action-feedback"),
      ).toHaveTextContent("The review service is unavailable."),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(
      within(screen.getByTestId("coding-session-action-feedback")).getByRole(
        "button",
        { name: "Retry" },
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId("coding-session-action-feedback"),
      ).not.toBeInTheDocument(),
    );
    expect(submitPromptForRunMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      label: "missing changed-file telemetry and selected-service data",
      status: AgentSessionStatus.NotStarted,
      telemetry: null,
      serviceId: "",
      serviceIds: undefined,
    },
    {
      label: "a zero changed-file count and empty selected-service data",
      status: AgentSessionStatus.InProgress,
      telemetry: { changedFilesCount: 0 },
      serviceId: "",
      serviceIds: [],
    },
    {
      label: "a missing changed-file count in a completed session",
      status: AgentSessionStatus.Completed,
      telemetry: { changedFilesCount: null },
      serviceId: "svc-1",
      serviceIds: ["svc-1"],
    },
    {
      label: "an errored session",
      status: AgentSessionStatus.Errored,
      telemetry: { changedFilesCount: 0 },
      serviceId: "svc-1",
      serviceIds: ["svc-1"],
    },
  ])(
    "keeps Review enabled with $label",
    ({ status, telemetry, serviceId, serviceIds }) => {
      remoteChangedFilesCount = telemetry?.changedFilesCount ?? null;

      renderSession({
        agentSession: buildAgentSession({ status, serviceIds }),
        serviceId,
      });

      expect(screen.getByTestId("capsule-action-review")).toBeEnabled();
    },
  );

  it("opens the review instructions modal and submits the existing code-review prompt flow", async () => {
    submitPromptForRunMock.mockResolvedValue({
      ok: true,
      telemetry: { agentInvocation: null },
    });
    const user = userEvent.setup();
    renderSession({
      agentSession: buildAgentSession({ serviceIds: [] }),
      serviceId: "",
    });

    await user.click(screen.getByTestId("capsule-action-review"));

    expect(
      screen.getByRole("dialog", { name: "Code Review" }),
    ).toBeInTheDocument();

    await user.click(
      within(screen.getByRole("dialog", { name: "Code Review" })).getByRole(
        "button",
        { name: "Review" },
      ),
    );

    await waitFor(() => {
      expect(submitPromptForRunMock).toHaveBeenCalledOnce();
    });
    const submission = submitPromptForRunMock.mock.calls[0]?.[0];
    expect(submission.localPromptType).toBe("code_review");
    expect(submission.promptDraft).toBe("");
    expect(submission.run.runId).toBe("run-1");
    expect(submission.agentOverride.fastMode).toBe(true);
  });

  it("forwards explicit disabled Fast mode through the Commit handler", async () => {
    remoteChangedFilesCount = 1;
    submitPromptForRunMock.mockResolvedValue({
      ok: true,
      telemetry: { agentInvocation: null },
    });
    const user = userEvent.setup();
    renderSession();

    await user.click(screen.getByTestId("capsule-action-commit"));
    await user.click(
      within(screen.getByRole("dialog", { name: "Commit Changes" })).getByRole(
        "button",
        { name: "Commit" },
      ),
    );

    await waitFor(() => {
      expect(submitPromptForRunMock).toHaveBeenCalledOnce();
    });
    const submission = submitPromptForRunMock.mock.calls[0]?.[0];
    expect(submission.localPromptType).toBe("commit");
    expect(submission.agentOverride.fastMode).toBe(false);
  });

  it("does not retry a failed commit after changed-file access becomes unavailable", async () => {
    remoteChangedFilesCount = 1;
    submitPromptForRunMock.mockResolvedValueOnce({
      ok: false,
      error: "The commit service is unavailable.",
      telemetry: { agentInvocation: null },
    });
    const user = userEvent.setup();
    const rendered = renderSession();

    await user.click(screen.getByTestId("capsule-action-commit"));
    await user.click(
      within(screen.getByRole("dialog", { name: "Commit Changes" })).getByRole(
        "button",
        { name: "Commit" },
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("coding-session-action-feedback"),
      ).toHaveTextContent("The commit service is unavailable."),
    );
    expect(submitPromptForRunMock).toHaveBeenCalledOnce();

    remoteChangedFilesCount = null;
    remoteChangedFilesError = "The protected changed-file read is unavailable.";
    rendered.rerender(
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
        machineId="machine-1"
      />,
    );

    const commitActionContainer = screen.getByTestId(
      "capsule-action-commit",
    ).parentElement;
    if (!commitActionContainer)
      throw new Error("Missing commit action container");
    const feedback = within(commitActionContainer).getByTestId(
      "coding-session-action-feedback",
    );
    expect(feedback).toHaveTextContent(
      "The protected changed-file read is unavailable.",
    );
    expect(
      within(feedback).queryByRole("button", { name: "Retry" }),
    ).toBeNull();
    expect(submitPromptForRunMock).toHaveBeenCalledOnce();
  });
});

describe("CodingSession Auto-run toggle", () => {
  it("keeps session chrome in normal page flow", () => {
    renderSession();

    expect(screen.getByTestId("coding-session")).toBeInTheDocument();
    expect(
      screen.queryByTestId("coding-session-metadata"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("coding-session-conversation-region"),
    ).toContainElement(screen.getByTestId("agent-conversation-view"));
    expect(screen.getByTestId("agent-conversation-view")).toHaveAttribute(
      "data-scrollable",
      "false",
    );
    expect(screen.getByTestId("agent-conversation-view")).toHaveAttribute(
      "data-scroll-policy",
      "",
    );
    expect(
      screen.queryByTestId("agent-conversation-scrollport"),
    ).not.toBeInTheDocument();
  });

  it("passes the caller-owned scroll policy without enabling the legacy scrollport", () => {
    const ownerRef = { current: null };

    renderSession({
      scrollPolicy: { mode: "owned", ownerRef },
      taskContextStickyTop: "50px",
    });

    const conversation = screen.getByTestId("agent-conversation-view");
    expect(conversation).toHaveAttribute("data-scrollable", "false");
    expect(conversation).toHaveAttribute("data-scroll-policy", "owned");
    expect(
      screen.queryByTestId("coding-session-task-context"),
    ).not.toBeInTheDocument();
  });

  it("keeps task context sticky without adding a sticky region to taskless sessions", () => {
    renderSession({
      taskData: {
        id: "task-1",
        name: "Task context",
        type: "STANDARD",
        projectId: "proj-1",
        organizationId: "org-1",
        sections: [
          {
            key: "description",
            materializedMarkdown: "Keep task context visible.",
          },
          {
            key: "acceptanceCriteria",
            materializedMarkdown: "Task context is sticky.",
          },
        ],
      } as unknown as Parameters<typeof CodingSession>[0]["taskData"],
      taskContextStickyTop: "50px",
    });

    const taskContext = screen.getByTestId("coding-session-task-context");
    expect(taskContext).toHaveStyle({
      position: "sticky",
      top: "50px",
      paddingBottom: "8px",
    });
    expect(screen.getByTestId("task-preview-card")).toBeInTheDocument();
  });

  it("passes provider and model to the shared bottom metadata", () => {
    renderSession({
      agentSession: buildAgentSession({
        provider: AgentSessionDtoProviderEnum.Codex,
        config: {
          type: AgentSessionConfigV2TypeEnum.CodingSession,
          model: "gpt-5",
          worktree: "feature/fast-mode",
        },
      }),
    });

    expect(
      screen.queryByTestId("coding-session-metadata"),
    ).not.toBeInTheDocument();
    const conversation = screen.getByTestId("agent-conversation-view");
    expect(conversation).toHaveAttribute(
      "data-agent-session-provider",
      "codex",
    );
    expect(conversation).toHaveAttribute("data-agent-session-model", "gpt-5");
  });

  it("owns the text-level composer adapter for a Plan workflow session", async () => {
    const user = userEvent.setup();
    renderSession({
      agentSession: buildAgentSession({
        config: {
          type: AgentSessionConfigV2TypeEnum.CodingSession,
          method: "plan",
        },
      }),
    });

    expect(useSubmitFollowupByTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        interactionAccess: expect.objectContaining({
          isDeviceEnabled: true,
        }),
        conversationId: "conv-1",
        sessionMethod: expect.objectContaining({ method: "plan" }),
      }),
    );

    await user.click(
      screen.getByRole("button", { name: "Submit composer reply" }),
    );
    expect(submitFollowupByTextMock).toHaveBeenCalledWith({
      promptText: "  review answer  ",
      skillSelection: undefined,
      attachments: [],
      clearDraftOnSuccess: false,
      actionName: "submitFollowupPrompt",
      followupAction: null,
    });
  });
});

describe("CodingSession deferred initial dispatch", () => {
  it("retains the unchanged prompt and attachments across a failed launch and retry, then clears after acceptance", async () => {
    autoRunLifecycleMock.hasSentInitialPrompt = false;
    autoRunLifecycleMock.dispatchStartRunWithMessage
      .mockResolvedValueOnce({
        ok: false,
        error: "CLI disconnected (Type: RETRYABLE)",
      })
      .mockResolvedValueOnce({ ok: true, dispatched: true });
    const attachments = [
      {
        attachmentId: "f7a198de-03a6-47aa-b0bf-830cde418ddb",
        fileName: "notes.txt",
      },
    ];
    const onAccepted = vi.fn();
    renderSession({
      initialPromptDraft: "  unchanged prompt\n",
      initialPromptAttachments: attachments,
      onInitialPromptAccepted: onAccepted,
    });
    await waitFor(() =>
      expect(screen.getByTestId("session-error-alert")).toHaveTextContent(
        "CLI disconnected",
      ),
    );
    expect(onAccepted).not.toHaveBeenCalled();
    expect(
      autoRunLifecycleMock.dispatchStartRunWithMessage,
    ).toHaveBeenLastCalledWith(
      { role: "USER" },
      "  unchanged prompt\n",
      undefined,
      attachments,
    );
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(onAccepted).toHaveBeenCalledOnce());
    expect(
      autoRunLifecycleMock.dispatchStartRunWithMessage,
    ).toHaveBeenCalledTimes(2);
    expect(
      autoRunLifecycleMock.dispatchStartRunWithMessage,
    ).toHaveBeenLastCalledWith(
      { role: "USER" },
      "  unchanged prompt\n",
      undefined,
      attachments,
    );
  });

  it("stops after a missing-machine failure instead of retrying on every render", async () => {
    autoRunLifecycleMock.hasSentInitialPrompt = false;
    autoRunLifecycleMock.dispatchStartRunWithMessage.mockResolvedValue({
      ok: false,
      error: "Select an execution-ready machine before starting local work.",
      code: "MACHINE_NOT_READY",
    });

    renderSession({ initialPromptDraft: "start local work" });

    await waitFor(() => {
      expect(
        autoRunLifecycleMock.dispatchStartRunWithMessage,
      ).toHaveBeenCalledOnce();
    });
    expect(
      screen.getByText(
        "Select an execution-ready machine before starting local work.",
      ),
    ).toBeInTheDocument();
  });
});

beforeEach(() => {
  globalThis.mswServer.use(
    http.get("*/api/v1/organizations/org-1/projects/proj-1/messages", () =>
      HttpResponse.json({ success: true, data: [] }),
    ),
  );
});
