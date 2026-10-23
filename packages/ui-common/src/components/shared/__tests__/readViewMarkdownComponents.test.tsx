import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import type { Components } from "react-markdown";
import { TaskSource, WorkStatus, type TaskResponseDto } from "../../../api";
import { ProjectContext } from "../../../contexts";
import { EagerIntersectionObserver } from "../../../test/eagerIntersectionObserver";
import { useReadViewMarkdownComponents } from "../readViewMarkdownComponents";

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
    <div data-testid="mock-mermaid-code-block">{code}</div>
  ),
}));

interface MarkdownAnchorProps extends React.ComponentProps<"a"> {
  node?: unknown;
}

interface MarkdownListItemProps extends React.ComponentProps<"li"> {
  node?: unknown;
  children?: React.ReactNode;
}

interface MarkdownCodeProps extends React.ComponentProps<"code"> {
  node?: unknown;
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ThemeProvider theme={createTheme()}>{children}</ThemeProvider>
);

const projectWrapper: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
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

const getReadViewComponents = (): Components => {
  const { result } = renderHook(() => useReadViewMarkdownComponents(), {
    wrapper,
  });

  return result.current;
};

describe("useReadViewMarkdownComponents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IntersectionObserver", EagerIntersectionObserver);
    setDefaultHookMocks();
  });

  it("routes fenced mermaid blocks to MermaidCodeBlock", async () => {
    const components = getReadViewComponents();
    const CodeComponent =
      components.code as React.ComponentType<MarkdownCodeProps>;

    render(
      <CodeComponent className="language-mermaid">
        {"graph TD;\nA-->B;"}
      </CodeComponent>
    );

    const mermaidBlock = await screen.findByTestId("mock-mermaid-code-block");
    expect(mermaidBlock).toHaveTextContent("graph TD;");
    expect(mermaidBlock).toHaveTextContent("A-->B;");
  });

  it("keeps non-mermaid fenced code as normal code blocks", () => {
    const components = getReadViewComponents();
    const CodeComponent =
      components.code as React.ComponentType<MarkdownCodeProps>;

    render(
      <CodeComponent className="language-ts">const value = 1;</CodeComponent>
    );

    const codeElement = screen.getByText("const value = 1;");
    expect(codeElement.tagName.toLowerCase()).toBe("code");
    expect(
      screen.queryByTestId("mock-mermaid-code-block")
    ).not.toBeInTheDocument();
  });

  it("keeps inline code as normal code even when class is mermaid", () => {
    const components = getReadViewComponents();
    const CodeComponent =
      components.code as React.ComponentType<MarkdownCodeProps>;

    render(
      <CodeComponent inline className="language-mermaid">
        {"inline value"}
      </CodeComponent>
    );

    const codeElement = screen.getByText("inline value");
    expect(codeElement.tagName.toLowerCase()).toBe("code");
    expect(
      screen.queryByTestId("mock-mermaid-code-block")
    ).not.toBeInTheDocument();
  });

  it("preserves existing link and list-item behavior", () => {
    const components = getReadViewComponents();
    const AnchorComponent =
      components.a as React.ComponentType<MarkdownAnchorProps>;
    const ListItemComponent =
      components.li as React.ComponentType<MarkdownListItemProps>;

    const { container } = render(
      <>
        <AnchorComponent href="https://example.com">Example</AnchorComponent>
        <ul>
          <ListItemComponent>
            {React.createElement("p", {}, "List item")}
          </ListItemComponent>
        </ul>
      </>
    );

    const anchor = screen.getByRole("link", { name: "Example" });
    expect(anchor).toHaveAttribute("target", "_blank");
    expect(anchor).toHaveAttribute("rel", "noopener noreferrer");

    const listItem = container.querySelector("li");
    expect(listItem).not.toBeNull();
    expect(listItem?.querySelector("p")).toBeNull();
    expect(listItem).toHaveTextContent("List item");
  });

  it("renders workflow mentions inline from flattened list items when graph data is loaded", async () => {
    const components = getReadViewComponents();
    const ListItemComponent =
      components.li as React.ComponentType<MarkdownListItemProps>;
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
      <ul>
        <ListItemComponent>
          {React.createElement(
            "p",
            {},
            "Use @[workflow:wf-1|Review workflow]."
          )}
        </ListItemComponent>
      </ul>,
      { wrapper: projectWrapper }
    );
    await waitForDiagramArranged();

    expect(screen.getByTestId("workflow-inline-diagram")).toHaveTextContent(
      "Review workflow"
    );
    expect(screen.getByText("Review implementation")).toBeInTheDocument();
    expect(screen.queryByTestId("mention-badge")).not.toBeInTheDocument();
  });

  it("parses escaped workflow mention tokens and keeps the workflow-unavailable fallback when graph data is missing", () => {
    const components = getReadViewComponents();
    const ListItemComponent =
      components.li as React.ComponentType<MarkdownListItemProps>;

    render(
      <ul>
        <ListItemComponent>
          {React.createElement(
            "p",
            {},
            "Use @\\[workflow:wf-1\\|Review workflow]."
          )}
        </ListItemComponent>
      </ul>,
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
