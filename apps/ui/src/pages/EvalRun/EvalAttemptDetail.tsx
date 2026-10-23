import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Grid,
  Link,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Typography,
} from "@mui/material";
import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

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

import { EvalHumanReviewForm } from "./EvalHumanReviewForm";
import {
  automatedAssessment,
  caseTitle,
  checkDescriptions,
} from "./evalResultsView";
import { setupLabel } from "./evalRunView";

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

const SpaLink: React.FC<{
  href: string;
  testId: string;
  children: React.ReactNode;
}> = ({ href, testId, children }) => {
  const navigate = useNavigate();
  return (
    <Link
      href={href}
      variant="body2"
      data-testid={testId}
      onClick={(event: React.MouseEvent) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey) return;
        event.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </Link>
  );
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

  let body: React.ReactNode;
  if (!output.hasRecordedConversation) {
    body = (
      <Typography variant="body2" color="text.secondary">
        {t("eval.results.attempt.noConversation")}
      </Typography>
    );
  } else if (output.error) {
    body = (
      <Alert severity="error" data-testid="eval-output-error">
        {t("eval.results.attempt.outputsUnavailable")}
      </Alert>
    );
  } else if (!output.data) {
    body = <CircularProgress size={20} />;
  } else if (
    output.data.proposals.length === 0 &&
    output.data.reports.length === 0
  ) {
    body = (
      <Typography variant="body2" color="text.secondary">
        {t("eval.results.attempt.noOutput")}
      </Typography>
    );
  } else {
    const { proposals, reports } = output.data;
    body = (
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

  return (
    <Box data-testid="eval-attempt-outputs">
      <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
        {t("eval.results.attempt.produced")}
      </Typography>
      {body}
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

export interface EvalAttemptDetailProps {
  organizationId: string;
  projectId: string;
  run: EvalRunReport;
  attempt: EvalAttemptReport;
}

export const EvalAttemptDetail: React.FC<EvalAttemptDetailProps> = ({
  organizationId,
  projectId,
  run,
  attempt,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const sessionId = attempt.payload.targetSessionId;
  const sessionHref = sessionId
    ? WebPathService.agentSession({
        projectId,
        agentSessionId: sessionId,
      })
    : null;
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, mt: 3 }}
      data-testid={`eval-attempt-detail-${attempt.id}`}
    >
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 2,
          mb: 2,
        }}
      >
        <Typography variant="h6" component="h2">
          {t("eval.results.attempt.heading", {
            setup: setupLabel(attempt.payload.configuration.target),
            case:
              caseTitle(run, attempt) ?? t("eval.results.attempt.unknownCase"),
          })}
        </Typography>
        {sessionHref && (
          <Button
            size="small"
            variant="outlined"
            href={sessionHref}
            onClick={(event: React.MouseEvent) => {
              if (event.ctrlKey || event.metaKey || event.shiftKey) return;
              event.preventDefault();
              navigate(sessionHref);
            }}
            data-testid="eval-attempt-open-session"
          >
            {t("eval.results.attempt.openSession")}
          </Button>
        )}
      </Box>
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
    </Paper>
  );
};
