import type { Meta, StoryObj } from "@storybook/react";
import {
  ReportAudience,
  ReportType,
  type FeatureTreeAnalysisReportPayload,
  type ReportDto,
} from "../../../api";
import { FeatureTreeAnalysisReport } from "./FeatureTreeAnalysisReport";

const buildReport = (payload: FeatureTreeAnalysisReportPayload): ReportDto =>
  ({
    id: "story-feature-tree-analysis",
    organizationId: "org-1",
    reportType: ReportType.FeatureTreeAnalysis,
    audience: ReportAudience.WorkflowOnly,
    title: "FEATURE_TREE_ANALYSIS report",
    payload,
    version: 1,
    schemaVersion: 1,
    sourceExecutionId: "exec-1",
    createdAt: "2026-05-15T00:00:00.000Z",
    expiresAt: "2026-06-15T00:00:00.000Z",
    entities: [],
  } as ReportDto);

const meta: Meta<typeof FeatureTreeAnalysisReport> = {
  title: "Components/Reports/FeatureTreeAnalysisReport",
  component: FeatureTreeAnalysisReport,
};

export default meta;

type Story = StoryObj<typeof FeatureTreeAnalysisReport>;

const fullPayload: FeatureTreeAnalysisReportPayload = {
  reportType: "FEATURE_TREE_ANALYSIS",
  summary:
    "The project's feature tree concentrates product surface around onboarding and daily session flows, with engineering substrate cleanly carved out under a Run and Turn Lifecycle container. Notable gap: there is no top-level concept covering plan execution telemetry, even though several leaves reference it.",
  title: "Feature tree coverage snapshot",
  text: "Walking the tree top-down: Onboarding, Plans, and Daily Session each carry a coherent set of frontend and backend sub-features. The Notification System sits as a standalone product concept rather than under any single flow — that placement is defensible because it touches every flow. The Reports area has accumulated typed-renderer leaves under a single parent, which keeps the dispatcher seam tidy. The one structural smell worth flagging is the absence of a Plan Telemetry feature: leaves in both the backend and frontend trees reference plan execution metrics, but there is no parent home for them, so the work fans out without a single product concept to anchor it.",
};

export const FullExample: Story = {
  args: {
    report: buildReport(fullPayload),
    payload: fullPayload,
    reportTestId: "story-feature-tree-analysis-full",
  },
};

const minimalPayload: FeatureTreeAnalysisReportPayload = {
  reportType: "FEATURE_TREE_ANALYSIS",
  summary:
    "Feature tree is healthy at the top level; no restructure needed this turn.",
  text: "No same-named siblings, no orphan engineering work jammed under a product concept, and the engineering container is named for the lifecycle it actually owns.",
};

export const MinimalNoTitle: Story = {
  args: {
    report: buildReport(minimalPayload),
    payload: minimalPayload,
    reportTestId: "story-feature-tree-analysis-minimal",
  },
};
