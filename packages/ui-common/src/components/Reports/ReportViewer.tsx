import React from "react";
import {
  ReportType,
  type ChangeWalkthroughReportPayload,
  type CodingResearchReportPayload,
  type CommitReportPayload,
  type CompetitiveAnalysisReportPayload,
  type DailySessionReportPayload,
  type DecisionNeededReportPayload,
  type EvidencePipelineReportPayload,
  type FeatureSyncHandoffReportPayload,
  type FeatureSyncReportPayload,
  type FeatureTreeAnalysisReportPayload,
  type GoalProgressReportPayload,
  type ImplementReportPayload,
  type PhaseGroundingReportPayload,
  type PlanReportPayload,
  type ReportDto,
  type RiskAlertReportPayload,
  type RollupProposalReportPayload,
  type SessionMonitorDeferralReportPayload,
  type SessionSummaryReportPayload,
  type SnapshotReportPayload,
  type ValidationWalkthroughReportPayload,
} from "../../api";
import {
  ChangeWalkthroughReport,
  CodingResearchReport,
  CommitReport,
  CompetitiveAnalysisReport,
  DailySessionReport,
  DecisionNeededReport,
  EvidencePipelineReport,
  FeatureSyncDecisionReport,
  FeatureSyncHandoffReport,
  FeatureSyncReport,
  FeatureTreeAnalysisReport,
  GoalProgressReport,
  ImplementReport,
  InteractivePlanReport,
  PhaseGroundingReport,
  PlanReport,
  ProjectReport,
  RiskAlertReport,
  ReportViewerFrame,
  RollupProposalReport,
  SessionMonitorDeferralReport,
  SessionSummaryReport,
  SnapshotReport,
  StandardReportContent,
  ValidationWalkthroughReport,
  narrowProjectReportPayload,
  narrowReportPayload,
  type PlanReportInteractionContext,
  type ReportViewerTitleLink,
} from "./viewer";
import {
  narrowFeatureSyncDecisionReport,
  type FeatureSyncDecisionReportDto,
} from "./viewer/rendererContract";
import type { FeatureSyncDecisionReportInteractionContext } from "./viewer/FeatureSyncDecisionReport";
import { Alert, Box, type SxProps, type Theme } from "@mui/material";
import { EvaluationOutputBadge } from "../ProposalDispatchers/EvaluationOutputBadge";
import { log } from "../../utils/logger";

export interface ReportViewerProps {
  report: ReportDto;
  testIdPrefix?: string;
  /** Whether to render the standard report header (title, type/version chips, created-at timestamp, divider). Default: true */
  renderHeader?: boolean;
  /**
   * Set false when the surrounding surface already shows the report title
   * (e.g. a page heading) and the standard header is suppressed, so the
   * viewer does not repeat it. Default: true
   */
  renderTitle?: boolean;
  /** Optional compact title-link handoff for inline report presentations. */
  titleLink?: ReportViewerTitleLink;
  /** Optional custom styling applied to the Paper component, merged with existing background styles */
  sx?: SxProps<Theme>;
  /** Conversation-only response context. Standalone report surfaces omit it and remain read-only. */
  planInteraction?: PlanReportInteractionContext;
  /** Conversation-only response context for grouped Feature Sync decisions. */
  featureSyncDecisionInteraction?: FeatureSyncDecisionReportInteractionContext;
  /**
   * Saved eval attempt output: marked with the evaluation badge and shown
   * from its saved payload with no response controls. Display only.
   */
  evaluationOutput?: boolean;
}

export const ReportViewer: React.FC<ReportViewerProps> = ({
  report,
  testIdPrefix = "report-viewer",
  renderHeader = true,
  renderTitle = true,
  titleLink,
  sx,
  planInteraction,
  featureSyncDecisionInteraction,
  evaluationOutput = false,
}) => {
  const testId = `${testIdPrefix}-${report.id}`;
  // Exactly one host title: the frame header or title link when present,
  // otherwise the renderer's own heading, unless the surface owns the title.
  const rendererShowsTitle = renderTitle && !renderHeader && !titleLink;

  return (
    <ReportViewerFrame
      report={report}
      testId={testId}
      renderHeader={renderHeader}
      titleLink={titleLink}
      sx={sx}
    >
      {evaluationOutput && (
        <Box sx={{ mb: 1.5 }}>
          <EvaluationOutputBadge />
        </Box>
      )}
      {renderReportBody(
        report,
        testId,
        rendererShowsTitle,
        evaluationOutput ? undefined : planInteraction,
        evaluationOutput ? undefined : featureSyncDecisionInteraction,
        evaluationOutput,
      )}
    </ReportViewerFrame>
  );
};

