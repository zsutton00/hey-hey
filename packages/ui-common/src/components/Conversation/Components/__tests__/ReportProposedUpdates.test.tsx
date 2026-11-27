import { ThemeProvider } from "@mui/material/styles";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConversationStartRunRequestDtoProviderEnum,
  EntityType,
  ReportAudience,
  ReportType,
  type CodingResearchReportPayload,
  type ReportDto,
  type SuggestionDecisionResponseDto,
} from "../../../../api";
import { createHeyTheme } from "../../../../contexts/ThemeContext";
import { log } from "../../../../utils/logger";
import { ReportViewer } from "../../../Reports";
import { buildProposedUpdateKeys } from "../../../Reports/viewer/codingResearchProposedUpdate";
import { ReportProposedUpdates } from "../ReportProposedUpdates";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  mutate: vi.fn(),
  refresh: vi.fn(),
  decisions: {} as Record<string, SuggestionDecisionResponseDto>,
}));

vi.mock("../ConversationContext", () => ({
  useOptionalConversationContext: () => null,
  useConversationContext: () => ({
    suggestionDecisions: {
      getDecision: (id: string) => mocks.decisions[id],
      upsertDecision: (decision: SuggestionDecisionResponseDto) => {
        mocks.decisions[decision.id] = decision;
      },
    },
  }),
}));
vi.mock("../../../../contexts/ModalContext", () => ({
  useModal: () => ({ openModal: vi.fn() }),
}));
vi.mock("../../../../data/graphql/conversationCache", () => ({
  refreshConversation: mocks.refresh,
}));
vi.mock("@apollo/client/react", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useApolloClient: () => ({}),
}));
vi.mock("../../../../data/hooks/useSuggestionDecision", () => ({
  useSuggestionDecision: () => ({ mutate: mocks.mutate }),
}));
vi.mock("../../../../contexts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePathService: () => ({
    agentSession: ({
      projectId,
      agentSessionId,
    }: {
      projectId: string;
      agentSessionId: string;
    }) => `/projects/${projectId}/sessions/${agentSessionId}`,
  }),
}));
vi.mock("../../../InteractionComponent/useEntityConversationLauncher", () => ({
  useEntityConversationLauncher: () => ({
    launch: mocks.launch,
    isLoading: false,
    error: null,
    clearError: vi.fn(),
  }),
}));
vi.mock("../../../AgentSession/runtime/coding/useMachineResolution", () => ({
  useMachineResolution: () => ({
    isReady: true,
    machines: [{ machineId: "machine-1" }],
    mode: "one",
    selectedMachine: { machineId: "machine-1" },
    setSelectedMachineId: vi.fn(),
  }),
}));
vi.mock("../../../AgentSession/useSurfaceSelection", () => ({
  useSurfaceSelection: () => ({
    selection: {
      provider: ConversationStartRunRequestDtoProviderEnum.Claude,
      model: "claude-opus-4-8",
      reasoningEffort: "medium",
    },
  }),
}));

const TASK_ID = "29a107cd-3b32-407c-b1e8-1217c98b7d3d";
const FEATURE_ID = "b7c90c4e-4ee8-4b0e-aaa1-75eecc4fa2b7";
const MOCKUP_ID = "b751a052-c970-469e-bd01-a0682ac58813";
const CONTEXT = {
  messageId: "message-1",
  conversationId: "conversation-1",
  organizationId: "org-1",
  projectId: "project-1",
};

// Shaped like a saved structured Project Assistant report: two updates with
// typed targets, a focal node in the frame, and no per-update id.
const structuredPayload: CodingResearchReportPayload = {
  reportType: "CODING_RESEARCH",
  format: "SELF_RESEARCH",
  summary: "Per-update cards replace the tinted panel.",
  analysis: "The Coding Research Reports requirements need rewording.",
  frame: {
    focalId: TASK_ID,
    nodes: [
      {
        id: TASK_ID,
        type: EntityType.Task,
        title: "Show each Project Assistant proposed update as its own card",
        content: "Task body",
        contentSource: "original",
        edges: [],
      },
    ],
  },
  provenance: { discoveryCalls: [], edgesTraversed: [] },
  updates: [
    {
      type: "update",
      targets: [
        {
          entityType: EntityType.Task,
          entityId: FEATURE_ID,
          title: "Coding Research Reports",
        },
      ],
      description: "Reword the Discussion requirement to one update.",
      reason: "The task replaces the all-updates sentence.",
    },
    {
      type: "add",
      targets: [
        {
          entityType: EntityType.Task,
          entityId: MOCKUP_ID,
          title: "Project Assistant proposed-update cards",
        },
      ],
      description: "Record the started state on the mockup.",
      reason: "The cards now remember a started discussion.",
    },
  ],
  uncertainties: [],
};

