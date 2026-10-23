import { Alert, Box, Button, Typography } from "@mui/material";
import React from "react";
import type { SecondaryActionConfigWithHandler } from "../../LlmForms/Registry/types";

interface CodingPromptSummaryProps {
  action: SecondaryActionConfigWithHandler & {
    payload: {
      handlerType: "coding_prompt_accept";
      productGoal: string | undefined;
      productOutcome: string | undefined;
      steps: string[];
      outcomes: string[];
    };
  };
  onAccept: () => void;
}

export const CodingPromptSummary: React.FC<CodingPromptSummaryProps> = ({
  action,
  onAccept,
}) => {
  const { label, payload } = action;

  const finalInstruction =
    "Please work with the user to identify the relevant files and plan out the change completely.";

  return (
    <Alert
      severity="info"
      icon={false}
      sx={{ mb: 2 }}
      data-testid="coding-prompt-accept-summary"
    >
      <Box sx={{ mb: 1, fontWeight: 600 }}>{label}</Box>
      <Box sx={{ mb: 1 }}>
        <strong>Product Goals</strong>
        <ul>
          {[payload.productGoal, payload.productOutcome]
            .filter((s) => s !== undefined)
            .map((step, idx) => (
              <li key={idx}>{step}</li>
            ))}
        </ul>
      </Box>
      <Box sx={{ mb: 1 }}>
        <strong>Steps:</strong>
        <ul>
          {payload.steps.map((step, idx) => (
            <li key={idx}>{step}</li>
          ))}
        </ul>
      </Box>
      <Box>
        <strong>Outcomes:</strong>
        <ul>
          {payload.outcomes.map((outcome, idx) => (
            <li key={idx}>{outcome}</li>
          ))}
        </ul>
      </Box>
      <Typography variant="body2" sx={{ mt: 1 }}>
        {finalInstruction}
      </Typography>
      <Box sx={{ display: "flex", gap: 1, mt: 1, flexWrap: "wrap" }}>
        <Button
          variant="contained"
          size="small"
          onClick={onAccept}
          data-testid="coding-prompt-accept-button"
        >
          Accept Prompt
        </Button>
      </Box>
    </Alert>
  );
};
