import type React from "react";
import {
  ProjectReportCoverageStatusEnum,
  ReportType,
  type ProjectReportPayload,
  type FeatureSyncDecisionReportPayloadV1,
  type FeatureSyncDecisionReportPayloadV2,
  type ReportDto,
  type ReportDtoFeatureSyncDecisionV1,
  type ReportDtoFeatureSyncDecisionV2,
} from "../../../api";

export interface ReportRendererProps<TPayload> {
  report: ReportDto;
  payload: TPayload;
  reportTestId: string;
}

export type ReportRenderer<TPayload> = React.ComponentType<
  ReportRendererProps<TPayload>
>;

export type NarrowedReportPayload<TReportType extends ReportType> = Extract<
  ReportDto["payload"],
  { reportType: TReportType }
>;

export type FeatureSyncDecisionReportDto =
  ReportDtoFeatureSyncDecisionV1 | ReportDtoFeatureSyncDecisionV2;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFeatureSyncSourceRef = (value: unknown): boolean => {
  if (!isRecord(value)) return false;

  return (
    typeof value.entityType === "string" &&
    typeof value.entityId === "string" &&
    typeof value.title === "string"
  );
};

const isFeatureSyncV1Payload = (
  value: unknown,
): value is FeatureSyncDecisionReportPayloadV1 => {
  if (!isRecord(value)) return false;

  const discrepancies = value.discrepancies;
  const reconciliationOptions = value.reconciliationOptions;

  return (
    value.reportType === ReportType.FeatureSyncDecision &&
    typeof value.summary === "string" &&
    Array.isArray(discrepancies) &&
    discrepancies.every((discrepancy) => {
      if (!isRecord(discrepancy) || !isRecord(discrepancy.source)) {
        return false;
      }

      return (
        typeof discrepancy.sourceType === "string" &&
        isFeatureSyncSourceRef(discrepancy.source) &&
        typeof discrepancy.description === "string"
      );
    }) &&
    Array.isArray(reconciliationOptions) &&
    reconciliationOptions.every((option) => {
      if (!isRecord(option)) return false;

      return (
        typeof option.description === "string" &&
        Array.isArray(option.discrepancyIndices) &&
        option.discrepancyIndices.every(
          (index) => typeof index === "number" && Number.isInteger(index),
        )
      );
    })
  );
};

const isFeatureSyncV2Payload = (
  value: unknown,
): value is FeatureSyncDecisionReportPayloadV2 => {
  if (!isRecord(value) || !Array.isArray(value.decisionGroups)) {
    return false;
  }

  const groupIds = new Set<string>();

  return (
    value.reportType === ReportType.FeatureSyncDecision &&
    typeof value.summary === "string" &&
    value.decisionGroups.every((group) => {
      if (
        !isRecord(group) ||
        typeof group.id !== "string" ||
        groupIds.has(group.id) ||
        !Array.isArray(group.affectedEntities) ||
        group.affectedEntities.length === 0 ||
        !group.affectedEntities.every(isFeatureSyncSourceRef) ||
        typeof group.title !== "string" ||
        typeof group.summary !== "string" ||
        !Array.isArray(group.choices) ||
        group.choices.length < 2
      ) {
        return false;
      }

      groupIds.add(group.id);
      const choiceIds = new Set<string>();
      let noChangeChoiceCount = 0;

      return (
        group.choices.every((choice) => {
          if (
            !isRecord(choice) ||
            typeof choice.id !== "string" ||
            choiceIds.has(choice.id) ||
            typeof choice.label !== "string" ||
            typeof choice.isNoChange !== "boolean" ||
            ("description" in choice &&
              choice.description !== undefined &&
              typeof choice.description !== "string")
          ) {
            return false;
          }

          choiceIds.add(choice.id);
          if (choice.isNoChange) noChangeChoiceCount += 1;
          return true;
        }) && noChangeChoiceCount === 1
      );
    })
  );
};

