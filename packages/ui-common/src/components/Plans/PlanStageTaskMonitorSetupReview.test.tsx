import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readSurfaceSelection,
  TASK_MONITOR_SETUP_SURFACE_ID,
} from "../AgentSession/surfaceSelectionMemory";
import { buildPlanStageTaskMonitorUserMessageStorageKey } from "./planStageTaskMonitorMessage";
import { PlanStageTaskMonitorSetupReview } from "./PlanStageTaskMonitorSetupReview/index";

vi.mock("../LexicalEditor/MarkdownLexicalEditor", () => ({
  MarkdownLexicalEditor: ({
    value,
    onTextChange,
  }: {
    value?: string;
    onTextChange?: (value: string) => void;
  }) => (
    <textarea
      data-testid="task-monitor-user-message-editor"
      value={value}
      onChange={(event) => onTextChange?.(event.target.value)}
    />
  ),
}));
vi.mock("../AgentSession/RuntimeModelSelector", () => ({
  RuntimeModelSelector: ({
    reasoningEffort,
    onProviderChange,
    onModelChange,
    onReasoningEffortChange,
    onFastModeChange,
  }: {
    reasoningEffort: string | null;
    onProviderChange: (provider: "claude") => void;
    onModelChange: (model: string) => void;
    onReasoningEffortChange: (effort: "high") => void;
    onFastModeChange: (fastMode: boolean) => void;
  }) => (
    <>
      <button
        data-testid="mock-plan-stage-runtime"
        data-reasoning-effort={reasoningEffort ?? ""}
        onClick={() => {
          onProviderChange("claude");
          onModelChange("claude-sonnet-5-5");
          onReasoningEffortChange("high");
        }}
      >
        Change runtime
      </button>
      <button
        data-testid="mock-plan-stage-fast-mode"
        onClick={() => onFastModeChange(true)}
      >
        Enable Fast mode
      </button>
      <button
        data-testid="mock-plan-stage-effort"
        onClick={() => onReasoningEffortChange("high")}
      >
        Change effort
      </button>
    </>
  ),
}));
vi.mock("../Selectors/ServiceSelector", () => ({
  ServiceSelector: () => <div data-testid="mock-service-selector" />,
}));

const createDraft = (stageId = "stage-1") => ({
  definition: {
    executionPlan: [
      {
        taskId: "task-1",
        dependsOnTaskIds: [],
        launchConfiguration: {
          method: "quick" as const,
          provider: "codex" as const,
          model: "gpt-5.6-sol",
          reasoningEffort: "medium" as const,
          fastMode: false,
        },
      },
    ],
    launchPolicy: {
      terminalSupervision: { mode: "AGENT_DECIDES" as const },
    },
    cursor: 0,
  },
  provenance: {
    organizationId: "org-1",
    projectId: "project-1",
    planId: "plan-1",
    planWorktreeBranch: null,
    planParentTaskId: "feature-1",
    planLabel: "Feature delivery",
    stageId,
    stageLabel: stageId === "stage-1" ? "Build" : "Verify",
    preparedAt: "2026-07-14T01:02:03.000Z",
  },
  executableTasks: [
    {
      taskId: "task-1",
      label: "Implement",
      description: null,
      serviceIds: ["service-1"],
    },
  ],
});

const createMultiTaskDraft = () => {
  const draft = createDraft();
  const firstNode = draft.definition.executionPlan[0]!;
  return {
    ...draft,
    definition: {
      ...draft.definition,
      executionPlan: [
        firstNode,
        {
          ...firstNode,
          taskId: "task-2",
          dependsOnTaskIds: ["task-1"],
        },
        {
          ...firstNode,
          taskId: "task-3",
          dependsOnTaskIds: ["task-2"],
        },
      ],
    },
    executableTasks: [
      {
        ...draft.executableTasks[0]!,
        taskId: "task-1",
        label: "Prepare foundation",
      },
      {
        ...draft.executableTasks[0]!,
        stepId: "step-2",
        taskId: "task-2",
        label: "Implement feature",
      },
      {
        ...draft.executableTasks[0]!,
        stepId: "step-3",
        taskId: "task-3",
        label: "Verify feature",
      },
    ],
  };
};

