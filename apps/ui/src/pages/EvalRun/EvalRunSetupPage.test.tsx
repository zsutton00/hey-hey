import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.fn();
const mockUseWorkItems = vi.fn();
const mockLaunch = vi.fn();
const mockStart = vi.fn();
let mockMachineId: string | null = "machine-1";

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ projectId: "p1", evalId: "eval-1" }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: "org" }),
}));

vi.mock("@hey-hey/ui-common/services", () => ({
  WebPathService: {
    evalRun: (p: { projectId: string; evalId: string; runId: string }) =>
      `/projects/${p.projectId}/evals/${p.evalId}/runs/${p.runId}`,
  },
}));

// A catalog with one model that needs an effort and one that has none.
vi.mock("@hey-hey/ui-common/components", () => ({
  listProviders: () => ["claude"],
  listModels: () => [
    { id: "sonnet", label: "Claude Sonnet", efforts: ["medium", "high"] },
    { id: "plain", label: "Plain", efforts: [] },
  ],
  listEfforts: (_provider: string, model: string) =>
    model === "sonnet" ? ["medium", "high"] : [],
  useRuntimeModelCatalog: () => ({ status: "ready" }),
  useMachineResolution: () => ({
    machines: [],
    isReady: true,
    mode: "one",
    selectedMachine: mockMachineId ? { machineId: mockMachineId } : null,
    setSelectedMachineId: vi.fn(),
  }),
  resolveAgentBridgeRecoveryState: () => ({ type: "loading" }),
  ModelSelectorMachineSelection: () => <div data-testid="machine-picker" />,
  RuntimeModelSelector: (props: {
    onProviderChange: (value: string) => void;
    onModelChange: (value: string) => void;
    onReasoningEffortChange: (value: string | null) => void;
  }) => (
    <div>
      <button
        data-testid="pick-sonnet-no-effort"
        onClick={() => {
          props.onProviderChange("claude");
          props.onModelChange("sonnet");
          props.onReasoningEffortChange(null);
        }}
      />
      <button
        data-testid="pick-sonnet-high"
        onClick={() => {
          props.onProviderChange("claude");
          props.onModelChange("sonnet");
          props.onReasoningEffortChange("high");
        }}
      />
    </div>
  ),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useWorkItem: () => ({
    workItem: { id: "eval-1", name: "Refiner eval", type: "EVAL" },
    isLoading: false,
    error: null,
  }),
  useWorkItems: (...args: unknown[]) => mockUseWorkItems(...args),
  useLaunchEvalRun: () => ({ mutate: mockLaunch, isPending: false }),
  useEvalRunSession: () => ({
    start: mockStart,
    isStarting: false,
    error: null,
  }),
}));

