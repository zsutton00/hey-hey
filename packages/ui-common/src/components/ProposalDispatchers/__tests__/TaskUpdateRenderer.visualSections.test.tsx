import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type ProposalResponseDto,
  type TaskResponseDto,
  type WorkItemTypeDefinitionDto,
} from "../../../api";
import { TaskUpdateRenderer } from "../TaskUpdateRenderer";
import type { UpdateTaskProposalUpdates } from "../types";

const rendererSpies = vi.hoisted(() => ({
  htmlCss: vi.fn(),
  structuredMockup: vi.fn(),
  diff: vi.fn(),
  workItem: vi.fn(() => ({ workItem: undefined })),
  parents: new Map<
    string,
    { id: string; name: string; parentTaskId: string | null }
  >(),
}));

vi.mock("../../../contexts/PathServiceContext", () => ({
  usePathService: () => ({
    feature: ({ featureId }: { featureId: string }) => `/features/${featureId}`,
    task: ({ taskId }: { taskId: string }) => `/tasks/${taskId}`,
  }),
}));

vi.mock("../../../data/hooks/useUsers", () => ({
  useUsers: () => ({ data: [] }),
}));

vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: rendererSpies.workItem,
}));

vi.mock("../../../data/hooks/useFeatureHierarchy", () => ({
  useFeatureLookup: () => ({
    isLoading: false,
    isReady: true,
    get: (id: string) => rendererSpies.parents.get(id),
  }),
}));

vi.mock("../../../data/hooks/useServices", () => ({
  useServices: () => ({ services: [], isLoading: false, error: null }),
}));

vi.mock("../modeAvailability", () => ({
  useModeAvailability: ({ modeTypeKey }: { modeTypeKey?: string }) =>
    modeTypeKey === "MODE"
      ? { kind: "ready", features: [] }
      : { kind: "not-applicable" },
}));

vi.mock("../../shared/MarkdownRenderer", () => ({
  MarkdownRenderer: ({
    children,
    mentionConfig,
  }: {
    children: React.ReactNode;
    mentionConfig?: { organizationId: string; projectId: string };
  }) => (
    <span
      data-testid="mock-markdown-renderer"
      data-mention-organization-id={mentionConfig?.organizationId}
      data-mention-project-id={mentionConfig?.projectId}
    >
      {children}
    </span>
  ),
}));

vi.mock("../../shared/HtmlCssSectionRenderer", () => ({
  HtmlCssSectionRenderer: (props: {
    content: unknown;
    definition: { key: string };
    context: string;
    materializedProposalId?: string;
    mockupSource?: unknown;
  }) => {
    rendererSpies.htmlCss(props);
    return (
      <div
        data-testid="html-css-preview"
        data-definition-key={props.definition.key}
        data-context={props.context}
      >
        {JSON.stringify(props.content)}
      </div>
    );
  },
}));

vi.mock("../../shared/StructuredMockupSectionRenderer", () => ({
  StructuredMockupSectionRenderer: (props: {
    content: unknown;
    definition: { key: string };
    context: string;
  }) => {
    rendererSpies.structuredMockup(props);
    return (
      <div
        data-testid="structured-mockup-preview"
        data-definition-key={props.definition.key}
        data-context={props.context}
      >
        {JSON.stringify(props.content)}
      </div>
    );
  },
}));

vi.mock("../../SuggestedContent", () => ({
  DiffRenderer: (props: { oldContent: string; newContent: string }) => {
    rendererSpies.diff(props);
    return <div data-testid="ordinary-section-diff">{props.newContent}</div>;
  },
}));

vi.mock("../ProposalStateIndicator", () => ({
  ProposalStateIndicator: () => <div data-testid="proposal-state" />,
}));

vi.mock("../ProposalEdges", () => ({ ProposalEdges: () => null }));