export const narrowFeatureSyncDecisionReport = (
  report: ReportDto,
): FeatureSyncDecisionReportDto => {
  if (report.reportType !== ReportType.FeatureSyncDecision) {
    throw new Error(
      `Expected a FEATURE_SYNC_DECISION report, received ${report.reportType}`,
    );
  }

  if (report.schemaVersion === 1 && isFeatureSyncV1Payload(report.payload)) {
    return report as ReportDtoFeatureSyncDecisionV1;
  }

  if (report.schemaVersion === 2 && isFeatureSyncV2Payload(report.payload)) {
    return report as ReportDtoFeatureSyncDecisionV2;
  }

  throw new Error(
    `Invalid or unsupported FEATURE_SYNC_DECISION schema version: ${String(
      report.schemaVersion,
    )}`,
  );
};

const isProjectReportSubject = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.entityType === "string" &&
  typeof value.entityId === "string";

const isProjectReportPayload = (
  value: unknown,
): value is ProjectReportPayload => {
  if (!isRecord(value) || value.reportType !== ReportType.ProjectReport) {
    return false;
  }
  const { scope, provenance, coverage } = value;
  return (
    typeof value.title === "string" &&
    typeof value.summary === "string" &&
    typeof value.question === "string" &&
    isRecord(scope) &&
    typeof scope.windowStart === "string" &&
    typeof scope.windowEnd === "string" &&
    typeof scope.timeZone === "string" &&
    Array.isArray(value.exclusions) &&
    value.exclusions.every(isProjectReportSubject) &&
    isRecord(provenance) &&
    typeof provenance.requestId === "string" &&
    typeof provenance.attemptId === "string" &&
    Array.isArray(provenance.evidence) &&
    provenance.evidence.every(
      (evidence) =>
        isRecord(evidence) &&
        typeof evidence.key === "string" &&
        typeof evidence.title === "string" &&
        isProjectReportSubject(evidence.subject),
    ) &&
    isRecord(coverage) &&
    (coverage.status === ProjectReportCoverageStatusEnum.Complete ||
      coverage.status === ProjectReportCoverageStatusEnum.Incomplete) &&
    Array.isArray(coverage.limitations)
  );
};

/**
 * Single narrowing point for PROJECT_REPORT. The authored body is validated
 * separately by the renderer so typed metadata survives an unusable body.
 */
export const narrowProjectReportPayload = (
  report: ReportDto,
): ProjectReportPayload | null => {
  if (report.reportType !== ReportType.ProjectReport) {
    throw new Error(
      `Expected a PROJECT_REPORT report, received ${report.reportType}`,
    );
  }
  return isProjectReportPayload(report.payload) ? report.payload : null;
};

export const narrowReportPayload = <T extends ReportDto>(
  report: T,
): NarrowedReportPayload<T["reportType"]> => {
  if (report.reportType === ReportType.FeatureSyncDecision) {
    return narrowFeatureSyncDecisionReport(report)
      .payload as NarrowedReportPayload<T["reportType"]>;
  }

  switch (report.reportType) {
    case ReportType.CodingResearch:
    case ReportType.EvidencePipeline:
    case ReportType.Snapshot:
    case ReportType.RollupProposal:
    case ReportType.DailySession:
    case ReportType.GoalProgress:
    case ReportType.RiskAlert:
    case ReportType.SessionSummary:
    case ReportType.SessionMonitorDeferral:
    case ReportType.Commit:
    case ReportType.Plan:
    case ReportType.Implement:
    case ReportType.FeatureSync:
    case ReportType.FeatureSyncHandoff:
    case ReportType.DecisionNeeded:
    case ReportType.ValidationWalkthrough:
    case ReportType.FeatureTreeAnalysis:
    case ReportType.CompetitiveAnalysis:
    case ReportType.PhaseGrounding:
    case ReportType.ChangeWalkthrough:
    case ReportType.Review:
    case ReportType.EvalRun:
    case ReportType.EvalAttempt:
    case ReportType.EvalHumanReview:
    case ReportType.ProjectReport:
      return report.payload as NarrowedReportPayload<T["reportType"]>;
    default: {
      throw new Error("Unhandled report type");
    }
  }
};
