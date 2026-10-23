import { Box, Chip, Paper, Stack, Typography } from "@mui/material";
import React, { useMemo } from "react";
import type { CodeChangeReviewSurfaceProps, CodeChangeProposal } from "./types";
import { CodeSnippetDiff } from "../shared/CodeSnippetDiff";
import { SEVERITY_CONFIG } from "../shared/severityConfig";

/**
 * Renders a single code change item with file path, snippets, reasoning,
 * and severity. This is a review-only surface — no files are modified.
 */
const CodeChangeItem: React.FC<{
  change: CodeChangeProposal;
}> = ({ change }) => {
  const severity = SEVERITY_CONFIG[change.severity] ?? SEVERITY_CONFIG.low;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Typography
            variant="subtitle2"
            sx={{ fontFamily: "monospace", fontSize: "0.85rem" }}
          >
            {change.filePath}
          </Typography>
          <Chip
            label={severity.label}
            size="small"
            color={severity.color}
            sx={{ height: 22, fontSize: "0.7rem" }}
          />
        </Box>
        <Typography variant="body2" color="text.secondary">
          {change.reasoning}
        </Typography>
        <CodeSnippetDiff
          currentSnippet={change.currentSnippet}
          proposedSnippet={change.proposedSnippet}
        />
      </Stack>
    </Paper>
  );
};

/**
 * Review surface for code change proposals. Displays file path, current
 * and proposed snippets, reasoning, and severity for each change.
 *
 * This is review-only: source files are not modified by this component.
 */
export const CodeChangeReviewSurface: React.FC<
  CodeChangeReviewSurfaceProps
> = ({ codeChanges }) => {
  const sortedChanges = useMemo(() => {
    const severityOrder: Record<string, number> = {
      high: 0,
      medium: 1,
      low: 2,
    };
    return [...codeChanges].sort(
      (a, b) =>
        (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2)
    );
  }, [codeChanges]);

  if (codeChanges.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No code changes proposed.
      </Typography>
    );
  }

  const highCount = codeChanges.filter((c) => c.severity === "high").length;
  const mediumCount = codeChanges.filter((c) => c.severity === "medium").length;
  const lowCount = codeChanges.filter((c) => c.severity === "low").length;

  return (
    <Stack spacing={1.5}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Typography variant="subtitle2">
          {codeChanges.length} code change
          {codeChanges.length !== 1 ? "s" : ""} to review
        </Typography>
        <Stack direction="row" spacing={0.5}>
          {highCount > 0 && (
            <Chip
              label={`${highCount} high`}
              size="small"
              color="secondary"
              sx={{ height: 20, fontSize: "0.7rem" }}
            />
          )}
          {mediumCount > 0 && (
            <Chip
              label={`${mediumCount} medium`}
              size="small"
              color="warning"
              sx={{ height: 20, fontSize: "0.7rem" }}
            />
          )}
          {lowCount > 0 && (
            <Chip
              label={`${lowCount} low`}
              size="small"
              variant="outlined"
              sx={{ height: 20, fontSize: "0.7rem" }}
            />
          )}
        </Stack>
      </Box>
      {sortedChanges.map((change) => (
        <CodeChangeItem key={change.id} change={change} />
      ))}
    </Stack>
  );
};
