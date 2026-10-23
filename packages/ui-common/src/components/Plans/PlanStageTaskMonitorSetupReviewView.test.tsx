import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PreviewHostProvider } from "../../contexts/PreviewHostContext";
import { PlanStageTaskMonitorSetupReviewView } from "./PlanStageTaskMonitorSetupReviewView";

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
    showReasoningEffort,
  }: {
    reasoningEffort: string | null;
    showReasoningEffort?: boolean;
  }) =>
    showReasoningEffort === false ? null : (
      <div
        data-testid="plan-stage-task-monitor-runtime-effort-select"
        data-reasoning-effort={reasoningEffort ?? ""}
      />
    ),
}));

vi.mock("../Selectors/ServiceSelector", () => ({
  ServiceSelector: ({
    value,
    onChange,
    error,
    allowEmptySelection,
  }: {
    value: string[];
    onChange: (serviceIds: string[]) => void;
    error: boolean;
    allowEmptySelection: boolean;
  }) => (
    <button
      type="button"
      data-testid="mock-service-selector"
      data-error={String(error)}
      data-allow-empty-selection={String(allowEmptySelection)}
      onClick={() => onChange([...value, "service-selected"])}
    >
      {value.join(",") || "No services"}
    </button>
  ),
}));

const definition = {
  executionPlan: [
    {
      taskId: "task-1",
      dependsOnTaskIds: [],
      launchConfiguration: {
        method: "quick" as const,
        provider: "codex" as const,
        model: "gpt-5.5",
        reasoningEffort: "medium" as const,
      },
    },
    {
      taskId: "task-2",
      dependsOnTaskIds: ["task-1"],
      launchConfiguration: {
        method: "open" as const,
        provider: "codex" as const,
        model: "gpt-5.5",
        reasoningEffort: "medium" as const,
      },
    },
  ],
  launchPolicy: {
    terminalSupervision: { mode: "AGENT_DECIDES" as const },
  },
  cursor: 0,
};
const executableTasks = [
  {
    taskId: "task-1",
    label: "Prepare foundation",
    description: "Prepare it.",
    serviceIds: ["service-1", "service-2"],
  },
  {
    taskId: "task-2",
    label: "Implement feature",
    description: "Build it.",
    serviceIds: ["service-1"],
  },
];
const provenance = {
  organizationId: "org-1",
  projectId: "project-1",
  planId: "plan-1",
  planWorktreeBranch: null,
  planParentTaskId: "feature-1",
  planLabel: "Feature delivery",
  stageId: "stage-1",
  stageLabel: "Build the feature",
  preparedAt: "2026-07-14T01:02:03.000Z",
};
const runtimeProps = {
  onChangeMethod: vi.fn(),
  onChangeProvider: vi.fn(),
  onChangeModel: vi.fn(),
  onChangeReasoningEffort: vi.fn(),
  onChangeReviewMode: vi.fn(),
  worktreeBranch: null,
  worktreeLocked: false,
  onChangeWorktreeBranch: vi.fn(),
  taskSelection: {
    selectedTaskIds: new Set(["task-1", "task-2"]),
    onToggleTask: vi.fn(),
  },
};

