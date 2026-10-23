import LogoutIcon from "@mui/icons-material/Logout";
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import type { BrowserOrganizationSelectionDto } from "../../api";
import type { AccountDefaultOrganizationState } from "../../data/hooks/useAccountDefaultOrganization";

export interface OrganizationHomeHeaderProps {
  userName: string;
  organization: BrowserOrganizationSelectionDto["organizations"][number];
  organizations: BrowserOrganizationSelectionDto["organizations"];
  defaultState: AccountDefaultOrganizationState;
  onOrganizationChange: (organizationId: string) => Promise<void>;
  onSetDefault: (organizationId: string) => Promise<void>;
  onRetryDefault: () => Promise<void>;
  onLogout: () => Promise<void>;
}

export function OrganizationHomeHeader({
  userName,
  organization,
  organizations,
  defaultState,
  onOrganizationChange,
  onSetDefault,
  onRetryDefault,
  onLogout,
}: OrganizationHomeHeaderProps) {
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const isDefault =
    "preference" in defaultState &&
    defaultState.preference.organizationId === organization.id;
  return (
    <Stack
      data-testid="organization-home-header"
      direction={{ xs: "column", sm: "row" }}
      justifyContent="space-between"
      spacing={3}
      sx={{ mb: 4 }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography
          component="h1"
          variant="h3"
          data-testid="organization-home-title"
        >
          Home
        </Typography>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography
            variant="h6"
            sx={{ minWidth: 0, overflowWrap: "anywhere" }}
            data-testid="organization-home-user-name"
          >
            Hello, {userName}
          </Typography>
          <Button
            size="small"
            startIcon={<LogoutIcon fontSize="small" />}
            disabled={isLoggingOut}
            data-testid="organization-home-logout"
            onClick={() => {
              setIsLoggingOut(true);
              setLogoutError(null);
              void onLogout()
                .catch(() => {
                  setLogoutError("Unable to log out. Please try again.");
                })
                .finally(() => {
                  setIsLoggingOut(false);
                });
            }}
          >
            {isLoggingOut ? "Logging out…" : "Logout"}
          </Button>
        </Stack>
        {logoutError && <Alert severity="error">{logoutError}</Alert>}
      </Box>
      <Stack spacing={1} sx={{ width: { xs: "100%", sm: 300 }, flexShrink: 0 }}>
        <TextField
          select
          label="Organization"
          value={organization.id}
          disabled={
            defaultState.status === "saving" || organizations.length < 2
          }
          data-testid="organization-home-organization-picker"
          onChange={(event) => {
            void onOrganizationChange(event.target.value).catch(
              () => undefined
            );
          }}
        >
          {organizations.map((item) => (
            <MenuItem
              key={item.id}
              value={item.id}
              data-testid="organization-home-organization-option"
              data-organization-id={item.id}
            >
              {item.name}
            </MenuItem>
          ))}
        </TextField>
        {defaultState.status === "error" ? (
          <Alert
            severity="error"
            action={
              <Button data-testid="organization-home-retry-default" onClick={() => void onRetryDefault()}>Retry</Button>
            }
          >
            {defaultState.message}
          </Alert>
        ) : (
          <Button
            data-testid="organization-home-set-default"
            disabled={
              defaultState.status === "loading" ||
              defaultState.status === "saving" ||
              isDefault
            }
            onClick={() => void onSetDefault(organization.id)}
          >
            {defaultState.status === "loading"
              ? "Loading default…"
              : defaultState.status === "saving"
              ? "Saving…"
              : isDefault
              ? "Default organization"
              : "Set as default"}
          </Button>
        )}
        {defaultState.status === "saved" && (
          <Typography role="status" variant="body2">
            Default organization saved.
          </Typography>
        )}
        {defaultState.status === "save-error" && (
          <Alert severity="error">{defaultState.message}</Alert>
        )}
      </Stack>
    </Stack>
  );
}
