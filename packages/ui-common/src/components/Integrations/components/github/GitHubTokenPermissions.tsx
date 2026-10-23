import React, { useState } from "react";
import {
  Box,
  Typography,
  Tabs,
  Tab,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Alert,
  Link,
  Chip,
  Paper,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import SecurityIcon from "@mui/icons-material/Security";
import TokenIcon from "@mui/icons-material/Token";
import { IntegrationTargetType } from "../../../../api";

interface GitHubTokenPermissionsProps {
  integrationType: IntegrationTargetType;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

const TabPanel: React.FC<TabPanelProps> = ({ children, value, index }) => {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`token-tabpanel-${index}`}
      aria-labelledby={`token-tab-${index}`}
    >
      {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
    </div>
  );
};

const PermissionChip: React.FC<{ permission: string; level: string }> = ({
  permission,
  level,
}) => (
  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
    <Typography variant="body2" component="span" sx={{ minWidth: 120 }}>
      {permission}:
    </Typography>
    <Chip
      label={level}
      size="small"
      variant="outlined"
      sx={{
        fontFamily: "monospace",
        fontSize: "0.75rem",
        fontWeight: 500,
      }}
    />
  </Box>
);

const ClassicTokenPermissions: React.FC<GitHubTokenPermissionsProps> = ({
  integrationType,
}) => {
  return (
    <Box>
      <Typography variant="body1" paragraph>
        Classic tokens are less secure but simpler to create. You can create one{" "}
        <Link
          href="https://github.com/settings/tokens?type=classic"
          target="_blank"
          rel="noopener noreferrer"
          sx={{ fontWeight: 500 }}
        >
          here
        </Link>
        .
      </Typography>

      <Typography variant="h6" gutterBottom sx={{ mt: 3, mb: 2 }}>
        Required Scopes
      </Typography>

      <List dense>
        <ListItem>
          <ListItemIcon>
            <CheckCircleIcon color="success" />
          </ListItemIcon>
          <ListItemText
            primary={
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Chip
                  label="repo"
                  size="small"
                  variant="filled"
                  sx={{
                    fontFamily: "monospace",
                    fontSize: "0.75rem",
                    bgcolor: "grey.100",
                    color: "grey.800",
                  }}
                />
              </Box>
            }
            secondary="Grants full control of public and private repositories, needed to read code and manage webhooks."
          />
        </ListItem>

        {integrationType === IntegrationTargetType.Organization && (
          <ListItem>
            <ListItemIcon>
              <CheckCircleIcon color="success" />
            </ListItemIcon>
            <ListItemText
              primary={
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Chip
                    label="admin:org_hook"
                    size="small"
                    variant="filled"
                    sx={{
                      fontFamily: "monospace",
                      fontSize: "0.75rem",
                      bgcolor: "grey.100",
                      color: "grey.800",
                    }}
                  />
                </Box>
              }
              secondary="Required to create, manage, and delete organization-level webhooks."
            />
          </ListItem>
        )}
      </List>
    </Box>
  );
};

const FineGrainedTokenPermissions: React.FC<GitHubTokenPermissionsProps> = ({
  integrationType,
}) => {
  return (
    <Box>
      <Alert severity="info" sx={{ mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <SecurityIcon fontSize="small" />
          <Typography variant="body2">
            <strong>Recommended:</strong> Fine-grained tokens are more secure
            and provide better access control.
          </Typography>
        </Box>
      </Alert>

      <Typography variant="body1" paragraph>
        Fine-grained tokens are more secure and are the recommended approach.
        You can create one{" "}
        <Link
          href="https://github.com/settings/tokens/new"
          target="_blank"
          rel="noopener noreferrer"
          sx={{ fontWeight: 500 }}
        >
          here
        </Link>
        .
      </Typography>

      <Typography variant="h6" gutterBottom sx={{ mt: 3, mb: 2 }}>
        Configuration Steps
      </Typography>

      <Box component="ol" sx={{ pl: 3 }}>
        <Box component="li" sx={{ mb: 2 }}>
          <Typography variant="body2" component="div">
            <strong>Resource owner:</strong> Select the organization that owns
            the repositories you want to connect.
          </Typography>
        </Box>

        <Box component="li" sx={{ mb: 2 }}>
          <Typography variant="body2" component="div">
            <strong>Repository access:</strong> Choose "All repositories" or
            select the specific ones this integration will access.
          </Typography>
        </Box>

        <Box component="li" sx={{ mb: 2 }}>
          <Typography variant="body2" component="div" sx={{ mb: 2 }}>
            <strong>Permissions:</strong> Grant the following permissions:
          </Typography>

          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography
              variant="subtitle2"
              sx={{ mb: 2, display: "flex", alignItems: "center", gap: 1 }}
            >
              <CheckCircleIcon color="success" fontSize="small" />
              Repository Permissions
            </Typography>
            <PermissionChip permission="Contents" level="Read-only" />
            <PermissionChip permission="Issues" level="Read and write" />
            <PermissionChip permission="Pull Requests" level="Read and write" />
            <PermissionChip permission="Webhooks" level="Read and write" />
          </Paper>

          {integrationType === IntegrationTargetType.Organization && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography
                variant="subtitle2"
                sx={{ mb: 2, display: "flex", alignItems: "center", gap: 1 }}
              >
                <CheckCircleIcon color="success" fontSize="small" />
                Organization Permissions
              </Typography>
              <PermissionChip permission="Webhooks" level="Read and write" />
            </Paper>
          )}
        </Box>
      </Box>

      <Alert severity="warning" sx={{ mt: 3 }}>
        <Typography variant="body2">
          <strong>Note:</strong> GitHub's "Administration" permission for
          repositories has been replaced by more granular permissions like
          "Webhooks". Ensure the "Webhooks" permission is set to "Read and
          write".
        </Typography>
      </Alert>
    </Box>
  );
};

export const GitHubTokenPermissions: React.FC<GitHubTokenPermissionsProps> = ({
  integrationType,
}) => {
  const [activeTab, setActiveTab] = useState<number>(0);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 3 }}>
        <TokenIcon color="primary" />
        <Typography variant="h6">GitHub Token Permissions</Typography>
      </Box>

      <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tabs
          value={activeTab}
          onChange={handleTabChange}
          aria-label="GitHub token types"
          variant="fullWidth"
        >
          <Tab
            label={
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <SecurityIcon fontSize="small" />
                Fine-Grained (Recommended)
              </Box>
            }
            id="token-tab-0"
            aria-controls="token-tabpanel-0"
          />
          <Tab
            label={
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <TokenIcon fontSize="small" />
                Classic Token
              </Box>
            }
            id="token-tab-1"
            aria-controls="token-tabpanel-1"
          />
        </Tabs>
      </Box>

      <TabPanel value={activeTab} index={0}>
        <FineGrainedTokenPermissions integrationType={integrationType} />
      </TabPanel>

      <TabPanel value={activeTab} index={1}>
        <ClassicTokenPermissions integrationType={integrationType} />
      </TabPanel>
    </Box>
  );
};
