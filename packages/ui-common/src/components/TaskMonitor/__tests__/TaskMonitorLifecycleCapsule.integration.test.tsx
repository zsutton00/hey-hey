import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useSyncExternalStore, type ReactNode } from "react";
import { MemoryRouter, Link, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthorizationProtocolVersion,
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
  WorkStatus,
  type MachineDto,
} from "../../../api";
import type { WorkItemExecutionStateResult } from "../../../data/hooks/useWorkItemExecutionState";
import { ActionsCapsule } from "../../ActionsCapsule/ActionsCapsule";
import { ActionsCapsuleProvider } from "../../ActionsCapsule/ActionsCapsuleProvider";
import { TaskMonitor } from "../TaskMonitor";
import type { TaskMonitorProjectedNode } from "../useTaskMonitorProjection";
import {
  createSession,
  createTask,
  createTaskMonitorDefinition,
  firstTaskId,
} from "./taskMonitorTestFixtures";

type Advertised = { kind: string; command: "START" | "RESUME" | "PAUSE" };

const mocks = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    listeners,
    state: { status: "missing", delivery: "LIVE" } as unknown,
    mutate: vi.fn(),
    reconcile: vi.fn(),
  };
});

const setExecutionState = (state: WorkItemExecutionStateResult) => {
  mocks.state = state;
  act(() => mocks.listeners.forEach((listener) => listener()));
};

vi.mock("../../../data/hooks/useWorkItemExecutionState", () => ({
  useWorkItemExecutionState: () =>
    useSyncExternalStore(
      (listener) => {
        mocks.listeners.add(listener);
        return () => mocks.listeners.delete(listener);
      },
      () => mocks.state,
    ) as WorkItemExecutionStateResult,
}));
vi.mock("../../../data/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../data/hooks")>()),
  useSubmitTaskMonitorCommand: () => ({ mutate: mocks.mutate }),
}));
vi.mock("../../../contexts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../contexts")>()),
  TrackingProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../../../data/hooks/useReports", () => ({
  useReports: () => ({ reports: [], isLoading: false, error: null }),
}));
vi.mock("../useTaskMonitorSessionReports", () => ({
  useTaskMonitorCoordinatorConversation: () => ({
    conversation: null,
    project: null,
    session: createSession(),
    loading: false,
    fetched: true,
    errorMessage: null,
  }),
  useTaskMonitorConversation: () => ({
    conversation: null,
    project: null,
    session: null,
    loading: false,
    fetched: true,
    errorMessage: null,
  }),
}));
vi.mock("../useTaskMonitorProjection", () => ({
  useTaskMonitorProjection: () => ({
    definition: createTaskMonitorDefinition(),
    monitor: {
      status: WorkStatus.Active,
      name: "Release monitor",
      createdAt: "2026-07-20T00:00:00.000Z",
    },
    nodes: [node],
    isLoading: false,
    isFetched: true,
    errorMessage: null,
    isSavingLaunchConfiguration: false,
    saveLaunchConfiguration: vi.fn(),
    reconcileAfterCommand: mocks.reconcile,
  }),
}));
vi.mock("../../AgentSession/runtime/coding/useMachineResolution", () => ({
  useMachineResolution: () => ({
    machines: [machine],
    selectedMachine: machine,
    setSelectedMachineId: vi.fn(),
  }),
}));
vi.mock("../../AgentSession/useRuntimeModelCatalog", () => ({
  useRuntimeModelCatalog: () => ({ status: "ready", catalog: [] }),
}));
vi.mock("../../AgentSession/capabilityCatalog", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../AgentSession/capabilityCatalog")
  >()),
  listModels: () => [{ id: "gpt-5.5", label: "GPT 5.5", efforts: ["high"] }],
  listEfforts: () => ["high"],
  supportsFastMode: () => false,
}));
vi.mock("../../ActionsCapsule/useSearchAction", () => ({
  useSearchAction: () => ({
    id: "search",
    label: "Search",
    behavior: "click",
    actionGroup: "conceptual",
    tier: "site",
    order: 20,
    onClick: vi.fn(),
  }),
}));
vi.mock("../../Scratchpad/useScratchpadCapsuleAction", () => ({
  useScratchpadCapsuleAction: () => null,
}));
vi.mock("../../Scratchpad/ScratchpadDropTarget", () => ({
  ScratchpadDropTarget: () => null,
}));
vi.mock("../../../contexts/DndContext", () => ({
  useDndContextSafe: () => ({
    activeContent: null,
    activeSourceId: null,
    isDragging: false,
    setActiveContent: vi.fn(),
    setActiveSourceId: vi.fn(),
    setIsDragging: vi.fn(),
  }),
}));
vi.mock(
  "../../InteractionComponent/bindGraphConversationAgentSessionMachine",
  () => ({
    bindGraphConversationAgentSessionMachine: vi
      .fn()
      .mockResolvedValue(undefined),
  }),
);
vi.mock("../../AgentSession", () => ({
  AgentConversationView: () => <div data-testid="agent-conversation-view" />,
}));
vi.mock("../TaskMonitorSessionActivityIndicator", () => ({
  TaskMonitorSessionActivityIndicator: () => null,
}));

