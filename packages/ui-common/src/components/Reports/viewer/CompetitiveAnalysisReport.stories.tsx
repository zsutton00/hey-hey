import type { Meta, StoryObj } from "@storybook/react";
import {
  ReportAudience,
  ReportType,
  type CompetitiveAnalysisReportPayload,
  type ReportDto,
} from "../../../api";
import { CompetitiveAnalysisReport } from "./CompetitiveAnalysisReport";

const buildReport = (payload: CompetitiveAnalysisReportPayload): ReportDto =>
  ({
    id: "story-competitive-analysis",
    organizationId: "org-1",
    reportType: ReportType.CompetitiveAnalysis,
    audience: ReportAudience.WorkflowOnly,
    title: "COMPETITIVE_ANALYSIS report",
    payload,
    version: 1,
    schemaVersion: 1,
    sourceExecutionId: "exec-1",
    createdAt: "2026-05-15T00:00:00.000Z",
    expiresAt: "2026-06-15T00:00:00.000Z",
    entities: [],
  } as ReportDto);

const meta: Meta<typeof CompetitiveAnalysisReport> = {
  title: "Components/Reports/CompetitiveAnalysisReport",
  component: CompetitiveAnalysisReport,
};

export default meta;

type Story = StoryObj<typeof CompetitiveAnalysisReport>;

const fullPayload: CompetitiveAnalysisReportPayload = {
  reportType: "COMPETITIVE_ANALYSIS",
  summary:
    "Compared against Linear, Notion, and Asana, the project's strongest differentiation is agent-driven feature-tree reasoning paired with first-class proposals. The weakest area is mobile parity, which all three competitors ship as a baseline.",
  title: "Coverage vs. Linear, Notion, and Asana",
  text: "Linear leads on keyboard-driven navigation and inline edit ergonomics. Notion leads on free-form documentation but lacks structured entities. Asana leads on multi-team rollups but has no AI authoring surface. Our project sits closest to Linear on entity rigor while uniquely owning the agent-authoring surface — no competitor exposes a proposal-based mutation flow to end users.",
  competitors: ["Linear", "Notion", "Asana"],
};

export const FullExample: Story = {
  args: {
    report: buildReport(fullPayload),
    payload: fullPayload,
    reportTestId: "story-competitive-analysis-full",
  },
};

const minimalPayload: CompetitiveAnalysisReportPayload = {
  reportType: "COMPETITIVE_ANALYSIS",
  summary:
    "No competitor in the surveyed set ships an agent-authoring surface comparable to ours.",
  text: "Across the surveyed alternatives, none expose a proposal-based mutation flow to end users; the rest of the surface is at parity or behind.",
};

export const MinimalNoCompetitorList: Story = {
  args: {
    report: buildReport(minimalPayload),
    payload: minimalPayload,
    reportTestId: "story-competitive-analysis-minimal",
  },
};