const htmlDefinition = {
  key: "preview",
  label: "Preview",
  kind: "html/css" as const,
  sizeProfiles: [
    { key: "desktop", label: "Desktop", width: 1200, height: 800 },
  ],
  defaultSizeKey: "desktop",
};
const mockupDefinition = {
  key: "composition",
  label: "Composition",
  kind: "structured-mockup" as const,
  sizeProfiles: [
    { key: "desktop", label: "Desktop", width: 1200, height: 800 },
  ],
  defaultSizeKey: "desktop",
};
const definition: WorkItemTypeDefinitionDto = {
  key: "mockups_v3",
  name: "Mockups V3",
  sections: [
    { key: "description", label: "Description", kind: "markdown" },
    htmlDefinition,
    mockupDefinition,
  ],
  allowedStatuses: [],
};

const existing = {
  id: "task-1",
  name: "Visual task",
  type: "mockups_v3",
  organizationId: "org-1",
  projectId: "project-1",
  sections: [
    { key: "description", materializedMarkdown: "Current description" },
    {
      key: "preview",
      materializedMarkdown: "current html",
      materializedProposalId: "20000000-0000-4000-8000-000000000001",
    },
    { key: "composition", materializedMarkdown: "current composition" },
  ],
} as unknown as TaskResponseDto;

const htmlAfter = {
  html: "<main>After</main>",
  css: "",
  sizeKey: "desktop",
  annotations: [
    {
      id: "10000000-0000-4000-8000-000000000001",
      note: "Keep this visible.",
      author: {
        type: "human" as const,
        userId: "10000000-0000-4000-8000-000000000002",
      },
      category: "context" as const,
      lifecycle: "open" as const,
      authoredProposalId: "20000000-0000-4000-8000-000000000001",
      authoredSizeKey: "desktop",
      target: {
        type: "position" as const,
        x: 0.5,
        y: 0.5,
        sizeKey: "desktop",
      },
    },
  ],
};
const mockupAfter = {
  schemaVersion: "work-item-structured-mockup.v5",
  content: [
    {
      type: "icon",
      props: {
        id: "settings",
        width: { mode: "fit" },
        height: { mode: "content" },
        iconKey: "settings",
        accessibleLabel: "Settings",
        description: "Opens settings",
      },
    },
  ],
  sizeKey: "desktop",
};
const updates: UpdateTaskProposalUpdates = {
  sections: [
    { key: "description", content: "Proposed description" },
    { key: "preview", content: htmlAfter },
    { key: "composition", content: mockupAfter },
  ],
};
const proposal = {
  id: "proposal-1",
  organizationId: "org-1",
  projectId: "project-1",
  type: ProposalType.Single,
  action: ProposalAction.Update,
  status: ProposalStatus.Pending,
  targetEntityId: "task-1",
  targetEntityType: TargetEntityType.Task,
  updates,
} as unknown as ProposalResponseDto & { updates: UpdateTaskProposalUpdates };

const renderProposal = () =>
  render(
    <MemoryRouter>
      <TaskUpdateRenderer
        proposal={proposal}
        existing={existing}
        status={{ state: "pending" }}
        onApply={() => {}}
        workItemTypeDefinition={definition}
      />
    </MemoryRouter>,
  );

