import { Box, Chip } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import React from "react";
import type { AgentUncertaintySystemMessageData } from "../../api";
import { ConversationCard } from "../Conversation/Card";
import { NEEDS_YOUR_ANSWER_LABEL } from "./QuestionFrame";
import { UncertaintyDiscussControl } from "./UncertaintyDiscussControl";

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

// Sizes are px strings: in MUI `sx`, a bare `1` means 100%, which would make
// this label as large as the conversation and give the page a second scroller.
const visuallyHidden = {
  border: 0,
  clip: "rect(0 0 0 0)",
  height: "1px",
  width: "1px",
  margin: "-1px",
  overflow: "hidden",
  padding: 0,
  position: "absolute",
  whiteSpace: "nowrap",
} as const;

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

const UncertaintyBadge: React.FC = () => (
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
    !
  </Box>
);

export interface UncertaintyItemProps {
  severity: Severity;
  category: AgentUncertaintySystemMessageData["category"];
  statement: string;
  testId: string;
  /** Reports omit the "Needs your answer" band; conversations show it. */
  showAnswerBand?: boolean;
  /** Shows a Discuss control on non-question cards; the host opens the conversation. */
  onDiscuss?: () => void;
  children?: React.ReactNode;
}

export const UncertaintyItem: React.FC<UncertaintyItemProps> = ({
  severity,
  category,
  statement,
  testId,
  showAnswerBand = true,
  onDiscuss,
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
    <ConversationCard
      data-testid={testId}
      tone={{ severity }}
      icon={<UncertaintyBadge />}
      kindLabel="Uncertainty"
      headerDivider={false}
      chips={
        <>
          <Box component="span" sx={visuallyHidden}>
            {`${severity} severity`}
          </Box>
          <Chip
            label={UNCERTAINTY_CATEGORY_LABELS[category]}
            size="small"
            variant="outlined"
          />
        </>
      }
      lead={
        <>
          {statement}
          {onDiscuss ? (
            <UncertaintyDiscussControl onDiscuss={onDiscuss} />
          ) : null}
        </>
      }
    >
      {children}
    </ConversationCard>
  );
};