const buildReport = (payload: CodingResearchReportPayload): ReportDto =>
  ({
    id: "report-1",
    organizationId: "org-1",
    projectId: "project-1",
    reportType: ReportType.CodingResearch,
    audience: ReportAudience.ProjectVisible,
    title: "Project Assistant research",
    payload,
    version: 1,
    schemaVersion: 1,
    sourceExecutionId: "exec-1",
    createdAt: "2026-11-24T00:00:00.000Z",
    expiresAt: "2026-12-24T00:00:00.000Z",
    entities: [],
  }) as ReportDto;

const renderCards = (
  payload: CodingResearchReportPayload,
  mode: "light" | "dark" = "light",
) =>
  render(
    <ThemeProvider theme={createHeyTheme(mode)}>
      <MemoryRouter>
        <ReportProposedUpdates
          context={CONTEXT}
          report={buildReport(payload)}
        />
      </MemoryRouter>
    </ThemeProvider>,
  );

const storedDecision = (
  id: string,
  agentSessionId: string,
): SuggestionDecisionResponseDto =>
  ({
    id,
    type: "project_assistant_update",
    accepted: true,
    decidedBy: null,
    createdAt: "2026-11-24T00:00:00.000Z",
    sourceConversationId: "conversation-1",
    sourceMessageId: "message-1",
    metadata: { kind: "PROJECT_ASSISTANT_UPDATE", agentSessionId },
  }) as SuggestionDecisionResponseDto;

