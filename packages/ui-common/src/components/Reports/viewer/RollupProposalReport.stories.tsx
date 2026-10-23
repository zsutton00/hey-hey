import type { Meta, StoryObj } from "@storybook/react";
import {
  ReportAudience,
  ReportType,
  type ReportDto,
  type RollupProposalReportPayload,
} from "../../../api";
import { RollupProposalReport } from "./RollupProposalReport";

const buildReport = (payload: RollupProposalReportPayload): ReportDto =>
  ({
    id: "story-rollup-proposal",
    organizationId: "org-1",
    reportType: ReportType.RollupProposal,
    audience: ReportAudience.WorkflowOnly,
    title: "ROLLUP_PROPOSAL report",
    payload,
    version: 1,
    schemaVersion: 1,
    sourceExecutionId: "exec-1",
    createdAt: "2026-05-15T00:00:00.000Z",
    expiresAt: "2026-06-15T00:00:00.000Z",
    entities: [],
  } as ReportDto);

const meta: Meta<typeof RollupProposalReport> = {
  title: "Components/Reports/RollupProposalReport",
  component: RollupProposalReport,
};

export default meta;

type Story = StoryObj<typeof RollupProposalReport>;

const emptyArraysPayload: RollupProposalReportPayload = {
  reportType: "ROLLUP_PROPOSAL",
  summary:
    "Closed out the feature task with no rollup needed. No parent or related feature proposals were created this turn.",
  taskId: "0298c7c3-04fc-48d1-9718-8af34e90ce01",
  triggeredBy: "agent:rollup-shaper",
  triggeredAt: "2026-05-18T14:00:00.000Z",
  parentFeatures: [],
  relatedFeatures: [],
};

const populatedPayload: RollupProposalReportPayload = {
  reportType: "ROLLUP_PROPOSAL",
  summary:
    "Rolled the typed renderer task up into the parent Reports feature and a sibling design doc. Two parent-feature proposals and one related-feature proposal were queued for review.",
  taskId: "0298c7c3-04fc-48d1-9718-8af34e90ce01",
  triggeredBy: "user:suppai@gmail.com",
  triggeredAt: "2026-05-18T14:05:00.000Z",
  parentFeatures: [
    "461f6ba7-010f-4853-90d0-ea5d878b0a0c",
    "bb027bea-2c75-4a1f-9a3b-2e5c1a0b9d72",
  ],
  relatedFeatures: ["c40abdb3-fa1c-4f55-9d10-9d8a7e9f55ee"],
};

export const EmptyArrays: Story = {
  args: {
    report: buildReport(emptyArraysPayload),
    payload: emptyArraysPayload,
    reportTestId: "story-rollup-proposal-empty",
  },
};

export const Populated: Story = {
  args: {
    report: buildReport(populatedPayload),
    payload: populatedPayload,
    reportTestId: "story-rollup-proposal-populated",
  },
};
