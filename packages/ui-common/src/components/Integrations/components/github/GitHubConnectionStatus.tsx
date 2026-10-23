import React from "react";
import {
  Box,
  Typography,
  Chip,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ScheduleIcon from "@mui/icons-material/Schedule";
import TokenIcon from "@mui/icons-material/VpnKey";
import DateIcon from "@mui/icons-material/DateRange";
import { useTranslation } from "react-i18next";
import { KEYS } from "../../../../i18n/keys";
import type { GitHubIntegrationConfig } from "../../../../api";

interface GitHubConnectionStatusProps {
  config: GitHubIntegrationConfig;
  lastConnectionCheck?: string;
}

/**
 * Displays the current GitHub OAuth connection status including
 * connected account, granted scopes, and token information.
 */
export const GitHubConnectionStatus: React.FC<GitHubConnectionStatusProps> = ({
  config,
  lastConnectionCheck,
}) => {
  const { t } = useTranslation();

  const formatDate = (dateString: string | undefined): string => {
    if (!dateString) return t(KEYS.common.notAvailable);
    return new Date(dateString).toLocaleString();
  };

  const isTokenExpired = (expiresAt: string | undefined): boolean => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  const hasValidToken = config.token && !isTokenExpired(config.tokenExpiresAt);

  return (
    <Card variant="outlined">
      <CardContent>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <CheckCircleIcon color="success" />
          <Typography variant="h6">
            {t(KEYS.integrations.github.connectionStatus)}
          </Typography>
        </Box>

        <List dense>
          {/* Connected Account */}
          {config.organization && (
            <ListItem>
              <ListItemIcon>
                <CheckCircleIcon fontSize="small" color="success" />
              </ListItemIcon>
              <ListItemText
                primary={t(KEYS.integrations.github.connectedOrganization)}
                secondary={config.organization}
              />
            </ListItem>
          )}

          {/* OAuth Scopes */}
          {config.scope && (
            <ListItem>
              <ListItemIcon>
                <TokenIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={t(KEYS.integrations.github.grantedScopes)}
                secondary={
                  <Box sx={{ mt: 0.5 }}>
                    {config.scope.split(" ").map((scope) => (
                      <Chip
                        key={scope}
                        label={scope}
                        size="small"
                        variant="outlined"
                        sx={{ mr: 0.5, mb: 0.5 }}
                      />
                    ))}
                  </Box>
                }
              />
            </ListItem>
          )}

          {/* Token Status */}
          <ListItem>
            <ListItemIcon>
              <TokenIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary={t(KEYS.integrations.github.accessToken)}
              secondary={
                <Box
                  display="flex"
                  alignItems="center"
                  gap={1}
                  sx={{ mt: 0.5 }}
                >
                  {hasValidToken ? (
                    <>
                      <Chip
                        label={t(KEYS.common.active)}
                        size="small"
                        color="success"
                      />
                      {config.tokenExpiresAt && (
                        <Typography variant="caption" color="text.secondary">
                          {t(KEYS.integrations.github.expiresAt, {
                            date: formatDate(config.tokenExpiresAt),
                          })}
                        </Typography>
                      )}
                    </>
                  ) : (
                    <Chip
                      label={t(KEYS.integrations.github.expired)}
                      size="small"
                      color="error"
                    />
                  )}
                </Box>
              }
            />
          </ListItem>

          {/* Last Sync */}
          {lastConnectionCheck && (
            <ListItem>
              <ListItemIcon>
                <DateIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={t(KEYS.integrations.github.lastSync)}
                secondary={formatDate(lastConnectionCheck)}
              />
            </ListItem>
          )}

          {/* Primary Repository */}
          {config.primaryRepository && (
            <ListItem>
              <ListItemIcon>
                <ScheduleIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={t(KEYS.integrations.github.primaryRepository)}
                secondary={config.primaryRepository.fullName}
              />
            </ListItem>
          )}
        </List>
      </CardContent>
    </Card>
  );
};
