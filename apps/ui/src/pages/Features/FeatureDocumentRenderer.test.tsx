import React from "react";
import {
  TargetEntityType,
  type WorkItemTypeDefinitionDto,
} from "@hey-hey/ui-common/api";
import { createHeyTheme } from "@hey-hey/ui-common/context";
import { Box, type SxProps, type Theme } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import userEvent from "@testing-library/user-event";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

interface InteractionComponentProps {
  children: React.ReactNode;
  disablePreview?: boolean;
  draggable?: boolean;
  entityId: string;
  entityType: TargetEntityType;
  hasProposalSupport: boolean;
  indicatorOffsetX?: number;
  indicatorOffsetY?: number;
  organizationId?: string;
  projectId?: string;
  entityTitle?: string;
  inlineActions?: Array<{
    action: "discuss" | "create_task" | "create_bug";
    label: string;
    icon?: React.ElementType;
    onSelect?: () => void;
    testId?: string;
  }>;
}

interface MarkdownRendererProps {
  children?: React.ReactNode;
  sx?: SxProps<Theme>;
  badgeMentions?: boolean;
}

interface StructuredRequirementProps {
  requirements: Array<{ id: string; statement: string; group?: string | null }>;
  previewLimit?: number;
  previewExpanded?: boolean;
  onTogglePreview?: () => void;
}

const mockInteractionComponent = vi.fn();

vi.mock("./FeatureSectionVisuals", () => ({
  FeatureSectionVisuals: ({ featureId }: { featureId: string }) => (
    <div data-testid={`feature-section-visuals-${featureId}`}>
      Visual previews
    </div>
  ),
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  InteractionComponent: (props: InteractionComponentProps) => {
    mockInteractionComponent(props);
    return (
      <div
        data-testid={`feature-document-interaction-${props.entityId}`}
        data-draggable={String(props.draggable)}
      >
        {props.children}
      </div>
    );
  },
  MarkdownRenderer: ({
    children,
    sx,
    badgeMentions,
  }: MarkdownRendererProps) => {
    const workflowEdgeLocation =
      typeof children === "string"
        ? children.match(
            /\[\[WORKFLOW_EDGE:(description|requirements)\]\]/,
          )?.[1]
        : undefined;

    return (
      <Box
        data-testid="markdown-renderer"
        data-badge-mentions={String(!!badgeMentions)}
        sx={sx}
      >
        {workflowEdgeLocation ? (
          <svg
            data-testid={`workflow-edge-layer-${workflowEdgeLocation}`}
            width="240"
            height="120"
            viewBox="0 0 240 120"
            aria-label={`${workflowEdgeLocation} workflow edge`}
          >
            <path
              data-testid={`workflow-edge-path-${workflowEdgeLocation}`}
              d="M 20 60 C 80 20, 160 100, 220 60"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
        ) : (
          children
        )}
      </Box>
    );
  },
  StructuredRequirementsView: ({
    requirements,
    previewLimit,
    previewExpanded,
    onTogglePreview,
  }: StructuredRequirementProps) => {
    const hasOverflow =
      previewLimit !== undefined && requirements.length > previewLimit;
    const isPreviewing = hasOverflow && !previewExpanded;
    return (
      <div data-testid="structured-requirements">
        {(isPreviewing
          ? requirements.slice(0, previewLimit)
          : requirements
        ).map((requirement) => (
          <div
            key={requirement.id}
            data-testid="structured-requirement-row"
            data-requirement-id={requirement.id}
            data-requirement-group={requirement.group ?? undefined}
          >
            {requirement.statement}
          </div>
        ))}
        {hasOverflow ? (
          <button
            type="button"
            data-testid="structured-requirements-show-all"
            onClick={onTogglePreview}
          >
            {previewExpanded ? "Show less" : "View all"}
          </button>
        ) : null}
      </div>
    );
  },
}));

interface MockSection {
  key: string;
  materializedMarkdown: string;
  order: number;
  id: string;
  crdtSnapshotSeq: null;
}

interface MockFeature {
  id: string;
  name: string;
  sections?: MockSection[];
}

