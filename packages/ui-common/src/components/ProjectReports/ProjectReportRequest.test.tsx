import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MachineDto,
  ProjectReportPreviewDto,
  ProjectReportPreviewRow,
  ProjectReportRequestDto,
} from "../../api";

const client = vi.hoisted(() => ({
  previewProjectReportRequest: vi.fn(),
  createProjectReportRequest: vi.fn(),
  getProjectReportRequest: vi.fn(),
  retryProjectReportRequest: vi.fn(),
}));
const launchClient = vi.hoisted(() => ({
  startSession: vi.fn(),
  getAccess: vi.fn(),
}));
const servicesState = vi.hoisted(() => ({
  services: [
    { id: "service-a", name: "App", projectId: "p", status: "ACTIVE" },
    { id: "service-b", name: "API", projectId: "p", status: "ACTIVE" },
  ],
  isLoading: false,
  isReady: true,
  error: null as Error | null,
}));
vi.mock("../../data/hooks/useServices", () => ({
  useServices: () => servicesState,
}));
vi.mock("../AgentSession/operations/useAgentSessionInteractionAccess", () => ({
  useAgentSessionInteractionAccessResolver: () => ({
    getAccess: launchClient.getAccess,
  }),
}));

const machineState = vi.hoisted(() => ({
  value: {
    machines: [] as MachineDto[],
    executionReadyMachines: [] as MachineDto[],
    isReady: true,
    mode: "one" as "zero" | "one" | "many",
    selectedMachine: null as MachineDto | null,
    setSelectedMachineId: vi.fn(),
  },
}));

vi.mock("../../clients/serviceClients", () => ({ projectReportsClient: client }));
vi.mock("../AgentSession/runtime/coding/useMachineResolution", () => ({
  useMachineResolution: () => machineState.value,
}));
vi.mock("../AgentSession/RuntimeModelSelector", () => ({
  RuntimeModelSelector: ({
    model,
    fastMode,
    onModelChange,
    onFastModeChange,
  }: {
    model: string;
    fastMode: boolean;
    onModelChange: (model: string) => void;
    onFastModeChange: (fastMode: boolean) => void;
  }) => (
    <div
      data-testid="model-selector-stub"
      data-model={model}
      data-fast-mode={String(fastMode)}
    >
      <button onClick={() => onModelChange("sonnet")}>Use Sonnet</button>
      <button onClick={() => onFastModeChange(true)}>Use Fast mode</button>
    </div>
  ),
}));
vi.mock("../AgentSession/MachinePicker", () => ({
  MachinePicker: () => <div data-testid="machine-picker" />,
}));
vi.mock("../AgentSession/AgentBridgeRecoveryNotice", () => ({
  AgentBridgeRecoveryNotice: ({ testId }: { testId: string }) => (
    <div data-testid={testId} />
  ),
}));
vi.mock("../AgentSession/surfaceSelectionMemory", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readSurfaceSelection: () => ({
    provider: "claude",
    model: "opus",
    reasoningEffort: "medium",
    fastMode: false,
  }),
  writeSurfaceSelection: () => undefined,
}));

import {
  AuthorizationProtocolVersion,
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
} from "../../api";
import { ProjectReportRequest } from "./ProjectReportRequest";

const machine: MachineDto = {
  machineId: "machine-1",
  name: "Laptop",
  pairedAt: "2026-08-13T00:00:00.000Z",
  active: true,
  authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_2,
  executionReadiness: MachineExecutionReadinessState.Ready,
  currentControllerEligibility:
    CurrentControllerMachineEligibilityState.Eligible,
  bindings: [],
};

const row = (id: string): ProjectReportPreviewRow => ({
  subject: { entityType: "TASK", entityId: id },
  title: `Task ${id}`,
  matchingActivityCount: 2,
  explanation: "Updated twice in this period",
  excluded: false,
});

const preview = (
  excluded = 0,
  rows = [row("a"), row("b")]
): ProjectReportPreviewDto => ({
  subjects: rows,
  matchingSubjectCount: 12,
  includedSubjectCount: 12 - excluded,
  excludedSubjectCount: excluded,
  displayedSubjectCount: 12,
  queriedAt: "2026-09-27T19:30:00.000Z",
});

