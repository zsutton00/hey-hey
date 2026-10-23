import type { PropsWithChildren, ReactElement } from "react";
import {
  fireEvent,
  render as renderWithTestingLibrary,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  FeatureSyncReportSourceType,
  PlanReportSeverity,
  PlanReportSourceType,
  ReportAudience,
  ReportType,
  ValidationActionTypeEnum,
  type CodingResearchReportPayload,
  type CommitReportPayload,
  type CompetitiveAnalysisReportPayload,
  type DailySessionReportPayload,
  type DecisionNeededReportPayload,
  type FeatureSyncHandoffReportPayload,
  type FeatureSyncDecisionReportPayload,
  type FeatureSyncDecisionReportPayloadV2,
  type FeatureSyncReportPayload,
  type FeatureTreeAnalysisReportPayload,
  type ImplementReportPayload,
  type PhaseGroundingReportPayload,
  type PlanReportPayload,
  type ReportDto,
  type RiskAlertReportPayload,
  type RollupProposalReportPayload,
  type SessionMonitorDeferralReportPayload,
  type SessionSummaryReportPayload,
  type SnapshotReportPayload,
  type ValidationWalkthroughReportPayload,
} from "../../../api";
import { ReportViewer } from "../ReportViewer";
import type { EvidencePipelineReportPayload } from "../viewer/evidencePipelineTypes";
import { ProjectContext } from "../../../contexts";

vi.mock("../../../data/hooks/useLocalRepoBindings", () => ({
  useLocalRepoBindings: () => ({
    status: "empty",
    bindings: [],
    bindingsByServiceId: {},
  }),
}));

