import { Box, Button, Stack, Typography } from "@mui/material";
import React from "react";
import { useTranslation } from "react-i18next";

import type { EvalRecordedChanges } from "@hey-hey/contracts/api/models";
import { useService } from "@hey-hey/ui-common/data";

import type { CodingResults } from "./evalResultsView";
import { joinSavedPatch } from "./joinSavedPatch";
import {
  buildOpenOutputCommands,
  resolveOutputOpening,
} from "./openOutputCommands";

const downloadText = (fileName: string, text: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: "text/x-diff" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

/**
 * Lets a person rebuild an attempt's output on their own machine from what was
 * saved: the pinned commit and the saved changes. Nothing is rebuilt or kept
 * here, and no git runs; the workspace is long gone.
 */
export const OpenAttemptOutput: React.FC<{
  organizationId: string;
  attemptName: string;
  startPoint: CodingResults["startPoint"];
  target: CodingResults["target"];
  changes: EvalRecordedChanges | null;
}> = ({ organizationId, attemptName, startPoint, target, changes }) => {
  const { t } = useTranslation();
  const { data: service } = useService(organizationId, startPoint.serviceId);
  const [open, setOpen] = React.useState(false);

  if (changes === null || changes.files.length === 0) {
    return (
      <Typography
        variant="body2"
        color="text.secondary"
        data-testid="open-output-none"
      >
        {t("eval.results.coding.openOutput.none")}
      </Typography>
    );
  }

  const { patch, binaryPaths } = joinSavedPatch(changes.files);
  const patchFile = `${attemptName}.patch`;
  const opening = resolveOutputOpening(target?.path, changes.files);
  const commands = buildOpenOutputCommands({
    attemptName,
    sha: startPoint.sha,
    patchPath: `~/Downloads/${patchFile}`,
    hasPatch: patch !== "",
    opening,
  });

  const handleDownload = (): void => downloadText(patchFile, patch);
  const handleCopy = (): void => {
    void navigator.clipboard?.writeText(commands.join("\n"));
  };

  return (
    <Box data-testid="open-output">
      <Button
        size="small"
        onClick={() => setOpen((value) => !value)}
        data-testid="open-output-button"
      >
        {t("eval.results.coding.openOutput.button")}
      </Button>
      {open && (
        <Stack
          spacing={1}
          sx={{ mt: 1, p: 1.5, border: 1, borderColor: "divider" }}
          data-testid="open-output-panel"
        >
          <Typography variant="body2" data-testid="open-output-source">
            {t("eval.results.coding.openOutput.source", {
              service: service?.name ?? startPoint.serviceId,
              sha: startPoint.sha,
            })}
            {opening ? (
              <>
                {" · "}
                {t(
                  `eval.results.coding.openOutput.opening.${opening.kind}`,
                )}{" "}
                <code>{opening.path}</code>
              </>
            ) : null}
          </Typography>
          <Box>
            <Button
              size="small"
              variant="outlined"
              disabled={patch === ""}
              onClick={handleDownload}
              data-testid="download-patch"
            >
              {t("eval.results.coding.openOutput.download", {
                name: patchFile,
              })}
            </Button>
          </Box>
          {commands.length > 0 ? (
            <>
              <Box
                component="pre"
                sx={{ m: 0, overflowX: "auto", fontSize: 13 }}
                data-testid="open-output-commands"
              >
                {commands.join("\n")}
              </Box>
              <Box>
                <Button
                  size="small"
                  onClick={handleCopy}
                  data-testid="open-output-copy"
                >
                  {t("eval.results.coding.openOutput.copy")}
                </Button>
              </Box>
            </>
          ) : (
            <Typography variant="body2" data-testid="open-output-no-patch">
              {t("eval.results.coding.openOutput.noPatch")}
            </Typography>
          )}
          <Typography
            variant="caption"
            color="text.secondary"
            data-testid="open-output-note"
          >
            {t("eval.results.coding.openOutput.note")}
          </Typography>
          {binaryPaths.length > 0 && (
            <Typography
              variant="caption"
              color="warning.main"
              data-testid="open-output-binary"
            >
              {t("eval.results.coding.openOutput.binary", {
                paths: binaryPaths.join(", "),
              })}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            {t("eval.results.coding.openOutput.olderAttempts")}
          </Typography>
        </Stack>
      )}
    </Box>
  );
};
