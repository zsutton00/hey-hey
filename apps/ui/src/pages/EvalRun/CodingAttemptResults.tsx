import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import React from "react";
import { useTranslation } from "react-i18next";

import type { EvalRecordedFileChange } from "@hey-hey/contracts/api/models";
import { useService } from "@hey-hey/ui-common/data";

import type { CodingResults } from "./evalResultsView";
import { shortSha } from "./shortSha";

const Pre: React.FC<{ testId: string; children: string }> = ({
  testId,
  children,
}) => (
  <Box
    component="pre"
    data-testid={testId}
    sx={{
      m: 0,
      mt: 0.5,
      p: 1,
      overflow: "auto",
      fontSize: 12,
      bgcolor: "action.hover",
    }}
  >
    {children}
  </Box>
);

/** Where the attempt started: the Service and the pinned commit. */
export const CodingStartPoint: React.FC<{
  organizationId: string;
  startPoint: CodingResults["startPoint"];
}> = ({ organizationId, startPoint }) => {
  const { t } = useTranslation();
  const { data: service } = useService(organizationId, startPoint.serviceId);

  return (
    <Typography
      variant="body2"
      sx={{ mt: 0.5 }}
      data-testid="eval-coding-start-point"
    >
      {t("eval.results.coding.startedFrom", {
        service: service?.name ?? startPoint.serviceId,
        sha: shortSha(startPoint.sha),
      })}{" "}
      <Typography component="span" variant="caption" color="text.secondary">
        {startPoint.shortMessage}
      </Typography>
    </Typography>
  );
};

const FILE_TAG: Record<EvalRecordedFileChange["status"], string> = {
  added: "new",
  modified: "changed",
  deleted: "deleted",
};

const FILE_TAG_COLORS: Partial<
  Record<EvalRecordedFileChange["status"], { bgcolor: string; color: string }>
> = {
  modified: { bgcolor: "#eef2fc", color: "#2f5bd3" },
  added: { bgcolor: "#eef6f0", color: "#1d6b35" },
};

const ChangedFile: React.FC<{ file: EvalRecordedFileChange }> = ({ file }) => {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);

  return (
    <Box data-testid={`eval-coding-file-${file.path}`}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Chip
          size="small"
          label={t(`eval.results.coding.${FILE_TAG[file.status]}`)}
          sx={FILE_TAG_COLORS[file.status]}
        />
        <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
          {file.path}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t(
            file.status === "added"
              ? "eval.results.coding.linesAdded"
              : "eval.results.coding.lines",
            { added: file.additions, removed: file.deletions },
          )}
        </Typography>
        <Button size="small" onClick={() => setOpen((value) => !value)}>
          {open
            ? t("eval.results.coding.hideDiff")
            : t("eval.results.coding.showDiff")}
        </Button>
      </Stack>
      {open && <Pre testId={`eval-coding-diff-${file.path}`}>{file.patch}</Pre>}
    </Box>
  );
};

/**
 * What a coding attempt changed, read from what the runner saved before the
 * workspace was removed. Commands the agent ran are in its session.
 */
export const CodingAttemptResults: React.FC<{ coding: CodingResults }> = ({
  coding,
}) => {
  const { t } = useTranslation();
  const { changes, ended } = coding;

  return (
    <Stack spacing={2} sx={{ mb: 2 }} data-testid="eval-coding-results">
      <Box>
        <Typography variant="subtitle2" component="h3">
          {t("eval.results.coding.changes")}
        </Typography>
        {changes === null ? (
          <Typography variant="body2" color="text.secondary">
            {t(
              ended
                ? "eval.results.coding.notSaved"
                : "eval.results.coding.notSavedYet",
            )}
          </Typography>
        ) : (
          <Stack spacing={1}>
            <Typography
              variant="caption"
              color="text.secondary"
              data-testid="eval-coding-saved-note"
            >
              {t("eval.results.coding.savedNote")}
            </Typography>
            {changes.files.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t("eval.results.coding.noChanges")}
              </Typography>
            ) : (
              changes.files.map((file) => (
                <ChangedFile key={file.path} file={file} />
              ))
            )}
          </Stack>
        )}
      </Box>
    </Stack>
  );
};