interface MockNode {
  feature: MockFeature;
  children: MockNode[];
}

const section = (key: string, content: string): MockSection => ({
  key,
  materializedMarkdown: content,
  order: 0,
  id: `sec-${key}`,
  crdtSnapshotSeq: null,
});

import { FeatureDocumentRenderer as SectionRenderer } from "./FeatureDocumentRenderer";

// The renderer draws one section; the Document view lays children out beneath
// it. This stand-in stacks a node's subtree the same way so layout assertions
// can span parent and child sections.
const FeatureDocumentRenderer: React.FC<
  React.ComponentProps<typeof SectionRenderer>
> = ({ node, depth = 1, ...props }) => (
  <>
    <SectionRenderer node={node} depth={depth} {...props} />
    {node.children.map((child) => (
      <FeatureDocumentRenderer
        key={child.feature.id}
        {...props}
        node={child as typeof node}
        depth={depth + 1}
      />
    ))}
  </>
);

const canonicalFeatureDefinition: WorkItemTypeDefinitionDto = {
  key: "FEATURE",
  name: "Feature",
  role: "project-info",
  sections: [
    {
      key: "requirements",
      label: "Requirements",
      kind: "json",
      schemaRef: "#/components/schemas/FeatureRequirementsSection",
    },
  ],
  allowedStatuses: [],
};

const makeNode = (
  id: string,
  name: string,
  description: string,
  children: MockNode[] = [],
  requirements = "",
): MockNode => ({
  feature: {
    id,
    name,
    sections: [
      ...(description ? [section("description", description)] : []),
      ...(requirements
        ? [
            section(
              "requirements",
              JSON.stringify({
                records: [
                  {
                    id: crypto.randomUUID(),
                    statement: requirements,
                    designedBy: [],
                    fulfilledBy: [],
                    contracts: [],
                  },
                ],
              }),
            ),
          ]
        : []),
    ],
  },
  children,
});

const renderNode = (node: MockNode): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <FeatureDocumentRenderer
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        node={node as any}
        organizationId="org-1"
        projectId="project-1"
        workItemTypeDefinition={canonicalFeatureDefinition}
        onCreateWorkItem={vi.fn()}
      />
    </MemoryRouter>,
  );

const renderNodeWithActiveSection = (
  node: MockNode,
  activeSectionId: string,
): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <FeatureDocumentRenderer
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        node={node as any}
        organizationId="org-1"
        projectId="project-1"
        workItemTypeDefinition={canonicalFeatureDefinition}
        activeSectionId={activeSectionId}
        onCreateWorkItem={vi.fn()}
      />
    </MemoryRouter>,
  );

const renderNodeWithSharedTheme = (node: MockNode): ReturnType<typeof render> =>
  render(
    <ThemeProvider theme={createHeyTheme("light")}>
      <MemoryRouter>
        <FeatureDocumentRenderer
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          node={node as any}
          organizationId="org-1"
          projectId="project-1"
          workItemTypeDefinition={canonicalFeatureDefinition}
          onCreateWorkItem={vi.fn()}
        />
      </MemoryRouter>
    </ThemeProvider>,
  );

