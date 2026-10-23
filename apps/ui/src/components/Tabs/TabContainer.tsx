import { Paper, Stack } from "@mui/material";
import type { ReactNode } from "react";
import React from "react";

interface TabContainerProps {
  children: ReactNode;
}

/**
 * Shared container component for tab content.
 * Provides consistent styling and layout across all tab components.
 */
export const TabContainer: React.FC<TabContainerProps> = ({ children }) => {
  return (
    <Paper
      sx={{
        mt: 2,
        p: 3,
        backgroundColor: "background.default",
        boxShadow: "none",
        borderRadius: "4px",
        width: "100%",
      }}
    >
      <Stack spacing={3}>{children}</Stack>
    </Paper>
  );
};