vi.mock("../../components/Layout", () => ({
  DetailPageContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("../../components/TaskBreadcrumbs", () => ({
  TaskBreadcrumbs: () => null,
}));
vi.mock("../../components/useFeatureAncestors", () => ({
  useFeatureAncestors: () => ({ ancestors: [] }),
}));

import { EvalRunSetupPage } from "./EvalRunSetupPage";

const twoCases = [
  { id: "case-1", name: "Feature change that should update its mockup" },
  { id: "case-2", name: "Request for a mobile view" },
];

const addSetup = (pick: string): void => {
  fireEvent.click(screen.getByTestId("eval-run-add-configuration"));
  fireEvent.click(screen.getByTestId(pick));
  fireEvent.click(screen.getByTestId("eval-run-add-configuration-confirm"));
};

describe("EvalRunSetupPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMachineId = "machine-1";
    mockUseWorkItems.mockReturnValue({
      workItems: twoCases,
      isLoading: false,
      error: null,
    });
    mockLaunch.mockResolvedValue({ id: "run-9" });
    mockStart.mockResolvedValue({ ok: true });
  });

  it("shows the judge, the approved cases, the notes and No limit defaults", () => {
    render(<EvalRunSetupPage />);
    expect(screen.getByTestId("eval-run-judge")).toHaveTextContent(
      "Claude Opus 5.5 · high",
    );
    expect(mockUseWorkItems).toHaveBeenCalledWith(
      "org",
      "task",
      "p1",
      undefined,
      expect.objectContaining({
        parentTaskId: "eval-1",
        taskType: "EVAL_CASE",
        status: "ACTIVE",
      }),
    );
    const cases = screen.getByTestId("eval-run-cases");
    expect(within(cases).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByTestId("eval-run-setting-concurrency")).toHaveValue(3);
    expect(screen.getByTestId("eval-run-setting-time-limit")).toHaveTextContent(
      "eval.run.settings.noLimit",
    );
    expect(
      screen.getByTestId("eval-run-setting-token-limit"),
    ).toHaveTextContent("eval.run.settings.noLimit");
    expect(screen.getByTestId("eval-run-limits-note")).toBeInTheDocument();
    expect(
      screen.getByTestId("eval-run-live-project-note"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("eval-run-inert-output-note"),
    ).toBeInTheDocument();
  });

  it("only accepts a complete setup", () => {
    render(<EvalRunSetupPage />);
    fireEvent.click(screen.getByTestId("eval-run-add-configuration"));
    fireEvent.click(screen.getByTestId("pick-sonnet-no-effort"));
    expect(
      screen.getByTestId("eval-run-add-configuration-confirm"),
    ).toBeDisabled();
    fireEvent.click(screen.getByTestId("pick-sonnet-high"));
    expect(
      screen.getByTestId("eval-run-add-configuration-confirm"),
    ).toBeEnabled();
  });

  it("counts attempts as cases × selected setups and starts nothing before Run", () => {
    render(<EvalRunSetupPage />);
    expect(screen.getByTestId("eval-run-start")).toBeDisabled();
    addSetup("pick-sonnet-high");
    expect(screen.getByTestId("eval-run-attempt-count")).toHaveTextContent(
      '"attempts":"eval.run.attempts {\\"count\\":2}"',
    );
    const chip = screen.getByTestId(
      "eval-run-config-option-claude:sonnet:high",
    );
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("eval-run-start")).toBeDisabled();
    fireEvent.click(chip);
    expect(screen.getByTestId("eval-run-start")).toBeEnabled();
    expect(mockLaunch).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("can't run without a machine", () => {
    mockMachineId = null;
    render(<EvalRunSetupPage />);
    addSetup("pick-sonnet-high");
    expect(screen.getByTestId("eval-run-start")).toBeDisabled();
  });

  it("records the run, starts it from the saved run, then opens it", async () => {
    render(<EvalRunSetupPage />);
    addSetup("pick-sonnet-high");
    await act(async () => {
      fireEvent.click(screen.getByTestId("eval-run-start"));
    });
    expect(mockLaunch).toHaveBeenCalledWith({
      organizationId: "org",
      projectId: "p1",
      evalId: "eval-1",
      request: {
        evalCaseIds: ["case-1", "case-2"],
        configurations: [
          {
            id: "claude:sonnet:high",
            target: {
              provider: "claude",
              model: "sonnet",
              reasoningEffort: "high",
            },
          },
        ],
        judgeSetup: {
          provider: "claude",
          model: "claude-opus-5-5",
          reasoningEffort: "high",
        },
        settings: { maxConcurrentAttempts: 3 },
      },
    });
    expect(mockStart).toHaveBeenCalledWith({
      organizationId: "org",
      projectId: "p1",
      runId: "run-9",
      machineId: "machine-1",
    });
    expect(mockNavigate).toHaveBeenCalledWith(
      "/projects/p1/evals/eval-1/runs/run-9",
      { state: { startAccepted: true } },
    );
  });

  it("opens the recorded run with the start error when the start fails", async () => {
    mockStart.mockResolvedValue({ ok: false, error: "No CLI connected" });
    render(<EvalRunSetupPage />);
    addSetup("pick-sonnet-high");
    await act(async () => {
      fireEvent.click(screen.getByTestId("eval-run-start"));
    });
    expect(mockNavigate).toHaveBeenCalledWith(
      "/projects/p1/evals/eval-1/runs/run-9",
      { state: { startError: "No CLI connected" } },
    );
  });

  it("stays on the page and shows why when the run can't be recorded", async () => {
    mockLaunch.mockRejectedValue(new Error("Case is not approved"));
    render(<EvalRunSetupPage />);
    addSetup("pick-sonnet-high");
    await act(async () => {
      fireEvent.click(screen.getByTestId("eval-run-start"));
    });
    expect(mockStart).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("eval-run-launch-error")).toHaveTextContent(
      "Case is not approved",
    );
  });
});
