import React from "react";
import { Box, Button, Typography } from "@mui/material";

export interface StepperIntroScreenProps {
  initiativeCount: number;
  onStart: () => void;
}

export const StepperIntroScreen: React.FC<StepperIntroScreenProps> = ({
  initiativeCount,
  onStart,
}) => {
  return (
    <Box
      data-testid="stepper-intro-screen"
      sx={{
        py: 4,
        px: 3,
      }}
    >
      <Typography variant="h5" gutterBottom>
        Review Your Initiatives
      </Typography>

      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        I've created {initiativeCount} initiative
        {initiativeCount === 1 ? "" : "s"} based on your inputs. Please review
        each one and either add it to your roadmap or skip it if it's not
        relevant.
      </Typography>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
        This should only take a minute. You'll be able to refine the details
        later.
      </Typography>

      <Button
        variant="contained"
        color="actionable"
        size="large"
        onClick={onStart}
        data-testid="start-review-button"
      >
        Start Review
      </Button>
    </Box>
  );
};
