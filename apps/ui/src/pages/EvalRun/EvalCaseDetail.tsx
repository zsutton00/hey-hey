import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import {
  Alert,
  Box,
  CircularProgress,
  Grid,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import React from "react";
import { useTranslation } from "react-i18next";

import {
  ProposalAction,
  TargetEntityType,
  type ProposalResponseDto,
} from "@hey-hey/ui-common/api";
import {
  CreateProposal,
  DeleteProposal,
  isPlaceholderEntityId,
  Report,
  UpdateProposal,
} from "@hey-hey/ui-common/components";
import {
  useEvalAttemptOutput,
  type EvalAttemptReport,
  type EvalRunReport,
} from "@hey-hey/ui-common/data";
import { WebPathService } from "@hey-hey/ui-common/services";

import { AttemptExecutionSummary } from "./AttemptExecutionSummary";
import { AttemptSessions } from "./AttemptSessions";

import { EvalHumanReviewForm } from "./EvalHumanReviewForm";
import {
  automatedAssessment,
  checkDescriptions,
  type CaseRow,
  type WorkBreakdownRow,
} from "./evalResultsView";
import { formatElapsed, formatTokenCount } from "./evalRunView";
import { SpaLink } from "./SpaLink";

/** Eval output can never be approved; the server refuses it regardless. */
const refuseApply = (): Promise<void> =>
  Promise.reject(new Error("Evaluation output can't be approved"));

/** The live item a proposal targets, when one exists to compare against. */
const liveItemPath = (
  projectId: string,
  proposal: ProposalResponseDto,
): string | null => {
  if (
    proposal.action === ProposalAction.Create ||
    isPlaceholderEntityId(proposal.targetEntityId)
  ) {
    return null;
  }
  if (proposal.targetEntityType === TargetEntityType.Task) {
    return WebPathService.task({ projectId, taskId: proposal.targetEntityId });
  }
  if (proposal.targetEntityType === TargetEntityType.DesignDoc) {
    return WebPathService.designDoc({
      projectId,
      designDocId: proposal.targetEntityId,
    });
  }
  return null;
};

const RetainedProposal: React.FC<{
  organizationId: string;
  projectId: string;
  proposal: ProposalResponseDto;
  allProposals: ProposalResponseDto[];
}> = ({ organizationId, projectId, proposal, allProposals }) => {
  const { t } = useTranslation();
  const proposals = [proposal];
  const liveHref = liveItemPath(projectId, proposal);
  const shared = {
    proposals,
    allProposals,
    onApply: refuseApply,
    disabled: true,
    renderMode: "evaluation-output" as const,
  };
  return (
    <Box data-testid={`eval-output-proposal-${proposal.id}`}>
      {proposal.action === ProposalAction.Create ? (
        <CreateProposal {...shared} />
      ) : proposal.action === ProposalAction.Delete ? (
        <DeleteProposal
          {...shared}
          organizationId={organizationId}
          projectId={projectId}
        />
      ) : (
        <UpdateProposal
          {...shared}
          organizationId={organizationId}
          projectId={projectId}
        />
      )}
      <Stack direction="row" spacing={2} sx={{ mt: 0.5 }}>
        <SpaLink
          href={WebPathService.proposal({ projectId, proposalId: proposal.id })}
          testId={`eval-output-open-proposal-${proposal.id}`}
        >
          {t("eval.results.attempt.openProposal")}
        </SpaLink>
        {liveHref && (
          <SpaLink
            href={liveHref}
            testId={`eval-output-live-item-${proposal.id}`}
          >
            {t("eval.results.attempt.openLiveItem")}
          </SpaLink>
        )}
      </Stack>
    </Box>
  );
};

const AttemptOutputs: React.FC<{
  organizationId: string;
  projectId: string;
  attempt: EvalAttemptReport;
}> = ({ organizationId, projectId, attempt }) => {
  const { t } = useTranslation();
  const output = useEvalAttemptOutput(organizationId, attempt);
  let conversation: React.ReactNode = null;
  if (!output.hasRecordedConversation) {
    conversation = (
      <Typography
        variant="body2"
        color="text.secondary"
        data-testid="eval-output-no-conversation"
      >
        {t("eval.results.attempt.noConversation")}
      </Typography>
    );
  } else if (output.error) {
    conversation = (
      <Alert severity="error" data-testid="eval-output-error">
        {t("eval.results.attempt.outputsUnavailable")}
      </Alert>
    );
  } else if (!output.data) {
    conversation = <CircularProgress size={20} />;
  } else if (
    output.data.proposals.length === 0 &&
    output.data.reports.length === 0
  ) {
    conversation = (
      <Typography
        variant="body2"
        color="text.secondary"
        data-testid="eval-output-no-attachments"
      >
        {t("eval.results.attempt.noAttachments")}
      </Typography>
    );
  } else {
    const { proposals, reports } = output.data;
    conversation = (
      <Stack spacing={2}>
        <Typography variant="caption" color="text.secondary">
          {t("eval.results.attempt.savedNote")}
        </Typography>
        {proposals.map((proposal) => (
          <RetainedProposal
            key={proposal.id}
            organizationId={organizationId}
            projectId={projectId}
            proposal={proposal}
            allProposals={proposals}
          />
        ))}
        {reports.map((report) => (
          <Box key={report.id} data-testid={`eval-output-report-${report.id}`}>
            <Report report={report} evaluationOutput />
          </Box>
        ))}
      </Stack>
    );
  }

  const nothingSaved =
    output.hasRecordedConversation &&
    !output.error &&
    output.data !== null &&
    output.data.proposals.length === 0 &&
    output.data.reports.length === 0;

  return (
    <Box data-testid="eval-attempt-outputs">
      <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
        {t("eval.results.attempt.produced")}
      </Typography>
      <Stack spacing={2}>
        {nothingSaved ? (
          <Typography
            variant="body2"
            color="text.secondary"
            data-testid="eval-output-none"
          >
            {t("eval.results.attempt.noOutput")}
          </Typography>
        ) : (
          conversation
        )}
      </Stack>
    </Box>
  );
};

const AutomatedAssessment: React.FC<{
  run: EvalRunReport;
  attempt: EvalAttemptReport;
}> = ({ run, attempt }) => {
  const { t } = useTranslation();
  const assessment = automatedAssessment(attempt);
  if (!assessment) {
    return (
      <Box data-testid="eval-automated-assessment">
        <Typography variant="subtitle2" component="h3">
          {t("eval.results.assessment.title")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("eval.results.assessment.pending")}
        </Typography>
      </Box>
    );
  }
  const checks = checkDescriptions(run, attempt);
  return (
    <Box data-testid="eval-automated-assessment">
      <Typography variant="subtitle2" component="h3">
        {t("eval.results.assessment.title")}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {t("eval.results.assessment.checks")}
      </Typography>
      {assessment.checkResults.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("eval.results.assessment.noChecks")}
        </Typography>
      ) : (
        <List dense disablePadding>
          {assessment.checkResults.map((result) => (
            <ListItem
              key={result.checkId}
              disableGutters
              data-testid={`eval-check-${result.checkId}`}
            >
              <ListItemIcon sx={{ minWidth: 28 }}>
                {result.passed ? (
                  <CheckIcon
                    fontSize="small"
                    color="success"
                    titleAccess={t("eval.results.assessment.passed")}
                  />
                ) : (
                  <CloseIcon
                    fontSize="small"
                    color="error"
                    titleAccess={t("eval.results.assessment.failed")}
                  />
                )}
              </ListItemIcon>
              <ListItemText
                primary={
                  checks.get(result.checkId)?.description ?? result.checkId
                }
                secondary={result.explanation}
              />
            </ListItem>
          ))}
        </List>
      )}
      <Typography variant="caption" color="text.secondary">
        {t("eval.results.assessment.rubric")}
      </Typography>
      <Table size="small" data-testid="eval-rubric-scores">
        <TableBody>
          <TableRow data-testid="eval-rubric-recognition">
            <TableCell>{t("eval.results.assessment.recognition")}</TableCell>
            <TableCell>
              {assessment.recognition.recognized
                ? t("eval.results.assessment.recognized")
                : t("eval.results.assessment.notRecognized")}
            </TableCell>
            <TableCell>{assessment.recognition.explanation}</TableCell>
          </TableRow>
          {assessment.quality.map((dimension) => (
            <TableRow
              key={dimension.key}
              data-testid={`eval-rubric-${dimension.key}`}
            >
              <TableCell>{dimension.name}</TableCell>
              <TableCell>
                {dimension.score ?? t("eval.results.assessment.unscored")}
              </TableCell>
              <TableCell>{dimension.explanation}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
};

const formatOrNotReported = (
  value: number | null,
  format: (value: number) => string,
  notReported: string,
): string => (value === null ? notReported : format(value));

const WorkBreakdown: React.FC<{ rows: WorkBreakdownRow[] }> = ({ rows }) => {
  const { t } = useTranslation();
  const notReported = t("eval.results.notReported");
  return (
    <Table size="small" data-testid="eval-work-breakdown" sx={{ mb: 2 }}>
      <TableHead>
        <TableRow>
          <TableCell>{t("eval.results.work.scope")}</TableCell>
          <TableCell>{t("eval.results.cases.col.elapsed")}</TableCell>
          <TableCell>{t("eval.results.cases.col.tokens")}</TableCell>
          <TableCell>{t("eval.results.cases.col.toolCalls")}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.scope} data-testid={`eval-work-${row.scope}`}>
            <TableCell>{t(`eval.results.work.${row.scope}`)}</TableCell>
            <TableCell>
              {formatOrNotReported(row.elapsedMs, formatElapsed, notReported)}
            </TableCell>
            <TableCell>
              {formatOrNotReported(row.tokens, formatTokenCount, notReported)}
            </TableCell>
            <TableCell>
              {formatOrNotReported(
                row.toolCalls,
                (value) => String(Math.round(value)),
                notReported,
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

const ExpectedVersusResult: React.FC<{ row: CaseRow }> = ({ row }) => {
  const { t } = useTranslation();
  return (
    <Box sx={{ mb: 2 }} data-testid="eval-expected-vs-result">
      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
        <b>{t("eval.results.detail.expected")}:</b>{" "}
        {row.expectation ?? t("eval.results.detail.noExpectation")}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: "pre-wrap" }}>
        <b>{t("eval.results.detail.result")}:</b>{" "}
        {row.recognitionExplanation ?? t("eval.results.detail.noResult")}
      </Typography>
      {row.evalCaseHref && (
        <Box sx={{ mt: 0.5 }}>
          <SpaLink
            href={row.evalCaseHref}
            testId={`eval-open-case-${row.attemptId}`}
          >
            {t("eval.results.detail.openEvalCase")}
          </SpaLink>
        </Box>
      )}
    </Box>
  );
};

export interface EvalCaseDetailProps {
  organizationId: string;
  projectId: string;
  run: EvalRunReport;
  attempt: EvalAttemptReport;
  row: CaseRow;
}

/** The specifics of one case attempt, shown when its row is expanded. */
export const EvalCaseDetail: React.FC<EvalCaseDetailProps> = ({
  organizationId,
  projectId,
  run,
  attempt,
  row,
}) => (
  <Box sx={{ p: 2 }} data-testid={`eval-attempt-detail-${attempt.id}`}>
    <AttemptExecutionSummary attempt={attempt} />
    <AttemptSessions projectId={projectId} run={run} attempt={attempt} />
    <ExpectedVersusResult row={row} />
    <WorkBreakdown rows={row.breakdown} />
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 6 }}>
        <AttemptOutputs
          organizationId={organizationId}
          projectId={projectId}
          attempt={attempt}
        />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Stack spacing={3}>
          <AutomatedAssessment run={run} attempt={attempt} />
          <EvalHumanReviewForm
            organizationId={organizationId}
            projectId={projectId}
            evalId={run.payload.evalId}
            attempt={attempt}
          />
        </Stack>
      </Grid>
    </Grid>
  </Box>
);
