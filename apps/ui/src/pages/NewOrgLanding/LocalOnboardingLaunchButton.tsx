import { Alert, Button, Stack } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { AgentSessionDto } from "@hey-hey/ui-common/api";
import type { AgentSessionLaunchBinding } from "@hey-hey/ui-common/components";

import { useLocalOnboardingLaunch } from "./useLocalOnboardingLaunch";

interface LocalOnboardingLaunchButtonProps {
  binding: AgentSessionLaunchBinding;
  /** Null until an authorized machine with a ready provider is chosen. */
  machineId: string | null;
  onSessionSaved: (session: AgentSessionDto) => void;
  onStarted: () => void;
}

export function LocalOnboardingLaunchButton({
  binding,
  machineId,
  onSessionSaved,
  onStarted,
}: LocalOnboardingLaunchButtonProps) {
  const { t } = useTranslation();
  const { launching, error, handleStart } = useLocalOnboardingLaunch(
    binding,
    onSessionSaved,
  );

  const handleClick = async () => {
    if (!machineId) {
      return;
    }
    if (await handleStart(machineId)) {
      onStarted();
    }
  };

  return (
    <Stack spacing={2}>
      {error && <Alert severity="error">{error}</Alert>}
      <Button
        variant="contained"
        size="large"
        data-testid="local-onboarding-launch"
        disabled={launching || !machineId}
        onClick={handleClick}
      >
        {t("newOrgLanding.advance.start")}
      </Button>
    </Stack>
  );
}
