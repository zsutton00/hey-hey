import type { Meta, StoryObj } from "@storybook/react";
import {
  ReportAudience,
  ReportType,
  type FeatureSyncHandoffReportPayload,
  type ReportDto,
} from "../../../api";
import { FeatureSyncHandoffReport } from "./FeatureSyncHandoffReport";

const buildReport = (payload: FeatureSyncHandoffReportPayload): ReportDto =>
  ({
    id: "story-feature-sync-handoff",
    organizationId: "org-1",
    reportType: ReportType.FeatureSyncHandoff,
    audience: ReportAudience.WorkflowOnly,
    title: "FEATURE_SYNC_HANDOFF report",
    payload,
    version: 1,
    schemaVersion: 1,
    sourceExecutionId: "exec-1",
    createdAt: "2026-05-15T00:00:00.000Z",
    expiresAt: "2026-06-15T00:00:00.000Z",
    entities: [],
  } as ReportDto);

const meta: Meta<typeof FeatureSyncHandoffReport> = {
  title: "Components/Reports/FeatureSyncHandoffReport",
  component: FeatureSyncHandoffReport,
};

export default meta;

type Story = StoryObj<typeof FeatureSyncHandoffReport>;

const emptyPayload: FeatureSyncHandoffReportPayload = {
  reportType: "FEATURE_SYNC_HANDOFF",
  summary:
    "Walked the feature subtree and surfaced no internal context worth handing off to the next phase. The user-facing FEATURE_SYNC report carries everything the user needs to act on.",
  notes: [],
};

const singleNotePayload: FeatureSyncHandoffReportPayload = {
  reportType: "FEATURE_SYNC_HANDOFF",
  summary:
    "Captured one hidden requirement the active task description did not fully convey. The planner should treat the constraint as binding even though it is not yet in the task text.",
  notes: [
    {
      category: "hidden_requirements",
      text: "The renderer must preserve mention rendering inside note text — the analyze walk relies on inline @[task:...] links surviving into the handoff.",
    },
  ],
};

const multiNotePayload: FeatureSyncHandoffReportPayload = {
  reportType: "FEATURE_SYNC_HANDOFF",
  summary:
    "Recorded a hidden requirement, two architectural constraints, and one new dependency uncovered while walking the Reports subtree. The planner should fold all four into the next phase context.",
  notes: [
    {
      category: "hidden_requirements",
      text: "Test-id prefixes must stay aligned with the sibling FEATURE_SYNC renderer so dispatcher tests can assert against a stable tree.",
    },
    {
      category: "constraints",
      text: "Internal-audience reports must never surface in the conversation UI; the renderer is reachable only via the activity detail / ReportsList surfaces.",
    },
    {
      category: "constraints",
      text: "Note rendering must compose primitives (ReportPanel + ReportItemCard) rather than reach for ad-hoc Paper/Stack usage.",
    },
    {
      category: "dependencies_discovered",
      text: "The dispatcher cleanup task in the same stage owns the StandardReportContent fallback removal — out of scope here.",
    },
  ],
};

export const EmptyPayload: Story = {
  args: {
    report: buildReport(emptyPayload),
    payload: emptyPayload,
    reportTestId: "story-feature-sync-handoff-empty",
  },
};

export const SingleNote: Story = {
  args: {
    report: buildReport(singleNotePayload),
    payload: singleNotePayload,
    reportTestId: "story-feature-sync-handoff-single",
  },
};

export const MultiNote: Story = {
  args: {
    report: buildReport(multiNotePayload),
    payload: multiNotePayload,
    reportTestId: "story-feature-sync-handoff-multi",
  },
};
