import { Box, Stack, Typography, useTheme } from "@mui/material";
import React from "react";

/**
 * Renders a side-by-side comparison of current and proposed code snippets.
 * Used by ReconciliationReportField and CodeChangeReviewSurface.
 */
export const CodeSnippetDiff: React.FC<{
  currentSnippet: string;
  proposedSnippet: string;
}> = ({ currentSnippet, proposedSnippet }) => {
  const theme = useTheme();

  return (
    <Stack spacing={1}>
      <Box>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontWeight: 600 }}
        >
          Current
        </Typography>
        <Box
          component="pre"
          sx={{
            p: 1,
            borderRadius: 1,
            fontSize: "0.75rem",
            lineHeight: 1.4,
            overflow: "auto",
            maxHeight: 200,
            bgcolor: theme.palette.mode === "dark" ? "grey.900" : "grey.100",
            border: 1,
            borderColor: "divider",
            m: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {currentSnippet}
        </Box>
      </Box>
      <Box>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontWeight: 600 }}
        >
          Proposed
        </Typography>
        <Box
          component="pre"
          sx={{
            p: 1,
            borderRadius: 1,
            fontSize: "0.75rem",
            lineHeight: 1.4,
            overflow: "auto",
            maxHeight: 200,
            bgcolor:
              theme.palette.mode === "dark"
                ? "rgba(46, 125, 50, 0.08)"
                : "rgba(46, 125, 50, 0.06)",
            border: 1,
            borderColor:
              theme.palette.mode === "dark"
                ? "rgba(46, 125, 50, 0.3)"
                : "rgba(46, 125, 50, 0.2)",
            m: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {proposedSnippet}
        </Box>
      </Box>
    </Stack>
  );
};
