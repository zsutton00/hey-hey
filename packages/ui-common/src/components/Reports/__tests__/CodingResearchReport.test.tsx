import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PropsWithChildren } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConversationStartRunRequestDtoProviderEnum,
  EntityType,
  ReportAudience,
  ReportType,
  type CodingResearchReportPayload,
  type ReportDto,
} from "../../../api";
import { MentionEditorContext } from "../../SmarterTextAreaCard/EditorContext";
import { CodingResearchReport } from "../viewer/CodingResearchReport";
import { buildCodingResearchDiscussionPrompt } from "../viewer/CodingResearchDiscussionAction";
import { CodingResearchUpdatesSection } from "../viewer/CodingResearchUpdatesSection";

const launcherMock = vi.hoisted(() => ({
  launch: vi.fn(),
  isLoading: false,
  error: null as { code: string | null; message: string } | null,
  clearError: vi.fn(),
}));

vi.mock("../../InteractionComponent/useEntityConversationLauncher", () => ({
  useEntityConversationLauncher: () => launcherMock,
}));

vi.mock("../../AgentSession/runtime/coding/useMachineResolution", () => ({
  useMachineResolution: () => ({
    isReady: true,
    machines: [{ machineId: "machine-1" }],
    executionReadyMachines: [{ machineId: "machine-1" }],
    mode: "one",
    selectedMachine: { machineId: "machine-1" },
    setSelectedMachineId: vi.fn(),
  }),
}));

vi.mock("../../AgentSession/surfaceSelectionMemory", () => ({
  DISCUSS_SURFACE_ID: "discuss",
  readSurfaceSelection: () => ({
    provider: ConversationStartRunRequestDtoProviderEnum.Codex,
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    fastMode: true,
  }),
  buildDefaultSurfaceSelection: () => ({
    provider: ConversationStartRunRequestDtoProviderEnum.Claude,
    model: "claude-opus-4-8",
    reasoningEffort: "medium",
  }),
}));

vi.mock("../../shared/MarkdownRenderer", () => ({
  MarkdownRenderer: ({
    children,
    mentionMode,
  }: PropsWithChildren<{ mentionMode?: string }>) => (
    <div data-mention-mode={mentionMode} data-testid="markdown-renderer">
      {children}
    </div>
  ),
}));

const FOCAL_TASK_ID = "2533ce2a-653e-46c1-a3eb-bc2039d85c97";
const DESIGN_DOC_ID = "176dd18c-a7bf-474f-9445-3e0d5af0d29b";

const buildReport = (payload: CodingResearchReportPayload): ReportDto =>
  ({
    id: "coding-research-report",
    organizationId: "org-1",
    projectId: "project-1",
    reportType: ReportType.CodingResearch,
    audience: ReportAudience.WorkflowOnly,
    title: "Research report fixture",
    payload,
    version: 1,
    schemaVersion: 1,
    sourceExecutionId: "exec-1",
    createdAt: "2026-07-21T00:00:00.000Z",
    expiresAt: "2026-08-21T00:00:00.000Z",
    entities: [],
  }) as ReportDto;

const fullPayload: CodingResearchReportPayload = {
  reportType: "CODING_RESEARCH",
  summary:
    "The renderer remains typed and keeps its human-readable handoff visible.",
  analysis:
    "The **frame**, discovery history, and traversed edges are supporting audit context.\n\n- Preserve the typed renderer boundary.",
  frame: {
    focalId: FOCAL_TASK_ID,
    nodes: [
      {
        id: FOCAL_TASK_ID,
        type: EntityType.Task,
        title: "Improve CODING_RESEARCH renderer",
        content:
          "Preserve @[contract:b74388c0-f605-405a-937c-f9035d9de0e3|Report mention rendering contract] while presenting the frame.",
        contentSource: "original",
        edges: [
          {
            toId: DESIGN_DOC_ID,
            type: "depends_on",
            reasoning:
              "The renderer follows @[design_doc:176dd18c-a7bf-474f-9445-3e0d5af0d29b|Reports viewer renderer contract].",
          },
        ],
      },
      {
        id: DESIGN_DOC_ID,
        type: EntityType.DesignDoc,
        title: "Reports viewer renderer contract",
        content:
          "Narrow the report payload once and compose shared report primitives.",
        contentSource: "extracted",
        edges: [],
      },
    ],
  },
  provenance: {
    discoveryCalls: [
      {
        tool: "get_context",
        query: FOCAL_TASK_ID,
        intent:
          "Orient around @[task:2533ce2a-653e-46c1-a3eb-bc2039d85c97|Improve CODING_RESEARCH renderer].",
      },
    ],
    edgesTraversed: [
      {
        fromId: FOCAL_TASK_ID,
        toId: DESIGN_DOC_ID,
        reasoning:
          "The design document defines the shared typed-renderer contract.",
      },
    ],
  },
  updates: [
    {
      type: "update",
      targets: [
        {
          entityType: EntityType.Task,
          entityId: FOCAL_TASK_ID,
          title: "Improve CODING_RESEARCH renderer",
        },
        {
          entityType: EntityType.DesignDoc,
          entityId: DESIGN_DOC_ID,
          title: "Reports viewer renderer contract",
        },
      ],
      description:
        "Update the renderer requirement to cite the implementation task.",
      reason:
        "The report frame shows the requirement and its implementation contract together.",
    },
  ],
};

