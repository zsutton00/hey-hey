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
  type MonitorNodeResultReportPayload,
  type SessionSummaryReportPayload,
  type SnapshotReportPayload,
  type ValidationWalkthroughReportPayload,
} from "../../api";
import {
  ChangeWalkthroughReport,
  CodingResearchReport,
  CodingResearchUncertaintiesSection,
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
  MonitorNodeResultReport,
  SessionSummaryReport,
  SnapshotReport,
  StandardReportContent,
  ValidationWalkthroughReport,
  narrowProjectReportPayload,
  narrowReportPayload,
  type PlanReportInteractionContext,
  type ReportViewerTitleLink,
} from "./viewer";
import { getCodingResearchUncertainties } from "./viewer/codingResearchSubagentParentUncertainties";
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
  /** The user's persisted reply to a Feature Sync decision, used to restore the chosen options. */
  featureSyncDecisionRecordedResponse?: string;
  /**
   * Saved eval attempt output: marked with the evaluation badge and shown
   * from its saved payload with no response controls. Display only.
   */
  evaluationOutput?: boolean;
  renderOpenQuestions?: boolean;
  /** Render proposed updates inside the report body. Conversations show them as cards after the message instead. */
  renderUpdates?: boolean;
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
  featureSyncDecisionRecordedResponse,
  evaluationOutput = false,
  renderOpenQuestions = true,
  renderUpdates = true,
}) => {
  const testId = `${testIdPrefix}-${report.id}`;
  const afterFrameContent = renderOpenQuestions ? (
    <ReportOpenQuestions report={report} testId={testId} />
  ) : null;
  // Exactly one host title: the frame header or title link when present,
  // otherwise the renderer's own heading, unless the surface owns the title.
  const isInteractive =
    !evaluationOutput &&
    ((report.reportType === ReportType.Plan && planInteraction !== undefined) ||
      (report.reportType === ReportType.FeatureSyncDecision &&
        featureSyncDecisionInteraction !== undefined));
  const rendererShowsTitle = renderTitle && !renderHeader && !titleLink;
  // A V2 decision report is its own framed card; in the conversation (no
  // standard header) the grey report panel would nest a second frame around it.
  const ownsFrame =
    report.reportType === ReportType.FeatureSyncDecision &&
    report.schemaVersion === 2 &&
    !renderHeader;
  const frameSx = ownsFrame ? withUnframedReportSx(sx) : sx;

  return (
    <ReportViewerFrame
      report={report}
      testId={testId}
      renderHeader={renderHeader}
      titleLink={titleLink}
      sx={frameSx}
      interactive={isInteractive}
      afterFrameContent={afterFrameContent}
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
        featureSyncDecisionRecordedResponse,
        renderUpdates,
      )}
    </ReportViewerFrame>
  );
};

export const ReportOpenQuestions: React.FC<{
  report: ReportDto;
  testId: string;
}> = ({ report, testId }) => {
  if (report.reportType !== ReportType.CodingResearch) {
    return null;
  }
  const payload = narrowReportPayload(report);
  if (payload.reportType !== ReportType.CodingResearch) {
    return null;
  }
  return (
    <CodingResearchUncertaintiesSection
      reportTestId={testId}
      uncertainties={getCodingResearchUncertainties(payload)}
    />
  );
};

const unframedReportStyles = {
  p: 0,
  border: "none",
  backgroundColor: "transparent",
} as const;

/** ReportViewerFrame merges a function or object sx; the unframed styles win. */
const withUnframedReportSx = (
  sx: ReportViewerProps["sx"],
): ReportViewerProps["sx"] => {
  if (typeof sx === "function") {
    return (theme) => ({ ...sx(theme), ...unframedReportStyles });
  }

  return { ...sx, ...unframedReportStyles };
};

const renderReportBody = (
  report: ReportDto,
  reportTestId: string,
  rendererShowsTitle: boolean,
  planInteraction?: PlanReportInteractionContext,
  featureSyncDecisionInteraction?: FeatureSyncDecisionReportInteractionContext,
  evaluationOutput = false,
  featureSyncDecisionRecordedResponse?: string,
  renderUpdates = true,
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
        featureSyncDecisionRecordedResponse,
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
          renderOpenQuestions={false}
          renderUpdates={renderUpdates}
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
    case ReportType.MonitorNodeResult:
      return (
        <MonitorNodeResultReport
          payload={payload as MonitorNodeResultReportPayload}
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
  recordedResponse?: string,
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
      recordedResponse={recordedResponse}
    />
  );
};