describe("TaskUpdateRenderer visual section review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rendererSpies.parents.clear();
  });

  it("uses cached feature parent names and disables single-task name reads", () => {
    rendererSpies.parents.set("old-parent", {
      id: "old-parent",
      name: "Original feature",
      parentTaskId: null,
    });
    rendererSpies.parents.set("new-parent", {
      id: "new-parent",
      name: "Destination feature",
      parentTaskId: null,
    });
    render(
      <MemoryRouter>
        <TaskUpdateRenderer
          proposal={{ ...proposal, updates: { parentTaskId: "new-parent" } }}
          existing={{ ...existing, parentTaskId: "old-parent" }}
          status={{ state: "pending" }}
          onApply={() => {}}
          workItemTypeDefinition={definition}
        />
      </MemoryRouter>,
    );
    expect(rendererSpies.workItem).toHaveBeenCalledWith(
      "org-1",
      "task",
      "old-parent",
      { projectId: "project-1", enabled: false },
    );
    expect(rendererSpies.workItem).toHaveBeenCalledWith(
      "org-1",
      "task",
      "new-parent",
      { projectId: "project-1", enabled: false },
    );
    expect(rendererSpies.diff).toHaveBeenCalledWith(
      expect.objectContaining({
        oldContent: expect.stringContaining("Original feature"),
        newContent: expect.stringContaining("Destination feature"),
      }),
    );
  });

  it("shows each proposed visual section as one full-width After preview", () => {
    renderProposal();

    const sections = screen.getAllByTestId(
      "visual-proposal-section-comparison",
    );
    expect(sections).toHaveLength(2);
    expect(
      screen.getAllByTestId("visual-proposal-comparison-preview"),
    ).toHaveLength(2);
    expect(screen.getAllByTestId("html-css-preview")).toHaveLength(1);
    expect(screen.getAllByTestId("structured-mockup-preview")).toHaveLength(1);
    expect(screen.getByTestId("html-css-preview")).toHaveTextContent("After");
    expect(screen.getByTestId("structured-mockup-preview")).toHaveTextContent(
      "work-item-structured-mockup.v5",
    );
    for (const section of sections) {
      expect(
        within(section).getByTestId("visual-proposal-comparison-after"),
      ).toHaveAttribute("aria-pressed", "true");
      expect(
        within(section).getByTestId("visual-proposal-comparison-preview"),
      ).toHaveAttribute("data-comparison-state", "after");
    }
  });

  it("gives the pencil the proposal's mockup on After and none on Before", () => {
    renderProposal();

    expect(rendererSpies.htmlCss).toHaveBeenLastCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        mockupSource: {
          kind: "proposal",
          proposalId: "proposal-1",
          sectionKey: "preview",
        },
      }),
    );

    const htmlSection = screen
      .getAllByTestId("visual-proposal-section-comparison")
      .find((section) => section.dataset.sectionKind === "html/css");
    fireEvent.click(
      within(htmlSection!).getByTestId("visual-proposal-comparison-before"),
    );

    expect(rendererSpies.htmlCss).toHaveBeenLastCalledWith(
      expect.objectContaining({ mockupSource: undefined }),
    );
  });

  it("switches locally to authoritative Before content without changing proposal inputs", () => {
    renderProposal();

    const htmlSection = screen
      .getAllByTestId("visual-proposal-section-comparison")
      .find((section) => section.dataset.sectionKind === "html/css");
    expect(htmlSection).toBeDefined();
    fireEvent.click(
      within(htmlSection!).getByTestId("visual-proposal-comparison-before"),
    );

    expect(screen.getByTestId("html-css-preview")).toHaveTextContent(
      "current html",
    );
    expect(screen.getByTestId("structured-mockup-preview")).toHaveTextContent(
      "work-item-structured-mockup.v5",
    );
    expect(proposal.updates).toBe(updates);
    expect(updates.sections?.[1]?.content).toBe(htmlAfter);
  });

  it("uses the resolved kind renderers with their original definitions and keeps ordinary diffs", () => {
    renderProposal();

    expect(rendererSpies.htmlCss).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: htmlAfter,
        definition: htmlDefinition,
        context: "inline",
        materializedProposalId: "20000000-0000-4000-8000-000000000001",
      }),
    );
    expect(rendererSpies.structuredMockup).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: mockupAfter,
        definition: mockupDefinition,
        context: "inline",
      }),
    );
    expect(screen.getByTestId("ordinary-section-diff")).toHaveTextContent(
      "Proposed description",
    );
    expect(screen.getAllByTestId("ordinary-section-diff")).toHaveLength(1);
  });

  it("specializes registry-selected MODE files while keeping other JSON in the ordinary review", () => {
    const modeDefinition: WorkItemTypeDefinitionDto = {
      key: "MODE",
      name: "Project Mode",
      sections: [
        {
          key: "files",
          label: "Supporting files",
          kind: "json",
          schemaRef: "#/components/schemas/ProjectModeFilesV1",
        },
        {
          key: "applicability",
          label: "Applicable work-item types",
          kind: "json",
          schemaRef: "#/components/schemas/ProjectModeApplicabilityV1",
        },
      ],
      allowedStatuses: [],
    };
    const modeExisting = {
      ...existing,
      type: "MODE",
      sections: [
        {
          key: "files",
          materializedMarkdown: JSON.stringify({
            schemaVersion: "project-mode-files.v1",
            files: {
              "MODE.md": "# Main guidance",
              "references/review.md": "## Review checklist",
            },
          }),
        },
        { key: "applicability", materializedMarkdown: "{}" },
      ],
    } as unknown as TaskResponseDto;
    const modeProposal = {
      ...proposal,
      updates: {
        sections: [
          {
            key: "files",
            content: {
              schemaVersion: "project-mode-files.v1",
              files: {
                "MODE.md": "# Main guidance",
                "references/review.md": "## Review checklist",
              },
            },
          },
          {
            key: "applicability",
            content: { eligibleWorkItemTypeKeys: ["STANDARD"] },
          },
        ],
      },
    } as unknown as ProposalResponseDto & {
      updates: UpdateTaskProposalUpdates;
    };

    render(
      <MemoryRouter>
        <TaskUpdateRenderer
          proposal={modeProposal}
          existing={modeExisting}
          status={{ state: "pending" }}
          onApply={() => {}}
          workItemTypeDefinition={modeDefinition}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Supporting files")).toBeInTheDocument();
    expect(screen.getByTestId("mode-files-selected-content")).toHaveTextContent(
      "# Main guidance",
    );
    expect(
      within(screen.getByTestId("mode-files-selected-content")).getByTestId(
        "mock-markdown-renderer",
      ),
    ).toHaveAttribute("data-mention-organization-id", "org-1");
    expect(
      within(screen.getByTestId("mode-files-selected-content")).getByTestId(
        "mock-markdown-renderer",
      ),
    ).toHaveAttribute("data-mention-project-id", "project-1");
    fireEvent.click(screen.getByTestId("mode-files-toggle-unchanged"));
    fireEvent.click(
      screen.getByRole("button", { name: "references/review.md (unchanged)" }),
    );
    expect(screen.getByTestId("mode-files-selected-content")).toHaveTextContent(
      "## Review checklist",
    );
    expect(
      within(screen.getByTestId("mode-files-selected-content")).getByTestId(
        "mock-markdown-renderer",
      ),
    ).toHaveAttribute("data-mention-project-id", "project-1");
    expect(screen.getByTestId("mode-files-selected-path")).toHaveStyle({
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    });
    expect(screen.getByTestId("ordinary-section-diff")).toHaveTextContent(
      "eligibleWorkItemTypeKeys",
    );
    expect(screen.queryByText("schemaVersion")).not.toBeInTheDocument();
  });

  it("fails closed for an invalid MODE bundle without exposing its raw content", () => {
    const modeDefinition: WorkItemTypeDefinitionDto = {
      key: "MODE",
      name: "Project Mode",
      sections: [{ key: "files", label: "Files", kind: "json" }],
      allowedStatuses: [],
    };
    const modeProposal = {
      ...proposal,
      updates: {
        sections: [
          {
            key: "files",
            content: { files: { "MODE.md": "Do not expose this content." } },
          },
        ],
      },
    } as unknown as ProposalResponseDto & {
      updates: UpdateTaskProposalUpdates;
    };

    render(
      <MemoryRouter>
        <TaskUpdateRenderer
          proposal={modeProposal}
          existing={{ ...existing, type: "MODE" } as TaskResponseDto}
          status={{ state: "pending" }}
          onApply={() => {}}
          workItemTypeDefinition={modeDefinition}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByTestId("mode-files-section-unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Do not expose this content."),
    ).not.toBeInTheDocument();
  });
});