const renderReportBody = (
  report: ReportDto,
  reportTestId: string,
  rendererShowsTitle: boolean,
  planInteraction?: PlanReportInteractionContext,
  featureSyncDecisionInteraction?: FeatureSyncDecisionReportInteractionContext,
  evaluationOutput = false,
): React.ReactElement => {
  if (report.reportType === ReportType.ProjectReport) {
    const projectReportPayload = narrowProjectReportPayload(report);
    return projectReportPayload ? (
      <ProjectReport
        payload={projectReportPayload}
        report={report}
        reportTestId={reportTestId}
        showTitle={rendererShowsTitle}
      />
    ) : (
      <Alert
        severity="error"
        data-testid={`${reportTestId}-project-report-invalid`}
      >
        This project report has an invalid payload and cannot be displayed.
      </Alert>
    );
  }

  const payload = narrowReportPayload(report);

  switch (report.reportType) {
    case ReportType.ChangeWalkthrough:
      return (
        <ChangeWalkthroughReport
          payload={payload as ChangeWalkthroughReportPayload}
          report={report}
          reportTestId={reportTestId}
        />
      );
    case ReportType.EvidencePipeline:
      return (
        <EvidencePipelineReport
          payload={payload as EvidencePipelineReportPayload}
          report={report}
          reportTestId={reportTestId}
        />
      );
    case ReportType.ValidationWalkthrough:
      return (
        <ValidationWalkthroughReport
          payload={payload as ValidationWalkthroughReportPayload}
          report={report}
          reportTestId={reportTestId}
        />
      );
    case ReportType.Snapshot:
      return (
        <SnapshotReport
          payload={payload as SnapshotReportPayload}
          report={report}
          reportTestId={reportTestId}
        />
      );
    case ReportType.Implement:
      return (
        <ImplementReport
          payload={payload as ImplementReportPayload}
          report={report}
          reportTestId={reportTestId}
        />
      );
    case ReportType.Plan:
      log.debug(
        "conversation_viewer",
        "[interactive-plan-report] selecting PLAN report renderer",
        {
          reportId: report.id,
          renderer: planInteraction ? "interactive" : "display-only",
          hasInteractionContext: planInteraction !== undefined,
          interactionDisabled: planInteraction?.disabled,
          parentMessageId: planInteraction?.parentMessageId,
          responseUiElementId: planInteraction?.sourceUiElement.id,
        },
      );
      return planInteraction ? (
        <InteractivePlanReport
          interaction={planInteraction}
          payload={payload as PlanReportPayload}
          report={report}
          reportTestId={reportTestId}
        />
      ) : (
        <PlanReport
          payload={payload as PlanReportPayload}
          report={report}
          reportTestId={reportTestId}
        />
      );
    case ReportType.PhaseGrounding:
      return (
        <PhaseGroundingReport
          payload={payload as PhaseGroundingReportPayload}
          report={report}
          reportTestId={reportTestId}
        />
      );
    case ReportType.FeatureSync:
      return (
        <FeatureSyncReport
          payload={payload as FeatureSyncReportPayload}
          report={report}
          reportTestId={reportTestId}
        />
      );
    case ReportType.FeatureSyncDecision:
      return renderFeatureSyncDecisionReport(
        narrowFeatureSyncDecisionReport(report),
        reportTestId,
        featureSyncDecisionInteraction,
      );
    case ReportType.DecisionNeeded:
      return (
        <DecisionNeededReport
          payload={payload as DecisionNeededReportPayload}
          report={report}
          reportTestId={reportTestId}
        />
      );
    case ReportType.CodingResearch:
      return (
        <CodingResearchReport
          payload={payload as CodingResearchReportPayload}
          report={report}
          reportTestId={reportTestId}
          evaluationOutput={evaluationOutput}
        />
      );
    case ReportType.FeatureSyncHandoff:
      return (
        <FeatureSyncHandoffReport
          payload={payload as FeatureSyncHandoffReportPayload}
          report={report}
          reportTestId={reportTestId}
        />
      );
    case ReportType.FeatureTreeAnalysis:
      return (
        <FeatureTreeAnalysisReport
          payload={payload as FeatureTreeAnalysisReportPayload}
          report={report}
          reportTestId={reportTestId}
        />
      );
    case ReportType.CompetitiveAnalysis:
      return (
        <CompetitiveAnalysisReport
          payload={payload as CompetitiveAnalysisReportPayload}
          report={report}
          reportTestId={reportTestId}
        />
      );
    case ReportType.GoalProgress:
      return (
        <GoalProgressReport
          payload={payload as GoalProgressReportPayload}
          report={report}
          reportTestId={reportTestId}
        />
      );
    case ReportType.Commit:
      return (
        <CommitReport
          payload={payload as CommitReportPayload}
          report={report}
          reportTestId={reportTestId}
        />
      );
    case ReportType.RiskAlert:
      return (
        <RiskAlertReport
          payload={payload as RiskAlertReportPayload}
          report={report}
          reportTestId={reportTestId}
        />
      );
    case ReportType.DailySession:
      return (
        <DailySessionReport
          payload={payload as DailySessionReportPayload}
          report={report}
          reportTestId={reportTestId}
        />
      );
    case ReportType.RollupProposal:
      return (
        <RollupProposalReport
          payload={payload as RollupProposalReportPayload}
          report={report}
          reportTestId={reportTestId}
        />
      );
    case ReportType.SessionSummary:
      return (
        <SessionSummaryReport
          payload={payload as SessionSummaryReportPayload}
          report={report}
          reportTestId={reportTestId}
        />
      );
    case ReportType.SessionMonitorDeferral:
      return (
        <SessionMonitorDeferralReport
          payload={payload as SessionMonitorDeferralReportPayload}
          report={report}
          reportTestId={reportTestId}
        />
      );
    default:
      return (
        <StandardReportContent report={report} reportTestId={reportTestId} />
      );
  }
};

const renderFeatureSyncDecisionReport = (
  report: FeatureSyncDecisionReportDto,
  reportTestId: string,
  interaction?: FeatureSyncDecisionReportInteractionContext,
): React.ReactElement => {
  if (report.schemaVersion === 1) {
    return (
      <FeatureSyncDecisionReport
        payload={report.payload}
        report={report}
        reportTestId={reportTestId}
        interaction={interaction}
      />
    );
  }

  return (
    <FeatureSyncDecisionReport
      payload={report.payload}
      report={report}
      reportTestId={reportTestId}
      interaction={interaction}
    />
  );
};