const requestDto = (
  status: ProjectReportRequestDto["status"],
  extra: object = {}
) =>
  ({
    id: "req-1",
    createdAt: "2026-10-05T05:34:08.000Z",
    organizationId: "org",
    projectId: "p",
    submission: {
      launch: {
        machineId: "machine-1",
        provider: "claude",
        model: "opus",
        effort: "medium",
        fastMode: false,
      },
    },
    status,
    attempts: [
      {
        id: "attempt-1",
        agentSessionId: "session-1",
        conversationId: "conversation-1",
        attemptNumber: 1,
        status,
        idempotencyKey: "k",
        createdAt: "x",
        ...extra,
      },
    ],
  } as unknown as ProjectReportRequestDto);

/** Mirrors the API's response envelope around every DTO. */
const wrapped = <T,>(data: T) => ({
  data: {
    success: true,
    message: "Request processed successfully",
    data,
    timestamp: "2026-09-27T00:00:00.000Z",
    statusCode: 200,
  },
});

const renderSurface = () =>
  render(
    <Provider store={createStore()}>
      <ProjectReportRequest
        organizationId="org"
        projectId="p"
        currentUserId="user-1"
        timeZone="UTC"
      />
    </Provider>
  );

const goToScope = () => {
  const next = screen.getByTestId("project-report-next");
  expect(next).toBeEnabled();
  fireEvent.click(next);
  expect(screen.getByTestId("project-report-request")).toHaveAttribute(
    "data-step",
    "scope"
  );
};

const goToQuestions = () => {
  fireEvent.click(screen.getByTestId("project-report-back"));
  expect(screen.getByTestId("project-report-request")).toHaveAttribute(
    "data-step",
    "questions"
  );
};

const lastPreviewBody = () =>
  client.previewProjectReportRequest.mock.calls.at(-1)![0]
    .projectReportPreviewRequestDto;

beforeEach(() => {
  servicesState.isReady = true;
  servicesState.error = null;
  launchClient.startSession
    .mockReset()
    .mockResolvedValue({ state: "accepted", triggerMessageId: "trigger-1" });
  launchClient.getAccess.mockReset().mockReturnValue({
    isDeviceEnabled: true,
    interactions: { startSession: launchClient.startSession },
  });
  Object.values(client).forEach((fn) => fn.mockReset());
  client.previewProjectReportRequest.mockImplementation(
    async ({ projectReportPreviewRequestDto: body }) =>
      wrapped(preview(body.exclusions.length))
  );
  client.getProjectReportRequest.mockResolvedValue(
    wrapped(requestDto("RUNNING"))
  );
  machineState.value = {
    ...machineState.value,
    machines: [machine],
    mode: "one",
    selectedMachine: machine,
  };
});

