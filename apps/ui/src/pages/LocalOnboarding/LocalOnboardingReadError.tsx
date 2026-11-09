import { useState } from "react";
import { Alert, AlertTitle, Button, Stack } from "@mui/material";
import { useTranslation } from "react-i18next";

interface LocalOnboardingReadErrorProps {
  message: string;
  onRetry: () => Promise<void>;
}

/** Shown when the onboarding conversation or its session cannot be read. */
export function LocalOnboardingReadError({
  message,
  onRetry,
}: LocalOnboardingReadErrorProps) {
  const { t } = useTranslation();
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      await onRetry();
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <Stack
      data-testid="local-onboarding-read-error"
      alignItems="center"
      sx={{ maxWidth: 720, mx: "auto" }}
    >
      <Alert
        severity="error"
        sx={{ width: "100%" }}
        action={
          <Button
            data-testid="local-onboarding-read-retry"
            color="inherit"
            size="small"
            disabled={isRetrying}
            onClick={() => void handleRetry()}
          >
            {isRetrying ? t("common.retrying") : t("common.retry")}
          </Button>
        }
      >
        <AlertTitle>{t("onboarding.local.loadFailed")}</AlertTitle>
        {message}
      </Alert>
    </Stack>
  );
}
