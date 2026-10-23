import { Box, Stack, Typography } from "@mui/material";
import type { CommitReportPayload } from "../../../api";
import { ReportLabeledText, ReportPanel } from "./reportPrimitives";
import type { ReportRenderer } from "./rendererContract";

export const CommitReport: ReportRenderer<CommitReportPayload> = ({
  payload,
  reportTestId,
}) => {
  const files = payload.files;
  const hashes = payload.hashes;

  return (
    <Stack data-testid={`${reportTestId}-commit`} spacing={1.5}>
      <ReportLabeledText
        label="Summary"
        renderMentions
        testId={`${reportTestId}-commit-summary`}
        value={payload.summary}
      />
      <ReportPanel
        emptyMessage="No commit hashes were recorded."
        isEmpty={hashes.length === 0}
        testId={`${reportTestId}-commit-hashes`}
        title="Commits"
      >
        <Stack
          component="ul"
          data-testid={`${reportTestId}-commit-hashes-list`}
          spacing={0.25}
          sx={{ listStyle: "none", m: 0, pl: 0 }}
        >
          {hashes.map((entry, index) => (
            <Box
              component="li"
              data-testid={`${reportTestId}-commit-hashes-item-${index}`}
              key={`hash-${index}`}
            >
              <Typography sx={{ fontFamily: "monospace" }} variant="body2">
                {entry.service}: {entry.hash}
                {/* Reports emitted before branch was recorded omit it. */}
                {entry.branch ? ` (${entry.branch})` : null}
              </Typography>
            </Box>
          ))}
        </Stack>
      </ReportPanel>
      <ReportPanel
        emptyMessage="No files were included in this commit."
        isEmpty={files.length === 0}
        testId={`${reportTestId}-commit-files`}
        title="Files"
      >
        <Stack
          component="ul"
          data-testid={`${reportTestId}-commit-files-list`}
          spacing={0.25}
          sx={{ listStyle: "disc", m: 0, pl: 3 }}
        >
          {files.map((path, index) => (
            <Box
              component="li"
              data-testid={`${reportTestId}-commit-files-item-${index}`}
              key={`file-${index}`}
            >
              <Typography sx={{ fontFamily: "monospace" }} variant="body2">
                {path}
              </Typography>
            </Box>
          ))}
        </Stack>
      </ReportPanel>
    </Stack>
  );
};
