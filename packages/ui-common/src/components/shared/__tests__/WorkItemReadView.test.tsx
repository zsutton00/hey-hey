import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { MemoryRouter } from "react-router-dom";
import { TaskSource, WorkStatus, type TaskResponseDto } from "../../../api";
import { ProjectContext } from "../../../contexts";
import { EagerIntersectionObserver } from "../../../test/eagerIntersectionObserver";
import { RunBrowserProvider } from "../../AgentSession/runtime/RunBrowserContext";
import { WorkItemReadView } from "../WorkItemReadView";
import { EntityViewer } from "../../EntityViewer";
import type {
  ResolvedWorkItemSectionSelection,
  WorkItemSectionSelection,
} from "../../../utils/workItemSections";

// React Flow adopts arranged nodes through its store one tick after the
// surface leaves "arranging", so also wait for populated surfaces' cards.
const waitForDiagramArranged = () =>
  waitFor(
    () => {
      expect(
        document.querySelector('[data-workflow-view-mode="arranging"]'),
      ).toBeNull();
      document
        .querySelectorAll(
          '[data-workflow-view-mode="natural-size"], [data-workflow-view-mode="fit-to-view"]',
        )
        .forEach((surface) =>
          expect(
            surface.querySelector('[data-testid="workflow-inline-step"]'),
          ).not.toBeNull(),
        );
    },
    { timeout: 5000 },
  );

const hookMocks = vi.hoisted(() => ({
  useWorkItemGraph: vi.fn(),
  useWorkItemTypeByKey: vi.fn(),
  useEntityNames: vi.fn(),
}));

vi.mock("../../../data/hooks/useEntityNames", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../data/hooks/useEntityNames")
  >()),
  useEntityNames: hookMocks.useEntityNames,
}));

vi.mock("../../SmarterTextAreaCard/MentionBadge", async () => {
  const { useContext } = await import("react");
  const { MentionEditorContext } =
    await import("../../SmarterTextAreaCard/EditorContext");

  return {
    MentionBadgeInner: ({
      mention,
    }: {
      mention: { entityId: string; entityType: string; entityName: string };
    }) => {
      const context = useContext(MentionEditorContext);
      return (
        <span
          data-testid="mention-badge"
          data-entity-id={mention.entityId}
          data-entity-type={mention.entityType}
          data-entity-name={mention.entityName}
          data-organization-id={context?.organizationId}
          data-project-id={context?.projectId}
        >
          {mention.entityName}
        </span>
      );
    },
  };
});

vi.mock("../../../data/hooks/useWorkItemGraph", () => ({
  useWorkItemGraph: hookMocks.useWorkItemGraph,
}));

vi.mock("../../../data/hooks/useWorkItemTypes", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../data/hooks/useWorkItemTypes")
  >()),
  useWorkItemTypeByKey: hookMocks.useWorkItemTypeByKey,
}));

vi.mock(
  "../../AgentSession/runtime/directoryBindingApi",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../AgentSession/runtime/directoryBindingApi")
    >()),
    createDirectoryBindingApi: () => ({
      listRepos: () =>
        Promise.resolve({ machineId: "machine-1", bindings: [] }),
    }),
  }),
);

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

const sectionSelections = {
  STANDARD: {
    status: "resolved",
    typeKey: "STANDARD",
    sections: [
      { key: "description", label: "Description" },
      { key: "acceptanceCriteria", label: "Acceptance Criteria" },
    ],
  },
  FEATURE: {
    status: "resolved",
    typeKey: "FEATURE",
    sections: [
      { key: "description", label: "Description" },
      {
        key: "requirements",
        label: "Requirements",
        kind: "json",
        schemaRef: "#/components/schemas/FeatureRequirementsSection",
      },
    ],
  },
  BUG: {
    status: "resolved",
    typeKey: "BUG",
    sections: [{ key: "description", label: "Description" }],
  },
  INITIATIVE: {
    status: "resolved",
    typeKey: "INITIATIVE",
    sections: [
      { key: "description", label: "Description" },
      { key: "acceptanceCriteria", label: "Acceptance Criteria" },
    ],
  },
} as const satisfies Record<string, ResolvedWorkItemSectionSelection>;

const makeReadViewProps = (
  selection: WorkItemSectionSelection,
  content: Record<string, string | null | undefined>,
): React.ComponentProps<typeof WorkItemReadView> => ({
  sectionSelection: selection,
  sections: Object.entries(content).map(([key, value], order) => ({
    id: `section-${key}`,
    key,
    order,
    materializedMarkdown: value ?? "",
    crdtSnapshotSeq: null,
  })),
});

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
  overrides: Partial<TaskResponseDto> & Pick<TaskResponseDto, "id" | "name">,
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
    Pick<TaskResponseDto, "id" | "name">,
): TaskResponseDto & { type: "workflow" } => ({
  ...makeTask(overrides),
  type: "workflow",
});

const makeWorkflowStep = (
  overrides: Omit<Partial<TaskResponseDto>, "type"> &
    Pick<TaskResponseDto, "id" | "name">,
): TaskResponseDto & { type: "workflow_step" } => ({
  ...makeTask(overrides),
  type: "workflow_step",
});

