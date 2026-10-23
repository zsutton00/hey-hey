import type { Meta, StoryObj } from "@storybook/react";
import {
  FeatureSyncReportSourceType,
  ReportAudience,
  ReportType,
  type FeatureSyncReportPayload,
  type ReportDto,
} from "../../../api";
import { FeatureSyncReport } from "./FeatureSyncReport";

const buildReport = (payload: FeatureSyncReportPayload): ReportDto =>
  ({
    id: "story-feature-sync",
    organizationId: "org-1",
    reportType: ReportType.FeatureSync,
    audience: ReportAudience.WorkflowOnly,
    title: "FEATURE_SYNC report",
    payload,
    version: 1,
    schemaVersion: 1,
    sourceExecutionId: "exec-1",
    createdAt: "2026-05-15T00:00:00.000Z",
    expiresAt: "2026-06-15T00:00:00.000Z",
    entities: [],
  } as ReportDto);

const meta: Meta<typeof FeatureSyncReport> = {
  title: "Components/Reports/FeatureSyncReport",
  component: FeatureSyncReport,
};

export default meta;

type Story = StoryObj<typeof FeatureSyncReport>;

const emptyPayload: FeatureSyncReportPayload = {
  reportType: "FEATURE_SYNC",
  summary:
    "Analyzed the feature subtree and found nothing to reconcile. No discrepancies or reconciliation options were surfaced.",
  discrepancies: [],
  reconciliationOptions: [],
};

const singleRowPayload: FeatureSyncReportPayload = {
  reportType: "FEATURE_SYNC",
  summary:
    "Flagged one stale task description that no longer matches the parent feature's contract. Offered the user a single reconciliation option to edit the task in place.",
  discrepancies: [
    {
      sourceType: FeatureSyncReportSourceType.Task,
      source: {
        entityType: FeatureSyncReportSourceType.Task,
        entityId: "76d3266c-9484-4214-b828-3358e9412330",
        title: "Typed FEATURE_SYNC renderer",
      },
      description:
        "Task description still calls the dispatcher getReportRenderer; the parent feature names it renderReportBody.",
    },
  ],
  reconciliationOptions: [
    {
      description:
        "Edit the task description to reference renderReportBody so the dispatcher identifier matches the parent feature.",
      discrepancyIndices: [0],
    },
  ],
};

const multiRowPayload: FeatureSyncReportPayload = {
  reportType: "FEATURE_SYNC",
  summary:
    "Flagged three rows across the Reports feature subtree where task and feature descriptions drifted from the typed-renderer contract. Offered the user two reconciliation options, one of which resolves multiple rows at once.",
  discrepancies: [
    {
      sourceType: FeatureSyncReportSourceType.Task,
      source: {
        entityType: FeatureSyncReportSourceType.Task,
        entityId: "task-1",
        title: "Typed FEATURE_SYNC renderer",
      },
      description:
        "Task description still references the StandardReportContent fallback path.",
    },
    {
      sourceType: FeatureSyncReportSourceType.Task,
      source: {
        entityType: FeatureSyncReportSourceType.Task,
        entityId: "task-2",
        title: "Wire FEATURE_SYNC into renderReportBody",
      },
      description:
        "Task description omits the dispatcher narrowing step; only the case label is mentioned.",
    },
    {
      sourceType: FeatureSyncReportSourceType.Feature,
      source: {
        entityType: FeatureSyncReportSourceType.Feature,
        entityId: "feature-1",
        title: "Reports",
      },
      description:
        "Feature description does not yet enumerate FEATURE_SYNC alongside PLAN and IMPLEMENT in the typed renderer list.",
    },
  ],
  reconciliationOptions: [
    {
      description:
        "Update both task descriptions to mention the dispatcher narrowing step and drop the StandardReportContent reference.",
      discrepancyIndices: [0, 1],
    },
    {
      description:
        "Edit the parent feature description so the typed renderer list includes FEATURE_SYNC.",
      discrepancyIndices: [2],
    },
  ],
};

export const EmptyPayload: Story = {
  args: {
    report: buildReport(emptyPayload),
    payload: emptyPayload,
    reportTestId: "story-feature-sync-empty",
  },
};

export const SingleRow: Story = {
  args: {
    report: buildReport(singleRowPayload),
    payload: singleRowPayload,
    reportTestId: "story-feature-sync-single",
  },
};

export const MultiRow: Story = {
  args: {
    report: buildReport(multiRowPayload),
    payload: multiRowPayload,
    reportTestId: "story-feature-sync-multi",
  },
};
