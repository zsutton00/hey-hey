import {
  fireEvent,
  render as renderWithTestingLibrary,
  screen,
  within,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  ReportAudience,
  ReportType,
  ReportUsageBreakdownEntryRoleEnum,
  ReportUsageCacheAvailability,
  ReportUsageCoverage,
  type ReportDto,
  type ReportUsageMeasurement,
} from "../../../api";
import { ReportViewer } from "../ReportViewer";

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

const render = (ui: ReactElement) =>
  renderWithTestingLibrary(ui, { wrapper: MemoryRouter });

const completeUsage: ReportUsageMeasurement = {
  schemaVersion: 1,
  runId: "run-1",
  agentSessionId: "run-1",
  providerSessionId: "native-parent",
  effort: null,
  capturedAt: "2026-05-15T00:00:00.000Z",
  executionId: "exec-1",
  turnId: "turn-1",
  provider: "anthropic",
  model: null,
  inputTokens: 12_400,

  freshInputTokens: 3_300,
  cacheReadInputTokens: 8_000,
  cacheCreationInputTokens: 1_100,
  cacheAvailability: ReportUsageCacheAvailability.Reported,
  outputTokens: 1_200,
  toolCalls: 14,
  coverage: ReportUsageCoverage.Complete,
  breakdown: [
    {
      role: ReportUsageBreakdownEntryRoleEnum.Parent,
      label: "Implementer",
      executionId: "exec-1",
      providerSessionId: "native-parent",
      provider: "claude",
      model: null,
      effort: null,
      inputTokens: 9_000,

      freshInputTokens: 2_000,
      cacheReadInputTokens: 6_500,
      cacheCreationInputTokens: 500,
      cacheAvailability: ReportUsageCacheAvailability.Reported,
      outputTokens: 900,
      toolCalls: 10,
      coverage: ReportUsageCoverage.Complete,
    },
    {
      role: ReportUsageBreakdownEntryRoleEnum.Subagent,
      label: "Explore",
      executionId: "child-1",
      providerSessionId: "native-child",
      provider: "claude",
      model: null,
      effort: null,
      inputTokens: 3_400,

      freshInputTokens: 1_300,
      cacheReadInputTokens: 1_500,
      cacheCreationInputTokens: 600,
      cacheAvailability: ReportUsageCacheAvailability.Reported,
      outputTokens: 300,
      toolCalls: 4,
      coverage: ReportUsageCoverage.Complete,
    },
  ],
};

const payloads = {
  [ReportType.CodingResearch]: {
    reportType: "CODING_RESEARCH",
    summary: "Research summary.",
    analysis: "Analysis.",
    frame: { focalId: "2533ce2a-653e-46c1-a3eb-bc2039d85c97", nodes: [] },
    provenance: { discoveryCalls: [], edgesTraversed: [] },
    updates: [],
  },
  [ReportType.Implement]: {
    reportType: "IMPLEMENT",
    summary: "Implement summary.",
    filesChanged: [],
  },
  [ReportType.ChangeWalkthrough]: {
    reportType: "CHANGE_WALKTHROUGH",
    summary: "Walkthrough summary.",
    targetRunId: "run-1",
    groups: [],
  },
  [ReportType.Review]: {
    reportType: "REVIEW",
    summary: "Review summary.",
    disposition: "CLEAN",
  },
  [ReportType.Snapshot]: {
    reportType: "SNAPSHOT",
    summary: "Snapshot summary.",
  },
} as const;

const buildReport = (
  reportType: keyof typeof payloads,
  usage: ReportUsageMeasurement | null,
): ReportDto =>
  ({
    id: `usage-${reportType}`,
    organizationId: "org-1",
    audience: ReportAudience.WorkflowOnly,
    reportType,
    title: `${reportType} report`,
    payload: payloads[reportType],
    version: 1,
    schemaVersion: 1,
    sourceExecutionId: "exec-1",
    createdAt: "2026-05-15T00:00:00.000Z",
    expiresAt: "2026-06-15T00:00:00.000Z",
    entities: [],
    usage,
  }) as ReportDto;

const eligibleTypes = [
  ReportType.CodingResearch,
  ReportType.Implement,
  ReportType.ChangeWalkthrough,
  ReportType.Review,
] as const;

describe("report usage bar", () => {
  it.each(eligibleTypes)(
    "shows usage and its per-agent breakdown on %s reports",
    (reportType) => {
      render(<ReportViewer report={buildReport(reportType, completeUsage)} />);

      const bar = screen.getByTestId("report-usage-bar");
      expect(bar).toHaveAttribute(
        "data-coverage",
        ReportUsageCoverage.Complete,
      );
      expect(bar).not.toHaveTextContent("Partial");
      expect(bar).not.toHaveTextContent("unavailable");

      const toggle = screen.getByTestId("report-usage-breakdown-toggle");
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(
        screen.queryByTestId("report-usage-breakdown"),
      ).not.toBeInTheDocument();

      fireEvent.click(toggle);

      expect(toggle).toHaveAttribute("aria-expanded", "true");
      const breakdown = screen.getByTestId("report-usage-breakdown");
      expect(toggle).toHaveAttribute("aria-controls", breakdown.id);

      const rows = within(breakdown).getAllByRole("row").slice(1);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveAttribute(
        "data-role",
        ReportUsageBreakdownEntryRoleEnum.Parent,
      );
      expect(rows[0]).not.toHaveTextContent("unavailable");
      expect(rows[1]).toHaveAttribute(
        "data-role",
        ReportUsageBreakdownEntryRoleEnum.Subagent,
      );
      expect(rows[1]).not.toHaveTextContent("unavailable");
    },
  );

  it("labels partial coverage in text", () => {
    render(
      <ReportViewer
        report={buildReport(ReportType.Implement, {
          ...completeUsage,
          coverage: ReportUsageCoverage.Partial,
        })}
      />,
    );

    expect(screen.getByTestId("report-usage-bar")).toHaveTextContent("Partial");
  });

  it("states usage is unavailable when the report has none", () => {
    render(<ReportViewer report={buildReport(ReportType.Review, null)} />);

    expect(screen.getByTestId("report-usage-bar")).toHaveTextContent(
      "unavailable",
    );
  });

  it("marks unreported cache and missing figures unavailable, not zero", () => {
    render(
      <ReportViewer
        report={buildReport(ReportType.CodingResearch, {
          ...completeUsage,
          inputTokens: null,

          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          cacheAvailability: ReportUsageCacheAvailability.Unreported,
          outputTokens: null,
          breakdown: [],
        })}
      />,
    );

    const bar = screen.getByTestId("report-usage-bar");
    expect(bar).toHaveTextContent(/cached unavailable/);
    expect(bar).toHaveTextContent(/Out unavailable/);
    expect(bar).not.toHaveTextContent(/\b0\b/);
  });

  it("shows measured zero as 0", () => {
    render(
      <ReportViewer
        report={buildReport(ReportType.ChangeWalkthrough, {
          ...completeUsage,
          inputTokens: 0,
          freshInputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          outputTokens: 0,
          toolCalls: 0,
          breakdown: [],
        })}
      />,
    );

    const bar = screen.getByTestId("report-usage-bar");
    expect(bar).toHaveTextContent(/In 0\b/);
    expect(bar).toHaveTextContent(/Out 0\b/);
    expect(bar).not.toHaveTextContent("unavailable");
  });

  it("is not shown on reports without usage accounting", () => {
    render(
      <ReportViewer report={buildReport(ReportType.Snapshot, completeUsage)} />,
    );

    expect(screen.queryByTestId("report-usage-bar")).not.toBeInTheDocument();
  });
});
