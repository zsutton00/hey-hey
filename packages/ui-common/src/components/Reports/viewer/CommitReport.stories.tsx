import type { Meta, StoryObj } from "@storybook/react";
import {
  ReportAudience,
  ReportType,
  type CommitReportPayload,
  type ReportDto,
} from "../../../api";
import { CommitReport } from "./CommitReport";

const buildReport = (payload: CommitReportPayload): ReportDto =>
  ({
    id: "story-commit",
    organizationId: "org-1",
    reportType: ReportType.Commit,
    audience: ReportAudience.WorkflowOnly,
    title: "COMMIT report",
    payload,
    version: 1,
    schemaVersion: 1,
    sourceExecutionId: "exec-1",
    createdAt: "2026-05-17T00:00:00.000Z",
    expiresAt: "2026-06-17T00:00:00.000Z",
    entities: [],
  } as ReportDto);

const meta: Meta<typeof CommitReport> = {
  title: "Components/Reports/CommitReport",
  component: CommitReport,
};

export default meta;

type Story = StoryObj<typeof CommitReport>;

const emptyFilesPayload: CommitReportPayload = {
  reportType: "COMMIT",
  summary:
    "Drafted the COMMIT renderer skeleton. The dispatcher will route COMMIT reports to a typed renderer composed against the shared report primitives once the typed surface lands.",
  files: [],
  hashes: [],
};

const populatedPayload: CommitReportPayload = {
  reportType: "COMMIT",
  summary:
    "Added the typed COMMIT renderer and wired it into the ReportViewer dispatcher. The renderer surfaces summary, the list of files in the commit, and the per-service commit hashes — composed only from shared report primitives.",
  files: [
    "src/components/Reports/viewer/CommitReport.tsx",
    "src/components/Reports/viewer/index.ts",
    "src/components/Reports/ReportViewer.tsx",
    "src/components/Reports/__tests__/ReportViewer.dispatch.test.tsx",
  ],
  hashes: [{ service: "ui-common", hash: "a1b2c3d", branch: "feature/foo" }],
};

export const EmptyFiles: Story = {
  args: {
    report: buildReport(emptyFilesPayload),
    payload: emptyFilesPayload,
    reportTestId: "story-commit-empty-files",
  },
};

export const PopulatedFilesAndHashes: Story = {
  args: {
    report: buildReport(populatedPayload),
    payload: populatedPayload,
    reportTestId: "story-commit-populated",
  },
};

// Reports emitted before per-hash branch was recorded have no `branch`.
const legacyPayload = {
  ...populatedPayload,
  hashes: [{ service: "ui-common", hash: "a1b2c3d" }],
} as unknown as CommitReportPayload;

export const LegacyHashWithoutBranch: Story = {
  args: {
    report: buildReport(legacyPayload),
    payload: legacyPayload,
    reportTestId: "story-commit-legacy",
  },
};
