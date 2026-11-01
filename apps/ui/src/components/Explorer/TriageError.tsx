import { Alert, AlertTitle, Button } from "@mui/material";
import { useTranslation } from "react-i18next";

export function TriageError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Alert
      severity="error"
      data-testid="open-items-triage-session-error"
      action={
        <Button
          data-testid="triage-launch-retry"
          color="inherit"
          size="small"
          onClick={onRetry}
        >
          {t("triage.tryAgain", "Try again")}
        </Button>
      }
    >
      <AlertTitle>
        {t("triage.reviewCouldNotStart", "Review could not start")}
      </AlertTitle>
      {message}
    </Alert>
  );
}
