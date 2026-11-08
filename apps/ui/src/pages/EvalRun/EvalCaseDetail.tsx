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
} from "@hey-hey/contracts/api";
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

import { CodingAttemptResults, CodingStartPoint } from "./CodingAttemptResults";
import { EvalHumanReviewForm } from "./EvalHumanReviewForm";
import {
  automatedAssessment,
  checkDescriptions,
  type CaseRow,
  type ChecklistView,
  type WorkBreakdownRow,
} from "./evalResultsView";
import { formatCost, formatElapsed, formatTokenCount } from "./evalRunView";
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

const MockupChecklistResults: React.FC<{ checklist: ChecklistView }> = ({
  checklist,
}) => {
  const { t } = useTranslation();

  return (
    <Box data-testid="eval-mockup-checklist">
      <Typography variant="caption" color="text.secondary">
        {t("eval.results.assessment.checklist")}
      </Typography>
      <List dense disablePadding>
        {checklist.items.map((item) => (
          <ListItem
            key={item.id}
            disableGutters
            data-testid={`eval-checklist-item-${item.id}`}
          >
            <ListItemIcon sx={{ minWidth: 28 }}>
              {item.hit === null ? null : item.hit ? (
                <CheckIcon
                  fontSize="small"
                  color="success"
                  titleAccess={t("eval.results.assessment.checklistHit")}
                />
              ) : (
                <CloseIcon
                  fontSize="small"
                  color="error"
                  titleAccess={t("eval.results.assessment.checklistMissed")}
                />
              )}
            </ListItemIcon>
            <ListItemText
              primary={item.description}
              secondary={
                item.explanation ??
                t("eval.results.assessment.checklistUnanswered")
              }
            />
          </ListItem>
        ))}
      </List>
      {checklist.regressions && (
        <Typography variant="body2" data-testid="eval-checklist-regressions">
          {t("eval.results.assessment.regressions")}{" "}
          {checklist.regressions.length === 0
            ? t("eval.results.assessment.noRegressions")
            : checklist.regressions.join("; ")}
        </Typography>
      )}
    </Box>
  );
};

const AutomatedAssessment: React.FC<{
  run: EvalRunReport;
  attempt: EvalAttemptReport;
  row: CaseRow;
}> = ({ run, attempt, row }) => {
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
      {row.checklist && <MockupChecklistResults checklist={row.checklist} />}
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
          <TableCell>{t("eval.results.cases.col.cost")}</TableCell>
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
              {row.tokens === null &&
                (row.inputTokens !== null || row.outputTokens !== null) && (
                  <Typography variant="caption" display="block">
                    {t("eval.results.usage.partial", {
                      input: formatOrNotReported(
                        row.inputTokens,
                        formatTokenCount,
                        notReported,
                      ),
                      output: formatOrNotReported(
                        row.outputTokens,
                        formatTokenCount,
                        notReported,
                      ),
                    })}
                  </Typography>
                )}
              <Typography variant="caption" display="block">
                {t("eval.results.usage.cacheRead", {
                  value: formatOrNotReported(
                    row.cacheReadInputTokens,
                    formatTokenCount,
                    notReported,
                  ),
                })}
              </Typography>
              <Typography variant="caption" display="block">
                {t("eval.results.usage.cacheCreation", {
                  value: formatOrNotReported(
                    row.cacheCreationInputTokens,
                    formatTokenCount,
                    notReported,
                  ),
                })}
              </Typography>
            </TableCell>
            <TableCell>
              {formatOrNotReported(
                row.toolCalls,
                (value) => String(Math.round(value)),
                notReported,
              )}
            </TableCell>
            <TableCell data-testid={`eval-work-cost-${row.scope}`}>
              {row.cost === null
                ? notReported
                : row.costPartial
                  ? t("eval.results.cases.partial", {
                      value: formatCost(row.cost),
                    })
                  : formatCost(row.cost)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

const ExpectedVersusResult: React.FC<{
  row: CaseRow;
  organizationId: string;
  /** A repeat sits under its case, which already shows what was expected. */
  isRepeat: boolean;
}> = ({ row, organizationId, isRepeat }) => {
  const { t } = useTranslation();
  return (
    <Box sx={{ mb: 2 }} data-testid="eval-expected-vs-result">
      {!isRepeat && (
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
          <b>{t("eval.results.detail.expected")}:</b>{" "}
          {row.expectation ?? t("eval.results.detail.noExpectation")}
        </Typography>
      )}
      {row.coding && (
        <CodingStartPoint
          organizationId={organizationId}
          startPoint={row.coding.startPoint}
        />
      )}
      <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: "pre-wrap" }}>
        <b>{t("eval.results.detail.result")}:</b>{" "}
        {row.recognitionExplanation ?? t("eval.results.detail.noResult")}
      </Typography>
      {!isRepeat && row.evalCaseHref && (
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
  /** Which repeat this is when the run made several; null otherwise. */
  repeat: number | null;
}

/** The specifics of one case attempt, shown when its row is expanded. */
export const EvalCaseDetail: React.FC<EvalCaseDetailProps> = ({
  organizationId,
  projectId,
  run,
  attempt,
  row,
  repeat,
}) => (
  <Box sx={{ p: 2 }} data-testid={`eval-attempt-detail-${attempt.id}`}>
    <AttemptExecutionSummary attempt={attempt} />
    <ExpectedVersusResult
      row={row}
      organizationId={organizationId}
      isRepeat={repeat !== null}
    />
    {row.coding && <CodingAttemptResults coding={row.coding} />}
    <AttemptSessions
      attempt={attempt}
      judgeSessionHref={row.judgeSessionHref}
    />
    <WorkBreakdown rows={row.breakdown} />
    <Grid container spacing={2}>
      {!row.coding && (
        <Grid size={{ xs: 12, md: 6 }}>
          <AttemptOutputs
            organizationId={organizationId}
            projectId={projectId}
            attempt={attempt}
          />
        </Grid>
      )}
      <Grid size={{ xs: 12, md: row.coding ? 12 : 6 }}>
        <Stack spacing={3}>
          <AutomatedAssessment run={run} attempt={attempt} row={row} />
          <EvalHumanReviewForm
            organizationId={organizationId}
            projectId={projectId}
            evalId={run.payload.evalId}
            attempt={attempt}
            repeat={repeat}
          />
        </Stack>
      </Grid>
    </Grid>
  </Box>
);
