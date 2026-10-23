import {
  Alert,
  AlertTitle,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import type { TriageCloseGate } from "./openItemsTriageReview";

/**
 * The close gate shown in place of the review body, under the modal header.
 * Render-only: the review owner decides what Keep and Confirm do.
 */
export function OpenItemsTriageCloseConfirmation({
  gate,
  onKeep,
  onConfirm,
}: {
  gate: Exclude<TriageCloseGate, { kind: "none" }>;
  onKeep: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  if (gate.kind === "stopping")
    return (
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        role="status"
        data-testid="triage-stopping"
        sx={{ py: 2 }}
      >
        <CircularProgress size={16} />
        <Typography>
          {t("triage.cancel.stopping", "Cancelling the run…")}
        </Typography>
      </Stack>
    );
  const copy =
    gate.kind === "confirmDiscard"
      ? {
          testId: "triage-confirm-discard",
          message: t(
            "triage.discard.message",
            "Closing triage will discard these results. You won’t be able to return to them. Changes you’ve already applied will remain.",
          ),
          keep: t("triage.discard.keep", "Keep reviewing"),
          confirm: t("triage.discard.confirm", "Discard and close"),
        }
      : gate.kind === "confirmCancel"
        ? {
            testId: "triage-confirm-cancel",
            message: t(
              "triage.cancel.message",
              "Triage is still running. Closing will cancel this run, and you won’t be able to return to it. Changes you’ve already applied will remain.",
            ),
            keep: t("triage.cancel.keep", "Keep running"),
            confirm: t("triage.cancel.confirm", "Cancel and close"),
          }
        : {
            testId: "triage-stop-failed",
            message: gate.message,
            keep: t("triage.discard.keep", "Keep reviewing"),
            confirm: t("triage.cancel.retry", "Try again"),
          };
  return (
    <Stack spacing={2} data-testid={copy.testId}>
      <Alert
        severity={gate.kind === "stopFailed" ? "error" : "warning"}
        role={gate.kind === "stopFailed" ? "alert" : undefined}
      >
        {gate.kind === "stopFailed" && (
          <AlertTitle>
            {t("triage.cancel.failed", "The run could not be cancelled")}
          </AlertTitle>
        )}
        {copy.message}
      </Alert>
      <Stack direction="row" justifyContent="flex-end" spacing={1}>
        <Button autoFocus data-testid="triage-close-keep" onClick={onKeep}>
          {copy.keep}
        </Button>
        <Button
          data-testid="triage-close-confirm"
          variant="contained"
          color={gate.kind === "confirmDiscard" ? "primary" : "error"}
          onClick={onConfirm}
        >
          {copy.confirm}
        </Button>
      </Stack>
    </Stack>
  );
}
