import { Box, Stack } from "@mui/material";
import React from "react";

export interface StepBodyWithDemoProps {
  text?: React.ReactNode;
  demo: React.ReactNode;
}

const COLUMN_MAX_WIDTH = 600;

export const StepBodyWithDemo: React.FC<StepBodyWithDemoProps> = ({
  text,
  demo,
}) => {
  if (!text) {
    return <>{demo}</>;
  }
  return (
    <Stack
      direction={{ xs: "column", lg: "row" }}
      spacing={3}
      alignItems="flex-start"
      sx={{ width: "100%" }}
    >
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          width: "100%",
          maxWidth: COLUMN_MAX_WIDTH,
        }}
      >
        {text}
      </Box>
      <Box sx={{ flexShrink: 0 }}>{demo}</Box>
    </Stack>
  );
};