const machine: MachineDto = {
  machineId: "machine-1",
  name: "Ready machine",
  pairedAt: "2026-08-13T00:00:00.000Z",
  active: true,
  authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_2,
  executionReadiness: MachineExecutionReadinessState.Ready,
  currentControllerEligibility:
    CurrentControllerMachineEligibilityState.Eligible,
  bindings: [],
};

const node: TaskMonitorProjectedNode = {
  position: 0,
  taskId: firstTaskId,
  dependsOnTaskIds: [],
  launchConfiguration: {
    method: "quick",
    provider: "codex",
    model: "gpt-5.5",
    reasoningEffort: "high",
  },
  isCursor: true,
  task: { kind: "loaded", task: createTask(firstTaskId, "Current task") },
  session: { kind: "loaded", session: createSession() },
  visualStatus: "active",
};

const retained = (
  availableActions: Advertised[],
  delivery: "LIVE" | "INTERRUPTED" = "LIVE",
): WorkItemExecutionStateResult => ({
  status: "retained",
  delivery,
  revision: 1,
  ownerMachineId: "machine-1",
  acceptedAt: "2026-11-18T12:00:00Z",
  freshness: { status: "CURRENT", changedAt: "2026-11-18T12:00:00Z" },
  state: {
    type: "TASK_MONITOR",
    projection: {
      execution: {
        lifecycle: "RUNNING",
        control: availableActions.some((a) => a.command === "PAUSE")
          ? "ACTIVE"
          : "PAUSED",
        work: "OBSERVING_RUN",
        intervention: "CLEAR",
      },
      availableActions,
    },
  },
});

const running = () => retained([{ kind: "PAUSE", command: "PAUSE" }]);
const paused = () =>
  retained([{ kind: "PAUSED_CONTINUATION", command: "RESUME" }]);
// After a retryable launch failure the CLI advertises retry and Pause together.
const retryable = () =>
  retained([
    { kind: "PAUSE", command: "PAUSE" },
    { kind: "RETRYABLE_RECOVERY", command: "START" },
  ]);

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const lifecycleButton = (label: "Start" | "Pause") =>
  screen.getByRole("button", { name: label });
const lifecycleKeys = () =>
  screen
    .queryAllByTestId("capsule-screen-button")
    .map((button) => button.getAttribute("data-screen-key"));