describe("ProjectReportRequest", () => {
  it("keeps deliberate repository choices while inventory is unavailable and blocks continuation", () => {
    const binding = (serviceId: string) => ({
      serviceId,
      repositoryPath: "/repo",
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
    });
    machineState.value = {
      ...machineState.value,
      selectedMachine: {
        ...machine,
        bindings: [binding("service-a"), binding("service-b")],
      },
    };
    const surface = renderSurface();
    fireEvent.click(
      screen.getByRole("button", { name: "Release notes", exact: true })
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "App" }));
    servicesState.isReady = false;
    servicesState.error = new Error("Repository list failed");
    surface.rerender(
      <Provider store={createStore()}>
        <ProjectReportRequest
          organizationId="org"
          projectId="p"
          currentUserId="user-1"
          timeZone="UTC"
        />
      </Provider>
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Repository list failed"
    );
    expect(
      screen.getByTestId("project-report-repositories-select-all")
    ).toBeDisabled();
    expect(screen.getByTestId("project-report-next")).toBeDisabled();
    servicesState.isReady = true;
    servicesState.error = null;
    surface.rerender(
      <Provider store={createStore()}>
        <ProjectReportRequest
          organizationId="org"
          projectId="p"
          currentUserId="user-1"
          timeZone="UTC"
        />
      </Provider>
    );
    expect(screen.getByRole("checkbox", { name: "App" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "API" })).toBeChecked();
    expect(screen.getByTestId("project-report-next")).toBeEnabled();
  });
  it("refreshes repository defaults when the selected machine changes and preserves deliberate exclusions on binding updates", () => {
    const binding = (serviceId: string) => ({
      serviceId,
      repositoryPath: "/repo",
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
    });
    machineState.value = {
      ...machineState.value,
      selectedMachine: {
        ...machine,
        bindings: [binding("service-a"), binding("service-b")],
      },
    };
    const surface = renderSurface();
    fireEvent.click(
      screen.getByRole("button", { name: "Release notes", exact: true })
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "App" }));
    machineState.value = {
      ...machineState.value,
      selectedMachine: {
        ...machine,
        bindings: [binding("service-a"), binding("service-b")],
      },
    };
    surface.rerender(
      <Provider store={createStore()}>
        <ProjectReportRequest
          organizationId="org"
          projectId="p"
          currentUserId="user-1"
          timeZone="UTC"
        />
      </Provider>
    );
    expect(screen.getByRole("checkbox", { name: "App" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "API" })).toBeChecked();
    machineState.value = {
      ...machineState.value,
      selectedMachine: {
        ...machine,
        machineId: "machine-2",
        bindings: [binding("service-a")],
      },
    };
    surface.rerender(
      <Provider store={createStore()}>
        <ProjectReportRequest
          organizationId="org"
          projectId="p"
          currentUserId="user-1"
          timeZone="UTC"
        />
      </Provider>
    );
    expect(screen.getByRole("checkbox", { name: "App" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "API" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "API" })).not.toBeChecked();
  });
  it("shows kind-specific outline guides without replacing an edited question", () => {
    renderSurface();
    fireEvent.change(screen.getByTestId("project-report-question"), {
      target: { value: "My question" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Weekly recap" }));
    expect(screen.getByTestId("project-report-question")).toHaveValue(
      "My question"
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Release notes", exact: true })
    );
    expect(screen.getByTestId("project-report-question")).toHaveValue(
      "Describe what shipped in product terms."
    );
    expect(screen.queryByRole("button", { name: "Weekly recap" })).toBeNull();
    fireEvent.change(screen.getByTestId("project-report-question"), {
      target: { value: "Customer changes?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "By product area" }));
    expect(screen.getByTestId("project-report-question")).toHaveValue(
      "Customer changes?"
    );
  });

  it("selects bound repositories, disables unavailable rows, and launches the accepted subset", async () => {
    machineState.value = {
      ...machineState.value,
      selectedMachine: {
        ...machine,
        bindings: [
          {
            serviceId: "service-a",
            repositoryPath: "/app",
            createdAt: "2026-10-01T00:00:00Z",
            updatedAt: "2026-10-01T00:00:00Z",
          },
        ],
      },
    };
    const accepted = {
      ...requestDto("QUEUED"),
      kind: "RELEASE_NOTES",
      submission: {
        ...requestDto("QUEUED").submission,
        serviceIds: ["service-a"],
      },
    } as ProjectReportRequestDto;
    client.createProjectReportRequest.mockResolvedValue(wrapped(accepted));
    renderSurface();
    fireEvent.click(
      screen.getByRole("button", { name: "Release notes", exact: true })
    );
    expect(screen.getByRole("checkbox", { name: "App" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "API" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "App" }));
    expect(screen.getByTestId("project-report-next")).toBeDisabled();
    fireEvent.click(
      screen.getByTestId("project-report-repositories-select-all")
    );
    goToScope();
    await waitFor(() =>
      expect(screen.getByTestId("project-report-create")).toBeEnabled()
    );
    fireEvent.click(screen.getByTestId("project-report-create"));
    await waitFor(() => expect(launchClient.startSession).toHaveBeenCalled());
    expect(
      client.createProjectReportRequest.mock.calls[0][0]
        .createProjectReportRequestDto.serviceIds
    ).toEqual(["service-a"]);
    expect(
      launchClient.startSession.mock.calls[0][0].intent.serviceIds
    ).toEqual(["service-a"]);
  });

  it("launches the prepared report attempt through the authorized start-run flow", async () => {
    client.createProjectReportRequest.mockResolvedValue(
      wrapped(requestDto("QUEUED"))
    );
    renderSurface();
    goToScope();
    const create = screen.getByTestId("project-report-create");
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    await waitFor(() =>
      expect(launchClient.startSession).toHaveBeenCalledTimes(1)
    );
    expect(launchClient.getAccess).toHaveBeenCalledWith("machine-1");
    expect(launchClient.startSession.mock.calls[0][0]).toEqual({
      operationId: expect.any(String),
      organizationId: "org",
      projectId: "p",
      agentSessionId: "session-1",
      conversationId: "conversation-1",
      intent: {
        attachments: [],
        handlerPromptType: "project_report",
        provider: "claude",
        model: "opus",
        reasoningEffort: "medium",
        payload: {
          promptType: "project_report",
          request: {
            requestId: "req-1",
            attemptId: "attempt-1",
            projectId: "p",
          },
        },
        config: {
          type: "PROJECT_REPORT",
          version: "v1",
          requestId: "req-1",
          attemptId: "attempt-1",
          model: "opus",
          effort: "medium",
        },
        contextMetadata: {
          organizationId: "org",
          projectId: "p",
          agentSessionId: "session-1",
          capturedAt: "2026-10-05T05:34:08.000Z",
          userComments: [],
          fileReferences: { resolved: [], unresolved: [] },
        },
      },
    });
  });

  it("shows a launch failure and retries the same prepared operation without creating another request", async () => {
    client.createProjectReportRequest.mockResolvedValue(
      wrapped(requestDto("QUEUED"))
    );
    client.getProjectReportRequest.mockResolvedValue(
      wrapped(requestDto("QUEUED"))
    );
    launchClient.startSession.mockResolvedValueOnce({
      state: "failed",
      message: "CLI unavailable",
      code: "UNAVAILABLE",
    });
    renderSurface();
    goToScope();
    const create = screen.getByTestId("project-report-create");
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    expect(
      (await screen.findByTestId("project-report-launch-error")).textContent
    ).toContain("CLI unavailable");
    fireEvent.click(screen.getByTestId("project-report-retry-launch"));
    await waitFor(() =>
      expect(launchClient.startSession).toHaveBeenCalledTimes(2)
    );
    expect(launchClient.startSession.mock.calls[1][0]).toEqual(
      launchClient.startSession.mock.calls[0][0]
    );
    expect(client.createProjectReportRequest).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByTestId("project-report-launch-error")).toBeNull()
    );
  });

  it("surfaces missing preparation without dispatching an invalid run", async () => {
    client.createProjectReportRequest.mockResolvedValue(
      wrapped(requestDto("QUEUED", { conversationId: null }))
    );
    renderSurface();
    goToScope();
    const create = screen.getByTestId("project-report-create");
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    expect(
      (await screen.findByTestId("project-report-launch-error")).textContent
    ).toContain("no prepared session");
    expect(launchClient.startSession).not.toHaveBeenCalled();
  });

  it("shows only question and agent on step 1 and does not preview until step 2", async () => {
    renderSurface();
    expect(screen.getByTestId("project-report-question")).toBeTruthy();
    expect(screen.getByTestId("model-selector-stub")).toBeTruthy();
    expect(
      screen.getByTestId("project-report-machine-auto").textContent
    ).toContain("Laptop");
    expect(screen.queryByTestId("project-report-scope-panel")).toBeNull();
    expect(screen.queryByTestId("project-report-create")).toBeNull();
    expect(client.previewProjectReportRequest).not.toHaveBeenCalled();

    goToScope();
    expect(screen.queryByTestId("project-report-question")).toBeNull();
    expect(screen.queryByTestId("model-selector-stub")).toBeNull();
    expect(
      await screen.findAllByText("Updated twice in this period")
    ).toHaveLength(2);
    expect(lastPreviewBody()).not.toHaveProperty("question");
  });

  it("shows server-authored counts and explains each subject", async () => {
    renderSurface();
    goToScope();
    expect(
      await screen.findAllByText("Updated twice in this period")
    ).toHaveLength(2);
    const counts = screen.getByTestId("project-report-preview-counts");
    await waitFor(() => expect(counts.textContent).toContain("12 matching"));
    expect(
      screen.getByTestId("project-report-resolved-period").textContent
    ).toContain("UTC");
  });

  it("blocks Next without a question", () => {
    renderSurface();
    fireEvent.change(screen.getByTestId("project-report-question"), {
      target: { value: "  " },
    });
    expect(screen.getByTestId("project-report-next")).toBeDisabled();
    expect(
      screen.getByTestId("project-report-next-hint").textContent
    ).toContain("Describe what");
  });

  it("keeps question, agent, scope and exclusions across Back and Next", async () => {
    renderSurface();
    fireEvent.change(screen.getByTestId("project-report-question"), {
      target: { value: "My own question" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use Sonnet" }));
    goToScope();
    const rows = await screen.findAllByTestId("project-report-preview-row");
    fireEvent.click(
      within(rows[0]).getByRole("checkbox", { name: "Include Task a" })
    );
    await waitFor(() =>
      expect(lastPreviewBody().exclusions).toEqual([
        { entityType: "TASK", entityId: "a" },
      ])
    );

    goToQuestions();
    expect(screen.getByTestId("project-report-question")).toHaveValue(
      "My own question"
    );
    expect(screen.getByTestId("model-selector-stub")).toHaveAttribute(
      "data-model",
      "sonnet"
    );
    fireEvent.change(screen.getByTestId("project-report-outline"), {
      target: { value: "Edited outline" },
    });

    goToScope();
    await waitFor(() =>
      expect(
        screen.getByTestId("project-report-preview-counts").textContent
      ).toContain("1 excluded")
    );
    expect(lastPreviewBody().exclusions).toEqual([
      { entityType: "TASK", entityId: "a" },
    ]);
    expect(
      screen.queryByTestId("project-report-scope-reset-notice")
    ).toBeNull();
  });

  it("gives preview tabs their own row and leaves pagination at the bottom", async () => {
    renderSurface();
    goToScope();
    await screen.findAllByTestId("project-report-preview-row");
    const previewSection = screen.getByTestId("project-report-subject-preview");
    const tabs = screen.getByRole("tablist", { name: "Preview view" });
    expect(
      screen.getByTestId("project-report-preview-tabs").parentElement
    ).toBe(previewSection);
    expect(
      within(tabs).getByRole("tab", { name: "All matches" })
    ).toBeVisible();
    expect(
      within(tabs).getByRole("tab", { name: "Excluded (0)" })
    ).toBeVisible();
    expect(within(previewSection).queryByText(/^Showing /)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^Exclude these / })
    ).toBeNull();
    const pages = screen.getByRole("navigation", { name: "Preview pages" });
    expect(within(pages).getByText("Page 1 of 2")).toBeVisible();
    expect(within(pages).getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("keeps input and offers retry when the preview fails", async () => {
    client.previewProjectReportRequest.mockRejectedValueOnce(Object.assign(new Error("down"), { status: 403 }));
    renderSurface();
    goToScope();
    expect(
      await screen.findByTestId("project-report-preview-error")
    ).toBeTruthy();
    expect(
      screen.getByTestId("project-report-preview-counts").textContent
    ).toBe("Counts unavailable");
    expect(
      (screen.getByTestId("project-report-create") as HTMLButtonElement)
        .disabled
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(
        screen.getByTestId("project-report-preview-counts").textContent
      ).toContain("12 matching")
    );
  });

  it("blocks an empty population with an explanation", async () => {
    client.previewProjectReportRequest.mockResolvedValue(
      wrapped({
        ...preview(0, []),
        matchingSubjectCount: 0,
        includedSubjectCount: 0,
        displayedSubjectCount: 0,
      })
    );
    renderSurface();
    goToScope();
    await waitFor(() =>
      expect(
        screen.getByTestId("project-report-submit-hint").textContent
      ).toContain("No entities match")
    );
    expect(
      (screen.getByTestId("project-report-create") as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it("requires an explicit choice among several CLIs and explains zero", async () => {
    machineState.value = {
      ...machineState.value,
      mode: "many",
      selectedMachine: null,
    };
    const { unmount } = renderSurface();
    expect(screen.getByTestId("machine-picker")).toBeTruthy();
    expect(screen.getByTestId("project-report-next")).toBeDisabled();
    expect(
      screen.getByTestId("project-report-next-hint").textContent
    ).toContain("ready CLI");
    unmount();
    machineState.value = {
      ...machineState.value,
      machines: [],
      mode: "zero",
      selectedMachine: null,
    };
    renderSurface();
    expect(
      screen.getByTestId("project-report-machine-unavailable").textContent
    ).toContain("No CLI is ready");
    expect(screen.getByTestId("project-report-machine-recovery")).toBeTruthy();
    expect(screen.getByTestId("project-report-next")).toBeDisabled();
  });

  it("creates the report when the question's time wording differs from the period", async () => {
    client.createProjectReportRequest.mockResolvedValue(
      wrapped(requestDto("QUEUED"))
    );
    renderSurface();
    fireEvent.change(screen.getByTestId("project-report-question"), {
      target: { value: "What happened last week?" },
    });
    goToScope();
    const create = screen.getByTestId("project-report-create");
    await waitFor(() => expect(create).toBeEnabled());

    fireEvent.click(create);
    await screen.findByTestId("project-report-launch-status");
    expect(client.createProjectReportRequest).toHaveBeenCalledTimes(1);
  });

  it("submits the step 1 agent choice with the machine as the launch configuration", async () => {
    client.createProjectReportRequest.mockResolvedValue(
      wrapped(requestDto("QUEUED"))
    );
    renderSurface();
    fireEvent.click(screen.getByRole("button", { name: "Use Sonnet" }));
    fireEvent.click(screen.getByRole("button", { name: "Use Fast mode" }));
    goToScope();
    const create = screen.getByTestId("project-report-create");
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    await screen.findByTestId("project-report-launch-status");
    expect(
      client.createProjectReportRequest.mock.calls[0][0]
        .createProjectReportRequestDto.launch
    ).toEqual({
      machineId: "machine-1",
      provider: "claude",
      model: "sonnet",
      effort: "medium",
    });
  });

  it("submits once, preserves input on failure, and reuses the idempotency key", async () => {
    let rejectFirst!: (error: Error) => void;
    client.createProjectReportRequest
      .mockReturnValueOnce(new Promise((_, reject) => (rejectFirst = reject)))
      .mockResolvedValueOnce(wrapped(requestDto("QUEUED")));
    renderSurface();
    expect(
      screen.getByTestId("project-report-machine-auto").textContent
    ).toContain("Laptop");
    goToScope();
    const create = screen.getByTestId(
      "project-report-create"
    ) as HTMLButtonElement;
    await waitFor(() => expect(create.disabled).toBe(false));

    fireEvent.click(create);
    fireEvent.click(create);
    expect(client.createProjectReportRequest).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("project-report-back")).toBeDisabled();
    const firstBody =
      client.createProjectReportRequest.mock.calls[0][0]
        .createProjectReportRequestDto;
    expect(firstBody.launch).toEqual({
      machineId: "machine-1",
      provider: "claude",
      model: "opus",
      effort: "medium",
    });

    await act(async () => rejectFirst(new Error("Network down")));
    expect(
      screen.getByTestId("project-report-submit-error").textContent
    ).toContain("Network down");
    expect(screen.getByTestId("project-report-request")).toHaveAttribute(
      "data-step",
      "scope"
    );

    fireEvent.click(screen.getByTestId("project-report-create"));
    await screen.findByTestId("project-report-launch-status");
    const secondBody =
      client.createProjectReportRequest.mock.calls[1][0]
        .createProjectReportRequestDto;
    expect(secondBody).toEqual(firstBody);
  });

  it("uses a new idempotency key when the agent changes after a failed submission", async () => {
    client.createProjectReportRequest
      .mockRejectedValueOnce(new Error("Network down"))
      .mockResolvedValueOnce(wrapped(requestDto("QUEUED")));
    renderSurface();
    goToScope();
    const create = screen.getByTestId("project-report-create");
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    await screen.findByTestId("project-report-submit-error");

    goToQuestions();
    fireEvent.click(screen.getByRole("button", { name: "Use Sonnet" }));
    goToScope();
    const retry = screen.getByTestId("project-report-create");
    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry);
    await screen.findByTestId("project-report-launch-status");
    const [first, second] = client.createProjectReportRequest.mock.calls.map(
      (call) => call[0].createProjectReportRequestDto
    );
    expect(second.launch.model).toBe("sonnet");
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("retries a failed generation against the persisted attempt", async () => {
    client.createProjectReportRequest.mockResolvedValueOnce(
      wrapped(requestDto("QUEUED"))
    );
    client.getProjectReportRequest.mockResolvedValue(
      wrapped(
        requestDto("FAILED", {
          failure: {
            stage: "GENERATION",
            code: "x",
            message: "Model timed out.",
            retryable: true,
          },
        })
      )
    );
    client.retryProjectReportRequest.mockResolvedValue(
      wrapped(requestDto("QUEUED"))
    );
    renderSurface();
    goToScope();
    const create = screen.getByTestId(
      "project-report-create"
    ) as HTMLButtonElement;
    await waitFor(() => expect(create.disabled).toBe(false));
    fireEvent.click(create);
    const failed = await screen.findByTestId("project-report-status-failed", {}, { timeout: 5000 });
    expect(failed.textContent).toContain("Model timed out.");
    fireEvent.click(screen.getByTestId("project-report-retry-generation"));
    await waitFor(() =>
      expect(client.retryProjectReportRequest).toHaveBeenCalledTimes(1)
    );
    await waitFor(() =>
      expect(launchClient.startSession).toHaveBeenCalledTimes(2)
    );
    expect(client.retryProjectReportRequest.mock.calls[0][0]).toMatchObject({
      requestId: "req-1",
      retryProjectReportRequestDto: { expectedAttemptId: "attempt-1" },
    });
  });
});

it("preserves the question and exclusions when closed and reopened in the same project", async () => {
  const close = vi.fn();
  const surface = (projectId: string) => (
    <Provider store={createStore()}>
      <ProjectReportRequest
        organizationId="org"
        projectId={projectId}
        currentUserId="reopen-user"
        timeZone="UTC"
        onClose={close}
      />
    </Provider>
  );
  const view = render(surface("reopen-project"));
  fireEvent.change(screen.getByTestId("project-report-question"), {
    target: { value: "Keep this question" },
  });
  goToScope();
  const rows = await screen.findAllByTestId("project-report-preview-row");
  fireEvent.click(
    within(rows[0]).getByRole("checkbox", { name: "Include Task a" })
  );
  fireEvent.click(screen.getByTestId("project-report-close"));
  expect(close).toHaveBeenCalledOnce();
  view.unmount();
  const reopened = render(surface("reopen-project"));
  await waitFor(() =>
    expect(lastPreviewBody().exclusions).toEqual([
      { entityType: "TASK", entityId: "a" },
    ])
  );
  goToQuestions();
  expect(screen.getByTestId("project-report-question")).toHaveValue(
    "Keep this question"
  );
  reopened.unmount();
  render(surface("another-project"));
  expect(screen.getByTestId("project-report-question")).not.toHaveValue(
    "Keep this question"
  );
});

it.each([null, "durable-report"])(
  "opens completion only with persisted report identity %s",
  async (reportId) => {
    const open = vi.fn();
    client.createProjectReportRequest.mockResolvedValue(
      wrapped(requestDto("COMPLETED", { reportId }))
    );
    client.getProjectReportRequest.mockResolvedValue(
      wrapped(requestDto("COMPLETED", { reportId }))
    );
    render(
      <Provider store={createStore()}>
        <ProjectReportRequest
          organizationId="org"
          projectId="completion-project"
          currentUserId="completion-user"
          timeZone="UTC"
          onOpenReport={open}
        />
      </Provider>
    );
    goToScope();
    const create = screen.getByTestId("project-report-create");
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    await screen.findByTestId("project-report-launch-status");
    if (reportId) {
      fireEvent.click(await screen.findByTestId("project-report-open-report"));
      expect(open).toHaveBeenCalledWith(reportId);
    } else {
      await screen.findByText(
        "Generation finished, but the report is not available yet."
      );
      expect(
        screen.queryByTestId("project-report-open-report")
      ).not.toBeInTheDocument();
      expect(open).not.toHaveBeenCalled();
    }
  }
);