describe("ReportProposedUpdates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decisions = {};
    mocks.refresh.mockResolvedValue(undefined);
    mocks.mutate.mockImplementation(
      async (variables: {
        suggestionId: string;
        metadata: { agentSessionId: string };
      }) =>
        storedDecision(
          variables.suggestionId,
          variables.metadata.agentSessionId,
        ),
    );
  });

  it.each(["light", "dark"] as const)(
    "shows each update as its own project-sync card in report order (%s)",
    (mode) => {
      renderCards(structuredPayload, mode);

      const cards = screen.getAllByTestId("proposed-update-card");
      expect(cards).toHaveLength(2);
      expect(cards[0]).toHaveAttribute("data-tone", "projectSync");
      expect(
        within(cards[0]).getByTestId("proposed-update-operation"),
      ).toHaveTextContent("Update");
      expect(
        within(cards[1]).getByTestId("proposed-update-operation"),
      ).toHaveTextContent("Add");
      expect(cards[0]).toHaveTextContent("Project sync · Proposed update");
      expect(cards[0]).toHaveTextContent(
        "Reword the Discussion requirement to one update.",
      );
      expect(cards[0]).toHaveTextContent("Reason");
      expect(cards[0]).toHaveTextContent("Coding Research Reports");
      expect(
        within(cards[0]).getByTestId("proposed-update-discuss"),
      ).toHaveAccessibleName("Discuss this change");
    },
  );

  // Frame nodes are agent-labelled, so saved reports carry work-item type keys.
  it.each(["CONTRACT", "mockup", "customer_interview"])(
    "keeps Discuss on every card when the research includes a %s item",
    async (label) => {
      mocks.launch.mockResolvedValue(false);
      const user = userEvent.setup();
      const payload = structuredPayload as Extract<
        CodingResearchReportPayload,
        { format: "SELF_RESEARCH" }
      >;
      const focal = {
        id: TASK_ID,
        type: label,
        title: "Focal item",
        content: "Body",
        contentSource: "original",
        edges: [],
      };
      renderCards({ ...payload, frame: { focalId: TASK_ID, nodes: [focal] } });

      const actions = screen.getAllByTestId("proposed-update-discuss");
      expect(actions).toHaveLength(2);
      await user.click(actions[0]);

      expect(mocks.launch.mock.calls[0][0].context).toMatchObject({
        entityId: TASK_ID,
        entityType: EntityType.Task,
      });
    },
  );

  it("logs why a research frame could not be read, without its content", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const payload = structuredPayload as Extract<
      CodingResearchReportPayload,
      { format: "SELF_RESEARCH" }
    >;

    renderCards({ ...payload, frame: { focalId: TASK_ID } });

    expect(screen.getAllByTestId("proposed-update-card")).toHaveLength(2);
    expect(screen.queryByTestId("proposed-update-discuss")).toBeNull();
    expect(warn).toHaveBeenCalledWith("ui", expect.any(String), {
      reportId: "report-1",
      reason: "nodes: invalid_type",
    });
    warn.mockRestore();
  });

  it("renders no cards for a written report, a legacy-free empty list, or no updates", () => {
    const written = {
      reportType: "CODING_RESEARCH",
      format: "SUBAGENT_PARENT",
      summary: "Written",
      analysis: "Written analysis",
    } as CodingResearchReportPayload;

    for (const payload of [
      written,
      { ...structuredPayload, updates: [] },
      { ...structuredPayload, updates: undefined },
    ]) {
      const { unmount } = renderCards(payload);
      expect(screen.queryByTestId("proposed-update-card")).toBeNull();
      unmount();
    }
  });

  it("starts a discussion about only that update and records it after launch succeeds", async () => {
    mocks.launch.mockImplementation(
      async (input: { onLaunched?: (id: string) => void }) => {
        expect(mocks.mutate).not.toHaveBeenCalled();
        input.onLaunched?.("session-new");
        return true;
      },
    );
    const user = userEvent.setup();
    renderCards(structuredPayload);

    const [first, second] = screen.getAllByTestId("proposed-update-card");
    await user.click(within(first).getByTestId("proposed-update-discuss"));

    const launchInput = mocks.launch.mock.calls[0][0];
    expect(launchInput.projectAssistant).toEqual({ enabled: false });
    expect(launchInput.context).toMatchObject({ entityId: TASK_ID });
    expect(launchInput.machineId).toBe("machine-1");
    expect(launchInput.prompt).toContain("@[report:report-1|");
    expect(launchInput.prompt).toContain(
      "Reword the Discussion requirement to one update.",
    );
    expect(launchInput.prompt).not.toContain("Record the started state");

    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
    expect(mocks.mutate.mock.calls[0][0]).toMatchObject({
      organizationId: "org-1",
      type: "project_assistant_update",
      accepted: true,
      sourceConversationId: "conversation-1",
      sourceMessageId: "message-1",
      metadata: {
        kind: "PROJECT_ASSISTANT_UPDATE",
        agentSessionId: "session-new",
      },
    });
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());

    expect(
      await within(first).findByTestId("proposed-update-started"),
    ).toHaveTextContent("Discussion started");
    expect(
      within(first).getByTestId("proposed-update-session-link"),
    ).toHaveAttribute("href", "/projects/project-1/sessions/session-new");
    expect(within(second).getByTestId("proposed-update-discuss")).toBeEnabled();
  });

  it("records nothing and keeps the action when the launch fails or is cancelled", async () => {
    mocks.launch.mockResolvedValue(false);
    const user = userEvent.setup();
    renderCards(structuredPayload);

    const [first] = screen.getAllByTestId("proposed-update-card");
    await user.click(within(first).getByTestId("proposed-update-discuss"));

    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(within(first).getByTestId("proposed-update-discuss")).toBeEnabled();
    expect(within(first).queryByTestId("proposed-update-started")).toBeNull();
  });

  it("shows a stored start on the recorded update only, and every action on an older conversation", async () => {
    const user = userEvent.setup();
    mocks.launch.mockResolvedValue(false);

    // Older conversation: nothing stored for these updates.
    const older = renderCards(structuredPayload);
    expect(screen.getAllByTestId("proposed-update-discuss")).toHaveLength(2);
    // Capture the keys the first load used by recording through the UI.
    mocks.launch.mockImplementationOnce(
      async (input: { onLaunched?: (id: string) => void }) => {
        input.onLaunched?.("session-stored");
        return true;
      },
    );
    await user.click(screen.getAllByTestId("proposed-update-discuss")[0]);
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalled());
    const storedKey = mocks.mutate.mock.calls[0][0].suggestionId as string;
    older.unmount();

    // Reload (another member): only the recorded update shows its session.
    mocks.decisions = {
      [storedKey]: storedDecision(storedKey, "session-stored"),
    };
    renderCards(structuredPayload);

    const [first, second] = screen.getAllByTestId("proposed-update-card");
    expect(
      within(first).getByTestId("proposed-update-session-link"),
    ).toHaveAttribute("href", "/projects/project-1/sessions/session-stored");
    expect(within(first).queryByTestId("proposed-update-discuss")).toBeNull();
    expect(within(second).getByTestId("proposed-update-discuss")).toBeEnabled();
  });

  it("keeps the started link and retries only the save, without launching again", async () => {
    mocks.launch.mockImplementation(
      async (input: { onLaunched?: (id: string) => void }) => {
        input.onLaunched?.("session-new");
        return true;
      },
    );
    mocks.mutate.mockRejectedValueOnce(new Error("network"));
    const user = userEvent.setup();
    renderCards(structuredPayload);

    const [first] = screen.getAllByTestId("proposed-update-card");
    await user.click(within(first).getByTestId("proposed-update-discuss"));

    expect(
      await within(first).findByTestId("proposed-update-save-failed"),
    ).toBeInTheDocument();
    expect(
      within(first).getByTestId("proposed-update-session-link"),
    ).toHaveAttribute("href", "/projects/project-1/sessions/session-new");

    await user.click(within(first).getByTestId("proposed-update-retry-save"));

    await waitFor(() =>
      expect(
        within(first).queryByTestId("proposed-update-save-failed"),
      ).toBeNull(),
    );
    expect(mocks.launch).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledTimes(2);
    expect(mocks.mutate.mock.calls[1][0].suggestionId).toBe(
      mocks.mutate.mock.calls[0][0].suggestionId,
    );
  });

  it("keeps updates in the report body unless the conversation opts into cards", () => {
    const renderViewer = (renderUpdates: boolean) =>
      render(
        <ThemeProvider theme={createHeyTheme("light")}>
          <MemoryRouter>
            <ReportViewer
              renderHeader={false}
              renderOpenQuestions={false}
              renderUpdates={renderUpdates}
              report={buildReport(structuredPayload)}
            />
          </MemoryRouter>
        </ThemeProvider>,
      );

    const standalone = renderViewer(true);
    expect(
      screen.getByTestId("report-viewer-report-1-coding-research-updates"),
    ).toHaveTextContent("Proposed changes");
    expect(screen.getByText("Review proposed changes")).toBeInTheDocument();
    standalone.unmount();

    renderViewer(false);
    expect(
      screen.queryByTestId("report-viewer-report-1-coding-research-updates"),
    ).toBeNull();
    expect(screen.queryByText("Review proposed changes")).toBeNull();
    expect(
      screen.getByTestId("report-viewer-report-1-coding-research-summary"),
    ).toBeInTheDocument();
  });

  it("keys each update by what it says, stable across loads and distinct for repeats", () => {
    const [first, second] = structuredPayload.updates ?? [];
    const keys = buildProposedUpdateKeys("message-1", "report-1", [
      first,
      second,
      first,
    ]);
    const reloaded = buildProposedUpdateKeys("message-1", "report-1", [
      first,
      second,
      first,
    ]);
    const reordered = buildProposedUpdateKeys("message-1", "report-1", [
      second,
      first,
    ]);
    const revised = buildProposedUpdateKeys("message-1", "report-1", [
      { ...first, description: "A revised description." },
    ]);

    expect(reloaded).toEqual(keys);
    expect(new Set(keys).size).toBe(3);
    expect(reordered).toEqual([keys[1], keys[0]]);
    expect(revised[0]).not.toBe(keys[0]);
    expect(keys[0].startsWith("message-1:update:report-1:")).toBe(true);
  });

  it("keeps the same update in two reports on one message independent", async () => {
    mocks.launch.mockImplementation(
      async (input: { onLaunched?: (id: string) => void }) => {
        input.onLaunched?.("session-first-report");
        return true;
      },
    );
    const user = userEvent.setup();
    const secondReport = { ...buildReport(structuredPayload), id: "report-2" };
    render(
      <ThemeProvider theme={createHeyTheme("light")}>
        <MemoryRouter>
          <ReportProposedUpdates
            context={CONTEXT}
            report={buildReport(structuredPayload)}
          />
          <ReportProposedUpdates context={CONTEXT} report={secondReport} />
        </MemoryRouter>
      </ThemeProvider>,
    );

    const cards = screen.getAllByTestId("proposed-update-card");
    expect(cards).toHaveLength(4);
    await user.click(within(cards[0]).getByTestId("proposed-update-discuss"));

    expect(
      await within(cards[0]).findByTestId("proposed-update-started"),
    ).toBeInTheDocument();
    expect(
      within(cards[2]).getByTestId("proposed-update-discuss"),
    ).toBeEnabled();
    expect(
      within(cards[2]).queryByTestId("proposed-update-started"),
    ).toBeNull();
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(Object.keys(mocks.decisions)).toHaveLength(1);
  });
});