describe("FeatureDocumentRenderer", () => {
  it("places each section's previews after Requirements, including mobile read-only sections", () => {
    const node = makeNode(
      "root",
      "Root",
      "Description",
      [
        makeNode(
          "child",
          "Child",
          "Child description",
          [],
          "Child requirement",
        ),
      ],
      "Root requirement",
    );
    render(
      <MemoryRouter>
        <FeatureDocumentRenderer
          node={
            node as unknown as React.ComponentProps<
              typeof FeatureDocumentRenderer
            >["node"]
          }
          organizationId="org-1"
          projectId="project-1"
          workItemTypeDefinition={canonicalFeatureDefinition}
          showSectionActions={false}
          onCreateWorkItem={vi.fn()}
        />
      </MemoryRouter>,
    );
    for (const id of ["root", "child"]) {
      const interaction = screen.getByTestId(
        `feature-document-interaction-${id}`,
      );
      const requirements = within(interaction).getByTestId(
        `feature-document-requirements-${id}`,
      );
      const visuals = within(interaction).getByTestId(
        `feature-section-visuals-${id}`,
      );
      expect(
        requirements.compareDocumentPosition(visuals) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        mockInteractionComponent.mock.calls.find(
          ([props]) => props.entityId === id,
        )?.[0].inlineActions,
      ).toBeUndefined();
    }
  });
  it("keeps the canonical heading through loading and retryable content errors", async () => {
    const retry = vi.fn();
    const node = {
      feature: {
        id: "loading-feature",
        name: "Canonical title",
        type: "FEATURE",
        parentTaskId: null,
      },
      children: [],
    };
    const props = {
      node,
      organizationId: "org",
      projectId: "project",
      onCreateWorkItem: vi.fn(),
      onRetryContent: retry,
    };
    const { rerender } = render(
      <MemoryRouter>
        <FeatureDocumentRenderer
          {...props}
          contentState={{ status: "loading" }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading section");
    expect(screen.getByText("Canonical title")).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <FeatureDocumentRenderer
          {...props}
          contentState={{ status: "error" }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Canonical title")).toBeInTheDocument();
  });

  it("wraps every recursive feature section in non-draggable entity context", () => {
    const tree = makeNode("p", "Parent", "Parent body", [
      makeNode("c", "Child", "Child body", []),
    ]);

    renderNode(tree);

    expect(mockInteractionComponent).toHaveBeenCalledWith(
      expect.objectContaining({
        draggable: false,
        disablePreview: true,
        entityId: "p",
        entityType: TargetEntityType.Task,
        entityTitle: "Parent",
        hasProposalSupport: true,
        indicatorOffsetX: -12,
        indicatorOffsetY: -12,
        organizationId: "org-1",
        projectId: "project-1",
      }),
    );
    expect(mockInteractionComponent).toHaveBeenCalledWith(
      expect.objectContaining({
        draggable: false,
        disablePreview: true,
        entityId: "c",
        entityType: TargetEntityType.Task,
        entityTitle: "Child",
        hasProposalSupport: true,
        organizationId: "org-1",
        projectId: "project-1",
      }),
    );
    expect(
      screen.getByTestId("feature-document-interaction-p"),
    ).toHaveAttribute("data-draggable", "false");
    expect(
      screen.getByTestId("feature-document-interaction-c"),
    ).toHaveAttribute("data-draggable", "false");
  });

  it("assigns each recursive section its own inline action identities", () => {
    const tree = makeNode("p", "Parent", "Parent body", [
      makeNode("c", "Child", "Child body", []),
    ]);
    mockInteractionComponent.mockClear();

    renderNode(tree);

    expect(mockInteractionComponent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "p",
        inlineActions: [
          {
            action: "discuss",
            label: "Discuss",
            icon: expect.anything(),
            testId: "feature-document-discuss-p",
          },
          {
            action: "create_task",
            label: "Add Task",
            icon: expect.anything(),
            onSelect: expect.any(Function),
            testId: "feature-document-add-task-p",
          },
          {
            action: "create_bug",
            label: "Add Bug",
            icon: expect.anything(),
            onSelect: expect.any(Function),
            testId: "feature-document-add-bug-p",
          },
        ],
      }),
    );
    expect(mockInteractionComponent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "c",
        inlineActions: [
          {
            action: "discuss",
            label: "Discuss",
            icon: expect.anything(),
            testId: "feature-document-discuss-c",
          },
          {
            action: "create_task",
            label: "Add Task",
            icon: expect.anything(),
            onSelect: expect.any(Function),
            testId: "feature-document-add-task-c",
          },
          {
            action: "create_bug",
            label: "Add Bug",
            icon: expect.anything(),
            onSelect: expect.any(Function),
            testId: "feature-document-add-bug-c",
          },
        ],
      }),
    );
  });

  it("can keep section actions out of a read-only document surface", () => {
    const tree = makeNode("p", "Parent", "Parent body", [
      makeNode("c", "Child", "Child body", []),
    ]);
    mockInteractionComponent.mockClear();

    render(
      <MemoryRouter>
        <FeatureDocumentRenderer
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          node={tree as any}
          organizationId="org-1"
          projectId="project-1"
          showSectionActions={false}
          onCreateWorkItem={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(mockInteractionComponent).toHaveBeenCalledWith(
      expect.not.objectContaining({ inlineActions: expect.anything() }),
    );
  });

  it("keeps nested feature sections outside their parent's interaction region", () => {
    const tree = makeNode("p", "Parent", "Parent body", [
      makeNode("c", "Child", "Child body", []),
    ]);

    renderNode(tree);

    const parentInteraction = screen.getByTestId(
      "feature-document-interaction-p",
    );
    const childInteraction = screen.getByTestId(
      "feature-document-interaction-c",
    );

    expect(
      within(parentInteraction).queryByTestId("feature-document-section-c"),
    ).not.toBeInTheDocument();
    expect(
      within(childInteraction).getByTestId("feature-document-heading-c"),
    ).toBeInTheDocument();
  });

  it("renders the root feature name as a heading link with its description below it", () => {
    renderNode(makeNode("f-root", "Root Feature", "Root description body"));

    const heading = screen.getByTestId("feature-document-heading-f-root");
    expect(heading.tagName).toBe("A");
    expect(heading).toHaveAttribute(
      "href",
      "/projects/project-1/features/f-root",
    );
    expect(heading).toHaveTextContent("Root Feature");

    const description = screen.getByTestId(
      "feature-document-description-f-root",
    );
    expect(
      within(description).getByTestId("markdown-renderer"),
    ).toHaveTextContent("Root description body");
    // Mentions in descriptions stay badges and never expand into visuals.
    expect(
      within(description).getByTestId("markdown-renderer"),
    ).toHaveAttribute("data-badge-mentions", "true");
  });

  it("contains narrow-panel content at every document boundary", () => {
    const tree = makeNode(
      "f-wide",
      "A feature name with an intentionally long unbroken identifier that must wrap",
      "A description with ordinary text and a wide Markdown block.",
    );

    renderNode(tree);

    const sectionStyle = getComputedStyle(
      screen.getByTestId("feature-document-section-f-wide"),
    );
    expect(sectionStyle.width).toBe("100%");
    expect(sectionStyle.maxWidth).toBe("100%");
    expect(sectionStyle.minWidth).toBe("0");

    const surfaceStyle = getComputedStyle(
      screen.getByTestId("feature-document-surface-f-wide"),
    );
    expect(surfaceStyle.width).toBe("100%");
    expect(surfaceStyle.maxWidth).toBe("100%");
    expect(surfaceStyle.minWidth).toBe("0");

    const interactionWrapperStyle = getComputedStyle(
      screen.getByTestId("feature-document-interaction-wrapper-f-wide"),
    );
    expect(interactionWrapperStyle.width).toBe("100%");
    expect(interactionWrapperStyle.maxWidth).toBe("100%");
    expect(interactionWrapperStyle.minWidth).toBe("0");

    const headingStyle = getComputedStyle(
      screen.getByTestId("feature-document-heading-f-wide"),
    );
    expect(headingStyle.display).toBe("block");
    expect(headingStyle.width).toBe("100%");
    expect(headingStyle.maxWidth).toBe("100%");
    expect(headingStyle.overflowWrap).toBe("anywhere");
    expect(headingStyle.wordBreak).toBe("break-word");

    const description = screen.getByTestId(
      "feature-document-description-f-wide",
    );
    const descriptionStyle = getComputedStyle(description);
    expect(descriptionStyle.width).toBe("100%");
    expect(descriptionStyle.maxWidth).toBe("100%");
    expect(descriptionStyle.minWidth).toBe("0");
    expect(descriptionStyle.overflowWrap).toBe("anywhere");
    expect(descriptionStyle.wordBreak).toBe("break-word");

    const markdownStyle = getComputedStyle(
      screen.getByTestId("markdown-renderer"),
    );
    expect(markdownStyle.width).toBe("100%");
    expect(markdownStyle.maxWidth).toBe("100%");
    expect(markdownStyle.minWidth).toBe("0");
    expect(markdownStyle.overflowWrap).toBe("anywhere");
    expect(markdownStyle.wordBreak).toBe("break-word");
  });

  it("renders every feature heading as an anchor regardless of depth", () => {
    const tree = makeNode("d1", "Depth 1", "", [
      makeNode("d2", "Depth 2", "", [
        makeNode("d3", "Depth 3", "", [makeNode("d4", "Depth 4", "", [])]),
      ]),
    ]);

    renderNode(tree);

    expect(screen.getByTestId("feature-document-heading-d1").tagName).toBe("A");
    expect(screen.getByTestId("feature-document-heading-d2").tagName).toBe("A");
    expect(screen.getByTestId("feature-document-heading-d3").tagName).toBe("A");
    expect(screen.getByTestId("feature-document-heading-d4").tagName).toBe("A");
  });

  it("uses Work Sans for every heading link", () => {
    const tree = makeNode("d1", "Depth 1", "", [
      makeNode("d2", "Depth 2", "", []),
    ]);

    renderNodeWithSharedTheme(tree);

    expect(screen.getByTestId("feature-document-heading-d1")).toHaveStyle({
      fontFamily:
        '"Work Sans", "Atkinson Hyperlegible", "Roboto", "Helvetica", "Arial", sans-serif',
      fontWeight: "900",
      letterSpacing: "0.05em",
    });
    expect(screen.getByTestId("feature-document-heading-d2")).toHaveStyle({
      fontFamily:
        '"Work Sans", "Atkinson Hyperlegible", "Roboto", "Helvetica", "Arial", sans-serif',
      fontWeight: "600",
    });
  });

  it("renders the document with exactly two feature-title sizes", () => {
    const tree = makeNode("d1", "Depth 1", "", [
      makeNode("d2", "Depth 2", "", [makeNode("d3", "Depth 3", "", [])]),
    ]);

    renderNode(tree);

    expect(screen.getByTestId("feature-document-heading-d1")).toHaveStyle({
      fontSize: "2.5rem",
    });
    expect(screen.getByTestId("feature-document-heading-d2")).toHaveStyle({
      fontSize: "1.5rem",
    });
    expect(screen.getByTestId("feature-document-heading-d3")).toHaveStyle({
      fontSize: "1.5rem",
    });
  });

  it("highlights only the active section throughout the recursive document", () => {
    const tree = makeNode("p", "Parent", "", [
      makeNode("c", "Child", "", [makeNode("g", "Grandchild", "", [])]),
    ]);

    renderNodeWithActiveSection(tree, "g");

    expect(screen.getByTestId("feature-document-section-p")).toHaveAttribute(
      "data-active",
      "false",
    );
    expect(screen.getByTestId("feature-document-section-c")).toHaveAttribute(
      "data-active",
      "false",
    );
    expect(screen.getByTestId("feature-document-section-g")).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByTestId("feature-document-heading-g")).toHaveAttribute(
      "aria-current",
      "location",
    );
    const activeSection = screen.getByTestId("feature-document-section-g");
    const activeSurface = screen.getByTestId("feature-document-surface-g");
    expect(getComputedStyle(activeSurface).backgroundColor).not.toBe(
      getComputedStyle(screen.getByTestId("feature-document-surface-c"))
        .backgroundColor,
    );
    expect(activeSurface).toHaveStyle({
      backgroundColor: "rgba(66, 165, 245, 0.3)",
      borderRadius: "",
      borderTopWidth: "2px",
      borderTopStyle: "solid",
    });
    expect(activeSurface).toHaveStyle({
      borderTopColor: "rgba(25, 118, 210, 0.45)",
    });
    expect(
      within(activeSurface).queryByTestId("feature-document-divider-g"),
    ).not.toBeInTheDocument();
    expect(activeSection).not.toHaveStyle({
      backgroundColor: "rgba(66, 165, 245, 0.3)",
    });
    expect(screen.getByTestId("feature-document-heading-g")).toHaveStyle({
      borderLeftWidth: "",
    });
  });

  it("renders only its own section, never its children", () => {
    const tree = makeNode("p", "Parent", "Parent body", [
      makeNode("c", "Child", "Child body", []),
    ]);

    render(
      <MemoryRouter>
        <SectionRenderer
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          node={tree as any}
          organizationId="org-1"
          projectId="project-1"
          workItemTypeDefinition={canonicalFeatureDefinition}
          onCreateWorkItem={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("feature-document-section-p")).toHaveAttribute(
      "data-depth",
      "1",
    );
    expect(screen.queryByTestId("feature-document-section-c")).toBeNull();
  });

  it("offers to show sub-features and selects the section when activated", async () => {
    const tree = makeNode("p", "Parent", "Parent body", []);
    const onShowSubFeatures = vi.fn();

    render(
      <MemoryRouter>
        <SectionRenderer
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          node={tree as any}
          organizationId="org-1"
          projectId="project-1"
          subFeatureCount={3}
          subFeaturesHref="?section=p"
          onShowSubFeatures={onShowSubFeatures}
          onCreateWorkItem={vi.fn()}
        />
      </MemoryRouter>,
    );

    const control = screen.getByTestId("feature-document-show-sub-features-p");
    expect(control).toHaveTextContent(/sub-features/);
    expect(control).toHaveAttribute("href", "?section=p");
    control.click();
    expect(onShowSubFeatures).toHaveBeenCalledTimes(1);
  });

  it("exposes a stable feature-id anchor on each section", () => {
    const tree = makeNode("p", "Parent", "", [makeNode("c", "Child", "", [])]);

    renderNode(tree);

    expect(screen.getByTestId("feature-document-section-p")).toHaveAttribute(
      "data-feature-id",
      "p",
    );
    expect(screen.getByTestId("feature-document-section-c")).toHaveAttribute(
      "data-feature-id",
      "c",
    );
  });

  it("renders each feature's heading as a link to that feature's page", () => {
    const tree = makeNode("p", "Parent", "Parent body", [
      makeNode("c", "Child", "", []),
    ]);

    renderNode(tree);

    const parentHeading = screen.getByTestId("feature-document-heading-p");
    expect(parentHeading.tagName).toBe("A");
    expect(parentHeading).toHaveAttribute(
      "href",
      "/projects/project-1/features/p",
    );
    const childHeading = screen.getByTestId("feature-document-heading-c");
    expect(childHeading.tagName).toBe("A");
    expect(childHeading).toHaveAttribute(
      "href",
      "/projects/project-1/features/c",
    );
  });

  it("renders a divider before each non-root section but not before the root", () => {
    const tree = makeNode("p", "Parent", "Parent body", [
      makeNode("c1", "Child One", "", []),
      makeNode("c2", "Child Two", "", []),
    ]);

    renderNode(tree);

    expect(
      screen.queryByTestId("feature-document-divider-p"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("feature-document-divider-c1"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("feature-document-divider-c2"),
    ).toBeInTheDocument();
  });

  it("omits the description block when the feature has no description section", () => {
    renderNode(makeNode("f-empty", "Empty Feature", ""));

    expect(
      screen.getByTestId("feature-document-heading-f-empty"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("feature-document-description-f-empty"),
    ).not.toBeInTheDocument();
  });

  it("expands a feature's requirements below its description", async () => {
    const node: MockNode = {
      feature: {
        id: "f-reqs",
        name: "With Requirements",
        sections: [
          section("description", "Only this description should render"),
          section(
            "requirements",
            JSON.stringify({
              records: [
                {
                  id: "22222222-2222-4222-8222-222222222222",
                  statement: "REQUIREMENTS_SHOULD_RENDER",
                  designedBy: [],
                  fulfilledBy: [],
                  contracts: [],
                },
              ],
            }),
          ),
          section("acceptanceCriteria", "ACCEPTANCE_SHOULD_NOT_LEAK"),
        ],
      },
      children: [],
    };

    renderNode(node);

    const description = screen.getByTestId(
      "feature-document-description-f-reqs",
    );
    expect(description).toHaveTextContent(
      "Only this description should render",
    );
    expect(description).not.toHaveTextContent("ACCEPTANCE_SHOULD_NOT_LEAK");
    expect(
      screen.getByTestId("feature-document-requirements-f-reqs"),
    ).toHaveTextContent("Requirements");
    expect(
      screen.getByTestId("feature-document-requirements-content-f-reqs"),
    ).toHaveTextContent("REQUIREMENTS_SHOULD_RENDER");
    expect(screen.queryByText(/ACCEPTANCE_SHOULD_NOT_LEAK/)).toBeNull();
  });

  it("renders the authoritative structured requirements in the disclosure", async () => {
    const node: MockNode = {
      feature: {
        id: "f-structured-reqs",
        name: "Structured Requirements",
        sections: [
          section(
            "requirements",
            JSON.stringify({
              records: [
                {
                  id: "33333333-3333-4333-8333-333333333333",
                  statement: "Ungrouped requirement",
                  designedBy: [],
                  fulfilledBy: [],
                  contracts: [],
                },
                {
                  id: "44444444-4444-4444-8444-444444444444",
                  statement: "Grouped requirement",
                  group: "Access",
                  designedBy: [],
                  fulfilledBy: [],
                  contracts: [],
                },
              ],
            }),
          ),
        ],
      },
      children: [],
    };

    renderNode(node);

    expect(screen.getByTestId("structured-requirements")).toHaveTextContent(
      "Ungrouped requirement",
    );
    expect(screen.getByTestId("structured-requirements")).toHaveTextContent(
      "Grouped requirement",
    );
    expect(screen.queryByText("legacy markdown")).not.toBeInTheDocument();
  });

  it("preserves workflow edge layers in the description", () => {
    renderNode(
      makeNode(
        "f-workflow-edges",
        "Workflow Edges",
        "[[WORKFLOW_EDGE:description]]",
      ),
    );

    const description = screen.getByTestId(
      "feature-document-description-f-workflow-edges",
    );
    const descriptionEdge = within(description).getByTestId(
      "workflow-edge-layer-description",
    );
    expect(
      within(descriptionEdge).getByTestId("workflow-edge-path-description"),
    ).toHaveAttribute("stroke", "currentColor");
    expect(getComputedStyle(descriptionEdge).height).not.toBe("auto");
  });

  it("previews the first two structured requirements and shows all inline", async () => {
    renderNode({
      feature: {
        id: "f-preview",
        name: "Preview",
        sections: [
          section(
            "requirements",
            JSON.stringify({
              records: [
                {
                  id: "00000000-0000-4000-8000-000000000001",
                  statement: "First requirement",
                  designedBy: [],
                  fulfilledBy: [],
                  contracts: [],
                },
                {
                  id: "00000000-0000-4000-8000-000000000002",
                  statement: "Second requirement",
                  designedBy: [],
                  fulfilledBy: [],
                  contracts: [],
                },
                {
                  id: "00000000-0000-4000-8000-000000000003",
                  statement: "Third requirement",
                  designedBy: [],
                  fulfilledBy: [],
                  contracts: [],
                },
              ],
            }),
          ),
        ],
      },
      children: [],
    });

    const content = screen.getByTestId(
      "feature-document-requirements-content-f-preview",
    );
    expect(content).toHaveTextContent("First requirement");
    expect(content).toHaveTextContent("Second requirement");
    expect(content).not.toHaveTextContent("Third requirement");
    const visuals = screen.getByTestId("feature-section-visuals-f-preview");
    expect(visuals).toBeVisible();

    await userEvent.click(
      screen.getByTestId("structured-requirements-show-all"),
    );

    expect(content).toHaveTextContent("Third requirement");
    expect(visuals).toBeVisible();

    await userEvent.click(
      screen.getByTestId("structured-requirements-show-all"),
    );
    expect(content).toHaveTextContent("Second requirement");
    expect(content).not.toHaveTextContent("Third requirement");
    expect(visuals).toBeVisible();
  });
});
