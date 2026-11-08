import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CloseIcon from "@mui/icons-material/Close";
import {
  Box,
  Button,
  DialogContent,
  DialogTitle,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Typography,
} from "@mui/material";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { FunctionalDialog } from "@hey-hey/ui-common/components";
import type { EvalAttemptReport } from "@hey-hey/ui-common/data";
import { resumeCommandFor } from "./evalResultsView";
import { SpaLink } from "./SpaLink";
import {
  ReadSessionButton,
  asTranscriptProviderId,
} from "./ProviderSessionTranscript";

const CopyCommand: React.FC<{ command: string }> = ({ command }) => {
  const { t } = useTranslation();
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      <Box component="code" sx={{ userSelect: "all", fontSize: "0.8rem" }}>
        {command}
      </Box>
      <IconButton
        size="small"
        aria-label={t("eval.results.sessions.copyCommand")}
        onClick={() => void navigator.clipboard.writeText(command)}
      >
        <ContentCopyIcon fontSize="inherit" />
      </IconButton>
    </Box>
  );
};

const ProviderSessionRow: React.FC<{
  name: string;
  id: string | null;
  command: string | null;
  testId: string;
  actions?: React.ReactNode;
}> = ({ name, id, command, testId, actions }) => {
  const { t } = useTranslation();
  return (
    <TableRow data-testid={testId}>
      <TableCell>{name}</TableCell>
      <TableCell>
        {id ? (
          <Box component="code" sx={{ userSelect: "all" }}>
            {id}
          </Box>
        ) : (
          t("eval.results.notReported")
        )}
      </TableCell>
      <TableCell>{command && <CopyCommand command={command} />}</TableCell>
      <TableCell>{actions}</TableCell>
    </TableRow>
  );
};

const JudgeInputModal: React.FC<{
  open: boolean;
  onClose: () => void;
  judgedOutput: string;
}> = ({ open, onClose, judgedOutput }) => {
  const { t } = useTranslation();
  return (
    <FunctionalDialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      data-testid="eval-judge-input-modal"
      closeControl={
        <IconButton onClick={onClose} size="small" aria-label="Close">
          <CloseIcon fontSize="small" />
        </IconButton>
      }
    >
      <DialogTitle>{t("eval.results.sessions.inputModalTitle")}</DialogTitle>
      <DialogContent dividers>
        <Box
          component="pre"
          sx={{
            m: 0,
            maxHeight: 400,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            fontSize: "0.8rem",
          }}
          data-testid="eval-judge-input-content"
        >
          {judgedOutput}
        </Box>
      </DialogContent>
    </FunctionalDialog>
  );
};

export const AttemptSessions: React.FC<{
  attempt: EvalAttemptReport;
  judgeSessionHref: string | null;
  judgeProvider: string;
}> = ({ attempt, judgeSessionHref, judgeProvider }) => {
  const { t } = useTranslation();
  const [inputModalOpen, setInputModalOpen] = useState(false);
  const { judgedOutput } = attempt.payload;
  const attemptProvider = attempt.payload.configuration.target.provider;
  const attemptIds = (attempt.payload.attemptProviderSessionIds ?? []).filter(
    (id) => !id.startsWith("pending_"),
  );
  const judgeId = attempt.payload.judgeProviderSessionId ?? null;
  const attemptRunId = attempt.payload.targetSessionId ?? null;
  const judgeRunId =
    attempt.payload.automatedAssessment?.judgeSessionId ?? null;
  const attemptProviderId = asTranscriptProviderId(attemptProvider);
  const judgeProviderId = asTranscriptProviderId(judgeProvider);

  const judgeActions = (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
      {judgeId && judgeRunId && judgeProviderId && (
        <ReadSessionButton
          testId="eval-judge-read-session"
          target={{
            runId: judgeRunId,
            providerId: judgeProviderId,
            providerSessionId: judgeId,
          }}
        />
      )}
      {judgeSessionHref && (
        <SpaLink href={judgeSessionHref} testId="eval-open-judge-session">
          {t("eval.results.sessions.openJudge")}
        </SpaLink>
      )}
      {judgedOutput ? (
        <Button
          size="small"
          data-testid="eval-judge-view-input"
          onClick={() => setInputModalOpen(true)}
        >
          {t("eval.results.sessions.viewInput")}
        </Button>
      ) : (
        <Typography
          variant="body2"
          color="text.secondary"
          data-testid="eval-attempt-judged-none"
        >
          {t("eval.results.sessions.judgedNone")}
        </Typography>
      )}
    </Box>
  );

  return (
    <Box sx={{ mb: 2 }} data-testid="eval-attempt-sessions">
      <Typography variant="subtitle2">
        {t("eval.results.sessions.title")}
      </Typography>
      <Table size="small" data-testid="eval-provider-sessions">
        <TableBody>
          {(attemptIds.length ? attemptIds : [null]).map((id, index) => (
            <ProviderSessionRow
              key={`agent-${index}`}
              name={t("eval.results.sessions.agent")}
              id={id}
              command={id ? resumeCommandFor(attemptProvider, id) : null}
              testId={`eval-attempt-session-row-${index}`}
              actions={
                id && attemptRunId && attemptProviderId ? (
                  <ReadSessionButton
                    testId={`eval-attempt-read-session-${index}`}
                    target={{
                      runId: attemptRunId,
                      providerId: attemptProviderId,
                      providerSessionId: id,
                    }}
                  />
                ) : undefined
              }
            />
          ))}
          <ProviderSessionRow
            name={t("eval.results.sessions.judge")}
            id={judgeId}
            command={judgeId ? resumeCommandFor(judgeProvider, judgeId) : null}
            testId="eval-judge-session"
            actions={judgeActions}
          />
        </TableBody>
      </Table>
      {judgedOutput && (
        <JudgeInputModal
          open={inputModalOpen}
          onClose={() => setInputModalOpen(false)}
          judgedOutput={judgedOutput}
        />
      )}
    </Box>
  );
};