describe("PlanStageTaskMonitorSetupReviewView", () => {
  it("renders the immutable ordered plan, dependencies, preview, message, and confirmation", () => {
    const onChangeUserMessage = vi.fn();
    const onConfirm = vi.fn();
    const openPreview = vi.fn();
    render(
      <PreviewHostProvider host={{ openPreview }}>
        <PlanStageTaskMonitorSetupReviewView
          definition={definition}
          {...runtimeProps}
          executableTasks={executableTasks}
          provenance={provenance}
          userMessage=""
          userMessageMentionConfig={{
            organizationId: "org-1",
            projectId: "project-1",
          }}
          userMessageEntitySlashConfig={{
            organizationId: "org-1",
            projectId: "project-1",
            focalEntity: {
              kind: "entity",
              entityType: "PLAN_STAGE",
              entityId: "stage-1",
            },
            onSearchEntities: vi.fn(),
          }}
          onChangeUserMessage={onChangeUserMessage}
          isRefreshingTaskServices={false}
          updatingTaskServiceIds={[]}
          serviceUpdateError={null}
          onChangeTaskServices={vi.fn()}
          onRefreshTaskServices={vi.fn()}
          onConfirm={onConfirm}
        />
      </PreviewHostProvider>
    );

    const visualization = screen.getByTestId(
      "plan-stage-task-monitor-execution-visualization"
    );
    expect(visualization).toHaveTextContent("Prepare foundation");
    expect(visualization).toHaveTextContent("Implement feature");
    expect(visualization).toHaveTextContent("Depends on Prepare foundation");
    expect(
      screen
        .getAllByTestId("mock-service-selector")
        .every((selector) => selector.dataset.allowEmptySelection === "false")
    ).toBe(true);
    expect(
      screen.getByTestId("plan-stage-task-monitor-worktree-toggle")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("plan-stage-task-monitor-policies")
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByTestId("plan-stage-task-monitor-runtime-effort-select")
    ).toHaveLength(2);
    expect(
      screen
        .getAllByRole("checkbox")
        .every((selection) => (selection as HTMLInputElement).checked)
    ).toBe(true);
    expect(
      visualization.querySelectorAll(
        '[data-testid="plan-stage-task-monitor-task-launch-configuration"]'
      )
    ).toHaveLength(2);
    expect(
      screen.getByTestId("plan-stage-task-monitor-launch-configuration")
    ).not.toContainElement(
      screen.getAllByTestId("plan-stage-task-monitor-runtime-effort-select")[0]
    );
    expect(screen.getByText("Shared session settings")).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByTestId("plan-stage-task-monitor-task-preview")[1]
    );
    expect(openPreview).toHaveBeenCalledWith({
      entityType: "task",
      entityId: "task-2",
    });
    fireEvent.change(screen.getByTestId("task-monitor-user-message-editor"), {
      target: { value: "Focus on the contract" },
    });
    expect(onChangeUserMessage).toHaveBeenCalledWith("Focus on the contract");
    fireEvent.click(screen.getByTestId("plan-stage-task-monitor-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("blocks confirmation when the selection is empty", () => {
    render(
      <PreviewHostProvider host={{ openPreview: vi.fn() }}>
        <PlanStageTaskMonitorSetupReviewView
          definition={definition}
          {...runtimeProps}
          taskSelection={{
            selectedTaskIds: new Set(),
            onToggleTask: vi.fn(),
          }}
          executableTasks={executableTasks}
          provenance={provenance}
          userMessage=""
          userMessageMentionConfig={{
            organizationId: "org-1",
            projectId: "project-1",
          }}
          userMessageEntitySlashConfig={{
            organizationId: "org-1",
            projectId: "project-1",
            focalEntity: {
              kind: "entity",
              entityType: "PLAN_STAGE",
              entityId: "stage-1",
            },
            onSearchEntities: vi.fn(),
          }}
          onChangeUserMessage={vi.fn()}
          isRefreshingTaskServices={false}
          updatingTaskServiceIds={[]}
          serviceUpdateError={null}
          onChangeTaskServices={vi.fn()}
          onRefreshTaskServices={vi.fn()}
          onConfirm={vi.fn()}
        />
      </PreviewHostProvider>
    );

    expect(
      screen.getByTestId("plan-stage-task-monitor-confirm")
    ).toBeDisabled();
  });

  it("blocks Start and identifies every task without a Service in its selector", () => {
    const onConfirm = vi.fn();
    const onRefreshTaskServices = vi.fn();
    const openPreview = vi.fn();
    const blockedTasks = executableTasks.map((task) => ({
      ...task,
      serviceIds: [],
    }));

    const { rerender } = render(
      <PreviewHostProvider host={{ openPreview }}>
        <PlanStageTaskMonitorSetupReviewView
          definition={definition}
          {...runtimeProps}
          executableTasks={blockedTasks}
          provenance={provenance}
          userMessage=""
          userMessageMentionConfig={{
            organizationId: "org-1",
            projectId: "project-1",
          }}
          userMessageEntitySlashConfig={{
            organizationId: "org-1",
            projectId: "project-1",
            focalEntity: {
              kind: "entity",
              entityType: "PLAN_STAGE",
              entityId: "stage-1",
            },
            onSearchEntities: vi.fn(),
          }}
          onChangeUserMessage={vi.fn()}
          isRefreshingTaskServices={false}
          updatingTaskServiceIds={[]}
          serviceUpdateError={null}
          onChangeTaskServices={vi.fn()}
          onRefreshTaskServices={onRefreshTaskServices}
          onConfirm={onConfirm}
        />
      </PreviewHostProvider>
    );

    expect(
      screen.getAllByTestId("plan-stage-task-monitor-task-services")
    ).toHaveLength(2);
    expect(
      screen
        .getAllByTestId("mock-service-selector")
        .every((selector) => selector.dataset.error === "true")
    ).toBe(true);
    expect(
      screen.getByTestId("plan-stage-task-monitor-confirm")
    ).toBeDisabled();
    fireEvent.click(
      screen.getByTestId("plan-stage-task-monitor-refresh-services")
    );
    expect(onRefreshTaskServices).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    rerender(
      <PreviewHostProvider host={{ openPreview }}>
        <PlanStageTaskMonitorSetupReviewView
          definition={definition}
          {...runtimeProps}
          executableTasks={executableTasks}
          provenance={provenance}
          userMessage=""
          userMessageMentionConfig={{
            organizationId: "org-1",
            projectId: "project-1",
          }}
          userMessageEntitySlashConfig={{
            organizationId: "org-1",
            projectId: "project-1",
            focalEntity: {
              kind: "entity",
              entityType: "PLAN_STAGE",
              entityId: "stage-1",
            },
            onSearchEntities: vi.fn(),
          }}
          onChangeUserMessage={vi.fn()}
          isRefreshingTaskServices={false}
          updatingTaskServiceIds={[]}
          serviceUpdateError={null}
          onChangeTaskServices={vi.fn()}
          onRefreshTaskServices={onRefreshTaskServices}
          onConfirm={onConfirm}
        />
      </PreviewHostProvider>
    );

    expect(
      screen.queryByTestId("plan-stage-task-monitor-missing-services")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("plan-stage-task-monitor-confirm")).toBeEnabled();
  });

  it("stays blocked during a canonical relation refresh", () => {
    render(
      <PreviewHostProvider host={{ openPreview: vi.fn() }}>
        <PlanStageTaskMonitorSetupReviewView
          definition={definition}
          {...runtimeProps}
          executableTasks={executableTasks}
          provenance={provenance}
          userMessage=""
          userMessageMentionConfig={{
            organizationId: "org-1",
            projectId: "project-1",
          }}
          userMessageEntitySlashConfig={{
            organizationId: "org-1",
            projectId: "project-1",
            focalEntity: {
              kind: "entity",
              entityType: "PLAN_STAGE",
              entityId: "stage-1",
            },
            onSearchEntities: vi.fn(),
          }}
          onChangeUserMessage={vi.fn()}
          isRefreshingTaskServices
          updatingTaskServiceIds={[]}
          serviceUpdateError={null}
          onChangeTaskServices={vi.fn()}
          onRefreshTaskServices={vi.fn()}
          onConfirm={vi.fn()}
        />
      </PreviewHostProvider>
    );

    expect(
      screen.getByTestId("plan-stage-task-monitor-confirm")
    ).toBeDisabled();
  });
});
