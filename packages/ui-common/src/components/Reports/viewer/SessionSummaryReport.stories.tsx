import type { Meta, StoryObj } from "@storybook/react";
import {
  ReportAudience,
  ReportType,
  type ReportDto,
  type SessionSummaryReportPayload,
} from "../../../api";
import { SessionSummaryReport } from "./SessionSummaryReport";

const buildReport = (payload: SessionSummaryReportPayload): ReportDto =>
  ({
    id: "story-session-summary",
    organizationId: "org-1",
    reportType: ReportType.SessionSummary,
    audience: ReportAudience.WorkflowOnly,
    title: "SESSION_SUMMARY report",
    payload,
    version: 1,
    schemaVersion: 1,
    sourceExecutionId: "exec-1",
    createdAt: "2026-05-15T00:00:00.000Z",
    expiresAt: "2026-06-15T00:00:00.000Z",
    entities: [],
  } as ReportDto);

const meta: Meta<typeof SessionSummaryReport> = {
  title: "Components/Reports/SessionSummaryReport",
  component: SessionSummaryReport,
};

export default meta;

type Story = StoryObj<typeof SessionSummaryReport>;

const defaultPayload: SessionSummaryReportPayload = {
  reportType: "SESSION_SUMMARY",
  text: "Wrapped up the planning session and aligned on the typed renderer rollout. The summary captures the agreed path and the open follow-ups.",
  summary:
    "Decisions: ship the typed SESSION_SUMMARY renderer first, then revisit dispatcher exhaustiveness. Follow-ups: storybook coverage and feature-sync handoff doc.",
};

export const Default: Story = {
  args: {
    report: buildReport(defaultPayload),
    payload: defaultPayload,
    reportTestId: "story-session-summary-default",
  },
};