const renderReport = (
  payload: CodingResearchReportPayload,
  reportTestId: string,
) =>
  render(
    <MemoryRouter>
      <MentionEditorContext.Provider
        value={{
          navigate: () => undefined,
          organizationId: "org-1",
          projectId: "project-1",
        }}
      >
        <CodingResearchReport
          payload={payload}
          report={buildReport(payload)}
          reportTestId={reportTestId}
        />
      </MentionEditorContext.Provider>
    </MemoryRouter>,
  );

describe("CodingResearchReport", () => {
  beforeEach(() => {
    launcherMock.launch.mockReset();
    launcherMock.launch.mockResolvedValue(true);
    launcherMock.clearError.mockReset();
    launcherMock.isLoading = false;
    launcherMock.error = null;
  });

  it("shows the summary and open updates while keeping analysis collapsed", () => {
    renderReport(fullPayload, "research");

    expect(
      screen.getByTestId("research-coding-research-summary"),
    ).toHaveTextContent("human-readable handoff visible");

    expect(
      screen.getByTestId("research-coding-research-analysis-toggle"),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("markdown-renderer")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("research-coding-research-updates-toggle"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("research-coding-research-summary").nextElementSibling,
    ).toBe(screen.getByTestId("research-coding-research-updates"));
    expect(
      screen.getByTestId("research-coding-research-updates").nextElementSibling,
    ).toBe(screen.getByTestId("research-coding-research-analysis"));
    expect(
      screen.getByTestId("research-coding-research-updates-card-0"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("research-coding-research-updates-discuss"),
    ).toHaveTextContent("Review proposed changes");
    expect(
      screen.queryByTestId("research-coding-research-details"),
    ).not.toBeInTheDocument();
  });

  it("renders no proposed changes when updates are missing", () => {
    render(
      <CodingResearchUpdatesSection
        frameModel={{ state: "unavailable" }}
        report={buildReport(fullPayload)}
        reportTestId="missing-updates"
      />,
    );

    expect(
      screen.queryByTestId("missing-updates-coding-research-updates"),
    ).not.toBeInTheDocument();
  });

  it("gates research details behind analysis and resets them on reopening", async () => {
    const user = userEvent.setup();
    const { container } = renderReport(fullPayload, "research");
    const analysisToggle = screen.getByTestId(
      "research-coding-research-analysis-toggle",
    );

    await user.click(analysisToggle);

    expect(analysisToggle).toHaveAttribute("aria-expanded", "true");
    const analysis = screen.getByTestId("research-coding-research-analysis");
    const markdownRenderer = within(analysis).getByTestId("markdown-renderer");
    expect(markdownRenderer).toHaveAttribute("data-mention-mode", "minimal");
    expect(markdownRenderer).toHaveTextContent(
      "The **frame**, discovery history, and traversed edges are supporting audit context.",
    );
    const detailsToggle = screen.getByTestId(
      "research-coding-research-details-toggle",
    );
    expect(detailsToggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByTestId("research-coding-research-frame-node-0-card"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("research-coding-research-discovery-call-0-card"),
    ).not.toBeInTheDocument();

    expect(
      screen.queryByTestId("research-coding-research-edge-0-card"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("research-coding-research-updates"),
    ).toBeInTheDocument();
  });

  it("renders the existing update cards and typed targets immediately", () => {
    renderReport(fullPayload, "research");
    expect(
      screen.getByTestId("research-coding-research-updates"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("research-coding-research-updates-card-0-operation"),
    ).toHaveTextContent("Update");
    expect(
      screen.getByTestId("research-coding-research-updates-card-0-description"),
    ).toHaveTextContent("Update the renderer requirement");
    expect(
      screen.getByTestId("research-coding-research-updates-card-0-reason"),
    ).toHaveTextContent("The report frame shows");
    const updateTargets = screen.getByTestId(
      "research-coding-research-updates-card-0-targets",
    );
    expect(
      within(updateTargets).queryByText("Entity update"),
    ).not.toBeInTheDocument();
    expect(
      within(updateTargets).getAllByTestId(
        "coding-research-update-entity-icon",
      ),
    ).toHaveLength(2);
    expect(within(updateTargets).getAllByTestId("mention-badge")).toHaveLength(
      2,
    );
    expect(
      within(updateTargets).getAllByTestId("mention-badge")[0],
    ).toHaveTextContent("Improve CODING_RESEARCH renderer");
    expect(
      within(updateTargets).getAllByTestId("mention-badge")[1],
    ).toHaveTextContent("Reports viewer renderer contract");
    expect(
      screen.getByTestId("research-coding-research-updates-card-0")
        .nextElementSibling,
    ).toBeNull();
    expect(
      screen.getByTestId("research-coding-research-updates-discuss"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("research-coding-research-updates-content"),
    ).toHaveTextContent(
      "Open a new conversation to review the reasoning and decide what should change.",
    );
    expect(
      screen.queryByTestId("research-coding-research-details"),
    ).not.toBeInTheDocument();
  });

  it("launches the entity discussion immediately with a report mention and remembered runtime selection", async () => {
    const user = userEvent.setup();
    const report = buildReport(fullPayload);
    renderReport(fullPayload, "research");

    await user.click(
      screen.getByTestId("research-coding-research-updates-discuss"),
    );

    expect(launcherMock.launch).toHaveBeenCalledWith({
      prompt: buildCodingResearchDiscussionPrompt(report),
      provider: ConversationStartRunRequestDtoProviderEnum.Codex,
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      machineId: "machine-1",
      fastMode: true,
      projectAssistant: { enabled: false },
      context: {
        entityId: FOCAL_TASK_ID,
        entityType: EntityType.Task,
        entityTitle: "Improve CODING_RESEARCH renderer",
      },
    });
    expect(buildCodingResearchDiscussionPrompt(report)).toBe(
      "@[report:coding-research-report|Research report fixture]\n\nThe user wants to discuss the updates that were proposed.",
    );
  });

  it("disables the direct action while launching and presents launch failures", () => {
    launcherMock.isLoading = true;
    launcherMock.error = {
      code: "LAUNCH_FAILED",
      message: "Unable to start this discussion.",
    };

    renderReport(fullPayload, "research");

    expect(screen.getByText("Unable to start this discussion.")).toBeVisible();
    expect(
      screen.getByTestId("research-coding-research-updates-discuss"),
    ).toBeDisabled();
    expect(screen.getByLabelText("Starting review conversation")).toBeVisible();
  });

  it("expands frame and provenance without updates, then resets them with analysis", async () => {
    const user = userEvent.setup();
    const { container } = renderReport(fullPayload, "research");
    const analysisToggle = screen.getByTestId(
      "research-coding-research-analysis-toggle",
    );

    await user.click(analysisToggle);

    const detailsToggle = screen.getByTestId(
      "research-coding-research-details-toggle",
    );
    await user.click(detailsToggle);

    expect(detailsToggle).toHaveAttribute("aria-expanded", "true");
    expect(
      within(
        screen.getByTestId("research-coding-research-details-content"),
      ).queryByTestId("research-coding-research-updates"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("research-coding-research-frame-node-0-card"),
    ).toBeInTheDocument();
    const nodeTitle = screen.getByTestId(
      "research-coding-research-frame-node-0-title",
    );
    const nodeLink = within(nodeTitle).getByTestId("mention-badge");
    expect(nodeLink.tagName).toBe("A");
    expect(nodeLink.getAttribute("href")).toContain(FOCAL_TASK_ID);
    const nodeMetadata = screen.getByTestId(
      "research-coding-research-frame-node-0-metadata",
    );
    expect(
      within(nodeMetadata).getByTestId(
        "research-coding-research-frame-node-0-type",
      ),
    ).toHaveTextContent("TASK");
    expect(
      within(nodeMetadata).getByTestId(
        "research-coding-research-frame-node-0-content-source",
      ),
    ).toHaveTextContent("Original");
    expect(
      screen.queryByTestId("research-coding-research-frame-node-0-id"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("research-coding-research-frame-node-0-edge-0-card"),
    ).toBeInTheDocument();
    const edgeTarget = screen.getByTestId(
      "research-coding-research-frame-node-0-edge-0-target",
    );
    const edgeTargetLink = within(edgeTarget).getByTestId("mention-badge");
    expect(edgeTargetLink).toHaveTextContent(
      "Reports viewer renderer contract",
    );
    expect(edgeTargetLink.getAttribute("href")).toContain(DESIGN_DOC_ID);
    expect(
      screen.getByTestId(
        "research-coding-research-frame-node-0-edge-0-relationship",
      ),
    ).toHaveTextContent("Depends on");
    expect(
      within(
        screen.getByTestId("research-coding-research-frame"),
      ).getAllByTestId("mention-badge"),
    ).not.toHaveLength(0);
    expect(container.querySelector("pre")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent('"focalId"');
    expect(
      screen.getByTestId("research-coding-research-discovery-call-0-card"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("research-coding-research-discovery-call-0-intent"),
    ).toContainElement(screen.getAllByTestId("mention-badge").at(-1) ?? null);
    expect(
      screen.getByTestId("research-coding-research-edge-0-card"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("research-coding-research-edge-0-from-id"),
    ).toHaveTextContent(FOCAL_TASK_ID);

    await user.click(detailsToggle);

    expect(
      screen.queryByTestId("research-coding-research-frame-node-0-card"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("research-coding-research-discovery-call-0-card"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("research-coding-research-edge-0-card"),
    ).not.toBeInTheDocument();

    await user.click(analysisToggle);

    expect(analysisToggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByTestId("research-coding-research-details"),
    ).not.toBeInTheDocument();

    await user.click(analysisToggle);

    expect(analysisToggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByTestId("research-coding-research-details-toggle"),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByTestId("research-coding-research-frame-node-0-card"),
    ).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent('"focalId"');
  });

  it("renders defined empty states when expanded", async () => {
    const user = userEvent.setup();
    const emptyPayload: CodingResearchReportPayload = {
      ...fullPayload,
      frame: { focalId: FOCAL_TASK_ID, nodes: [] },
      provenance: { discoveryCalls: [], edgesTraversed: [] },
      updates: [],
    };

    renderReport(emptyPayload, "empty-research");

    expect(
      screen.queryByTestId("empty-research-coding-research-updates"),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByTestId("empty-research-coding-research-analysis-toggle"),
    );
    await user.click(
      screen.getByTestId("empty-research-coding-research-details-toggle"),
    );

    expect(
      screen.getByTestId("empty-research-coding-research-frame-empty"),
    ).toHaveTextContent("No research frame nodes recorded.");
    expect(
      screen.getByTestId(
        "empty-research-coding-research-discovery-calls-empty",
      ),
    ).toHaveTextContent("No discovery calls recorded.");
    expect(
      screen.getByTestId("empty-research-coding-research-edges-empty"),
    ).toHaveTextContent("No edges traversed.");
  });

  it("renders a report whose payload has no provenance", async () => {
    const user = userEvent.setup();
    const { provenance: _omitted, ...withoutProvenance } = fullPayload;

    renderReport(
      withoutProvenance as unknown as CodingResearchReportPayload,
      "no-provenance",
    );

    expect(
      screen.getByTestId("no-provenance-coding-research-summary"),
    ).toBeInTheDocument();

    await user.click(
      screen.getByTestId("no-provenance-coding-research-analysis-toggle"),
    );
    await user.click(
      screen.getByTestId("no-provenance-coding-research-details-toggle"),
    );

    expect(
      screen.getByTestId("no-provenance-coding-research-discovery-calls-empty"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("no-provenance-coding-research-edges-empty"),
    ).toBeInTheDocument();
  });
});