describe("HTML/CSS work-item sections", () => {
  it("renders a registry-kind-selected section for an arbitrary type", () => {
    render(
      <WorkItemReadView
        {...makeReadViewProps(
          {
            status: "resolved",
            typeKey: "ARBITRARY_CUSTOM_TYPE",
            sections: [
              {
                key: "visual",
                label: "Visual",
                kind: "html/css",
                defaultSizeKey: "panel",
                sizeProfiles: [
                  {
                    key: "panel",
                    label: "Panel",
                    breakpoints: [
                      {
                        minContainerWidth: 0,
                        inline: { width: 320, height: 200 },
                        page: { width: 800, height: 600 },
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            visual: JSON.stringify({
              html: "<main>Preview</main>",
              css: "main{}",
            }),
          },
        )}
      />,
      { wrapper },
    );

    expect(screen.getByTitle("Visual mockup")).toHaveAttribute("sandbox", "");
  });

  it("forwards the stored item's identity so a mockup in a Run shows its pencil", () => {
    const readViewProps = makeReadViewProps(
      {
        status: "resolved",
        typeKey: "ARBITRARY_CUSTOM_TYPE",
        sections: [
          {
            key: "visual",
            label: "Visual",
            kind: "html/css",
            defaultSizeKey: "panel",
            sizeProfiles: [
              {
                key: "panel",
                label: "Panel",
                breakpoints: [
                  {
                    minContainerWidth: 0,
                    inline: { width: 320, height: 200 },
                    page: { width: 800, height: 600 },
                  },
                ],
              },
            ],
          },
        ],
      },
      { visual: JSON.stringify({ html: "<main>Preview</main>", css: "" }) },
    );
    const inRun = (node: React.ReactNode) => (
      <RunBrowserProvider
        value={{ runId: "run-1", sessionMachineId: "machine-1" }}
      >
        {node}
      </RunBrowserProvider>
    );

    const { unmount } = render(
      inRun(
        <WorkItemReadView
          {...readViewProps}
          visualSectionEntity={{
            entityType: "task",
            entityId: "work-item-1",
            projectId: "project-1",
            organizationId: "org-1",
          }}
        />,
      ),
      { wrapper },
    );
    expect(screen.getByTestId("html-css-open-in-browser")).toBeInTheDocument();
    unmount();

    render(inRun(<WorkItemReadView {...readViewProps} />), { wrapper });
    expect(
      screen.queryByTestId("html-css-open-in-browser"),
    ).not.toBeInTheDocument();
  });

  it("hides HTML/CSS annotation overlays in read-only views", () => {
    const proposalId = "20000000-0000-4000-8000-000000000001";
    render(
      <WorkItemReadView
        sectionSelection={{
          status: "resolved",
          typeKey: "ARBITRARY_CUSTOM_TYPE",
          sections: [
            {
              key: "visual",
              label: "Visual",
              kind: "html/css",
              defaultSizeKey: "panel",
              sizeProfiles: [
                {
                  key: "panel",
                  label: "Panel",
                  breakpoints: [
                    {
                      minContainerWidth: 0,
                      inline: { width: 320, height: 200 },
                      page: { width: 800, height: 600 },
                    },
                  ],
                },
              ],
            },
          ],
        }}
        sections={[
          {
            id: "section-visual",
            key: "visual",
            order: 0,
            crdtSnapshotSeq: null,
            materializedProposalId: proposalId,
            materializedMarkdown: JSON.stringify({
              html: "<main>Preview</main>",
              css: "",
              sizeKey: "panel",
              annotations: [
                {
                  id: "10000000-0000-4000-8000-000000000001",
                  note: "Keep this visible.",
                  author: {
                    type: "human",
                    userId: "10000000-0000-4000-8000-000000000002",
                  },
                  category: "context",
                  lifecycle: "open",
                  authoredProposalId: proposalId,
                  authoredSizeKey: "panel",
                  target: {
                    type: "position",
                    x: 0.5,
                    y: 0.5,
                    sizeKey: "panel",
                  },
                },
              ],
            }),
          },
        ]}
      />,
      { wrapper },
    );

    expect(screen.getByTitle("Visual mockup")).toHaveAttribute("sandbox", "");
    expect(
      screen.queryByTestId("html-css-annotation-pin"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("html-css-request-revision"),
    ).not.toBeInTheDocument();
  });
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

describe("WorkItemReadView requirements section", () => {
  it("renders canonical records with stored citation titles and no name lookup", () => {
    const records = [
      {
        id: "00000000-0000-4000-8000-000000000001",
        statement:
          "Onboarding begins with a structured intake form that captures the project concept, maturity, team size, and organizational context",
        group: "Discovery",
        designedBy: [],
        fulfilledBy: [],
        contracts: [],
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        statement:
          "One or two rounds of LLM-generated follow-up questions probe for goals, user workflows, and technical constraints, skipping questions already answered",
        group: "Discovery",
        designedBy: [],
        fulfilledBy: [],
        contracts: [],
      },
      {
        id: "00000000-0000-4000-8000-000000000003",
        statement:
          "On discovery completion the system generates feature proposals",
        group: "Feature proposals",
        designedBy: [],
        fulfilledBy: [],
        contracts: [],
      },
      {
        id: "00000000-0000-4000-8000-000000000004",
        statement:
          "The user reviews the proposed feature set in the onboarding conversation and can either approve it to continue or request changes",
        group: "Feature proposals",
        designedBy: [],
        fulfilledBy: [],
        contracts: [],
      },
      {
        id: "00000000-0000-4000-8000-000000000005",
        statement:
          "Requested changes trigger a refinement cycle that regenerates the feature proposals with the user's feedback incorporated",
        group: "Feature proposals",
        designedBy: [],
        fulfilledBy: [],
        contracts: [],
      },
      {
        id: "00000000-0000-4000-8000-000000000006",
        statement:
          "When onboarding completes, Project Setup takes over as the next surface and walks the user through Agent Bridge install plus first-task creation",
        group: "Entry and handoff",
        designedBy: [],
        fulfilledBy: [
          {
            entityType: "TASK",
            entityId: "0574d216-a88e-4330-8d91-358b0d84bd80",
            entityTitle: "Project Setup",
          },
        ],
        contracts: [],
      },
      {
        id: "00000000-0000-4000-8000-000000000007",
        statement:
          "Invited users receive a secure welcome link to the main web app, where a purpose-specific, single-use credential is captured automatically and they create their chosen password in one unified experience",
        group: "Entry and handoff",
        designedBy: [],
        fulfilledBy: [
          {
            entityType: "TASK",
            entityId: "fea1c915-e9de-4897-b2c8-5837f6ddd33d",
            entityTitle: "Welcome Email",
          },
        ],
        contracts: [
          {
            entityType: "CONTRACT",
            entityId: "d307c0e7-8bbd-4f0a-bd98-2d9317d7e7fd",
            entityTitle: "Invitation credential handoff",
          },
        ],
      },
      {
        id: "00000000-0000-4000-8000-000000000008",
        statement:
          "A new organization sees an introduction to Hey Hey and a CTA that starts the project-onboarding process",
        group: "Entry and handoff",
        designedBy: [],
        fulfilledBy: [
          {
            entityType: "TASK",
            entityId: "9941ee30-2743-4bf7-a4ab-cd8135406497",
            entityTitle: "New organization experience",
          },
        ],
        contracts: [],
      },
    ];
    const citedRequirements = new Map([
      [
        "00000000-0000-4000-8000-000000000006",
        [
          {
            entityType: "TASK",
            entityId: "0574d216-a88e-4330-8d91-358b0d84bd80",
            entityTitle: "Project Setup",
          },
        ],
      ],
      [
        "00000000-0000-4000-8000-000000000007",
        [
          {
            entityType: "TASK",
            entityId: "fea1c915-e9de-4897-b2c8-5837f6ddd33d",
            entityTitle: "Welcome Email",
          },
          {
            entityType: "CONTRACT",
            entityId: "d307c0e7-8bbd-4f0a-bd98-2d9317d7e7fd",
            entityTitle: "Invitation credential handoff",
          },
        ],
      ],
      [
        "00000000-0000-4000-8000-000000000008",
        [
          {
            entityType: "TASK",
            entityId: "9941ee30-2743-4bf7-a4ab-cd8135406497",
            entityTitle: "New organization experience",
          },
        ],
      ],
    ]);
    render(
      <WorkItemReadView
        {...makeReadViewProps(sectionSelections.FEATURE, {
          requirements: JSON.stringify({ records }),
        })}
      />,
      { wrapper: projectWrapper },
    );

    expect(
      screen
        .getAllByTestId("structured-requirements-group")
        .map((group) => group.dataset.requirementGroup),
    ).toEqual(["Discovery", "Feature proposals", "Entry and handoff"]);
    expect(
      screen
        .getAllByTestId("structured-requirement-row")
        .map((row) => row.dataset.requirementId),
    ).toEqual(records.map(({ id }) => id));

    for (const [index, row] of screen
      .getAllByTestId("structured-requirement-row")
      .entries()) {
      const record = records[index];
      expect(row).toHaveTextContent(record.statement);
      const citedRequirement = citedRequirements.get(record.id) ?? [];
      const mentionNodes = within(row).queryAllByTestId("mention-badge");
      expect(mentionNodes).toHaveLength(citedRequirement.length);
      for (const [citationIndex, citation] of citedRequirement.entries()) {
        expect(mentionNodes[citationIndex]).toHaveAttribute(
          "data-entity-id",
          citation.entityId,
        );
        expect(mentionNodes[citationIndex]).toHaveAttribute(
          "data-entity-type",
          citation.entityType,
        );
        expect(mentionNodes[citationIndex]).toHaveAttribute(
          "data-entity-name",
          citation.entityTitle,
        );
        expect(mentionNodes[citationIndex]).toHaveTextContent(
          citation.entityTitle,
        );
      }
    }
    expect(hookMocks.useEntityNames).not.toHaveBeenCalled();
  });

  it("collapses only three-plus fulfilled-by lists and keeps disclosure row-scoped", () => {
    const citationIds = [
      "00000000-0000-4000-8000-000000000011",
      "00000000-0000-4000-8000-000000000012",
      "00000000-0000-4000-8000-000000000013",
      "00000000-0000-4000-8000-000000000014",
    ];
    const fulfilledBy = (count: number) =>
      citationIds.slice(0, count).map((entityId) => ({
        entityType: "TASK" as const,
        entityId,
        entityTitle: `Title ${entityId}`,
      }));
    const records = [0, 1, 2, 3].map((count) => ({
      id: `00000000-0000-4000-8000-00000000001${count}`,
      statement: `Requirement with ${count} citations`,
      ...(count % 2 === 0 ? { group: "Grouped" } : {}),
      designedBy: [],
      fulfilledBy: fulfilledBy(count),
      contracts: [],
    }));

    render(
      <WorkItemReadView
        {...makeReadViewProps(sectionSelections.FEATURE, {
          requirements: JSON.stringify({ records }),
        })}
      />,
      { wrapper: projectWrapper },
    );

    const rows = screen.getAllByTestId("structured-requirement-row");
    const rowsById = new Map(
      rows.map((row) => [row.dataset.requirementId, row] as const),
    );
    expect(rows).toHaveLength(4);
    expect(
      rowsById.get(records[0]?.id)?.querySelectorAll("[data-entity-id]"),
    ).toHaveLength(0);
    expect(
      rowsById.get(records[1]?.id)?.querySelectorAll("[data-entity-id]"),
    ).toHaveLength(1);
    expect(
      rowsById.get(records[2]?.id)?.querySelectorAll("[data-entity-id]"),
    ).toHaveLength(2);
    expect(
      rowsById.get(records[3]?.id)?.querySelectorAll("[data-entity-id]"),
    ).toHaveLength(2);
    expect(
      screen.getAllByTestId("structured-requirement-fulfilled-by-overflow"),
    ).toHaveLength(1);
    const overflowRow = rowsById.get(records[3]?.id);
    expect(overflowRow).toBeDefined();
    if (!overflowRow) throw new Error("Expected row-3 to render");
    expect(overflowRow).toHaveTextContent("+1");

    fireEvent.click(within(overflowRow).getByRole("button"));
    const dialog = screen.getByTestId(
      "structured-requirement-fulfilled-by-dialog",
    );
    expect(dialog.querySelectorAll("[data-entity-id]")).toHaveLength(3);
    expect(dialog).toHaveTextContent(`Title ${citationIds[0]}`);
    expect(dialog).toHaveTextContent(`Title ${citationIds[1]}`);
    expect(dialog).toHaveTextContent(`Title ${citationIds[2]}`);
    expect(dialog).not.toHaveTextContent(`Title ${citationIds[3]}`);
  });

  it("renders grouped citations and discloses hidden fulfilled-by citations", () => {
    const records = [
      {
        id: "00000000-0000-4000-8000-000000000020",
        statement: "Render requirement citations",
        group: "Presentation",
        designedBy: [
          {
            entityType: "DESIGN_DOC",
            entityId: "00000000-0000-4000-8000-000000000021",
            entityTitle: "Title 00000000-0000-4000-8000-000000000021",
          },
        ],
        fulfilledBy: [
          {
            entityType: "TASK",
            entityId: "00000000-0000-4000-8000-000000000022",
            entityTitle: "Title 00000000-0000-4000-8000-000000000022",
          },
          {
            entityType: "TASK",
            entityId: "00000000-0000-4000-8000-000000000023",
            entityTitle: "Title 00000000-0000-4000-8000-000000000023",
          },
          {
            entityType: "TASK",
            entityId: "00000000-0000-4000-8000-000000000024",
            entityTitle: "Title 00000000-0000-4000-8000-000000000024",
          },
          {
            entityType: "TASK",
            entityId: "00000000-0000-4000-8000-000000000025",
            entityTitle: "Title 00000000-0000-4000-8000-000000000025",
          },
        ],
        contracts: [
          {
            entityType: "CONTRACT",
            entityId: "00000000-0000-4000-8000-000000000026",
            entityTitle: "Title 00000000-0000-4000-8000-000000000026",
          },
        ],
      },
    ];
    render(
      <WorkItemReadView
        {...makeReadViewProps(sectionSelections.FEATURE, {
          requirements: JSON.stringify({ records }),
        })}
      />,
      { wrapper: projectWrapper },
    );

    const row = screen.getByTestId("structured-requirement-row");
    expect(row).toHaveTextContent("Designed by");
    expect(row).toHaveTextContent("Title 00000000-0000-4000-8000-000000000021");
    expect(row).toHaveTextContent("Fulfilled by");
    expect(row).toHaveTextContent("Title 00000000-0000-4000-8000-000000000022");
    expect(row).toHaveTextContent("Title 00000000-0000-4000-8000-000000000023");
    expect(row).not.toHaveTextContent(
      "Title 00000000-0000-4000-8000-000000000024",
    );
    expect(row).not.toHaveTextContent(
      "Title 00000000-0000-4000-8000-000000000025",
    );
    expect(row).toHaveTextContent("+2");
    expect(row).toHaveTextContent("Contracts");
    expect(row).toHaveTextContent("Title 00000000-0000-4000-8000-000000000026");

    fireEvent.click(
      within(row).getByRole("button", {
        name: "Show all fulfilled by citations for Render requirement citations",
      }),
    );

    const dialog = screen.getByTestId(
      "structured-requirement-fulfilled-by-dialog",
    );
    expect(dialog).toHaveTextContent(
      "Title 00000000-0000-4000-8000-000000000022",
    );
    expect(dialog).toHaveTextContent(
      "Title 00000000-0000-4000-8000-000000000023",
    );
    expect(dialog).toHaveTextContent(
      "Title 00000000-0000-4000-8000-000000000024",
    );
    expect(dialog).toHaveTextContent(
      "Title 00000000-0000-4000-8000-000000000025",
    );
  });

  const previewRecords = [
    {
      id: "00000000-0000-4000-8000-000000000101",
      statement: "First requirement",
      group: "Alpha",
      contracts: [],
      designedBy: [],
      fulfilledBy: [
        {
          entityType: "TASK",
          entityId: "00000000-0000-4000-8000-000000000104",
          entityTitle: "Title 00000000-0000-4000-8000-000000000104",
        },
        {
          entityType: "TASK",
          entityId: "00000000-0000-4000-8000-000000000105",
          entityTitle: "Title 00000000-0000-4000-8000-000000000105",
        },
        {
          entityType: "TASK",
          entityId: "00000000-0000-4000-8000-000000000106",
          entityTitle: "Title 00000000-0000-4000-8000-000000000106",
        },
      ],
    },
    {
      id: "00000000-0000-4000-8000-000000000102",
      statement: "Second requirement",
      designedBy: [],
      fulfilledBy: [],
      contracts: [
        {
          entityType: "CONTRACT",
          entityId: "00000000-0000-4000-8000-000000000107",
          entityTitle: "Title 00000000-0000-4000-8000-000000000107",
        },
      ],
    },
    {
      id: "00000000-0000-4000-8000-000000000103",
      statement: "Third requirement",
      group: "Alpha",
      contracts: [],
      fulfilledBy: [],
      designedBy: [
        {
          entityType: "DESIGN_DOC",
          entityId: "00000000-0000-4000-8000-000000000108",
          entityTitle: "Title 00000000-0000-4000-8000-000000000108",
        },
      ],
    },
  ];

  it("previews the first two requirements and reveals the rest in order", async () => {
    render(
      <WorkItemReadView
        {...makeReadViewProps(sectionSelections.FEATURE, {
          requirements: JSON.stringify({ records: previewRecords }),
        })}
        requirementsPreview={{ limit: 2, resetKey: "feature-one" }}
      />,
      { wrapper: projectWrapper },
    );

    const ids = () =>
      screen
        .getAllByTestId("structured-requirement-row")
        .map((row) => row.getAttribute("data-requirement-id"));
    expect(ids()).toEqual([
      "00000000-0000-4000-8000-000000000101",
      "00000000-0000-4000-8000-000000000102",
    ]);
    expect(screen.getByTestId("structured-requirements")).toHaveAttribute(
      "data-requirement-count",
      "3",
    );
    const firstRow = screen.getAllByTestId("structured-requirement-row")[0];
    expect(firstRow).toHaveTextContent("+1");
    expect(screen.getAllByTestId("structured-requirements-group")).toHaveLength(
      1,
    );
    expect(
      screen.getAllByTestId("structured-requirements")[0],
    ).toHaveTextContent("Title 00000000-0000-4000-8000-000000000107");

    fireEvent.click(
      within(firstRow).getByRole("button", {
        name: "Show all fulfilled by citations for First requirement",
      }),
    );
    expect(
      screen.getByTestId("structured-requirement-fulfilled-by-dialog"),
    ).toHaveTextContent("Title 00000000-0000-4000-8000-000000000106");
    fireEvent.click(
      screen.getByRole("button", { name: "Close fulfilled by citations" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId("structured-requirement-fulfilled-by-dialog"),
      ).not.toBeInTheDocument(),
    );

    const showAll = screen.getByRole("button", { name: "View all (3)" });
    expect(showAll.tagName).toBe("BUTTON");
    fireEvent.click(showAll);

    expect(ids()).toEqual([
      "00000000-0000-4000-8000-000000000101",
      "00000000-0000-4000-8000-000000000103",
      "00000000-0000-4000-8000-000000000102",
    ]);
    const group = screen.getByTestId("structured-requirements-group");
    expect(group).toHaveTextContent("Third requirement");
    expect(group).toHaveTextContent(
      "Title 00000000-0000-4000-8000-000000000108",
    );

    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(screen.getAllByTestId("structured-requirement-row")).toHaveLength(2);
  });

  it("renders two or fewer requirements without a View all control", () => {
    render(
      <WorkItemReadView
        {...makeReadViewProps(sectionSelections.FEATURE, {
          requirements: JSON.stringify({ records: previewRecords.slice(0, 2) }),
        })}
        requirementsPreview={{ limit: 2, resetKey: "feature-one" }}
      />,
      { wrapper: projectWrapper },
    );

    expect(screen.getAllByTestId("structured-requirement-row")).toHaveLength(2);
    expect(
      screen.queryByTestId("structured-requirements-show-all"),
    ).not.toBeInTheDocument();
  });

  it("keeps the full collection for consumers that do not opt in and resets on a new key", () => {
    const { rerender } = render(
      <WorkItemReadView
        {...makeReadViewProps(sectionSelections.FEATURE, {
          requirements: JSON.stringify({ records: previewRecords }),
        })}
      />,
      { wrapper: projectWrapper },
    );
    expect(screen.getAllByTestId("structured-requirement-row")).toHaveLength(3);

    const previewed = (resetKey: string) => (
      <WorkItemReadView
        {...makeReadViewProps(sectionSelections.FEATURE, {
          requirements: JSON.stringify({ records: previewRecords }),
        })}
        requirementsPreview={{ limit: 2, resetKey }}
      />
    );
    rerender(previewed("a"));
    fireEvent.click(screen.getByTestId("structured-requirements-show-all"));
    expect(screen.getAllByTestId("structured-requirement-row")).toHaveLength(3);
    rerender(previewed("b"));
    expect(screen.getAllByTestId("structured-requirement-row")).toHaveLength(2);
  });

  it("uses the task's canonical section without a projection fetch", () => {
    hookMocks.useWorkItemTypeByKey.mockReturnValue({
      workItemTypeDefinition: {
        key: "FEATURE",
        name: "Feature",
        sections: sectionSelections.FEATURE.sections,
        allowedStatuses: [],
        iconKey: "feature",
      },
      isFetched: true,
    });
    const entity = makeTask({
      id: "feature-plan-ui",
      name: "Plan UI",
      type: "FEATURE",
      sections: makeReadViewProps(sectionSelections.FEATURE, {
        requirements: JSON.stringify({
          records: [
            {
              id: "00000000-0000-4000-8000-000000000030",
              statement: "Render every grouped requirement",
              group: "Plan Viewer",
              designedBy: [],
              fulfilledBy: [
                {
                  entityType: "TASK",
                  entityId: "00000000-0000-4000-8000-000000000031",
                  entityTitle: "Title 00000000-0000-4000-8000-000000000031",
                },
              ],
              contracts: [],
            },
          ],
        }),
      }).sections,
    });

    render(<EntityViewer entityType="TASK" entity={entity} />, {
      wrapper: projectWrapper,
    });

    expect(
      screen.getByTestId("structured-requirements-group"),
    ).toHaveTextContent("Plan Viewer");
    expect(screen.getByTestId("structured-requirement-row")).toHaveTextContent(
      "Render every grouped requirement",
    );
    expect(
      screen
        .getByTestId("structured-requirement-row")
        .querySelector(
          '[data-entity-id="00000000-0000-4000-8000-000000000031"]',
        ),
    ).toBeInTheDocument();
  });

  it("renders grouped records and leaves ungrouped records without a synthetic group", () => {
    render(
      <WorkItemReadView
        {...makeReadViewProps(sectionSelections.FEATURE, {
          requirements: JSON.stringify({
            records: [
              {
                id: "00000000-0000-4000-8000-000000000040",
                statement: "Ungrouped requirement",
                designedBy: [],
                fulfilledBy: [],
                contracts: [],
              },
              {
                id: "00000000-0000-4000-8000-000000000041",
                statement: "Grouped requirement",
                group: "Access",
                designedBy: [],
                fulfilledBy: [],
                contracts: [],
              },
            ],
          }),
        })}
      />,
      { wrapper },
    );

    expect(
      screen.getByTestId("structured-requirements-group"),
    ).toHaveTextContent("Access");
    expect(screen.getAllByTestId("structured-requirement-row")).toHaveLength(2);
    expect(
      screen.getAllByTestId("structured-requirement-row")[0],
    ).toHaveTextContent("Ungrouped requirement");
    expect(screen.queryByText("Other")).not.toBeInTheDocument();
  });

  it("shows an explicit invalid state instead of reconstructing requirements from markdown", () => {
    render(
      <WorkItemReadView
        {...makeReadViewProps(sectionSelections.FEATURE, {
          requirements: "- Work-item types are configurable",
        })}
      />,
      { wrapper },
    );

    expect(
      screen.getByTestId("feature-requirements-invalid"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("structured-requirements"),
    ).not.toBeInTheDocument();
  });

  it("shows an empty state for an explicit empty canonical collection", () => {
    render(
      <WorkItemReadView
        {...makeReadViewProps(sectionSelections.FEATURE, {
          requirements: JSON.stringify({ records: [] }),
        })}
      />,
      { wrapper },
    );

    expect(
      screen.getByTestId("feature-requirements-section"),
    ).toHaveTextContent("feature-scope invariants");
    expect(
      screen.queryByTestId("structured-requirements"),
    ).not.toBeInTheDocument();
  });

  it("renders workflow mentions in the description through shared markdown", () => {
    render(
      <WorkItemReadView
        {...makeReadViewProps(sectionSelections.STANDARD, {
          description: "Use @[workflow:wf-1|Review workflow] for the rollout.",
        })}
      />,
      { wrapper },
    );

    expect(screen.getByTestId("mention-badge")).toHaveTextContent(
      "Review workflow",
    );
  });

  it("renders inline workflow diagrams from the shared read path", async () => {
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
      <WorkItemReadView
        {...makeReadViewProps(sectionSelections.STANDARD, {
          description: "Use @[workflow:wf-1|Review workflow] for the rollout.",
        })}
      />,
      { wrapper: projectWrapper },
    );
    await waitForDiagramArranged();

    expect(screen.getByTestId("workflow-inline-diagram")).toHaveTextContent(
      "Review workflow",
    );
    expect(screen.getByText("Review implementation")).toBeInTheDocument();
    expect(screen.queryByTestId("mention-badge")).not.toBeInTheDocument();
  });

  it("keeps workflow-unavailable fallback when read-view workflow data is missing", () => {
    render(
      <WorkItemReadView
        {...makeReadViewProps(sectionSelections.STANDARD, {
          description: "Use @[workflow:wf-1|Review workflow] for the rollout.",
        })}
      />,
      { wrapper: projectWrapper },
    );

    expect(
      screen.getByTestId("workflow-inline-diagram-unavailable"),
    ).toHaveTextContent("Review workflow");
    expect(
      screen.queryByTestId("workflow-inline-diagram"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("mention-badge")).not.toBeInTheDocument();
  });

  it("does not render markdown as a canonical requirements collection", () => {
    const requirements = "- Users can share dashboards\n- Shared links expire";
    render(
      <WorkItemReadView
        {...makeReadViewProps(sectionSelections.FEATURE, {
          description: "Feature description",
          requirements,
        })}
      />,
      { wrapper },
    );

    const section = screen.getByTestId("feature-requirements-section");
    expect(section).toBeInTheDocument();
    expect(
      screen.getByTestId("feature-requirements-invalid"),
    ).toBeInTheDocument();
    expect(section.textContent ?? "").not.toContain(requirements);
  });

  it("shows helper text explaining the boundary with acceptanceCriteria", () => {
    render(
      <WorkItemReadView
        {...makeReadViewProps(sectionSelections.FEATURE, {
          description: "desc",
          requirements: JSON.stringify({ records: [] }),
        })}
      />,
      { wrapper },
    );

    const section = screen.getByTestId("feature-requirements-section");
    expect(section.textContent ?? "").toMatch(/feature-scope invariants/i);
    expect(section.textContent ?? "").toMatch(/Acceptance Criteria/);
  });

  it("renders empty-state prompt when the canonical section is absent", () => {
    render(
      <WorkItemReadView
        {...makeReadViewProps(sectionSelections.FEATURE, {
          description: "desc",
        })}
      />,
      { wrapper },
    );

    const section = screen.getByTestId("feature-requirements-section");
    expect(section).toBeInTheDocument();
    expect(section.querySelector("li")).toBeNull();
    expect(section.textContent ?? "").toMatch(/feature-scope invariants/i);
  });

  it("does not render Requirements section for non-feature tasks", () => {
    render(
      <WorkItemReadView
        {...makeReadViewProps(sectionSelections.STANDARD, {
          description: "desc",
          acceptanceCriteria: "AC",
          requirements: "- should not render",
        })}
      />,
      { wrapper },
    );

    expect(
      screen.queryByTestId("feature-requirements-section"),
    ).not.toBeInTheDocument();
  });

  it("does not render Requirements section when taskType is undefined (initiative)", () => {
    render(
      <WorkItemReadView
        {...makeReadViewProps(sectionSelections.INITIATIVE, {
          description: "desc",
          acceptanceCriteria: "AC",
        })}
      />,
      { wrapper },
    );

    expect(
      screen.queryByTestId("feature-requirements-section"),
    ).not.toBeInTheDocument();
  });
});

describe("WorkItemReadView per-type acceptance criteria section", () => {
  it("renders Description but no Acceptance Criteria header for BUG tasks", () => {
    render(
      <WorkItemReadView
        {...makeReadViewProps(sectionSelections.BUG, {
          description: "Bug description",
        })}
      />,
      { wrapper },
    );

    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.queryByText("Acceptance Criteria")).toBeNull();
  });

  it("does not render Requirements section for BUG tasks", () => {
    render(
      <WorkItemReadView
        {...makeReadViewProps(sectionSelections.BUG, {
          description: "Bug description",
          requirements: "- should not render",
        })}
      />,
      { wrapper },
    );

    expect(
      screen.queryByTestId("feature-requirements-section"),
    ).not.toBeInTheDocument();
  });

  it("renders Acceptance Criteria for STANDARD tasks", () => {
    render(
      <WorkItemReadView
        {...makeReadViewProps(sectionSelections.STANDARD, {
          description: "Standard description",
          acceptanceCriteria: "- Works as expected",
        })}
      />,
      { wrapper },
    );

    expect(screen.getByText("Acceptance Criteria")).toBeInTheDocument();
  });
});

describe("WorkItemReadView registry-defined sections", () => {
  it("renders persisted MODE files through the structured files renderer", () => {
    const selection: ResolvedWorkItemSectionSelection = {
      status: "resolved",
      typeKey: "MODE",
      sections: [
        { key: "description", label: "Catalog description" },
        {
          key: "files",
          label: "MODE files",
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
    };

    render(
      <WorkItemReadView
        {...makeReadViewProps(selection, {
          description: "Catalog entry",
          files: JSON.stringify({
            schemaVersion: "project-mode-files.v1",
            files: {
              "MODE.md":
                "[Follow the project instructions](https://example.com/mode) with @[service:service-1|UI Service]",
              "references/review.md": "[Review it](https://example.com/review)",
            },
          }),
          applicability: JSON.stringify({
            eligibleWorkItemTypeKeys: ["STANDARD"],
          }),
        })}
        mentionConfig={{
          organizationId: "mention-organization",
          projectId: "mention-project",
          navigate: vi.fn(),
        }}
      />,
      { wrapper },
    );

    expect(screen.getByText("Catalog description")).toBeInTheDocument();
    expect(screen.getByText("MODE files")).toBeInTheDocument();
    expect(
      screen.getByTestId("mode-files-section-renderer"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Follow the project instructions" }),
    ).toHaveAttribute("href", "https://example.com/mode");
    expect(screen.getByTestId("mention-badge")).toHaveAttribute(
      "data-entity-type",
      "service",
    );
    expect(screen.getByTestId("mention-badge")).toHaveAttribute(
      "data-organization-id",
      "mention-organization",
    );
    expect(screen.getByTestId("mention-badge")).toHaveAttribute(
      "data-project-id",
      "mention-project",
    );
    expect(screen.getByTestId("mode-files-file-list")).toHaveTextContent(
      "references/review.md",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "references/review.md" }),
    );
    expect(screen.getByRole("link", { name: "Review it" })).toHaveAttribute(
      "href",
      "https://example.com/review",
    );
    expect(screen.getByTestId("json-section-content")).toHaveTextContent(
      "eligibleWorkItemTypeKeys",
    );
  });

  it("renders structured mockups according to the registry section kind", () => {
    const selection: ResolvedWorkItemSectionSelection = {
      status: "resolved",
      typeKey: "STRUCTURED_MOCKUP",
      sections: [
        {
          key: "mockup",
          label: "Mockup",
          kind: "structured-mockup",
          defaultSizeKey: "panel",
          sizeProfiles: [
            {
              key: "panel",
              label: "Panel",
              breakpoints: [
                {
                  minContainerWidth: 0,
                  inline: { width: 420, height: 260 },
                  page: { width: 800, height: 600 },
                },
              ],
            },
          ],
        },
      ],
    };

    const readViewProps = makeReadViewProps(selection, {
      mockup: JSON.stringify({
        schemaVersion: "work-item-structured-mockup.v1",
        content: [
          {
            type: "text",
            props: {
              id: "title",
              width: { mode: "fit" },
              height: { mode: "content" },
              text: "Reviewable mockup",
            },
          },
        ],
      }),
    });
    const view = render(
      <WorkItemReadView {...readViewProps} htmlCssRenderingContext="inline" />,
      { wrapper },
    );

    expect(screen.getByText("Reviewable mockup")).toBeInTheDocument();
    expect(
      screen.getByTestId("structured-mockup-section-renderer"),
    ).toHaveAttribute("data-rendering-context", "inline");

    view.rerender(
      <WorkItemReadView {...readViewProps} htmlCssRenderingContext="page" />,
    );
    expect(
      screen.getByTestId("structured-mockup-section-renderer"),
    ).toHaveAttribute("data-rendering-context", "page");
  });

  it("renders no sections when the selection is unavailable", () => {
    render(<WorkItemReadView sections={[]} sectionSelection={undefined} />, {
      wrapper,
    });

    expect(screen.queryByTestId("work-item-section")).not.toBeInTheDocument();
  });

  it("renders Contract as description-only without a type-name branch", () => {
    const contractSelection: ResolvedWorkItemSectionSelection = {
      status: "resolved",
      typeKey: "CONTRACT",
      sections: [{ key: "description", label: "Agreement" }],
    };

    render(
      <WorkItemReadView
        {...makeReadViewProps(contractSelection, {
          description: "The shared agreement",
          acceptanceCriteria: "must not render",
        })}
      />,
      { wrapper },
    );

    expect(screen.getByText("Agreement")).toBeInTheDocument();
    expect(screen.queryByText("Acceptance Criteria")).not.toBeInTheDocument();
  });

  it("uses custom labels and declared order for project-defined sections", () => {
    const customSelection: ResolvedWorkItemSectionSelection = {
      status: "resolved",
      typeKey: "RESEARCH",
      sections: [
        { key: "sources", label: "Evidence sources" },
        { key: "findings", label: "Research findings" },
      ],
    };

    render(
      <WorkItemReadView
        {...makeReadViewProps(customSelection, {
          findings: "Finding content",
          sources: "Source content",
        })}
      />,
      { wrapper },
    );

    const sections = screen.getAllByTestId("work-item-section");
    expect(sections.map((section) => section.dataset.sectionKey)).toEqual([
      "sources",
      "findings",
    ]);
    expect(screen.getByText("Evidence sources")).toBeInTheDocument();
    expect(screen.getByText("Research findings")).toBeInTheDocument();
  });

  it("uses the registry label for the requirements section", () => {
    const selection: ResolvedWorkItemSectionSelection = {
      status: "resolved",
      typeKey: "FEATURE",
      sections: [{ key: "requirements", label: "Delivery requirements" }],
    };

    render(
      <WorkItemReadView
        {...makeReadViewProps(selection, {
          requirements: "A linked requirement",
        })}
      />,
      { wrapper },
    );

    expect(screen.getByText("Delivery requirements")).toBeInTheDocument();
    expect(screen.queryByText(/^Requirements$/)).not.toBeInTheDocument();
  });

  it("renders no optional sections when the definition is unavailable", () => {
    render(
      <WorkItemReadView
        {...makeReadViewProps(
          { status: "unavailable", reason: "loading" },
          {
            description: "must not render",
            acceptanceCriteria: "must not render",
          },
        )}
      />,
      { wrapper },
    );

    expect(screen.queryByTestId("work-item-section")).not.toBeInTheDocument();
    expect(screen.queryByText("Description")).not.toBeInTheDocument();
  });
});
