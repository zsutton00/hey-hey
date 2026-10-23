import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { type TaskMonitorExecutionDefinition } from "../../api";
import { PreviewHostProvider, ProjectContext } from "../../contexts";
import type { PlanStageTaskMonitorTaskSelection } from "./PlanStageTaskMonitorExecutionVisualization";
import type { PlanStageTaskMonitorExecutableTask } from "./planStageTaskMonitorSetup";
import { PlanStageTaskMonitorExecutionVisualization } from "./PlanStageTaskMonitorExecutionVisualization";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const MENTIONED_TASK_ID = "22222222-2222-4222-8222-222222222222";
const ORGANIZATION_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_ID = "55555555-5555-4555-8555-555555555555";

const definition: TaskMonitorExecutionDefinition = {
  executionPlan: [
    {
      taskId: TASK_ID,
      dependsOnTaskIds: [],
      launchConfiguration: {
        method: "quick",
        provider: "codex",
        model: "gpt-5.5",
        reasoningEffort: "medium",
      },
    },
  ],
  launchPolicy: {
    terminalSupervision: { mode: "AGENT_DECIDES" },
  },
  cursor: 0,
};

const createTask = (
  description: string | null
): PlanStageTaskMonitorExecutableTask => ({
  taskId: TASK_ID,
  label: "Prepare foundation",
  description,
  serviceIds: [],
});

const renderVisualization = (
  task: PlanStageTaskMonitorExecutableTask,
  taskSelection?: PlanStageTaskMonitorTaskSelection
): ReturnType<typeof vi.fn> => {
  const openPreview = vi.fn();
  render(
    <MemoryRouter>
      <ThemeProvider theme={createTheme()}>
        <ProjectContext.Provider
          value={{
            organizationId: ORGANIZATION_ID,
            projectId: PROJECT_ID,
            navigate: vi.fn(),
          }}
        >
          <PreviewHostProvider host={{ openPreview }}>
            <PlanStageTaskMonitorExecutionVisualization
              definition={definition}
              executableTasks={[task]}
              taskSelection={taskSelection}
            />
          </PreviewHostProvider>
        </ProjectContext.Provider>
      </ThemeProvider>
    </MemoryRouter>
  );
  return openPreview;
};

describe("PlanStageTaskMonitorExecutionVisualization", () => {
  it("renders ordinary task descriptions as Markdown", () => {
    renderVisualization(createTask("Use **bold** text and `inline code`."));

    const description = screen.getByTestId(
      "plan-stage-task-monitor-task-description"
    );
    expect(description).toHaveTextContent(
      "Use **bold** text and `inline code`."
    );
  });

  it("renders canonical description mentions as interactive links outside the preview control", () => {
    const mentionToken = `@[task:${MENTIONED_TASK_ID}|Referenced task]`;
    const openPreview = renderVisualization(
      createTask(`Review ${mentionToken} before continuing.`)
    );

    const mention = screen.getByTestId("mention-badge");
    expect(mention).toHaveAttribute("data-mention-token", mentionToken);
    expect(mention).toHaveAttribute("href");
    expect(screen.queryByText(mentionToken)).not.toBeInTheDocument();
    expect(
      screen.getByTestId("plan-stage-task-monitor-task-preview")
    ).not.toContainElement(mention);

    fireEvent.click(mention);
    expect(openPreview).not.toHaveBeenCalled();
  });

  it("shows the empty-description state without mounting a Markdown surface", () => {
    renderVisualization(createTask(null));

    expect(screen.getByText("No description provided.")).toBeInTheDocument();
    expect(
      screen.queryByTestId("plan-stage-task-monitor-task-description")
    ).not.toBeInTheDocument();
  });

  it("opens the canonical Task preview when its title is selected", () => {
    const openPreview = renderVisualization(createTask("Prepare it."));

    fireEvent.click(screen.getByTestId("plan-stage-task-monitor-task-preview"));

    expect(openPreview).toHaveBeenCalledWith({
      entityType: "task",
      entityId: TASK_ID,
    });
  });

  it("renders a checked selection control and emits the canonical Task identity", () => {
    const onToggleTask = vi.fn();
    renderVisualization(createTask("Prepare it."), {
      selectedTaskIds: new Set([TASK_ID]),
      onToggleTask,
    });

    const selection = screen.getByRole("checkbox");
    expect(selection).toBeChecked();

    fireEvent.click(selection);
    expect(onToggleTask).toHaveBeenCalledWith(TASK_ID);
  });
});
