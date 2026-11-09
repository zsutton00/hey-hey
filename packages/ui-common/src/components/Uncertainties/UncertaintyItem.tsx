import { Chip, Paper, Stack, Typography } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import React from "react";
import type { AgentUncertaintySystemMessageData } from "../../api";
import { QuestionFrame } from "./QuestionFrame";

export const UNCERTAINTY_CATEGORY_LABELS: Record<
  AgentUncertaintySystemMessageData["category"],
  string
> = {
  lack_of_evidence: "Lack of evidence",
  conflict: "Conflict",
  ambiguity: "Ambiguity",
  not_implemented: "Not implemented",
  question: "Question",
};

type Severity = AgentUncertaintySystemMessageData["severity"];

/** Red high, amber medium, neutral grey low. Never the Discuss blue. */
const severityChipSx = (severity: Severity) => (theme: Theme) => {
  switch (severity) {
    case "high":
      return {
        backgroundColor: theme.palette.error.main,
        color: theme.palette.error.contrastText,
      };
    case "medium":
      return {
        backgroundColor: theme.palette.warning.main,
        color: theme.palette.warning.contrastText,
      };
    case "low":
      return {
        backgroundColor: theme.palette.action.selected,
        color: theme.palette.text.secondary,
      };
  }
};

export interface SeverityChipProps {
  severity: Severity;
  onBand?: boolean;
}

export const SeverityChip: React.FC<SeverityChipProps> = ({
  severity,
  onBand = false,
}) => (
  <Chip
    label={severity}
    size="small"
    sx={[
      severityChipSx(severity),
      onBand && { border: "1px solid rgba(255,255,255,0.7)" },
    ]}
  />
);

export interface UncertaintyItemProps {
  severity: Severity;
  category: AgentUncertaintySystemMessageData["category"];
  statement: string;
  testId: string;
  /** Reports omit the "Needs your answer" band; conversations show it. */
  showAnswerBand?: boolean;
  children?: React.ReactNode;
}

export const UncertaintyItem: React.FC<UncertaintyItemProps> = ({
  severity,
  category,
  statement,
  testId,
  showAnswerBand = true,
  children,
}) => {
  if (category === "question") {
    return (
      <QuestionFrame
        testId={testId}
        showAnswerBand={showAnswerBand}
        headerEnd={
          <>
            <SeverityChip severity={severity} onBand />
            <Typography variant="caption" fontWeight="bold">
              {UNCERTAINTY_CATEGORY_LABELS.question}
            </Typography>
          </>
        }
      >
        <Stack spacing={1}>
          <Typography variant="body1" fontWeight={600}>
            {statement}
          </Typography>
          {children}
        </Stack>
      </QuestionFrame>
    );
  }

  return (
    <Paper data-testid={testId} sx={{ p: 1.5 }} variant="outlined">
      <Stack spacing={1}>
        <Stack alignItems="center" direction="row" spacing={1}>
          <SeverityChip severity={severity} />
          <Chip
            label={UNCERTAINTY_CATEGORY_LABELS[category]}
            size="small"
            variant="outlined"
          />
        </Stack>
        <Typography variant="body2">{statement}</Typography>
        {children}
      </Stack>
    </Paper>
  );
};
