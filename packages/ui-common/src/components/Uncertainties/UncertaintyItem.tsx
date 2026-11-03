import { Chip, Paper, Stack, Typography } from "@mui/material";
import React from "react";
import type { AgentUncertaintySystemMessageData } from "../../api";

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

export interface UncertaintyItemProps {
  severity: AgentUncertaintySystemMessageData["severity"];
  category: AgentUncertaintySystemMessageData["category"];
  statement: string;
  testId: string;
  children?: React.ReactNode;
}

export const UncertaintyItem: React.FC<UncertaintyItemProps> = ({
  severity,
  category,
  statement,
  testId,
  children,
}) => {
  const isQuestion = category === "question";

  return (
    <Paper
      data-testid={testId}
      sx={(theme) => ({
        p: 1.5,
        ...(isQuestion && {
          borderLeft: `4px solid ${theme.palette.warning.main}`,
        }),
      })}
      variant="outlined"
    >
      <Stack spacing={1}>
        <Stack alignItems="center" direction="row" spacing={1}>
          <Chip label={severity} size="small" />
          <Typography variant="caption">
            {UNCERTAINTY_CATEGORY_LABELS[category]}
          </Typography>
          {isQuestion && (
            <Typography
              color="warning.dark"
              data-testid={`${testId}-needs-your-answer`}
              variant="caption"
              fontWeight="bold"
            >
              Needs your answer
            </Typography>
          )}
        </Stack>
        <Typography variant="body2">{statement}</Typography>
        {children}
      </Stack>
    </Paper>
  );
};
