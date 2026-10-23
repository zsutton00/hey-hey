import { CurrentPasswordChangeForm } from "@hey-hey/ui-common/components";
import { useAuth } from "@hey-hey/ui-common/context";
import { KEYS } from "@hey-hey/ui-common/i18n";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Box, Button, Typography } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import {
  DetailPageContainer,
  DetailPageHeader,
  PageBreadcrumbs,
} from "../../components/Layout";
import { ClaimMachine } from "./ClaimMachine";
import { MachinesList } from "./MachinesList";

type SettingsView = "landing" | "pairing";

const resolveSettingsView = (section: string | null): SettingsView =>
  section === "pairing" ? "pairing" : "landing";

export const SettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const { changeCurrentPassword } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const settingsLabel = t(KEYS.navigation.settings);
  const [showPasswordChangeForm, setShowPasswordChangeForm] = useState(false);
  const view = resolveSettingsView(searchParams.get("section"));
  const authorizationTarget =
    searchParams.get("intent") === "authorize-browser" &&
    searchParams.get("machineId") &&
    searchParams.get("machineName")
      ? {
          machineId: searchParams.get("machineId")!,
          machineName: searchParams.get("machineName")!,
        }
      : undefined;

  const returnToLanding = (): void => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("section");
      next.delete("intent");
      next.delete("machineId");
      next.delete("machineName");
      return next;
    });
  };

  const openPairing = (): void => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("section", "pairing");
      return next;
    });
  };

  if (view === "pairing") {
    return (
      <Box data-testid="settings-pairing-view">
        <PageBreadcrumbs
          items={[
            { label: settingsLabel, to: ".", isCurrent: false },
            { label: "Pairing", isCurrent: true },
          ]}
        />
        <DetailPageContainer maxWidth="md">
          <DetailPageHeader
            title={
              <Typography component="h1" variant="h4">
                {authorizationTarget
                  ? `Authorize this browser for ${authorizationTarget.machineName}`
                  : "Pair an Agent Bridge"}
              </Typography>
            }
          />
          <Box sx={{ px: 1.5, pb: 3 }}>
            <Button
              type="button"
              startIcon={<ArrowBackIcon />}
              onClick={returnToLanding}
              data-testid="settings-pairing-back"
              sx={{ mb: 2 }}
            >
              Back to Settings
            </Button>
            <ClaimMachine
              initialCode={null}
              authorizationTarget={authorizationTarget}
              completionActionLabel="Return to settings"
              onCompletionAction={returnToLanding}
            />
          </Box>
        </DetailPageContainer>
      </Box>
    );
  }

  return (
    <Box data-testid="settings-page">
      <PageBreadcrumbs items={[{ label: settingsLabel, isCurrent: true }]} />
      <DetailPageContainer maxWidth="md">
        <DetailPageHeader
          title={
            <Typography
              component="h1"
              variant="h4"
              data-testid="settings-page-heading"
            >
              {settingsLabel}
            </Typography>
          }
        />
        <Box sx={{ px: 1.5, pb: 3 }}>
          <Box
            component="section"
            data-testid="settings-password-section"
            sx={{ mb: 4 }}
          >
            <Typography
              variant="h6"
              component="h2"
              data-testid="settings-password-heading"
              gutterBottom
            >
              Password
            </Typography>
            <Button
              type="button"
              variant="outlined"
              data-testid="settings-change-password-button"
              onClick={() => setShowPasswordChangeForm(true)}
            >
              Change Password
            </Button>
            {showPasswordChangeForm && (
              <Box sx={{ mt: 2 }}>
                <CurrentPasswordChangeForm
                  onSubmit={({ currentPassword, newPassword }) =>
                    changeCurrentPassword(currentPassword, newPassword).then(
                      () => undefined
                    )
                  }
                />
              </Box>
            )}
          </Box>
          <Box component="section" data-testid="settings-machines-section">
            <Typography
              variant="h6"
              component="h2"
              data-testid="settings-machines-heading"
              gutterBottom
            >
              Agent Bridges
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Agent Bridges are Hey Hey CLIs that connect your computers so they
              can run work. Passkeys authorize each Agent Bridge.
            </Typography>
            <MachinesList />
            <Button
              type="button"
              variant="outlined"
              onClick={openPairing}
              data-testid="settings-pair-machine-button"
              sx={{ mt: 2 }}
            >
              Pair an Agent Bridge
            </Button>
          </Box>
        </Box>
      </DetailPageContainer>
    </Box>
  );
};
