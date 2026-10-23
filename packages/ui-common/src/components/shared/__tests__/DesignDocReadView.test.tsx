import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskSource, WorkStatus, type TaskResponseDto } from "../../../api";
import { ProjectContext } from "../../../contexts";
import { EagerIntersectionObserver } from "../../../test/eagerIntersectionObserver";
import { DesignDocReadView } from "../DesignDocReadView";

// React Flow adopts arranged nodes through its store one tick after the
// surface leaves "arranging", so also wait for populated surfaces' cards.
const waitForDiagramArranged = () =>
  waitFor(
    () => {
      expect(
        document.querySelector('[data-workflow-view-mode="arranging"]')
      ).toBeNull();
      document
        .querySelectorAll(
          '[data-workflow-view-mode="natural-size"], [data-workflow-view-mode="fit-to-view"]'
        )
        .forEach((surface) =>
          expect(
            surface.querySelector('[data-testid="workflow-inline-step"]')
          ).not.toBeNull()
        );
    },
    { timeout: 5000 }
  );

const hookMocks = vi.hoisted(() => ({
  useWorkItemGraph: vi.fn(),
  useWorkItemTypeByKey: vi.fn(),
}));

vi.mock("../../../data/hooks/useWorkItemGraph", () => ({
  useWorkItemGraph: hookMocks.useWorkItemGraph,
}));

vi.mock("../../../data/hooks/useWorkItemTypes", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../data/hooks/useWorkItemTypes")
  >()),
  useWorkItemTypeByKey: hookMocks.useWorkItemTypeByKey,
}));

vi.mock("../MermaidCodeBlock", () => ({
  MermaidCodeBlock: ({ code }: { code: string }) => (
    <div data-testid="mock-mermaid">{code}</div>
  ),
}));

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MemoryRouter>
    <ThemeProvider theme={createTheme()}>{children}</ThemeProvider>
  </MemoryRouter>
);

const projectWrapper: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <MemoryRouter>
    <ThemeProvider theme={createTheme()}>
      <ProjectContext.Provider
        value={{
          organizationId: "org-1",
          projectId: "project-1",
          navigate: vi.fn(),
        }}
      >
        {children}
      </ProjectContext.Provider>
    </ThemeProvider>
  </MemoryRouter>
);

const makeTask = (
  overrides: Partial<TaskResponseDto> & Pick<TaskResponseDto, "id" | "name">
): TaskResponseDto => ({
  id: overrides.id,
  name: overrides.name,
  type: overrides.type ?? "STANDARD",
  sections: overrides.sections ?? [],
  organizationId: overrides.organizationId ?? "org-1",
  projectId: overrides.projectId ?? "project-1",
  status: overrides.status ?? WorkStatus.Backlog,
  source: overrides.source ?? TaskSource.System,
  edges: overrides.edges,
});

const makeWorkflow = (
  overrides: Omit<Partial<TaskResponseDto>, "type"> &
    Pick<TaskResponseDto, "id" | "name">
): TaskResponseDto & { type: "workflow" } => ({
  ...makeTask(overrides),
  type: "workflow",
});

const makeWorkflowStep = (
  overrides: Omit<Partial<TaskResponseDto>, "type"> &
    Pick<TaskResponseDto, "id" | "name">
): TaskResponseDto & { type: "workflow_step" } => ({
  ...makeTask(overrides),
  type: "workflow_step",
});

const setDefaultHookMocks = (): void => {
  hookMocks.useWorkItemGraph.mockReturnValue({
    data: null,
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: true,
    error: null,
    isStale: false,
    refetch: vi.fn(),
    markStale: vi.fn(),
  });
  hookMocks.useWorkItemTypeByKey.mockReturnValue({
    workItemTypeDefinition: {
      key: "workflow",
      name: "Workflow",
      sections: [],
      allowedStatuses: [],
      iconKey: "workflow",
    },
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: true,
    error: null,
    isStale: false,
    refetch: vi.fn(),
    markStale: vi.fn(),
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IntersectionObserver", EagerIntersectionObserver);
  setDefaultHookMocks();
});

describe("DesignDocReadView shared markdown rendering", () => {
  it("renders workflow mentions in sections through shared markdown", () => {
    render(
      <DesignDocReadView
        title="Workflow design"
        sections={[
          {
            key: "content",
            materializedMarkdown:
              "Use @[workflow:wf-1|Review workflow] for implementation.",
          },
        ]}
      />,
      { wrapper }
    );

    expect(screen.getByTestId("mention-badge")).toHaveTextContent(
      "Review workflow"
    );
  });

  it("renders inline workflow diagrams in design doc sections when graph data is loaded", async () => {
    const workflow = makeWorkflow({
      id: "wf-1",
      name: "Review workflow",
    });
    hookMocks.useWorkItemGraph.mockReturnValue({
      data: {
        root: workflow,
        children: [
          makeWorkflowStep({
            id: "step-1",
            name: "Review implementation",
            parentTaskId: "wf-1",
          }),
        ],
        relationships: [],
        layout: null,
        derivedReferences: [],
      },
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
      createTask: vi.fn(),
      createInitiative: vi.fn(),
      updateTask: vi.fn(),
      updateInitiative: vi.fn(),
      remove: vi.fn(),
    });

    render(
      <DesignDocReadView
        title="Workflow design"
        sections={[
          {
            key: "content",
            materializedMarkdown:
              "Use @[workflow:wf-1|Review workflow] for implementation.",
          },
        ]}
      />,
      { wrapper: projectWrapper }
    );
    await waitForDiagramArranged();

    expect(screen.getByTestId("workflow-inline-diagram")).toHaveTextContent(
      "Review workflow"
    );
    expect(screen.getByText("Review implementation")).toBeInTheDocument();
    expect(screen.queryByTestId("mention-badge")).not.toBeInTheDocument();
  });

  it("keeps workflow-unavailable fallback in design doc sections when workflow data is missing", () => {
    render(
      <DesignDocReadView
        title="Workflow design"
        sections={[
          {
            key: "content",
            materializedMarkdown:
              "Use @[workflow:wf-1|Review workflow] for implementation.",
          },
        ]}
      />,
      { wrapper: projectWrapper }
    );

    expect(
      screen.getByTestId("workflow-inline-diagram-unavailable")
    ).toHaveTextContent("Review workflow");
    expect(
      screen.queryByTestId("workflow-inline-diagram")
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("mention-badge")).not.toBeInTheDocument();
  });
});
