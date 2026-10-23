import type { Meta, StoryObj } from "@storybook/react";
import {
  ReportAudience,
  ReportType,
  type ImplementReportPayload,
  type ReportDto,
} from "../../../api";
import { ImplementReport } from "./ImplementReport";

const buildReport = (payload: ImplementReportPayload): ReportDto =>
  ({
    id: "story-implement",
    organizationId: "org-1",
    reportType: ReportType.Implement,
    audience: ReportAudience.WorkflowOnly,
    title: "IMPLEMENT report",
    payload,
    version: 1,
    schemaVersion: 1,
    sourceExecutionId: "exec-1",
    createdAt: "2026-05-15T00:00:00.000Z",
    expiresAt: "2026-06-15T00:00:00.000Z",
    entities: [],
  } as ReportDto);

const meta: Meta<typeof ImplementReport> = {
  title: "Components/Reports/ImplementReport",
  component: ImplementReport,
};

export default meta;

type Story = StoryObj<typeof ImplementReport>;

const summaryOnlyPayload: ImplementReportPayload = {
  reportType: "IMPLEMENT",
  summary:
    "Wired the IMPLEMENT renderer end-to-end. The dispatcher now routes IMPLEMENT reports to a typed renderer composed against the shared report primitives.",
  filesChanged: [],
};

const typicalPayload: ImplementReportPayload = {
  reportType: "IMPLEMENT",
  summary:
    "Added the IMPLEMENT typed renderer and wired it into ReportViewer.tsx. Tightened the dispatcher test to cover the new case alongside SNAPSHOT and VALIDATION_WALKTHROUGH.",
  filesChanged: [
    "src/components/Reports/viewer/ImplementReport.tsx",
    "src/components/Reports/viewer/index.ts",
    "src/components/Reports/ReportViewer.tsx",
    "src/components/Reports/__tests__/ReportViewer.dispatch.test.tsx",
  ],
  decisions: [
    {
      topic: "Where to wire IMPLEMENT in the dispatcher",
      choice:
        "Added the case to the existing renderReportBody switch in ReportViewer.tsx.",
      reasoning:
        "The sibling dispatcher step owns the rename/exhaustiveness sweep; this task only needs the IMPLEMENT case to land alongside the existing typed renderers.",
    },
    {
      topic: "filesChanged rendering",
      choice:
        "Vertical bulleted list inside a ReportPanel with a typed empty state.",
      reasoning:
        "Matches the labeled-text + panel visual hierarchy used by the other typed renderers and keeps the path strings monospaced.",
    },
  ],
};

const fullPayload: ImplementReportPayload = {
  reportType: "IMPLEMENT",
  summary:
    "Implemented the IMPLEMENT renderer with the full payload surface — summary, files-changed list, and a stack of decision cards covering topic, choice, and optional reasoning. Confirmed type-check and the dispatcher test suite are clean.",
  filesChanged: [
    "src/components/Reports/viewer/ImplementReport.tsx",
    "src/components/Reports/viewer/ImplementReport.stories.tsx",
    "src/components/Reports/viewer/index.ts",
    "src/components/Reports/ReportViewer.tsx",
    "src/components/Reports/__tests__/ReportViewer.dispatch.test.tsx",
    "src/components/Reports/viewer/reportPrimitives.tsx",
  ],
  decisions: [
    {
      topic: "Renderer contract",
      choice:
        "Implemented as ReportRenderer<ImplementReportPayload> with no JSON parsing inside the component.",
      reasoning:
        "Acceptance criterion requires reading the payload through the generated interface; the typed contract enforces this at compile time.",
    },
    {
      topic: "Decision card shape",
      choice:
        "ReportItemCard with topic as the subtitle, choice as a labeled body, and reasoning as a secondary labeled body.",
    },
    {
      topic: "Empty state for filesChanged",
      choice:
        "ReportPanel.isEmpty renders the empty message when the array has zero entries.",
      reasoning:
        "Keeps the typed component honest about the API contract — filesChanged is required, but can legitimately be empty.",
    },
  ],
};

export const SummaryOnly: Story = {
  args: {
    report: buildReport(summaryOnlyPayload),
    payload: summaryOnlyPayload,
    reportTestId: "story-implement-summary-only",
  },
};

export const TypicalPayload: Story = {
  args: {
    report: buildReport(typicalPayload),
    payload: typicalPayload,
    reportTestId: "story-implement-typical",
  },
};

export const FullPayload: Story = {
  args: {
    report: buildReport(fullPayload),
    payload: fullPayload,
    reportTestId: "story-implement-full",
  },
};
