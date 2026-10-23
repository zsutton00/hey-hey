import React from "react";
import { Box, Chip, Paper, Stack, Typography, useTheme } from "@mui/material";
import type { ImplementationHintDto } from "../../api";

interface ImplementationHintReadViewProps {
  hint: ImplementationHintDto;
}

const formatSourceType = (sourceType: ImplementationHintDto["sourceType"]) =>
  sourceType === "USER" ? "User" : "System";

const formatExtractedFrom = (
  extractedFrom: ImplementationHintDto["extractedFrom"]
): string => {
  if (extractedFrom === "AGENT") {
    return "Extracted from agent";
  }

  if (extractedFrom === "USER") {
    return "Extracted from user";
  }

  return "";
};

const getHintContent = (hint: ImplementationHintDto): string => {
  const candidates = [hint.latestVersion?.hint, hint.hint, hint.description];
  const value = candidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0
  );
  return value?.trim() ?? "";
};

export const ImplementationHintReadView: React.FC<
  ImplementationHintReadViewProps
> = ({ hint }) => {
  const theme = useTheme();
  const sessionCount = 1;
  const versionCount = hint.versions?.length ?? 0;
  const fileReferenceCount = hint.fileReferences?.length ?? 0;
  const displayedVersion = hint.latestVersion?.version ?? hint.version;
  const extractedFrom = hint.latestVersion?.extractedFrom ?? hint.extractedFrom;
  const confidence = hint.latestVersion?.confidence ?? hint.confidence;
  const hintContent = getHintContent(hint);

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 3,
        borderRadius: `${theme.shape.borderRadius}px`,
      }}
    >
      <Stack spacing={2}>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
          <Typography variant="h6" sx={{ flex: 1 }}>
            {hint.featureName}
          </Typography>
          <Chip size="small" label={formatSourceType(hint.sourceType)} />
        </Box>

        <Typography variant="body1" sx={{ whiteSpace: "pre-wrap" }}>
          {hintContent || "No implementation details provided."}
        </Typography>

        <Stack direction="row" spacing={1} flexWrap="wrap">
          {typeof displayedVersion === "number" && (
            <Chip
              size="small"
              label={`Version ${displayedVersion}`}
              variant="outlined"
            />
          )}
          {typeof confidence === "number" && (
            <Chip
              size="small"
              label={`Confidence ${confidence.toFixed(2)}`}
              variant="outlined"
            />
          )}
          {Boolean(extractedFrom) && (
            <Chip
              size="small"
              label={formatExtractedFrom(extractedFrom)}
              variant="outlined"
            />
          )}
          {sessionCount > 0 && (
            <Chip
              size="small"
              label={`${sessionCount} agent session${
                sessionCount === 1 ? "" : "s"
              }`}
              variant="outlined"
            />
          )}
          {versionCount > 0 && (
            <Chip
              size="small"
              label={`${versionCount} version${versionCount === 1 ? "" : "s"}`}
              variant="outlined"
            />
          )}
          {fileReferenceCount > 0 && (
            <Chip
              size="small"
              label={`${fileReferenceCount} file reference${
                fileReferenceCount === 1 ? "" : "s"
              }`}
              variant="outlined"
            />
          )}
        </Stack>

        <Stack direction="row" spacing={2} flexWrap="wrap">
          <Typography variant="caption" color="text.secondary">
            Created {new Date(hint.createdAt).toLocaleString()}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Updated {new Date(hint.updatedAt).toLocaleString()}
          </Typography>
        </Stack>
      </Stack>
    </Paper>
  );
};