const originalMatchMedia = window.matchMedia;
const setViewport = (mobile: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: mobile && query.includes("max-width"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

const renderApp = () =>
  render(
    <MemoryRouter initialEntries={["/monitor"]}>
      <ActionsCapsuleProvider>
        <ActionsCapsule />
        <Link to="/other">go-other</Link>
        <Link to="/monitor">go-monitor</Link>
        <Routes>
          <Route
            path="/monitor"
            element={
              <TaskMonitor
                organizationId="org-1"
                projectId="project-1"
                monitorId="66666666-6666-4666-8666-666666666666"
                activePane="monitor"
              />
            }
          />
          <Route path="/other" element={<div data-testid="other-page" />} />
        </Routes>
      </ActionsCapsuleProvider>
    </MemoryRouter>,
  );

describe("Task Monitor lifecycle button in the real Action Capsule", () => {
  beforeEach(() => {
    setViewport(false);
    mocks.mutate.mockReset();
    mocks.reconcile.mockReset();
    mocks.reconcile.mockResolvedValue(undefined);
    vi.stubGlobal("crypto", { randomUUID: () => "request-1" });
    mocks.state = running();
  });
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("drives Pause through pending, rejection and a committed refresh, then Resume", async () => {
    renderApp();

    // Pause is pending while live updates drop: the label keeps the committed state.
    const pending = deferred<unknown>();
    mocks.mutate.mockReturnValueOnce(pending.promise);
    fireEvent.click(lifecycleButton("Pause"));
    await waitFor(() => expect(lifecycleButton("Pause")).toBeDisabled());
    expect(
      within(lifecycleButton("Pause")).getByTestId(
        "capsule-screen-button-pending",
      ),
    ).toBeVisible();
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        monitorId: "66666666-6666-4666-8666-666666666666",
        request: expect.objectContaining({
          command: { cause: "PAUSE" },
        }),
      }),
    );
    setExecutionState({ ...running(), delivery: "INTERRUPTED" });
    expect(lifecycleButton("Pause")).toBeDisabled();

    // A rejected command shows its message and leaves the committed label alone.
    await act(async () => {
      pending.resolve({
        commandId: "command-1",
        status: "REJECTED",
        stage: "VERIFICATION",
        reason: "ROUTING_MISMATCH",
        message: "The command route did not match.",
      });
    });
    expect(
      await screen.findByTestId("task-monitor-command-outcome"),
    ).toHaveTextContent("The command route did not match.");
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(lifecycleButton("Pause")).toBeDisabled();

    // Live updates return; an admitted Pause only changes the label once committed.
    setExecutionState(running());
    expect(lifecycleButton("Pause")).toBeEnabled();
    mocks.mutate.mockResolvedValueOnce({
      commandId: "command-2",
      status: "ADMITTED",
    });
    mocks.reconcile.mockImplementationOnce(async () => {
      expect(lifecycleButton("Pause")).toBeDisabled();
    });
    fireEvent.click(lifecycleButton("Pause"));
    await waitFor(() => expect(mocks.reconcile).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("button", { name: "Start" }),
    ).not.toBeInTheDocument();
    setExecutionState(paused());

    // Resume routes through the Resume command.
    mocks.mutate.mockResolvedValueOnce({
      commandId: "command-3",
      status: "ADMITTED",
    });
    await waitFor(() => expect(lifecycleButton("Start")).toBeEnabled());
    fireEvent.click(lifecycleButton("Start"));
    await waitFor(() =>
      expect(mocks.mutate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          request: expect.objectContaining({ command: { cause: "RESUME" } }),
        }),
      ),
    );
  });

  it("shows Start, not Pause, when retry and Pause are both advertised", async () => {
    mocks.state = retryable();
    mocks.mutate.mockResolvedValue({
      commandId: "command-4",
      status: "ADMITTED",
    });
    renderApp();

    expect(
      screen.queryByRole("button", { name: "Pause" }),
    ).not.toBeInTheDocument();
    fireEvent.click(lifecycleButton("Start"));

    await waitFor(() =>
      expect(mocks.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.objectContaining({
            command: expect.objectContaining({ cause: "START" }),
          }),
        }),
      ),
    );
  });

  it("removes the button from the mounted Capsule when the user leaves the workspace", async () => {
    renderApp();
    expect(lifecycleKeys()).toEqual([
      expect.stringMatching(/^task-monitor-lifecycle:/),
      expect.stringMatching(/^task-monitor:/),
    ]);

    fireEvent.click(screen.getByText("go-other"));
    expect(await screen.findByTestId("other-page")).toBeInTheDocument();
    expect(lifecycleKeys()).toEqual([]);
    expect(screen.queryByTestId("capsule-screen-divider")).toBeNull();

    fireEvent.click(screen.getByText("go-monitor"));
    await waitFor(() => expect(lifecycleKeys()).toHaveLength(2));
  });

  it("lists the lifecycle button first in the mobile menu", () => {
    setViewport(true);
    renderApp();

    fireEvent.click(screen.getByTestId("capsule-toggle"));

    const entries = screen
      .getByTestId("capsule-mobile-grid")
      .querySelectorAll(
        "[data-testid='capsule-screen-button'], [data-testid^='capsule-action-']",
      );
    expect(entries[0]).toHaveAttribute(
      "data-screen-key",
      expect.stringMatching(/^task-monitor-lifecycle:/),
    );
    expect(entries[1]).toHaveAttribute(
      "data-screen-key",
      expect.stringMatching(/^task-monitor:/),
    );
  });

  it("keeps pending feedback visible in the mobile menu after tapping the action", async () => {
    setViewport(true);
    const pending = deferred<unknown>();
    mocks.mutate.mockReturnValueOnce(pending.promise);
    renderApp();
    fireEvent.click(screen.getByTestId("capsule-toggle"));

    fireEvent.click(lifecycleButton("Pause"));

    await waitFor(() => expect(lifecycleButton("Pause")).toBeDisabled());
    expect(screen.getByTestId("capsule-mobile-grid")).toBeVisible();
    expect(
      within(lifecycleButton("Pause")).getByTestId(
        "capsule-screen-button-pending",
      ),
    ).toBeVisible();
    await act(async () => {
      pending.resolve({ commandId: "command-9", status: "ADMITTED" });
    });
  });
});
