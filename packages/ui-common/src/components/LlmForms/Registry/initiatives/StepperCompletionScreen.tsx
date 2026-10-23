import React from "react";
import { Box, Stack, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

export interface StepperCompletionScreenProps {
  keptCount: number;
}

export const StepperCompletionScreen: React.FC<
  StepperCompletionScreenProps
> = ({ keptCount }) => {
  return (
    <Box
      data-testid="stepper-completion-screen"
      sx={{
        textAlign: "center",
        py: 6,
        px: 3,
        maxWidth: 600,
        mx: "auto",
      }}
    >
      <CheckCircleIcon
        sx={{
          fontSize: 80,
          color: "success.main",
          mb: 3,
        }}
      />

      <Typography variant="h4" gutterBottom>
        Awesome! You've kept {keptCount} initiative{keptCount === 1 ? "" : "s"}.
      </Typography>

      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        We've added these to your roadmap. You can tweak the details whenever
        you're ready to start them.
      </Typography>

      <Stack spacing={2} sx={{ maxWidth: 400, mx: "auto" }}>
        <Typography variant="body2" color="text.secondary">
          Click the submit button below to complete onboarding and view your
          roadmap.
        </Typography>
      </Stack>
    </Box>
  );
};