describe("PlanStageTaskMonitorSetupReview", () => {
  beforeEach(() => localStorage.clear());

  it("recovers messages by the provenance tuple and confirms the definition unchanged", async () => {
    const first = createDraft();
    localStorage.setItem(
      buildPlanStageTaskMonitorUserMessageStorageKey(first.provenance),
      JSON.stringify({
        value: "Focus on the design",
        savedAt: "2026-07-14T01:02:03.000Z",
      })
    );
    const onConfirm = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <PlanStageTaskMonitorSetupReview
          setup={first}
          isRefreshingTaskServices={false}
          onRefreshTaskServices={vi.fn()}
          onConfirm={onConfirm}
        />
      </MemoryRouter>
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("task-monitor-user-message-editor")
      ).toHaveValue("Focus on the design")
    );
    expect(screen.getByTestId("mock-plan-stage-runtime")).toHaveAttribute(
      "data-reasoning-effort",
      "medium"
    );

    fireEvent.click(screen.getByTestId("plan-stage-task-monitor-confirm"));
    expect(onConfirm).toHaveBeenCalledWith(
      first.definition,
      "Focus on the design"
    );

    rerender(
      <MemoryRouter>
        <PlanStageTaskMonitorSetupReview
          setup={createDraft("stage-2")}
          isRefreshingTaskServices={false}
          onRefreshTaskServices={vi.fn()}
          onConfirm={onConfirm}
        />
      </MemoryRouter>
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("task-monitor-user-message-editor")
      ).toHaveValue("")
    );
  });

  it("places the reviewed provider, model, and effort into the confirmed definition", () => {
    const onConfirm = vi.fn();
    render(
      <MemoryRouter>
        <PlanStageTaskMonitorSetupReview
          setup={createDraft()}
          isRefreshingTaskServices={false}
          onRefreshTaskServices={vi.fn()}
          onConfirm={onConfirm}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId("mock-plan-stage-runtime"));
    fireEvent.click(screen.getByTestId("plan-stage-task-monitor-confirm"));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        executionPlan: [
          expect.objectContaining({
            launchConfiguration: {
              method: "quick",
              provider: "claude",
              model: "claude-sonnet-5-5",
              reasoningEffort: "high",
            },
          }),
        ],
      }),
      ""
    );
    expect(readSurfaceSelection(TASK_MONITOR_SETUP_SURFACE_ID)).toEqual({
      provider: "claude",
      model: "claude-sonnet-5-5",
      reasoningEffort: "high",
    });
  });

  it("preserves explicit Fast mode on a supported per-task selection", () => {
    const onConfirm = vi.fn();
    render(
      <MemoryRouter>
        <PlanStageTaskMonitorSetupReview
          setup={createDraft()}
          isRefreshingTaskServices={false}
          onRefreshTaskServices={vi.fn()}
          onConfirm={onConfirm}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId("mock-plan-stage-fast-mode"));
    fireEvent.click(screen.getByTestId("plan-stage-task-monitor-confirm"));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        executionPlan: [
          expect.objectContaining({
            launchConfiguration: expect.objectContaining({ fastMode: true }),
          }),
        ],
      }),
      ""
    );
  });

  it("keeps deselected Tasks reselectable and confirms a dependency-pruned definition", () => {
    const onConfirm = vi.fn();
    render(
      <MemoryRouter>
        <PlanStageTaskMonitorSetupReview
          setup={createMultiTaskDraft()}
          isRefreshingTaskServices={false}
          onRefreshTaskServices={vi.fn()}
          onConfirm={onConfirm}
        />
      </MemoryRouter>
    );

    const selections = screen.getAllByRole("checkbox");
    expect(selections).toHaveLength(3);
    expect(
      selections.every((selection) => (selection as HTMLInputElement).checked)
    ).toBe(true);

    fireEvent.click(screen.getAllByTestId("mock-plan-stage-runtime")[1]!);
    fireEvent.click(selections[1]!);
    expect(selections[1]).not.toBeChecked();
    expect(
      screen.queryByText("Depends on Implement feature")
    ).not.toBeInTheDocument();

    fireEvent.click(selections[1]!);
    expect(selections[1]).toBeChecked();
    expect(
      screen.getByText("Depends on Implement feature")
    ).toBeInTheDocument();

    fireEvent.click(selections[0]!);
    fireEvent.click(screen.getByTestId("plan-stage-task-monitor-confirm"));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        executionPlan: [
          expect.objectContaining({
            taskId: "task-2",
            dependsOnTaskIds: [],
            launchConfiguration: {
              method: "quick",
              provider: "claude",
              model: "claude-sonnet-5-5",
              reasoningEffort: "high",
            },
          }),
          expect.objectContaining({
            taskId: "task-3",
            dependsOnTaskIds: ["task-2"],
          }),
        ],
      }),
      ""
    );
  });

  it("blocks confirmation when every executable Task is deselected", () => {
    const onConfirm = vi.fn();
    render(
      <MemoryRouter>
        <PlanStageTaskMonitorSetupReview
          setup={createDraft()}
          isRefreshingTaskServices={false}
          onRefreshTaskServices={vi.fn()}
          onConfirm={onConfirm}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("checkbox"));

    expect(
      screen.getByTestId("plan-stage-task-monitor-confirm")
    ).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("uses the new source configuration for subsequent coordinated writes", () => {
    const { rerender } = render(
      <MemoryRouter>
        <PlanStageTaskMonitorSetupReview
          setup={createDraft()}
          isRefreshingTaskServices={false}
          onRefreshTaskServices={vi.fn()}
          onConfirm={vi.fn()}
        />
      </MemoryRouter>
    );

    const nextSource = createDraft("stage-2");
    nextSource.definition.executionPlan[0]!.launchConfiguration = {
      method: "open",
      provider: "claude",
      model: "claude-sonnet-5-5",
      reasoningEffort: "low",
    };
    rerender(
      <MemoryRouter>
        <PlanStageTaskMonitorSetupReview
          setup={nextSource}
          isRefreshingTaskServices={false}
          onRefreshTaskServices={vi.fn()}
          onConfirm={vi.fn()}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId("mock-plan-stage-effort"));

    expect(readSurfaceSelection(TASK_MONITOR_SETUP_SURFACE_ID)).toEqual({
      provider: "claude",
      model: "claude-sonnet-5-5",
      reasoningEffort: "high",
    });
  });

  it("locks the configured Plan branch and confirms it as the launch worktree", () => {
    const onConfirm = vi.fn();
    const draft = createDraft();
    render(
      <MemoryRouter>
        <PlanStageTaskMonitorSetupReview
          setup={{
            ...draft,
            provenance: {
              ...draft.provenance,
              planWorktreeBranch: "plan/shared-branch",
            },
          }}
          isRefreshingTaskServices={false}
          onRefreshTaskServices={vi.fn()}
          onConfirm={onConfirm}
        />
      </MemoryRouter>
    );

    expect(
      screen.getByTestId("plan-stage-task-monitor-worktree-toggle")
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByTestId("plan-stage-task-monitor-worktree-branch-name")
    ).toHaveValue("plan/shared-branch");
    expect(
      screen.getByTestId("plan-stage-task-monitor-worktree-branch-name")
    ).toBeDisabled();

    fireEvent.click(screen.getByTestId("plan-stage-task-monitor-confirm"));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        launchPolicy: expect.objectContaining({
          worktree: { enabled: true, branch: "plan/shared-branch" },
        }),
      }),
      ""
    );
  });

  it("keeps branchless Plan monitor worktree selection editable", () => {
    const onConfirm = vi.fn();
    render(
      <MemoryRouter>
        <PlanStageTaskMonitorSetupReview
          setup={createDraft()}
          isRefreshingTaskServices={false}
          onRefreshTaskServices={vi.fn()}
          onConfirm={onConfirm}
        />
      </MemoryRouter>
    );

    fireEvent.click(
      screen.getByTestId("plan-stage-task-monitor-worktree-toggle")
    );
    const branch = screen.getByTestId(
      "plan-stage-task-monitor-worktree-branch-name"
    );
    expect(branch).not.toBeDisabled();
    fireEvent.change(branch, { target: { value: "feature/monitor" } });
    fireEvent.click(screen.getByTestId("plan-stage-task-monitor-confirm"));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        launchPolicy: expect.objectContaining({
          worktree: { enabled: true, branch: "feature/monitor" },
        }),
      }),
      ""
    );
  });

  it.each([
    ["Review required", "REQUIRE_REVIEW"],
    ["Agent decides", "AGENT_DECIDES"],
  ] as const)("places %s into the confirmed definition", (label, mode) => {
    const onConfirm = vi.fn();
    const draft = createDraft();
    render(
      <MemoryRouter>
        <PlanStageTaskMonitorSetupReview
          setup={{
            ...draft,
            definition: {
              ...draft.definition,
              launchPolicy: {
                ...draft.definition.launchPolicy,
                terminalSupervision: {
                  mode:
                    mode === "REQUIRE_REVIEW"
                      ? "AGENT_DECIDES"
                      : "REQUIRE_REVIEW",
                },
              },
            },
          }}
          isRefreshingTaskServices={false}
          onRefreshTaskServices={vi.fn()}
          onConfirm={onConfirm}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("radio", { name: new RegExp(label) }));
    fireEvent.click(screen.getByTestId("plan-stage-task-monitor-confirm"));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        launchPolicy: expect.objectContaining({
          terminalSupervision: { mode },
        }),
      }),
      ""
    );
  });
});
