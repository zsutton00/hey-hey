import { describe, expect, it } from "vitest";
import {
  ReportAudience,
  ReportType,
  type FeatureSyncDecisionReportPayloadV1,
  type EvidencePipelineReportPayload,
  type ReportDto,
  type SnapshotReportPayload,
  type ValidationWalkthroughReportPayload,
} from "../../../api";
import {
  narrowReportPayload,
  narrowFeatureSyncDecisionReport,
  type NarrowedReportPayload,
} from "../viewer/rendererContract";

const buildReport = (reportType: ReportType): ReportDto =>
  ({
    id: `report-${reportType}`,
    organizationId: "org-1",
    audience: ReportAudience.WorkflowOnly,
    reportType,
    title: `${reportType} report`,
    payload:
      reportType === ReportType.FeatureSyncDecision
        ? ({
            reportType: "FEATURE_SYNC_DECISION",
            summary: "Feature Sync decision summary.",
            discrepancies: [],
            reconciliationOptions: [],
          } satisfies FeatureSyncDecisionReportPayloadV1)
        : ({ reportType } as ReportDto["payload"]),
    version: 1,
    schemaVersion: 1,
    sourceExecutionId: "exec-1",
    createdAt: "2026-05-15T00:00:00.000Z",
    expiresAt: "2026-06-15T00:00:00.000Z",
    entities: [],
  } as ReportDto);

describe("narrowReportPayload", () => {
  it("returns the typed payload for every ReportType enum value", () => {
    for (const reportType of Object.values(ReportType)) {
      const report = buildReport(reportType);
      const payload = narrowReportPayload(report);

      expect(payload).toBe(report.payload);
    }
  });

  it("exposes a NarrowedReportPayload type that resolves to the concrete payload interface", () => {
    type SnapshotNarrowed = NarrowedReportPayload<typeof ReportType.Snapshot>;
    type EvidenceNarrowed = NarrowedReportPayload<
      typeof ReportType.EvidencePipeline
    >;
    type ValidationNarrowed = NarrowedReportPayload<
      typeof ReportType.ValidationWalkthrough
    >;

    const snapshot: SnapshotNarrowed = {
      reportType: "SNAPSHOT",
      summary: "summary",
    };
    const evidence: EvidenceNarrowed = {
      reportType: "EVIDENCE_PIPELINE",
      summary: "summary",
    } as EvidencePipelineReportPayload;
    const validation: ValidationNarrowed = {
      reportType: "VALIDATION_WALKTHROUGH",
      summary: "summary",
      validationSteps: [],
    } as ValidationWalkthroughReportPayload;

    const _snapshotShape: SnapshotReportPayload = snapshot;
    const _evidenceShape: EvidencePipelineReportPayload = evidence;
    const _validationShape: ValidationWalkthroughReportPayload = validation;

    expect(_snapshotShape.reportType).toBe("SNAPSHOT");
    expect(_evidenceShape.reportType).toBe("EVIDENCE_PIPELINE");
    expect(_validationShape.reportType).toBe("VALIDATION_WALKTHROUGH");
  });

  it("rejects a V2 envelope with a V1 payload instead of falling back to V1", () => {
    const malformedReport = {
      ...buildReport(ReportType.FeatureSyncDecision),
      schemaVersion: 2,
    } as ReportDto;

    expect(() => narrowFeatureSyncDecisionReport(malformedReport)).toThrow(
      "Invalid or unsupported FEATURE_SYNC_DECISION schema version: 2"
    );
  });

  it("rejects unsupported Feature Sync schema versions", () => {
    const unsupportedReport = {
      ...buildReport(ReportType.FeatureSyncDecision),
      schemaVersion: 3,
    } as ReportDto;

    expect(() => narrowFeatureSyncDecisionReport(unsupportedReport)).toThrow(
      "Invalid or unsupported FEATURE_SYNC_DECISION schema version: 3"
    );
  });
});
