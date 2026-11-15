import { Box, Chip, Paper, Stack, Typography } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import React from "react";
import type { AgentUncertaintySystemMessageData } from "../../api";
import { ConversationCard } from "../Conversation/Card";
import { NEEDS_YOUR_ANSWER_LABEL } from "./QuestionFrame";

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

/** Card-standard severity colors: orange high, amber medium, grey low. */
const severityChipSx = (severity: Severity) => (theme: Theme) => {
  const tone = theme.palette.conversationCard.severities[severity];

  return { backgroundColor: tone.main, color: tone.contrastText };
};

export interface SeverityChipProps {
  severity: Severity;
}

export const SeverityChip: React.FC<SeverityChipProps> = ({ severity }) => (
  <Chip label={severity} size="small" sx={severityChipSx(severity)} />
);

const QuestionBadge: React.FC = () => (
  <Box
    aria-hidden
    sx={{
      width: 20,
      height: 20,
      borderRadius: "50%",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 13,
      fontWeight: 700,
      backgroundColor: "var(--card-main)",
      color: "var(--card-contrast)",
    }}
  >
    ?
  </Box>
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
      <ConversationCard
        data-testid={testId}
        tone={{ role: "needsAnswer" }}
        icon={<QuestionBadge />}
        kindLabel={showAnswerBand ? NEEDS_YOUR_ANSWER_LABEL : "Question"}
        chips={
          <>
            <SeverityChip severity={severity} />
            {showAnswerBand ? (
              <Chip
                label={UNCERTAINTY_CATEGORY_LABELS.question}
                size="small"
                variant="outlined"
              />
            ) : null}
          </>
        }
        lead={statement}
      >
        {children}
      </ConversationCard>
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