vi.mock("../../../data/hooks/usePlatformAdminAccess", () => ({
  usePlatformAdminAccess: () => ({ isPlatformAdmin: false, isResolved: true }),
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

vi.mock("../viewer/InteractivePlanReport", () => ({
  InteractivePlanReport: ({ payload, reportTestId, interaction }) => (
    <div
      data-testid={`${reportTestId}-plan-interactive-mock`}
      data-source-ui-element-id={interaction.sourceUiElement.id}
    >
      {payload.sessionTitle}
    </div>
  ),
}));

const render = (ui: ReactElement) =>
  renderWithTestingLibrary(ui, { wrapper: MemoryRouter });

const baseFixture = {
  id: "dispatch-report",
  organizationId: "org-1",
  audience: ReportAudience.WorkflowOnly,
  version: 1,
  schemaVersion: 1,
  sourceExecutionId: "exec-1",
  createdAt: "2026-05-15T00:00:00.000Z",
  expiresAt: "2026-06-15T00:00:00.000Z",
  entities: [],
} as const;

const snapshotReport: ReportDto = {
  ...baseFixture,
  id: "dispatch-snapshot",
  reportType: ReportType.Snapshot,
  title: "Snapshot Report",
  payload: {
    reportType: "SNAPSHOT",
    summary: "Snapshot handoff summary.",
  } satisfies SnapshotReportPayload,
} as ReportDto;

const validationReport: ReportDto = {
  ...baseFixture,
  id: "dispatch-validation",
  reportType: ReportType.ValidationWalkthrough,
  title: "Validation Walkthrough",
  payload: {
    reportType: "VALIDATION_WALKTHROUGH",
    summary: "Walkthrough handoff summary.",
    validationSteps: [
      {
        title: "Run unit tests",
        description: "Execute the unit test suite for the package.",
        actions: [
          {
            type: ValidationActionTypeEnum.CommandLine,
            command: "pnpm vitest run",
          },
        ],
      },
    ],
  } satisfies ValidationWalkthroughReportPayload,
} as ReportDto;

const evidenceReport: ReportDto = {
  ...baseFixture,
  id: "dispatch-evidence",
  reportType: ReportType.EvidencePipeline,
  title: "Evidence Pipeline",
  payload: {
    plannerInput: {
      messageCount: 2,
      optionKeys: ["scope"],
      maxRounds: 1,
      scaffoldedQaAnswerFocus: false,
    },
    searchSteps: [
      {
        query: "auth token refresh",
        why: "Surface prior decisions on token refresh",
        queryPerspective: "service",
        tool: "semantic_search",
      },
    ],
    searchResults: [],
    selectedEvidenceKeys: [],
    excludedEvidenceKeys: [],
    hydratedEvidenceKeys: [],
    implementationHints: [],
    finalEvidence: [],
    execution: {
      startedAt: "2026-05-15T00:00:00.000Z",
      completedAt: "2026-05-15T00:00:01.000Z",
      durationMs: 1000,
      totalSearchSteps: 1,
      cachedStepCount: 0,
      uncachedStepCount: 1,
      errorCount: 0,
    },
  } satisfies EvidencePipelineReportPayload,
} as unknown as ReportDto;

const implementReport: ReportDto = {
  ...baseFixture,
  id: "dispatch-implement",
  reportType: ReportType.Implement,
  title: "Implement Report",
  payload: {
    reportType: "IMPLEMENT",
    summary: "Implement handoff summary.",
    filesChanged: ["src/components/Reports/viewer/ImplementReport.tsx"],
    decisions: [
      {
        topic: "Renderer placement",
        choice: "Co-locate with sibling typed renderers in viewer/",
        reasoning: "Keeps the typed renderer contract surface contained.",
      },
    ],
  } satisfies ImplementReportPayload,
} as ReportDto;

const featureSyncReport: ReportDto = {
  ...baseFixture,
  id: "dispatch-feature-sync",
  reportType: ReportType.FeatureSync,
  title: "Feature Sync Report",
  payload: {
    reportType: "FEATURE_SYNC",
    summary: "Feature sync handoff summary.",
    discrepancies: [
      {
        sourceType: FeatureSyncReportSourceType.Task,
        source: {
          entityType: FeatureSyncReportSourceType.Task,
          entityId: "76d3266c-9484-4214-b828-3358e9412330",
          title: "Typed FEATURE_SYNC renderer",
        },
        description: "Task description references the wrong dispatcher name.",
      },
    ],
    reconciliationOptions: [
      {
        description: "Edit the task description to match the dispatcher name.",
        discrepancyIndices: [0],
      },
    ],
  } satisfies FeatureSyncReportPayload,
} as ReportDto;

const featureSyncHandoffReport: ReportDto = {
  ...baseFixture,
  id: "dispatch-feature-sync-handoff",
  reportType: ReportType.FeatureSyncHandoff,
  title: "Feature Sync Handoff Report",
  payload: {
    reportType: "FEATURE_SYNC_HANDOFF",
    summary: "Feature sync handoff handoff summary.",
    notes: [
      {
        category: "hidden_requirements",
        text: "Renderer must preserve mention rendering inside note text.",
      },
    ],
  } satisfies FeatureSyncHandoffReportPayload,
} as ReportDto;

const planReport: ReportDto = {
  ...baseFixture,
  id: "dispatch-plan",
  reportType: ReportType.Plan,
  title: "Plan Report",
  payload: {
    reportType: "PLAN",
    summary: "Plan handoff summary.",
    sessionTitle: "Typed PLAN renderer rollout",
    primaryImplementations: [
      {
        title: "Shared plan cards",
        content:
          "Render the **proposed implementation** before execution steps.",
        rationale: "The result leads with the concrete outcome.",
      },
      {
        title: "Typed connection",
        content: "const relationship = 'enforces';",
        rationale: "The report presents only supplied evidence.",
        language: "typescript",
        location:
          "[$UI Common/src/components/CodingPlan/PrimaryImplementationList.tsx](heyhey-file:v1:120a3e96-14e2-4fe9-9eaa-e6ef80697c64:src%2Fcomponents%2FCodingPlan%2FPrimaryImplementationList.tsx)",
        connections: [
          {
            entityType: "workflowStep",
            entityId: "9b38a0ca-95bb-4ae0-b4aa-3496e58cd848",
            entityTitle: "Present the plan",
            relationship: "fulfills",
            sourceField: "workflow.steps[0]",
            sourceExcerpt:
              "Present the primary implementation before execution.",
            rationale: "This renderer fulfills the presentation step.",
          },
        ],
      },
    ],
    executionPlan: [
      {
        stepId: "step-1",
        title: "Author the typed PlanReport renderer",
        description: "Compose summary, panels, and cards from primitives.",
        phase: 1,
        targetFiles: ["src/components/Reports/viewer/PlanReport.tsx"],
        references: [
          {
            sourceType: PlanReportSourceType.Task,
            sourceId: "6134cfc4-4b57-491e-9804-861d7153be2c",
            rationale: "Primary task driving this renderer.",
          },
        ],
      },
      {
        stepId: "step-2",
        title: "Verify the flat sequence",
        description: "Keep global numbering across retained phase metadata.",
        phase: 2,
        references: [],
      },
    ],
    discrepancies: [
      {
        sourceRef: {
          sourceType: PlanReportSourceType.Task,
          sourceId: "6134cfc4-4b57-491e-9804-861d7153be2c",
        },
        sourceField: "description",
        sourceExcerpt: "getReportRenderer dispatcher",
        discrepancyText: "Dispatcher identifier is stale",
        reasoning: "The dispatcher is named renderReportBody in the code.",
        severity: PlanReportSeverity.Low,
      },
    ],
    clarificationQuestions: [
      {
        question: "Should references render inline or in a nested list?",
        reason: "The plan describes both presentation options.",
      },
    ],
  } satisfies PlanReportPayload,
} as ReportDto;

const phaseGroundingReport: ReportDto = {
  ...baseFixture,
  id: "dispatch-phase-grounding",
  reportType: ReportType.PhaseGrounding,
  title: "Phase Grounding Report",
  payload: {
    reportType: "PHASE_GROUNDING",
    summary: "Phase grounding handoff summary.",
    planAdjustment: "Dropped one touch point the plan no longer requires.",
    touchPoints: [
      {
        file: "src/components/Reports/viewer/PhaseGroundingReport.tsx",
        expectedOutcome: "Author the typed renderer from shared primitives.",
      },
      {
        file: "src/components/Reports/viewer/rendererContract.ts",
        expectedOutcome:
          "Confirm PhaseGrounding resolves through the narrow switch.",
        divergenceFromInitialPlan:
          "No edit needed — already present in the narrow switch.",
      },
    ],
  } satisfies PhaseGroundingReportPayload,
} as ReportDto;

const codingResearchReport: ReportDto = {
  ...baseFixture,
  id: "dispatch-coding-research",
  reportType: ReportType.CodingResearch,
  title: "Coding Research Report",
  payload: {
    reportType: "CODING_RESEARCH",
    summary: "Coding research handoff summary.",
    analysis: "No issues found in this area.",
    frame: {
      focalId: "2533ce2a-653e-46c1-a3eb-bc2039d85c97",
      nodes: [],
    },
    provenance: { discoveryCalls: [], edgesTraversed: [] },
    updates: [],
  } satisfies CodingResearchReportPayload,
} as ReportDto;

const featureTreeAnalysisReport: ReportDto = {
  ...baseFixture,
  id: "dispatch-feature-tree-analysis",
  reportType: ReportType.FeatureTreeAnalysis,
  title: "Feature Tree Analysis Report",
  payload: {
    reportType: "FEATURE_TREE_ANALYSIS",
    summary: "Feature tree analysis handoff summary.",
    title: "Feature tree coverage snapshot",
    text: "Walking the tree top-down reveals a healthy split between product and engineering containers.",
  } satisfies FeatureTreeAnalysisReportPayload,
} as ReportDto;

const commitReport: ReportDto = {
  ...baseFixture,
  id: "dispatch-commit",
  reportType: ReportType.Commit,
  title: "Commit Report",
  payload: {
    reportType: "COMMIT",
    summary: "Commit handoff summary.",
    files: [
      "src/components/Reports/viewer/CommitReport.tsx",
      "src/components/Reports/viewer/index.ts",
    ],
    hashes: [{ service: "ui-common", hash: "a1b2c3d", branch: "feature/foo" }],
  } satisfies CommitReportPayload,
} as ReportDto;

const competitiveAnalysisReport: ReportDto = {
  ...baseFixture,
  id: "dispatch-competitive-analysis",
  reportType: ReportType.CompetitiveAnalysis,
  title: "Competitive Analysis Report",
  payload: {
    reportType: "COMPETITIVE_ANALYSIS",
    summary: "Competitive analysis handoff summary.",
    title: "Coverage vs. Linear, Notion, and Asana",
    text: "Differentiation centers on the agent-authoring surface; no competitor matches it.",
    competitors: ["Linear", "Notion", "Asana"],
  } satisfies CompetitiveAnalysisReportPayload,
} as ReportDto;

const dailySessionReport: ReportDto = {
  ...baseFixture,
  id: "dispatch-daily-session",
  reportType: ReportType.DailySession,
  title: "Daily Session Report",
  payload: {
    reportType: "DAILY_SESSION",
    summary: "Daily session handoff summary.",
  } satisfies DailySessionReportPayload,
} as ReportDto;

const sessionSummaryReport: ReportDto = {
  ...baseFixture,
  id: "dispatch-session-summary",
  reportType: ReportType.SessionSummary,
  title: "Session Summary Report",
  payload: {
    reportType: "SESSION_SUMMARY",
    text: "Session **summary** handoff for @[feature:6e671950-78ff-41fc-b001-1e1378b6e41a|Reports].",
    summary:
      "Session **details** include a formatted follow-up.\n\n- First item",
  } satisfies SessionSummaryReportPayload,
} as ReportDto;

const sessionMonitorDeferralReport: ReportDto = {
  ...baseFixture,
  id: "dispatch-session-monitor-deferral",
  reportType: ReportType.SessionMonitorDeferral,
  title: "Session Monitor Deferral Report",
  payload: {
    reportType: "SESSION_MONITOR_DEFERRAL",
    summary: "Session monitor deferral handoff summary.",
    assessedSessionId: "4c150e0c-25d3-45c9-9f24-b410eb4a5e45",
    assessedTurnId: "turn-1",
    assessedReportIds: ["6473d8ea-d643-4864-b9fa-94a1bda372a7"],
    reasoning:
      "The report leaves the canonical next step ambiguous, so user review is required.",
  } satisfies SessionMonitorDeferralReportPayload,
} as ReportDto;

const rollupProposalReport: ReportDto = {
  ...baseFixture,
  id: "dispatch-rollup-proposal",
  reportType: ReportType.RollupProposal,
  title: "Rollup Proposal Report",
  payload: {
    reportType: "ROLLUP_PROPOSAL",
    summary: "Rollup proposal handoff summary.",
    taskId: "0298c7c3-04fc-48d1-9718-8af34e90ce01",
    triggeredBy: "user:suppai@gmail.com",
    triggeredAt: "2026-05-18T14:00:00.000Z",
    parentFeatures: ["461f6ba7-010f-4853-90d0-ea5d878b0a0c"],
    relatedFeatures: ["c40abdb3-fa1c-4f55-9d10-9d8a7e9f55ee"],
  } satisfies RollupProposalReportPayload,
} as ReportDto;

const riskAlertReport: ReportDto = {
  ...baseFixture,
  id: "dispatch-risk-alert",
  reportType: ReportType.RiskAlert,
  title: "Risk Alert Report",
  payload: {
    reportType: "RISK_ALERT",
    summary: "Risk alert handoff summary.",
    title: "Missing parent for plan execution telemetry",
    text: "Plan execution telemetry leaves have no parent feature; risk of orphaned work.",
  } satisfies RiskAlertReportPayload,
} as ReportDto;

describe("ReportViewer dispatcher", () => {
  it("renders ordered behavioral changes with explanations immediately after literal code", () => {
    const report: ReportDto = {
      ...baseFixture,
      reportType: ReportType.ChangeWalkthrough,
      title: "Guided changes",
      payload: {
        reportType: "CHANGE_WALKTHROUGH",
        summary: "Important changes",
        targetRunId: "11111111-1111-4111-8111-111111111111",
        groups: [
          {
            title: "Authorization",
            changes: [
              {
                title: "Deny by default",
                context: "Policy feeds the consumer",
                walkthrough: ["policy.ts", "consumer.ts"].map(
                  (file, index) => ({
                    excerpt: {
                      serviceId: "22222222-2222-4222-8222-222222222222",
                      file,
                      startLine: 1,
                      endLine: 1,
                      code:
                        index === 0 ? "allow = false;" : "checkPermission();",
                      language: "typescript",
                      sourceVersion: {
                        kind: "GIT" as const,
                        revision: "a".repeat(40),
                      },
                      verification: {
                        status: "UNRESOLVED" as const,
                        reason: "Unavailable revision",
                      },
                    },
                    explanation:
                      index === 0
                        ? "This small edit changes the default."
                        : "The consumer applies the policy.",
                  }),
                ),
                behavioralConsequence: "Unauthorized requests are denied.",
              },
            ],
          },
          {
            title: "Supporting plumbing",
            changes: [
              {
                title: "Shared schema and tests",
                context: "Repeated plumbing grouped together",
                walkthrough: [],
                behavioralConsequence: "Consumers agree.",
              },
            ],
          },
        ],
      },
    } as ReportDto;
    render(<ReportViewer report={report} />);
    expect(screen.getByTestId("change-walkthrough-report")).toBeTruthy();
    expect(
      screen
        .getAllByTestId("walkthrough-group")
        .map((group) => group.textContent),
    ).toEqual([
      expect.stringContaining("Authorization"),
      expect.stringContaining("Supporting plumbing"),
    ]);
    const steps = screen.getAllByTestId("walkthrough-step");
    expect(steps).toHaveLength(2);
    const code = within(steps[0]).getByTestId("walkthrough-code");
    expect(code.nextElementSibling?.textContent).toContain("This small edit");
    expect(screen.getByText("Unauthorized requests are denied.")).toBeTruthy();
    expect(
      screen
        .getAllByRole("button", { name: /\.ts:1/ })
        .every((button) => button.hasAttribute("disabled")),
    ).toBe(true);
  });

  it("routes SNAPSHOT reports to the typed snapshot renderer composed against ReportLabeledText", () => {
    render(<ReportViewer report={snapshotReport} />);

    const snapshotBlock = screen.getByTestId(
      "report-viewer-dispatch-snapshot-snapshot",
    );
    expect(snapshotBlock).toBeInTheDocument();
    expect(
      screen.getByTestId("report-viewer-dispatch-snapshot-snapshot-summary"),
    ).toHaveTextContent("Snapshot handoff summary.");
  });

  it("renders an inline report title handoff as a canonical semantic link", () => {
    renderWithTestingLibrary(
      <ProjectContext.Provider
        value={{
          organizationId: "org-1",
          projectId: "project-1",
          navigate: vi.fn(),
        }}
      >
        <ReportViewer
          report={{
            ...snapshotReport,
            id: "inline-report-1",
            title: "Inline snapshot",
          }}
          renderHeader={false}
          titleLink={{
            entityId: "inline-report-1",
            projectId: "project-1",
            title: "Inline snapshot",
          }}
        />
      </ProjectContext.Provider>,
      { wrapper: MemoryRouter },
    );

    const titleLink = screen.getByRole("link", { name: "Inline snapshot" });
    expect(titleLink).toHaveAttribute(
      "href",
      "/projects/project-1/reports/inline-report-1",
    );
    titleLink.focus();
    expect(document.activeElement).toBe(titleLink);
    expect(
      screen.queryByTestId("report-viewer-inline-report-1-title"),
    ).not.toBeInTheDocument();
  });

  it("routes VALIDATION_WALKTHROUGH reports to the typed walkthrough renderer composed against ReportItemCard", () => {
    render(<ReportViewer report={validationReport} />);

    const stepList = screen.getByTestId(
      "report-viewer-dispatch-validation-steps",
    );
    expect(stepList.tagName).toBe("OL");
    expect(
      screen.getByTestId("report-viewer-dispatch-validation-step-0-title"),
    ).toHaveTextContent("1. Run unit tests");
    expect(
      screen.getByTestId("report-viewer-dispatch-validation-step-0-card"),
    ).toBeInTheDocument();
  });

  it("renders canonical mentions in validation walkthrough prose while preserving commands", () => {
    const report: ReportDto = {
      ...validationReport,
      id: "dispatch-validation-mentions",
      payload: {
        ...validationReport.payload,
        validationSteps: [
          {
            title:
              "Verify @[feature:8be2f12f-4313-427a-a279-70f94136f0c6|@ Mention Nodes]",
            description:
              "Confirm @[task:00000000-0000-4000-8000-000000000001|Unavailable task] keeps its fallback label.",
            actions: [
              {
                type: ValidationActionTypeEnum.CommandLine,
                command:
                  "printf '@[task:00000000-0000-4000-8000-000000000002|command token]'",
              },
            ],
          },
        ],
      } satisfies ValidationWalkthroughReportPayload,
    } as ReportDto;

    render(<ReportViewer report={report} />);

    expect(
      within(
        screen.getByTestId(
          "report-viewer-dispatch-validation-mentions-step-0-title",
        ),
      ).getByTestId("mention-badge"),
    ).toHaveTextContent("@ Mention Nodes");
    expect(
      within(
        screen.getByTestId(
          "report-viewer-dispatch-validation-mentions-step-0-description",
        ),
      ).getByTestId("mention-badge"),
    ).toHaveTextContent("Unavailable task");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-validation-mentions-step-0-action-0-command",
      ),
    ).toHaveTextContent(
      "@[task:00000000-0000-4000-8000-000000000002|command token]",
    );
  });

  it("routes IMPLEMENT reports to the typed implement renderer composed against ReportPanel and ReportItemCard primitives", () => {
    render(<ReportViewer report={implementReport} />);

    expect(
      screen.getByTestId("report-viewer-dispatch-implement-implement"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("report-viewer-dispatch-implement-implement-summary"),
    ).toHaveTextContent("Implement handoff summary.");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-implement-implement-files-list",
      ),
    ).toHaveTextContent("src/components/Reports/viewer/ImplementReport.tsx");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-implement-implement-decision-0-card",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-implement-implement-decision-0-title",
      ),
    ).toHaveTextContent("Renderer placement");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-implement-implement-decision-0-choice",
      ),
    ).toHaveTextContent("Co-locate with sibling typed renderers in viewer/");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-implement-implement-decision-0-reasoning",
      ),
    ).toHaveTextContent("Keeps the typed renderer contract surface contained.");
  });

  it("routes PLAN reports to the typed plan renderer composed against ReportPanel and ReportItemCard primitives", () => {
    render(<ReportViewer report={planReport} />);

    expect(
      screen.getByTestId("report-viewer-dispatch-plan-plan"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("report-viewer-dispatch-plan-plan-summary"),
    ).toHaveTextContent("Plan handoff summary.");
    expect(
      screen.getByTestId("report-viewer-dispatch-plan-plan-session-title"),
    ).toHaveTextContent("Typed PLAN renderer rollout");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-plan-plan-execution-step-0-title",
      ),
    ).toHaveTextContent("1. Author the typed PlanReport renderer");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-plan-plan-execution-step-0-card",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-plan-plan-primary-implementation-list-item-0-title",
      ),
    ).toHaveTextContent("Shared plan cards");
    expect(
      screen.getByText("Implementation preview — final changes may differ."),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-plan-plan-primary-implementation-list-preview-warning",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Typed connection" }));
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-plan-plan-primary-implementation-list-item-1-connection-0-relationship",
      ),
    ).toHaveTextContent("Fulfills");
    const location = screen.getByTestId(
      "report-viewer-dispatch-plan-plan-primary-implementation-list-item-1-location",
    );
    expect(within(location).getByTestId("markdown-renderer").textContent).toBe(
      "[$UI Common/src/components/CodingPlan/PrimaryImplementationList.tsx](heyhey-file:v1:120a3e96-14e2-4fe9-9eaa-e6ef80697c64:src%2Fcomponents%2FCodingPlan%2FPrimaryImplementationList.tsx)",
    );
    expect(
      screen
        .getByText("Present the plan")
        .closest('[data-testid="mention-badge"]'),
    ).toHaveAttribute("data-entity-id", "9b38a0ca-95bb-4ae0-b4aa-3496e58cd848");
    expect(
      screen.queryByTestId(
        "report-viewer-dispatch-plan-plan-primary-implementation-list-item-0-connections",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(
        "report-viewer-dispatch-plan-plan-primary-implementation-list-item-1-connection-0-source-field",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Present the primary implementation before execution.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByText("2. Verify the flat sequence")).toBeInTheDocument();
    expect(screen.queryByText("Phase 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Phase 2")).not.toBeInTheDocument();
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-plan-plan-discrepancy-0-title",
      ),
    ).toHaveTextContent("1. Dispatcher identifier is stale");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-plan-plan-discrepancy-0-severity",
      ),
    ).toHaveTextContent("low");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-plan-plan-clarification-question-0-title",
      ),
    ).toHaveTextContent(
      "1. Should references render inline or in a nested list?",
    );
  });

  it("selects the interactive PLAN renderer only when conversation interaction context is supplied", () => {
    render(
      <ReportViewer
        report={planReport}
        planInteraction={{
          sourceUiElement: {
            id: "startup-plan-field",
            type: "coding_prompt_startup_plan",
            label: "Startup plan",
          },
          parentMessageId: "message-1",
          fieldContext: {
            conversationId: "conversation-1",
            projectId: "project-1",
            organizationId: "org-1",
          },
          disabled: false,
          submit: vi.fn(),
        }}
      />,
    );

    expect(
      screen.getByTestId("report-viewer-dispatch-plan-plan-interactive-mock"),
    ).toHaveAttribute("data-source-ui-element-id", "startup-plan-field");
    expect(
      screen.queryByTestId("report-viewer-dispatch-plan-plan"),
    ).not.toBeInTheDocument();
  });

  it("renders the PLAN primary implementations empty state when the persisted field is missing", () => {
    const reportWithoutPrimaryImplementations = structuredClone(planReport);
    Reflect.deleteProperty(
      reportWithoutPrimaryImplementations.payload,
      "primaryImplementations",
    );

    render(<ReportViewer report={reportWithoutPrimaryImplementations} />);

    expect(
      screen.getByTestId(
        "report-viewer-dispatch-plan-plan-primary-implementations-empty",
      ),
    ).toHaveTextContent("No primary implementations were proposed.");
  });

  it("routes PHASE_GROUNDING reports to the typed phase grounding renderer composed against ReportPanel and ReportItemCard primitives", () => {
    render(<ReportViewer report={phaseGroundingReport} />);

    expect(
      screen.getByTestId(
        "report-viewer-dispatch-phase-grounding-phase-grounding",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-phase-grounding-phase-grounding-summary",
      ),
    ).toHaveTextContent("Phase grounding handoff summary.");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-phase-grounding-phase-grounding-plan-adjustment",
      ),
    ).toHaveTextContent("Dropped one touch point the plan no longer requires.");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-phase-grounding-phase-grounding-touch-points",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-phase-grounding-phase-grounding-touch-point-0-card",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-phase-grounding-phase-grounding-touch-point-0-file",
      ),
    ).toHaveTextContent(
      "src/components/Reports/viewer/PhaseGroundingReport.tsx",
    );
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-phase-grounding-phase-grounding-touch-point-0-expected-outcome-block",
      ),
    ).toHaveTextContent("Author the typed renderer from shared primitives.");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-phase-grounding-phase-grounding-touch-point-1-divergence-block",
      ),
    ).toHaveTextContent(
      "No edit needed — already present in the narrow switch.",
    );
  });

  it("routes FEATURE_SYNC reports to the typed feature sync renderer composed against ReportPanel and ReportItemCard primitives", () => {
    render(<ReportViewer report={featureSyncReport} />);

    expect(
      screen.getByTestId("report-viewer-dispatch-feature-sync-feature-sync"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-feature-sync-feature-sync-summary",
      ),
    ).toHaveTextContent("Feature sync handoff summary.");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-feature-sync-feature-sync-discrepancy-0-card",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-feature-sync-feature-sync-discrepancy-0-title",
      ),
    ).toHaveTextContent("1. Typed FEATURE_SYNC renderer");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-feature-sync-feature-sync-discrepancy-0-source",
      ),
    ).toHaveTextContent("Typed FEATURE_SYNC renderer");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-feature-sync-feature-sync-discrepancy-0-description-block",
      ),
    ).toHaveTextContent(
      "Task description references the wrong dispatcher name.",
    );
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-feature-sync-feature-sync-reconciliation-option-0-card",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-feature-sync-feature-sync-reconciliation-option-0-title",
      ),
    ).toHaveTextContent(
      "1. Edit the task description to match the dispatcher name.",
    );
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-feature-sync-feature-sync-reconciliation-option-0-resolves-item-0",
      ),
    ).toHaveTextContent("1. Typed FEATURE_SYNC renderer");
  });

  it("routes FEATURE_SYNC_HANDOFF reports to the typed feature sync handoff renderer composed against ReportPanel and ReportItemCard primitives", () => {
    render(<ReportViewer report={featureSyncHandoffReport} />);

    expect(
      screen.getByTestId(
        "report-viewer-dispatch-feature-sync-handoff-feature-sync-handoff",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-feature-sync-handoff-feature-sync-handoff-summary",
      ),
    ).toHaveTextContent("Feature sync handoff handoff summary.");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-feature-sync-handoff-feature-sync-handoff-notes",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-feature-sync-handoff-feature-sync-handoff-note-0-card",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-feature-sync-handoff-feature-sync-handoff-note-0-title",
      ),
    ).toHaveTextContent("1. hidden_requirements");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-feature-sync-handoff-feature-sync-handoff-note-0-text-block",
      ),
    ).toHaveTextContent(
      "Renderer must preserve mention rendering inside note text.",
    );
  });

  it("routes CODING_RESEARCH reports to the typed coding research renderer composed against ReportLabeledText", () => {
    render(<ReportViewer report={codingResearchReport} />);

    expect(
      screen.getByTestId(
        "report-viewer-dispatch-coding-research-coding-research",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-coding-research-coding-research-summary",
      ),
    ).toHaveTextContent("Coding research handoff summary.");
    expect(
      screen.queryByTestId("report-viewer-dispatch-coding-research-empty"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(
        "report-viewer-dispatch-coding-research-coding-research-details-toggle",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(
        "report-viewer-dispatch-coding-research-coding-research-edges",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(
        "report-viewer-dispatch-coding-research-coding-research-updates",
      ),
    ).not.toBeInTheDocument();
  });

  it("routes FEATURE_TREE_ANALYSIS reports to the typed feature tree analysis renderer composed against ReportLabeledText", () => {
    render(<ReportViewer report={featureTreeAnalysisReport} />);

    expect(
      screen.getByTestId(
        "report-viewer-dispatch-feature-tree-analysis-feature-tree-analysis",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-feature-tree-analysis-feature-tree-analysis-summary",
      ),
    ).toHaveTextContent("Feature tree analysis handoff summary.");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-feature-tree-analysis-feature-tree-analysis-title",
      ),
    ).toHaveTextContent("Feature tree coverage snapshot");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-feature-tree-analysis-feature-tree-analysis-text",
      ),
    ).toHaveTextContent(
      "Walking the tree top-down reveals a healthy split between product and engineering containers.",
    );
  });

  it("routes COMPETITIVE_ANALYSIS reports to the typed competitive analysis renderer composed against ReportLabeledText", () => {
    render(<ReportViewer report={competitiveAnalysisReport} />);

    expect(
      screen.getByTestId(
        "report-viewer-dispatch-competitive-analysis-competitive-analysis",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-competitive-analysis-competitive-analysis-summary",
      ),
    ).toHaveTextContent("Competitive analysis handoff summary.");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-competitive-analysis-competitive-analysis-title",
      ),
    ).toHaveTextContent("Coverage vs. Linear, Notion, and Asana");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-competitive-analysis-competitive-analysis-text",
      ),
    ).toHaveTextContent(
      "Differentiation centers on the agent-authoring surface; no competitor matches it.",
    );
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-competitive-analysis-competitive-analysis-competitor-0",
      ),
    ).toHaveTextContent("Linear");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-competitive-analysis-competitive-analysis-competitor-2",
      ),
    ).toHaveTextContent("Asana");
  });

  it("routes COMMIT reports to the typed commit renderer composed against ReportPanel and ReportLabeledText primitives", () => {
    render(<ReportViewer report={commitReport} />);

    expect(
      screen.getByTestId("report-viewer-dispatch-commit-commit"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("report-viewer-dispatch-commit-commit-summary"),
    ).toHaveTextContent("Commit handoff summary.");
    expect(
      screen.getByTestId("report-viewer-dispatch-commit-commit-files-list"),
    ).toHaveTextContent("src/components/Reports/viewer/CommitReport.tsx");
    expect(
      screen.getByTestId("report-viewer-dispatch-commit-commit-files-list"),
    ).toHaveTextContent("src/components/Reports/viewer/index.ts");
    expect(
      screen.getByTestId("report-viewer-dispatch-commit-commit-hashes-item-0"),
    ).toHaveTextContent("ui-common: a1b2c3d (feature/foo)");
  });

  it("renders legacy COMMIT hash entries that carry no branch", () => {
    const legacyCommitReport = {
      ...commitReport,
      payload: {
        ...(commitReport.payload as CommitReportPayload),
        hashes: [{ service: "ui-common", hash: "a1b2c3d" }],
      },
    } as unknown as ReportDto;
    render(<ReportViewer report={legacyCommitReport} />);

    const item = screen.getByTestId(
      "report-viewer-dispatch-commit-commit-hashes-item-0",
    );
    expect(item).toHaveTextContent("ui-common: a1b2c3d");
    expect(item).not.toHaveTextContent("(");
  });

  it("routes RISK_ALERT reports to the typed risk alert renderer", () => {
    render(<ReportViewer report={riskAlertReport} />);

    expect(
      screen.getByTestId("report-viewer-dispatch-risk-alert-risk-alert"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-risk-alert-risk-alert-summary",
      ),
    ).toHaveTextContent("Risk alert handoff summary.");
    expect(
      screen.getByTestId("report-viewer-dispatch-risk-alert-risk-alert-title"),
    ).toHaveTextContent("Missing parent for plan execution telemetry");
    expect(
      screen.getByTestId("report-viewer-dispatch-risk-alert-risk-alert-text"),
    ).toHaveTextContent(
      "Plan execution telemetry leaves have no parent feature; risk of orphaned work.",
    );
  });

  it("routes DAILY_SESSION reports to the typed daily session renderer composed against ReportLabeledText", () => {
    render(<ReportViewer report={dailySessionReport} />);

    expect(
      screen.getByTestId("report-viewer-dispatch-daily-session-daily-session"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-daily-session-daily-session-summary",
      ),
    ).toHaveTextContent("Daily session handoff summary.");
  });

  it("passes SESSION_SUMMARY prose through the shared Markdown renderer with mention handling", () => {
    render(<ReportViewer report={sessionSummaryReport} />);

    expect(
      screen.getByTestId(
        "report-viewer-dispatch-session-summary-session-summary",
      ),
    ).toBeInTheDocument();
    const summaryBlock = screen.getByTestId(
      "report-viewer-dispatch-session-summary-session-summary-text",
    );
    expect(within(summaryBlock).getByText("Summary")).toBeInTheDocument();
    const summaryMarkdown =
      within(summaryBlock).getByTestId("markdown-renderer");
    expect(summaryMarkdown).toHaveAttribute("data-mention-mode", "minimal");
    expect(summaryMarkdown).toHaveTextContent(
      "Session **summary** handoff for @[feature:6e671950-78ff-41fc-b001-1e1378b6e41a|Reports].",
    );

    const detailsBlock = screen.getByTestId(
      "report-viewer-dispatch-session-summary-session-summary-summary",
    );
    expect(within(detailsBlock).getByText("Details")).toBeInTheDocument();
    const detailsMarkdown =
      within(detailsBlock).getByTestId("markdown-renderer");
    expect(detailsMarkdown).toHaveAttribute("data-mention-mode", "minimal");
    expect(detailsMarkdown.textContent).toBe(
      "Session **details** include a formatted follow-up.\n\n- First item",
    );
  });

  it("converts non-string Session Summary details before Markdown rendering", () => {
    const nonStringSummaryReport = {
      ...sessionSummaryReport,
      payload: { ...sessionSummaryReport.payload, summary: 42 },
    } as ReportDto;
    render(<ReportViewer report={nonStringSummaryReport} />);
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-session-summary-session-summary-summary",
      ),
    ).toHaveTextContent("42");
  });

  it("omits Session Summary details when the summary is nullish", () => {
    const nullSummaryReport = {
      ...sessionSummaryReport,
      payload: { ...sessionSummaryReport.payload, summary: null },
    } as ReportDto;
    render(<ReportViewer report={nullSummaryReport} />);
    expect(
      screen.queryByTestId(
        "report-viewer-dispatch-session-summary-session-summary-summary",
      ),
    ).not.toBeInTheDocument();
  });

  it("routes SESSION_MONITOR_DEFERRAL reports to the typed deferral renderer with review context and reasoning", () => {
    render(<ReportViewer report={sessionMonitorDeferralReport} />);

    expect(
      screen.getByTestId(
        "report-viewer-dispatch-session-monitor-deferral-session-monitor-deferral",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-session-monitor-deferral-session-monitor-deferral-summary",
      ),
    ).toHaveTextContent("Session monitor deferral handoff summary.");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-session-monitor-deferral-session-monitor-deferral-assessed-session",
      ),
    ).toHaveTextContent("4c150e0c-25d3-45c9-9f24-b410eb4a5e45");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-session-monitor-deferral-session-monitor-deferral-assessed-turn",
      ),
    ).toHaveTextContent("turn-1");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-session-monitor-deferral-session-monitor-deferral-assessed-report",
      ),
    ).toHaveTextContent("6473d8ea-d643-4864-b9fa-94a1bda372a7");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-session-monitor-deferral-session-monitor-deferral-reasoning",
      ),
    ).toHaveTextContent(
      "The report leaves the canonical next step ambiguous, so user review is required.",
    );
  });

  it("routes ROLLUP_PROPOSAL reports to the typed rollup proposal renderer composed against ReportPanel and ReportItemCard primitives", () => {
    render(<ReportViewer report={rollupProposalReport} />);

    expect(
      screen.getByTestId(
        "report-viewer-dispatch-rollup-proposal-rollup-proposal",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-rollup-proposal-rollup-proposal-summary",
      ),
    ).toHaveTextContent("Rollup proposal handoff summary.");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-rollup-proposal-rollup-proposal-task",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-rollup-proposal-rollup-proposal-triggered-by",
      ),
    ).toHaveTextContent("user:suppai@gmail.com");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-rollup-proposal-rollup-proposal-triggered-at",
      ),
    ).toHaveTextContent("2026-05-18T14:00:00.000Z");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-rollup-proposal-rollup-proposal-parent-feature-0-card",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-rollup-proposal-rollup-proposal-parent-feature-0-title",
      ),
    ).toHaveTextContent("461f6ba7-010f-4853-90d0-ea5d878b0a0c");
    expect(
      screen.getByTestId(
        "report-viewer-dispatch-rollup-proposal-rollup-proposal-related-feature-0-card",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/No renderer available/i),
    ).not.toBeInTheDocument();
  });

  it("routes EVIDENCE_PIPELINE reports to the typed evidence pipeline renderer composed against ReportPanel sections", () => {
    render(<ReportViewer report={evidenceReport} />);

    expect(
      screen.getByTestId("report-viewer-evidence-pipeline"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("report-viewer-evidence-pipeline-planner"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("report-viewer-evidence-pipeline-search-steps-list"),
    ).toHaveTextContent("auth token refresh");
  });

  it("routes FEATURE_SYNC_DECISION reports to the typed decision renderer with grouped reconciliation layout", () => {
    const featureSyncDecisionReport: ReportDto = {
      ...baseFixture,
      id: "dispatch-feature-sync-decision",
      reportType: ReportType.FeatureSyncDecision,
      title: "Feature Sync Decision Report",
      payload: {
        reportType: "FEATURE_SYNC_DECISION",
        summary: "Feature sync decision handoff summary.",
        discrepancies: [
          {
            sourceType: FeatureSyncReportSourceType.Task,
            source: {
              entityType: FeatureSyncReportSourceType.Task,
              entityId: "76d3266c-9484-4214-b828-3358e9412330",
              title: "Typed FEATURE_SYNC renderer",
            },
            description:
              "Task description conflicts with @[feature:8be2f12f-4313-427a-a279-70f94136f0c6|@ Mention Nodes].",
          },
          {
            sourceType: FeatureSyncReportSourceType.Task,
            source: {
              entityType: FeatureSyncReportSourceType.Task,
              entityId: "76d3266c-9484-4214-b828-3358e9412331",
              title: "Another task",
            },
            description: "Another discrepancy description.",
          },
        ],
        reconciliationOptions: [
          {
            description:
              "1. Reconcile with @[task:00000000-0000-4000-8000-000000000003|Unavailable report task].",
            discrepancyIndices: [0, 1],
          },
          {
            description: "2. A comprehensive fix that addresses both issues.",
            discrepancyIndices: [0, 1],
          },
        ],
      } satisfies FeatureSyncDecisionReportPayload,
    } as ReportDto;

    render(<ReportViewer report={featureSyncDecisionReport} />);

    const baseTestId = "report-viewer-dispatch-feature-sync-decision";

    expect(
      screen.getByTestId(`${baseTestId}-feature-sync-decision`),
    ).toBeInTheDocument();

    // Issues with the same reconciliation options share one group.
    const group = screen.getByTestId(
      `${baseTestId}-feature-sync-decision-group-card`,
    );
    const issues = within(group).getAllByTestId(
      `${baseTestId}-feature-sync-decision-group-issue`,
    );
    const options = within(group).getAllByTestId(
      `${baseTestId}-feature-sync-decision-group-option-card`,
    );

    expect(group).toHaveAttribute("data-group-index", "0");
    expect(
      within(group).getByTestId(
        `${baseTestId}-feature-sync-decision-group-issues-list`,
      ),
    ).toBeInTheDocument();
    expect(
      within(issues[0]).getByTestId(
        `${baseTestId}-feature-sync-decision-group-issue-source`,
      ),
    ).toHaveTextContent("Typed FEATURE_SYNC renderer");
    expect(
      within(issues[0]).getByTestId(
        `${baseTestId}-feature-sync-decision-group-issue-description`,
      ),
    ).toHaveTextContent("Task description conflicts with @ Mention Nodes.");
    expect(
      within(
        within(issues[0]).getByTestId(
          `${baseTestId}-feature-sync-decision-group-issue-description`,
        ),
      ).getByTestId("mention-badge"),
    ).toHaveTextContent("@ Mention Nodes");

    // The group's resolving options are rendered once.
    expect(options[0]).toHaveAttribute("data-option-number", "1");
    expect(
      within(options[0]).getByTestId(
        `${baseTestId}-feature-sync-decision-group-option-title`,
      ),
    ).toHaveTextContent("Reconcile with Unavailable report task.");
    expect(
      within(
        within(options[0]).getByTestId(
          `${baseTestId}-feature-sync-decision-group-option-title`,
        ),
      ).getByTestId("mention-badge"),
    ).toHaveTextContent("Unavailable report task");

    // The second issue appears in the same group.
    expect(
      within(issues[1]).getByTestId(
        `${baseTestId}-feature-sync-decision-group-issue-source`,
      ),
    ).toHaveTextContent("Another task");
    expect(
      within(issues[1]).getByTestId(
        `${baseTestId}-feature-sync-decision-group-issue-description`,
      ),
    ).toHaveTextContent("Another discrepancy description.");

    expect(options[1]).toHaveAttribute("data-option-number", "2");
    expect(
      within(options[1]).getByTestId(
        `${baseTestId}-feature-sync-decision-group-option-title`,
      ),
    ).toHaveTextContent("A comprehensive fix that addresses both issues.");
    expect(
      screen.getAllByText("A comprehensive fix that addresses both issues."),
    ).toHaveLength(1);
    expect(issues).toHaveLength(2);
    expect(options).toHaveLength(2);
  });

  it("selects the schema-versioned grouped renderer for V2 decision reports", () => {
    const payload: FeatureSyncDecisionReportPayloadV2 = {
      reportType: "FEATURE_SYNC_DECISION",
      summary: "Grouped Feature Sync decisions are ready for review.",
      decisionGroups: [
        {
          id: "group-one",
          affectedEntities: [
            {
              entityType: "task",
              entityId: "task-one",
              title: "Renderer task",
            },
          ],
          title: "Presentation decision",
          summary: "Choose the report presentation.",
          choices: [
            {
              id: "presentation-update",
              label: "Update presentation",
              description:
                "Apply the reviewed presentation change to @[task:task-one|Renderer task].",
              isNoChange: false,
            },
            {
              id: "presentation-no-change",
              label: "No change",
              description: "Leave the current presentation in place.",
              isNoChange: true,
            },
          ],
        },
      ],
    };
    const featureSyncDecisionReport: ReportDto = {
      ...baseFixture,
      id: "dispatch-feature-sync-decision-v2",
      reportType: ReportType.FeatureSyncDecision,
      schemaVersion: 2,
      title: "Feature Sync Decision Report",
      payload,
    } as ReportDto;

    render(<ReportViewer report={featureSyncDecisionReport} />);

    const baseTestId = "report-viewer-dispatch-feature-sync-decision-v2";
    expect(
      screen.getByTestId(`${baseTestId}-feature-sync-decision-summary`),
    ).toHaveTextContent("Grouped Feature Sync decisions are ready for review.");
    expect(
      screen.getByTestId(`${baseTestId}-feature-sync-decision-groups`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`${baseTestId}-feature-sync-decision-group-title`),
    ).toHaveTextContent("Presentation decision");
    const group = screen.getByTestId(
      `${baseTestId}-feature-sync-decision-group-card`,
    );
    expect(
      within(group).getByTestId(
        `${baseTestId}-feature-sync-decision-group-entities`,
      ),
    ).toHaveTextContent("Renderer task");
    const choices = within(group).getAllByTestId(
      `${baseTestId}-feature-sync-decision-choice`,
    );
    expect(choices).toHaveLength(2);
    expect(
      choices.map((choice) => choice.getAttribute("data-choice-index")),
    ).toEqual(["0", "1"]);
    expect(
      within(choices[0]!).getByTestId(
        `${baseTestId}-feature-sync-decision-choice-description`,
      ),
    ).toHaveTextContent("Apply the reviewed presentation change to");
    expect(
      within(
        within(choices[0]!).getByTestId(
          `${baseTestId}-feature-sync-decision-choice-description`,
        ),
      ).getByTestId("mention-badge"),
    ).toHaveTextContent("Renderer task");
    expect(
      within(choices[0]!).getByTestId(
        `${baseTestId}-feature-sync-decision-choice-label`,
      ),
    ).toHaveTextContent("Update presentation");
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(
      screen.queryByTestId(
        `${baseTestId}-feature-sync-decision-group-option-card`,
      ),
    ).not.toBeInTheDocument();
  });

  it("routes DECISION_NEEDED reports to the typed renderer with the question before every ordered option", () => {
    const decisionNeededReport: ReportDto = {
      ...baseFixture,
      id: "dispatch-decision-needed",
      reportType: ReportType.DecisionNeeded,
      title: "Decision Needed Report",
      payload: {
        reportType: "DECISION_NEEDED",
        summary:
          "A product decision is required before implementation continues.",
        question:
          "Which approach should @[feature:8be2f12f-4313-427a-a279-70f94136f0c6|Decision Requests] use?",
        options: [
          { description: "Preserve the current presentation." },
          { description: "Adopt the compact presentation." },
          { description: "Use a responsive hybrid presentation." },
        ],
      } satisfies DecisionNeededReportPayload,
    } as ReportDto;

    render(<ReportViewer report={decisionNeededReport} />);

    const baseTestId = "report-viewer-dispatch-decision-needed";
    const renderer = screen.getByTestId(`${baseTestId}-decision-needed`);
    const question = screen.getByTestId(
      `${baseTestId}-decision-needed-question`,
    );
    const options = screen.getByTestId(`${baseTestId}-decision-needed-options`);
    const optionDescriptions = screen.getAllByTestId(
      `${baseTestId}-decision-needed-option-description`,
    );

    expect(renderer).toBeInTheDocument();
    expect(question).toHaveTextContent(
      "Which approach should Decision Requests use?",
    );
    expect(
      question.compareDocumentPosition(options) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(optionDescriptions).toHaveLength(3);
    expect(optionDescriptions.map(({ textContent }) => textContent)).toEqual([
      "1. Preserve the current presentation.",
      "2. Adopt the compact presentation.",
      "3. Use a responsive hybrid presentation.",
    ]);
    expect(
      optionDescriptions.map((option) => option.dataset.optionNumber),
    ).toEqual(["1", "2", "3"]);
    expect(within(question).getByTestId("mention-badge")).toHaveTextContent(
      "Decision Requests",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/No renderer available/i),
    ).not.toBeInTheDocument();
  });
});
