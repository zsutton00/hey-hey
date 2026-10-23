import type { Meta, StoryObj } from "@storybook/react";
import {
  ReportAudience,
  ReportType,
  type ReportDto,
  type RiskAlertReportPayload,
} from "../../../api";
import { RiskAlertReport } from "./RiskAlertReport";

const buildReport = (payload: RiskAlertReportPayload): ReportDto =>
  ({
    id: "story-risk-alert",
    organizationId: "org-1",
    reportType: ReportType.RiskAlert,
    audience: ReportAudience.WorkflowOnly,
    title: "RISK_ALERT report",
    payload,
    version: 1,
    schemaVersion: 1,
    sourceExecutionId: "exec-1",
    createdAt: "2026-05-15T00:00:00.000Z",
    expiresAt: "2026-06-15T00:00:00.000Z",
    entities: [],
  } as ReportDto);

const meta: Meta<typeof RiskAlertReport> = {
  title: "Components/Reports/RiskAlertReport",
  component: RiskAlertReport,
};

export default meta;

type Story = StoryObj<typeof RiskAlertReport>;

const fullPayload: RiskAlertReportPayload = {
  reportType: "RISK_ALERT",
  summary:
    "Plan execution telemetry is referenced by several leaves on both the backend and frontend trees but has no parent feature, so the work fans out without a single product concept to anchor it.",
  title: "Missing parent for plan execution telemetry",
  text: "Three leaves under the Backend tree and two under the Frontend tree call out plan execution metrics in their descriptions, but there is no top-level Plan Telemetry feature. The risk: the next person to pick up telemetry work will not find a home for it and will either jam it under Plans (wrong scope) or create a new sibling, leaving the existing leaves orphaned. Recommend creating a Plan Telemetry product concept and re-parenting the affected leaves before more work lands.",
};

export const FullExample: Story = {
  args: {
    report: buildReport(fullPayload),
    payload: fullPayload,
    reportTestId: "story-risk-alert-full",
  },
};

const minimalPayload: RiskAlertReportPayload = {
  reportType: "RISK_ALERT",
  summary:
    "No structural risks worth flagging on this turn; the tree absorbed the new leaves cleanly.",
  text: "Every leaf added this turn slotted under an existing product concept without orphaning siblings or duplicating coverage.",
};

export const MinimalNoTitle: Story = {
  args: {
    report: buildReport(minimalPayload),
    payload: minimalPayload,
    reportTestId: "story-risk-alert-minimal",
  },
};
